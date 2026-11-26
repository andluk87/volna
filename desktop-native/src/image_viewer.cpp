#include "image_viewer.h"
#include "chat_delegate.h"
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QJsonArray>
#include <QKeyEvent>
#include <QPainter>
#include <QPointer>
#include <QSaveFile>
#include <QScreen>
#include <QScrollBar>
#include <QVBoxLayout>
#include <QWheelEvent>
#include <algorithm>
class PhotoCanvas : public QWidget {
  public:
    QImage image;
    QString text;
    void clear() {
        image = {};
        text.clear();
        update();
    }
    void setText(QString value) {
        text = value;
        update();
    }
    void setImage(QImage value) {
        image = value;
        text.clear();
        update();
    }

  protected:
    void paintEvent(QPaintEvent *) override {
        QPainter p(this);
        p.fillRect(rect(), QColor("#0a1119"));
        p.setPen(QColor("#c4d4e1"));
        if (image.isNull())
            p.drawText(rect().adjusted(10, 10, -10, -10), Qt::AlignCenter | Qt::TextWordWrap, text);
        else {
            p.setRenderHint(QPainter::SmoothPixmapTransform);
            p.drawImage(QRectF(rect()), image);
        }
    }
};
ImageViewer::ImageViewer(Api *api, QJsonObject message, QWidget *parent)
    : QDialog(parent), _api(api) {
    setAttribute(Qt::WA_DeleteOnClose);
    setObjectName("imageViewer");
    setWindowTitle("Фотография · Волна");
    resize(std::min(1120, screen()->availableGeometry().width() - 60),
           std::min(820, screen()->availableGeometry().height() - 60));
    setStyleSheet("QDialog#imageViewer,QScrollArea#photoArea,QWidget#photoPicture{background:#"
                  "0a1119;} QLabel{color:#eef4f8;} QPushButton:hover{background:#243340;} ");
    auto layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    auto top = new QWidget;
    auto bar = new QHBoxLayout(top);
    bar->setContentsMargins(12, 8, 12, 8);
    _name = label({});
    _name->setObjectName("photoName");
    _name->setWordWrap(false);
    _name->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
    bar->addWidget(_name, 1);
    _count = label({});
    _count->setObjectName("photoCounter");
    bar->addWidget(_count);
    auto tool = [&](QString icon, QString id, QString tip) {
        auto value = button({}, id);
        value->setIcon(nativeIcon(icon, QColor("#bbcfdf")));
        value->setFixedSize(34, 34);
        value->setToolTip(tip);
        value->setAccessibleName(tip);
        bar->addWidget(value);
        return value;
    };
    _previous = tool("left", "previousPhoto", "Предыдущее фото");
    _next = tool("right", "nextPhoto", "Следующее фото");
    auto minus = tool("minus", "zoomOut", "Уменьшить"),
         fit = tool("fit", "fitPhoto", "По размеру окна"),
         plus = tool("plus", "zoomIn", "Увеличить");
    _save = tool("download", "savePhoto", "Сохранить фото");
    auto close = tool("close", "closePhoto", "Закрыть");
    layout->addWidget(top);
    _area = new QScrollArea;
    _area->setObjectName("photoArea");
    _area->setFrameShape(QFrame::NoFrame);
    _area->setAlignment(Qt::AlignCenter);
    _area->setWidgetResizable(false);
    _picture = new PhotoCanvas;
    _picture->setObjectName("photoPicture");
    _area->setWidget(_picture);
    layout->addWidget(_area, 1);
    _area->viewport()->installEventFilter(this);
    _picture->installEventFilter(this);
    connect(close, &QPushButton::clicked, this, &QDialog::close);
    connect(minus, &QPushButton::clicked, this, [this] { zoom(1 / 1.25); });
    connect(plus, &QPushButton::clicked, this, [this] { zoom(1.25); });
    connect(fit, &QPushButton::clicked, this, [this] {
        _zoom = 1;
        render();
    });
    connect(_previous, &QPushButton::clicked, this, [this] { move(-1); });
    connect(_next, &QPushButton::clicked, this, [this] { move(1); });
    connect(_save, &QPushButton::clicked, this, &ImageViewer::save);
    connect(api, &Api::sessionInvalid, this, &QDialog::close);
    _items.append(message);
    load();
    auto album = message.value("album_id").toString();
    if (!album.isEmpty()) {
        QPointer<ImageViewer> alive(this);
        _api->request("/chats/" + QString::number(message.value("chat_id").toInt()) +
                          "/media?album_id=" + QString::fromLatin1(QUrl::toPercentEncoding(album)),
                      QJsonValue::Undefined, [alive, message](ApiResult result) {
                          if (!alive || !result.ok())
                              return;
                          QJsonArray items;
                          for (auto value : result.value.toArray())
                              if (value.toObject()
                                      .value("attachment")
                                      .toObject()
                                      .value("mime")
                                      .toString()
                                      .startsWith("image/"))
                                  items.append(value);
                          if (items.isEmpty())
                              return;
                          int current = 0;
                          for (int i = 0; i < items.size(); ++i)
                              if (items[i].toObject().value("id") == message.value("id"))
                                  current = i;
                          alive->_items = items;
                          alive->_index = current;
                          alive->render();
                      });
    }
}
void ImageViewer::load() {
    auto message = _items[_index].toObject();
    auto attachment = message.value("attachment").toObject();
    _name->setText(attachment.value("name").toString());
    _picture->clear();
    _picture->setText("Загрузка фотографии…");
    _picture->resize(300, 80);
    _bytes.clear();
    _image = {};
    _save->setEnabled(false);
    _zoom = 1;
    render();
    auto generation = ++_generation;
    QPointer<ImageViewer> alive(this);
    _api->download(attachment.value("id").toString(), message.value("id").toVariant().toLongLong(),
                   [alive, generation](ApiResult result) {
                       if (!alive || generation != alive->_generation)
                           return;
                       if (!result.ok()) {
                           alive->_picture->setText(result.error);
                           return;
                       }
                       auto image = QImage::fromData(result.bytes);
                       if (image.isNull()) {
                           alive->_picture->setText("Не удалось открыть изображение");
                           return;
                       }
                       alive->_image = image;
                       alive->_picture->setImage(image);
                       alive->_bytes = result.bytes;
                       alive->_save->setEnabled(true);
                       alive->render();
                   });
}
void ImageViewer::render() {
    _count->setText(_items.size() > 1 ? QString("%1 / %2").arg(_index + 1).arg(_items.size())
                                      : QString());
    _previous->setVisible(_items.size() > 1);
    _next->setVisible(_items.size() > 1);
    _previous->setEnabled(_index > 0);
    _next->setEnabled(_index + 1 < _items.size());
    if (_image.isNull())
        return;
    auto available = _area->viewport()->size() - QSize(24, 24);
    double fit = std::min(double(std::max(1, available.width())) / _image.width(),
                          double(std::max(1, available.height())) / _image.height());
    auto size = _image.size() * fit * _zoom;
    _picture->resize(size);
}
void ImageViewer::zoom(double factor) {
    _zoom = std::clamp(_zoom * factor, .2, 12.0);
    render();
}
void ImageViewer::move(int delta) {
    auto target = _index + delta;
    if (target < 0 || target >= _items.size())
        return;
    _index = target;
    load();
}
void ImageViewer::save() {
    if (_bytes.isEmpty())
        return;
    auto file = QFileDialog::getSaveFileName(this, "Сохранить фотографию",
                                             QFileInfo(_name->text()).fileName());
    if (file.isEmpty())
        return;
    QSaveFile output(file);
    if (!output.open(QIODevice::WriteOnly) || output.write(_bytes) != _bytes.size() ||
        !output.commit())
        _name->setText("Не удалось сохранить файл");
}
bool ImageViewer::eventFilter(QObject *object, QEvent *event) {
    if (event->type() == QEvent::Wheel) {
        auto wheel = static_cast<QWheelEvent *>(event);
        zoom(wheel->angleDelta().y() > 0 ? 1.12 : 1 / 1.12);
        return true;
    }
    if (object == _area->viewport() && event->type() == QEvent::Resize)
        render();
    if (event->type() == QEvent::MouseButtonDblClick) {
        _zoom = _zoom == 1 ? 2 : 1;
        render();
        return true;
    }
    return QDialog::eventFilter(object, event);
}
void ImageViewer::keyPressEvent(QKeyEvent *event) {
    if (event->key() == Qt::Key_Left)
        move(-1);
    else if (event->key() == Qt::Key_Right)
        move(1);
    else if (event->key() == Qt::Key_Plus || event->key() == Qt::Key_Equal)
        zoom(1.25);
    else if (event->key() == Qt::Key_Minus)
        zoom(1 / 1.25);
    else
        QDialog::keyPressEvent(event);
}
