#include "theme.h"
#include "qrcodegen.hpp"
#include <QApplication>
#include <QFile>
#include <QPalette>
#include <QRegularExpression>
static void resources() {
    Q_INIT_RESOURCE(resources);
}
Theme Theme::load(bool dark) {
    resources();
    QFile file(dark ? ":/volna/night.theme" : ":/volna/day.theme");
    Theme result;
    if (!file.open(QIODevice::ReadOnly))
        return result;
    const QString text = QString::fromUtf8(file.readAll());
    QRegularExpression pattern("(?:^|\\n)\\s*([A-Za-z][A-Za-z0-9]*):\\s*([^;]+);");
    auto it = pattern.globalMatch(text);
    while (it.hasNext()) {
        auto match = it.next();
        result.values.insert(match.captured(1), match.captured(2).trimmed());
    }
    return result;
}
QColor Theme::color(const QString &name, QColor fallback) const {
    auto value = values.value(name);
    for (int i = 0; i < 20 && !value.startsWith('#'); ++i) {
        if (!values.contains(value))
            return fallback;
        value = values.value(value);
    }
    if (value.size() == 9)
        value = "#" + value.mid(7, 2) + value.mid(1, 6);
    auto result = QColor(value);
    return result.isValid() ? result : fallback;
}
void Theme::apply(QApplication &app) const {
    QPalette palette;
    palette.setColor(QPalette::Window, color("windowBg"));
    palette.setColor(QPalette::WindowText, color("windowFg"));
    palette.setColor(QPalette::Base,
                     color("historyBg", (color("windowBg").lightness() < 128 ? QColor("#0e1621")
                                                                             : QColor("#e7ebef"))));
    palette.setColor(QPalette::AlternateBase, color("windowBgOver"));
    palette.setColor(QPalette::Text, color("windowFg"));
    palette.setColor(QPalette::Button, color("windowBg"));
    palette.setColor(QPalette::ButtonText, color("windowFg"));
    palette.setColor(QPalette::Highlight, color("activeButtonBg"));
    palette.setColor(QPalette::HighlightedText, color("activeButtonFg", Qt::white));
    palette.setColor(QPalette::PlaceholderText, color("windowSubTextFg"));
    app.setPalette(palette);
    auto bg = color("windowBg").name(), fg = color("windowFg").name(),
         over = color("windowBgOver").name(), sub = color("windowSubTextFg").name(),
         accent = color("activeButtonBg").name();
    app.setStyleSheet(
        QString(R"(
 QWidget{font-family:'Segoe UI','Noto Sans',sans-serif;font-size:14px;color:%2;}
 QMainWindow,QDialog,QWidget#login,QWidget#sidebar,QWidget#header,QWidget#composer,QWidget#sidebarTop,QWidget#chatSearchBar{background:%1;}
 QWidget#header{border-bottom:1px solid %3;} QWidget#composer{border-top:1px solid %3;}
 QWidget#rail,QScrollArea#railScroll,QScrollArea#railScroll>QWidget>QWidget{background:%7;border:0;}
 QWidget#conversationEmpty{background:%6;} QLabel#emptyTitle{font-size:20px;font-weight:600;margin-top:18px;} QLabel#emptyHint{color:%4;font-size:14px;margin:10px;}
 QLabel#title{font-size:24px;font-weight:600;} QLabel#dialogTitle{font-size:20px;font-weight:600;} QLabel#profileName{font-size:17px;font-weight:600;}
 QLabel#subtitle,QLabel#chatSubtitle{color:%4;font-size:13px;} QLabel#chatTitle{font-size:14px;font-weight:600;} QLabel#chatSubtitle[online=true]{color:#6ab3f3;}
 QWidget#errorBanner{background:#432c35;border-bottom:1px solid #6d3f4b;} QLabel#error{color:#ffc1c1;padding:2px;} QPushButton#dismissError{font-size:22px;padding:0;color:#ffc1c1;}
 QLabel#notice{color:%4;padding:5px;} QLabel#sectionTitle{font-size:11px;font-weight:600;color:#6ab3f3;margin-top:10px;}
 QPushButton{border:0;border-radius:8px;padding:8px 12px;background:transparent;} QPushButton:hover{background:%3;} QPushButton:disabled{color:%4;}
 QPushButton[tool=true]{padding:4px;border-radius:18px;} QPushButton#primary{background:%5;color:white;min-height:24px;padding:10px 18px;}
 QPushButton#primary:disabled{background:%3;color:%4;} QPushButton#settingsAction{text-align:left;padding:10px 4px;} QPushButton#logout{text-align:left;color:#ed7777;padding:10px 4px;}
 QLineEdit,QPlainTextEdit{border:0;border-bottom:2px solid %3;padding:10px;background:transparent;selection-background-color:%5;}
 QLineEdit:focus,QPlainTextEdit:focus{border-bottom-color:%5;}
 QLineEdit#filter{background:%3;border:0;border-radius:18px;padding:7px 8px;font-size:14px;min-height:22px;}
 QLineEdit#chatSearch{background:%3;border:0;border-radius:15px;padding:7px 12px;}
 QPlainTextEdit#editor{border:0;background:transparent;padding:7px 3px;font-size:14px;}
 QToolButton#folderTab{border:0;border-radius:8px;color:%4;background:transparent;font-size:11px;padding:6px 0;}
 QToolButton#folderTab:hover{background:%3;} QToolButton#folderTab:checked{color:#6ab3f3;background:%3;}
 QListWidget{border:0;background:%1;outline:0;} QListWidget::item{border:0;padding:0;} QListWidget::item:selected{background:%5;}
 QListWidget#messages{background:%6;} QListWidget#messages::item{padding:0;margin:0;}
 QListWidget#searchResults::item,QListWidget#contactsList::item{padding:8px 12px;border-bottom:1px solid %3;}
 QPushButton#dateChip{background:%3;border-radius:12px;padding:3px 12px;font-size:12px;font-weight:600;min-height:18px;}
 QPushButton#dateChip:hover{background:%5;}
 QPushButton#olderMessages,QPushButton#latestMessages{color:#6ab3f3;font-size:12px;border-radius:0;background:%6;}
 QScrollArea{border:0;} QMenu{background:%1;border:1px solid %3;padding:6px;border-radius:8px;}
 QMenu::item{padding:10px 18px;border-radius:5px;} QMenu::item:selected{background:%3;} QMenu::separator{height:1px;background:%3;margin:5px 4px;}
 QSplitter::handle{background:%3;width:1px;} QScrollBar:vertical{width:6px;background:transparent;margin:0;}
 QScrollBar::handle:vertical{background:%3;border-radius:3px;min-height:28px;} QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}
 QScrollBar::add-page:vertical,QScrollBar::sub-page:vertical{background:transparent;}
 QCalendarWidget QWidget{background:%1;} QCalendarWidget QToolButton{color:%2;background:%1;padding:6px;}
 )")
            .arg(bg, fg, over, sub, accent,
                 color("historyBg", (color("windowBg").lightness() < 128 ? QColor("#0e1621")
                                                                         : QColor("#e7ebef")))
                     .name(),
                 color("windowBg").lightness() < 128 ? "#0e1822" : "#e8edf2"));
}
QImage loginQr(const QString &text, int scale) {
    if (text.size() > 1000 || scale < 1 || scale > 20)
        return {};
    const auto qr =
        qrcodegen::QrCode::encodeText(text.toUtf8().constData(), qrcodegen::QrCode::Ecc::MEDIUM);
    const int border = 4, size = qr.getSize() + border * 2;
    QImage image(size * scale, size * scale, QImage::Format_RGB32);
    image.fill(Qt::white);
    for (int y = 0; y < qr.getSize(); ++y)
        for (int x = 0; x < qr.getSize(); ++x)
            if (qr.getModule(x, y))
                for (int dy = 0; dy < scale; ++dy)
                    for (int dx = 0; dx < scale; ++dx)
                        image.setPixel((x + border) * scale + dx, (y + border) * scale + dy,
                                       qRgb(0, 0, 0));
    return image;
}
