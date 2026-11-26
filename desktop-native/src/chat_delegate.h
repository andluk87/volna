#pragma once
#include "theme.h"
#include "widgets.h"
#include <QStyledItemDelegate>
class ChatDelegate : public QStyledItemDelegate {
  public:
    explicit ChatDelegate(AvatarStore *store, QObject *parent = nullptr)
        : QStyledItemDelegate(parent), store(store) {}
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;
    AvatarStore *store;
    QSize sizeHint(const QStyleOptionViewItem &, const QModelIndex &) const override {
        return {260, 72};
    }
};
QIcon nativeIcon(QString name, QColor color = QColor("#7e96a9"));
