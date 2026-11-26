#pragma once
#include "api.h"
#include <QDialog>
#include <QWebEngineView>
class CallBridge : public QObject {
    Q_OBJECT
  public:
    explicit CallBridge(Api *api, QObject *parent = nullptr) : QObject(parent), api(api) {}
    bool active = false, ready = false;
    Api *api;
    Q_INVOKABLE QVariantMap session() const;
    Q_INVOKABLE void loaded();
    Q_INVOKABLE void minimize() {
        emit minimized();
    }
    Q_INVOKABLE void recording(bool active) {
        emit recordingChanged(active);
    }
    Q_INVOKABLE void state(QVariantMap value);
    Q_INVOKABLE void failed(QString message);
    Q_INVOKABLE void refresh(QString id, QString failedToken);
    Q_INVOKABLE void voiceUploaded(QVariantMap attachment);
  signals:
    void sessionUpdated(QVariantMap session);
    void command(QString action, QVariantMap value);
    void refreshFinished(QString id, int status, QVariantMap session);
    void activityChanged(bool active, bool incoming);
    void engineReady();
    void minimized();
    void recordingChanged(bool active);
    void problem(QString message);
    void attachmentReady(QJsonObject attachment);
};
class Calls : public QDialog {
    Q_OBJECT
  public:
    explicit Calls(Api *api, QWidget *parent = nullptr);
    bool active() const {
        return _bridge->active;
    }
    bool ready() const {
        return _bridge->ready;
    }
    void start(QJsonObject chat, bool video);
    void media(QByteArray bytes, QString mime);
    void record(bool start, qint64 chat = 0);
    void dispatch(QJsonObject event);
  signals:
    void problem(QString message);
    void attachmentReady(QJsonObject attachment);

  protected:
    void closeEvent(QCloseEvent *event) override;

  private:
    Api *_api;
    CallBridge *_bridge;
    QWebEngineView *_view;
};
