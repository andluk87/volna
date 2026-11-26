#pragma once
#include <QColor>
#include <QHash>
#include <QImage>
#include <QString>
class QApplication;
struct Theme {
 QHash<QString,QString> values;
 static Theme load(bool dark);
 QColor color(const QString &name,QColor fallback=Qt::black)const;
 void apply(QApplication &app)const;
};
QImage loginQr(const QString &text,int scale=5);
