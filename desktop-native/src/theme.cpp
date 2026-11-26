#include "theme.h"
#include "qrcodegen.hpp"
#include <QApplication>
#include <QFile>
#include <QRegularExpression>
#include <QPalette>
static void resources(){Q_INIT_RESOURCE(resources);}
Theme Theme::load(bool dark){resources();QFile file(dark?":/volna/night.theme":":/volna/day.theme");file.open(QIODevice::ReadOnly);Theme result;const QString text=QString::fromUtf8(file.readAll());QRegularExpression pattern("(?:^|\\n)\\s*([A-Za-z][A-Za-z0-9]*):\\s*([^;]+);");auto it=pattern.globalMatch(text);while(it.hasNext()){auto match=it.next();result.values.insert(match.captured(1),match.captured(2).trimmed());}return result;}
QColor Theme::color(const QString &name,QColor fallback)const{auto value=values.value(name);for(int i=0;i<20&&!value.startsWith('#');++i){if(!values.contains(value))return fallback;value=values.value(value);}if(value.size()==9)value="#"+value.mid(7,2)+value.mid(1,6);auto result=QColor(value);return result.isValid()?result:fallback;}
void Theme::apply(QApplication &app)const{
 QPalette palette;palette.setColor(QPalette::Window,color("windowBg"));palette.setColor(QPalette::WindowText,color("windowFg"));palette.setColor(QPalette::Base,color("historyBg",color("windowBg")));palette.setColor(QPalette::AlternateBase,color("windowBgOver"));palette.setColor(QPalette::Text,color("windowFg"));palette.setColor(QPalette::Button,color("windowBg"));palette.setColor(QPalette::ButtonText,color("windowFg"));palette.setColor(QPalette::Highlight,color("activeButtonBg"));palette.setColor(QPalette::HighlightedText,color("activeButtonFg",Qt::white));palette.setColor(QPalette::PlaceholderText,color("windowSubTextFg"));app.setPalette(palette);
 auto bg=color("windowBg").name(),fg=color("windowFg").name(),over=color("windowBgOver").name(),sub=color("windowSubTextFg").name(),accent=color("activeButtonBg").name();
 app.setStyleSheet(QString(R"(
 QWidget{font-family:'Segoe UI','Noto Sans',sans-serif;font-size:14px;color:%2;}
 QMainWindow,QDialog,QWidget#login,QWidget#sidebar,QWidget#header,QWidget#composer{background:%1;}
 QLabel#title{font-size:23px;font-weight:600;} QLabel#subtitle{color:%4;}
 QLabel#error{color:#ef7777;padding:7px;} QLabel#notice{color:%4;padding:5px;}
 QPushButton{border:0;border-radius:6px;padding:10px 14px;background:transparent;} QPushButton:hover{background:%3;}
 QPushButton#primary{background:%5;color:white;min-height:24px;} QPushButton#primary:disabled{background:%3;color:%4;}
 QLineEdit,QPlainTextEdit{border:0;border-bottom:2px solid %3;padding:10px;background:transparent;selection-background-color:%5;}
 QLineEdit:focus,QPlainTextEdit:focus{border-bottom-color:%5;}
 QListWidget{border:0;background:%1;outline:0;} QListWidget::item{border:0;padding:7px;} QListWidget::item:selected{background:%5;}
 QListWidget#messages{background:%6;} QScrollArea{border:0;} QMenu{background:%1;padding:5px;} QMenu::item{padding:9px 22px;} QMenu::item:selected{background:%3;}
 QSplitter::handle{background:%3;width:1px;} QScrollBar:vertical{width:7px;background:transparent;} QScrollBar::handle:vertical{background:%3;border-radius:3px;min-height:20px;} QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}
 )").arg(bg,fg,over,sub,accent,color("historyBg",color("windowBg")).name()));
}
QImage loginQr(const QString &text,int scale){if(text.size()>1000||scale<1||scale>20)return {};const auto qr=qrcodegen::QrCode::encodeText(text.toUtf8().constData(),qrcodegen::QrCode::Ecc::MEDIUM);const int border=4,size=qr.getSize()+border*2;QImage image(size*scale,size*scale,QImage::Format_RGB32);image.fill(Qt::white);for(int y=0;y<qr.getSize();++y)for(int x=0;x<qr.getSize();++x)if(qr.getModule(x,y))for(int dy=0;dy<scale;++dy)for(int dx=0;dx<scale;++dx)image.setPixel((x+border)*scale+dx,(y+border)*scale+dy,qRgb(0,0,0));return image;}
