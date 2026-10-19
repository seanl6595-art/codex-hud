'use strict';
const fs=require('node:fs'),path=require('node:path');
const bundleID='art.seanl6595.codex-hud.desktop';
const releaseVersion=require('./package.json').version;
const bundleVersion=releaseVersion.split('-')[0];
function createMacForgeConfig({icon,outDir}){
  return{
    outDir,
    packagerConfig:{name:'Codex HUD',executableName:'Codex HUD',appBundleId:bundleID,appVersion:bundleVersion,buildVersion:bundleVersion,icon,asar:false,prune:false,
      darwinDarkModeSupport:true,appCategoryType:'public.app-category.developer-tools',
      // Internal ad-hoc signing only. No Apple account, Developer ID or notarization.
      osxSign:{identity:'-',identityValidation:false,preEmbedProvisioningProfile:false,preAutoEntitlements:false,timestamp:'none',continueOnError:false},
      extendInfo:{CFBundleDisplayName:'Codex HUD',CFBundleGetInfoString:'Codex HUD macOS internal preview — native validation required',CodexHUDReleaseVersion:releaseVersion},
      afterCopy:[async({buildPath})=>{
        const file=path.join(buildPath,'package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8'));
        delete pkg.devDependencies;delete pkg.config;delete pkg.scripts;
        fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
      }]},
    makers:[{name:'@electron-forge/maker-zip',platforms:['darwin']}],
    publishers:[],plugins:[],rebuildConfig:{onlyModules:[]}
  };
}
module.exports={createMacForgeConfig,bundleID,bundleVersion,releaseVersion};
