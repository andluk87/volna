#include "window.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLocale>
#include <QLockFile>
#include <QMessageBox>
#include <QNetworkProxyFactory>
#include <QSslSocket>
#include <QStandardPaths>
#include <QTimer>
int main(int argc, char **argv) {
    QApplication app(argc, argv);
    QLocale::setDefault(QLocale(QLocale::Russian, QLocale::Russia));
    app.setOrganizationName("Volna");
    app.setApplicationName("VolnaNativeDesktop");
    app.setApplicationVersion(VOLNA_NATIVE_VERSION);
    app.setQuitOnLastWindowClosed(false);
    QNetworkProxyFactory::setUseSystemConfiguration(true);
    QCommandLineParser parser;
    parser.setApplicationDescription("Volna native desktop · Qt/C++");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOption(
        {"verify-runtime", "Verify bundled runtime and exit without opening a window"});
    parser.addOption({"check-network", "Probe HTTPS health and QR without signing in"});
    parser.addOption({"network-report", "Write safe connection probe JSON", "file"});
    parser.addOption({"server", "Volna HTTPS server origin", "origin", VOLNA_DEFAULT_SERVER});
    parser.process(app);
    if (parser.isSet("verify-runtime"))
        return 0;
    QUrl origin(parser.value("server"));
    if (!Api::validOrigin(origin)) {
        QMessageBox::critical(nullptr, "Волна",
                              "Сервер должен быть HTTPS-адресом без пути, пароля и параметров. "
                              "HTTP доступен только для localhost при разработке");
        return 2;
    }
    if (parser.isSet("check-network")) {
        Api probe(origin);
        QJsonArray requests;
        QEventLoop loop;
        auto add = [&](QString operation, ApiResult value) {
            requests.append(QJsonObject{{"operation", operation},
                                        {"status", value.status},
                                        {"error", value.error},
                                        {"network_detail", value.networkDetail}});
        };
        probe.request(
            "/health", QJsonValue::Undefined,
            [&](ApiResult health) {
                add("health", health);
                probe.request(
                    "/auth/qr/request", QJsonObject{{"platform", "windows"}},
                    [&](ApiResult qr) {
                        add("qr-request", qr);
                        loop.quit();
                    },
                    false);
            },
            false);
        QTimer::singleShot(45000, &loop, &QEventLoop::quit);
        loop.exec();
        QJsonObject report{
            {"version", VOLNA_NATIVE_VERSION},
            {"qt", qVersion()},
            {"origin", origin.toString()},
            {"tls_available", QSslSocket::supportsSsl()},
            {"tls_backend", QSslSocket::activeBackend()},
            {"tls_backends", QJsonArray::fromStringList(QSslSocket::availableBackends())},
            {"requests", requests}};
        QFile file(parser.value("network-report"));
        if (!file.open(QIODevice::WriteOnly))
            return 3;
        file.write(QJsonDocument(report).toJson());
        file.close();
        return requests.size() == 2 && requests[0].toObject().value("status").toInt() == 200 &&
                       requests[1].toObject().value("status").toInt() == 200
                   ? 0
                   : 4;
    }
    auto directory = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    QDir().mkpath(directory);
    QLockFile lock(directory + "/native.lock");
    lock.setStaleLockTime(0);
    if (!lock.tryLock(0)) {
        QMessageBox::information(nullptr, "Волна", "Нативный клиент уже открыт");
        return 0;
    }
    Api api(origin);
    Window window(&api);
    QObject::connect(&app, &QApplication::lastWindowClosed, &app, [&] {
        if (!window.isVisible())
            app.quit();
    });
    window.show();
    return app.exec();
}
