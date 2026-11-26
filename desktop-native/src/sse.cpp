#include "sse.h"
#include <QJsonDocument>
QList<QJsonObject> SseParser::append(const QByteArray &chunk) {
    QList<QJsonObject> result;
    _buffer += chunk;
    if (_buffer.size() > 1024 * 1024) {
        clear();
        return result;
    }
    qsizetype end;
    while ((end = _buffer.indexOf('\n')) >= 0) {
        auto line = _buffer.left(end);
        _buffer.remove(0, end + 1);
        if (line.endsWith('\r'))
            line.chop(1);
        if (line.isEmpty()) {
            if (!_data.isEmpty()) {
                auto document = QJsonDocument::fromJson(_data);
                if (document.isObject())
                    result.append(document.object());
            }
            _data.clear();
        } else if (line.startsWith("data:")) {
            auto value = line.mid(5);
            if (value.startsWith(' '))
                value.remove(0, 1);
            if (!_data.isEmpty())
                _data += '\n';
            _data += value;
        }
        if (_data.size() > 1024 * 1024)
            _data.clear();
    }
    return result;
}
