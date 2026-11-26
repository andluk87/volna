#include "calls.h"
#include <QWebChannel>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineSettings>
#include <QWebEnginePermission>
#include <QWebEngineDesktopMediaRequest>
#include <QWebEngineScriptCollection>
#include <QCloseEvent>
#include <QFile>
#include <QVBoxLayout>
#include <QLabel>
#include <QPushButton>
static bool sameOrigin(const QUrl &a,const QUrl &b){return a.scheme()==b.scheme()&&a.host()==b.host()&&a.port()==b.port();}
class CallPage : public QWebEnginePage {
public:
 CallPage(QWebEngineProfile *profile,QUrl origin,QObject *parent):QWebEnginePage(profile,parent),origin(origin){}
 QUrl origin;
 bool acceptNavigationRequest(const QUrl &url,NavigationType,bool main)override{return !main||(sameOrigin(url,origin)&&url.path()=="/native-call.html"&&url.query().isEmpty()&&url.fragment().isEmpty());}
 QWebEnginePage *createWindow(WebWindowType)override{return nullptr;}
};
QVariantMap CallBridge::session()const{auto value=api->session();value.remove("refresh_token");return value.toVariantMap();}
void CallBridge::loaded(){ready=true;emit engineReady();}
void CallBridge::state(QVariantMap value){active=value.value("active").toBool();emit activityChanged(active,value.value("incoming").toBool());}
void CallBridge::failed(QString message){emit problem(message.left(600));}
void CallBridge::refresh(QString id,QString failedToken){api->refresh([this,id](ApiResult result){auto value=result.value.toObject();value.remove("refresh_token");emit refreshFinished(id,result.status,value.toVariantMap());},failedToken);}
void CallBridge::voiceUploaded(QVariantMap attachment){emit attachmentReady(QJsonObject::fromVariantMap(attachment));}
Calls::Calls(Api *api,QWidget *parent):QDialog(parent),_api(api){
 setWindowTitle("Волна · звонок");resize(660,720);setModal(false);auto layout=new QVBoxLayout(this);layout->setContentsMargins(0,0,0,0);
 _bridge=new CallBridge(api,this);_view=new QWebEngineView(this);auto profile=new QWebEngineProfile(this);profile->setHttpCacheType(QWebEngineProfile::MemoryHttpCache);profile->setPersistentCookiesPolicy(QWebEngineProfile::NoPersistentCookies);
 auto page=new CallPage(profile,api->origin(),_view);_view->setPage(page);page->settings()->setAttribute(QWebEngineSettings::PlaybackRequiresUserGesture,false);page->settings()->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows,false);page->settings()->setAttribute(QWebEngineSettings::ScreenCaptureEnabled,true);
 auto channel=new QWebChannel(page);channel->registerObject("volnaNative",_bridge);page->setWebChannel(channel);
 QFile transport(":/qtwebchannel/qwebchannel.js");transport.open(QIODevice::ReadOnly);QWebEngineScript script;script.setName("VolnaNativeTransport");script.setInjectionPoint(QWebEngineScript::DocumentCreation);script.setWorldId(QWebEngineScript::MainWorld);script.setRunsOnSubFrames(false);script.setSourceCode(QString::fromUtf8(transport.readAll()));page->scripts().insert(script);
 connect(page,&QWebEnginePage::permissionRequested,this,[api](QWebEnginePermission permission){auto type=permission.permissionType();if(sameOrigin(permission.origin(),api->origin())&&(type==QWebEnginePermission::PermissionType::MediaAudioCapture||type==QWebEnginePermission::PermissionType::MediaVideoCapture||type==QWebEnginePermission::PermissionType::MediaAudioVideoCapture))permission.grant();else permission.deny();});
 connect(page,&QWebEnginePage::desktopMediaRequested,this,[](const QWebEngineDesktopMediaRequest &request){request.cancel();}); // Screen sharing requires a native picker; never capture silently.
 connect(_view,&QWebEngineView::loadFinished,this,[this](bool ok){if(!ok){_bridge->ready=false;emit problem("Модуль звонков не загружен. Обновите Web на сервере и проверьте сеть");}});
 connect(_bridge,&CallBridge::activityChanged,this,[this](bool active,bool incoming){if(active){show();raise();if(incoming)activateWindow();}else hide();});
 connect(_bridge,&CallBridge::problem,this,[this](QString message){emit problem(message);});connect(_bridge,&CallBridge::attachmentReady,this,&Calls::attachmentReady);
 connect(api,&Api::sessionChanged,this,[this]{emit _bridge->sessionUpdated(_bridge->session());});
 connect(api,&Api::sessionInvalid,this,[this]{emit _bridge->sessionUpdated({});_bridge->active=false;hide();});
 layout->addWidget(_view);_view->load(api->origin().resolved(QUrl("/native-call.html")));
}
void Calls::start(QJsonObject chat,bool video){if(!ready()){emit problem("Модуль звонков ещё загружается. Повторите через несколько секунд");return;}if(active()){show();raise();return;}show();raise();emit _bridge->command("start",{{"chat",chat.toVariantMap()},{"video",video}});}
void Calls::media(QByteArray bytes,QString mime){if(!ready()){emit problem("Модуль воспроизведения ещё загружается");return;}show();raise();emit _bridge->command("media",{{"base64",QString::fromLatin1(bytes.toBase64())},{"mime",mime}});}
void Calls::record(bool start,qint64 chat){if(!ready()||active()){emit problem("Дождитесь загрузки модуля и завершите звонок перед записью");return;}emit _bridge->command(start?"record":"stop-record",{{"chatId",chat}});}
void Calls::dispatch(QJsonObject event){if(ready())emit _bridge->command("event",event.toVariantMap());}
void Calls::closeEvent(QCloseEvent *event){event->ignore();hide();}
