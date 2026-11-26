#include "network_error.h"
QString nativeNetworkError(QNetworkReply::NetworkError code) {
    switch (code) {
    case QNetworkReply::HostNotFoundError:
        return "Не удалось найти сервер (DNS). Проверьте подключение или настройки DNS";
    case QNetworkReply::SslHandshakeFailedError:
        return "Не удалось установить защищённое соединение TLS. Проверьте дату Windows и "
               "сертификаты";
    case QNetworkReply::TimeoutError:
    case QNetworkReply::OperationCanceledError:
        return "Сервер не ответил вовремя. Повторите подключение";
    case QNetworkReply::ProxyConnectionRefusedError:
    case QNetworkReply::ProxyConnectionClosedError:
    case QNetworkReply::ProxyNotFoundError:
    case QNetworkReply::ProxyTimeoutError:
    case QNetworkReply::ProxyAuthenticationRequiredError:
        return "Не удалось подключиться через системный прокси. Проверьте настройки подключения";
    case QNetworkReply::ConnectionRefusedError:
        return "Сервер отклонил соединение";
    default:
        return "Не удалось подключиться к серверу";
    }
}
