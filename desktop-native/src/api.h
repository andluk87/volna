#pragma once
#include "session_store.h"
#include "sse.h"
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonValue>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QPointer>
#include <QTimer>
#include <functional>
struct ApiResult {
    int status = 0;
    QJsonValue value;
    QByteArray bytes;
    QString error;
    QString networkDetail;
    qint64 retryMs = 0;
    bool ok() const {
        return status >= 200 && status < 300 && error.isEmpty();
    }
};
using ApiCallback = std::function<void(ApiResult)>;
class Api : public QObject {
    Q_OBJECT
  public:
    explicit Api(QUrl origin, QString storeDirectory = {}, QObject *parent = nullptr);
    static bool validOrigin(const QUrl &url);
    static QString nonce(int bytes = 32);
    const QUrl &origin() const {
        return _origin;
    }
    QJsonObject session() const {
        return _session;
    }
    QString token() const {
        return _session.value("token").toString();
    }
    bool busy() const {
        return _refreshing || _unsaved;
    }
    QNetworkRequest networkRequest(const QString &path, bool authorized = true) const;
    QNetworkAccessManager *network() {
        return &_network;
    }
    QJsonArray diagnostics() const;
    QString networkMode() const { return _networkMode; }
    void setNetworkMode(QString mode);
    void probeHealth(ApiCallback callback);
    void request(QString path, QJsonValue data, ApiCallback callback, bool authorized = true,
                 QByteArray method = {});
    void upload(const QString &file, ApiCallback callback);
    void download(const QString &id, qint64 message, ApiCallback callback);
    bool acceptSession(QJsonObject session);
    void restore();
    void refresh(ApiCallback callback, QString failedToken = {});
    void logout(ApiCallback callback);
    void retrySave();
    void startEvents();
    void stopEvents();
  signals:
    void sessionChanged(QJsonObject session);
    void sessionInvalid();
    void problem(QString message);
    void eventReceived(QJsonObject event);
    void connectionChanged(bool online);

  private:
    void send(QString path, QJsonValue data, ApiCallback callback, bool authorized,
              QByteArray method, int attempt, int transportAttempt = 0, bool http1 = false);
    void trackReply(QString path, QByteArray method, QNetworkReply *reply);
    QJsonObject describeReply(QNetworkReply *reply, bool pending) const;
    void scheduleRefresh();
    QUrl _origin;
    QNetworkAccessManager _network, _eventNetwork;
    QJsonArray _diagnostics;
    QList<QPointer<QNetworkReply>> _activeReplies;
    QString _networkMode;
    bool _preferHttp1 = false;
    SessionStore _store;
    QJsonObject _session;
    bool _refreshing = false, _unsaved = false, _eventsWanted = false, _streamConnected = false;
    QList<ApiCallback> _refreshWaiters;
    QTimer _refreshTimer, _eventRetry;
    QPointer<QNetworkReply> _events;
    SseParser _parser;
    int _eventBackoff = 1000;
};
