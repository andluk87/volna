// Build the Unicode/CLDR reaction index from the same pinned catalog as Android.
// Run after android-native/scripts/prepare-expressions.py; no network is used here.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isEmoji} from '../../shared/emoji-text.mjs';
const source=new URL('../../android-native/app/src/main/assets/emoji/',import.meta.url);
const catalog=JSON.parse(readFileSync(process.argv[2]||new URL('catalog.json',source)));
const rows=catalog.entries.filter(e=>isEmoji(e.text)).map(e=>[e.text,e.name,e.group,e.keywords]);
writeFileSync(new URL('../src/reaction-emoji.json',import.meta.url),JSON.stringify({unicode:catalog.version,license:'/site/emoji-LICENSE.txt',entries:rows})+'\n');
copyFileSync(process.argv[3]||fileURLToPath(new URL('UNICODE-LICENSE.txt',source)),new URL('../public/site/emoji-LICENSE.txt',import.meta.url));
console.log('Reaction emoji index:',rows.length);
