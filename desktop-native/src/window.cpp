#include "window.h"
#include "chat_delegate.h"
#include "image_viewer.h"
#include <QApplication>
#include <QCheckBox>
#include <QClipboard>
#include <QCloseEvent>
#include <QDateTime>
#include <QDialogButtonBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QJsonArray>
#include <QLocale>
#include <QMenu>
#include <QMessageBox>
#include <QRegularExpression>
#include <QSaveFile>
#include <QScrollBar>
#include <QSettings>
#include <QSplitter>
#include <QStatusBar>
#include <QUuid>
#include <QVBoxLayout>
static QJsonValue noData() {
    return QJsonValue::Undefined;
}
static QString when(QString text) {
    auto time = QDateTime::fromString(text, Qt::ISODate);
    return time.isValid() ? time.toLocalTime().toString("HH:mm") : QString();
}
Window::Window(Api *api, QWidget *parent) : QMainWindow(parent), _api(api) {
    setObjectName("volnaWindow");
    setWindowTitle("Волна Desktop");
    setWindowIcon(QIcon(":/volna/icon.png"));
    resize(1180, 780);
    setMinimumSize(720, 540);
    _theme = Theme::load(QSettings().value("dark", true).toBool());
    _theme.apply(*qApp);
    _avatars = new AvatarStore(api, this);
    auto container = new QWidget;
    auto layout = new QVBoxLayout(container);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    _errorFrame = new QWidget;
    _errorFrame->setObjectName("errorBanner");
    auto alert = new QHBoxLayout(_errorFrame);
    alert->setContentsMargins(16, 7, 8, 7);
    _error = label({}, "error");
    alert->addWidget(_error, 1);
    auto dismiss = button("×", "dismissError");
    dismiss->setFixedSize(28, 28);
    alert->addWidget(dismiss);
    connect(dismiss, &QPushButton::clicked, this, [this] { error({}); });
    _error->setTextInteractionFlags(Qt::TextSelectableByMouse);
    _errorFrame->hide();
    layout->addWidget(_errorFrame);
    _root = new QStackedWidget;
    _root->addWidget(login());
    _root->addWidget(messenger());
    layout->addWidget(_root, 1);
    setCentralWidget(container);
    connect(api, &Api::problem, this, &Window::error);
    connect(api, &Api::sessionChanged, this, [this](QJsonObject) {
        if (_userId == 0)
            loggedIn();
    });
    connect(api, &Api::sessionInvalid, this, [this] {
        _userId = 0;
        _chatId = 0;
        _messageRows.clear();
        _messages->clear();
        _chats->clear();
        _chatRows = {};
        _folders = {};
        _folderId = "builtin_all";
        _selectedFolder = {{"rule", "all"}};
        buildRail();
        _editor->clear();
        _drafts.clear();
        _outbox.clear();
        _sending.clear();
        _pendingChat = 0;
        _presenceTimer.stop();
        _chatRefreshTimer.stop();
        _chatRetryAt = 0;
        _refreshChatsBusy = false;
        _chatRetryDelay = 2000;
        _chatLoadError.clear();
        if (_calls) {
            _calls->deleteLater();
            _calls = nullptr;
        }
        _root->setCurrentIndex(0);
        _loginPages->setCurrentIndex(0);
        error("Войдите в аккаунт");
    });
    connect(api, &Api::eventReceived, this, &Window::receive);
    connect(api, &Api::connectionChanged, this, [this](bool online) {
        if (online) {
            refreshChats();
            if (_chatId)
                loadHistory();
        } else if (_userId)
            _chatSubtitle->setText("Переподключение к серверу…");
    });
    _qrTimer.setSingleShot(true);
    connect(&_qrTimer, &QTimer::timeout, this, [this] { pollQr(_loginGeneration); });
    _uiTimer.setInterval(500);
    connect(&_uiTimer, &QTimer::timeout, this, [this] {
        const auto now = QDateTime::currentMSecsSinceEpoch();
        if (_loginPages->currentIndex() == 3) {
            auto left = std::max(qint64(0), (_codeDeadline - now) / 1000);
            _codeStatus->setText(left
                                     ? QString("Код отправлен в «Волна — служебные уведомления» на "
                                               "уже подключённые устройства. Действует ещё %1:%2")
                                           .arg(left / 60)
                                           .arg(left % 60, 2, 10, QChar('0'))
                                     : "Срок кода истёк. Запросите новый");
            const auto wait = std::max(qint64(0), (_retryAt - now + 999) / 1000);
            _resend->setEnabled(!wait && !_phoneBusy);
            _resend->setText(wait ? QString("Повторить через %1 с").arg(wait)
                                  : "Получить код заново");
            _verify->setEnabled(!_phoneBusy && left > 0);
        }
        _requestCode->setEnabled(!_phoneBusy && now >= _retryAt);
    });
    _uiTimer.start();
    _presenceTimer.setInterval(10000);
    connect(&_presenceTimer, &QTimer::timeout, this, &Window::presence);
    connect(qApp, &QGuiApplication::applicationStateChanged, this, [this] { presence(); });
    _chatRefreshTimer.setInterval(60000);
    connect(&_chatRefreshTimer, &QTimer::timeout, this, &Window::refreshChats);
    if (QSystemTrayIcon::isSystemTrayAvailable()) {
        _tray = new QSystemTrayIcon(windowIcon(), this);
        auto menu = new QMenu(this);
        menu->addAction("Открыть Волну", this, [this] {
            showNormal();
            raise();
            activateWindow();
        });
        menu->addAction("Настройки", this, &Window::settings);
        menu->addSeparator();
        menu->addAction("Выйти из приложения", this, [this] {
            if ((_calls && _calls->active()) || _recording || _api->busy()) {
                error("Завершите звонок или запись и дождитесь сохранения сеанса");
                showNormal();
                return;
            }
            _quitting = true;
            presence();
            qApp->quit();
        });
        _tray->setContextMenu(menu);
        _tray->setToolTip("Волна Desktop");
        connect(_tray, &QSystemTrayIcon::activated, this, [this](auto reason) {
            if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) {
                showNormal();
                raise();
                activateWindow();
            }
        });
        if (QSettings().value("tray", true).toBool())
            _tray->show();
    }
    _api->restore();
}
QWidget *Window::login() {
    auto page = new QWidget;
    page->setObjectName("login");
    auto outer = new QVBoxLayout(page);
    auto top = new QHBoxLayout;
    auto back = button("‹ Назад", "back"), prefs = button("НАСТРОЙКИ", "settings");
    top->addWidget(back);
    top->addStretch();
    top->addWidget(prefs);
    outer->addLayout(top);
    connect(prefs, &QPushButton::clicked, this, &Window::settings);
    connect(back, &QPushButton::clicked, this, [this] {
        cancelLogin();
        _loginPages->setCurrentIndex(0);
    });
    _loginPages = new QStackedWidget;
    outer->addWidget(_loginPages, 1);
    auto form = [this](QString title, QString subtitle) {
        auto page = new QWidget;
        auto middle = new QHBoxLayout(page);
        middle->addStretch();
        auto content = new QWidget;
        content->setMaximumWidth(390);
        content->setMinimumWidth(340);
        auto body = new QVBoxLayout(content);
        body->setSpacing(20);
        body->addStretch();
        auto heading = label(title, "title");
        heading->setAlignment(Qt::AlignCenter);
        body->addWidget(heading);
        auto desc = label(subtitle, "subtitle");
        desc->setAlignment(Qt::AlignCenter);
        body->addWidget(desc);
        middle->addWidget(content);
        middle->addStretch();
        _loginPages->addWidget(page);
        return body;
    };
    auto welcome =
        form("Волна Desktop", "Ваши чаты, сообщения и звонки\nв нативном приложении для Windows");
    auto icon = label({});
    icon->setPixmap(QPixmap(":/volna/icon.png")
                        .scaled(128, 128, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    icon->setAlignment(Qt::AlignCenter);
    welcome->insertWidget(1, icon);
    auto start = button("Начать общение", "primary");
    start->setProperty("testId", "start");
    welcome->addWidget(start);
    welcome->addWidget(label("Ваши сообщения всегда рядом", "subtitle"));
    welcome->addStretch();
    connect(start, &QPushButton::clicked, this, &Window::beginQr);
    auto qr = form("Сканируйте с телефона",
                   "Волна на телефоне → Настройки → Устройства → Подключить устройство");
    _qrImage = label({});
    _qrImage->setObjectName("qrImage");
    _qrImage->setAlignment(Qt::AlignCenter);
    qr->insertWidget(1, _qrImage);
    _qrStatus = label({}, "subtitle");
    _qrStatus->setAlignment(Qt::AlignCenter);
    qr->addWidget(_qrStatus);
    auto renew = button("Обновить QR", "renewQr"),
         phone = button("Вход по номеру телефона", "phoneLogin");
    qr->addWidget(renew);
    qr->addWidget(phone);
    qr->addStretch();
    connect(renew, &QPushButton::clicked, this, &Window::beginQr);
    connect(phone, &QPushButton::clicked, this, [this] {
        cancelLogin();
        _loginPages->setCurrentIndex(2);
        _phone->setFocus();
    });
    auto number = form("Ваш номер телефона", "Введите международный номер. Код придёт в служебный "
                                             "чат Волны, где вы уже вошли в аккаунт.");
    _phone = new QLineEdit;
    _phone->setObjectName("phone");
    _phone->setPlaceholderText("+7 900 123-45-67");
    _phone->setMaxLength(40);
    _phone->setText("+7");
    number->addWidget(_phone);
    _requestCode = button("Продолжить", "requestCode");
    _requestCode->setStyleSheet("background:#2f6ea5;color:white");
    number->addWidget(_requestCode);
    auto toQr = button("Быстрый вход по QR-коду", "qrLogin");
    number->addWidget(toQr);
    number->addStretch();
    connect(toQr, &QPushButton::clicked, this, &Window::beginQr);
    connect(_requestCode, &QPushButton::clicked, this, &Window::requestCode);
    connect(_phone, &QLineEdit::returnPressed, this, &Window::requestCode);
    auto code =
        form("Код входа", "Не передавайте код никому, даже если его просят от имени поддержки");
    _codeStatus = label({}, "subtitle");
    code->addWidget(_codeStatus);
    _code = new QLineEdit;
    _code->setObjectName("code");
    _code->setPlaceholderText("000000");
    _code->setMaxLength(6);
    _code->setAlignment(Qt::AlignCenter);
    code->addWidget(_code);
    _verify = button("Продолжить", "verifyCode");
    code->addWidget(_verify);
    _resend = button("Получить код заново", "resendCode");
    code->addWidget(_resend);
    code->addStretch();
    connect(_verify, &QPushButton::clicked, this, &Window::verifyCode);
    connect(_code, &QLineEdit::returnPressed, this, &Window::verifyCode);
    connect(_resend, &QPushButton::clicked, this, [this] {
        _pendingRequest = {};
        requestCode();
    });
    return page;
}
void Window::error(QString text) {
    _error->setText(text);
    _error->setVisible(!text.isEmpty());
    _errorFrame->setVisible(!text.isEmpty());
}
void Window::cancelLogin() {
    ++_loginGeneration;
    _qrTimer.stop();
    _qr = {};
    if (!_challenge.isEmpty())
        _api->request(
            "/auth/desktop/cancel",
            QJsonObject{{"challenge_id", _challenge.value("challenge_id")},
                        {"client_secret", _pendingRequest.value("client_secret")}},
            [](ApiResult) {}, false);
    _challenge = {};
    _pendingRequest = {};
    _phoneBusy = false;
    _code->clear();
    error({});
}
void Window::beginQr() {
    cancelLogin();
    _loginPages->setCurrentIndex(1);
    _qrImage->clear();
    _qrStatus->setText("Создание QR-кода…");
    int generation = _loginGeneration;
    _api->request(
        "/auth/qr/request", QJsonObject{{"platform", "windows"}},
        [this, generation](ApiResult result) {
            if (generation != _loginGeneration)
                return;
            if (!result.ok()) {
                error(result.error);
                return;
            }
            _qr = result.value.toObject();
            _qrDeadline =
                QDateTime::currentMSecsSinceEpoch() + _qr.value("expires_in").toInt() * 1000;
            _qrImage->setPixmap(QPixmap::fromImage(loginQr(_qr.value("qr_text").toString(), 4)));
            _qrStatus->setText("Сканируйте QR и подтвердите вход на телефоне");
            pollQr(generation);
        },
        false);
}
void Window::pollQr(int generation) {
    if (generation != _loginGeneration || _qr.isEmpty())
        return;
    if (QDateTime::currentMSecsSinceEpoch() >= _qrDeadline) {
        _qrStatus->setText("QR истёк. Нажмите «Обновить QR»");
        return;
    }
    _api->request(
        "/auth/qr/poll",
        QJsonObject{{"id", _qr.value("id")}, {"poll_token", _qr.value("poll_token")}},
        [this, generation](ApiResult result) {
            if (generation != _loginGeneration)
                return;
            if (result.ok()) {
                auto value = result.value.toObject();
                if (value.contains("token")) {
                    _qrTimer.stop();
                    _api->acceptSession(value);
                    return;
                }
                auto state = value.value("status").toString();
                if (state == "expired" || state == "rejected" || state == "used") {
                    _qrStatus->setText("Попытка завершена. Обновите QR");
                    return;
                }
                _qrStatus->setText(state == "scanned"
                                       ? "Подтвердите вход в Волну на телефоне"
                                       : "Сканируйте QR и подтвердите вход на телефоне");
            } else
                error(result.error);
            _qrTimer.start(result.status == 429 ? int(std::min(result.retryMs, qint64(300000)))
                           : result.ok()        ? 1000
                                                : 3000);
        },
        false);
}
void Window::requestCode() {
    if (_phoneBusy || QDateTime::currentMSecsSinceEpoch() < _retryAt)
        return;
    auto phone = _phone->text();
    phone.remove(QRegularExpression("[\\s()-]"));
    if (!QRegularExpression("^\\+[1-9][0-9]{7,14}$").match(phone).hasMatch()) {
        error("Введите номер с кодом страны, например +7 900 123-45-67");
        return;
    }
    if (_pendingRequest.isEmpty() || _pendingRequest.value("phone").toString() != phone)
        _pendingRequest = {
            {"phone", phone}, {"request_id", Api::nonce(24)}, {"client_secret", Api::nonce()}};
    _phoneBusy = true;
    _requestCode->setEnabled(false);
    error({});
    auto generation = _loginGeneration;
    _api->request(
        "/auth/desktop/request", _pendingRequest,
        [this, generation](ApiResult result) {
            if (generation != _loginGeneration)
                return;
            _phoneBusy = false;
            if (!result.ok()) {
                if (result.status == 429)
                    _retryAt = QDateTime::currentMSecsSinceEpoch() + result.retryMs;
                error(result.error);
                return;
            }
            _challenge = result.value.toObject();
            _codeDeadline = QDateTime::currentMSecsSinceEpoch() +
                            _challenge.value("expires_in").toInt(300) * 1000;
            _retryAt = QDateTime::currentMSecsSinceEpoch() +
                       std::max(qint64(0),
                                _challenge.value("resend_available_at").toVariant().toLongLong() -
                                    _challenge.value("server_time").toVariant().toLongLong());
            _loginPages->setCurrentIndex(3);
            _code->clear();
            _code->setFocus();
        },
        false);
}
void Window::verifyCode() {
    if (_phoneBusy || _challenge.isEmpty())
        return;
    if (!QRegularExpression("^[0-9]{6}$").match(_code->text()).hasMatch()) {
        error("Введите шесть цифр из служебного сообщения");
        return;
    }
    _phoneBusy = true;
    _verify->setEnabled(false);
    auto generation = _loginGeneration;
    error({});
    _api->request(
        "/auth/desktop/verify",
        QJsonObject{{"challenge_id", _challenge.value("challenge_id")},
                    {"client_secret", _pendingRequest.value("client_secret")},
                    {"code", _code->text()}},
        [this, generation](ApiResult result) {
            if (generation != _loginGeneration)
                return;
            _phoneBusy = false;
            if (!result.ok()) {
                error(result.error);
                return;
            }
            _challenge = {};
            _pendingRequest = {};
            _code->clear();
            _api->acceptSession(result.value.toObject());
        },
        false);
}
void Window::loggedIn() {
    _userId = _api->session().value("user").toObject().value("id").toVariant().toLongLong();
    _root->setCurrentIndex(1);
    _conversationStack->setCurrentIndex(_chatId ? 1 : 0);
    loadFolders();
    _qrTimer.stop();
    ++_loginGeneration;
    _phone->clear();
    _code->clear();
    error({});
    if (!_calls) {
        _calls = new Calls(_api, this);
        connect(_calls, &Calls::problem, this, &Window::error);
        connect(_calls, &Calls::attachmentReady, this, [this](QJsonObject attachment) {
            auto chat = attachment.value("native_chat_id").toVariant().toLongLong();
            if (chat < 1)
                return;
            if (_outbox.contains(chat)) {
                error("Сначала повторите предыдущую отправку");
                return;
            }
            _outbox[chat] = {{"text", ""},
                             {"attachment_id", attachment.value("id")},
                             {"client_id", QUuid::createUuid().toString(QUuid::WithoutBraces)}};
            postPending(chat);
        });
        connect(
            _calls->findChild<CallBridge *>(), &CallBridge::recordingChanged, this,
            [this](bool active) {
                _recording = active;
                _voice->setText({});
                _voice->setIcon(nativeIcon(active ? "stop" : "mic"));
                _voice->setToolTip(active ? "Завершить запись" : "Записать голосовое сообщение");
                _editor->setPlaceholderText(active ? "Запись голосового сообщения…" : "Сообщение…");
                composerState();
            });
    }
    refreshChats();
    _api->startEvents();
    _presenceTimer.start();
    _chatRefreshTimer.start();
    presence();
}
void Window::refreshChats() {
    if (!_userId || _refreshChatsBusy || QDateTime::currentMSecsSinceEpoch() < _chatRetryAt)
        return;
    _refreshChatsBusy = true;
    if (_chatRows.isEmpty()) {
        _reloadChats->setText("Загрузка чатов…");
        _reloadChats->setEnabled(false);
        _reloadChats->show();
    }
    auto owner = _userId;
    _api->request("/chats", noData(), [this, owner](ApiResult result) {
        if (owner != _userId)
            return;
        _refreshChatsBusy = false;
        if (!result.ok()) {
            _chatLoadError = result.error;
            error(_chatLoadError);
            auto delay = int(std::clamp(std::max(qint64(_chatRetryDelay), result.retryMs),
                                        qint64(2000), qint64(2147400000)));
            _chatRetryAt = QDateTime::currentMSecsSinceEpoch() + delay;
            _chatRefreshTimer.start(delay);
            _chatRetryDelay = std::min(_chatRetryDelay * 2, 30000);
            _reloadChats->setText("Повторить загрузку чатов");
            _reloadChats->setEnabled(false);
            _reloadChats->show();
            QTimer::singleShot(delay, this, [this] { _reloadChats->setEnabled(true); });
            return;
        }
        if (!_chatLoadError.isEmpty() && _error->text() == _chatLoadError)
            error({});
        _chatLoadError.clear();
        _chatRetryAt = 0;
        _chatRetryDelay = 2000;
        _chatRefreshTimer.start(60000);
        _reloadChats->hide();
        _chatRows = result.value.toArray();
        showChats();
        if (_chatId) {
            for (const auto &value : _chatRows) {
                auto chat = value.toObject();
                if (chat.value("id").toVariant().toLongLong() == _chatId) {
                    _chat = chat;
                    _chatTitle->setText(chat.value("name").toString());
                    _chatSubtitle->setText(chat.value("peer_online").toBool()          ? "в сети"
                                           : chat.value("kind").toString() == "direct" ? "не в сети"
                                           : chat.value("kind").toString() == "group"  ? "Группа"
                                                                                       : "");
                    break;
                }
            }
            updateHeader();
        }
    });
}
void Window::showChats() {
    _chats->clear();
    for (auto value : _chatRows) {
        auto chat = value.toObject();
        QString name = chat.value("name").toString();
        if (name.isEmpty())
            name = "Пользователь";
        auto hasId = [&](QString key) {
            for (auto value : _selectedFolder.value(key).toArray())
                if (value.toVariant().toLongLong() == chat.value("id").toVariant().toLongLong())
                    return true;
            return false;
        };
        bool explicitChat = hasId("chats") || hasId("pinned");
        auto type = [&](QString rule) {
            return rule == "all" ||
                   rule == "archived" && chat.value("archived").toVariant().toBool() ||
                   rule == "unread" && (chat.value("unread").toInt() > 0 ||
                                        chat.value("manual_unread").toVariant().toBool()) ||
                   rule == "direct" &&
                       (chat.value("kind") == "direct" || chat.value("kind") == "saved") ||
                   rule == "contacts" && chat.value("is_contact").toBool() ||
                   rule == "non_contacts" && chat.value("kind") == "direct" &&
                       !chat.value("is_contact").toBool() ||
                   chat.value("kind").toString() == rule;
        };
        auto rule = _selectedFolder.value("rule").toString();
        bool matches = !rule.isEmpty() && type(rule) &&
                       (rule == "archived" || !chat.value("archived").toVariant().toBool());
        for (auto value : _selectedFolder.value("types").toArray())
            matches = matches || type(value.toString());
        if (hasId("excluded") ||
            !explicitChat && (!matches ||
                              _selectedFolder.value("excludeRead").toBool() &&
                                  chat.value("unread").toInt() == 0 ||
                              _selectedFolder.value("excludeMuted").toBool() &&
                                  chat.value("muted").toVariant().toBool() ||
                              _selectedFolder.value("excludeArchived").toBool() &&
                                  chat.value("archived").toVariant().toBool()))
            continue;
        if (!name.contains(_filter->text(), Qt::CaseInsensitive) &&
            !chat.value("last_text").toString().contains(_filter->text(), Qt::CaseInsensitive))
            continue;
        auto row = new QListWidgetItem;
        row->setData(Qt::UserRole, chat.value("id").toVariant());
        row->setData(Qt::UserRole + 1, chat);
        row->setText(name +
                     (chat.value("unread").toInt()
                          ? QString("    %1").arg(chat.value("unread").toInt())
                          : QString()) +
                     "\n" + chat.value("last_text").toString().left(45));
        row->setSizeHint({250, 66});
        _chats->addItem(row);
        if (chat.value("id").toVariant().toLongLong() == _chatId)
            _chats->setCurrentItem(row);
    }
}
void Window::openChat(qint64 id) {
    if (_recording) {
        error("Сначала завершите запись голосового");
        return;
    }
    if (_chatId)
        _drafts[_chatId] = _editor->toPlainText();
    _chatId = id;
    _searchTimer.stop();
    _chatSearch->clear();
    _searchBar->hide();
    _searchResults->hide();
    _messageRows.clear();
    _messages->clear();
    _historyBusy = false;
    _exhausted = false;
    ++_historyGeneration;
    for (auto value : _chatRows)
        if (value.toObject().value("id").toVariant().toLongLong() == id)
            _chat = value.toObject();
    _chatTitle->setText(_chat.value("name").toString().isEmpty() ? "Пользователь"
                                                                 : _chat.value("name").toString());
    _chatSubtitle->setText(_chat.value("peer_online").toBool() ? "в сети" : "");
    bool send = _chat.value("can_send").toInt(1) != 0;
    _editor->setEnabled(send);
    _send->setEnabled(send);
    _attach->setEnabled(send);
    _voice->setEnabled(send);
    bool call = _chat.value("kind").toString() == "direct" &&
                _chat.value("peer_id").toVariant().toLongLong() != _userId;
    _audio->setEnabled(call);
    _video->setEnabled(call);
    _editor->setPlainText(_drafts.value(id));
    _conversationStack->setCurrentIndex(1);
    _anchor = 0;
    _latest->hide();
    updateHeader();
    composerState();
    loadHistory();
}
void Window::loadHistory(bool older) {
    if (!_chatId || _historyBusy || older && _exhausted)
        return;
    _historyBusy = true;
    const auto generation = _historyGeneration;
    QString path = "/chats/" + QString::number(_chatId) + "/messages";
    if (older && !_messageRows.isEmpty())
        path += "?before=" + QString::number(_messageRows.firstKey());
    _api->request(path, noData(), [this, generation, older](ApiResult result) {
        if (generation != _historyGeneration)
            return;
        _historyBusy = false;
        if (!result.ok()) {
            error(result.error);
            return;
        }
        auto rows = result.value.toArray();
        if (older || _messageRows.isEmpty())
            _exhausted = rows.size() < 50;
        for (auto value : rows) {
            auto message = value.toObject();
            _messageRows[message.value("id").toVariant().toLongLong()] = message;
        }
        renderMessages(older);
        _older->setVisible(!_exhausted);
        if (!_anchor && !_messageRows.isEmpty() && isActiveWindow())
            _api->request("/chats/" + QString::number(_chatId) + "/read",
                          QJsonObject{{"message_id", _messageRows.lastKey()}}, [](ApiResult) {});
    });
}
void Window::renderMessages(bool preserve) {
    if (!_messages)
        return;
    auto scroll = _messages->verticalScrollBar();
    int oldValue = scroll->value(), oldMax = scroll->maximum();
    bool bottom = oldValue >= oldMax - 40;
    _messages->clear();
    QString previousDate;
    qint64 previousSender = -1;
    QDateTime previousTime;
    for (auto it = _messageRows.cbegin(); it != _messageRows.cend(); ++it) {
        auto message = it.value();
        auto created = QDateTime::fromString(message.value("created_at").toString(), Qt::ISODate)
                           .toLocalTime();
        auto date = created.date();
        auto stamp =
            QLocale(QLocale::Russian, QLocale::Russia)
                .toString(date,
                          date.year() == QDate::currentDate().year() ? "d MMMM" : "d MMMM yyyy");
        bool newDay = stamp != previousDate;
        if (newDay) {
            auto item = new QListWidgetItem(_messages);
            auto row = new QWidget;
            auto layout = new QHBoxLayout(row);
            layout->setContentsMargins(0, 10, 0, 8);
            layout->addStretch();
            auto chip = button(stamp, "dateChip");
            chip->setFixedHeight(24);
            layout->addWidget(chip);
            layout->addStretch();
            item->setSizeHint({0, 42});
            _messages->setItemWidget(item, row);
            connect(chip, &QPushButton::clicked, this, [this, date] { chooseDate(date); });
            previousDate = stamp;
        }
        bool mine = message.value("sender_id").toVariant().toLongLong() == _userId;
        auto sender = message.value("sender_id").toVariant().toLongLong();
        bool grouped = !newDay && sender == previousSender && previousTime.secsTo(created) >= 0 &&
                       previousTime.secsTo(created) < 120;
        previousSender = sender;
        previousTime = created;
        bool deleted = !message.value("deleted_at").isNull() && message.contains("deleted_at");
        auto attachment = deleted ? QJsonObject{} : message.value("attachment").toObject();
        auto reply = message.value("reply").toObject();
        bool senderName = !mine && _chat.value("kind") == "group" && !grouped;
        QString textValue = deleted ? "Сообщение удалено" : message.value("text").toString();
        int maxWidth = std::max(140, std::min(500, int(_messages->viewport()->width() * .78))),
            padding = 22;
        bool photo = attachment.value("mime").toString().startsWith("image/") &&
                     attachment.value("size").toInt() < 4 * 1024 * 1024;
        auto row = new QWidget;
        auto outer = new QHBoxLayout(row);
        outer->setContentsMargins(18, grouped ? 1 : 5, 18, 1);
        outer->setSpacing(0);
        auto bubble = new QWidget;
        bubble->setObjectName("messageBubble");
        auto content = new QVBoxLayout(bubble);
        content->setContentsMargins(11, 8, 11, 6);
        content->setSpacing(3);
        auto bg = _theme.color(mine ? "msgOutBg" : "msgInBg", _theme.color("windowBg")).name();
        auto border = it.key() == _anchor ? "border:1px solid #6ab3f3;" : "border:0;";
        bubble->setStyleSheet("QWidget#messageBubble{background:" + bg + ";border-radius:10px;" +
                              border + "} QLabel{background:transparent;border:0;}");
        if (senderName) {
            auto name = label(message.value("sender_name").toString("Пользователь"));
            name->setStyleSheet("color:#75b9ee;font-size:13px;font-weight:600");
            content->addWidget(name);
        }
        if (!reply.isEmpty()) {
            auto quoted = label(reply.value("name").toString() + "\n" +
                                reply.value("text").toString().left(90));
            quoted->setStyleSheet(
                "border-left:2px solid #6ab3f3;padding:4px 8px;color:#91b8d8;font-size:12px;");
            content->addWidget(quoted);
        }
        auto text = label(textValue);
        auto messageFont = text->font();
        messageFont.setPixelSize(14);
        text->setFont(messageFont);
        text->setTextInteractionFlags(Qt::TextSelectableByMouse | Qt::TextSelectableByKeyboard);
        text->setStyleSheet(deleted ? "color:#8b9daa;font-size:14px;font-style:italic"
                                    : "font-size:14px");
        auto time = label(when(message.value("created_at").toString()), "messageTime");
        time->setStyleSheet(QString("color:%1;font-size:11px")
                                .arg(mine ? "#8cb3d7" : _theme.color("windowSubTextFg").name()));
        auto info = new QHBoxLayout;
        info->setContentsMargins(0, 0, 0, 0);
        info->setSpacing(4);
        info->addStretch();
        info->addWidget(time);
        if (mine) {
            auto receipt = new QLabel;
            bool read = _chat.value("peer_read").toVariant().toLongLong() >= it.key(),
                 delivered = _chat.value("peer_delivered").toVariant().toLongLong() >= it.key();
            receipt->setPixmap(nativeIcon(read || delivered ? "checks" : "check",
                                          QColor(read ? "#74c7fc" : "#8cb3d7"))
                                   .pixmap(18, 14));
            receipt->setToolTip(read ? "Прочитано" : delivered ? "Доставлено" : "Отправлено");
            info->addWidget(receipt);
        }
        bool inlineTime = !textValue.contains('\n') && attachment.isEmpty() && reply.isEmpty() &&
                          !senderName &&
                          text->fontMetrics().horizontalAdvance(textValue) +
                                  time->fontMetrics().horizontalAdvance(time->text()) + 62 <
                              maxWidth;
        int width =
            std::clamp(text->fontMetrics().horizontalAdvance(textValue.section('\n', 0, 0)) +
                           padding + (inlineTime ? 66 : 0),
                       92, maxWidth);
        if (!attachment.isEmpty())
            width = std::min(maxWidth, photo ? 338 : 310);
        if (photo) {
            auto picture =
                new MediaView(_avatars,
                              "/api/files/" + attachment.value("id").toString() +
                                  "?message_id=" + QString::number(it.key()),
                              width - padding, std::min(230, int((width - padding) * .72)));
            picture->setProperty("messageId", it.key());
            picture->setProperty("albumId", message.value("album_id"));
            content->addWidget(picture);
            connect(picture, &QPushButton::clicked, this, [this, message] { openFile(message); });
        } else if (!attachment.isEmpty()) {
            bool voice = attachment.value("name").toString().startsWith("Голосовое-") &&
                         attachment.value("mime").toString().startsWith("audio/");
            auto file =
                button((voice ? "Голосовое сообщение" : attachment.value("name").toString()) +
                           QString("\n%1 КБ").arg((attachment.value("size").toInt() + 1023) / 1024),
                       "messageFile");
            file->setIcon(nativeIcon(voice ? "play" : "file", QColor("#6ab3f3")));
            file->setIconSize({36, 36});
            file->setStyleSheet("text-align:left;padding:6px 2px;font-size:13px;");
            file->setMinimumHeight(48);
            content->addWidget(file);
            connect(file, &QPushButton::clicked, this, [this, message] { openFile(message); });
        }
        bubble->setFixedWidth(width);
        if (inlineTime) {
            text->setWordWrap(false);
            auto line = new QHBoxLayout;
            line->setContentsMargins(0, 0, 0, 0);
            line->setSpacing(8);
            line->addWidget(text, 1);
            line->addLayout(info);
            content->addLayout(line);
        } else {
            if (!textValue.isEmpty()) {
                content->addWidget(text);
                text->ensurePolished();
                text->setFixedHeight(
                    std::max(text->fontMetrics().height(), text->heightForWidth(width - padding)));
            }
            content->addLayout(info);
        }
        bubble->setFixedWidth(width);
        content->activate();
        int height = content->totalHeightForWidth(width);
        bubble->setMinimumHeight(height);
        if (mine)
            outer->addStretch();
        outer->addWidget(bubble);
        if (!mine)
            outer->addStretch();
        auto item = new QListWidgetItem(_messages);
        item->setData(Qt::UserRole, it.key());
        item->setSizeHint({0, height + (grouped ? 4 : 8)});
        _messages->setItemWidget(item, row);
    }
    if (preserve)
        scroll->setValue(oldValue + (scroll->maximum() - oldMax));
    else if (bottom)
        scroll->setValue(scroll->maximum());
}
void Window::composerState() {
    bool allowed = _chatId && _chat.value("can_send").toInt(1) != 0;
    bool pending = _outbox.contains(_chatId), sending = _sending.contains(_chatId);
    _editor->setEnabled(allowed);
    _editor->setReadOnly(pending || _recording);
    _emoji->setEnabled(allowed && !pending && !_recording);
    _send->setText({});
    _send->setProperty("pending", pending);
    _send->setAccessibleName(pending ? "Повторить отправку" : "Отправить сообщение");
    _send->setToolTip(_send->accessibleName());
    _send->setIcon(nativeIcon(pending ? "retry" : "send", QColor("#64b5ef")));
    _send->setVisible(pending || !_editor->toPlainText().trimmed().isEmpty());
    _voice->setVisible(!pending && _editor->toPlainText().trimmed().isEmpty() || _recording);
    _send->setEnabled(allowed && !sending);
    _attach->setEnabled(allowed && !pending);
    _voice->setEnabled(allowed && !pending);
}
void Window::sendMessage(QString attachment) {
    if (_recording) {
        error("Завершите запись и дождитесь загрузки голосового");
        return;
    }
    if (!_chatId)
        return;
    if (_outbox.contains(_chatId)) {
        postPending(_chatId);
        return;
    }
    auto text = _editor->toPlainText();
    if (text.trimmed().isEmpty() && attachment.isEmpty())
        return;
    if (text.size() > 4000) {
        error("Максимум 4000 символов");
        return;
    }
    QJsonObject payload{{"text", text},
                        {"client_id", QUuid::createUuid().toString(QUuid::WithoutBraces)}};
    if (!attachment.isEmpty())
        payload.insert("attachment_id", attachment);
    _outbox[_chatId] = payload;
    postPending(_chatId);
}
void Window::postPending(qint64 chat) {
    if (_sending.contains(chat) || !_outbox.contains(chat))
        return;
    _sending.insert(chat);
    composerState();
    const auto payload = _outbox.value(chat);
    const auto owner = _userId;
    _api->request("/chats/" + QString::number(chat) + "/messages", payload,
                  [this, chat, payload, owner](ApiResult result) {
                      if (owner != _userId)
                          return;
                      _sending.remove(chat);
                      if (!result.ok()) {
                          error(result.error +
                                ". Повтор использует тот же идентификатор и не создаёт дубликат");
                          composerState();
                          return;
                      }
                      _outbox.remove(chat);
                      _drafts.remove(chat);
                      if (chat == _chatId) {
                          if (_editor->toPlainText() == payload.value("text").toString())
                              _editor->clear();
                          auto message = result.value.toObject();
                          _messageRows[message.value("id").toVariant().toLongLong()] = message;
                          renderMessages();
                      }
                      composerState();
                      error({});
                      _api->retrySave();
                      refreshChats();
                  });
}
void Window::attachFile() {
    if (_recording) {
        error("Завершите запись и дождитесь загрузки голосового");
        return;
    }
    if (_outbox.contains(_chatId)) {
        error("Сначала повторите предыдущую отправку");
        return;
    }
    auto file = QFileDialog::getOpenFileName(this, "Прикрепить файл");
    if (file.isEmpty())
        return;
    _attach->setEnabled(false);
    auto chat = _chatId;
    _api->upload(file, [this, chat](ApiResult result) {
        _attach->setEnabled(true);
        if (!result.ok()) {
            error(result.error);
            return;
        }
        if (chat != _chatId) {
            error("Чат изменился во время загрузки. Прикрепите файл заново");
            return;
        }
        sendMessage(result.value.toObject().value("id").toString());
    });
}
void Window::openFile(QJsonObject message) {
    auto attachment = message.value("attachment").toObject();
    if (attachment.value("mime").toString().startsWith("image/")) {
        auto viewer = new ImageViewer(_api, message, this);
        viewer->show();
        return;
    }
    _api->download(attachment.value("id").toString(), message.value("id").toVariant().toLongLong(),
                   [this, attachment](ApiResult result) {
                       if (!result.ok()) {
                           error(result.error);
                           return;
                       }
                       auto mime = attachment.value("mime").toString();
                       if (mime.startsWith("audio/") || mime.startsWith("video/")) {
                           if (_calls)
                               _calls->media(result.bytes, mime);
                           return;
                       }
                       if (mime.startsWith("image/")) {
                           QImage image = QImage::fromData(result.bytes);
                           if (!image.isNull()) {
                               auto dialog = new QDialog(this);
                               dialog->setAttribute(Qt::WA_DeleteOnClose);
                               dialog->setWindowTitle(attachment.value("name").toString());
                               auto layout = new QVBoxLayout(dialog);
                               auto picture = new QLabel;
                               picture->setAlignment(Qt::AlignCenter);
                               picture->setPixmap(QPixmap::fromImage(image).scaled(
                                   1000, 740, Qt::KeepAspectRatio, Qt::SmoothTransformation));
                               layout->addWidget(picture);
                               dialog->resize(1020, 780);
                               dialog->show();
                               return;
                           }
                       }
                       auto path = QFileDialog::getSaveFileName(
                           this, "Сохранить файл",
                           QFileInfo(attachment.value("name").toString()).fileName());
                       if (path.isEmpty())
                           return;
                       QSaveFile file(path);
                       if (!file.open(QIODevice::WriteOnly) ||
                           file.write(result.bytes) != result.bytes.size() || !file.commit())
                           error("Не удалось сохранить файл");
                   });
}
void Window::messageMenu(QPoint point) {
    auto item = _messages->itemAt(point);
    if (!item)
        return;
    auto message = _messageRows.value(item->data(Qt::UserRole).toLongLong());
    if (message.isEmpty())
        return;
    QMenu menu;
    auto copy = menu.addAction("Копировать текст");
    QAction *edit = nullptr, *remove = nullptr;
    if (message.value("sender_id").toVariant().toLongLong() == _userId) {
        edit = menu.addAction("Изменить");
        remove = menu.addAction("Удалить у всех");
    }
    auto chosen = menu.exec(_messages->viewport()->mapToGlobal(point));
    if (chosen == copy)
        qApp->clipboard()->setText(message.value("text").toString());
    else if (edit && chosen == edit) {
        bool ok = false;
        auto text = QInputDialog::getMultiLineText(this, "Изменить сообщение", "Текст",
                                                   message.value("text").toString(), &ok);
        if (ok)
            _api->request("/messages/" +
                              QString::number(message.value("id").toVariant().toLongLong()) +
                              "/edit",
                          QJsonObject{{"text", text}}, [this](ApiResult result) {
                              if (!result.ok())
                                  error(result.error);
                              else
                                  loadHistory();
                          });
    } else if (remove && chosen == remove) {
        if (QMessageBox::question(this, "Удалить сообщение?",
                                  "Сообщение будет удалено у всех участников") != QMessageBox::Yes)
            return;
        _api->request("/messages/" + QString::number(message.value("id").toVariant().toLongLong()) +
                          "/delete",
                      QJsonObject{}, [this](ApiResult result) {
                          if (!result.ok())
                              error(result.error);
                          else
                              loadHistory();
                      });
    }
}
void Window::newChat() {
    bool ok = false;
    auto query =
        QInputDialog::getText(this, "Новый чат", "Имя пользователя или полный номер телефона",
                              QLineEdit::Normal, {}, &ok);
    if (!ok || query.trimmed().isEmpty())
        return;
    _api->request(
        "/users?q=" + QString::fromLatin1(QUrl::toPercentEncoding(query)), noData(),
        [this](ApiResult result) {
            if (!result.ok()) {
                error(result.error);
                return;
            }
            auto people = result.value.toArray();
            if (people.isEmpty()) {
                error("Пользователи не найдены");
                return;
            }
            QStringList names;
            for (auto value : people) {
                auto user = value.toObject();
                names << user.value("name").toString() + " (@" + user.value("username").toString() +
                             ")";
            }
            bool ok = false;
            auto name = QInputDialog::getItem(this, "Выберите собеседника", "Пользователь", names,
                                              0, false, &ok);
            if (!ok)
                return;
            auto user = people.at(names.indexOf(name)).toObject();
            _api->request(
                "/chats", QJsonObject{{"user_id", user.value("id")}}, [this](ApiResult result) {
                    if (!result.ok()) {
                        error(result.error);
                        return;
                    }
                    auto id = result.value.toObject().value("id").toVariant().toLongLong();
                    _api->request("/chats", noData(), [this, id](ApiResult rows) {
                        if (rows.ok()) {
                            _chatRows = rows.value.toArray();
                            showChats();
                            openChat(id);
                        } else
                            error(rows.error);
                    });
                });
        });
}
void Window::presence() {
    if (!_userId)
        return;
    auto active = QApplication::activeWindow();
    bool visible = !_quitting && qApp->applicationState() == Qt::ApplicationActive && active &&
                   (active == this || isAncestorOf(active)) && active->isVisible() &&
                   !active->isMinimized();
    _api->request("/presence",
                  QJsonObject{{"client", _presenceClient},
                              {"visible", visible},
                              {"sequence", ++_presenceSequence}},
                  [](ApiResult) {});
    if (visible && !_anchor && !_messageRows.isEmpty() &&
        _messages->verticalScrollBar()->value() >= _messages->verticalScrollBar()->maximum() - 40)
        _api->request("/chats/" + QString::number(_chatId) + "/read",
                      QJsonObject{{"message_id", _messageRows.lastKey()}}, [](ApiResult) {});
}
void Window::receive(QJsonObject event) {
    if (_calls)
        _calls->dispatch(event);
    auto type = event.value("type").toString();
    if (type == "folders-update") {
        loadFolders();
        return;
    }
    if (type == "message" || type == "message-update") {
        auto message = event.value("message").toObject();
        if (message.value("chat_id").toVariant().toLongLong() == _chatId && _anchor) {
            _latest->setText("К последним сообщениям · Есть новые ↓");
            refreshChats();
            return;
        }
        if (message.value("chat_id").toVariant().toLongLong() == _chatId) {
            _messageRows[message.value("id").toVariant().toLongLong()] = message;
            renderMessages();
            if (isActiveWindow() && _messages->verticalScrollBar()->value() >=
                                        _messages->verticalScrollBar()->maximum() - 40)
                _api->request("/chats/" + QString::number(_chatId) + "/read",
                              QJsonObject{{"message_id", message.value("id")}}, [](ApiResult) {});
        }
        if (type == "message" && event.value("notify").toBool(true) && !isActiveWindow() &&
            message.value("sender_id").toVariant().toLongLong() != _userId && _tray)
            _tray->showMessage(message.value("sender_name").toString("Волна"),
                               message.value("text").toString().left(120),
                               QSystemTrayIcon::Information, 5000);
        refreshChats();
    } else if (type == "chats" || type == "profile" || type == "presence" || type == "read" ||
               type == "delivered")
        refreshChats();
}
void Window::closeEvent(QCloseEvent *event) {
    if (_quitting) {
        event->accept();
        return;
    }
    if (_tray && _tray->isVisible()) {
        event->ignore();
        hide();
        presence();
        return;
    }
    if ((_calls && _calls->active()) || _recording || _api->busy()) {
        event->ignore();
        error("Завершите звонок или запись и дождитесь сохранения сеанса");
        return;
    }
    _quitting = true;
    presence();
    event->accept();
}
void Window::changeEvent(QEvent *event) {
    QMainWindow::changeEvent(event);
    if (event->type() == QEvent::WindowStateChange || event->type() == QEvent::ActivationChange)
        presence();
}
