#pragma once
#include <QJsonObject>
#include <QString>
class SessionStore {
  public:
    explicit SessionStore(QString origin, QString directory = {});
    QJsonObject load(QString *error = nullptr) const;
    bool save(const QJsonObject &session, QString *error = nullptr) const;
    bool clear(QString *error = nullptr) const;
    static bool persistentAvailable();

  private:
    QString _file;
    QByteArray _entropy;
};
