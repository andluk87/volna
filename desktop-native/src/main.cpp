#include "window.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QLocale>
#include <QLockFile>
#include <QMessageBox>
#include <QNetworkProxyFactory>
#include <QStandardPaths>
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
    parser.addOption({"server", "Volna HTTPS server origin", "origin", VOLNA_DEFAULT_SERVER});
    parser.process(app);
    QUrl origin(parser.value("server"));
    if (!Api::validOrigin(origin)) {
        QMessageBox::critical(nullptr, "Волна",
                              "Сервер должен быть HTTPS-адресом без пути, пароля и параметров. "
                              "HTTP доступен только для localhost при разработке");
        return 2;
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
