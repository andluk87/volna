#include "api.h"
#include "network_error.h"
#include <QDateTime>
#include <QElapsedTimer>
#include <QNetworkProxy>
#include <QSettings>
#include <QSslConfiguration>
#include <QSslCipher>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMetaEnum>
#include <QMimeDatabase>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QUrlQuery>
#include <algorithm>
#include <utility>
Api::Api(QUrl origin, QString directory, QObject *parent)
    : QObject(parent), _origin(origin), _store(origin.toString(), directory) {
    setNetworkMode(QSettings().value("network/mode", "direct").toString());
    _origin.setPath({});
    _origin.setQuery(QString());
    _origin.setFragment({});
    _refreshTimer.setSingleShot(true);
    connect(&_refreshTimer, &QTimer::timeout, this, [this] { refresh([](ApiResult) {}); });
    _eventRetry.setSingleShot(true);
    connect(&_eventRetry, &QTimer::timeout, this, &Api::startEvents);
}
bool Api::validOrigin(const QUrl &url) {
    return url.isValid() && !url.host().isEmpty() && url.userInfo().isEmpty() &&
           url.query().isEmpty() && url.fragment().isEmpty() &&
           (url.path().isEmpty() || url.path() == "/") &&
           (url.scheme() == "https" ||
            (url.scheme() == "http" &&
             (url.host() == "localhost" || url.host() == "127.0.0.1" || url.host() == "::1")));
}
QString Api::nonce(int bytes) {
    QByteArray data(bytes, 0);
    for (int i = 0; i < bytes; ++i)
        data[i] = char(QRandomGenerator::system()->generate() & 255);
    return QString::fromLatin1(
        data.toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals));
}
QNetworkRequest Api::networkRequest(const QString &path, bool authorized) const {
    QNetworkRequest request(_origin.resolved(QUrl("/api" + path)));
    request.setRawHeader("User-Agent", "VolnaNativeDesktop/" VOLNA_NATIVE_VERSION " Windows Qt");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(20000);
    request.setAttribute(QNetworkRequest::Http2AllowedAttribute, !_preferHttp1);
    if (authorized && !token().isEmpty())
        request.setRawHeader("Authorization", "Bearer " + token().toLatin1());
    return request;
}
static ApiResult readResult(QNetworkReply *reply) {
    ApiResult result;
    result.status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    result.bytes = reply->readAll();
    auto json = QJsonDocument::fromJson(result.bytes);
    result.value = json.isArray() ? QJsonValue(json.array()) : QJsonValue(json.object());
    if (result.status == 429) {
        auto object = result.value.toObject();
        result.retryMs =
            std::max(qint64(1000), object.value("retry_at").toVariant().toLongLong() -
                                       object.value("server_time").toVariant().toLongLong());
        bool valid = false;
        auto seconds = reply->rawHeader("Retry-After").toLongLong(&valid);
        if (valid)
            result.retryMs = std::max(result.retryMs, seconds * 1000);
    }
    if (result.status < 200 || result.status >= 300)
        result.error = result.value.toObject().value("error").toString(
            result.status ? QString("Ошибка сервера (%1)").arg(result.status)
                          : nativeNetworkError(reply->error()));
    else if (reply->error() != QNetworkReply::NoError)
        result.error = "Передача прервана. Повторите запрос";
    if (reply->error() != QNetworkReply::NoError) {
        result.networkDetail =
            QString::fromLatin1(
                QMetaEnum::fromType<QNetworkReply::NetworkError>().valueToKey(reply->error())) +
            ": " + reply->errorString();
        if (!result.status)
            result.error +=
                " (" +
                QString::fromLatin1(
                    QMetaEnum::fromType<QNetworkReply::NetworkError>().valueToKey(reply->error())) +
                ")";
    }
    return result;
}
void Api::request(QString path, QJsonValue data, ApiCallback callback, bool authorized,
                  QByteArray method) {
    send(path, data, std::move(callback), authorized, method, 0);
}
void Api::send(QString path, QJsonValue data, ApiCallback callback, bool authorized,
               QByteArray method, int attempt, int transportAttempt, bool http1) {
    if (authorized && token().isEmpty()) {
        callback({401, {}, {}, "Войдите в аккаунт"});
        return;
    }
    auto request = networkRequest(path, authorized);
    if (method.isEmpty())
        method = data.isUndefined() ? "GET" : "POST";
    QByteArray bytes;
    if (!data.isUndefined()) {
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        bytes = data.isObject() ? QJsonDocument(data.toObject()).toJson(QJsonDocument::Compact)
                                : QJsonDocument(data.toArray()).toJson(QJsonDocument::Compact);
    }
    if (http1)
        request.setAttribute(QNetworkRequest::Http2AllowedAttribute, false);
    auto sentToken = token();
    auto owner = _session.value("user").toObject().value("id");
    auto reply = method == "GET" && bytes.isEmpty()
                     ? _network.get(request)
                     : _network.sendCustomRequest(request, method, bytes);
    trackReply(path, method, reply);
    connect(reply, &QNetworkReply::finished, this, [=, this] {
        auto result = readResult(reply);
        auto code = reply->error();
        reply->deleteLater();
        bool transient = code == QNetworkReply::TimeoutError ||
                         code == QNetworkReply::RemoteHostClosedError ||
                         code == QNetworkReply::TemporaryNetworkFailureError ||
                         code == QNetworkReply::NetworkSessionFailedError ||
                         code == QNetworkReply::ProtocolFailure ||
                         code == QNetworkReply::UnknownNetworkError;
        if (method == "GET" && transportAttempt == 0 &&
            (transient || result.status == 502 || result.status == 503 || result.status == 504)) {
            QTimer::singleShot(750, this, [=, this] {
                if (authorized && owner != _session.value("user").toObject().value("id")) {
                    callback({401, {}, {}, "Сеанс изменился. Запрос отменён"});
                    return;
                }
                send(path, data, callback, authorized, method, attempt, 1, true);
            });
            return;
        }
        if (http1 && result.status > 0)
            _preferHttp1 = true;
        if (authorized && result.status == 401 && attempt == 0) {
            refresh(
                [=, this](ApiResult renewed) {
                    if (renewed.ok())
                        send(path, data, callback, true, method, 1, transportAttempt, http1);
                    else
                        callback(renewed);
                },
                sentToken);
            return;
        }
        callback(result);
    });
}
void Api::setNetworkMode(QString mode) {
    _networkMode = mode == "system" ? "system" : "direct";
    auto proxy = QNetworkProxy(_networkMode == "direct" ? QNetworkProxy::NoProxy
                                                       : QNetworkProxy::DefaultProxy);
    _network.setProxy(proxy);
    _eventNetwork.setProxy(proxy);
}
void Api::trackReply(QString path, QByteArray method, QNetworkReply *reply) {
    auto clock = std::make_shared<QElapsedTimer>();
    clock->start();
    reply->setProperty("trace_path", path.section('?', 0, 0));
    reply->setProperty("trace_method", QString::fromLatin1(method));
    reply->setProperty("trace_mode", _networkMode);
    reply->setProperty("trace_started", QDateTime::currentMSecsSinceEpoch());
    for (auto key : {"connecting_ms", "encrypted_ms", "sent_ms", "headers_ms"})
        reply->setProperty(key, qint64(-1));
    auto mark = [reply, clock](const char *key) {
        if (reply->property(key).toLongLong() < 0)
            reply->setProperty(key, clock->elapsed());
    };
    connect(reply, &QNetworkReply::socketStartedConnecting, reply, [mark] { mark("connecting_ms"); });
    connect(reply, &QNetworkReply::encrypted, reply, [mark] { mark("encrypted_ms"); });
    connect(reply, &QNetworkReply::requestSent, reply, [mark] { mark("sent_ms"); });
    connect(reply, &QNetworkReply::metaDataChanged, reply, [mark] { mark("headers_ms"); });
    connect(reply, &QNetworkReply::sslErrors, reply, [reply](const QList<QSslError> &errors) {
        QVariantList codes;
        for (const auto &error : errors)
            codes.append(int(error.error()));
        reply->setProperty("ssl_error_codes", codes);
    });
    connect(reply, &QNetworkReply::downloadProgress, reply, [reply](qint64 received, qint64) {
        reply->setProperty("received_bytes", received);
    });
    _activeReplies.removeIf([](auto value) { return value.isNull(); });
    _activeReplies.append(QPointer<QNetworkReply>(reply));
    connect(reply, &QNetworkReply::finished, this, [this, reply, clock] {
        reply->setProperty("elapsed_ms", clock->elapsed());
        _diagnostics.append(describeReply(reply, false));
        _activeReplies.removeAll(QPointer<QNetworkReply>(reply));
        while (_diagnostics.size() > 40)
            _diagnostics.removeFirst();
    });
}
QJsonObject Api::describeReply(QNetworkReply *reply, bool pending) const {
    // Retain no query strings, bodies, certificates, credentials or headers.
    auto ssl = reply->sslConfiguration();
    QJsonObject result{
        {"time", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
        {"path", reply->property("trace_path").toString()},
        {"method", reply->property("trace_method").toString()},
        {"mode", reply->property("trace_mode").toString()},
        {"pending", pending},
        {"elapsed_ms", pending ? QDateTime::currentMSecsSinceEpoch() - reply->property("trace_started").toLongLong()
                                : reply->property("elapsed_ms").toLongLong()},
        {"status", reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt()},
        {"http2", reply->attribute(QNetworkRequest::Http2WasUsedAttribute).toBool()},
        {"http2_allowed", reply->request().attribute(QNetworkRequest::Http2AllowedAttribute).toBool()},
        {"cipher", ssl.sessionCipher().name()},
        {"tls_protocol", int(ssl.sessionProtocol())},
        {"ssl_error_codes", QJsonArray::fromVariantList(reply->property("ssl_error_codes").toList())},
        {"received_bytes", reply->property("received_bytes").toLongLong()},
        {"network_error", QString::fromLatin1(QMetaEnum::fromType<QNetworkReply::NetworkError>().valueToKey(reply->error()))}};
    for (auto key : {"connecting_ms", "encrypted_ms", "sent_ms", "headers_ms"})
        result.insert(key, reply->property(key).toLongLong());
    return result;
}
QJsonArray Api::diagnostics() const {
    auto result = _diagnostics;
    for (auto reply : _activeReplies)
        if (reply)
            result.append(describeReply(reply, true));
    return result;
}
void Api::probeHealth(ApiCallback callback) {
    auto request = networkRequest("/health", false);
    request.setTransferTimeout(7000);
    auto reply = _network.get(request);
    trackReply("/health", "GET", reply);
    connect(reply, &QNetworkReply::finished, this, [reply, callback] {
        auto result = readResult(reply);
        reply->deleteLater();
        callback(result);
    });
}
bool Api::acceptSession(QJsonObject session) {
    if (session.value("token").toString().size() != 43 ||
        session.value("refresh_token").toString().size() != 43 ||
        session.value("user").toObject().value("id").toInt() < 1) {
        emit problem("Некорректный ответ авторизации");
        return false;
    }
    _session = session;
    QString error;
    _unsaved = !_store.save(_session, &error);
    if (_unsaved) {
        emit problem(error);
        QTimer::singleShot(5000, this, &Api::retrySave);
    }
    scheduleRefresh();
    emit sessionChanged(_session);
    return true;
}
void Api::retrySave() {
    if (!_unsaved)
        return;
    QString error;
    _unsaved = !_store.save(_session, &error);
    if (_unsaved) {
        emit problem(error);
        QTimer::singleShot(5000, this, &Api::retrySave);
    }
}
void Api::restore() {
    QString error;
    auto saved = _store.load(&error);
    if (!error.isEmpty())
        emit problem(error);
    if (saved.isEmpty())
        return;
    if (saved.value("token").toString().size() != 43 ||
        saved.value("refresh_token").toString().size() != 43 ||
        saved.value("user").toObject().value("id").toInt() < 1) {
        emit problem("Сохранённый сеанс повреждён. Войдите заново");
        return;
    }
    _session = saved;
    emit sessionChanged(_session); // Keep the signed-in shell during a transient outage.
    refresh([](ApiResult) {});
}
void Api::scheduleRefresh() {
    auto delay = _session.value("expires").toVariant().toLongLong() -
                 QDateTime::currentMSecsSinceEpoch() - 60000;
    _refreshTimer.start(int(std::clamp(delay, qint64(1000), qint64(3540000))));
}
void Api::refresh(ApiCallback callback, QString failedToken) {
    if (!failedToken.isEmpty() && failedToken != token()) {
        callback({200, _session, {}, {}});
        return;
    }
    _refreshWaiters.append(std::move(callback));
    if (_refreshing)
        return;
    _refreshing = true;
    request(
        "/auth/refresh", QJsonObject{{"refresh_token", _session.value("refresh_token")}},
        [this](ApiResult result) {
            if (result.ok()) {
                if (!acceptSession(result.value.toObject()))
                    result = {500, {}, {}, "Не удалось принять обновлённый сеанс"};
                else {
                    result.value = _session;
                    if (_eventsWanted) {
                        stopEvents();
                        startEvents();
                    }
                }
            } else if (result.status == 401) {
                stopEvents();
                _refreshTimer.stop();
                _session = {};
                QString error;
                _store.clear(&error);
                emit sessionInvalid();
            } else {
                _refreshTimer.start(int(std::max(qint64(5000), result.retryMs)));
                emit problem(result.error);
            }
            _refreshing = false;
            const auto waiters = std::exchange(_refreshWaiters, {});
            for (auto &notify : waiters)
                notify(result);
        },
        false);
}
void Api::logout(ApiCallback callback) {
    if (busy()) {
        callback({409, {}, {}, "Дождитесь сохранения сеанса"});
        return;
    }
    request("/logout", QJsonObject{}, [this, callback](ApiResult result) {
        if (result.ok()) {
            QString error;
            if (!_store.clear(&error)) {
                emit problem(error);
                callback({500, {}, {}, error});
                return;
            }
            stopEvents();
            _refreshTimer.stop();
            _session = {};
            emit sessionInvalid();
        }
        callback(result);
    });
}
void Api::upload(const QString &file, ApiCallback callback) {
    auto input = new QFile(file, this);
    if (!input->open(QIODevice::ReadOnly) || input->size() > 20 * 1024 * 1024) {
        input->deleteLater();
        callback({400, {}, {}, "Выберите файл размером до 20 МБ"});
        return;
    }
    auto request = networkRequest("/uploads");
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                      QMimeDatabase().mimeTypeForFile(file).name());
    request.setRawHeader("X-File-Name", QUrl::toPercentEncoding(QFileInfo(file).fileName()));
    auto reply = _network.post(request, input);
    trackReply("/uploads", "POST", reply);
    connect(reply, &QNetworkReply::finished, this, [=] {
        auto result = readResult(reply);
        reply->deleteLater();
        input->deleteLater();
        callback(result);
    });
}
void Api::download(const QString &id, qint64 message, ApiCallback callback) {
    if (!QRegularExpression("^[a-f0-9]{48}$").match(id).hasMatch()) {
        callback({400, {}, {}, "Некорректный файл"});
        return;
    }
    request("/files/" + id + "?message_id=" + QString::number(message), QJsonValue::Undefined,
            std::move(callback));
}
void Api::stopEvents() {
    _eventsWanted = false;
    _eventRetry.stop();
    if (_events) {
        auto reply = _events.data();
        _events = nullptr;
        reply->disconnect(this);
        reply->abort();
        reply->deleteLater();
    }
    _parser.clear();
    _streamConnected = false;
}
void Api::startEvents() {
    _eventsWanted = true;
    if (_events || token().isEmpty())
        return;
    auto request = networkRequest("/events");
    request.setTransferTimeout(0);
    request.setRawHeader("Accept", "text/event-stream");
    auto reply = _eventNetwork.get(request);
    trackReply("/events", "GET", reply);
    _events = reply;
    auto watchdog = new QTimer(reply);
    watchdog->setSingleShot(true);
    watchdog->start(30000);
    connect(watchdog, &QTimer::timeout, reply, &QNetworkReply::abort);
    connect(reply, &QNetworkReply::readyRead, watchdog, [watchdog] { watchdog->start(65000); });
    _parser.clear();
    auto sentToken = token();
    connect(reply, &QNetworkReply::readyRead, this, [this, reply] {
        if (reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() != 200)
            return;
        _eventBackoff = 1000;
        if (!_streamConnected) {
            _streamConnected = true;
            emit connectionChanged(true);
        }
        for (const auto &event : _parser.append(reply->readAll()))
            emit eventReceived(event);
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply, sentToken] {
        auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        reply->deleteLater();
        if (_events == reply)
            _events = nullptr;
        _streamConnected = false;
        emit connectionChanged(false);
        if (!_eventsWanted)
            return;
        if (status == 401) {
            refresh(
                [this](ApiResult result) {
                    if (result.ok() && _eventsWanted)
                        startEvents();
                },
                sentToken);
            return;
        }
        auto delay = _eventBackoff;
        if (status == 429) {
            bool valid = false;
            auto seconds = reply->rawHeader("Retry-After").toLongLong(&valid);
            delay = valid ? int(std::min(qint64(300000), seconds * 1000)) : 60000;
        }
        _eventRetry.start(delay);
        _eventBackoff = std::min(_eventBackoff * 2, 30000);
    });
}
