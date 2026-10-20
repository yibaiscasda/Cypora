const $=s=>document.querySelector(s);
const api=(name,...args)=>window.cypora.call(name,...args);
const cdn=new URL('node_modules/vditor',location.href).href.replace(/\/$/,'');
const themePath=cdn+'/dist/css/content-theme';
const math={engine:'MathJax',inlineDigit:true};
let editor, raw='', saved='', filePath=null, baseURL='', loading=false, draftTimer, uiTimer, toastTimer, saving=false, fileBOM=false;
let settings={theme:'light',mode:'ir'}, mode='ir', ready=false, lastSearchIndex=-1, folderFiles=[], generation=0;
let draftQueue=Promise.resolve();
const WELCOME='# Cypora\n\n让文字回到写作本身。\n\n## 从这里开始\n\n这是一份可编辑的欢迎文档。直接开始输入，Markdown 标记会在编辑后呈现为排版。\n\n- **即时渲染**：编辑当前段落时显示 Markdown 标记。\n- **所见即所得**：直接编辑排版后的文档。\n- **源码 / 预览**：在纯文本与预览之间对照。\n\n## 你的写作工具\n\n| 操作 | 快捷键 |\n| --- | --- |\n| 打开 / 保存 | Ctrl+O / Ctrl+S |\n| 查找替换 | Ctrl+F |\n| 源码模式 | Ctrl+/ |\n| 专注 / 打字机 | F8 / F9 |\n\n> 文件、草稿与设置保存在本机。无需账户。\n\n## 公式与代码\n\n行内公式：$E = mc^{2}$。独立公式保留原始 LaTeX，并连续编号：\n\n$$\n\\int_{0}^{\\infty} e^{-x^{2}}\\,\\mathrm{d}x = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n```javascript\nconst thought = "写下来，就有了开始。";\nconsole.log(thought);\n```\n\n- [x] 打开 Cypora\n- [ ] 写下第一段文字\n';
function toast(t){$('#toast').textContent=t;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function fail(e){toast(e.message||String(e));console.error(e);}
function activeSurface(){return editor?.vditor?.[mode]?.element;}
function changed(value){
  if(loading||!ready)return;raw=fileBOM&&!value.startsWith('\ufeff')?'\ufeff'+value:value;api('dirty',raw!==saved).catch(fail);$('#save-status').textContent=raw===saved?'已保存':'未保存 · 草稿保护中';
  clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftQueue=draftQueue.then(()=>api('draft',raw)).catch(fail);},650);
  updateUI();
  window.Workspace?.onChange();
}
function numberMath(container){let n=0;container.querySelectorAll('div.language-math').forEach(el=>{
  if(el.closest('.vditor-ir__marker--pre,.vditor-wysiwyg__pre'))return;
  n++;const tex=el.getAttribute('data-math')||el.textContent;
  if(settings.equationNumbering==='none'||/\\tag\*?\s*\{/.test(tex)){el.removeAttribute('data-equation-number');}else if(el.dataset.equationNumber!==String(n)){el.dataset.equationNumber=String(n);}
});}
function updateUI(){
  clearTimeout(uiTimer);uiTimer=setTimeout(()=>{
    const chars=(raw.match(/[\u3400-\u9fff]/g)||[]).length;
    const words=(raw.replace(/[\u3400-\u9fff]/g,' ').match(/[\p{L}\p{N}]+/gu)||[]).length;
    $('#counter').textContent=`${chars+words} 字 · ${raw.split('\n').length} 行`;
    window.ReadingPreferences?.refresh();
    window.EditorTools?.renderOutline();
    numberMath($('#editor'));
    window.CodeBlocks?.refresh();
  },100);
}
async function mount(value,newMode=mode){
  const thisGeneration=++generation;
  window.EditorPreferences?.configure({getSettings:()=>settings,getEditor:()=>editor,isReadOnly:()=>document.body.dataset.readonly==='true',isConversation:()=>!!window.Conversations?.active});
  await window.EditorPreferences?.prepare(cdn);
  loading=true;ready=false;mode=newMode;const old=editor;if(old)old.destroy();$('#editor').replaceChildren();
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('编辑器初始化超时')),20000);
    editor=new Vditor('editor',{
      ...window.EditorPreferences?.vditorOptions(settings),
      cdn,mode,value:value.replace(/^\ufeff/,''),lang:'zh_CN',height:'100%',width:'100%',placeholder:'在这里开始写作…',
      cache:{enable:false},theme:settings.theme==='dark'?'dark':'classic',typewriterMode:!!settings.typewriter,customWysiwygToolbar:()=>{},
      toolbar:['headings','bold','italic','strike','|','list','ordered-list','check','quote','|','code','inline-code','table','link','line','indent','outdent','insert-before','insert-after','|','undo','redo'],
      toolbarConfig:{pin:true},outline:{enable:false},resize:{enable:false},counter:{enable:false},
      preview:{delay:150,mode:'both',math,theme:{current:(window.PreferencesUI?.resolvedMode||settings.theme)==='dark'?'dark':'light',path:themePath},hljs:{enable:true,lineNumber:!!settings.codeLineNumbers,style:settings.themes?.[(window.PreferencesUI?.resolvedMode||settings.theme)==='dark'?'dark':'light']?.codeTheme||'github'},markdown:{toc:true,mark:settings.markdownHighlight!==false,footnotes:settings.markdownFootnotes!==false,autoSpace:!!settings.autoSpace,gfmAutoLink:settings.autoLinks!==false,...window.EditorPreferences?.previewMarkdown(settings)},actions:[]},
      link:{isOpen:false,click:el=>{const url=el.getAttribute('href');if(/^https?:\/\//i.test(url))api('external',url).catch(fail);}},
      input:value=>{if(thisGeneration===generation)changed(value);},
      after:()=>{clearTimeout(timeout);ready=true;loading=false;$('#mode').value=mode;$('#mode-status').textContent={ir:'即时渲染',wysiwyg:'所见即所得',sv:'源码 / 预览'}[mode];updateUI();resolve();}
    });
  });
  editor.vditor.options.typewriterMode=!!settings.typewriter;
  editor.vditor.options.preview.hljs.lineNumber=!!settings.codeLineNumbers;
  window.PreferencesUI?.paint();
  window.EditorTools?.apply();
  window.CodeBlocks?.apply();
  window.EditorPreferences?.apply();
}
async function setDocument(text,p=null,url=''){
  window.Conversations?.close();
  $('#find-bar').hidden=true;
  clearTimeout(draftTimer);await draftQueue;window.EditorTools?.reset();raw=text;saved=text;fileBOM=text.startsWith('\ufeff');filePath=p;baseURL=url;
  let base=document.querySelector('base');if(!base){base=document.createElement('base');document.head.append(base);}base.href=url||new URL('./',location.href).href;
  await mount(text);$('#docname').textContent=p?p.split(/[\\/]/).pop():'未命名';$('#docname').title=p||'未命名';$('#save-status').textContent=p?'已打开':'准备就绪';await api('dirty',false);
  window.Workspace?.onDocument(p);
  try{
    const conversation=window.CyporaConversation?.fromMarkdown(text);
    if(conversation){window.Conversations?.open(conversation);if(!p){$('#docname').textContent=conversation.title;$('#docname').title=conversation.title;}}
  }catch(error){toast('已保留 Markdown 原文：'+error.message);}
}
async function guard(){await window.Workspace?.flushAutosave();if(raw===saved)return true;const answer=await api('unsaved');if(answer==='cancel')return false;if(answer==='save')return save(false);clearTimeout(draftTimer);await draftQueue;await api('clear-draft');return true;}
async function save(as=false,quiet=false){
  if(saving)return false;saving=true;
  let text=raw;if(settings.lineEnding==='lf')text=text.replace(/\r\n?/g,'\n');if(settings.lineEnding==='crlf')text=text.replace(/\r\n?|\n/g,'\r\n');if(settings.finalNewline&&text&&!/[\r\n]$/.test(text))text+=settings.lineEnding==='crlf'?'\r\n':'\n';if(text!==raw){editor.setValue(text);changed(text);}
  try{clearTimeout(draftTimer);await draftQueue;const r=await api('save-file',text,as,quiet,window.Conversations?.document?.title||'');if(!r)return false;if(r.conflict){window.Workspace?.conflict();return false;}saved=text;filePath=r.path;baseURL=r.baseURL;let base=document.querySelector('base');if(base)base.href=baseURL;$('#docname').textContent=filePath.split(/[\\/]/).pop();$('#docname').title=filePath;await api('dirty',raw!==saved);$('#save-status').textContent=raw===saved?'已保存':'未保存';window.Workspace?.onSaved();if(!quiet)toast('已保存到 '+filePath);return true;}finally{saving=false;}
}
function setTheme(t){settings.theme=t;document.body.dataset.theme=t;if(editor)editor.setTheme(t==='dark'?'dark':'classic',t==='dark'?'dark':'light',t==='dark'?'github-dark':'github',themePath);api('settings',{theme:t}).catch(fail);}
function recentList(recent){$('#recent').replaceChildren();recent.forEach(p=>{const b=document.createElement('button');b.textContent=p.split(/[\\/]/).pop();b.title=p;b.onclick=()=>run('open',p);$('#recent').append(b);});}
async function renderExport(){
  const container=document.createElement('div');container.className='vditor-reset';container.style.cssText='position:fixed;left:-20000px;width:800px';document.body.append(container);
  try{
    await Vditor.preview(container,raw.replace(/^\ufeff/,''),{cdn,mode:'light',math,theme:{current:'light',path:themePath},hljs:{enable:true,style:'github'},markdown:{toc:true,mark:settings.markdownHighlight!==false,footnotes:settings.markdownFootnotes!==false,...window.EditorPreferences?.previewMarkdown(settings)},after:()=>{}});
    await window.MathJax.startup.promise;
    // Render only formula nodes still pending; Vditor may already have scheduled them.
    for(let i=0;i<120;i++){if(![...container.querySelectorAll('.language-math')].some(el=>!el.querySelector('svg')&&!el.classList.contains('vditor-reset--error')))break;await new Promise(r=>setTimeout(r,100));}
    if([...container.querySelectorAll('.language-math')].some(el=>!el.querySelector('svg')))throw Error('公式尚未渲染完成，请检查 LaTeX 后重试');
    numberMath(container);
    container.querySelectorAll('script,iframe,object,embed').forEach(el=>el.remove());
    container.querySelectorAll('*').forEach(el=>{for(const a of [...el.attributes]){if(/^on/i.test(a.name)||(['href','src'].includes(a.name)&&/^javascript:/i.test(a.value)))el.removeAttribute(a.name);}});
    const html=container.innerHTML;
    const css=`body{margin:0;color:#333;background:white;font:16px/1.8 'Segoe UI','Microsoft YaHei',sans-serif}.vditor-reset{max-width:820px;padding:40px 30px;margin:auto;overflow-wrap:anywhere}h1,h2{border-bottom:1px solid #ddd;padding-bottom:.25em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}blockquote{border-left:4px solid #bac9bf;margin-left:0;padding-left:18px;color:#666}pre{background:#f6f7f8;padding:18px;border-radius:5px;white-space:pre-wrap}code{font:13px/1.6 Consolas,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:7px 12px}th{background:#f5f5f5}img{max-width:100%}a{color:#4f7762}mjx-container svg{max-width:100%;height:auto}div.language-math{position:relative;display:flex;justify-content:center;align-items:center;padding:12px 52px 12px 15px;line-height:1;color:#333}div.language-math[data-equation-number]::after{content:'(' attr(data-equation-number) ')';position:absolute;right:0;top:50%;transform:translateY(-50%);font:16px 'Times New Roman',serif} @media print{.vditor-reset{max-width:none;padding:0}pre,table,div.language-math{break-inside:avoid}h1,h2,h3{break-after:avoid}}`;
    const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: https: http:; style-src 'unsafe-inline'; font-src data:"><base href="${esc(baseURL)}"><title>${esc(filePath?filePath.split(/[\\/]/).pop():'Cypora 文档')}</title><style>${css}${settings.firstLineIndent?'.vditor-reset>p{text-indent:2em}':''}</style></head><body><article class="vditor-reset">${html}</article></body></html>`;
  }finally{container.remove();}
}
function replaceText(all=false){if(document.body.dataset.readonly==='true'){toast('当前文稿为只读');return;}if(window.Conversations?.active){$('#find-bar').hidden=true;window.Conversations.focusSearch();return;}const term=$('#search').value,replacement=$('#replace').value;if(!term)return;let next;if(all){const count=raw.split(term).length-1;if(!count){toast('没有匹配项');return;}next=raw.split(term).join(replacement);toast(`已替换 ${count} 处`);}else{const pos=raw.indexOf(term,Math.max(0,lastSearchIndex));if(pos<0){toast('没有匹配项');return;}next=raw.slice(0,pos)+replacement+raw.slice(pos+term.length);lastSearchIndex=pos+replacement.length;}raw=next;loading=true;editor.setValue(next);loading=false;changed(next);}
function findNext(backward=false){const term=$('#search').value;if(!term)return;const total=raw.split(term).length-1;lastSearchIndex=backward?raw.lastIndexOf(term,lastSearchIndex>0?lastSearchIndex-1:raw.length):raw.indexOf(term,lastSearchIndex+1);if(lastSearchIndex<0)lastSearchIndex=backward?raw.lastIndexOf(term):raw.indexOf(term);$('#find-count').textContent=total?`${total} 处匹配（含 Markdown 源码）`:'没有匹配项';if(total){editor.focus();window.find(term,false,backward,true,false,false,false);window.EditorTools?.remember();$('#search').focus();}}
async function run(name,arg){
  if(!ready&&!['theme'].includes(name))return;
  try{
    if(name==='save'||name==='save-as')await save(name==='save-as');
    else if(name==='open'){if(!await guard())return;const p=arg||await api('choose-file');if(!p)return;const r=await api('open-file',p);await setDocument(r.text,r.path,r.baseURL);recentList([r.path,...(settings.recent||[]).filter(p=>p!==r.path)].slice(0,15));}
    else if(name==='new'){if(!await guard())return;await api('new-file');await setDocument('');}
    else if(name==='close'){if(!await guard())return;clearTimeout(draftTimer);await draftQueue;await api('clear-draft');await api('close-ready');}
    else if(name==='folder'){const r=await api('folder');if(!r)return;folderFiles=r.files;$('#folder-label').textContent=r.root;$('#file-list').replaceChildren();for(const f of r.files){const b=document.createElement('button');b.textContent=f.name;b.title=f.path;b.onclick=()=>run('open',f.path);$('#file-list').append(b);}$('#files-tab').click();document.body.classList.remove('no-sidebar');}
    else if(name==='mode'){if(arg===mode&&!window.Conversations?.active)return;window.Conversations?.close();await mount(raw,arg);settings.mode=arg;await api('settings',{mode:arg});}
    else if(name==='import-conversations')window.Conversations?.showImport();
    else if(name==='conversation-view'){const doc=window.CyporaConversation?.fromMarkdown(raw);if(doc)window.Conversations.open(doc);else toast('先从“文件 → 导入 Codex 对话”导入一段对话。');}
    else if(name==='open-in-typora'){if(raw!==saved||!filePath){if(!await save())return;}await api('open-in-typora');}
    else if(name==='theme')await setTheme(arg);
    else if(name==='sidebar'){document.body.classList.toggle('no-sidebar');settings.sidebar=!document.body.classList.contains('no-sidebar');await api('settings',{sidebar:settings.sidebar});}
    else if(name==='focus')document.body.classList.toggle('focus-mode');
    else if(name==='typewriter'){settings.typewriter=!settings.typewriter;editor.vditor.options.typewriterMode=settings.typewriter;await api('settings',{typewriter:settings.typewriter});toast('打字机模式'+(settings.typewriter?'已开启':'已关闭'));}
    else if(name==='find'){$('#find-bar').hidden=!$('#find-bar').hidden;if(!$('#find-bar').hidden)$('#search').focus();}
    else if(name==='insert'){editor.focus();editor.insertValue(arg);changed(editor.getValue());}
    else if(name==='image'||name==='image-clipboard'){if(document.body.dataset.readonly==='true')return;const p=await api(name);if(p){window.EditorTools?.restore();const destination=/^file:/i.test(p)?p:p.replace(/[%#?<>\r\n]/g,c=>encodeURIComponent(c));const escaped=settings.imageEscape===false?destination:destination.replaceAll(' ','%20');editor.insertMD(`![](<${escaped}>)`);changed(editor.getValue());}}
    else if(name==='help'){if(!await guard())return;await api('new-file');await setDocument(WELCOME);}
    else if(name.startsWith('export-')||name==='print'){toast('正在准备导出…');const html=await renderExport();const result=await api('export',name==='print'?'print':name.slice(7),html);if(result)toast('导出完成：'+result);}
  }catch(e){fail(e);}
}
window.cypora.onAction(({name,arg})=>run(name,arg));
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>run(b.dataset.action));
$('#sidebar-toggle').onclick=()=>run('sidebar');$('#focus-toggle').onclick=()=>run('focus');
$('#theme-toggle').onclick=()=>setTheme(['light','sepia','dark'][(['light','sepia','dark'].indexOf(settings.theme)+1)%3]);
$('#mode').onchange=e=>run('mode',e.target.value);
$('#outline-tab').onclick=()=>{$('#outline').hidden=false;$('#files').hidden=true;$('#outline-tab').classList.add('active');$('#files-tab').classList.remove('active');};
$('#files-tab').onclick=()=>{$('#outline').hidden=true;$('#files').hidden=false;$('#files-tab').classList.add('active');$('#outline-tab').classList.remove('active');};
$('#find-close').onclick=()=>$('#find-bar').hidden=true;$('#find-next').onclick=()=>findNext();$('#replace-one').onclick=()=>replaceText(false);$('#replace-all').onclick=()=>replaceText(true);$('#search').oninput=()=>{lastSearchIndex=-1;};$('#search').onkeydown=e=>{if(e.key==='Enter')findNext(e.shiftKey);if(e.key==='Escape')$('#find-bar').hidden=true;};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('focus-mode');$('#find-bar').hidden=true;}});
new MutationObserver(()=>{clearTimeout(window.mathNumberTimer);window.mathNumberTimer=setTimeout(()=>numberMath($('#editor')),200);}).observe($('#editor'),{childList:true,subtree:true});
window.addEventListener('error',e=>fail(e.error||Error(e.message)));
window.addEventListener('unhandledrejection',e=>fail(e.reason));
(async()=>{
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const boot=await api('boot');settings={...settings,...boot.settings};mode=settings.mode;setTheme(settings.theme);document.body.classList.toggle('no-sidebar',settings.sidebar===false);recentList(settings.recent||[]);
  window.ReadingPreferences?.configure({getText:()=>raw,getSettings:()=>settings});
  window.Conversations?.init({
    onChange:(markdown)=>changed(markdown),
    onExit:async markdown=>{window.Conversations.close();await mount(markdown);},
    onImport:async doc=>{if(!await guard())return false;await api('new-file');const markdown=CyporaConversation.toMarkdown(doc);await setDocument(markdown);saved='';changed(markdown);$('#save-status').textContent='对话已导入 · 请保存为 Markdown';return true;},
    listLocal:()=>api('list-codex-conversations'),readLocal:id=>api('read-codex-conversation',id),chooseFiles:()=>api('choose-conversation-files'),
    getSettings:()=>settings,openExternal:url=>api('external',url)
  });
  await setDocument('');
  await window.Workspace?.initialize(boot);
  if(boot.recovery){$('#recovery-info').textContent=`${boot.recovery.path||'未命名文档'} · ${new Date(boot.recovery.date).toLocaleString()}。恢复后请另存为文件。`;$('#recovery').showModal();await new Promise(resolve=>{$('#discard-recovery').onclick=async()=>{await api('clear-draft');$('#recovery').close();resolve();};$('#restore-recovery').onclick=async()=>{await api('new-file');await setDocument(boot.recovery.text);saved='';await api('dirty',raw!==saved);$('#save-status').textContent='草稿已恢复 · 请保存';$('#recovery').close();resolve();};});}
  if(boot.initialFile)await run('open',boot.initialFile);
  else if(!boot.recovery&&settings.reopenLast!==false&&settings.lastFile){const d=boot.library?.documents.find(d=>d.path===settings.lastFile&&!d.missing&&!d.archived&&!d.closed);if(d)await run('open',d.path);}
  if(boot.testing)window.__cyporaTest={get raw(){return raw;},get saved(){return saved;},get mode(){return mode;},get editor(){return editor;},setDocument,mount,renderExport,numberMath,changed,run,get ready(){return ready;}};
})().catch(fail);
