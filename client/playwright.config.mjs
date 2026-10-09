import {defineConfig} from '@playwright/test';
const sizes=[[1920,1080],[1440,900],[1366,768],[1024,768],[390,844]];
export default defineConfig({
 testDir:'./tests',outputDir:'../.tmp/playwright-results',snapshotPathTemplate:'../design/checks/baselines/{projectName}/{arg}{ext}',fullyParallel:false,workers:1,retries:0,timeout:30000,
 use:{baseURL:'http://127.0.0.1:5173',locale:'ru-RU',timezoneId:'UTC',reducedMotion:'reduce',deviceScaleFactor:1,trace:'retain-on-failure',...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{launchOptions:{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}}:{})},
 projects:sizes.flatMap(([width,height])=>['light','dark'].map(colorScheme=>({name:`${width}x${height}-${colorScheme}`,use:{viewport:{width,height},colorScheme}}))),
 webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
 reporter:[['list'],['html',{outputFolder:'../.tmp/playwright-report',open:'never'}]],
 expect:{toHaveScreenshot:{animations:'disabled',maxDiffPixelRatio:.002}}
});
