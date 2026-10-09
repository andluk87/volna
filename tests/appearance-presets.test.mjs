import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,themePresets,presetPatch,normalizeAppearance} from '../client/src/appearance.mjs';
test('theme presets survive saved-settings normalization without changing text preferences',()=>{
 for(const preset of themePresets){const before={...defaults,size:19,radius:8,density:'compact',avatars:true};const patch=presetPatch(preset.id);const after=normalizeAppearance({...before,...patch});assert.equal(after.theme,preset.theme);assert.equal(after.accent,preset.accent);assert.equal(after.backgroundColor,preset.backgroundColor);for(const key of ['size','radius','density','avatars'])assert.equal(after[key],before[key]);assert.deepEqual(normalizeAppearance(JSON.parse(JSON.stringify(after))),after);}
 assert.deepEqual(presetPatch('unknown'),{});
});
