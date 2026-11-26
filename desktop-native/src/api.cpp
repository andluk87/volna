#include "api.h"
#include "network_error.h"
#include <QDateTime>
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
               QByteArray method, int attempt) {
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
    auto sentToken = token();
    auto reply = _network.sendCustomRequest(request, method, bytes);
    connect(reply, &QNetworkReply::finished, this, [=, this] {
        auto result = readResult(reply);
        reply->deleteLater();
        if (authorized && result.status == 401 && attempt == 0) {
            refresh(
                [=, this](ApiResult renewed) {
                    if (renewed.ok())
                        send(path, data, callback, true, method, 1);
                    else
                        callback(renewed);
                },
                sentToken);
            return;
        }
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
    auto reply = _network.get(request);
    _events = reply;
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
