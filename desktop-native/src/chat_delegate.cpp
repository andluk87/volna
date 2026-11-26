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
    auto avatar = QRect(rect.left() + 12, rect.top() + 13, 48, 48);
    auto id = chat.value("id").toInt();
    painter->setPen(Qt::NoPen);
    painter->setBrush(QColor::fromHsl((id * 67) % 360, 125, 140));
    painter->drawEllipse(avatar);
    auto font = option.font;
    font.setPixelSize(21);
    font.setWeight(QFont::Medium);
    painter->setFont(font);
    painter->setPen(Qt::white);
    painter->drawText(avatar, Qt::AlignCenter,
                      chat.value("kind").toString() == "saved" ? "★" : name.left(1).toUpper());
    auto left = rect.left() + 74;
    auto right = rect.right() - 12;
    auto time = QDateTime::fromString(chat.value("last_at").toString(), Qt::ISODate).toLocalTime();
    auto stamp = time.isValid() ? time.toString("HH:mm") : QString();
    font.setPixelSize(11);
    font.setWeight(QFont::Normal);
    painter->setFont(font);
    auto sub = selected ? QColor("#deecf7") : option.palette.color(QPalette::PlaceholderText);
    painter->setPen(sub);
    painter->drawText(QRect(right - 50, rect.top() + 15, 50, 20), Qt::AlignRight | Qt::AlignVCenter,
                      stamp);
    font.setPixelSize(14);
    font.setWeight(QFont::DemiBold);
    painter->setFont(font);
    painter->setPen(option.palette.color(QPalette::WindowText));
    painter->drawText(
        QRect(left, rect.top() + 15, std::max(10, right - left - 55), 21), Qt::AlignVCenter,
        painter->fontMetrics().elidedText(name, Qt::ElideRight, std::max(10, right - left - 55)));
    int unread = chat.value("unread").toInt();
    int extra = unread ? 40 : 0;
    font.setPixelSize(12);
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
