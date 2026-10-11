import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,chmodSync,cpSync,readdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../',import.meta.url).pathname,name='volna-site-test-'+process.pid,base='http://127.0.0.1:5194';
assert.ok(existsSync(root+'client/dist/index.html'),'build client before running this test');
assert.equal(existsSync(root+'client/dist/landing.html'),false,'old landing must not be copied to production');
assert.equal(existsSync(root+'client/dist/demo'),false,'demo media must not be copied to production');
const directory=mkdtempSync(join(tmpdir(),'volna-nginx-site-'));cpSync(root+'client/dist',directory+'/site',{recursive:true});cpSync(root+'docker/nginx.conf',directory+'/nginx.conf');
function readable(path){chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true})){const child=join(path,item.name);if(item.isDirectory())readable(child);else chmodSync(child,0o644);}}readable(directory);
let started=false;
try{
 execFileSync('docker',['run','-d','--rm','--name',name,'--add-host','server:127.0.0.1','-p','127.0.0.1:5194:80','-v',directory+'/site:/usr/share/nginx/html:ro','-v',directory+'/nginx.conf:/etc/nginx/conf.d/default.conf:ro','nginx:1.28-alpine'],{stdio:'pipe'});started=true;
 let homepage;for(let attempt=0;attempt<40;attempt++){try{homepage=await fetch(base+'/');if(homepage.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(homepage?.ok,'Nginx must serve root successfully');
 assert.match(homepage.headers.get('cache-control'),/no-cache/);assert.equal(await homepage.text(),await (await fetch(base+'/app')).text(),'root must serve the current application entry, not old landing');
 const verification=readFileSync(root+'scripts/update.sh','utf8').match(/sh -ec '(\n\s+served=[\s\S]*?)'; then/)[1];execFileSync('docker',['exec',name,'sh','-ec',verification],{stdio:'pipe'});
 const legacy=await fetch(base+'/landing.html',{redirect:'manual'});assert.equal(legacy.status,302);assert.equal(new URL(legacy.headers.get('location'),base).pathname,'/');assert.equal((await fetch(base+'/demo/old-photo.jpg')).status,404);
 const result=spawnSync(process.execPath,[root+'tests/site-home-ui.mjs'],{cwd:root,env:{...process.env,VOLNA_SITE_TEST_URL:base},stdio:'inherit'});assert.equal(result.status,0,'browser scenarios must pass through production Nginx');
 console.log('PASS: production Nginx homepage, legacy redirect, no-cache and no demo media');
}finally{if(started)execFileSync('docker',['stop',name],{stdio:'pipe'});rmSync(directory,{recursive:true,force:true});}
