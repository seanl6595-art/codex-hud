'use strict';
// Export the existing SVG brand geometry; no generated character/artwork or font.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const desktop=path.resolve(__dirname,'..'),source=path.join(desktop,'assets/icon-1024.png');
async function exportSource(){
  const {chromium}=require('@playwright/test');
  const browser=await chromium.launch({channel:process.env.PW_CHANNEL||'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
    await page.route('**/*',route=>route.abort());
    const svg=fs.readFileSync(path.join(desktop,'assets/icon.svg'),'utf8').replace('width="256" height="256"','width="1024" height="1024"');
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block}</style>'+svg);
    await page.screenshot({path:source,omitBackground:true});
  }finally{await browser.close();}
  return source;
}
function createMacIcon(directory){
  if(process.platform!=='darwin')throw Error('ICNS export requires native macOS iconutil.');
  if(!fs.existsSync(source))throw Error('Tracked icon-1024.png is missing; export it from icon.svg first.');
  const iconset=path.join(directory,'CodexHUD.iconset');fs.mkdirSync(iconset,{recursive:true});
  for(const size of [16,32,128,256,512])for(const scale of [1,2]){
    const destination=path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`);
    execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),source,'--out',destination],{stdio:'ignore'});
  }
  const output=path.join(directory,'CodexHUD.icns');
  execFileSync('/usr/bin/iconutil',['-c','icns','-o',output,iconset],{stdio:'pipe'});
  return output;
}
if(require.main===module){
  if(process.argv.includes('--source-only'))exportSource().then(console.log).catch(error=>{console.error(error);process.exitCode=1});
  else{try{console.log(createMacIcon(path.join(desktop,'out/mac-icon')));}catch(error){console.error(error.message);process.exitCode=1;}}
}
module.exports={exportSource,createMacIcon};
