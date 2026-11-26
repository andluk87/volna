#pragma once
#include "api.h"
#include <QDialog>
#include <QImage>
#include <QJsonArray>
#include <QLabel>
#include <QPushButton>
#include <QScrollArea>
class PhotoCanvas;
class ImageViewer : public QDialog {
    Q_OBJECT
  public:
    ImageViewer(Api *api, QJsonObject message, QWidget *parent = nullptr);

  protected:
    bool eventFilter(QObject *object, QEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;

  private:
    void load();
    void render();
    void move(int delta);
    void zoom(double factor);
    void save();
    Api *_api;
    QJsonArray _items;
    int _index = 0, _generation = 0;
    double _zoom = 1;
    QImage _image;
    QByteArray _bytes;
    QScrollArea *_area;
    PhotoCanvas *_picture;
    QLabel *_name, *_count;
    QPushButton *_previous, *_next, *_save;
};
