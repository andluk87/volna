#pragma once
#include "api.h"
#include "calls.h"
#include "theme.h"
#include "widgets.h"
#include <QDate>
#include <QJsonArray>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMainWindow>
#include <QMap>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSet>
#include <QStackedWidget>
#include <QSystemTrayIcon>
class Window : public QMainWindow {
    Q_OBJECT
  public:
    explicit Window(Api *api, QWidget *parent = nullptr);

  protected:
    void closeEvent(QCloseEvent *event) override;
    void changeEvent(QEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;

  private:
    QWidget *login();
    QWidget *messenger();
    void settings();
    void mainMenu();
    void contacts();
    void savedMessages();
    void showEmoji();
    void chatMenu();
    void chatInfo();
    void filterChats(QString rule);
    void searchMessages();
    void updateHeader();
    void openCalendar(QDate date);
    void chooseDate(QDate date);
    void loadFolders();
    void buildRail();
    void anchorMessages(QJsonArray rows, qint64 anchor);
    void latestMessages();

    void error(QString text);
    void beginQr();
    void pollQr(int generation);
    void requestCode();
    void verifyCode();
    void cancelLogin();
    void loggedIn();
    void refreshChats();
    void showChats();
    void openChat(qint64 id);
    void loadHistory(bool older = false);
    void renderMessages(bool preserve = false);
    void sendMessage(QString attachment = {});
    void postPending(qint64 chat);
    void composerState();
    void attachFile();
    void openFile(QJsonObject message);
    void messageMenu(QPoint point);
    void newChat();
    void presence();
    void receive(QJsonObject event);
    Api *_api;
    Theme _theme;
    AvatarStore *_avatars;
    AvatarView *_chatAvatar;
    QStackedWidget *_conversationStack;
    QWidget *_errorFrame, *_folderRail, *_searchBar;
    QLineEdit *_chatSearch;
    QListWidget *_searchResults;
    QPushButton *_emoji, *_latest;
    QJsonArray _folders;
    QString _folderId = "builtin_all";
    QJsonObject _selectedFolder{{"rule", "all"}};
    qint64 _anchor = 0;
    bool _renderQueued = false;
    QTimer _searchTimer;

    QStackedWidget *_root, *_loginPages;
    QLabel *_error, *_qrImage, *_qrStatus, *_codeStatus, *_chatTitle, *_chatSubtitle, *_empty;
    QLineEdit *_phone, *_code, *_filter;
    QPushButton *_requestCode, *_verify, *_resend, *_send, *_attach, *_voice, *_audio, *_video,
        *_older;
    QPlainTextEdit *_editor;
    QListWidget *_chats = nullptr, *_messages = nullptr;
    QJsonArray _chatRows;
    QMap<qint64, QJsonObject> _messageRows;
    QJsonObject _chat, _qr, _challenge, _pendingRequest;
    QHash<qint64, QJsonObject> _outbox;
    QSet<qint64> _sending;
    QHash<qint64, QString> _drafts;
    qint64 _chatId = 0, _pendingChat = 0, _userId = 0, _retryAt = 0, _codeDeadline = 0,
           _qrDeadline = 0;
    int _loginGeneration = 0, _historyGeneration = 0, _presenceSequence = 0;
    bool _phoneBusy = false, _historyBusy = false, _recording = false, _refreshChatsBusy = false,
         _quitting = false, _exhausted = false;
    QString _presenceClient = Api::nonce(16);
    QTimer _qrTimer, _uiTimer, _presenceTimer, _chatRefreshTimer;
    Calls *_calls = nullptr;
    QSystemTrayIcon *_tray = nullptr;
};
