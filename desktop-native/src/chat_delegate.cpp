#include "chat_delegate.h"
#include <QDateTime>
#include <QJsonObject>
#include <QPainter>
#include <QPainterPath>
#include <algorithm>
void ChatDelegate::paint(QPainter *painter, const QStyleOptionViewItem &option,
                         const QModelIndex &index) const {
    auto chat = index.data(Qt::UserRole + 1).toJsonObject();
    auto name = chat.value("name").toString();
    if (name.isEmpty())
        name = "Пользователь";
    bool selected = option.state & QStyle::State_Selected;
    painter->save();
    painter->setRenderHint(QPainter::Antialiasing);
    auto rect = option.rect;
    painter->fillRect(rect, selected ? option.palette.highlight() : option.palette.window());
    auto avatar = QRectF(rect.left() + 12, rect.top() + 11, 48, 48);
    paintAvatar(*painter, avatar, name, chat.value("peer_id").toVariant().toLongLong(),
                store->image(chat.value("avatar_url").toString()),
                chat.value("kind").toString() == "saved");
    auto font = option.font;
    auto left = rect.left() + 74;
    auto right = rect.right() - 12;
    auto time = QDateTime::fromString(chat.value("last_at").toString(), Qt::ISODate).toLocalTime();
    auto stamp = time.isValid() ? time.toString("HH:mm") : QString();
    font.setPixelSize(12);
    font.setWeight(QFont::Normal);
    painter->setFont(font);
    auto sub = selected ? QColor("#deecf7") : option.palette.color(QPalette::PlaceholderText);
    painter->setPen(sub);
    painter->drawText(QRect(right - 50, rect.top() + 15, 50, 20), Qt::AlignRight | Qt::AlignVCenter,
                      stamp);
    font.setPixelSize(14);
    font.setWeight(QFont::DemiBold);
    painter->setFont(font);
    painter->setPen(selected ? QColor(Qt::white) : option.palette.color(QPalette::WindowText));
    painter->drawText(
        QRect(left, rect.top() + 15, std::max(10, right - left - 55), 21), Qt::AlignVCenter,
        painter->fontMetrics().elidedText(name, Qt::ElideRight, std::max(10, right - left - 55)));
    int unread = chat.value("unread").toInt();
    int extra = unread ? 40 : 0;
    font.setPixelSize(13);
    font.setWeight(QFont::Normal);
    painter->setFont(font);
    painter->setPen(sub);
    painter->drawText(
        QRect(left, rect.top() + 39, std::max(10, right - left - extra), 20), Qt::AlignVCenter,
        painter->fontMetrics().elidedText(chat.value("last_text").toString(), Qt::ElideRight,
                                          std::max(10, right - left - extra)));
    if (unread) {
        auto badge = QRect(right - 31, rect.top() + 39, 31, 22);
        painter->setBrush(selected ? QColor("#8cc2e8") : QColor("#5288c1"));
        painter->setPen(Qt::NoPen);
        painter->drawRoundedRect(badge, 11, 11);
        painter->setPen(Qt::white);
        painter->drawText(badge, Qt::AlignCenter, unread > 999 ? "999+" : QString::number(unread));
    }
    painter->restore();
}
QIcon nativeIcon(QString name, QColor color) {
    QPixmap image(28, 28);
    image.fill(Qt::transparent);
    QPainter p(&image);
    p.setRenderHint(QPainter::Antialiasing);
    p.setPen(QPen(color, 1.7, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
    p.setBrush(Qt::NoBrush);
    if (name == "menu")
        for (int y : {8, 14, 20})
            p.drawLine(6, y, 22, y);
    else if (name == "plus") {
        p.drawLine(14, 6, 14, 22);
        p.drawLine(6, 14, 22, 14);
    } else if (name == "search") {
        p.drawEllipse(QRectF(5, 4, 13, 13));
        p.drawLine(16, 16, 23, 23);
    } else if (name == "close") {
        p.drawLine(7, 7, 21, 21);
        p.drawLine(7, 21, 21, 7);
    } else if (name == "more") {
        p.setBrush(color);
        p.setPen(Qt::NoPen);
        for (int y : {6, 14, 22})
            p.drawEllipse(QPointF(14, y), 1.8, 1.8);
    } else if (name == "clip") {
        QPainterPath path;
        path.moveTo(10, 19);
        path.lineTo(19, 10);
        path.cubicTo(23, 6, 17, 1, 13, 5);
        path.lineTo(5, 13);
        path.cubicTo(-1, 20, 8, 28, 14, 22);
        path.lineTo(23, 13);
        p.drawPath(path);
    } else if (name == "smile") {
        p.drawEllipse(QRectF(3, 3, 22, 22));
        p.drawPoint(10, 11);
        p.drawPoint(18, 11);
        p.drawArc(QRectF(8, 10, 12, 10), 200 * 16, 140 * 16);
    } else if (name == "send") {
        QPainterPath path;
        path.moveTo(3, 5);
        path.lineTo(25, 14);
        path.lineTo(3, 23);
        path.lineTo(6, 15);
        path.lineTo(17, 14);
        path.lineTo(6, 13);
        path.closeSubpath();
        p.setBrush(color);
        p.setPen(Qt::NoPen);
        p.drawPath(path);
    } else if (name == "retry") {
        p.drawArc(QRectF(5, 5, 18, 18), -50 * 16, 300 * 16);
        p.drawLine(22, 4, 22, 10);
        p.drawLine(22, 10, 16, 10);
    } else if (name == "folder" || name == "archive") {
        QPainterPath path;
        path.moveTo(3, 8);
        path.lineTo(11, 8);
        path.lineTo(13, 5);
        path.lineTo(24, 5);
        path.lineTo(24, 23);
        path.lineTo(3, 23);
        path.closeSubpath();
        p.drawPath(path);
    } else if (name == "person") {
        p.drawEllipse(QRectF(9, 3, 10, 10));
        p.drawArc(QRectF(4, 16, 20, 14), 0, 180 * 16);
    } else if (name == "chats" || name == "unread") {
        p.drawRoundedRect(QRectF(3, 4, 22, 16), 5, 5);
        p.drawLine(8, 20, 5, 25);
        p.drawLine(5, 25, 14, 20);
        if (name == "unread") {
            p.setBrush(color);
            p.drawEllipse(QPointF(22, 6), 4, 4);
        }
    } else if (name == "bookmark") {
        QPainterPath path;
        path.moveTo(7, 3);
        path.lineTo(21, 3);
        path.lineTo(21, 25);
        path.lineTo(14, 20);
        path.lineTo(7, 25);
        path.closeSubpath();
        p.drawPath(path);
    } else if (name == "compose") {
        p.drawRoundedRect(QRectF(4, 8, 16, 16), 3, 3);
        p.drawLine(11, 17, 23, 5);
        p.drawLine(20, 3, 25, 8);
    } else if (name == "calendar") {
        p.drawRoundedRect(QRectF(3, 6, 22, 18), 3, 3);
        p.drawLine(3, 12, 25, 12);
        p.drawLine(9, 3, 9, 9);
        p.drawLine(19, 3, 19, 9);
    } else if (name == "settings") {
        p.drawEllipse(QRectF(9, 9, 10, 10));
        for (int i = 0; i < 8; ++i) {
            p.save();
            p.translate(14, 14);
            p.rotate(i * 45);
            p.drawLine(0, -9, 0, -12);
            p.restore();
        }
        p.drawEllipse(QRectF(4, 4, 20, 20));
    } else if (name == "check" || name == "checks") {
        p.drawLine(4, 15, 9, 20);
        p.drawLine(9, 20, 20, 8);
        if (name == "checks") {
            p.drawLine(12, 19, 15, 21);
            p.drawLine(15, 21, 26, 9);
        }
    } else if (name == "play") {
        p.setBrush(color);
        p.setPen(Qt::NoPen);
        QPainterPath path;
        path.moveTo(9, 5);
        path.lineTo(23, 14);
        path.lineTo(9, 23);
        path.closeSubpath();
        p.drawPath(path);
    } else if (name == "file") {
        p.drawRoundedRect(QRectF(6, 3, 17, 22), 2, 2);
        p.drawLine(11, 10, 18, 10);
        p.drawLine(11, 15, 18, 15);
        p.drawLine(11, 20, 16, 20);
    } else if (name == "left" || name == "right") {
        int flip = name == "left" ? 1 : -1;
        p.drawLine(14 + flip * 4, 5, 14 - flip * 4, 14);
        p.drawLine(14 - flip * 4, 14, 14 + flip * 4, 23);
    } else if (name == "minus") {
        p.drawLine(6, 14, 22, 14);
    } else if (name == "download") {
        p.drawLine(14, 3, 14, 19);
        p.drawLine(8, 13, 14, 19);
        p.drawLine(20, 13, 14, 19);
        p.drawLine(5, 24, 23, 24);
    } else if (name == "fit") {
        p.drawLine(4, 11, 4, 4);
        p.drawLine(4, 4, 11, 4);
        p.drawLine(17, 4, 24, 4);
        p.drawLine(24, 4, 24, 11);
        p.drawLine(24, 17, 24, 24);
        p.drawLine(24, 24, 17, 24);
        p.drawLine(11, 24, 4, 24);
        p.drawLine(4, 24, 4, 17);
    } else if (name == "camera") {
        p.drawRoundedRect(QRectF(4, 7, 13, 14), 3, 3);
        QPainterPath path;
        path.moveTo(18, 11);
        path.lineTo(24, 7);
        path.lineTo(24, 21);
        path.lineTo(18, 17);
        p.drawPath(path);
    } else if (name == "mic") {
        p.drawRoundedRect(QRectF(10, 4, 8, 13), 4, 4);
        p.drawArc(QRectF(7, 9, 14, 13), 180 * 16, 180 * 16);
        p.drawLine(14, 22, 14, 25);
        p.drawLine(10, 25, 18, 25);
    } else if (name == "stop") {
        p.setBrush(color);
        p.drawRoundedRect(QRectF(7, 7, 14, 14), 2, 2);
    } else if (name == "phone") {
        QPainterPath path;
        path.moveTo(7, 4);
        path.cubicTo(3, 4, 4, 13, 9, 19);
        path.cubicTo(15, 25, 23, 26, 24, 21);
        path.lineTo(19, 17);
        path.lineTo(16, 20);
        path.cubicTo(12, 18, 9, 15, 8, 11);
        path.lineTo(11, 8);
        path.closeSubpath();
        p.drawPath(path);
    }
    return QIcon(image);
}
