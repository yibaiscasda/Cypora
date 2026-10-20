const {app, BrowserWindow, Menu, dialog, ipcMain, shell, Notification, Tray, nativeTheme, clipboard, nativeImage} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL,fileURLToPath} = require('node:url');
const {Library,same}=require('./library.cjs');
const {Planner}=require('./planner.cjs');
const Preferences=require('./settings-model.js');
const EditorMenu=require('./editor-menu.cjs');
const FilePreferences=require('./file-preferences.cjs');
const {CodexImport,readImportFile}=require('./codex-import.cjs');
const codexImport=new CodexImport();
app.setName('Cypora');
const testing = process.argv.includes('--self-test');
if(testing){
  // Automated checks must not open native menus or steal the user's desktop.
  for(const name of ['show','showInactive','focus'])BrowserWindow.prototype[name]=function(){};
  Menu.prototype.popup=function(){};
  app.on('browser-window-created',(_event,window)=>window.webContents.setBackgroundThrottling(false));
}
const windowsAppId=app.isPackaged?'com.cypora.desktop':testing?'com.cypora.test':'com.cypora.development';
if(process.platform==='win32')app.setAppUserModelId(windowsAppId);
const profileArg=process.argv.find(a=>a.startsWith('--profile='));
if (testing) app.setPath('userData', path.join(__dirname, '.test-profile'));
else if(profileArg)app.setPath('userData',path.resolve(profileArg.slice(10)));
const ownsInstance=testing||app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();
let win, library, planner, tray, reminderTimer, state = {recent:[], theme:'light', mode:'ir',autoSave:true}, current = null, lastHash = null;
let dirty = false, closing = false, initialFile = null, root = null;
const allowed = new Set();
app.on('second-instance',(_event,argv)=>{if(!win)return;if(win.isMinimized())win.restore();win.show();win.focus();const p=argv.find(arg=>/\.(md|markdown|mdown|txt)$/i.test(arg)&&!arg.startsWith('-'));if(p){const resolved=path.resolve(p);allowed.add(resolved);action('open',resolved);}});
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const draftPath = () => path.join(app.getPath('userData'), 'recovery.json');
async function jsonRead(p, fallback) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } }
async function atomic(p, text) {
  const tmp = `${p}.cypora-${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, text, 'utf8'); await fs.rename(tmp, p); }
  catch(e) { await fs.rm(tmp, {force:true}).catch(()=>{}); throw e; }
}
let persistQueue=Promise.resolve();
async function persist(){const text=JSON.stringify(state,null,2);persistQueue=persistQueue.catch(()=>{}).then(()=>atomic(settingsPath(),text));await persistQueue;}
async function remember(p){ state.recent = [p,...state.recent.filter(x=>x!==p)].slice(0,15); await persist(); menu(); }
function title(){ win?.setTitle(`${dirty?'● ':''}${current?path.basename(current):'未命名'} — Cypora`); }
function action(name, arg){ win?.webContents.send('action', {name,arg}); }
function showWindow(){if(win.isMinimized())win.restore();win.show();win.focus();}
function keepTray(){
  if(tray)return;tray=new Tray(path.join(__dirname,'assets','cypora.ico'));tray.setToolTip('Cypora · 定时提醒运行中');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Cypora',click:showWindow},{label:'定时任务',click:()=>{showWindow();action('tasks');}},{type:'separator'},{label:'退出 Cypora（停止提醒）',click:()=>{showWindow();action('quit');}}]));tray.on('double-click',showWindow);
}
const notifications=new Set();
async function deliverReminder(receipt){
  const show=state.notifications!=='never'&&(state.notifications!=='unfocused'||!win.isFocused()||!win.isVisible());
  if(show&&Notification.isSupported()&&!testing){const n=new Notification({title:state.notificationPreview===false?'Cypora 提醒':receipt.name,body:state.notificationPreview===false?'你有一条到期提醒，点击查看。':receipt.notes||'提醒时间已到，点击打开关联文稿或项目。',silent:state.notificationSound==='none',icon:path.join(__dirname,'assets','cypora.ico')});notifications.add(n);n.on('click',()=>{showWindow();action('open-reminder',receipt.id);});n.on('close',()=>notifications.delete(n));n.show();}
  action('planner-changed');
}
function menu(){
  const template=[
    {label:'文件',submenu:[
      {label:'新建文稿…',accelerator:'CmdOrCtrl+N',click:()=>action('create-document')},
      {label:'打开…',accelerator:'CmdOrCtrl+O',click:()=>action('open')},
      {label:'导入 Codex 对话…',click:()=>action('import-conversations')},
      {label:'添加项目…',accelerator:'CmdOrCtrl+Shift+O',click:()=>action('folder')},
      {label:'最近文件',submenu:state.recent.length?state.recent.map(p=>({label:p,click:()=>{allowed.add(p);action('open',p);}})):[{label:'暂无',enabled:false}]},
      {type:'separator'}, {label:'保存',accelerator:'CmdOrCtrl+S',click:()=>action('save')},
      {label:'另存为…',accelerator:'CmdOrCtrl+Shift+S',click:()=>action('save-as')},
      {label:'在 Typora 中打开已保存文稿',click:()=>action('open-in-typora')},
      {type:'separator'}, {label:'导出 HTML…',click:()=>action('export-html')},
      {label:'导出 PDF…',accelerator:'CmdOrCtrl+Shift+E',click:()=>action('export-pdf')},
      {label:'打印…',accelerator:'CmdOrCtrl+P',click:()=>action('print')},
      {type:'separator'}, {label:'退出 Cypora',click:()=>action('quit')}
    ]},
    {label:'编辑',submenu:EditorMenu.build(EditorMenu.editing,id=>action('edit-command',id)).concat([{type:'separator'},{label:'查找 / 替换',click:()=>action('find')},{label:'查找下一个',click:()=>action('find-next')},{label:'查找上一个',click:()=>action('find-previous')},{label:'搜索文稿',click:()=>action('search-library')},{label:'偏好设置',click:()=>action('preferences')}])},
    {label:'段落',submenu:EditorMenu.build(EditorMenu.paragraph,id=>action('edit-command',id))},
    {label:'格式',submenu:EditorMenu.build(EditorMenu.format,id=>action('edit-command',id))},
    {label:'视图',submenu:[{label:'即时渲染',accelerator:'CmdOrCtrl+Shift+1',click:()=>action('mode','ir')},{label:'所见即所得',accelerator:'CmdOrCtrl+Shift+2',click:()=>action('mode','wysiwyg')},{label:'源码 / 预览',accelerator:'CmdOrCtrl+/',click:()=>action('mode','sv')},{type:'separator'},{label:'文稿大纲',click:()=>action('outline')},{label:'只读模式',click:()=>action('readonly')},{label:'格式工具栏',click:()=>action('toggle-pref','showToolbar')},{label:'状态栏',click:()=>action('toggle-pref','showStatusBar')},{label:'窗口置顶',click:()=>action('toggle-pref','alwaysOnTop')},{label:'切换侧栏',accelerator:'CmdOrCtrl+Shift+L',click:()=>action('sidebar')},{label:'专注模式',accelerator:'F8',click:()=>action('focus')},{label:'打字机模式',accelerator:'F9',click:()=>action('typewriter')},{type:'separator'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
    {label:'主题',submenu:['light','sepia','dark'].map((arg,i)=>({label:['浅色','纸张','深色'][i],click:()=>action('theme',arg)}))},
    {label:'工具',submenu:[{label:'定时任务',click:()=>action('tasks')},{label:'为当前文稿添加定时提醒…',click:()=>action('add-task')},{label:'模板储存',click:()=>action('templates')},{label:'保存当前内容为模板…',click:()=>action('save-template')}]},
    {label:'帮助',submenu:[{label:'偏好设置',accelerator:'CmdOrCtrl+,',click:()=>action('preferences')},{label:'使用指南',click:()=>action('help')},{label:'关于 Cypora',click:()=>dialog.showMessageBox(win,{type:'info',title:'Cypora',message:'Cypora '+app.getVersion(),detail:'Claude 风格的本地 Markdown 工作空间\n编辑器：Vditor · 数学：MathJax SVG\n独立应用，不包含 AI 或 Codex 账户接入。'})}]}
  ];
  // Custom bindings are dispatched in the renderer before the editor handles keystrokes.
  // Native accelerators would consume the previous binding after it is reassigned.
  const strip=items=>{for(const item of items){delete item.accelerator;if(Array.isArray(item.submenu))strip(item.submenu);}};strip(template);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function applyWindowPreferences(){
  if(!win)return;win.setAlwaysOnTop(!!state.alwaysOnTop,process.platform==='win32'?'screen-saver':'floating');win.webContents.setZoomFactor((state.zoom||100)/100);
}
async function confirmWindowClose(source){
  if(state.closeConfirmation!=='always'&&!(source==='shortcut'&&state.closeConfirmation==='shortcut'))return true;
  const answer=await dialog.showMessageBox(win,{type:'question',message:'关闭 Cypora 窗口？',detail:(state.closeBehavior==='tray'||(state.closeBehavior!=='quit'&&planner.hasActive))?'应用将留在系统托盘。':'应用将退出；提醒会在下次启动后补发。',buttons:['取消','关闭窗口'],defaultId:0,cancelId:0});return answer.response===1;
}
async function openFile(p){
  p=path.resolve(p); if(!allowed.has(p)) throw Error('请通过打开对话框或文件栏选择文件');
  const bytes=await fs.readFile(p); if(bytes.length>20*1024*1024) throw Error('此版本支持不超过 20 MB 的文本文件');
  if(bytes.includes(0)) throw Error('文件不是 UTF-8 文本');
  const text=bytes.toString('utf8'); current=p; lastHash=hash(bytes);dirty=false;title();library.track(p,{opened:true});await remember(p);
  return {path:p,text,baseURL:pathToFileURL(path.dirname(p)+path.sep).href};
}
async function askUnsaved(){
  if(!dirty)return 'discard';
  const r=await dialog.showMessageBox(win,{type:'warning',message:'保存当前文档的更改？',detail:'未保存的内容可以保存在文件中。',buttons:['保存','不保存','取消'],defaultId:0,cancelId:2});
  return ['save','discard','cancel'][r.response];
}
function register(){
  const on=(name,fn)=>ipcMain.handle(name,async(e,...args)=>{
    if(e.sender!==win.webContents || e.senderFrame!==win.webContents.mainFrame) throw Error('不允许的调用');
    try { return {ok:true,value:await fn(...args)}; } catch(e){return {ok:false,error:e.message};}
  });
  on('boot',async()=>({settings:state,library:await library.snapshot(),recovery:await jsonRead(draftPath(),null),initialFile,testing}));
  on('choose-file',async()=>{const r=await dialog.showOpenDialog(win,{filters:[{name:'Markdown / 文本',extensions:['md','markdown','mdown','txt']},{name:'所有文件',extensions:['*']}],properties:['openFile']});if(r.canceled)return null;const p=path.resolve(r.filePaths[0]);allowed.add(p);return p;});
  on('open-file',openFile);
  on('list-codex-conversations',()=>codexImport.list());
  on('read-codex-conversation',id=>codexImport.read(id));
  on('choose-conversation-files',async()=>{
    const result=await dialog.showOpenDialog(win,{title:'导入 Codex 对话',filters:[{name:'对话记录',extensions:['jsonl','json','md','txt']},{name:'所有文件',extensions:['*']}],properties:['openFile','multiSelections']});
    if(result.canceled)return null;
    if(result.filePaths.length>20)throw Error('每次最多导入 20 个对话文件。');
    const documents=[];let total=0;
    for(const filename of result.filePaths){const item=await readImportFile(filename);total+=Buffer.byteLength(item.text,'utf8');if(total>64*1024*1024)throw Error('本次导入合计不能超过 64 MB。');documents.push(item);}
    return documents;
  });
  on('open-in-typora',async()=>{
    if(!current||dirty)throw Error('请先保存当前文稿。');
    const candidates=[path.join(process.env.ProgramFiles||'C:\\Program Files','Typora','Typora.exe'),path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'Programs','Typora','Typora.exe')];
    const executable=await (async()=>{for(const candidate of candidates)if(await fs.stat(candidate).catch(()=>null))return candidate;return null;})();
    if(!executable)throw Error('未找到 Typora。文稿已经是标准 Markdown，可以手动用 Typora 打开。');
    const {spawn}=require('node:child_process');
    await new Promise((resolve,reject)=>{const child=spawn(executable,[current],{detached:true,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
    return true;
  });
  on('new-file',()=>{current=null;lastHash=null;dirty=false;title();});
  on('save-file',async(text,as,quiet=false,suggestedName='')=>{
    if(typeof text!=='string')throw Error('无效的文档');let p=current;
    if(!p||as){const name=typeof suggestedName==='string'?suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,90):'';const r=await dialog.showSaveDialog(win,{defaultPath:p||(name?name+'.md':'未命名.md'),filters:[{name:'Markdown',extensions:['md']},{name:'文本',extensions:['txt']}]});if(r.canceled)return null;p=r.filePath;}
    if(p===current&&lastHash){const bytes=await fs.readFile(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!bytes||hash(bytes)!==lastHash){if(quiet)return {conflict:true};const r=await dialog.showMessageBox(win,{type:'warning',message:bytes?'文件已被其他程序修改':'原文件已被移动或删除',detail:'是否用当前编辑内容写入此位置？取消后可以另存为保留两份。',buttons:['取消','覆盖'],defaultId:0,cancelId:0});if(r.response!==1)return null;}}
    const backup=path.join(app.getPath('userData'),'backups');await fs.mkdir(backup,{recursive:true});
    try{await fs.copyFile(p,path.join(backup,hash(p)+'.md'));}catch(e){if(e.code!=='ENOENT')throw e;}
    await atomic(p,text);current=p;allowed.add(p);lastHash=hash(text);dirty=false;title();library.track(p,{opened:true});await remember(p);await fs.rm(draftPath(),{force:true});
    return {path:p,baseURL:pathToFileURL(path.dirname(p)+path.sep).href};
  });
  on('dirty',v=>{dirty=!!v;title();});
  on('draft',async text=>{if(typeof text!=='string')throw Error('无效的草稿');await atomic(draftPath(),JSON.stringify({path:current,text,date:new Date().toISOString()}));});
  on('clear-draft',()=>fs.rm(draftPath(),{force:true}));
  on('unsaved',askUnsaved);
  on('settings',async s=>{const patch=Preferences.patch(s),previous=Object.fromEntries(Object.keys(patch).map(k=>[k,state[k]]));Object.assign(state,patch);try{await persist();}catch(e){Object.assign(state,previous);throw e;}applyWindowPreferences();return state;});
  on('copy-theme',(variant)=>{if(!['light','dark'].includes(variant))throw Error('无效主题');clipboard.writeText(Preferences.exportTheme(state.themes[variant],variant));return true;});
  on('read-clipboard',()=>clipboard.readText().slice(0,16001));
  on('read-editor-clipboard',()=>clipboard.readText().slice(0,20*1024*1024));
  on('write-clipboard',text=>{if(typeof text!=='string'||text.length>20*1024*1024)throw Error('无效的剪贴板内容');clipboard.writeText(text);return true;});
  on('write-rich-clipboard',data=>{
    if(!data||typeof data.text!=='string'||typeof data.html!=='string'||data.text.length+data.html.length>20*1024*1024)throw Error('剪贴板内容过大或无效');
    clipboard.write({text:data.text,html:data.html});return true;
  });
  on('image-content',async(operation,data)=>{
    if(!['copy','save'].includes(operation)||typeof data!=='string'||data.length>40*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))throw Error('无效图片数据');
    const image=nativeImage.createFromDataURL(data);if(image.isEmpty())throw Error('无法解码图片');
    if(operation==='copy'){clipboard.writeImage(image);return true;}
    const result=await dialog.showSaveDialog(win,{defaultPath:'图片.png',filters:[{name:'PNG 图片',extensions:['png']}]});
    if(result.canceled)return false;await fs.writeFile(result.filePath,image.toPNG());return true;
  });
  on('image-location',async(operation,url)=>{
    if(!['open','reveal'].includes(operation)||typeof url!=='string')throw Error('无效图片操作');
    const parsed=new URL(url);if(parsed.protocol!=='file:')throw Error('此操作需要本地图片');
    const target=fileURLToPath(parsed);if(!/\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$/i.test(target)||!(await fs.stat(target)).isFile())throw Error('不是可打开的本地图片');
    if(operation==='reveal')shell.showItemInFolder(target);else {const error=await shell.openPath(target);if(error)throw Error(error);}return true;
  });
  on('editor-context',(context={})=>{
    const dispatch=id=>action('edit-command',id),items=EditorMenu.context(context,dispatch);
    items.push({type:'separator'},{label:'为当前文稿添加定时提醒…',click:()=>action('add-task')});
    Menu.buildFromTemplate(items).popup({window:win});return true;
  });
  on('outline-context',()=>{Menu.buildFromTemplate([{label:'展开所有章节',click:()=>action('outline-expand')},{label:'折叠所有章节',click:()=>action('outline-collapse')},{label:'大纲设置…',click:()=>action('editor-preferences')}]).popup({window:win});});
  on('choose-document-home',async()=>{const result=await dialog.showOpenDialog(win,{title:'选择无项目文稿的默认文件夹',defaultPath:library.home,properties:['openDirectory','createDirectory']});if(result.canceled)return null;state.documentHome=await fs.realpath(result.filePaths[0]);library.home=state.documentHome;await persist();return state.documentHome;});
  on('reset-document-home',async()=>{state.documentHome=path.join(app.getPath('documents'),'Cypora 文稿');library.home=state.documentHome;await persist();return state.documentHome;});
  on('open-settings-folder',async()=>{const error=await shell.openPath(app.getPath('userData'));if(error)throw Error(error);});
  on('test-notification',async()=>{if(Notification.isSupported()&&!testing)new Notification({title:'Cypora 测试通知',body:'通知设置已就绪。',silent:state.notificationSound==='none'}).show();return Notification.isSupported();});
  on('open-notification-settings',()=>process.platform==='win32'?shell.openExternal('ms-settings:notifications'):false);
  on('confirm-close',source=>confirmWindowClose(source));
  on('show-backups',async()=>{const p=path.join(app.getPath('userData'),'backups');await fs.mkdir(p,{recursive:true});const error=await shell.openPath(p);if(error)throw Error(error);});
  on('library',async(refresh=false)=>library.snapshot(!!refresh));
  on('planner',()=>planner.snapshot());
  const plannerChange=fn=>async(...args)=>{const result=await fn(...args);action('planner-changed');return result;};
  on('task-save',plannerChange(input=>planner.saveTask(input)));
  on('task-status',plannerChange((id,active)=>planner.setStatus(id,!!active)));
  on('task-delete',plannerChange(id=>planner.removeTask(id)));
  on('reminder-read',plannerChange(id=>planner.markRead(id)));
  on('template-save',plannerChange(input=>planner.saveTemplate(input)));
  on('template-delete',plannerChange(id=>planner.removeTemplate(id)));
  on('template-create-document',async(id,name,projectId)=>{
    const template=planner.template(id),doc=await library.create(name,projectId);
    try{await atomic(doc.path,template.content);}catch(e){await fs.rm(doc.path,{force:true});await library.remove(doc.id);throw e;}return doc;
  });
  on('quit-app',()=>{closing=true;win.close();});
  on('add-project',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择项目文件夹',properties:['openDirectory','createDirectory']});if(r.canceled)return null;const project=await library.addProject(r.filePaths[0]);return {project,library:await library.snapshot()};});
  on('create-document',async(name,projectId)=>library.create(name,projectId));
  on('duplicate-document',async id=>library.duplicate(id));
  on('copy-document-path',id=>{clipboard.writeText(library.get(id).path);return true;});
  on('document-properties',async id=>{
    const doc=library.get(id),stat=await fs.stat(doc.path);
    const properties={name:doc.name,path:doc.path,size:stat.size,modified:stat.mtime.toISOString(),created:stat.birthtime.toISOString()};
    await dialog.showMessageBox(win,{type:'info',title:'文稿属性',message:doc.name,detail:`位置：${doc.path}\n大小：${stat.size.toLocaleString()} 字节\n修改时间：${stat.mtime.toLocaleString()}\n创建时间：${stat.birthtime.toLocaleString()}`,buttons:['确定']});
    return properties;
  });
  on('document-update',async(id,patch)=>library.update(id,patch));
  on('library-reorder',async(kind,source,target,after)=>library.reorder(kind,source,target,!!after));
  on('rename-document',async(id,name)=>{const r=await library.rename(id,name);if(current&&same(current,r.oldPath)){current=r.document.path;title();}return {...r,baseURL:pathToFileURL(path.dirname(r.document.path)+path.sep).href};});
  on('move-document',async(id,projectId)=>{const r=await library.move(id,projectId);if(current&&same(current,r.oldPath)){current=r.document.path;title();}return {...r,baseURL:pathToFileURL(path.dirname(r.document.path)+path.sep).href};});
  on('trash-document',async id=>{
    const d=library.get(id);
    const answer=await dialog.showMessageBox(win,{type:'warning',title:'删除文稿',message:`删除“${d.name}”？`,detail:'文件将移到系统回收站，并从所有项目、置顶和归档列表中移除。可从系统回收站恢复文件。',buttons:['取消','移到回收站'],defaultId:0,cancelId:0});
    if(answer.response!==1)return false;
    await shell.trashItem(d.path);await library.remove(id);
    if(current&&same(current,d.path)){current=null;lastHash=null;dirty=false;title();await fs.rm(draftPath(),{force:true});}return true;
  });
  on('project-update',async(id,patch)=>library.projectUpdate(id,patch));
  on('remove-project',async id=>library.removeProject(id));
  on('search-library',async query=>library.search(query));
  on('reveal-document',async id=>shell.showItemInFolder(library.get(id).path));
  on('reveal-project',async id=>{const error=await shell.openPath(library.project(id).path);if(error)throw Error(error);});
  on('check-external',async()=>{if(!current)return null;const bytes=await fs.readFile(current).catch(e=>{if(e.code==='ENOENT')return null;throw e;});return {changed:bytes===null||hash(bytes)!==lastHash,missing:bytes===null};});
  on('window',name=>{if(name==='minimize')win.minimize();else if(name==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(name==='close')win.close();else throw Error('无效的窗口操作');});
  on('app-menu',(label)=>{const m=Menu.getApplicationMenu();const item=m?.items.find(i=>i.label===label);if(item?.submenu)item.submenu.popup({window:win});});
  on('folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(r.canceled)return null;root=await fs.realpath(r.filePaths[0]);return {root,files:await listFolder(root)};});
  async function listFolder(dir,depth=0){
    const entries=await fs.readdir(dir,{withFileTypes:true});let out=[];
    for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(e.name.startsWith('.')||e.name==='node_modules')continue;const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory()&&depth<3){out.push(...await listFolder(p,depth+1));}else if(e.isFile()&&/\.(md|markdown|mdown|txt)$/i.test(e.name)){allowed.add(p);out.push({path:p,name:path.relative(root,p)});}if(out.length>=1000)break;}
    return out.slice(0,1000);
  }
  on('image',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','gif','svg','webp','bmp','avif']}]});if(r.canceled)return null;return (await FilePreferences.prepareImage({sourcePath:r.filePaths[0],documentPath:current,settings:state})).src;});
  on('image-clipboard',async()=>{const image=clipboard.readImage();if(image.isEmpty())throw Error('剪贴板中没有图片');return (await FilePreferences.saveClipboardImage({png:image.toPNG(),documentPath:current,settings:state})).src;});
  on('external',async url=>{if(/^https?:\/\//i.test(url))await shell.openExternal(url);});
  on('export',async(type,html)=>{
    if(!['html','pdf','print'].includes(type)||typeof html!=='string')throw Error('无效的导出');
    let p=null;if(type!=='print'){const r=await dialog.showSaveDialog(win,{defaultPath:(current?path.basename(current,path.extname(current)):'文档')+'.'+type,filters:[{name:type.toUpperCase(),extensions:[type]}]});if(r.canceled)return null;p=r.filePath;}
    if(type==='html'){await atomic(p,html);return p;}
    const preview=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
    let exportDirectory,exportPage;
    try{
      // A local page can load the document's local images without disabling webSecurity.
      exportDirectory=await fs.mkdtemp(path.join(app.getPath('temp'),'cypora-export-'));
      exportPage=path.join(exportDirectory,'document.html');await fs.writeFile(exportPage,html,'utf8');
      await preview.loadFile(exportPage);
      await preview.webContents.executeJavaScript(`Promise.race([
        Promise.all([document.fonts.ready,...[...document.images].map(image=>image.decode().catch(()=>{throw Error('导出图片无法加载：'+image.getAttribute('src'))}))]).then(()=>true),
        new Promise((_,reject)=>setTimeout(()=>reject(Error('导出图片加载超时')),20000))
      ])`);
      if(type==='pdf'){const pdf=await preview.webContents.printToPDF(FilePreferences.pdfOptions(state));await fs.writeFile(p,pdf);}
      else await new Promise((resolve,reject)=>preview.webContents.print(FilePreferences.printOptions(state),(ok,reason)=>ok?resolve():reject(Error(reason))));
      return p||'已发送至打印机';
    }finally{
      preview.destroy();
      if(exportPage)await fs.unlink(exportPage).catch(()=>{});
      if(exportDirectory)await fs.rmdir(exportDirectory).catch(()=>{});
    }
  });
  on('close-ready',()=>{if(!testing&&(state.closeBehavior==='tray'||(state.closeBehavior!=='quit'&&planner.hasActive))){keepTray();win.hide();return;}closing=true;win.close();});
}
if(ownsInstance)app.whenReady().then(async()=>{
  if(process.platform==='win32'&&app.isPackaged&&!testing){
    const launcherOptions={target:process.execPath,cwd:path.dirname(process.execPath),args:'',description:'Cypora',icon:process.execPath,iconIndex:0,appUserModelId:windowsAppId};
    for(const launcher of [path.join(app.getPath('desktop'),'Cypora.lnk'),path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','Cypora.lnk')]){
      if(!shell.writeShortcutLink(launcher,'update',launcherOptions))console.warn('Could not refresh Cypora launcher:',launcher);
    }
  }
  await fs.mkdir(app.getPath('userData'),{recursive:true});const stored=testing?{}:await jsonRead(settingsPath(),{});state={...state,...stored,...Preferences.load(stored)};
  if(testing)await fs.rm(draftPath(),{force:true});
  for(const p of state.recent)allowed.add(path.resolve(p));
  library=new Library({state,persist,allowed,home:testing?path.join(__dirname,'verification','managed-documents'):state.documentHome||path.join(app.getPath('documents'),'Cypora 文稿')});
  await library.initialize();
  planner=new Planner({state:testing?{}:await jsonRead(path.join(app.getPath('userData'),'planner.json'),{}),library,persist:text=>atomic(path.join(app.getPath('userData'),'planner.json'),text),notify:deliverReminder});
  initialFile=process.argv.slice(app.isPackaged?1:2).find(x=>!x.startsWith('-')&&/\.(md|markdown|txt)$/i.test(x));
  if(initialFile){initialFile=path.resolve(initialFile);allowed.add(initialFile);}
  win=new BrowserWindow({width:1340,height:900,minWidth:860,minHeight:560,title:'Cypora',frame:false,backgroundColor:'#f4f3ee',show:!testing,icon:path.join(__dirname,'assets','cypora.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,offscreen:testing,backgroundThrottling:!testing}});
  if(process.platform==='win32'&&!testing)win.setAppDetails({appId:windowsAppId,appIconPath:app.isPackaged?process.execPath:path.join(__dirname,'assets','cypora.ico'),appIconIndex:0,relaunchCommand:'"'+process.execPath+'"'+(app.isPackaged?'':' "'+__dirname+'"'+(profileArg?' "'+profileArg+'"':'')),relaunchDisplayName:'Cypora'});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(e)=>e.preventDefault());
  if(state.rememberWindow&&state.windowBounds){const bounds=state.windowBounds;const {screen}=require('electron');if(screen.getAllDisplays().some(d=>bounds.x<d.workArea.x+d.workArea.width&&bounds.y<d.workArea.y+d.workArea.height&&bounds.x+bounds.width>d.workArea.x&&bounds.y+bounds.height>d.workArea.y))win.setBounds({x:bounds.x,y:bounds.y,width:Math.max(860,bounds.width),height:Math.max(560,bounds.height)});}
  let geometryTimer;const saveGeometry=()=>{if(testing||!state.rememberWindow||win.isMinimized())return;clearTimeout(geometryTimer);geometryTimer=setTimeout(()=>{state.windowBounds=win.getNormalBounds();state.windowMaximized=win.isMaximized();persist().catch(console.error);},350);};
  win.on('resize',saveGeometry);win.on('move',saveGeometry);if(state.rememberWindow&&state.windowMaximized&&!testing)win.maximize();
  win.on('close',e=>{if(!closing){e.preventDefault();action('close-window','button');}});
  register();menu();title();await win.loadFile('index.html');
  win.setMenuBarVisibility(false);
  applyWindowPreferences();nativeTheme.on('updated',()=>action('system-appearance'));
  win.on('focus',()=>action('refresh-library'));
  reminderTimer=setInterval(()=>planner.tick().catch(e=>console.error('Reminder:',e.message)),1000);
  if(!testing)setTimeout(()=>planner.tick().catch(e=>console.error('Reminder:',e.message)),3000);
  if(testing)require('./tools/self-test.cjs')({app,win,fs,path,atomic,hash,openFile,allowed,library,planner});
}).catch(e=>{console.error(e);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{clearInterval(reminderTimer);tray?.destroy();});
