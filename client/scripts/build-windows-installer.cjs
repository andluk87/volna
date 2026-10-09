'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');

// electron-builder 26 already provides a native NSIS uninstaller reader for
// hosts which cannot run Windows binaries. Select that reader for Linux too.
// Restrict the adaptation to this single method and the pinned builder version.
function nativeUninstallerReader() {
  const builderVersion = require('electron-builder/package.json').version;
  const libraryVersion = require('app-builder-lib/package.json').version;
  if (builderVersion !== '26.0.12' || libraryVersion !== '26.0.12') {
    throw new Error('Review the native NSIS adapter before changing electron-builder 26.0.12.');
  }
  const macos = require('app-builder-lib/out/util/macosVersion');
  const {NsisTarget} = require('app-builder-lib/out/targets/nsis/NsisTarget');
  const original = NsisTarget.prototype.computeScriptAndSignUninstaller;
  if (!original.toString().includes('macosVersion_1.isMacOsCatalina') || !original.toString().includes('nsisUtil_1.UninstallerReader.exec')) {
    throw new Error('Unexpected NSIS implementation: native extraction cannot be verified.');
  }
  const temporaryFiles = new Set();
  NsisTarget.prototype.computeScriptAndSignUninstaller = async function (...args) {
    const detect = macos.isMacOsCatalina;
    macos.isMacOsCatalina = () => true;
    try {
      const result = await original.apply(this, args);
      temporaryFiles.add(path.join(this.outDir, `__uninstaller-nsis-${this.packager.appInfo.sanitizedName}.exe`));
      return result;
    }
    finally { macos.isMacOsCatalina = detect; }
  };
  console.log('Using electron-builder native NSIS uninstaller reader on Linux.');
  return async () => {
    for (const file of temporaryFiles) await fs.rm(file, {force: true});
  };
}

async function main() {
  const {build, Platform, Arch} = require('electron-builder');
  const cleanup = process.platform === 'linux' ? nativeUninstallerReader() : async () => {};
  await build({
    projectDir: path.resolve(__dirname, '..'),
    config: path.resolve(__dirname, '../electron-builder.windows.json'),
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    publish: 'never',
  });
  await cleanup();
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
