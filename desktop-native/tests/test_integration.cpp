#include "api.h"
#include "calls.h"
#include "window.h"
#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QProcess>
#include <QRegularExpression>
#include <QScrollBar>
#include <QTemporaryDir>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineView>
#include <QtTest>
class Integration : public QObject {
    Q_OBJECT
    QProcess fixture;
    QJsonObject config;
    QTemporaryDir dir;
    Api *api = nullptr;
    ApiResult call(Api *client, QString path, QJsonValue data = QJsonValue::Undefined,
                   bool auth = true) {
        ApiResult result;
        QEventLoop loop;
        client->request(
            path, data,
            [&](ApiResult value) {
                result = value;
                loop.quit();
            },
            auth);
        QTimer timer;
        timer.setSingleShot(true);
        connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
        timer.start(30000);
        loop.exec();
        return result;
    }
    QJsonObject control(QString path, QJsonObject data) {
        QNetworkAccessManager network;
        QNetworkRequest req(QUrl(config.value("control").toString() + path));
        req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        auto reply = network.post(req, QJsonDocument(data).toJson());
        QEventLoop loop;
        connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        QTimer::singleShot(10000, &loop, &QEventLoop::quit);
        loop.exec();
        return QJsonDocument::fromJson(reply->readAll()).object();
    }
    QJsonObject login(Api *client, QString phone, int id) {
        auto secret = Api::nonce();
        auto start =
            call(client, "/auth/desktop/request",
                 QJsonObject{
                     {"phone", phone}, {"client_secret", secret}, {"request_id", Api::nonce(24)}},
                 false);
        if (!start.ok())
            return {};
        auto code = control("/code", {{"user_id", id}}).value("code").toString();
        auto value =
            call(client, "/auth/desktop/verify",
                 QJsonObject{{"challenge_id", start.value.toObject().value("challenge_id")},
                             {"client_secret", secret},
                             {"code", code}},
                 false);
        return value.value.toObject();
    }
    QVariant javascript(QWebEngineView *view, QString source) {
        QVariant result;
        QEventLoop loop;
        view->page()->runJavaScript(source, [&](const QVariant &value) {
            result = value;
            loop.quit();
        });
        QTimer::singleShot(10000, &loop, &QEventLoop::quit);
        loop.exec();
        return result;
    }
  private slots:
    void initTestCase() {
        auto script = qEnvironmentVariable("VOLNA_NATIVE_FIXTURE_SCRIPT");
        if (script.isEmpty())
            QSKIP("Set VOLNA_NATIVE_FIXTURE_SCRIPT to tests/native-desktop-fixture.mjs");
        fixture.setProgram(qEnvironmentVariable("VOLNA_NODE", "node"));
        fixture.setArguments({script});
        fixture.setProcessChannelMode(QProcess::SeparateChannels);
        fixture.start();
        QVERIFY(fixture.waitForStarted());
        QByteArray output;
        QElapsedTimer timer;
        timer.start();
        while (!output.contains('\n') && timer.elapsed() < 20000) {
            fixture.waitForReadyRead(500);
            output += fixture.readAllStandardOutput();
        }
        config = QJsonDocument::fromJson(output.trimmed()).object();
        QVERIFY2(config.contains("url"), fixture.readAllStandardError().constData());
        api = new Api(QUrl(config.value("url").toString()), dir.path(), this);
    }
    void serviceLogin() {
        auto value = login(api, config.value("phoneA").toString(), config.value("idA").toInt());
        QVERIFY(!value.isEmpty());
        QCOMPARE(value.value("platform").toString(), QString("windows"));
        QVERIFY(api->acceptSession(value));
        QVERIFY(!call(api, "/chats").value.toArray().isEmpty());
    }
    void messagesAndRetry() {
        auto path = "/chats/" + QString::number(config.value("chat").toInt()) + "/messages";
        QJsonObject data{{"text", "Нативное сообщение ✓"},
                         {"client_id", "native-integration-send-00001"}};
        auto first = call(api, path, data), second = call(api, path, data);
        QVERIFY(first.ok());
        QVERIFY(second.ok());
        QCOMPARE(first.value.toObject().value("id"), second.value.toObject().value("id"));
        auto rows = call(api, path).value.toArray();
        QVERIFY(rows.size() >= 2);
    }
    void refreshSingleFlight() {
        auto original = api->token();
        int done = 0;
        QEventLoop loop;
        auto callback = [&](ApiResult value) {
            QVERIFY(value.ok());
            if (++done == 2)
                loop.quit();
        };
        api->refresh(callback, original);
        api->refresh(callback, original);
        QTimer::singleShot(15000, &loop, &QEventLoop::quit);
        loop.exec();
        QCOMPARE(done, 2);
        QVERIFY(api->token() != original);
        auto replacement = api->token();
        ApiResult reused;
        api->refresh([&](ApiResult result) { reused = result; }, original);
        QVERIFY(reused.ok());
        QCOMPARE(api->token(), replacement);
        QVERIFY(call(api, "/me").ok());
    }
    void eventDelivery() {
        QSignalSpy events(api, &Api::eventReceived);
        api->startEvents();
        QTest::qWait(300);
        control("/message",
                {{"text", "SSE из телефона"}, {"client_id", "native-integration-sse-00001"}});
        QTRY_VERIFY_WITH_TIMEOUT(!events.isEmpty(), 10000);
        bool found = false;
        for (auto value : events)
            if (value[0].toJsonObject().value("message").toObject().value("text") ==
                "SSE из телефона")
                found = true;
        QVERIFY(found);
        api->stopEvents();
    }
    void files() {
        QFile file(dir.filePath("Пример.txt"));
        QVERIFY(file.open(QIODevice::WriteOnly));
        file.write("Native file UTF-8 ✓");
        file.close();
        ApiResult uploaded;
        QEventLoop loop;
        api->upload(file.fileName(), [&](ApiResult result) {
            uploaded = result;
            loop.quit();
        });
        QTimer::singleShot(15000, &loop, &QEventLoop::quit);
        loop.exec();
        QVERIFY(uploaded.ok());
        auto sent =
            call(api, "/chats/" + QString::number(config.value("chat").toInt()) + "/messages",
                 QJsonObject{{"text", "Файл"},
                             {"attachment_id", uploaded.value.toObject().value("id")},
                             {"client_id", "native-integration-file-00001"}});
        QVERIFY(sent.ok());
        ApiResult downloaded;
        QEventLoop wait;
        api->download(uploaded.value.toObject().value("id").toString(),
                      sent.value.toObject().value("id").toVariant().toLongLong(),
                      [&](ApiResult result) {
                          downloaded = result;
                          wait.quit();
                      });
        QTimer::singleShot(15000, &wait, &QEventLoop::quit);
        wait.exec();
        QVERIFY(downloaded.ok());
        QCOMPARE(downloaded.bytes, QByteArray("Native file UTF-8 ✓"));
    }
    void qrLogin() {
        Api other(QUrl(config.value("url").toString()), dir.filePath("qr"));
        auto start = call(&other, "/auth/qr/request", QJsonObject{{"platform", "windows"}}, false)
                         .value.toObject();
        QVERIFY(control("/qr", {{"qr_text", start.value("qr_text")}}).value("ok").toBool());
        auto result =
            call(&other, "/auth/qr/poll",
                 QJsonObject{{"id", start.value("id")}, {"poll_token", start.value("poll_token")}},
                 false);
        QVERIFY(result.ok());
        QCOMPARE(result.value.toObject().value("platform").toString(), QString("windows"));
    }
    void nativeScreens() {
        Api empty(QUrl(config.value("url").toString()), dir.filePath("empty"));
        Window window(&empty);
        window.show();
        QTest::qWait(100);
        auto screenshot = qEnvironmentVariable("VOLNA_NATIVE_SCREENSHOTS");
        if (!screenshot.isEmpty()) {
            QDir().mkpath(screenshot);
            QVERIFY(window.grab().save(screenshot + "/welcome.png"));
        }
        auto start = window.findChild<QPushButton *>("primary");
        QVERIFY(start);
        QTest::mouseClick(start, Qt::LeftButton);
        auto phone = window.findChild<QPushButton *>("phoneLogin");
        QTRY_VERIFY(phone->isVisible());
        QTest::mouseClick(phone, Qt::LeftButton);
        auto input = window.findChild<QLineEdit *>("phone");
        input->setText(config.value("phoneC").toString());
        QTest::mouseClick(window.findChild<QPushButton *>("requestCode"), Qt::LeftButton);
        auto code = window.findChild<QLineEdit *>("code");
        QTRY_VERIFY_WITH_TIMEOUT(code->isVisible(), 10000);
        code->setText(
            control("/code", {{"user_id", config.value("idC")}}).value("code").toString());
        QTest::mouseClick(window.findChild<QPushButton *>("verifyCode"), Qt::LeftButton);
        auto chats = window.findChild<QListWidget *>("chats");
        QTRY_VERIFY_WITH_TIMEOUT(chats->isVisible() && chats->count() > 0, 15000);
        for (int i = 0; i < chats->count(); ++i)
            if (chats->item(i)->data(Qt::UserRole).toInt() == config.value("chatC").toInt())
                QTest::mouseClick(chats->viewport(), Qt::LeftButton, Qt::NoModifier,
                                  chats->visualItemRect(chats->item(i)).center());
        auto messages = window.findChild<QListWidget *>("messages");
        QTRY_VERIFY(messages->count() > 0);
        auto editor = window.findChild<QPlainTextEdit *>("editor");
        control("/lose-message", {});
        editor->setPlainText("Проверка нативной отправки. Сообщение с несколькими строками и "
                             "эмодзи 👋\nЧаты и звонки работают через сервер Волны.");
        QTest::mouseClick(window.findChild<QPushButton *>("sendMessage"), Qt::LeftButton);
        auto retry = window.findChild<QPushButton *>("sendMessage");
        QTRY_VERIFY_WITH_TIMEOUT(retry->text() == "Повторить отправку" && retry->isEnabled(),
                                 10000);
        QVERIFY(editor->isReadOnly());
        const auto sentText = editor->toPlainText();
        QTest::mouseClick(retry, Qt::LeftButton);
        QTRY_VERIFY_WITH_TIMEOUT(editor->toPlainText().isEmpty(), 10000);
        QCOMPARE(control("/message-count", {{"text", sentText}}).value("count").toInt(), 1);
        QTest::qWait(100);
        for (auto text : messages->findChildren<QLabel *>())
            if (text->text().startsWith("Проверка нативной отправки"))
                QVERIFY(text->height() >= text->heightForWidth(text->width()));
        QVERIFY(messages->horizontalScrollBar()->maximum() == 0);
        if (!screenshot.isEmpty())
            QVERIFY(window.grab().save(screenshot + "/chat.png"));
    }
    void realRtcCall() {
        if (qEnvironmentVariable("VOLNA_NATIVE_TURN_TEST") != "1")
            QSKIP("Run local coturn and set VOLNA_NATIVE_TURN_TEST=1");
        Api peer(QUrl(config.value("url").toString()), dir.filePath("peer"));
        QVERIFY(peer.acceptSession(
            login(&peer, config.value("phoneB").toString(), config.value("idB").toInt())));
        Calls a(api), b(&peer);
        QSignalSpy failuresA(&a, &Calls::problem), failuresB(&b, &Calls::problem);
        auto viewA = a.findChild<QWebEngineView *>(), viewB = b.findChild<QWebEngineView *>();
        auto observe = [](QWebEngineView *view) {
            QWebEngineScript script;
            script.setName("TestRtcObserver");
            script.setInjectionPoint(QWebEngineScript::DocumentCreation);
            script.setWorldId(QWebEngineScript::MainWorld);
            script.setSourceCode("window.__testPeers=[];window.RTCPeerConnection=class extends "
                                 "RTCPeerConnection{constructor(...args){super(...args);window.__"
                                 "testPeers.push(this);}};");
            view->page()->scripts().insert(script);
        };
        observe(viewA);
        observe(viewB);
        QTRY_VERIFY_WITH_TIMEOUT(a.ready() && b.ready(), 30000);
        QVERIFY(viewA->page()->profile()->isOffTheRecord());
        QVERIFY(!a.findChild<CallBridge *>()->session().contains("refresh_token"));
        a.start(QJsonObject{{"id", config.value("chat")}}, false);
        QTRY_VERIFY_WITH_TIMEOUT(b.active(), 30000);

        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(viewB, "!!document.querySelector('[aria-label=\"Принять звонок\"]')")
                .toBool(),
            10000);
        javascript(viewB, "document.querySelector('[aria-label=\"Принять звонок\"]').click()");

        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(
                viewA,
                "!!document.querySelector('.call-person [role=status]') && "
                "document.querySelector('.call-person [role=status]').textContent==='Разговор'")
                .toBool(),
            45000);
        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(
                viewB,
                "document.querySelector('.call-person [role=status]')?.textContent==='Разговор'")
                .toBool(),
            10000);
        javascript(viewB, "Promise.all(window.__testPeers.map(pc=>pc.getStats())).then(all=>window."
                          "__rtpPackets=all.flatMap(s=>[...s.values()]).filter(s=>s.type==='"
                          "inbound-rtp').reduce((n,s)=>n+(s.packetsReceived||0),0))");
        QTRY_VERIFY_WITH_TIMEOUT(javascript(viewB, "window.__rtpPackets||0").toInt() > 0, 10000);
        int refreshed = 0;
        api->refresh([&](ApiResult result) {
            if (result.ok())
                refreshed++;
        });
        QTRY_COMPARE_WITH_TIMEOUT(refreshed, 1, 10000);
        QTest::qWait(2200);
        QVERIFY(a.active() && b.active());
        QVERIFY(failuresA.isEmpty());
        QVERIFY(failuresB.isEmpty());
        javascript(viewA, "document.querySelector('[aria-label=\"Завершить звонок\"]').click()");
        QTRY_VERIFY_WITH_TIMEOUT(!a.active() && !b.active(), 10000);
        QSignalSpy attachments(&a, &Calls::attachmentReady);
        a.record(true, config.value("chat").toInt());
        QTest::qWait(1500);
        a.record(false);
        QTRY_VERIFY_WITH_TIMEOUT(!attachments.isEmpty(), 15000);
        auto voice = attachments[0][0].toJsonObject();
        QVERIFY(voice.value("mime").toString().startsWith("audio/"));
        QVERIFY(voice.value("name").toString().startsWith("Голосовое-"));
        QCOMPARE(voice.value("native_chat_id"), config.value("chat"));
        a.start(QJsonObject{{"id", config.value("chat")}}, true);
        QTRY_VERIFY_WITH_TIMEOUT(b.active(), 20000);
        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(viewB, "!!document.querySelector('[aria-label=\"Принять звонок\"]')")
                .toBool(),
            10000);
        javascript(viewB, "document.querySelector('[aria-label=\"Принять звонок\"]').click()");
        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(
                viewA,
                "document.querySelector('.call-person [role=status]')?.textContent==='Разговор'")
                .toBool(),
            45000);
        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(viewB, "document.querySelector('video.call-video-remote')?.videoWidth>0")
                .toBool(),
            20000);
        QTRY_VERIFY_WITH_TIMEOUT(
            javascript(viewA, "document.querySelector('video.call-video-remote')?.videoWidth>0")
                .toBool(),
            20000);
        QTest::qWait(500);
        auto screenshot = qEnvironmentVariable("VOLNA_NATIVE_SCREENSHOTS");
        if (!screenshot.isEmpty())
            QVERIFY(a.grab().save(screenshot + "/call.png"));
        javascript(viewA, "document.querySelector('[aria-label=\"Завершить звонок\"]').click()");
        QTRY_VERIFY_WITH_TIMEOUT(!a.active() && !b.active(), 10000);
    }
    void restoredSession() {
#ifdef Q_OS_WIN
        Api restored(QUrl(config.value("url").toString()), dir.path());
        QSignalSpy changes(&restored, &Api::sessionChanged);
        restored.restore();
        QVERIFY(!changes.isEmpty());
        QTRY_VERIFY_WITH_TIMEOUT(!restored.busy(), 10000);
        QVERIFY(call(&restored, "/me").ok());
#else
        QVERIFY(!SessionStore::persistentAvailable());
#endif
    }
    void cleanupTestCase() {
        if (api)
            api->stopEvents();
        fixture.terminate();
        if (!fixture.waitForFinished(5000))
            fixture.kill();
    }
};
QTEST_MAIN(Integration)
#include "test_integration.moc"
