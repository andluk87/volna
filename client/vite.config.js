import {rmSync} from 'node:fs';
import { defineConfig } from 'vite';
export default defineConfig({base:'./',plugins:[{name:'omit-production-demo',closeBundle(){rmSync(new URL('./dist/demo',import.meta.url),{recursive:true,force:true});rmSync(new URL('./dist/landing.html',import.meta.url),{force:true});}}],...(process.env.VOLNA_DESKTOP_BUILD==='1'?{publicDir:'.desktop-public'}:{}),server:{proxy:{'/api':'http://127.0.0.1:3000'}}});
