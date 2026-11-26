#include "widgets.h"
#include <QKeyEvent>
#include <QLinearGradient>
#include <QPainter>
#include <QPainterPath>
#include <QRegularExpression>
#include <QTextDocument>
#include <QTimer>
#include <algorithm>
AvatarStore::AvatarStore(Api *api, QObject *parent) : QObject(parent), _api(api) {
    connect(api, &Api::sessionInvalid, this, [this] {
        _images.clear();
        _pending.clear();
        _failed.clear();
        emit changed();
    });
}
QPixmap AvatarStore::image(QString url, bool media) {
    if (url == "/icons/icon-192.png")
        return QPixmap(":/volna/icon.png");
    if (url.isEmpty() || _failed.contains(url))
        return {};
    if (_images.contains(url))
        return *_images.object(url);
    if (_pending.contains(url) || _api->token().isEmpty())
        return {};
    if (!QRegularExpression(R"(^/api/files/[a-f0-9]{48}(?:\?message_id=[1-9][0-9]*)?$)")
             .match(url)
             .hasMatch())
        return {};
    _pending.insert(url);
    auto owner = _api->session().value("user").toObject().value("id");
    _api->request(url.mid(4), QJsonValue::Undefined, [this, url, owner, media](ApiResult result) {
        _pending.remove(url);
        if (owner != _api->session().value("user").toObject().value("id"))
            return;
        QPixmap image;
        if (result.ok())
            image.loadFromData(result.bytes);
        if (image.isNull())
            _failed.insert(url);
        else {
            auto small = image.scaled(media ? 720 : 192, media ? 720 : 192, Qt::KeepAspectRatio,
                                      Qt::SmoothTransformation);
            int cost = (small.width() * small.height() * 4 + 1023) / 1024;
            _images.insert(url, new QPixmap(small), cost);
        }
        emit changed();
    });
    return {};
}
void paintAvatar(QPainter &p, QRectF rect, QString name, qint64 id, QPixmap image, bool saved) {
    p.save();
    p.setRenderHint(QPainter::Antialiasing);
    p.setRenderHint(QPainter::SmoothPixmapTransform);
    QPainterPath clip;
    clip.addEllipse(rect);
    p.setClipPath(clip);
    if (!image.isNull()) {
        int side = std::min(image.width(), image.height());
        p.drawPixmap(rect, image,
                     QRectF((image.width() - side) / 2., (image.height() - side) / 2., side, side));
    } else {
        QColor top = QColor::fromHsl((int(id % 360) * 59 + 206) % 360, 138, 153),
               bottom = QColor::fromHsl((int(id % 360) * 59 + 206) % 360, 150, 121);
        if (saved) {
            top = QColor("#65b8f1");
            bottom = QColor("#4386d1");
        }
        QLinearGradient gradient(rect.topLeft(), rect.bottomLeft());
        gradient.setColorAt(0, top);
        gradient.setColorAt(1, bottom);
        p.fillRect(rect, gradient);
        p.setPen(Qt::white);
        if (saved) {
            QRectF mark(rect.center().x() - rect.width() * .17, rect.top() + rect.height() * .25,
                        rect.width() * .34, rect.height() * .48);
            QPainterPath path;
            path.moveTo(mark.topLeft());
            path.lineTo(mark.topRight());
            path.lineTo(mark.bottomRight());
            path.lineTo(mark.center().x(), mark.bottom() - mark.height() * .22);
            path.lineTo(mark.bottomLeft());
            path.closeSubpath();
            p.setBrush(Qt::NoBrush);
            p.setPen(QPen(Qt::white, 2));
            p.drawPath(path);
        } else {
            auto font = p.font();
            font.setPixelSize(int(rect.height() * .40));
            font.setWeight(QFont::Medium);
            p.setFont(font);
            auto initial = name.trimmed().isEmpty()
                               ? QString("?")
                               : name.left(name.at(0).isHighSurrogate() ? 2 : 1).toUpper();
            p.drawText(rect, Qt::AlignCenter, initial);
        }
    }
    p.restore();
}
AvatarView::AvatarView(AvatarStore *store, int size, QWidget *parent)
    : QWidget(parent), _store(store) {
    setFixedSize(size, size);
    connect(store, &AvatarStore::changed, this, qOverload<>(&QWidget::update));
}
void AvatarView::setPerson(QString name, qint64 id, QString url, bool saved) {
    _name = name;
    _id = id;
    _url = url;
    _saved = saved;
    update();
}
void AvatarView::paintEvent(QPaintEvent *) {
    QPainter p(this);
    paintAvatar(p, QRectF(rect()).adjusted(1, 1, -1, -1), _name, _id, _store->image(_url), _saved);
}
ComposerEdit::ComposerEdit(QWidget *parent) : QPlainTextEdit(parent) {
    setFrameShape(QFrame::NoFrame);
    setTabChangesFocus(true);
    setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    document()->setDocumentMargin(0);
    setFixedHeight(38);
    connect(this, &QPlainTextEdit::textChanged, this, [this] {
        QTimer::singleShot(0, this, [this] {
            setFixedHeight(
                std::clamp(document()->lineCount() * fontMetrics().lineSpacing() + 14, 38, 138));
        });
    });
}
void ComposerEdit::keyPressEvent(QKeyEvent *event) {
    if ((event->key() == Qt::Key_Return || event->key() == Qt::Key_Enter) &&
        !(event->modifiers() & (Qt::ShiftModifier | Qt::ControlModifier | Qt::AltModifier))) {
        if (!isReadOnly() && isEnabled())
            emit sendPressed();
        event->accept();
        return;
    }
    QPlainTextEdit::keyPressEvent(event);
}
Toggle::Toggle(QWidget *parent) : QAbstractButton(parent) {
    setCheckable(true);
    setFixedSize(38, 24);
    setCursor(Qt::PointingHandCursor);
    connect(this, &QAbstractButton::toggled, this, qOverload<>(&QWidget::update));
}
void Toggle::paintEvent(QPaintEvent *) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    p.setPen(Qt::NoPen);
    p.setBrush(isChecked() ? QColor("#5288c1") : QColor("#647582"));
    p.drawRoundedRect(QRectF(2, 5, 34, 14), 7, 7);
    p.setBrush(palette().window());
    p.setPen(QPen(isChecked() ? QColor("#5288c1") : QColor("#647582"), 2));
    p.drawEllipse(QRectF(isChecked() ? 19 : 1, 3, 18, 18));
}

