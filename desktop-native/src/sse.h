#pragma once
#include <QByteArray>
#include <QJsonObject>
#include <QList>
class SseParser {
public:
 QList<QJsonObject> append(const QByteArray &chunk);
 void clear(){_buffer.clear();_data.clear();}
private:
 QByteArray _buffer,_data;
};
