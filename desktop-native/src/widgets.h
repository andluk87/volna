#pragma once
#include "api.h"
#include <QAbstractButton>
#include <QCache>
#include <QHash>
#include <QLabel>
#include <QPixmap>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSet>
#include <QWidget>
QPushButton *button(QString text, QString name, QWidget *parent = nullptr);
QLabel *label(QString text, QString name = {});
class AvatarStore : public QObject {
    Q_OBJECT
  public:
    explicit AvatarStore(Api *api, QObject *parent = nullptr);
    QPixmap image(QString url, bool media = false);
  signals:
    void changed();

  private:
    Api *_api;
    QCache<QString, QPixmap> _images{24 * 1024};
    QSet<QString> _pending, _failed;
};
void paintAvatar(QPainter &p, QRectF rect, QString name, qint64 id, QPixmap image = {},
                 bool saved = false);
class AvatarView : public QWidget {
    Q_OBJECT
  public:
    AvatarView(AvatarStore *store, int size, QWidget *parent = nullptr);
    void setPerson(QString name, qint64 id, QString url = {}, bool saved = false);

  protected:
    void paintEvent(QPaintEvent *) override;

  private:
    AvatarStore *_store;
    QString _name, _url;
    qint64 _id = 0;
    bool _saved = false;
};
class ComposerEdit : public QPlainTextEdit {
    Q_OBJECT
  public:
    explicit ComposerEdit(QWidget *parent = nullptr);
  signals:
    void sendPressed();

  protected:
    void keyPressEvent(QKeyEvent *event) override;
};
class Toggle : public QAbstractButton {
    Q_OBJECT
  public:
    explicit Toggle(QWidget *parent = nullptr);

  protected:
    void paintEvent(QPaintEvent *) override;
};

class MediaView : public QPushButton {
    Q_OBJECT
  public:
    MediaView(AvatarStore *store, QString url, int width, int height, QWidget *parent = nullptr);

  protected:
    void paintEvent(QPaintEvent *) override;

  public:
    bool loaded() const {
        return !_store->image(_url, true).isNull();
    }

  private:
    AvatarStore *_store;
    QString _url;
};
