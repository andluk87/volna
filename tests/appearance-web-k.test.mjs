import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,normalizeAppearance,themeVariants,themeVariantPatch,formatTime} from '../client/src/appearance.mjs';
test('old saved appearance settings migrate without losing custom preferences',()=>{
 assert.deepEqual(normalizeAppearance(null),defaults);
 const old={theme:'dark',size:19,accent:'#d65e89',background:'image',radius:8,avatars:true};
 const migrated=normalizeAppearance(old);
 for(const [key,value] of Object.entries(old))assert.equal(migrated[key],value);
 assert.equal(migrated.themeVariant,'night');assert.equal(migrated.timeFormat,'24');assert.equal(migrated.blur,false);
 assert.equal(normalizeAppearance({...migrated,theme:'light'}).themeVariant,'day');
 assert.equal(normalizeAppearance({themeVariant:'constructor'}).themeVariant,'system');
});
test('all five variants persist through normalization and leave text settings unchanged',()=>{
 for(const variant of themeVariants){const settings=normalizeAppearance({...defaults,size:18,avatars:true,...themeVariantPatch(variant.id)});assert.equal(settings.themeVariant,variant.id);assert.equal(settings.theme,variant.theme);assert.equal(settings.size,18);assert.equal(settings.avatars,true);assert.deepEqual(normalizeAppearance(JSON.parse(JSON.stringify(settings))),settings);}
 assert.deepEqual(themeVariantPatch('missing'),{});
});
test('time format handles both midnight and afternoon and rejects invalid dates',()=>{
 assert.equal(formatTime('2026-10-09T00:05:00','24'),'00:05');assert.equal(formatTime('2026-10-09T00:05:00','12'),'12:05 AM');
 assert.equal(formatTime('2026-10-09T15:45:00','12'),'03:45 PM');assert.equal(formatTime('2026-10-09T15:45:00','24'),'15:45');
 assert.equal(formatTime('invalid'),'');assert.equal(formatTime(null),'');
});
