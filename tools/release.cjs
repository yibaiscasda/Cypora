// Build publishable archives from explicit source/runtime lists, never from a
// working installation containing test profiles or user data.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),root=path.resolve(__dirname,'..'),pkg=require('../package.json');
async function release(){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required for this release target.');
  const version=pkg.version,dist=path.join(root,'dist'),work=path.join(root,'.release-work',new Date().toISOString().replace(/[:.]/g,'-'));
  const name=`Cypora-v${version}`,source=path.join(work,name+'-source'),portable=path.join(work,name+'-windows-x64');
  await fs.mkdir(dist,{recursive:true});await fs.mkdir(source,{recursive:true});await fs.mkdir(portable,{recursive:true});
  for(const suffix of ['source','windows-x64'])if(await fs.stat(path.join(dist,`${name}-${suffix}.zip`)).catch(()=>null))throw Error('Archive already exists; preserve it and choose a new version.');
  const rootFiles=(await fs.readdir(root,{withFileTypes:true})).filter(entry=>entry.isFile()&&(/\.(?:js|cjs|css|html)$/.test(entry.name)||['README.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','.gitignore','.gitattributes'].includes(entry.name))).map(entry=>entry.name);
  for(const file of rootFiles)await fs.copyFile(path.join(root,file),path.join(source,file));
  for(const folder of ['assets','examples','tools','docs'])await fs.cp(path.join(root,folder),path.join(source,folder),{recursive:true});
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  await execute(process.execPath,[path.join(root,'tools','package.cjs'),'--stage'],{cwd:root,windowsHide:true,maxBuffer:1024*1024});
  const runtime=path.join(root,'node_modules','electron','dist');
  for(const entry of await fs.readdir(runtime,{withFileTypes:true})){
    if(['electron.exe','resources'].includes(entry.name))continue;
    await fs.cp(path.join(runtime,entry.name),path.join(portable,entry.name),{recursive:true});
  }
  await fs.copyFile(path.join(root,'release',`Cypora-${version}`,'Cypora.exe'),path.join(portable,'Cypora.exe'));
  const app=path.join(portable,'resources','app');await fs.mkdir(app,{recursive:true});
  for(const file of rootFiles.filter(file=>!file.startsWith('.')))await fs.copyFile(path.join(root,file),path.join(app,file));
  for(const folder of ['assets','examples','tools','docs'])await fs.cp(path.join(root,folder),path.join(app,folder),{recursive:true});
  for(const folder of ['vditor','mathjax','@mathjax'])await fs.cp(path.join(root,'node_modules',folder),path.join(app,'node_modules',folder),{recursive:true});
  await fs.copyFile(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(portable,'THIRD_PARTY_NOTICES.md'));
  const manifest={version,platform:'win32-x64',createdAt:new Date().toISOString(),sourceFiles:rootFiles,artifacts:[]};
  for(const directory of [source,portable]){
    const archive=path.join(dist,path.basename(directory)+'.zip');
    await execute(ps,['-NoProfile','-NonInteractive','-File',path.join(root,'tools','zip-release.ps1'),'-SourceDirectory',directory,'-DestinationFile',archive],{windowsHide:true,maxBuffer:1024*1024});
    const data=await fs.readFile(archive);manifest.artifacts.push({name:path.basename(archive),bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});
  }
  await fs.writeFile(path.join(dist,'SHA256SUMS.txt'),manifest.artifacts.map(a=>a.sha256+'  '+a.name).join('\n')+'\n');
  await fs.writeFile(path.join(dist,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
}
release().catch(error=>{console.error(error);process.exit(1);});
