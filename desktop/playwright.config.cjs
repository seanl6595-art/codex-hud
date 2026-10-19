'use strict';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./test/native',testMatch:'*.spec.cjs',workers:1,fullyParallel:false,timeout:60000,expect:{timeout:15000},reporter:[['list'],['json',{outputFile:'test-results/native-results.json'}]],outputDir:process.env.CODEX_HUD_DESKTOP_TEST_ROOT||'test-results/native',use:{trace:'retain-on-failure'}});
