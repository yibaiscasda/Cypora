// File-backed projects and document metadata. All destructive operations stay in main.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const supported=p=>/\.(md|markdown|mdown|txt)$/i.test(p);
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const inside=(root,p)=>{const relative=path.relative(root,p);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
function filename(name){
  name=String(name||'').trim();
  if(!name||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('请输入有效的文件名，不要包含路径或特殊字符');
  if(!supported(name))name+='.md';return name;
}
// Keep only document-owned attachment folders. Their names remain stable on
// rename because rewriting arbitrary Markdown (including code examples) is unsafe.
function attachmentNames(documentPath,known=[]){
  const own=path.basename(documentPath,path.extname(documentPath))+'.assets',seen=new Set();
  return [...(Array.isArray(known)?known:[]),own].filter(name=>
    typeof name==='string'&&name.endsWith('.assets')&&name!=='.assets'&&
    !/[<>:"/\\|?*\x00-\x1f]/.test(name)&&!/[. ]$/.test(name)&&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)).filter(name=>{
      const key=process.platform==='win32'?name.toLowerCase():name;
      if(seen.has(key))return false;seen.add(key);return true;
    });
}
async function removeCreated(entries){
  // Remove only paths this operation created, never a recursive user directory.
  for(const entry of [...entries].reverse()){
    try{if(entry.directory)await fs.rmdir(entry.path);else await fs.unlink(entry.path);}
    catch(error){if(error.code!=='ENOENT')console.warn('Attachment cleanup retained:',entry.path,error.code);}
  }
}
async function copyAttachmentTree(source,target,created){
  const stat=await fs.lstat(source);
  if(stat.isSymbolicLink())throw Error('附件包含符号链接或目录联接，文稿未移动');
  if(stat.isDirectory()){
    await fs.mkdir(target);created.push({path:target,directory:true});
    for(const name of (await fs.readdir(source)).sort())await copyAttachmentTree(path.join(source,name),path.join(target,name),created);
  }else if(stat.isFile()){
    try{await fs.copyFile(source,target,require('node:fs').constants.COPYFILE_EXCL);}
    catch(error){if(error.code!=='EEXIST')created.push({path:target,directory:false});throw error;}
    created.push({path:target,directory:false});
  }else throw Error('附件包含不支持的文件，文稿未移动');
}
async function prepareAttachmentMove(sourceDocument,destinationDocument,known){
  const source=await fs.realpath(path.dirname(sourceDocument)),destination=await fs.realpath(path.dirname(destinationDocument));
  const names=attachmentNames(sourceDocument,known),present=[];
  for(const name of names){
    const folder=path.join(source,name);
    const stat=await fs.lstat(folder).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!stat)continue;
    if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('文稿附件必须是普通文件夹，文稿未移动');
    present.push(name);
  }
  // Recording the old folder on rename lets a later move preserve oldname.assets.
  if(same(source,destination))return {names:present,rollback:async()=>{}};
  for(const name of present){
    const exists=await fs.lstat(path.join(destination,name)).then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error;});
    if(exists)throw Error('目标位置已有附件文件夹“'+name+'”，文稿未移动且不会覆盖');
  }
  const staged=[],published=[];
  try{
    if(present.length){
      const staging=await fs.mkdtemp(path.join(destination,'.cypora-attachments-'));staged.push({path:staging,directory:true});
      // Validate/copy the complete source before publishing any attachment folder.
      for(const name of present)await copyAttachmentTree(path.join(source,name),path.join(staging,name),staged);
      for(const name of present)await copyAttachmentTree(path.join(staging,name),path.join(destination,name),published);
    }
  }catch(error){await removeCreated(published);throw error;}
  finally{await removeCreated(staged);}
  return {names:present,rollback:()=>removeCreated(published)};
}
class Library{
  constructor({state,persist,allowed,home}){
    this.state=state;this.persist=persist;this.allowed=allowed;this.home=home;
    state.documents=Array.isArray(state.documents)?state.documents:[];
    state.projects=Array.isArray(state.projects)?state.projects:[];
    const byPath=new Map();
    for(const d of state.documents){if(!d?.path)continue;const key=path.resolve(d.path).toLowerCase(),prior=byPath.get(key);if(!prior||d.lastOpened>prior.lastOpened)byPath.set(key,d);}
    state.documents=[...byPath.values()];
    // Migrate the current visible order once. Opening a file only updates usage history.
    const docs=[...state.documents].sort((a,b)=>b.lastOpened-a.lastOpened);
    for(const [i,d] of docs.entries()){if(!Number.isFinite(d.order))d.order=i;if(!Number.isFinite(d.pinOrder))d.pinOrder=i;}
    state.projects.forEach((p,i)=>{if(!Number.isFinite(p.order))p.order=i;});
  }
  get(id){const d=this.state.documents.find(d=>d.id===id);if(!d)throw Error('文档已不在列表中');return d;}
  project(id){const p=this.state.projects.find(p=>p.id===id);if(!p)throw Error('项目不存在');return p;}
  track(p,{opened=false,projectId}={}){
    p=path.resolve(p);let d=this.state.documents.find(d=>same(d.path,p));
    if(!d){d={id:crypto.randomUUID(),path:p,pinned:false,archived:false,closed:false,lastOpened:0,order:Math.min(0,...this.state.documents.map(x=>x.order||0))-1,pinOrder:0};this.state.documents.push(d);}
    if(projectId!==undefined)d.projectId=projectId;
    else d.projectId=this.state.projects.filter(project=>inside(project.path,p)).sort((a,b)=>b.path.length-a.path.length)[0]?.id||null;
    if(opened){d.closed=false;d.lastOpened=Date.now();this.state.lastFile=p;}
    d.name=path.basename(p);d.missing=false;this.allowed.add(p);return d;
  }
  async addProject(p){
    p=await fs.realpath(p);if(!(await fs.stat(p)).isDirectory())throw Error('项目必须是文件夹');
    let project=this.state.projects.find(x=>same(x.path,p));
    if(!project){project={id:crypto.randomUUID(),path:p,name:path.basename(p),expanded:true,order:Math.max(-1,...this.state.projects.map(x=>x.order||0))+1};this.state.projects.push(project);}
    await this.scan(project);await this.persist();return project;
  }
  async scan(project){
    let count=0;project.error=null;
    const walk=async(dir,depth=0)=>{
      for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))){
        if(e.name.startsWith('.')||e.name==='node_modules'||e.isSymbolicLink())continue;
        if(count>=1500){project.truncated=true;return;}
        const p=path.join(dir,e.name);
        if(e.isDirectory()&&depth<5)await walk(p,depth+1);
        else if(e.isFile()&&supported(p)){this.track(p,{projectId:project.id});count++;}
      }
    };
    try{project.truncated=false;await walk(project.path);}catch(e){project.error=e.code==='ENOENT'?'文件夹不存在':e.message;}
  }
  async snapshot(refresh=false){
    if(refresh){for(const project of this.state.projects)await this.scan(project);await this.persist();}
    for(const d of this.state.documents){d.missing=!await fs.stat(d.path).then(s=>s.isFile()).catch(()=>false);}
    return {documents:this.state.documents.map(d=>({...d})),projects:this.state.projects.map(p=>({...p})),lastFile:this.state.lastFile};
  }
  async initialize(){
    for(const p of this.state.recent||[])if(await fs.stat(p).then(s=>s.isFile()).catch(()=>false))this.track(p);
    if(!this.state.lastFile&&this.state.recent?.length)this.state.lastFile=this.state.recent[0];
    await this.snapshot(true);
  }
  async create(name,projectId){
    const root=projectId?this.project(projectId).path:this.home;
    await fs.mkdir(root,{recursive:true});const p=path.join(root,filename(name));
    await fs.writeFile(p,'',{encoding:'utf8',flag:'wx'}).catch(e=>{if(e.code==='EEXIST')throw Error('同名文件已存在，请换一个名字');throw e;});
    const d=this.track(p,{opened:true});await this.persist();return d;
  }
  async duplicate(id){
    const original=this.get(id),extension=path.extname(original.path),stem=path.basename(original.path,extension);
    for(let n=1;n<=1000;n++){
      const target=path.join(path.dirname(original.path),stem+' 副本'+(n===1?'':' '+n)+extension);
      try{await fs.copyFile(original.path,target,require('node:fs').constants.COPYFILE_EXCL);}
      catch(error){if(error.code==='EEXIST')continue;throw error;}
      const copy=this.track(target,{projectId:original.projectId});
      // Relative image references keep pointing to the same folder. Track that
      // folder so a later move of the copy can retain its attachments.
      copy.attachmentFolders=attachmentNames(original.path,original.attachmentFolders);
      try{await this.persist();return copy;}
      catch(error){this.state.documents=this.state.documents.filter(d=>d.id!==copy.id);this.allowed.delete(target);await fs.unlink(target).catch(()=>{});throw error;}
    }
    throw Error('副本名称已用完，请先重命名文稿');
  }
  async relocate(id,destination){
    const d=this.get(id),old=d.path;
    if(same(old,destination))return {document:d,oldPath:old};
    const attachments=await prepareAttachmentMove(old,destination,d.attachmentFolders);
    try{
      // COPYFILE_EXCL makes existing-destination protection atomic, including across disks.
      await fs.copyFile(old,destination,require('node:fs').constants.COPYFILE_EXCL).catch(e=>{if(e.code==='EEXIST')throw Error('目标位置已有同名文件，不会覆盖');throw e;});
      try{await fs.unlink(old);}catch(e){await fs.rm(destination,{force:true});throw e;}
    }catch(error){await attachments.rollback();throw error;}
    d.attachmentFolders=attachments.names;
    d.path=destination;d.name=path.basename(destination);this.allowed.delete(old);this.allowed.add(destination);
    this.state.documents=this.state.documents.filter(other=>other===d||!same(other.path,destination));
    d.projectId=this.state.projects.filter(p=>inside(p.path,destination)).sort((a,b)=>b.path.length-a.path.length)[0]?.id||null;
    this.state.recent=(this.state.recent||[]).map(p=>same(p,old)?destination:p);
    if(this.state.lastFile&&same(this.state.lastFile,old))this.state.lastFile=destination;
    await this.persist();return {document:{...d},oldPath:old};
  }
  async rename(id,name){const d=this.get(id);return this.relocate(id,path.join(path.dirname(d.path),filename(name)));}
  async move(id,projectId){return this.relocate(id,path.join(this.project(projectId).path,this.get(id).name));}
  async update(id,patch){
    if(patch.pinned===true&&!this.get(id).pinned)this.get(id).pinOrder=Math.min(0,...this.state.documents.map(x=>x.pinOrder||0))-1;
    const d=this.get(id);for(const k of ['pinned','archived','closed'])if(k in patch)d[k]=!!patch[k];
    await this.persist();return {...d};
  }
  async reorder(kind,sourceId,targetId,after=false){
    if(!['documents','pinned','projects'].includes(kind))throw Error('无效的排列类型');
    if(sourceId===targetId)return;
    const items=kind==='projects'?this.state.projects:this.state.documents,key=kind==='pinned'?'pinOrder':'order';
    const source=items.find(x=>x.id===sourceId),target=items.find(x=>x.id===targetId);
    if(!source||!target)throw Error('排列项目已不存在');
    if(kind==='pinned'&&(!source.pinned||!target.pinned))throw Error('只能排列已置顶文稿');
    const list=items.filter(x=>x!==source).sort((a,b)=>(a[key]||0)-(b[key]||0));
    list.splice(list.indexOf(target)+(after?1:0),0,source);list.forEach((x,i)=>x[key]=i);
    await this.persist();return true;
  }
  async remove(id){const d=this.get(id);this.state.documents=this.state.documents.filter(x=>x!==d);this.state.recent=(this.state.recent||[]).filter(p=>!same(p,d.path));if(same(this.state.lastFile||'.',d.path))this.state.lastFile=null;this.allowed.delete(d.path);await this.persist();}
  async projectUpdate(id,patch){
    const p=this.project(id);
    if('name'in patch){const name=String(patch.name).trim();if(!name)throw Error('项目名称不能为空');p.name=name.slice(0,100);}
    if('expanded'in patch)p.expanded=!!patch.expanded;
    await this.persist();return {...p};
  }
  async removeProject(id){
    this.project(id);this.state.projects=this.state.projects.filter(p=>p.id!==id);
    for(const d of this.state.documents)if(d.projectId===id)d.projectId=null;
    await this.persist();
  }
  async search(query){
    query=String(query||'').trim().toLocaleLowerCase();if(!query)return [];
    const results=[];
    for(const d of this.state.documents.filter(d=>!d.closed).sort((a,b)=>b.lastOpened-a.lastOpened)){
      let snippet='',match=d.name.toLocaleLowerCase().includes(query);
      if(!match&&!d.missing){try{const s=await fs.stat(d.path);if(s.size<=1024*1024){const text=await fs.readFile(d.path,'utf8'),i=text.toLocaleLowerCase().indexOf(query);if(i>=0){match=true;snippet=text.slice(Math.max(0,i-35),i+100).replace(/\s+/g,' ');}}}catch{}}
      if(match)results.push({...d,snippet});if(results.length>=80)break;
    }
    return results;
  }
}
module.exports={Library,filename,inside,same};
