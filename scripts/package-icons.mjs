// Resize the approved VLN artwork into all client icon formats.
// node scripts/package-icons.mjs [path/to/approved-art.png]
// The committed 512px icon is the source when no artwork path is supplied.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '../client/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.argv[2] || join(root, 'client/public/icons/icon-512.png'));
const sizes = [16, 24, 32, 36, 48, 64, 72, 96, 128, 144, 180, 192, 256, 512];
const artwork = 'data:image/png;base64,' + readFileSync(source).toString('base64');
const notificationVector = readFileSync(join(root, 'android-native/app/src/main/res/drawable/ic_volna.xml'), 'utf8');
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
let assets;
try {
  const page = await browser.newPage();
  assets = await page.evaluate(async ({ artwork, sizes, notificationVector }) => {
    const image = new Image();
    image.src = artwork;
    await image.decode();
    if (image.width !== 512 || image.height !== 512) {
      // Normalize once so later regeneration from the committed source is stable.
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = sourceCanvas.height = 512;
      const context = sourceCanvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      const scale = 512 / Math.max(image.width, image.height);
      context.drawImage(image, (512 - image.width * scale) / 2, (512 - image.height * scale) / 2, image.width * scale, image.height * scale);
      image.src = sourceCanvas.toDataURL('image/png');
      await image.decode();
    }
    const images = sizes.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      const alpha = (x, y) => pixels[(y * size + x) * 4 + 3];
      if ([[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]].some(([x, y]) => alpha(x, y) !== 0)) {
        throw Error(`Artwork must have transparent corners (${size}px)`);
      }
      // Generated artwork can retain a tiny (1%) alpha variation in its interior.
      if (alpha(size / 2, size / 2) < 250) throw Error(`Artwork must have a solid center (${size}px)`);
      return { size, png: canvas.toDataURL('image/png').split(',')[1] };
    });
    // Web notification badges use the same monochrome V silhouette as Android.
    const vector = new DOMParser().parseFromString(notificationVector, 'application/xml');
    if (vector.querySelector('parsererror')) throw Error('Notification vector XML is invalid');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '96');
    svg.setAttribute('height', '96');
    svg.setAttribute('viewBox', `0 0 ${vector.documentElement.getAttribute('android:viewportWidth')} ${vector.documentElement.getAttribute('android:viewportHeight')}`);
    for (const path of vector.querySelectorAll('path')) {
      const element = document.createElementNS(svg.namespaceURI, 'path');
      element.setAttribute('d', path.getAttribute('android:pathData'));
      for (const [androidName, svgName] of [['fillColor', 'fill'], ['strokeColor', 'stroke']]) {
        const color = path.getAttribute('android:' + androidName);
        if (!color) continue;
        if (/^#[\da-f]{8}$/i.test(color)) {
          element.setAttribute(svgName, '#' + color.slice(3));
          element.setAttribute(svgName + '-opacity', String(parseInt(color.slice(1, 3), 16) / 255));
        } else element.setAttribute(svgName, color);
      }
      for (const [androidName, svgName] of [['strokeWidth', 'stroke-width'], ['strokeLineCap', 'stroke-linecap'], ['strokeLineJoin', 'stroke-linejoin']]) {
        const value = path.getAttribute('android:' + androidName);
        if (value) element.setAttribute(svgName, value);
      }
      svg.appendChild(element);
    }
    const badgeImage = new Image();
    badgeImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await badgeImage.decode();
    const badge = document.createElement('canvas');
    badge.width = badge.height = 96;
    const context = badge.getContext('2d');
    context.drawImage(badgeImage, 0, 0);
    const pixels = context.getImageData(0, 0, 96, 96).data;
    let whitePixels = 0;
    for (let pixel = 0; pixel < 96 * 96; pixel++) {
      if (!pixels[pixel * 4 + 3]) continue;
      if ([0, 1, 2].some(channel => pixels[pixel * 4 + channel] !== 255)) throw Error('Notification badge must contain only white ink');
      whitePixels++;
    }
    if (whitePixels < 96 * 96 * 0.1 || whitePixels > 96 * 96 * 0.7) throw Error('Notification badge must have a visible symbol and transparent background');
    if ([0, 95, 96 * 95, 96 * 96 - 1].some(pixel => pixels[pixel * 4 + 3] !== 0)) throw Error('Notification badge corners must be transparent');
    return { images, badge: badge.toDataURL('image/png').split(',')[1], whitePixels };
  }, { artwork, sizes, notificationVector });
} finally {
  await browser.close();
}
const pngs = new Map(assets.images.map(({ size, png }) => [size, Buffer.from(png, 'base64')]));

// A maskable PWA canvas protects the full mark inside every platform's safe zone.
const maskable = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const page = await maskable.newPage();
  const png = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d'); context.fillStyle = '#108aff'; context.fillRect(0, 0, 512, 512);
    context.imageSmoothingQuality = 'high'; context.drawImage(image, 64, 64, 384, 384);
    return canvas.toDataURL('image/png').split(',')[1];
  }, 'data:image/png;base64,' + pngs.get(512).toString('base64'));
  writeFileSync(join(root, 'client/public/icons/icon-maskable-512.png'), Buffer.from(png, 'base64'));
} finally { await maskable.close(); }
for (const size of [180, 192, 512]) writeFileSync(join(root, `client/public/icons/icon-${size}.png`), pngs.get(size));
writeFileSync(join(root, 'client/public/icons/badge-96.png'), Buffer.from(assets.badge, 'base64'));
writeFileSync(join(root, 'android-native/app/src/main/res/drawable-nodpi/volna_launcher.png'), pngs.get(512));
writeFileSync(join(root, 'android-native/app/src/main/res/mipmap-mdpi/ic_launcher.png'), pngs.get(48));
writeFileSync(join(root, 'android-native/app/src/main/res/mipmap-mdpi/ic_launcher_round.png'), pngs.get(48));
// Android status icons remain white alpha masks, separate from the colored launcher logo.
const badgeBrowser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const page = await badgeBrowser.newPage();
  for (const [density, size] of [['mdpi',24],['hdpi',36],['xhdpi',48],['xxhdpi',72],['xxxhdpi',96]]) {
    const png = await page.evaluate(async ({src, size}) => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high'; context.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, {src:'data:image/png;base64,' + assets.badge, size});
    const directory = join(root, `android-native/app/src/main/res/drawable-${density}`);
    mkdirSync(directory, {recursive:true});
    writeFileSync(join(directory, 'ic_volna_notification.png'), Buffer.from(png, 'base64'));
  }
} finally { await badgeBrowser.close(); }

// Modern Windows accepts PNG frames inside ICO. Include all common shell sizes.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + icoSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  const png = pngs.get(size);
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...icoSizes.map(size => pngs.get(size))]);
// Validate against the same ICO parser used by the Windows executable packager.
const require = createRequire(new URL('../client/package.json', import.meta.url));
const parsed = require('resedit').Data.IconFile.from(ico);
if (parsed.icons.length !== icoSizes.length) throw Error('Windows ICO frame validation failed');
writeFileSync(join(root, 'client/electron/icon.ico'), ico);
console.log(`Packaged Android, Web, Apple and Windows icons (${icoSizes.length} ICO frames); transparent corners, solid centers and white V badge (${assets.whitePixels} ink pixels) verified.`);
