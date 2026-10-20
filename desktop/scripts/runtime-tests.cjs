'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const latestFile=process.platform==='darwin'?`../out/macos/latest-${process.arch}.json`:'../out/latest.json';
const exe=process.env.CODEX_HUD_DESKTOP_EXECUTABLE||JSON.parse(fs.readFileSync(path.join(__dirname,latestFile),'utf8')).executable;
const tests=fs.readdirSync(path.join(repo,'test')).filter(file=>file.endsWith('.test.js')).map(file=>path.join(repo,'test',file));
const resultDir=path.join(__dirname,'../test-results');fs.mkdirSync(resultDir,{recursive:true});
const log=fs.createWriteStream(path.join(resultDir,'electron-runtime.log'));
const child=spawn(exe,['--test',...tests],{cwd:repo,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log);child.stderr.pipe(log);
// Preserve native CI failure details in the job log without uploading artifacts.
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{log.end();console.log('Existing accounting/runtime suite under packaged Electron Node mode:',code===0?'PASS':'FAIL');process.exitCode=code===0?0:1;});
