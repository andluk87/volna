#include "chat_delegate.h"
#include "window.h"
#include <QApplication>
#include <QButtonGroup>
#include <QCalendarWidget>
#include <QClipboard>
#include <QDateTime>
#include <QDesktopServices>
#include <QDialogButtonBox>
#include <QFrame>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QMenu>
#include <QMessageBox>
#include <QPointer>
#include <QResizeEvent>
#include <QScreen>
#include <QScrollArea>
#include <QScrollBar>
#include <QSettings>
#include <QSplitter>
#include <QSslSocket>
#include <QStyle>
#include <QToolButton>
#include <QVBoxLayout>
#include <QWidgetAction>
static QPushButton *tool(QString icon, QString id, QString tip) {
    auto value = button({}, id);
    value->setIcon(nativeIcon(icon));
    value->setIconSize({24, 24});
    value->setFixedSize(36, 36);
    value->setToolTip(tip);
    value->setAccessibleName(tip);
    value->setProperty("tool", true);
    return value;
}
QWidget *Window::messenger() {
    auto shell = new QWidget;
    auto horizontal = new QHBoxLayout(shell);
    horizontal->setSpacing(0);
    horizontal->setContentsMargins(0, 0, 0, 0);
    auto rail = new QWidget;
    rail->setObjectName("rail");
    rail->setFixedWidth(74);
    auto navigation = new QVBoxLayout(rail);
    navigation->setContentsMargins(6, 10, 6, 12);
    navigation->setSpacing(4);
    auto menu = tool("menu", "menu", "Главное меню");
    navigation->addWidget(menu, 0, Qt::AlignHCenter);
    connect(menu, &QPushButton::clicked, this, &Window::mainMenu);
    _folderRail = new QWidget;
    auto scroll = new QScrollArea;
    scroll->setObjectName("railScroll");
    scroll->setFrameShape(QFrame::NoFrame);
    scroll->setWidgetResizable(true);
    scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    scroll->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    scroll->setWidget(_folderRail);
    navigation->addWidget(scroll, 1);
    auto preferences = tool("settings", "nativeSettings", "Настройки");
    navigation->addWidget(preferences, 0, Qt::AlignHCenter);
    connect(preferences, &QPushButton::clicked, this, &Window::settings);
    horizontal->addWidget(rail);
    auto root = new QSplitter;
    root->setChildrenCollapsible(false);
    horizontal->addWidget(root, 1);
    auto side = new QWidget;
    side->setMinimumWidth(270);
    side->setObjectName("sidebar");
    auto left = new QVBoxLayout(side);
    left->setContentsMargins(0, 0, 0, 0);
    left->setSpacing(0);
    auto top = new QWidget;
    top->setObjectName("sidebarTop");
    top->setFixedHeight(64);
    auto bar = new QHBoxLayout(top);
    bar->setContentsMargins(12, 12, 10, 12);
    bar->setSpacing(6);
    _filter = new QLineEdit;
    _filter->setObjectName("filter");
    _filter->setPlaceholderText("Поиск");
    _filter->setClearButtonEnabled(true);
    _filter->addAction(nativeIcon("search"), QLineEdit::LeadingPosition);
    auto create = tool("compose", "newChat", "Новый чат");
    bar->addWidget(_filter, 1);
    bar->addWidget(create);
    left->addWidget(top);
    _chats = new QListWidget;
    _chats->setObjectName("chats");
    _chats->setItemDelegate(new ChatDelegate(_avatars, _chats));
    _chats->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    _chats->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    left->addWidget(_chats, 1);
    root->addWidget(side);
    connect(_avatars, &AvatarStore::changed, _chats->viewport(), qOverload<>(&QWidget::update));
    connect(create, &QPushButton::clicked, this, &Window::newChat);
    connect(_filter, &QLineEdit::textChanged, this, &Window::showChats);
    connect(_chats, &QListWidget::itemClicked, this,
            [this](QListWidgetItem *item) { openChat(item->data(Qt::UserRole).toLongLong()); });
    _conversationStack = new QStackedWidget;
    root->addWidget(_conversationStack);
    auto placeholder = new QWidget;
    placeholder->setObjectName("conversationEmpty");
    auto emptyLayout = new QVBoxLayout(placeholder);
    emptyLayout->addStretch();
    auto logo = label({});
    logo->setAlignment(Qt::AlignCenter);
    logo->setPixmap(
        QPixmap(":/volna/icon.png").scaled(88, 88, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    emptyLayout->addWidget(logo);
    _empty = label("Ваши чаты в Волне", "emptyTitle");
    _empty->setAlignment(Qt::AlignCenter);
    emptyLayout->addWidget(_empty);
    auto hint = label("Выберите собеседника слева\nили начните новый разговор", "emptyHint");
    hint->setAlignment(Qt::AlignCenter);
    emptyLayout->addWidget(hint);
    emptyLayout->addStretch();
    _conversationStack->addWidget(placeholder);
    auto right = new QWidget;
    auto body = new QVBoxLayout(right);
    body->setContentsMargins(0, 0, 0, 0);
    body->setSpacing(0);
    _conversationStack->addWidget(right);
    auto header = new QWidget;
    header->setObjectName("header");
    header->setFixedHeight(64);
    auto head = new QHBoxLayout(header);
    head->setContentsMargins(18, 8, 12, 8);
    head->setSpacing(12);
    _chatAvatar = new AvatarView(_avatars, 42);
    head->addWidget(_chatAvatar);
    auto titles = new QVBoxLayout;
    titles->setSpacing(2);
    _chatTitle = label({}, "chatTitle");
    _chatTitle->setWordWrap(false);
    _chatTitle->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
    _chatSubtitle = label({}, "chatSubtitle");
    _chatSubtitle->setWordWrap(false);
    titles->addWidget(_chatTitle);
    titles->addWidget(_chatSubtitle);
    head->addLayout(titles, 1);
    auto search = tool("search", "searchMessages", "Поиск в переписке");
    _audio = tool("phone", "audioCall", "Аудиозвонок");
    _video = tool("camera", "videoCall", "Видеозвонок");
    auto more = tool("more", "chatMenu", "Меню чата");
    head->addWidget(search);
    head->addWidget(_audio);
    head->addWidget(_video);
    head->addWidget(more);
    body->addWidget(header);
    connect(search, &QPushButton::clicked, this, &Window::searchMessages);
    connect(more, &QPushButton::clicked, this, &Window::chatMenu);
    _searchBar = new QWidget;
    _searchBar->setObjectName("chatSearchBar");
    auto searchLayout = new QHBoxLayout(_searchBar);
    searchLayout->setContentsMargins(16, 7, 12, 7);
    _chatSearch = new QLineEdit;
    _chatSearch->setObjectName("chatSearch");
    _chatSearch->setPlaceholderText("Найти сообщение в этом чате");
    _chatSearch->setClearButtonEnabled(true);
    auto closeSearch = tool("close", "closeChatSearch", "Закрыть поиск");
    searchLayout->addWidget(_chatSearch, 1);
    searchLayout->addWidget(closeSearch);
    body->addWidget(_searchBar);
    _searchBar->hide();
    _searchResults = new QListWidget;
    _searchResults->setObjectName("searchResults");
    _searchResults->setMaximumHeight(230);
    _searchResults->setWordWrap(true);
    body->addWidget(_searchResults);
    _searchResults->hide();
    connect(closeSearch, &QPushButton::clicked, this, [this] {
        _searchTimer.stop();
        _chatSearch->clear();
        _searchBar->hide();
        _searchResults->hide();
    });
    _searchTimer.setSingleShot(true);
    _searchTimer.setInterval(300);
    connect(_chatSearch, &QLineEdit::textChanged, this, [this] { _searchTimer.start(); });
    connect(&_searchTimer, &QTimer::timeout, this, [this] {
        if (_chatSearch->text().trimmed().isEmpty()) {
            _searchResults->hide();
            return;
        }
        auto generation = _historyGeneration;
        _api->request(
            "/chats/" + QString::number(_chatId) +
                "/search?q=" + QString::fromLatin1(QUrl::toPercentEncoding(_chatSearch->text())),
            QJsonValue::Undefined, [this, generation](ApiResult result) {
                if (generation != _historyGeneration)
                    return;
                if (!result.ok()) {
                    error(result.error);
                    return;
                }
                _searchResults->clear();
                for (auto value : result.value.toArray()) {
                    auto message = value.toObject();
                    auto item = new QListWidgetItem(message.value("text").toString().left(180),
                                                    _searchResults);
                    item->setData(Qt::UserRole, message);
                    item->setSizeHint({200, 54});
                }
                if (!_searchResults->count()) {
                    auto item = new QListWidgetItem("Сообщения не найдены", _searchResults);
                    item->setFlags(Qt::NoItemFlags);
                }
                _searchResults->show();
            });
    });
    connect(_searchResults, &QListWidget::itemClicked, this, [this](QListWidgetItem *item) {
        auto message = item->data(Qt::UserRole).toJsonObject();
        if (message.isEmpty())
            return;
        auto target = message.value("id").toVariant().toLongLong();
        auto generation = ++_historyGeneration;
        _api->request("/chats/" + QString::number(_chatId) +
                          "/messages?before=" + QString::number(target + 1),
                      QJsonValue::Undefined, [this, generation, target](ApiResult result) {
                          if (generation != _historyGeneration)
                              return;
                          _historyBusy = false;
                          if (!result.ok()) {
                              error(result.error);
                              return;
                          }
                          anchorMessages(result.value.toArray(), target);
                      });
        _searchResults->hide();
    });
    _older = button("Показать предыдущие сообщения", "olderMessages");
    _older->setFixedHeight(30);
    _older->hide();
    body->addWidget(_older);
    _messages = new QListWidget;
    _messages->setObjectName("messages");
    _messages->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    _messages->setSelectionMode(QAbstractItemView::NoSelection);
    _messages->setSpacing(0);
    _messages->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    _messages->setContextMenuPolicy(Qt::CustomContextMenu);
    body->addWidget(_messages, 1);
    _latest = button("К последним сообщениям ↓", "latestMessages");
    _latest->setFixedHeight(32);
    _latest->hide();
    body->addWidget(_latest);
    connect(_latest, &QPushButton::clicked, this, &Window::latestMessages);
    auto composer = new QWidget;
    composer->setObjectName("composer");
    auto compose = new QHBoxLayout(composer);
    compose->setContentsMargins(12, 7, 12, 7);
    compose->setSpacing(6);
    _attach = tool("clip", "attach", "Прикрепить файл");
    _emoji = tool("smile", "emoji", "Эмодзи");
    auto editor = new ComposerEdit;
    _editor = editor;
    _editor->setObjectName("editor");
    _editor->setPlaceholderText("Сообщение…");
    _voice = tool("mic", "recordVoice", "Голосовое сообщение");
    _send = tool("send", "sendMessage", "Отправить сообщение");
    _send->setIcon(nativeIcon("send", QColor("#64b5ef")));
    compose->addWidget(_attach);
    compose->addWidget(_editor, 1);
    compose->addWidget(_emoji);
    compose->addWidget(_voice);
    compose->addWidget(_send);
    body->addWidget(composer);
    connect(_emoji, &QPushButton::clicked, this, &Window::showEmoji);
    connect(editor, &ComposerEdit::sendPressed, this, [this] { sendMessage(); });
    connect(_editor, &QPlainTextEdit::textChanged, this, &Window::composerState);
    connect(_send, &QPushButton::clicked, this, [this] { sendMessage(); });
    connect(_attach, &QPushButton::clicked, this, &Window::attachFile);
    connect(_older, &QPushButton::clicked, this, [this] { loadHistory(true); });
    connect(_messages, &QListWidget::customContextMenuRequested, this, &Window::messageMenu);
    connect(_audio, &QPushButton::clicked, this, [this] {
        if (_calls)
            _calls->start(_chat, false);
    });
    connect(_video, &QPushButton::clicked, this, [this] {
        if (_calls)
            _calls->start(_chat, true);
    });
    connect(_voice, &QPushButton::clicked, this, [this] {
        if (!_calls || !_calls->ready()) {
            error("Модуль голоса ещё загружается");
            return;
        }
        if (_calls->active()) {
            error("Завершите звонок перед записью");
            return;
        }
        if (_recording)
            _calls->record(false, _pendingChat);
        else {
            _recording = true;
            _pendingChat = _chatId;
            _calls->record(true, _chatId);
            composerState();
        }
    });
    root->setStretchFactor(1, 1);
    root->setSizes({330, 780});
    connect(root, &QSplitter::splitterMoved, this, [this] { renderMessages(true); });
    for (auto value : {_audio, _video, _attach, _voice, _send, _emoji})
        value->setEnabled(false);
    _editor->setEnabled(false);
    buildRail();
    return shell;
}
void Window::buildRail() {
    if (auto old = _folderRail->layout()) {
        while (auto item = old->takeAt(0)) {
            delete item->widget();
            delete item;
        }
        delete old;
    }
    auto layout = new QVBoxLayout(_folderRail);
    layout->setContentsMargins(0, 8, 0, 0);
    layout->setSpacing(2);
    auto group = new QButtonGroup(_folderRail);
    group->setExclusive(true);
    QJsonArray folders{QJsonObject{{"id", "builtin_all"}, {"name", "Все чаты"}, {"rule", "all"}}};
    if (_folders.isEmpty()) {
        for (auto pair : QList<QPair<QString, QString>>{{"direct", "Личные"},
                                                        {"group", "Группы"},
                                                        {"channel", "Каналы"},
                                                        {"unread", "Новые"}})
            folders.append(QJsonObject{
                {"id", "builtin_" + pair.first}, {"name", pair.second}, {"rule", pair.first}});
    } else
        for (auto value : _folders)
            if (value.toObject().value("rule") != "all")
                folders.append(value);
    for (auto value : folders) {
        auto folder = value.toObject();
        auto tab = new QToolButton;
        tab->setObjectName("folderTab");
        tab->setProperty("folderId", folder.value("id").toString());
        tab->setToolButtonStyle(Qt::ToolButtonTextUnderIcon);
        tab->setIcon(nativeIcon(folder.value("rule") == "all"      ? "chats"
                                : folder.value("rule") == "direct" ? "person"
                                : folder.value("rule") == "unread" ? "unread"
                                                                   : "folder"));
        tab->setIconSize({27, 27});
        tab->setText(folder.value("name").toString().left(9));
        tab->setToolTip(folder.value("name").toString());
        tab->setFixedSize(62, 64);
        tab->setCheckable(true);
        tab->setChecked(folder.value("id").toString() == _folderId);
        group->addButton(tab);
        layout->addWidget(tab);
        connect(tab, &QToolButton::toggled, tab, [tab, folder](bool checked) {
            auto rule = folder.value("rule").toString();
            tab->setIcon(nativeIcon(rule == "all"      ? "chats"
                                    : rule == "direct" ? "person"
                                    : rule == "unread" ? "unread"
                                                       : "folder",
                                    QColor(checked ? "#6ab3f3" : "#8397a8")));
        });
        connect(tab, &QToolButton::clicked, this, [this, folder] {
            _selectedFolder = folder;
            _folderId = folder.value("id").toString();
            _filter->clear();
            showChats();
        });
    }
    layout->addStretch();
}
void Window::loadFolders() {
    _api->request("/folders", QJsonValue::Undefined, [this](ApiResult result) {
        if (!result.ok())
            return;
        _folders = result.value.toObject().value("folders").toArray();
        if (!_folderId.startsWith("builtin_")) {
            QJsonObject selected;
            for (auto value : _folders)
                if (value.toObject().value("id").toString() == _folderId)
                    selected = value.toObject();
            if (selected.isEmpty()) {
                _folderId = "builtin_all";
                selected = {{"rule", "all"}};
            }
            _selectedFolder = selected;
            showChats();
        }
        buildRail();
    });
}
void Window::filterChats(QString rule) {
    _selectedFolder = {{"rule", rule}};
    _folderId = "builtin_" + rule;
    _filter->clear();
    buildRail();
    showChats();
}
void Window::updateHeader() {
    auto name = _chat.value("name").toString("Пользователь");
    _chatTitle->setText(name.isEmpty() ? "Пользователь" : name);
    _chatTitle->setToolTip(_chatTitle->text());
    _chatAvatar->setPerson(_chatTitle->text(), _chat.value("peer_id").toVariant().toLongLong(),
                           _chat.value("avatar_url").toString(), _chat.value("kind") == "saved");
    QString status;
    bool online = _chat.value("peer_online").toBool();
    if (online)
        status = "в сети";
    else if (_chat.value("kind") == "saved")
        status = "Сообщения, ссылки и файлы для себя";
    else if (_chat.value("kind") == "group")
        status = _chat.value("parent_name").toString().isEmpty()
                     ? "Группа"
                     : "Тема · " + _chat.value("parent_name").toString();
    else if (_chat.value("kind") == "channel")
        status = "Канал";
    else {
        auto last =
            QDateTime::fromMSecsSinceEpoch(_chat.value("peer_last_seen").toVariant().toLongLong());
        auto seconds = last.secsTo(QDateTime::currentDateTime());
        status = last.toMSecsSinceEpoch() > 0
                     ? seconds < 60     ? "был(а) только что"
                       : seconds < 3600 ? QString("был(а) %1 мин. назад").arg(seconds / 60)
                                        : "был(а) " + last.toLocalTime().toString("d.MM в HH:mm")
                     : "не в сети";
    }
    _chatSubtitle->setText(status);
    _chatSubtitle->setProperty("online", online);
    _chatSubtitle->style()->unpolish(_chatSubtitle);
    _chatSubtitle->style()->polish(_chatSubtitle);
}
void Window::mainMenu() {
    QMenu menu(this);
    menu.setObjectName("mainMenuPopup");
    auto action = new QWidgetAction(&menu);
    auto card = new QWidget;
    card->setObjectName("menuProfile");
    auto body = new QVBoxLayout(card);
    body->setContentsMargins(16, 14, 16, 14);
    auto user = _api->session().value("user").toObject();
    auto avatar = new AvatarView(_avatars, 54);
    avatar->setPerson(user.value("name").toString(), user.value("id").toInt(),
                      user.value("avatar_url").toString());
    body->addWidget(avatar);
    body->addSpacing(5);
    body->addWidget(label(user.value("name").toString("Волна"), "profileName"));
    body->addWidget(label(user.value("phone").toString(), "subtitle"));
    action->setDefaultWidget(card);
    menu.addAction(action);
    menu.addSeparator();
    auto create = menu.addAction(nativeIcon("compose"), "Новый чат"),
         people = menu.addAction(nativeIcon("person"), "Контакты"),
         saved = menu.addAction(nativeIcon("bookmark"), "Избранное"),
         archive = menu.addAction(nativeIcon("archive"), "Архив");
    menu.addSeparator();
    auto prefs = menu.addAction(nativeIcon("settings"), "Настройки");
    auto chosen = menu.exec(findChild<QPushButton *>("menu")->mapToGlobal(QPoint(4, 42)));
    if (chosen == create)
        newChat();
    else if (chosen == people)
        contacts();
    else if (chosen == saved)
        savedMessages();
    else if (chosen == archive)
        filterChats("archived");
    else if (chosen == prefs)
        settings();
}
void Window::showEmoji() {
    auto popup = new QDialog(this, Qt::Popup);
    popup->setAttribute(Qt::WA_DeleteOnClose);
    popup->setObjectName("emojiPopup");
    auto grid = new QGridLayout(popup);
    grid->setContentsMargins(10, 10, 10, 10);
    grid->setSpacing(2);
    QStringList emojis = {"😀", "😄", "😁", "😊", "😉", "😍", "🥰", "😘", "👍", "👎", "❤️",
                          "🔥", "🎉", "👏", "🙏", "💪", "🤔", "😅", "😂", "🤣", "😎", "😢",
                          "😭", "😡", "👌", "👋", "✅", "⭐", "💯", "🎁", "☕", "🌹"};
    for (int i = 0; i < emojis.size(); ++i) {
        auto value = emojis[i];
        auto cell = button(value, "emojiChoice");
        cell->setFixedSize(38, 38);
        cell->setStyleSheet(
            "font-family:'Segoe UI Emoji','Noto Color Emoji';font-size:24px;padding:2px");
        grid->addWidget(cell, i / 8, i % 8);
        connect(cell, &QPushButton::clicked, popup, [this, popup, value] {
            _editor->insertPlainText(value);
            popup->close();
            _editor->setFocus();
        });
    }
    popup->adjustSize();
    auto point = _emoji->mapToGlobal(QPoint(-popup->width() + 40, -popup->height() - 8));
    auto available = screen()->availableGeometry();
    point.setX(std::clamp(point.x(), available.left(), available.right() - popup->width()));
    popup->move(point);
    popup->show();
}
void Window::savedMessages() {
    _api->request("/saved", QJsonObject{}, [this](ApiResult result) {
        if (!result.ok()) {
            error(result.error);
            return;
        }
        auto id = result.value.toObject().value("id").toVariant().toLongLong();
        _api->request("/chats", QJsonValue::Undefined, [this, id](ApiResult result) {
            if (!result.ok()) {
                error(result.error);
                return;
            }
            _chatRows = result.value.toArray();
            filterChats("all");
            openChat(id);
        });
    });
}
void Window::contacts() {
    auto dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle("Контакты");
    dialog->resize(390, 500);
    auto layout = new QVBoxLayout(dialog);
    layout->setContentsMargins(18, 18, 18, 18);
    layout->addWidget(label("Контакты", "dialogTitle"));
    auto input = new QLineEdit;
    input->setPlaceholderText("Поиск по имени");
    input->setClearButtonEnabled(true);
    layout->addWidget(input);
    auto list = new QListWidget;
    list->setObjectName("contactsList");
    layout->addWidget(list, 1);
    auto create = button("Найти пользователя", "primary");
    layout->addWidget(create);
    connect(create, &QPushButton::clicked, dialog, [this, dialog] {
        dialog->close();
        newChat();
    });
    QPointer<QDialog> alive(dialog);
    _api->request("/contacts", QJsonValue::Undefined, [this, alive, list, input](ApiResult result) {
        if (!alive)
            return;
        if (!result.ok()) {
            error(result.error);
            return;
        }
        for (auto value : result.value.toArray()) {
            auto user = value.toObject();
            auto item = new QListWidgetItem(
                user.value("name").toString() + "\n@" + user.value("username").toString(), list);
            item->setSizeHint({300, 60});
            item->setData(Qt::UserRole, user);
        }
        connect(input, &QLineEdit::textChanged, alive, [list](QString text) {
            for (int i = 0; i < list->count(); ++i)
                list->item(i)->setHidden(
                    !list->item(i)->text().contains(text, Qt::CaseInsensitive));
        });
    });
    connect(list, &QListWidget::itemClicked, dialog, [this, dialog](QListWidgetItem *item) {
        auto person = item->data(Qt::UserRole).toJsonObject();
        dialog->close();
        _api->request(
            "/chats", QJsonObject{{"user_id", person.value("id")}}, [this](ApiResult result) {
                if (!result.ok()) {
                    error(result.error);
                    return;
                }
                auto id = result.value.toObject().value("id").toVariant().toLongLong();
                _api->request("/chats", QJsonValue::Undefined, [this, id](ApiResult result) {
                    if (result.ok()) {
                        _chatRows = result.value.toArray();
                        filterChats("all");
                        openChat(id);
                    }
                });
            });
    });
    dialog->show();
}
void Window::searchMessages() {
    _searchBar->setVisible(!_searchBar->isVisible());
    if (_searchBar->isVisible())
        _chatSearch->setFocus();
    else {
        _chatSearch->clear();
        _searchResults->hide();
    }
}
void Window::chatMenu() {
    QMenu menu(this);
    auto info = menu.addAction(nativeIcon("person"), "Информация"),
         search = menu.addAction(nativeIcon("search"), "Поиск сообщений"),
         calendar = menu.addAction(nativeIcon("calendar"), "Перейти к дате");
    auto chosen = menu.exec(findChild<QPushButton *>("chatMenu")->mapToGlobal(QPoint(-170, 38)));
    if (chosen == info)
        chatInfo();
    else if (chosen == search)
        searchMessages();
    else if (chosen == calendar)
        chooseDate(QDate::currentDate());
}
void Window::chooseDate(QDate date) {
    auto popup = new QDialog(this, Qt::Popup);
    popup->setAttribute(Qt::WA_DeleteOnClose);
    auto layout = new QVBoxLayout(popup);
    auto calendar = new QCalendarWidget;
    calendar->setLocale(QLocale(QLocale::Russian, QLocale::Russia));
    calendar->setSelectedDate(date);
    calendar->setGridVisible(false);
    calendar->setVerticalHeaderFormat(QCalendarWidget::NoVerticalHeader);
    calendar->setFirstDayOfWeek(Qt::Monday);
    layout->addWidget(calendar);
    auto select = [this, popup](QDate date) {
        popup->close();
        openCalendar(date);
    };
    connect(calendar, &QCalendarWidget::clicked, popup, select);
    connect(calendar, &QCalendarWidget::activated, popup, select);
    popup->adjustSize();
    popup->move(mapToGlobal(QPoint(width() - popup->width() - 24, 78)));
    popup->show();
}

void Window::openCalendar(QDate date) {
    auto generation = ++_historyGeneration;
    auto offset = -QDateTime(date, QTime(12, 0)).offsetFromUtc() / 60;
    _api->request("/chats/" + QString::number(_chatId) + "/calendar?date=" +
                      date.toString(Qt::ISODate) + "&tz=" + QString::number(offset),
                  QJsonValue::Undefined, [this, generation](ApiResult result) {
                      if (generation != _historyGeneration)
                          return;
                      _historyBusy = false;
                      if (!result.ok()) {
                          error(result.error);
                          return;
                      }
                      auto value = result.value.toObject();
                      anchorMessages(value.value("messages").toArray(),
                                     value.value("anchor_id").toVariant().toLongLong());
                  });
}
void Window::anchorMessages(QJsonArray rows, qint64 anchor) {
    _messageRows.clear();
    for (auto value : rows) {
        auto message = value.toObject();
        _messageRows[message.value("id").toVariant().toLongLong()] = message;
    }
    _anchor = anchor;
    renderMessages();
    _latest->setText("К последним сообщениям ↓");
    _latest->show();
    for (int i = 0; i < _messages->count(); ++i)
        if (_messages->item(i)->data(Qt::UserRole).toLongLong() == anchor) {
            _messages->scrollToItem(_messages->item(i), QAbstractItemView::PositionAtCenter);
            break;
        }
}
void Window::latestMessages() {
    ++_historyGeneration;
    _historyBusy = false;
    _anchor = 0;
    _exhausted = false;
    _messageRows.clear();
    _latest->hide();
    loadHistory();
}
void Window::chatInfo() {
    auto dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle("Информация");
    dialog->setFixedWidth(380);
    auto layout = new QVBoxLayout(dialog);
    layout->setContentsMargins(26, 26, 26, 26);
    layout->setSpacing(14);
    auto avatar = new AvatarView(_avatars, 88);
    avatar->setPerson(_chatTitle->text(), _chat.value("peer_id").toInt(),
                      _chat.value("avatar_url").toString(), _chat.value("kind") == "saved");
    layout->addWidget(avatar, 0, Qt::AlignHCenter);
    auto title = label(_chatTitle->text(), "dialogTitle");
    title->setAlignment(Qt::AlignCenter);
    layout->addWidget(title);
    auto desc = label(_chatSubtitle->text(), "subtitle");
    desc->setAlignment(Qt::AlignCenter);
    layout->addWidget(desc);
    auto username = _chat.value("username").toString();
    if (_chat.value("kind") == "direct" && !username.isEmpty()) {
        auto copy = button("@" + username, "profileLink");
        copy->setToolTip("Копировать имя пользователя");
        layout->addWidget(copy);
        connect(copy, &QPushButton::clicked, dialog,
                [username] { qApp->clipboard()->setText("@" + username); });
    }
    auto bio = label({}, "profileBio");
    layout->addWidget(bio);
    if (_chat.value("kind") == "direct") {
        QPointer<QLabel> alive(bio);
        _api->request("/users/" + QString::number(_chat.value("peer_id").toInt()),
                      QJsonValue::Undefined, [alive](ApiResult result) {
                          if (alive && result.ok())
                              alive->setText(result.value.toObject().value("bio").toString());
                      });
    }
    auto close = button("Закрыть", "primary");
    layout->addWidget(close);
    connect(close, &QPushButton::clicked, dialog, &QDialog::close);
    dialog->show();
}
void Window::settings() {
    QDialog dialog(this);
    dialog.setObjectName("settingsDialog");
    dialog.setWindowTitle("Настройки");
    dialog.setFixedWidth(440);
    auto layout = new QVBoxLayout(&dialog);
    layout->setContentsMargins(24, 20, 24, 20);
    layout->setSpacing(18);
    layout->addWidget(label("Настройки", "dialogTitle"));
    auto user = _api->session().value("user").toObject();
    if (_userId) {
        auto row = new QHBoxLayout;
        auto avatar = new AvatarView(_avatars, 64);
        avatar->setPerson(user.value("name").toString(), _userId,
                          user.value("avatar_url").toString());
        row->addWidget(avatar);
        auto details = new QVBoxLayout;
        details->addWidget(label(user.value("name").toString(), "profileName"));
        details->addWidget(label(user.value("phone").toString(), "subtitle"));
        row->addLayout(details, 1);
        layout->addLayout(row);
    }
    auto section = label("ОФОРМЛЕНИЕ", "sectionTitle");
    layout->addWidget(section);
    auto themeRow = new QHBoxLayout;
    themeRow->addWidget(label("Ночная тема"), 1);
    auto dark = new Toggle;
    dark->setAccessibleName("Ночная тема");
    dark->setChecked(QSettings().value("dark", true).toBool());
    themeRow->addWidget(dark);
    layout->addLayout(themeRow);
    connect(dark, &QAbstractButton::toggled, &dialog, [this](bool value) {
        QSettings().setValue("dark", value);
        _theme = Theme::load(value);
        _theme.apply(*qApp);
        _chats->viewport()->update();
        renderMessages(true);
    });
    auto trayRow = new QHBoxLayout;
    trayRow->addWidget(label("Показывать значок в трее"), 1);
    auto tray = new Toggle;
    tray->setAccessibleName("Показывать значок в трее");
    tray->setChecked(_tray && _tray->isVisible());
    tray->setEnabled(_tray);
    trayRow->addWidget(tray);
    layout->addLayout(trayRow);
    connect(tray, &QAbstractButton::toggled, &dialog, [this](bool value) {
        QSettings().setValue("tray", value);
        if (_tray)
            _tray->setVisible(value);
    });
    layout->addWidget(label("ПОДКЛЮЧЕНИЕ", "sectionTitle"));
    layout->addWidget(label(_api->origin().host(), "subtitle"));
    auto diagnostic = button("Копировать диагностику подключения", "settingsAction");
    layout->addWidget(diagnostic);
    connect(diagnostic, &QPushButton::clicked, &dialog, [this, diagnostic] {
        QJsonObject info{{"app", "Volna Native Desktop"},
                         {"version", VOLNA_NATIVE_VERSION},
                         {"qt", qVersion()},
                         {"server", _api->origin().toString()},
                         {"tls", QSslSocket::activeBackend()},
                         {"tls_available", QSslSocket::supportsSsl()}};
        qApp->clipboard()->setText(QString::fromUtf8(QJsonDocument(info).toJson()));
        diagnostic->setText("Диагностика скопирована");
    });
    layout->addWidget(label("Волна Desktop · " VOLNA_NATIVE_VERSION, "subtitle"));
    auto releases = button("Открыть страницу выпусков", "settingsAction");
    layout->addWidget(releases);
    connect(releases, &QPushButton::clicked, &dialog,
            [] { QDesktopServices::openUrl(QUrl("https://github.com/andluk87/volna/releases")); });
    if (_userId) {
        auto logout = button("Выйти из аккаунта", "logout");
        layout->addWidget(logout);
        connect(logout, &QPushButton::clicked, &dialog, [this, &dialog] {
            if ((_calls && _calls->active()) || _recording) {
                error("Сначала завершите звонок или запись");
                return;
            }
            if (QMessageBox::question(this, "Выйти из аккаунта?",
                                      "Переписка останется на сервере") != QMessageBox::Yes)
                return;
            dialog.accept();
            _api->logout([this](ApiResult result) {
                if (!result.ok())
                    error(result.error);
            });
        });
    }
    auto close = button("Готово", "primary");
    layout->addWidget(close);
    connect(close, &QPushButton::clicked, &dialog, &QDialog::accept);
    dialog.exec();
}
void Window::resizeEvent(QResizeEvent *event) {
    QMainWindow::resizeEvent(event);
    if (!_renderQueued && _messages && !_messageRows.isEmpty()) {
        _renderQueued = true;
        QTimer::singleShot(0, this, [this] {
            _renderQueued = false;
            renderMessages(true);
        });
    }
}