QPushButton *button(QString text, QString name, QWidget *parent) {
    auto value = new QPushButton(text, parent);
    value->setObjectName(name);
    value->setCursor(Qt::PointingHandCursor);
    return value;
}
QLabel *label(QString text, QString name) {
    auto value = new QLabel(text);
    value->setObjectName(name);
    value->setWordWrap(true);
    value->setTextFormat(Qt::PlainText);
    return value;
}

MediaView::MediaView(AvatarStore *store, QString url, int width, int height, QWidget *parent)
    : QPushButton(parent), _store(store), _url(url) {
    setFixedSize(width, height);
    setCursor(Qt::PointingHandCursor);
    setAccessibleName("Открыть фотографию");
    connect(store, &AvatarStore::changed, this, qOverload<>(&QWidget::update));
}
void MediaView::paintEvent(QPaintEvent *) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    p.setRenderHint(QPainter::SmoothPixmapTransform);
    QPainterPath clip;
    clip.addRoundedRect(rect(), 8, 8);
    p.setClipPath(clip);
    p.fillRect(rect(), palette().color(QPalette::AlternateBase));
    auto image = _store->image(_url, true);
    if (image.isNull()) {
        p.setPen(palette().color(QPalette::PlaceholderText));
        p.drawText(rect(), Qt::AlignCenter, "Фото · нажмите, чтобы открыть");
        return;
    }
    auto scaled = image.scaled(size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
    p.drawPixmap((width() - scaled.width()) / 2, (height() - scaled.height()) / 2, scaled);
}
