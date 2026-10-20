/* Local conversation document view. Markdown remains the source of truth. */
(() => {
  'use strict';
  const icons = {
    chevron:'<path d="m9 5 7 7-7 7"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    grip:'<circle cx="9" cy="5" r=".8"/><circle cx="15" cy="5" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="19" r=".8"/><circle cx="15" cy="19" r=".8"/>',
    up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',
    edit:'<path d="m15 4 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-5-5L4 14z"/>',
    trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    undo:'<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
    code:'<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
    import:'<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>', merge:'<path d="M5 4v5a7 7 0 0 0 7 7m7-12v5a7 7 0 0 1-7 7v5m-4-4 4 4 4-4"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.code}</svg>`;
  const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  const clone = value => JSON.parse(JSON.stringify(value));
  const model = () => window.CyporaConversation;
  const state = {hooks:{},doc:null,active:false,query:'',selected:new Set(),history:[],future:[],editing:null,generation:0,previewQueue:Promise.resolve(),drag:null,pointer:null,dragY:0,dragFrame:0,scrollFrame:0,scrubbing:null,localItems:[],importSelected:new Set(),importEpoch:0};
  let view,scroll,stream,rail,search,count,status,mergeButton,undoButton,selectionButton,importDialog;
  const plain = text => String(text||'').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[`#*_>]/g,'').replace(/\s+/g,' ').trim();
  const turnText = turn => turn.messages.map(m=>m.content).join('\n');
  const summary = turn => plain(turn.messages.find(m=>m.role==='user')?.content||turn.title||turnText(turn)).slice(0,200)||'空白对话';
  function button(name,label,action,cls=''){const n=el('button',cls);n.type='button';n.title=label;n.setAttribute('aria-label',label);n.innerHTML=icon(name);if(action)n.onclick=action;return n;}
  function report(message){status.textContent=message;status.title=message;state.hooks.onStatus?.(message);}
  function error(err){report(err?.message||String(err));console.error(err);}
  function changed(){try{state.hooks.onChange?.(model().toMarkdown(state.doc),clone(state.doc));}catch(e){error(e);}}
  function readonly(){return document.body.dataset.readonly==='true';}
  function remember(){state.history.push(clone(state.doc));state.future=[];if(state.history.length>40)state.history.shift();}
  function mutate(next,message){if(readonly()){report('当前文稿为只读');return;}remember();state.doc=next;state.editing=null;changed();render();if(message)report(message);}
  function settings(){return state.hooks.getSettings?.()||{};}
  function init(hooks={}){
    Object.assign(state.hooks,hooks);
    if(view)return window.Conversations;
    view=el('section','conversation-view');view.id='conversation-view';view.hidden=true;view.setAttribute('aria-label','对话文稿');
    const toolbar=el('div','conversation-toolbar');
    const searchWrap=el('label','conversation-search');searchWrap.innerHTML=icon('search');
    search=el('input');search.type='search';search.placeholder='查找对话';search.setAttribute('aria-label','查找对话内容');
    search.addEventListener('input',()=>{state.query=search.value;render();});searchWrap.append(search);
    count=el('span','conversation-count');toolbar.append(searchWrap,count);
    const controls=el('div','conversation-toolbar-actions');
    selectionButton=el('button','conversation-text-button','选择');selectionButton.onclick=()=>{view.classList.toggle('conversation-selecting');if(!view.classList.contains('conversation-selecting'))state.selected.clear();render();};
    selectionButton.title='选择多轮对话以合并';
    mergeButton=button('merge','合并选中对话',()=>merge([...state.selected]));
    undoButton=button('undo','撤销上次对话编辑',undo);
    controls.append(selectionButton,mergeButton,undoButton,button('import','导入 Codex 对话',showImport),button('code','在 Markdown 编辑器中打开',exit));
    toolbar.append(controls);
    scroll=el('div','conversation-scroll');scroll.tabIndex=-1;stream=el('div','conversation-stream');scroll.append(stream);
    rail=el('nav','conversation-rail');rail.setAttribute('aria-label','按用户消息跳转');
    status=el('div','conversation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    view.append(toolbar,scroll,rail,status);(document.querySelector('#editor-layout')||document.querySelector('main')||document.body).append(view);
    scroll.addEventListener('scroll',()=>{if(!state.scrollFrame)state.scrollFrame=requestAnimationFrame(()=>{state.scrollFrame=0;updateCurrent();});},{passive:true});
    scroll.addEventListener('dragover',dragOver);scroll.addEventListener('drop',drop);scroll.addEventListener('dragleave',e=>{if(!scroll.contains(e.relatedTarget))clearDrop();});
    window.addEventListener('dragend',endDrag);
    document.addEventListener('pointermove',movePointer,{capture:true,passive:false});
    document.addEventListener('pointerup',finishPointer,true);
    document.addEventListener('pointercancel',cancelPointer,true);
    window.addEventListener('blur',endDrag);
    view.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&state.pointer){e.preventDefault();e.stopPropagation();endDrag();report('已取消排序');}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();search.focus();search.select();}
      else if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())&&!e.target.matches('textarea,input')){e.preventDefault();e.stopPropagation();if(e.shiftKey||e.key.toLowerCase()==='y')redo();else undo();}
      else if(e.key==='Escape'&&state.query&&e.target===search){state.query='';search.value='';render();}
    },true);
    const nearest=y=>[...rail.children].reduce((best,item)=>{const r=item.getBoundingClientRect(),distance=Math.abs(y-(r.top+r.height/2));return !best||distance<best.distance?{item,distance}:best;},null)?.item;
    rail.addEventListener('pointermove',e=>{const target=nearest(e.clientY);railProgress(target);if(state.scrubbing!==null&&target)jump(target.dataset.turnId,false);});
    rail.addEventListener('pointerdown',e=>{if(e.button!==0)return;state.scrubbing=e.pointerId;rail.setPointerCapture(e.pointerId);rail.dataset.scrubbing='true';const target=nearest(e.clientY);railProgress(target);if(target)jump(target.dataset.turnId,false);});
    rail.addEventListener('pointerup',e=>{if(state.scrubbing===null)return;state.scrubbing=null;delete rail.dataset.scrubbing;if(rail.hasPointerCapture(e.pointerId))rail.releasePointerCapture(e.pointerId);});
    rail.addEventListener('pointercancel',()=>{state.scrubbing=null;delete rail.dataset.scrubbing;railProgress(null);});
    rail.addEventListener('pointerleave',()=>{if(state.scrubbing===null)railProgress(null);});
    rail.addEventListener('focusin',e=>railProgress(e.target.closest('.conversation-rail-item')));
    rail.addEventListener('focusout',()=>{if(state.scrubbing===null)railProgress(null);});
    rail.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;const items=[...rail.children],index=items.indexOf(e.target);if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,index+(e.key==='ArrowUp'?-1:1)));items[next]?.focus();});
    new MutationObserver(()=>{if(state.active)render();}).observe(document.body,{attributes:true,attributeFilter:['data-readonly']});
    buildImportDialog();
    return window.Conversations;
  }
  function open(documentOrMarkdown){
    init();const doc=typeof documentOrMarkdown==='string'?model().fromMarkdown(documentOrMarkdown):documentOrMarkdown;
    if(!doc||!Array.isArray(doc.turns))throw Error('这份文稿不包含可识别的对话。');
    state.doc=clone(doc);state.active=true;state.query='';state.selected.clear();state.history=[];state.future=[];state.editing=null;search.value='';
    const previousFind=document.querySelector('#find-bar');if(previousFind)previousFind.hidden=true;
    view.hidden=false;document.body.classList.add('conversation-mode');render();scroll.scrollTop=0;
    report(doc.warnings?.length?doc.warnings.join(' · '):'对话已载入 · 拖动左侧手柄排序');
    return clone(state.doc);
  }
  function close(){const text=state.doc?model().toMarkdown(state.doc):'';state.active=false;state.editing=null;state.generation++;endDrag();if(view)view.hidden=true;document.body.classList.remove('conversation-mode');return text;}
  async function exit(){const text=close();await state.hooks.onExit?.(text);}
  function refreshFromMarkdown(text){const next=model().fromMarkdown(text);if(!next)return false;if(!state.active){open(next);return true;}state.doc=next;state.editing=null;render();return true;}
  function matches(turn){return !state.query||turnText(turn).toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase())||String(turn.title||'').toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase());}
  function render(){
    if(!state.active)return;
    if(state.pointer)endDrag();
    const top=scroll.scrollTop,generation=++state.generation;stream.replaceChildren();rail.replaceChildren();
    const shown=state.doc.turns.filter(matches);count.textContent=state.query?`${shown.length} / ${state.doc.turns.length} 轮`:`${state.doc.turns.length} 轮对话`;
    mergeButton.disabled=readonly()||state.selected.size<2;mergeButton.title=state.selected.size>1?`合并选中的 ${state.selected.size} 轮对话`:'选择至少两轮对话后合并';
    undoButton.disabled=readonly()||!state.history.length;selectionButton.disabled=readonly();selectionButton.textContent=view.classList.contains('conversation-selecting')?'取消选择':'选择';
    if(!shown.length){const empty=el('div','conversation-empty');empty.append(el('h2','',state.query?'没有匹配的对话':'这里等待下一段思考'),el('p','',state.query?'尝试搜索其他文字，或清除搜索。':'导入 Codex 对话，在这里编辑、排序与整理。'));if(!state.query){const b=el('button','conversation-primary','导入对话');b.onclick=showImport;empty.append(b);}stream.append(empty);}
    for(const turn of shown){
      const article=el('article','conversation-turn');article.dataset.turnId=turn.id;article.classList.toggle('is-selected',state.selected.has(turn.id));article.classList.toggle('is-collapsed',!!turn.collapsed&&!state.query);
      const tools=el('div','conversation-turn-tools');
      const checkbox=el('input','conversation-select');checkbox.type='checkbox';checkbox.checked=state.selected.has(turn.id);checkbox.setAttribute('aria-label','选择对话：'+summary(turn));checkbox.onchange=()=>{if(checkbox.checked)state.selected.add(turn.id);else state.selected.delete(turn.id);article.classList.toggle('is-selected',checkbox.checked);mergeButton.disabled=state.selected.size<2;};
      const grip=button('grip','拖动对话排序；Alt + 上下方向键移动',null,'conversation-grip');grip.draggable=false;grip.disabled=readonly();grip.dataset.turnId=turn.id;grip.addEventListener('pointerdown',e=>startPointer(e,turn.id));grip.addEventListener('lostpointercapture',()=>{if(state.pointer?.handle===grip)endDrag();});grip.addEventListener('dragstart',e=>startDrag(e,turn.id));grip.onkeydown=e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();move(turn.id,state.doc.turns.findIndex(t=>t.id===turn.id)+(e.key==='ArrowUp'?-1:1));stream.querySelector(`[data-turn-id="${CSS.escape(turn.id)}"] .conversation-grip`)?.focus();}};
      const fold=button('chevron',turn.collapsed?'展开对话':'收起对话',()=>toggle(turn.id),'conversation-fold');fold.setAttribute('aria-expanded',String(!turn.collapsed||!!state.query));
      tools.append(checkbox,grip,fold);article.append(tools);
      const content=el('div','conversation-turn-content');
      if(turn.collapsed&&!state.query){const collapsed=el('button','conversation-collapsed-summary');collapsed.textContent=summary(turn);collapsed.onclick=()=>toggle(turn.id);content.append(collapsed,el('span','conversation-collapsed-count',`${turn.messages.length} 条消息`));}
      else for(const message of turn.messages)content.append(messageNode(turn,message,generation));
      const actions=el('div','conversation-turn-actions'),index=state.doc.turns.findIndex(t=>t.id===turn.id);
      const up=button('up','上移整轮对话',()=>move(turn.id,index-1)),down=button('down','下移整轮对话',()=>move(turn.id,index+1)),del=button('trash','删除整轮对话（可撤销）',()=>remove(turn.id));up.disabled=readonly()||index===0;down.disabled=readonly()||index===state.doc.turns.length-1;del.disabled=readonly();
      actions.append(up,down,del);content.append(actions);article.append(content);stream.append(article);
      if(turn.messages.some(m=>m.role==='user')){const item=el('button','conversation-rail-item');item.dataset.turnId=turn.id;item.type='button';item.setAttribute('aria-label','跳转到：'+summary(turn));item.append(el('span','conversation-rail-line'),el('span','conversation-rail-preview',summary(turn)));item.onclick=()=>jump(turn.id);rail.append(item);}
    }
    scroll.scrollTop=top;requestAnimationFrame(updateCurrent);
  }
  function messageNode(turn,message,generation){
    const user=message.role==='user',wrapper=el('section','conversation-message '+(user?'conversation-user':'conversation-assistant'));wrapper.dataset.messageId=message.id;
    const content=el('div','conversation-message-body');
    if(state.editing?.id===message.id){
      const area=el('textarea','conversation-markdown-input');area.value=message.content;area.spellcheck=false;area.readOnly=readonly();area.setAttribute('aria-label',user?'编辑用户消息 Markdown':'编辑 Codex 回复 Markdown');
      area.addEventListener('input',()=>{const m=state.doc.turns.flatMap(t=>t.messages).find(m=>m.id===message.id);if(m){m.content=area.value;changed();}});
      area.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();finishEdit(false);}else if(e.key==='Escape'){e.preventDefault();finishEdit(true);}});
      const actions=el('div','conversation-edit-actions'),cancel=el('button','','取消'),apply=el('button','conversation-primary','完成');cancel.onclick=()=>finishEdit(true);apply.onclick=()=>finishEdit(false);actions.append(el('span','','Markdown · Ctrl + Enter 完成'),cancel,apply);content.append(area,actions);
      requestAnimationFrame(()=>{area.style.height=Math.min(600,Math.max(150,area.scrollHeight+4))+'px';area.focus();});
    }else{
      const preview=el('div','conversation-markdown vditor-reset');content.append(preview);preview.textContent=message.content;
      const edit=button('edit','编辑这条消息',()=>beginEdit(message.id),'conversation-edit-button');edit.disabled=readonly();content.append(edit);
      queuePreview(preview,message.content,generation);
    }
    wrapper.append(content);return wrapper;
  }
  function sanitizePreview(html){
    const template=document.createElement('template');template.innerHTML=html;
    template.content.querySelectorAll('script,iframe,object,embed,style,link,base,meta,form').forEach(n=>n.remove());
    template.content.querySelectorAll('*').forEach(n=>{for(const a of [...n.attributes])if(/^on/i.test(a.name)||a.name==='srcdoc'||(['href','src','xlink:href','action'].includes(a.name)&&/^\s*(javascript|vbscript|data:text\/html):/i.test(a.value)))n.removeAttribute(a.name);});
    // Vditor's diagram renderers can evaluate special fenced blocks. Conversation code is always inert.
    template.content.querySelectorAll('[class]').forEach(n=>{for(const name of [...n.classList])if(/^language-(echarts|mindmap|markmap|mermaid|flowchart|graphviz|plantuml|abc|smiles)$/i.test(name)||(/^language-math$/i.test(name)&&n.closest('pre'))){const lang=name.slice(9);if(n.tagName==='CODE'){n.dataset.conversationLanguage=lang;n.classList.replace(name,'language-plaintext');}else{const pre=el('pre'),code=el('code','language-plaintext',n.textContent);code.dataset.conversationLanguage=lang;pre.append(code);n.replaceWith(pre);}break;}});
    return template.innerHTML;
  }
  function queuePreview(node,text,generation){
    state.previewQueue=state.previewQueue.catch(()=>{}).then(async()=>{
      if(generation!==state.generation||!node.isConnected)return;
      const prefs=settings(),dark=(window.PreferencesUI?.resolvedMode||document.body.dataset.theme)==='dark',cdn=new URL('node_modules/vditor',location.href).href.replace(/\/$/,'');
      try{
        await window.Vditor.preview(node,text,{cdn,lang:'zh_CN',icon:'',mode:dark?'dark':'light',math:{engine:'MathJax',inlineDigit:true},theme:{current:dark?'dark':'light',path:cdn+'/dist/css/content-theme'},hljs:{enable:true,lineNumber:prefs.codeLineNumbers!==false,style:dark?'github-dark':'github'},markdown:{sanitize:true,mark:prefs.markdownHighlight!==false,footnotes:prefs.markdownFootnotes!==false,autoSpace:!!prefs.autoSpace,gfmAutoLink:prefs.autoLinks!==false,toc:false},render:{media:{enable:false}},transform:sanitizePreview});
        if(generation!==state.generation||!node.isConnected)return;
        highlight(node);numberMath();
      }catch(e){node.textContent=text;node.classList.add('conversation-preview-fallback');node.title='预览未完成，原始 Markdown 已保留';console.error(e);}
    });
  }
  function numberMath(){let n=0;stream.querySelectorAll('div.language-math').forEach(node=>{n++;const tex=node.dataset.math||node.textContent;if(settings().equationNumbering==='none'||/\\tag\*?\s*\{/.test(tex))node.removeAttribute('data-equation-number');else node.dataset.equationNumber=String(n);});}
  function highlight(node){
    const query=state.query.trim();if(!query)return;const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),nodes=[];let text;
    while(text=walker.nextNode())if(!text.parentElement.closest('svg,mjx-container,script,style,.language-math'))nodes.push(text);
    for(const text of nodes){const lower=text.textContent.toLocaleLowerCase(),needle=query.toLocaleLowerCase();let start=0,index=lower.indexOf(needle);if(index<0)continue;const f=document.createDocumentFragment();while(index>=0){f.append(document.createTextNode(text.textContent.slice(start,index)),el('mark','conversation-match',text.textContent.slice(index,index+query.length)));start=index+query.length;index=lower.indexOf(needle,start);}f.append(document.createTextNode(text.textContent.slice(start)));text.replaceWith(f);}
  }
  function beginEdit(id){if(readonly())return;state.editing=null;const message=state.doc.turns.flatMap(t=>t.messages).find(m=>m.id===id);if(!message)return;remember();state.editing={id,original:message.content};render();}
  function finishEdit(cancel){if(!state.editing)return;if(cancel){const message=state.doc.turns.flatMap(t=>t.messages).find(m=>m.id===state.editing.id);if(message)message.content=state.editing.original;changed();}state.editing=null;render();report(cancel?'已取消这条消息的编辑':'消息已更新，Markdown 已同步');}
  function toggle(id){const doc=clone(state.doc),turn=doc.turns.find(t=>t.id===id);if(!turn)return;turn.collapsed=!turn.collapsed;if(readonly()){state.doc=doc;render();return;}mutate(doc,turn.collapsed?'已收起对话':'已展开对话');}
  function move(id,index){if(!state.doc)return;const old=state.doc.turns.findIndex(t=>t.id===id),target=Math.max(0,Math.min(state.doc.turns.length-1,index));if(old<0||old===target)return;mutate(model().moveTurn(state.doc,id,target),'已移动整轮对话');}
  function remove(id){if(!state.doc)return;state.selected.delete(id);mutate(model().deleteTurn(state.doc,id),'已删除对话 · 可点击顶部撤销恢复');}
  function merge(ids){if(ids.length<2)return;mutate(model().mergeTurns(state.doc,ids),'已合并选中对话，消息顺序和角色已保留');state.selected.clear();view.classList.remove('conversation-selecting');render();}
  function undo(){if(readonly()||!state.history.length)return;state.future.push(clone(state.doc));state.doc=state.history.pop();state.selected.clear();state.editing=null;changed();render();report('已撤销上次对话编辑');}
  function redo(){if(readonly()||!state.future.length)return;state.history.push(clone(state.doc));state.doc=state.future.pop();state.selected.clear();state.editing=null;changed();render();report('已重做对话编辑');}
  function jump(id,smooth=true){const target=stream.querySelector(`[data-turn-id="${CSS.escape(id)}"]`);if(!target)return;scroll.scrollTo({top:scroll.scrollTop+target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:!smooth||document.body.dataset.reduceMotion==='true'?'instant':'smooth'});if(smooth){target.classList.add('conversation-jump');setTimeout(()=>target.classList.remove('conversation-jump'),900);}}
  function railProgress(target){const index=[...rail.children].indexOf(target);[...rail.children].forEach((item,i)=>{const distance=Math.abs(i-index),progress=index<0?0:([1,.7,.4,.2][distance]||0);item.style.setProperty('--rail-progress',String(progress));item.classList.toggle('is-hovered',item===target);});}
  function updateCurrent(){if(!state.active)return;const top=scroll.getBoundingClientRect().top+Math.min(160,scroll.clientHeight*.25),turns=[...stream.querySelectorAll('.conversation-turn')];let current=turns[0];for(const item of turns){if(item.getBoundingClientRect().top<=top)current=item;else break;}for(const item of rail.children){const active=item.dataset.turnId===current?.dataset.turnId;item.classList.toggle('is-current',active);if(active)item.setAttribute('aria-current','true');else item.removeAttribute('aria-current');}}
  // Pointer capture avoids Windows/Electron's separate native drag loop. The document
  // changes only after pointerup; cancel, Escape, lost capture and blur never reorder.
  function startPointer(event,id){
    if(event.button!==0||event.isPrimary===false)return;
    if(readonly()||state.query){event.preventDefault();report(readonly()?'当前文稿为只读':'清除搜索后可拖动排序');return;}
    event.preventDefault();event.stopPropagation();endDrag();
    const handle=event.currentTarget;handle.focus({preventScroll:true});
    state.pointer={id,pointerId:event.pointerId,handle,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,started:false};
    try{handle.setPointerCapture(event.pointerId);}catch(_){/* Synthetic regression events have no active device. */}
  }
  function movePointer(event){
    const pointer=state.pointer;if(!pointer||event.pointerId!==pointer.pointerId)return;
    pointer.x=event.clientX;pointer.y=event.clientY;state.dragY=event.clientY;
    if(!pointer.started&&Math.hypot(pointer.x-pointer.startX,pointer.y-pointer.startY)<5)return;
    event.preventDefault();
    if(!pointer.started){pointer.started=true;state.drag=pointer.id;pointer.handle.setAttribute('aria-grabbed','true');pointer.handle.closest('.conversation-turn')?.classList.add('is-dragging');view.classList.add('conversation-pointer-sorting');state.dragFrame=requestAnimationFrame(autoScroll);}
    paintPointerDrop();
  }
  function pointerDestination(pointer,clamp=false){
    if(!pointer||!stream)return null;const viewport=scroll.getBoundingClientRect();
    if(pointer.x<viewport.left||pointer.x>viewport.right||(!clamp&&(pointer.y<viewport.top||pointer.y>viewport.bottom)))return null;
    const y=clamp?Math.max(viewport.top+1,Math.min(viewport.bottom-1,pointer.y)):pointer.y;
    const hit=document.elementFromPoint(pointer.x,y)?.closest('.conversation-turn'),articles=[...stream.querySelectorAll('.conversation-turn')];
    let insertion;
    if(hit&&stream.contains(hit)){const r=hit.getBoundingClientRect();insertion=articles.indexOf(hit)+(y>=r.top+r.height/2?1:0);}
    else{insertion=articles.findIndex(item=>{const r=item.getBoundingClientRect();return y<r.top+r.height/2;});if(insertion<0)insertion=articles.length;}
    const old=state.doc.turns.findIndex(t=>t.id===pointer.id),index=insertion-(old<insertion?1:0);
    return {index:Math.max(0,Math.min(state.doc.turns.length-1,index)),before:articles[insertion]||null,after:insertion===articles.length?articles[articles.length-1]:null};
  }
  function paintPointerDrop(){clearDrop();const destination=pointerDestination(state.pointer,true);if(!destination||destination.index===state.doc.turns.findIndex(t=>t.id===state.pointer.id))return;if(destination.before)destination.before.classList.add('drop-before');else destination.after?.classList.add('drop-after');}
  function finishPointer(event){
    const pointer=state.pointer;if(!pointer||event.pointerId!==pointer.pointerId)return;
    pointer.x=event.clientX;pointer.y=event.clientY;const destination=pointer.started?pointerDestination(pointer):null,id=pointer.id;
    if(pointer.started)event.preventDefault();endDrag();
    if(destination&&!readonly()&&!state.query){move(id,destination.index);stream.querySelector(`[data-turn-id="${CSS.escape(id)}"] .conversation-grip`)?.focus({preventScroll:true});}
  }
  function cancelPointer(event){if(state.pointer&&event.pointerId===state.pointer.pointerId)endDrag();}
  function startDrag(event,id){if(state.pointer||readonly()||state.query){event.preventDefault();if(!state.pointer)report(readonly()?'当前文稿为只读':'清除搜索后可拖动排序');return;}state.drag=id;state.dragY=event.clientY;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/x-cypora-turn',id);event.target.closest('.conversation-turn').classList.add('is-dragging');state.dragFrame=requestAnimationFrame(autoScroll);}
  function clearDrop(){stream?.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));}
  function dragOver(event){if(!state.drag)return;event.preventDefault();event.dataTransfer.dropEffect='move';state.dragY=event.clientY;clearDrop();const target=event.target.closest('.conversation-turn');if(target&&target.dataset.turnId!==state.drag){const rect=target.getBoundingClientRect();target.classList.add(event.clientY<rect.top+rect.height/2?'drop-before':'drop-after');}}
  function autoScroll(){if(!state.drag)return;const rect=scroll.getBoundingClientRect(),edge=65;let delta=0;if(state.dragY<rect.top+edge)delta=-Math.min(20,(rect.top+edge-state.dragY)*.25);else if(state.dragY>rect.bottom-edge)delta=Math.min(20,(state.dragY-rect.bottom+edge)*.25);if(delta){scroll.scrollTop+=delta;if(state.pointer)paintPointerDrop();}state.dragFrame=requestAnimationFrame(autoScroll);}
  function drop(event){if(!state.drag)return;event.preventDefault();const id=state.drag,target=event.target.closest('.conversation-turn');if(target&&target.dataset.turnId!==id){let targetIndex=state.doc.turns.findIndex(t=>t.id===target.dataset.turnId);const old=state.doc.turns.findIndex(t=>t.id===id),r=target.getBoundingClientRect();if(event.clientY>=r.top+r.height/2)targetIndex++;if(old<targetIndex)targetIndex--;endDrag();move(id,targetIndex);}else endDrag();}
  function endDrag(){const pointer=state.pointer;state.pointer=null;state.drag=null;if(pointer){pointer.handle.removeAttribute('aria-grabbed');try{if(pointer.handle.hasPointerCapture(pointer.pointerId))pointer.handle.releasePointerCapture(pointer.pointerId);}catch(_){}}if(state.dragFrame)cancelAnimationFrame(state.dragFrame);state.dragFrame=0;view?.classList.remove('conversation-pointer-sorting');clearDrop();stream?.querySelectorAll('.is-dragging').forEach(n=>n.classList.remove('is-dragging'));}
  function buildImportDialog(){
    importDialog=el('dialog','conversation-import');importDialog.id='conversation-import-dialog';importDialog.setAttribute('aria-labelledby','conversation-import-title');
    const heading=el('div','conversation-import-heading'),title=el('h2','','导入 Codex 对话');title.id='conversation-import-title';heading.append(title,button('close','关闭导入',()=>importDialog.close()));
    const intro=el('p','conversation-import-intro','把问答带进文稿，继续编辑与整理。仅导入可见文字消息；附件与工具输出不导入。');
    const tabs=el('div','conversation-import-tabs');tabs.setAttribute('role','tablist');
    const localTab=el('button','selected','本机对话'),fileTab=el('button','','从文件导入'),pasteTab=el('button','','粘贴内容');tabs.append(localTab,fileTab,pasteTab);
    const local=el('section','conversation-import-local'),file=el('section','conversation-import-file'),paste=el('section','conversation-import-paste');file.hidden=true;paste.hidden=true;
    const filter=el('input','conversation-import-filter');filter.type='search';filter.placeholder='搜索本机对话标题';filter.setAttribute('aria-label','搜索本机 Codex 对话');const localList=el('div','conversation-local-list');localList.id='conversation-local-list';
    const localNote=el('p','conversation-import-note','正在读取本机对话列表…');localNote.id='conversation-import-local-note';
    local.append(filter,localList,localNote);filter.oninput=()=>paintLocal(filter.value);
    const fileCopy=el('p','','导入 Codex 会话 JSONL、ChatGPT 导出 JSON 或 Markdown。可以选择多个文件合并为一份对话文稿。'),choose=el('button','conversation-primary','选择对话文件');choose.onclick=async()=>{await importing(async()=>{const epoch=state.importEpoch,entries=await state.hooks.chooseFiles?.();if(!entries?.length||epoch!==state.importEpoch||!importDialog.open)return;await deliver(entries.map(item=>model().parse(item.text,item.filename)),epoch);});};file.append(fileCopy,choose);
    const area=el('textarea','conversation-paste-input');area.placeholder='粘贴带有 User / Assistant 或 用户 / 助手 标题的 Markdown，也可以粘贴 JSON / JSONL…';area.setAttribute('aria-label','粘贴对话内容');area.spellcheck=false;paste.append(area);
    const importError=el('p','conversation-import-error');importError.id='conversation-import-error';importError.setAttribute('role','alert');
    const footer=el('div','conversation-import-actions'),selected=el('span','conversation-import-selected','未选择对话');selected.id='conversation-import-selected';const cancel=el('button','','取消'),submit=el('button','conversation-primary','导入选中对话');submit.id='conversation-import-submit';cancel.onclick=()=>importDialog.close();submit.disabled=true;footer.append(selected,cancel,submit);
    let tab='local';
    for(const [name,node,panel]of [['local',localTab,local],['file',fileTab,file],['paste',pasteTab,paste]]){node.setAttribute('role','tab');node.setAttribute('aria-selected',String(name==='local'));node.onclick=()=>{tab=name;for(const [other,btn,p]of [['local',localTab,local],['file',fileTab,file],['paste',pasteTab,paste]]){btn.classList.toggle('selected',other===name);btn.setAttribute('aria-selected',String(other===name));p.hidden=other!==name;}submit.hidden=name==='file';selected.hidden=name!=='local';submit.textContent=name==='paste'?'导入粘贴内容':'导入选中对话';submit.disabled=name==='paste'?!area.value.trim():!state.importSelected.size;importError.textContent='';};}
    area.oninput=()=>{if(tab==='paste')submit.disabled=!area.value.trim();};
    submit.onclick=()=>importing(async()=>{const epoch=state.importEpoch;if(tab==='paste')await deliver([model().parse(area.value,'粘贴的对话.md')],epoch);else {if(state.importSelected.size>20)throw Error('一次最多导入 20 个对话，请分批整理。');const docs=[];let bytes=0;for(const id of state.importSelected){const source=await state.hooks.readLocal?.(id);if(!importDialog.open||epoch!==state.importEpoch)return;if(!source)throw Error('无法读取选中的对话');bytes+=new TextEncoder().encode(source.text).length;if(bytes>64*1024*1024)throw Error('选中对话合计超过 64 MB，请减少本次导入数量。');docs.push(model().parse(source.text,source.filename));}await deliver(docs,epoch);}});
    importDialog.append(heading,intro,tabs,local,file,paste,importError,footer);document.body.append(importDialog);
    importDialog.addEventListener('close',()=>{state.importEpoch++;});
    importDialog._reset=()=>{localTab.click();filter.value='';area.value='';importError.textContent='';};
  }
  async function showImport(){
    init();state.importSelected.clear();state.localItems=[];importDialog._reset();paintLocal();if(!importDialog.open)importDialog.showModal();
    const epoch=++state.importEpoch,note=importDialog.querySelector('#conversation-import-local-note');note.textContent='正在读取本机对话列表…';
    try{const result=await state.hooks.listLocal?.();if(epoch!==state.importEpoch)return;state.localItems=Array.isArray(result)?result:(result?.items||[]);note.textContent=state.localItems.length?`只读取你选择的对话${result?.truncated?' · 当前显示最近一批记录':''}，原始会话保持不变。`:'没有找到本机对话。也可以从文件导入或粘贴内容。';paintLocal();}
    catch(e){if(epoch===state.importEpoch)note.textContent='暂时无法读取本机列表：'+(e.message||e)+'。可以从文件导入或粘贴内容。';}
  }
  function paintLocal(query=''){
    const list=importDialog.querySelector('#conversation-local-list');list.replaceChildren();
    for(const item of state.localItems.filter(item=>String(item.title||'').toLocaleLowerCase().includes(query.toLocaleLowerCase()))){const label=el('label','conversation-local-item'),check=el('input');check.type='checkbox';check.checked=state.importSelected.has(item.id);const copy=el('span','conversation-local-copy');copy.append(el('strong','',item.title||'未命名对话'));let date='';if(item.updatedAt){const parsed=new Date(typeof item.updatedAt==='number'&&item.updatedAt<1e12?item.updatedAt*1000:item.updatedAt);if(!isNaN(parsed))date=parsed.toLocaleDateString('zh-CN');}copy.append(el('small','',[date,item.archived?'已归档':''].filter(Boolean).join(' · ')));label.append(check,copy);check.onchange=()=>{if(check.checked&&state.importSelected.size>=20&&!state.importSelected.has(item.id)){check.checked=false;importDialog.querySelector('#conversation-import-error').textContent='一次最多导入 20 个对话，请分批整理。';return;}if(check.checked)state.importSelected.add(item.id);else state.importSelected.delete(item.id);updateImportSelection();};list.append(label);}
    if(state.localItems.length&&!list.children.length)list.append(el('p','conversation-import-note','没有匹配的标题。'));
    updateImportSelection();
  }
  function updateImportSelection(){importDialog.querySelector('#conversation-import-selected').textContent=state.importSelected.size?`已选择 ${state.importSelected.size} 个对话`:'未选择对话';importDialog.querySelector('#conversation-import-submit').disabled=!state.importSelected.size;}
  async function importing(task){const buttons=[...importDialog.querySelectorAll('button')],previous=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);const target=importDialog.querySelector('#conversation-import-error');target.textContent='';try{await task();}catch(e){target.textContent=e.message||String(e);}finally{buttons.forEach((b,i)=>b.disabled=previous[i]);}}
  async function deliver(docs,epoch=state.importEpoch){if(!importDialog.open||epoch!==state.importEpoch||!docs.length)return;const doc=docs.length===1?docs[0]:model().combine(docs);if(!doc.turns.length)throw Error('没有识别到对话消息。请使用 Codex JSONL、对话导出 JSON，或带角色标题的 Markdown。');if(state.hooks.onImport){if(await state.hooks.onImport(doc)===false)return;}else{open(doc);changed();}importDialog.close();}
  document.addEventListener('click',e=>{if(!state.active)return;const a=e.target.closest?.('#conversation-view .conversation-markdown a');if(a){e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//i.test(href))state.hooks.openExternal?.(href);}});
  window.Conversations={init,open,close,showImport,refreshFromMarkdown,move,remove,merge,undo,redo,toggle,jump,beginEdit,finishEdit,focusSearch:()=>{search?.focus();search?.select();},flush:async()=>state.doc?model().toMarkdown(state.doc):'',refresh:()=>render(),toMarkdown:()=>state.doc?model().toMarkdown(state.doc):'',get active(){return state.active;},get document(){return state.doc?clone(state.doc):null;},get previewReady(){return state.previewQueue;}};
})();
