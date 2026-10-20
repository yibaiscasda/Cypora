// Codex-style shell around the existing local Markdown editor.
const ICONS={
  chat:'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2z M7 9h10 M7 13h6',
  image:'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M10 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0',
  copy:'M8 8h12v12H8z M4 16V4h12',
  home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  clock:'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  archive:'M4 4h16v5H4z M6 9v11h12V9 M10 13h4',
  more:'M5 12h.01 M12 12h.01 M19 12h.01',
  // Rounded, symmetric Settings outline (Lucide, ISC); the former polygon was off-centre.
  settings:'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  compose:'M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7 M18 3l3 3-10 10-4 1 1-4z',
  'chevron-down':'m8 10 4 4 4-4',back:'m14 6-6 6 6 6 M8 12h12',forward:'m10 6 6 6-6 6 M4 12h12',
  sidebar:'M3 4h18v16H3z M9 4v16',minus:'M5 12h14',square:'M5 5h14v14H5z',close:'m6 6 12 12 M6 18 18 6',
  plus:'M12 5v14 M5 12h14',refresh:'M20 10a8 8 0 1 0 0 5 M20 4v6h-6',folder:'M3 6h7l2 3h9v11H3z',
  outline:'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',code:'m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  focus:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',pin:'m9 3 6 0-1 6 4 4H6l4-4z M12 13v8',
  rename:'M4 17v4h4L20 9l-4-4z M14 7l4 4',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  restore:'M4 10a8 8 0 1 1 1 8 M4 4v6h6',file:'M5 3h9l5 5v13H5z M14 3v6h5',move:'M3 7h7l2 3h9v10H3z M13 13l3 3-3 3 M9 16h7',
  check:'m5 12 4 4L19 6',external:'M14 3h7v7 M21 3 11 13 M10 4H4v16h16v-6'
};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const capybara={capybara:'brand',settings:'settings',template:'template',archive:'archive'}[name];svg.setAttribute('class','icon'+(capybara?' capybara-icon':''));svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');if(capybara){const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href',new URL('assets/capybara-ui.svg',location.href).href+'#'+capybara);svg.append(use);}else{const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',ICONS[name]||ICONS.file);svg.append(p);}return svg;}
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.replaceChildren(icon(el.dataset.icon)));}
hydrateIcons();
let libraryData={documents:[],projects:[]},view='home',selectedProject=null,searchEpoch=0,searchTimer,autoTimer,autoPromise=null,autoBlocked=false,refreshing=false;
let historyPaths=[],historyIndex=-1,navigating=false;
const oldRun=run;
function currentDocument(){return libraryData.documents.find(d=>d.path===filePath);}
function projectFor(doc){return libraryData.projects.find(p=>p.id===doc?.projectId);}
function visibleDocuments(){return libraryData.documents.filter(d=>!d.closed);}
function documentOrder(a,b){return settings.sort==='name'?a.name.localeCompare(b.name,'zh-CN'):(a.order||0)-(b.order||0)||a.name.localeCompare(b.name,'zh-CN');}
function reorderTarget(row,kind,id){
  row.draggable=true;row.addEventListener('dragstart',e=>{e.stopPropagation();e.dataTransfer.setData('application/x-cypora-'+(kind==='projects'?'project':'document'),id);e.dataTransfer.setData('application/x-cypora-order',kind);e.dataTransfer.effectAllowed='move';});
  row.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-cypora-'+(kind==='projects'?'project':'document'))){e.preventDefault();e.stopPropagation();row.classList.toggle('drop-after',e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2);row.classList.add('drop-position');}});
  row.addEventListener('dragleave',()=>row.classList.remove('drop-position','drop-after'));
  row.addEventListener('dragend',()=>document.querySelectorAll('.drop-position').forEach(n=>n.classList.remove('drop-position','drop-after')));
  row.addEventListener('drop',e=>{const source=e.dataTransfer.getData('application/x-cypora-'+(kind==='projects'?'project':'document'));if(!source)return;e.preventDefault();e.stopPropagation();const after=row.classList.contains('drop-after');row.classList.remove('drop-position','drop-after');if(e.dataTransfer.getData('application/x-cypora-order')!==kind)return;api('library-reorder',kind,source,id,after).then(()=>{if(kind!=='projects'){settings.sort='manual';$('#pref-sort').value='manual';return api('settings',{sort:'manual'});}}).then(()=>refreshLibrary()).catch(fail);});
}
function closeMenu(){$('#context-menu').hidden=true;}
function showMenu(items,anchor){
  const menu=$('#context-menu');menu.replaceChildren();
  for(const item of items){
    if(item.separator){menu.append(document.createElement('hr'));continue;}
    if(item.heading){const el=document.createElement('div');el.className='menu-heading';el.textContent=item.heading;menu.append(el);continue;}
    const b=document.createElement('button');b.setAttribute('role','menuitem');if(item.danger)b.className='danger';b.append(icon(item.icon||'file'),document.createTextNode(item.label));b.onclick=()=>{closeMenu();Promise.resolve().then(item.action).catch(fail);};menu.append(b);
  }
  menu.hidden=false;const box=anchor?.getBoundingClientRect?.();let x=box?box.right-185:anchor.x,y=box?box.bottom+4:anchor.y;
  menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';menu.querySelector('button')?.focus();
}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#context-menu'))closeMenu();});
function inputDialog({title,value='',description='',project=false,onlyProject=false,submit='保存'}){
  return new Promise(resolve=>{
    const dialog=$('#input-dialog'),field=$('#input-value');$('#input-title').textContent=title;$('#input-description').textContent=description;field.value=value;field.required=!onlyProject;field.hidden=onlyProject;$('#input-label').hidden=onlyProject;
    $('#project-select-label').hidden=!project;$('#project-select').hidden=!project;$('#project-select').replaceChildren();
    if(project){if(!onlyProject){const option=document.createElement('option');option.value='';option.textContent='不在项目中 · Cypora 文稿';$('#project-select').append(option);}for(const p of libraryData.projects){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$('#project-select').append(option);}if(selectedProject)$('#project-select').value=selectedProject;}
    $('#input-submit').textContent=submit;let settled=false;
    const done=result=>{if(settled)return;settled=true;dialog.close();resolve(result);};
    $('#input-form').onsubmit=e=>{e.preventDefault();done({value:field.value,projectId:$('#project-select').value||null});};$('#input-cancel').onclick=()=>done(null);dialog.oncancel=e=>{e.preventDefault();done(null);};dialog.showModal();(onlyProject?$('#project-select'):field).focus();if(!onlyProject)field.select();
  });
}
async function refreshLibrary(refresh=false){libraryData=await api('library',refresh);renderLibrary();return libraryData;}
function selectView(next){view=next;selectedProject=null;document.querySelectorAll('.rail-button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));renderLibrary();}
function rowFor(d,orderKind='documents'){
  const row=document.createElement('div');row.className='document-row';row.dataset.id=d.id;row.classList.toggle('selected',d.path===filePath);row.title=d.path;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',d.name+(d.archived?'，已归档':''));
  const label=document.createElement('span');label.className='row-label';label.textContent=d.name.replace(/\.(md|markdown|mdown)$/i,'');row.append(label);
  if(d.missing){const tag=document.createElement('span');tag.className='row-missing';tag.textContent='失联';row.append(tag);}
  const more=document.createElement('button');more.className='row-menu';more.title='文稿操作';more.setAttribute('aria-label',d.name+'的操作');more.append(icon('more'));more.onclick=e=>{e.stopPropagation();documentMenu(d,more);};row.append(more);
  row.onclick=()=>run('open',d.path);row.onkeydown=e=>{if(e.target!==row)return;if(e.key==='Enter'){e.preventDefault();run('open',d.path);}if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();documentMenu(d,row);}};
  row.oncontextmenu=e=>{e.preventDefault();documentMenu(d,{x:e.clientX,y:e.clientY});};reorderTarget(row,orderKind,d.id);return row;
}
function appendEmpty(container,text,action){const p=document.createElement('div');p.className='sidebar-empty';p.textContent=text;if(action){p.append(document.createElement('br'));const b=document.createElement('button');b.textContent=action.label;b.onclick=action.action;p.append(b);}container.append(p);}
function renderLibrary(){
  const docs=visibleDocuments(),normal=docs.filter(d=>!d.archived),pinned=normal.filter(d=>d.pinned).sort((a,b)=>(a.pinOrder||0)-(b.pinOrder||0));
  $('#pinned-list').replaceChildren(...pinned.map(d=>rowFor(d,'pinned')));$('#pinned-section').hidden=view!=='home'||!pinned.length;
  $('#projects-section').hidden=view!=='home';$('#project-list').replaceChildren();
  const colors=['#d58a54','#9b7bdb','#6791ac','#75a18a','#bc7592'];
  [...libraryData.projects].sort((a,b)=>(a.order||0)-(b.order||0)).forEach((p,i)=>{
    const row=document.createElement('div');row.className='project-row';row.dataset.project=p.id;row.title=p.path;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-expanded',String(p.expanded!==false));
    const marker=document.createElement('span');marker.className='project-icon';marker.style.color=colors[i%colors.length];marker.append(icon('folder'));
    const name=document.createElement('span');name.className='row-label';name.textContent=p.name;
    const chevron=document.createElement('span');chevron.className='project-chevron'+(p.expanded===false?' collapsed':'');chevron.append(icon('chevron-down'));
    const more=document.createElement('button');more.className='row-menu';more.setAttribute('aria-label',p.name+'的项目操作');more.append(icon('more'));more.onclick=e=>{e.stopPropagation();projectMenu(p,more);};row.append(marker,name,chevron,more);
    const toggle=async()=>{selectedProject=p.id;await api('project-update',p.id,{expanded:p.expanded===false});await refreshLibrary();};row.onclick=()=>toggle().catch(fail);row.onkeydown=e=>{if(e.target===row&&e.key==='Enter')toggle().catch(fail);};row.oncontextmenu=e=>{e.preventDefault();projectMenu(p,{x:e.clientX,y:e.clientY});};row.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-cypora-document')){e.preventDefault();row.classList.add('drag-target');}};row.ondragleave=()=>row.classList.remove('drag-target');row.ondrop=e=>{e.preventDefault();row.classList.remove('drag-target');const d=libraryData.documents.find(d=>d.id===e.dataTransfer.getData('application/x-cypora-document'));if(d&&d.projectId!==p.id)editDoc(d,'move',p.id).catch(fail);};$('#project-list').append(row);
    row.draggable=true;row.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-cypora-project',p.id);e.dataTransfer.setData('application/x-cypora-order','projects');});row.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-cypora-project')){e.preventDefault();row.classList.add('drop-position');row.classList.toggle('drop-after',e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2);}});row.addEventListener('dragleave',()=>row.classList.remove('drop-position','drop-after'));row.addEventListener('drop',e=>{const source=e.dataTransfer.getData('application/x-cypora-project');if(source){e.preventDefault();const after=row.classList.contains('drop-after');row.classList.remove('drop-position','drop-after');api('library-reorder','projects',source,p.id,after).then(()=>refreshLibrary()).catch(fail);}});
    if(p.expanded!==false){const children=document.createElement('div');children.className='project-children';const files=normal.filter(d=>d.projectId===p.id).sort(documentOrder);children.append(...files.map(d=>rowFor(d)));if(!files.length){const message=document.createElement('div');message.className='project-empty';message.textContent=p.error||'暂无文稿';children.append(message);}if(p.truncated){const note=document.createElement('div');note.className='project-empty';note.textContent='仅显示前 1500 个文件';children.append(note);}$('#project-list').append(children);}
  });
  if(!libraryData.projects.length)appendEmpty($('#project-list'),'按文件夹整理文稿',{label:'添加项目',action:()=>run('folder')});
  $('#view-label').hidden=view==='home';$('#view-label').textContent=view==='archive'?'归档文稿':'文稿';$('#documents-label').textContent=view==='archive'?'已归档':'文稿';
  const listed=(view==='archive'?docs.filter(d=>d.archived):normal.filter(d=>view==='recent'||!d.pinned)).sort(documentOrder);
  $('#document-list').replaceChildren(...listed.map(d=>rowFor(d)));if(!listed.length)appendEmpty($('#document-list'),view==='archive'?'没有归档文稿。归档会隐藏列表项，保留原文件。':'打开或新建一份 Markdown 文稿。');
  renderHeader();
}
function renderHeader(){
  const d=currentDocument(),p=projectFor(d);$('#project-breadcrumb').textContent=p?p.name+' /':'';$('#file-location').textContent=filePath||'';$('#file-location').title=filePath||'';$('#dirty-dot').hidden=raw===saved;
  if(filePath)$('#docname').textContent=filePath.split(/[\\/]/).pop().replace(/\.(md|markdown|mdown)$/i,'');
  $('#history-back').disabled=historyIndex<=0;$('#history-forward').disabled=historyIndex>=historyPaths.length-1;
}
async function emptyDocument(){await api('new-file');await setDocument('');document.body.classList.add('no-document');$('#empty-state').hidden=false;$('#docname').textContent='文稿';}
async function editDoc(d,operation,value){
  const active=d.path===filePath;
  if(active&&!await guard())return;
  if(operation==='rename'||operation==='move'){
    const result=await api(operation==='rename'?'rename-document':'move-document',d.id,value);
    historyPaths=historyPaths.map(p=>p===result.oldPath?result.document.path:p);
    if(active){filePath=result.document.path;baseURL=result.baseURL;document.querySelector('base').href=baseURL;$('#docname').title=filePath;}
  }else if(operation==='trash'){
    if(!await api('trash-document',d.id))return;
    historyPaths=historyPaths.filter(p=>p!==d.path);historyIndex=Math.min(historyIndex,historyPaths.length-1);if(active)await emptyDocument();
  }else{
    await api('document-update',d.id,value);
    if(active&&(value.archived||value.closed))await emptyDocument();
  }
  await refreshLibrary();
}
function documentMenu(d,anchor){
  if(!d){showMenu([{label:'新建文稿',icon:'compose',action:()=>run('create-document')},{label:'打开 Markdown…',icon:'folder',action:()=>run('open')}],anchor);return;}
  showMenu([
    {label:d.pinned?'取消置顶':'置顶',icon:'pin',action:()=>editDoc(d,'update',{pinned:!d.pinned})},
    {label:'重命名…',icon:'rename',action:async()=>{const r=await inputDialog({title:'重命名文稿',value:d.name,description:'同时修改磁盘上的文件名。'});if(r)await editDoc(d,'rename',r.value);}},
    {label:'移入项目…',icon:'move',action:async()=>{if(!libraryData.projects.length){toast('请先添加一个项目文件夹');return;}const r=await inputDialog({title:'移入项目',project:true,onlyProject:true,description:'文件将移动到所选项目文件夹；同名文件不会被覆盖。',submit:'移动'});if(r)await editDoc(d,'move',r.projectId);}},
    {label:'在资源管理器中显示',icon:'external',action:()=>api('reveal-document',d.id)},
    {label:'复制文件路径',icon:'copy',action:async()=>{await api('copy-document-path',d.id);toast('已复制文件路径');}},
    {label:'创建副本',icon:'copy',action:async()=>{if(d.path===filePath&&!await guard())return;const copy=await api('duplicate-document',d.id);await refreshLibrary();toast('已创建 '+copy.name+'；相对图片引用保持原位置');}},
    {label:'属性',icon:'file',action:()=>api('document-properties',d.id)},
    {separator:true},{label:d.archived?'取消归档':'归档',icon:d.archived?'restore':'archive',action:()=>editDoc(d,'update',{archived:!d.archived})},
    {label:'关闭列表项',icon:'close',action:()=>editDoc(d,'update',{closed:true})},
    {separator:true},{label:'删除文稿…',icon:'trash',danger:true,action:()=>editDoc(d,'trash')}
  ],anchor);
}
function projectMenu(p,anchor){
  showMenu([
    {label:'新建文稿…',icon:'compose',action:()=>{selectedProject=p.id;return run('create-document');}},
    {label:'重命名项目…',icon:'rename',action:async()=>{const r=await inputDialog({title:'重命名项目',value:p.name,description:'修改侧栏显示名称，文件夹路径保持原样。'});if(r){await api('project-update',p.id,{name:r.value});await refreshLibrary();}}},
    {label:'打开项目文件夹',icon:'folder',action:()=>api('reveal-project',p.id)},
    {label:'刷新文件',icon:'refresh',action:()=>refreshLibrary(true)},
    {separator:true},{label:'移除项目',icon:'close',action:async()=>{await api('remove-project',p.id);if(selectedProject===p.id)selectedProject=null;await refreshLibrary();toast('项目已移除，文件保留在磁盘中');}}
  ],anchor);
}
async function globalSearch(){
  $('#search-results').replaceChildren();appendEmpty($('#search-results'),'输入名称或关键词，搜索你的文稿。');$('#search-dialog').showModal();$('#library-query').value='';$('#library-query').focus();
}
async function searchNow(){
  const epoch=++searchEpoch,query=$('#library-query').value;if(!query.trim()){ $('#search-results').replaceChildren();appendEmpty($('#search-results'),'输入名称或关键词，搜索你的文稿。');return;}
  const results=await api('search-library',query);if(epoch!==searchEpoch)return;$('#search-results').replaceChildren();
  for(const d of results){const b=document.createElement('button'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=d.name+(d.archived?' · 已归档':'');small.textContent=d.snippet||d.path;b.append(strong,small);b.onclick=()=>{$('#search-dialog').close();run('open',d.path);};$('#search-results').append(b);}if(!results.length)appendEmpty($('#search-results'),'没有找到匹配的文稿。');
}
function settingsTab(tab){document.querySelectorAll('[data-settings-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.settingsTab===tab));document.querySelectorAll('[data-settings-pane]').forEach(p=>p.hidden=p.dataset.settingsPane!==tab);$('#settings-no-results').hidden=true;$('#settings-query').value='';}
function applyAppearance(){
  const root=document.documentElement.style;
  root.setProperty('--ui-font',settings.uiFont==='yahei'?"'Microsoft YaHei UI','Segoe UI',sans-serif":"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif");
  root.setProperty('--ui-size',(settings.uiSize||14)+'px');root.setProperty('--content-size',(settings.contentSize||16)+'px');root.setProperty('--code-size',(settings.codeSize||13)+'px');root.setProperty('--code-font',`'${['Consolas','Cascadia Code','Courier New'].includes(settings.codeFont)?settings.codeFont:'Consolas'}',monospace`);
  root.setProperty('--content-font',settings.contentFont==='serif'?"Georgia,'Noto Serif SC','SimSun',serif":'var(--ui-font)');
}
function showPreferences(){document.querySelectorAll('[data-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.theme===settings.theme));$('#pref-autosave').checked=settings.autoSave!==false;$('#pref-typewriter').checked=!!settings.typewriter;$('#pref-outline').checked=!$('#outline-panel').hidden;
  for(const [id,key,fallback]of [['pref-ui-font','uiFont','system'],['pref-ui-size','uiSize',14],['pref-content-font','contentFont','system'],['pref-content-size','contentSize',16],['pref-code-font','codeFont','Consolas'],['pref-code-size','codeSize',13],['pref-sort','sort','recent'],['pref-mode','mode','ir']])if($('#'+id))$('#'+id).value=settings[key]||fallback;
  settingsTab('general');$('#preferences').show();
}
function toggleOutline(value){const visible=value===undefined?$('#outline-panel').hidden:value;$('#outline-panel').hidden=!visible;settings.outline=visible;api('settings',{outline:visible}).catch(fail);}
async function navigateHistory(delta){const next=historyIndex+delta;if(next<0||next>=historyPaths.length)return;navigating=true;try{await run('open',historyPaths[next]);if(filePath===historyPaths[next])historyIndex=next;}finally{navigating=false;renderHeader();}}
run=async function(name,arg){
  try{
    closeMenu();
    if(name==='create-document'){
      if(!ready||!await guard())return;
      const r=await inputDialog({title:'新建文稿',value:'未命名.md',project:true,submit:'创建'});if(!r)return;
      const d=await api('create-document',r.value,r.projectId);await oldRun('open',d.path);await refreshLibrary();
    }else if(name==='folder'){
      const r=await api('add-project');if(r){libraryData=r.library;view='home';selectedProject=r.project.id;selectView('home');selectedProject=r.project.id;renderLibrary();document.body.classList.remove('no-sidebar');}
    }else if(name==='search-library')await globalSearch();
    else if(name==='preferences')showPreferences();
    else if(name==='refresh-library'){
      if(refreshing||!ready)return;refreshing=true;try{await refreshLibrary(true);if(filePath){const result=await api('check-external');if(result?.changed){if(raw===saved&&!result.missing){await oldRun('open',filePath);}else conflict();}}}finally{refreshing=false;}
    }else if(name==='reload-document'){
      if(filePath){const p=filePath;if(!await guard())return;await oldRun('open',p);}
    }else{await oldRun(name,arg);if(name==='open'||name==='save'||name==='save-as')await refreshLibrary();}
    renderHeader();
  }catch(error){fail(error);}
};
function conflict(){autoBlocked=true;$('#external-banner').hidden=false;$('#save-status').textContent='外部更改 · 自动保存已暂停';}
async function flushAutosave(){
  clearTimeout(autoTimer);if(autoPromise)await autoPromise;
  if(settings.autoSave!==false&&filePath&&raw!==saved&&!autoBlocked){autoPromise=save(false,true);try{await autoPromise;}finally{autoPromise=null;}}
}
window.Workspace={
  initialize:async boot=>{libraryData=boot.library;applyAppearance();renderLibrary();document.body.classList.add('no-document');$('#empty-state').hidden=false;if(settings.sidebarWidth)document.documentElement.style.setProperty('--sidebar-width',Math.max(220,Math.min(420,settings.sidebarWidth))+'px');toggleOutline(!!settings.outline);await window.Organizer?.initialize();await window.PreferencesUI?.initialize();},
  onDocument:p=>{autoBlocked=false;$('#external-banner').hidden=true;document.body.classList.remove('no-document');$('#empty-state').hidden=true;if(p){if(!navigating&&historyPaths[historyIndex]!==p){historyPaths=historyPaths.slice(0,historyIndex+1);historyPaths.push(p);historyIndex=historyPaths.length-1;}selectedProject=projectFor(libraryData.documents.find(d=>d.path===p))?.id||null;}renderLibrary();},
  onChange:()=>{renderHeader();clearTimeout(autoTimer);if(filePath&&settings.autoSave!==false&&!autoBlocked)autoTimer=setTimeout(()=>flushAutosave().catch(fail),900);},
  onSaved:()=>{autoBlocked=false;$('#external-banner').hidden=true;refreshLibrary().catch(fail);},
  flushAutosave,conflict,get library(){return libraryData;},refreshLibrary,selectView,editDoc,inputDialog
};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>run(b.dataset.action,b.dataset.arg));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>selectView(b.dataset.view));
document.querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>api('window',b.dataset.window).catch(fail));
document.querySelectorAll('[data-menu]').forEach(b=>b.onclick=()=>api('app-menu',b.dataset.menu).catch(fail));
$('#workspace-menu').onclick=e=>showMenu([{label:'打开 Markdown…',icon:'folder',action:()=>run('open')},{label:'添加项目…',icon:'plus',action:()=>run('folder')},{label:'归档文稿',icon:'archive',action:()=>selectView('archive')},{separator:true},{label:'偏好设置',icon:'settings',action:()=>run('preferences')}],e.currentTarget);
$('#rail-more').onclick=e=>showMenu([{label:'搜索文稿',icon:'search',action:()=>run('search-library')},{label:'使用指南',icon:'file',action:()=>run('help')},{label:'添加项目…',icon:'folder',action:()=>run('folder')}],e.currentTarget);
$('#add-project').onclick=()=>run('folder');$('#refresh-list').onclick=()=>run('refresh-library');$('#document-menu').onclick=e=>documentMenu(currentDocument(),e.currentTarget);$('#file-menu').onclick=e=>documentMenu(currentDocument(),e.currentTarget);
$('#outline-toggle').onclick=()=>toggleOutline();$('#outline-close').onclick=()=>toggleOutline(false);$('#source-toggle').onclick=()=>run('mode',mode==='sv'?'ir':'sv');$('#reload-document').onclick=()=>run('reload-document');
$('#history-back').onclick=()=>navigateHistory(-1);$('#history-forward').onclick=()=>navigateHistory(1);
$('#search-close').onclick=()=>$('#search-dialog').close();$('#library-query').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchNow().catch(fail),180);};$('#library-query').onkeydown=e=>{if(e.key==='Enter')$('#search-results button')?.click();if(e.key==='ArrowDown')$('#search-results button')?.focus();};
$('#preferences-close').onclick=()=>$('#preferences').close();document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{setTheme(b.dataset.theme);showPreferenceSelection();});
function showPreferenceSelection(){document.querySelectorAll('[data-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.theme===settings.theme));}
$('#pref-autosave').onchange=async e=>{settings.autoSave=e.target.checked;await api('settings',{autoSave:settings.autoSave});if(settings.autoSave)await flushAutosave();};$('#pref-typewriter').onchange=()=>run('typewriter');$('#pref-outline').onchange=e=>toggleOutline(e.target.checked);
document.querySelectorAll('[data-settings-tab]').forEach(b=>b.onclick=()=>settingsTab(b.dataset.settingsTab));
$('#settings-query').oninput=e=>{const query=e.target.value.trim().toLowerCase();let found=false;document.querySelectorAll('[data-settings-pane]').forEach(p=>{const match=!query||p.textContent.toLowerCase().includes(query);p.hidden=!match;found||=match;});$('#settings-no-results').hidden=found;};
for(const [id,key,min,max]of [['pref-ui-size','uiSize',12,20],['pref-content-size','contentSize',12,28],['pref-code-size','codeSize',10,24]])$('#'+id).onchange=async e=>{const value=Math.max(min,Math.min(max,Number(e.target.value)||min));e.target.value=value;settings[key]=value;applyAppearance();await api('settings',{[key]:value});};
for(const [id,key]of [['pref-ui-font','uiFont'],['pref-content-font','contentFont'],['pref-code-font','codeFont'],['pref-sort','sort']])$('#'+id).onchange=async e=>{settings[key]=e.target.value;applyAppearance();await api('settings',{[key]:settings[key]});renderLibrary();};
$('#pref-mode').onchange=e=>run('mode',e.target.value);
$('#settings-add-project').onclick=async()=>{$('#preferences').close();await run('folder');};$('#settings-archives').onclick=()=>{$('#preferences').close();selectView('archive');};$('#settings-backups').onclick=()=>api('show-backups').catch(fail);$('#settings-focus').onclick=()=>{$('#preferences').close();run('focus');};
$('#reset-appearance').onclick=async()=>{Object.assign(settings,{theme:'light',uiFont:'system',uiSize:14,contentFont:'system',contentSize:16,codeFont:'Consolas',codeSize:13});setTheme('light');applyAppearance();await api('settings',{uiFont:'system',uiSize:14,contentFont:'system',contentSize:16,codeFont:'Consolas',codeSize:13});$('#preferences').close();showPreferences();settingsTab('appearance');};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();if($('#preferences').open)$('#preferences').close();}});
const resizer=$('#sidebar-resizer');resizer.onpointerdown=e=>{resizer.setPointerCapture(e.pointerId);const start=e.clientX,width=$('#library-sidebar').offsetWidth;resizer.onpointermove=event=>{const next=Math.max(220,Math.min(420,width+event.clientX-start));document.documentElement.style.setProperty('--sidebar-width',next+'px');settings.sidebarWidth=next;};resizer.onpointerup=()=>{resizer.onpointermove=null;api('settings',{sidebarWidth:settings.sidebarWidth}).catch(fail);};};resizer.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();settings.sidebarWidth=Math.max(220,Math.min(420,$('#library-sidebar').offsetWidth+(e.key==='ArrowRight'?10:-10)));document.documentElement.style.setProperty('--sidebar-width',settings.sidebarWidth+'px');api('settings',{sidebarWidth:settings.sidebarWidth}).catch(fail);}};
