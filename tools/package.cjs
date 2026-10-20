// Build a user-local installation without altering Typora or default file associations.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const source=path.resolve(__dirname,'..');
const staging=process.argv.includes('--stage');
const packageVersion=require('../package.json').version;
const stagingDirectory=path.join(source,'release','Cypora-'+packageVersion);
const install=staging?stagingDirectory:path.join(os.homedir(),'AppData','Local','Programs','Cypora');
async function powershell(script,args){
  const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout}=await execute(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,script),...args],{windowsHide:true});
  if(stdout.trim())console.log(stdout.trim());
}
async function build(){
  if(!(staging&&install===stagingDirectory)&&!install.startsWith(path.join(os.homedir(),'AppData','Local','Programs')+path.sep))throw Error('Unexpected install directory');
  const runtime=path.join(source,'node_modules','electron','dist');
  if(!await fs.stat(path.join(runtime,'electron.exe')).catch(()=>null))throw Error('Electron runtime is missing');
  await fs.mkdir(install,{recursive:true});
  const sameRuntime=await fs.readFile(path.join(install,'version'),'utf8').then(async v=>v===await fs.readFile(path.join(runtime,'version'),'utf8')).catch(()=>false);
  if(!sameRuntime){
    await fs.cp(runtime,install,{recursive:true,filter:p=>path.basename(p)!=='default_app.asar'&&path.basename(p)!=='electron.exe'});
  }
  // Always brand a fresh staging copy, including updates with the same Electron version.
  const stage=path.join(install,'Cypora-icon-update.exe');
  try{
    await fs.copyFile(path.join(runtime,'electron.exe'),stage);
    await powershell('set-exe-icon.ps1',['-Executable',stage,'-Icon',path.join(source,'assets','cypora.ico')]);
    const {rcedit}=await import('rcedit');
    const {version}=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
    await rcedit(stage,{'version-string':{CompanyName:'Cypora',FileDescription:'Cypora',ProductName:'Cypora',InternalName:'Cypora',OriginalFilename:'Cypora.exe',LegalCopyright:'Cypora contributors'},'file-version':version,'product-version':version});
    await fs.rename(stage,path.join(install,'Cypora.exe'));
  }catch(error){
    if(error.code==='EPERM'||error.code==='EBUSY')throw Error('请先从应用菜单退出 Cypora，再重新打包；不会强制关闭未保存文稿。');
    throw error;
  }finally{await fs.rm(stage,{force:true}).catch(()=>{});}
  const appDir=path.join(install,'resources','app');await fs.mkdir(appDir,{recursive:true});
  for(const file of ['main.cjs','file-preferences.cjs','editor-preferences.js','reading-preferences.js','claude-theme.css','codex-import.cjs','conversation-model.js','conversation-bridge.js','conversations.js','conversations.css','code-blocks.js','code-blocks.css','library.cjs','editor-menu.cjs','editor-tools.js','planner.cjs','settings-model.js','preload.cjs','index.html','renderer.js','workspace.js','organizer.js','preferences.js','math-config.js','style.css','workspace.css','organizer.css','preferences.css','package.json','README.md','LICENSE'])await fs.copyFile(path.join(source,file),path.join(appDir,file));
  await fs.cp(path.join(source,'assets'),path.join(appDir,'assets'),{recursive:true});
  await fs.cp(path.join(source,'examples'),path.join(appDir,'examples'),{recursive:true});
  await fs.mkdir(path.join(appDir,'tools'),{recursive:true});
  await fs.copyFile(path.join(source,'tools','self-test.cjs'),path.join(appDir,'tools','self-test.cjs'));
  await fs.copyFile(path.join(source,'tools','planner-test.cjs'),path.join(appDir,'tools','planner-test.cjs'));
  await fs.copyFile(path.join(source,'tools','settings-test.cjs'),path.join(appDir,'tools','settings-test.cjs'));
  await fs.copyFile(path.join(source,'tools','editing-test.cjs'),path.join(appDir,'tools','editing-test.cjs'));
  for(const name of ['vditor','mathjax','@mathjax'])await fs.cp(path.join(source,'node_modules',name),path.join(appDir,'node_modules',name),{recursive:true});
  for(const name of ['quiet-test.cjs','context-menu-test.cjs','library-attachments-test.cjs','code-wrap-test.cjs','editor-preferences-test.cjs','file-preferences-test.cjs','reading-preferences-test.cjs','markdown-preferences-test.cjs','code-blocks-test.cjs','conversation-model-test.cjs','conversations-ui-test.cjs','codex-import-test.cjs','conversation-save-test.cjs'])await fs.copyFile(path.join(source,'tools',name),path.join(appDir,'tools',name));
  if(!staging)await powershell('refresh-shortcuts.ps1',['-Install',install]);
  console.log(JSON.stringify({installed:true,path:install,executable:path.join(install,'Cypora.exe')}));
}
build().catch(e=>{console.error(e);process.exit(1);});
