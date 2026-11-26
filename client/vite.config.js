import {rmSync} from 'node:fs';
import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'./',build:{rollupOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),nativeCall:fileURLToPath(new URL('./native-call.html',import.meta.url))}}},plugins:[{name:'omit-production-demo',closeBundle(){rmSync(new URL('./dist/demo',import.meta.url),{recursive:true,force:true});rmSync(new URL('./dist/landing.html',import.meta.url),{force:true});}}],...(process.env.VOLNA_DESKTOP_BUILD==='1'?{publicDir:'.desktop-public'}:{}),server:{proxy:{'/api':'http://127.0.0.1:3000'}}});
