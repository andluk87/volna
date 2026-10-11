import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {ignoredSpelling}=createRequire(import.meta.url)('../client/electron/ignored-spelling.cjs');
test('temporary spelling exclusions are cleaned after restart; permanent additions survive',t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-spelling-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const dictionary=new Set(),session={addWordToSpellCheckerDictionary:w=>{dictionary.add(w);return true;},removeWordFromSpellCheckerDictionary:w=>dictionary.delete(w)},file=join(dir,'ignored.json');
 const first=ignoredSpelling(session,file);assert.equal(first.ignore('Волна'),true);assert.equal(dictionary.has('Волна'),true);
 const restarted=ignoredSpelling(session,file);assert.equal(dictionary.has('Волна'),false);
 restarted.ignore('Волна');restarted.add('Волна');restarted.ignore('привит');restarted.clear();
 assert.deepEqual([...dictionary],['Волна']);
});
