#pragma once
#include "theme.h"
#include <QStyledItemDelegate>
class ChatDelegate : public QStyledItemDelegate {
  public:
    explicit ChatDelegate(QObject *parent = nullptr) : QStyledItemDelegate(parent) {}
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;
    QSize sizeHint(const QStyleOptionViewItem &, const QModelIndex &) const override {
        return {260, 76};
    }
};
QIcon nativeIcon(QString name, QColor color = QColor("#7e96a9"));
