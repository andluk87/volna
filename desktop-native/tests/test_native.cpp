#include "api.h"
#include "session_store.h"
#include "sse.h"
#include "theme.h"
#include "widgets.h"
#include <QFile>
#include <QNetworkProxy>
#include <QTemporaryDir>
#include <QtTest>
class NativeTests : public QObject {
    Q_OBJECT
  private slots:
    void composerKeyboard() {
        ComposerEdit editor;
        editor.show();
        QSignalSpy sends(&editor, &ComposerEdit::sendPressed);
        QTest::keyClicks(&editor, "first");
        QTest::keyClick(&editor, Qt::Key_Return, Qt::ShiftModifier);
        QTest::keyClicks(&editor, "second");
        QCOMPARE(editor.toPlainText(), QString("first\nsecond"));
        QCOMPARE(sends.count(), 0);
        QTest::keyClick(&editor, Qt::Key_Return);
        QCOMPARE(sends.count(), 1);
        QCOMPARE(editor.toPlainText(), QString("first\nsecond"));
    }
    void networkMode() {
        Api api(QUrl("https://example.com"));
        api.setNetworkMode("direct");
        QCOMPARE(api.network()->proxy().type(), QNetworkProxy::NoProxy);
        api.setNetworkMode("system");
        QCOMPARE(api.network()->proxy().type(), QNetworkProxy::DefaultProxy);
        api.setNetworkMode("unknown");
        QCOMPARE(api.networkMode(), QString("direct"));
        QCOMPARE(api.network()->proxy().type(), QNetworkProxy::NoProxy);
    }
    void origins() {
        QVERIFY(Api::validOrigin(QUrl("https://volna.lknet.ru")));
        QVERIFY(Api::validOrigin(QUrl("http://127.0.0.1:3210")));
        QVERIFY(!Api::validOrigin(QUrl("http://volna.lknet.ru")));
        QVERIFY(!Api::validOrigin(QUrl("https://user:pass@volna.lknet.ru")));
        QVERIFY(!Api::validOrigin(QUrl("https://volna.lknet.ru/path")));
        QVERIFY(!Api::validOrigin(QUrl("https://volna.lknet.ru?token=x")));
    }
    void nonce() {
        auto a = Api::nonce(), b = Api::nonce();
        QCOMPARE(a.size(), 43);
        QVERIFY(a != b);
        QVERIFY(QRegularExpression("^[A-Za-z0-9_-]{43}$").match(a).hasMatch());
    }
    void events() {
        SseParser parser;
        QVERIFY(parser.append(": heartbeat\r\ndata: {\"type\":\"mess").isEmpty());
        auto result =
            parser.append("age\",\"text\":\"Привет 👋\"}\r\n\r\ndata: {\"type\":\"read\"}\n\n");
        QCOMPARE(result.size(), 2);
        QCOMPARE(result[0].value("text").toString(), QString("Привет 👋"));
        QCOMPARE(result[1].value("type").toString(), QString("read"));
    }
    void multilineEvents() {
        SseParser parser;
        auto result = parser.append("data: {\n"
                                    "data: \"type\": \"chats\"}\n\n");
        QCOMPARE(result.size(), 1);
        QVERIFY(parser.append("data: not json\n\n").isEmpty());
        parser.append("data: {\"wrong\":");
        parser.clear();
        QVERIFY(parser.append("1}\n\n").isEmpty());
    }
    void oversizedEvents() {
        SseParser parser;
        QVERIFY(parser.append(QByteArray(1024 * 1024 + 1, 'a')).isEmpty());
        QCOMPARE(parser.append("data: {\"type\":\"read\"}\n\n").size(), 1);
    }
    void upstreamThemes() {
        auto theme = Theme::load(true);
        QCOMPARE(theme.color("windowBg"), QColor("#17212b"));
        QVERIFY(theme.values.size() > 100);
        QVERIFY(theme.color("msgInBg").isValid());
        QCOMPARE(theme.color("missing", Qt::red), QColor(Qt::red));
        QVERIFY(Theme::load(false).color("windowBg") != theme.color("windowBg"));
    }
    void qr() {
        auto image = loginQr("volna://login/test-native-qr");
        QVERIFY(!image.isNull());
        QCOMPARE(image.pixelColor(0, 0), QColor(Qt::white));
        QVERIFY(loginQr(QString(1001, 'x')).isNull());
    }
    void store() {
        QTemporaryDir directory;
        SessionStore store("https://volna.lknet.ru", directory.path());
        QJsonObject session{{"token", Api::nonce()},
                            {"refresh_token", Api::nonce()},
                            {"user", QJsonObject{{"id", 17}}}};
        QString error;
        QVERIFY(store.save(session, &error));
#ifdef Q_OS_WIN
        QCOMPARE(store.load(), session);
        QFile file(directory.filePath("native-session.bin"));
        QVERIFY(file.open(QIODevice::ReadOnly));
        auto bytes = file.readAll();
        QVERIFY(bytes.startsWith("VLND1"));
        QVERIFY(!bytes.contains(session.value("refresh_token").toString().toUtf8()));
        file.close();
        SessionStore wrongServer("https://other.example", directory.path());
        QVERIFY(wrongServer.load().isEmpty());
#else
        QVERIFY(!QFile::exists(directory.filePath("native-session.bin")));
        QVERIFY(!SessionStore::persistentAvailable());
#endif
        QVERIFY(store.clear());
        QVERIFY(store.load().isEmpty());
    }
};
QTEST_MAIN(NativeTests)
#include "test_native.moc"
