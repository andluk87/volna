'use strict';
// Write Windows PE resources in JavaScript, without running rcedit through Wine.
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

function writeResources(file, iconFile, appVersion, copyright) {
  const fs = require('node:fs');
  const R = require('resedit');
  const exe = R.NtExecutable.from(fs.readFileSync(file), {ignoreCert: true});
  const resources = R.NtExecutableResource.from(exe);
  const icons = R.Data.IconFile.from(fs.readFileSync(iconFile));
  const group = R.Resource.IconGroupEntry.fromEntries(resources.entries)[0];
  R.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group?.id || 1, group?.lang || 1033, icons.icons.map(icon => icon.data));
  const version = R.Resource.VersionInfo.fromEntries(resources.entries)[0] || R.Resource.VersionInfo.createEmpty();
  version.setFileVersion(appVersion, 1033);
  version.setProductVersion(appVersion, 1033);
  version.setStringValues({lang: 1033, codepage: 1200}, {
    FileDescription: 'Volna', ProductName: 'Volna', CompanyName: 'Volna',
    OriginalFilename: 'Volna.exe', InternalName: 'Volna', LegalCopyright: copyright,
  });
  version.outputToResourceEntries(resources.entries);
  resources.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
  console.log('Embedded Volna Windows icon and version without Wine.');
}

if (require.main === module) {
  if (process.argv.length !== 6) throw new Error('Expected executable, icon, version and copyright.');
  writeResources(...process.argv.slice(2));
} else {
  // Release PE editing buffers with the child process before 7-Zip starts.
  module.exports = async ({appOutDir, packager}) => {
    const {stdout} = await promisify(execFile)(process.execPath, [__filename,
      path.join(appOutDir, packager.appInfo.productFilename + '.exe'),
      path.join(packager.projectDir, 'electron/icon.ico'),
      packager.appInfo.version, packager.appInfo.copyright,
    ]);
    if (packager.appInfo.productFilename !== 'electron') {
      await require('node:fs/promises').rm(path.join(appOutDir, 'electron.exe'), {force: true});
    }
    console.log(stdout.trim());
  };
}
