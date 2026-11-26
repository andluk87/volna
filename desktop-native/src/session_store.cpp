#include "session_store.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QSaveFile>
#include <QStandardPaths>
#ifdef Q_OS_WIN
#define NOMINMAX
#include <QtCore/qt_windows.h>
#include <wincrypt.h>
#endif
SessionStore::SessionStore(QString origin, QString directory) {
    if (directory.isEmpty())
        directory = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    _file = directory + "/native-session.bin";
    _entropy = QCryptographicHash::hash(("VolnaNativeDesktop/session/v1:" + origin).toUtf8(),
                                        QCryptographicHash::Sha256);
}
bool SessionStore::persistentAvailable() {
#ifdef Q_OS_WIN
    return true;
#else
    return false; // Development builds never fall back to plaintext credentials.
#endif
}
QJsonObject SessionStore::load(QString *error) const {
    QFile file(_file);
    if (!file.exists())
        return {};
    if (!file.open(QIODevice::ReadOnly) || file.size() > 65536) {
        if (error)
            *error = "Не удалось прочитать защищённый сеанс";
        return {};
    }
#ifdef Q_OS_WIN
    auto data = file.readAll();
    if (!data.startsWith("VLND1")) {
        if (error)
            *error = "Неизвестный формат сеанса";
        return {};
    }
    data.remove(0, 5);
    DATA_BLOB input{DWORD(data.size()), reinterpret_cast<BYTE *>(data.data())},
        entropy{DWORD(_entropy.size()),
                reinterpret_cast<BYTE *>(const_cast<char *>(_entropy.data()))},
        output{};
    if (!CryptUnprotectData(&input, nullptr, &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN,
                            &output)) {
        if (error)
            *error = "Windows не смогла расшифровать сеанс этого пользователя";
        return {};
    }
    auto json =
        QJsonDocument::fromJson(QByteArray(reinterpret_cast<char *>(output.pbData), output.cbData))
            .object();
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return json;
#else
    if (error)
        *error = "Защищённое сохранение сеанса доступно в Windows";
    return {};
#endif
}
bool SessionStore::save(const QJsonObject &session, QString *error) const {
#ifdef Q_OS_WIN
    auto data = QJsonDocument(session).toJson(QJsonDocument::Compact);
    DATA_BLOB input{DWORD(data.size()), reinterpret_cast<BYTE *>(data.data())},
        entropy{DWORD(_entropy.size()),
                reinterpret_cast<BYTE *>(const_cast<char *>(_entropy.data()))},
        output{};
    if (!CryptProtectData(&input, L"Volna native desktop", &entropy, nullptr, nullptr,
                          CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        if (error)
            *error = "Не удалось защитить сеанс средствами Windows";
        return false;
    }
    QByteArray encrypted("VLND1");
    encrypted.append(reinterpret_cast<char *>(output.pbData), output.cbData);
    LocalFree(output.pbData);
    data.fill(0);
    if (!QDir().mkpath(QFileInfo(_file).absolutePath())) {
        if (error)
            *error = "Не удалось создать каталог сеанса";
        return false;
    }
    QSaveFile file(_file);
    file.setDirectWriteFallback(false);
    if (!file.open(QIODevice::WriteOnly) || file.write(encrypted) != encrypted.size() ||
        !file.commit()) {
        if (error)
            *error = "Не удалось сохранить защищённый сеанс; не закрывайте приложение";
        return false;
    }
    QFile::setPermissions(_file, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    return true;
#else
    Q_UNUSED(session);
    Q_UNUSED(error);
    return true; // Explicit memory-only development session.
#endif
}
bool SessionStore::clear(QString *error) const {
    if (!QFile::exists(_file) || QFile::remove(_file))
        return true;
    if (error)
        *error = "Не удалось удалить сохранённый сеанс";
    return false;
}
