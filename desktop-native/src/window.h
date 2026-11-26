#pragma once
#include "api.h"
#include "theme.h"
#include "calls.h"
#include <QMainWindow>
#include <QStackedWidget>
#include <QLineEdit>
#include <QLabel>
#include <QPlainTextEdit>
#include <QListWidget>
#include <QPushButton>
#include <QSystemTrayIcon>
#include <QMap>
#include <QJsonArray>
class Window : public QMainWindow {
 Q_OBJECT
public:
 explicit Window(Api *api,QWidget *parent=nullptr);
protected:
 void closeEvent(QCloseEvent *event)override;
 void changeEvent(QEvent *event)override;
private:
 QWidget *login();QWidget *messenger();
 void settings();void error(QString text);void beginQr();void pollQr(int generation);void requestCode();void verifyCode();void cancelLogin();void loggedIn();
 void refreshChats();void showChats();void openChat(qint64 id);void loadHistory(bool older=false);void renderMessages(bool preserve=false);void sendMessage(QString attachment={});void postPending();void attachFile();void openFile(QJsonObject message);void messageMenu(QPoint point);void newChat();void presence();void receive(QJsonObject event);
 Api *_api;Theme _theme;QStackedWidget *_root,*_loginPages;QLabel *_error,*_qrImage,*_qrStatus,*_codeStatus,*_chatTitle,*_chatSubtitle,*_empty;
 QLineEdit *_phone,*_code,*_filter;QPushButton *_requestCode,*_verify,*_resend,*_send,*_attach,*_voice,*_audio,*_video,*_older;
 QPlainTextEdit *_editor;QListWidget *_chats,*_messages;QJsonArray _chatRows;QMap<qint64,QJsonObject> _messageRows;QJsonObject _chat,_qr,_challenge,_pendingRequest,_pendingSend;
 QHash<qint64,QString> _drafts;qint64 _chatId=0,_pendingChat=0,_userId=0,_retryAt=0,_codeDeadline=0,_qrDeadline=0;
 int _loginGeneration=0,_historyGeneration=0,_presenceSequence=0;bool _phoneBusy=false,_historyBusy=false,_sendBusy=false,_recording=false,_refreshChatsBusy=false,_quitting=false,_exhausted=false,_unreadRefresh=false;
 QString _presenceClient=Api::nonce(16);QTimer _qrTimer,_uiTimer,_presenceTimer,_chatRefreshTimer;Calls *_calls=nullptr;QSystemTrayIcon *_tray=nullptr;
};
