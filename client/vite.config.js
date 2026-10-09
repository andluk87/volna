import { defineConfig } from 'vite';
export default defineConfig({base:'./',...(process.env.VOLNA_DESKTOP_BUILD==='1'?{publicDir:'.desktop-public'}:{}),server:{proxy:{'/api':'http://127.0.0.1:3000'}}});
