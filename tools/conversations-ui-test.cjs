// Tests real rendered conversation interactions using the existing Electron harness.
module.exports=async({js,check,until,fs,path,win})=>{
  if(win){win.webContents.setBackgroundThrottling(false);win.showInactive();}
  const fixture={
    version:1,id:'conversation-ui-fixture',title:'对话整理回归',source:{format:'fixture',filename:'fixture.json'},
    conversations:[{id:'origin-a',title:'代码与公式',source:{format:'fixture'}},{id:'origin-b',title:'整理笔记',source:{format:'fixture'}}],
    turns:[
      {id:'turn-a',conversationId:'origin-a',title:'代码问题',collapsed:false,messages:[{id:'user-a',role:'user',content:'请解释 JavaScript 代码，保留公式。'},{id:'assistant-a',role:'assistant',content:'## 先看代码\n\n```javascript\nconst value = 42;\nconsole.log(value);\n```\n\n行内公式 $x_{i}^{2}$。\n\n$$\n\\frac{a}{b} = \\sqrt{x}\n$$\n\n<script>window.__conversationUnsafe = true</script>\n\n```echarts\nwindow.__conversationUnsafe = true\n```\n'}]},
      {id:'turn-b',conversationId:'origin-a',title:'比较方法',collapsed:false,messages:[{id:'user-b',role:'user',content:'把两种方法做成一个表格。'},{id:'assistant-b',role:'assistant',content:'| 方法 | 特点 |\n| --- | --- |\n| 直接计算 | 清晰 |\n| 缓存 | 更快 |\n\n查找关键词：火山。'}]},
      {id:'turn-c',conversationId:'origin-b',title:'整理结论',collapsed:false,messages:[{id:'user-c',role:'user',content:'最后归纳结论，并保留原始问答。'},{id:'assistant-c',role:'assistant',content:'1. 明确输入。\n2. 检查结果。\n3. 保存可编辑的笔记。\n\n'+('这是一段用于滚动定位的正文。\n\n'.repeat(12))}]}
    ],warnings:[]
  };
  await js(`window.__conversationFixture=${JSON.stringify(fixture)};window.__conversationUnsafe=false;window.__cyporaTest.setDocument(window.CyporaConversation.toMarkdown(window.__conversationFixture))`);
  await until('window.Conversations.active && document.querySelectorAll(".conversation-turn").length===3');
  await js('window.Conversations.previewReady');
  check('conversation view opens from saved Markdown',await js('document.body.classList.contains("conversation-mode")&&getComputedStyle(document.querySelector("#editor")).display==="none"'));
  check('conversation right rail represents user turns',await js('document.querySelectorAll(".conversation-rail-item").length===3&&document.querySelectorAll(".conversation-user").length===3'));
  check('conversation preview preserves table and inert fenced code',await js('Boolean(document.querySelector(".conversation-markdown table"))&&Boolean(document.querySelector("code[data-conversation-language=echarts]"))&&!window.__conversationUnsafe&&!document.querySelector(".conversation-markdown script")'),await js('({table:!!document.querySelector(".conversation-markdown table"),unsafe:window.__conversationUnsafe,html:document.querySelector(\'[data-message-id="assistant-a"] .conversation-markdown\').innerHTML})'));
  await until('Boolean(document.querySelector(".conversation-markdown mjx-container svg"))');
  check('conversation math uses local MathJax SVG and original source',await js('window.Conversations.toMarkdown().includes("\\\\frac{a}{b}")&&Boolean(document.querySelector(".conversation-markdown .language-math svg"))'));
  await js(`document.querySelector('.conversation-search input').value='火山';document.querySelector('.conversation-search input').dispatchEvent(new Event('input',{bubbles:true}))`);
  await js('window.Conversations.previewReady');
  check('conversation search filters and highlights',await js('document.querySelectorAll(".conversation-turn").length===1&&document.querySelector(".conversation-match")?.textContent==="火山"'));
  await js(`document.querySelector('.conversation-search input').value='';document.querySelector('.conversation-search input').dispatchEvent(new Event('input',{bubbles:true}));window.Conversations.toggle('turn-b')`);
  check('conversation fold persists without dropping messages',await js('window.CyporaConversation.fromMarkdown(window.Conversations.toMarkdown()).turns[1].collapsed===true&&document.querySelector(\'[data-turn-id="turn-b"] .conversation-collapsed-summary\')!==null&&window.Conversations.document.turns[1].messages.length===2'));
  await js(`(()=>{window.Conversations.toggle('turn-b');window.Conversations.beginEdit('assistant-b');const a=document.querySelector('.conversation-markdown-input');a.value+='\\n\\n新的离线编辑';a.dispatchEvent(new Event('input',{bubbles:true}));})();window.Conversations.flush()`);
  check('conversation typing immediately updates save source',await js('window.__cyporaTest.raw.includes("新的离线编辑")&&window.Conversations.toMarkdown().includes("新的离线编辑")'),await js('({ready:window.__cyporaTest.ready,raw:window.__cyporaTest.raw.includes("新的离线编辑"),doc:window.Conversations.toMarkdown().includes("新的离线编辑"),area:document.querySelector(".conversation-markdown-input")?.value})'));
  await js(`window.Conversations.finishEdit(false);window.Conversations.undo()`);
  check('conversation edit undo retains original Markdown',await js('!window.Conversations.toMarkdown().includes("新的离线编辑")&&window.Conversations.toMarkdown().includes("火山")'));
  await js('window.Conversations.redo()');
  check('conversation edit redo works',await js('window.Conversations.toMarkdown().includes("新的离线编辑")'));
  await js(`(()=>{const grip=document.querySelector('[data-turn-id="turn-c"] .conversation-grip');grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}));})();`);
  check('keyboard moves complete turn with messages',await js('window.Conversations.document.turns.map(t=>t.id).join(",")==="turn-a,turn-c,turn-b"&&window.Conversations.document.turns[1].messages[0].id==="user-c"'));
  await js(`(()=>{const source=document.querySelector('[data-turn-id="turn-a"] .conversation-grip'),target=document.querySelector('[data-turn-id="turn-b"]'),transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer,clientY:80}));const r=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:r.bottom-1}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:r.bottom-1}));})()`);
  check('drag handle reorders whole user-assistant turn',await js('window.Conversations.document.turns.map(t=>t.id).join(",")==="turn-c,turn-b,turn-a"'));
  await js(`window.Conversations.remove('turn-b')`);
  check('conversation delete removes only selected turn',await js('window.Conversations.document.turns.length===2&&!window.Conversations.document.turns.some(t=>t.id==="turn-b")'));
  await js('window.Conversations.undo()');
  check('conversation delete is reversible',await js('window.Conversations.document.turns.length===3&&window.Conversations.document.turns[1].messages[1].content.includes("新的离线编辑")'));
  await js(`document.querySelector('.conversation-text-button').click();for(const id of ['turn-c','turn-a']){const c=document.querySelector('[data-turn-id="'+id+'"] .conversation-select');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('.conversation-toolbar-actions [aria-label="合并选中对话"]').click();`);
  check('selected turn merge preserves all roles and content',await js('window.Conversations.document.turns.length===2&&window.Conversations.document.turns[0].messages.map(m=>m.role).join(",")==="user,assistant,user,assistant"&&window.Conversations.document.turns[0].messages[0].content.startsWith("最后归纳")'));
  await js('window.Conversations.undo();document.body.dataset.readonly="true"');
  await until('document.querySelector(".conversation-edit-button").disabled');
  const beforeReadonly=await js('window.Conversations.toMarkdown()');
  await js(`window.Conversations.remove('turn-a');window.Conversations.move('turn-b',0);window.Conversations.beginEdit('user-a')`);
  check('conversation read-only blocks mutations and edit controls',await js(`window.Conversations.toMarkdown()===${JSON.stringify(beforeReadonly)}&&!document.querySelector(".conversation-markdown-input")&&[...document.querySelectorAll(".conversation-turn-actions button")].every(b=>b.disabled)`));
  await js('document.body.dataset.readonly="false"');
  await until('!document.querySelector(".conversation-edit-button").disabled');
  await js(`window.Conversations.jump('turn-a',false);document.querySelector('.conversation-scroll').dispatchEvent(new Event('scroll'));`);
  await until('document.querySelector(\'.conversation-rail-item[data-turn-id="turn-a"]\').getAttribute("aria-current")==="true"');
  check('conversation rail tracks active scroll target',true);
  await js(`(()=>{const item=document.querySelector('.conversation-rail-item'),r=item.getBoundingClientRect();item.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientY:r.top+r.height/2}));})()`);
  check('conversation rail hover expands with neighbor falloff',await js('document.querySelectorAll(".conversation-rail-item")[0].style.getPropertyValue("--rail-progress")==="1"&&document.querySelectorAll(".conversation-rail-item")[1].style.getPropertyValue("--rail-progress")==="0.7"'));
  await js(`(()=>{window.Conversations.beginEdit('user-c');const a=document.querySelector('.conversation-markdown-input');a.value+=' 保存前文本';a.dispatchEvent(new Event('input',{bubbles:true}));window.__conversationExitSource=window.Conversations.close();})();`);
  check('conversation exit retains in-progress edits and Markdown',await js('window.__conversationExitSource.includes("保存前文本")&&!window.Conversations.active&&!document.body.classList.contains("conversation-mode")'));
  await js('window.Conversations.open(window.__conversationExitSource);window.Conversations.finishEdit(false);window.Conversations.previewReady');
  check('conversation serialized source reloads with edits',await js('window.Conversations.document.turns.flatMap(t=>t.messages).some(m=>m.content.includes("保存前文本"))'));
  // Pointer sorting uses capture instead of the operating system HTML drag loop.
  await js(`(()=>{const doc=JSON.parse(JSON.stringify(window.__conversationFixture));doc.turns.forEach(t=>t.collapsed=true);window.Conversations.open(doc);window.__pointerOrder=doc.turns.map(t=>t.id).join(',');window.__pointerStart=()=>{const handle=document.querySelector('.conversation-grip'),r=handle.getBoundingClientRect();handle.dispatchEvent(new PointerEvent('pointerdown',{pointerId:71,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));return {handle,x:r.left+r.width/2,y:r.top+r.height/2};};window.__pointerMove=(x,y)=>document.dispatchEvent(new PointerEvent('pointermove',{pointerId:71,pointerType:'mouse',isPrimary:true,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));window.__pointerEnd=(type,x,y)=>document.dispatchEvent(new PointerEvent(type,{pointerId:71,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));})()`);
  await js(`(()=>{const start=window.__pointerStart();window.__pointerMove(start.x+2,start.y+2);window.__pointerEnd('pointerup',start.x+2,start.y+2);})()`);
  check('pointer handle movement below threshold does not reorder',await js('window.Conversations.document.turns.map(t=>t.id).join(",")===window.__pointerOrder&&!document.querySelector(".conversation-pointer-sorting")'));
  await js(`(()=>{window.__pointerStart();const r=document.querySelectorAll('.conversation-turn')[1].getBoundingClientRect();window.__pointerMove(r.left+50,r.bottom-2);window.__pointerEnd('pointercancel',r.left+50,r.bottom-2);window.__pointerEnd('pointerup',r.left+50,r.bottom-2);})()`);
  check('pointercancel clears sorting without committing',await js('window.Conversations.document.turns.map(t=>t.id).join(",")===window.__pointerOrder&&!document.querySelector(".is-dragging,.drop-before,.drop-after,.conversation-pointer-sorting")'));
  await js(`(()=>{const start=window.__pointerStart(),r=document.querySelectorAll('.conversation-turn')[1].getBoundingClientRect();window.__pointerMove(r.left+50,r.bottom-2);start.handle.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));window.__pointerEnd('pointerup',r.left+50,r.bottom-2);})()`);
  check('Escape cancels pointer sorting without committing',await js('window.Conversations.document.turns.map(t=>t.id).join(",")===window.__pointerOrder&&!document.querySelector(".is-dragging,.drop-before,.drop-after,.conversation-pointer-sorting")'));
  await js(`(()=>{window.__pointerStart();const r=document.querySelectorAll('.conversation-turn')[1].getBoundingClientRect();window.__pointerMove(r.left+50,r.bottom-2);window.__pointerEnd('pointerup',r.left+50,r.bottom-2);})()`);
  check('pointer capture path reorders complete turn on release',await js('window.Conversations.document.turns.map(t=>t.id).join(",")==="turn-b,turn-a,turn-c"&&window.Conversations.document.turns[1].messages[1].id==="assistant-a"&&!document.querySelector(".is-dragging,.drop-before,.drop-after,.conversation-pointer-sorting")'));
  await js(`window.Conversations.open(window.__conversationFixture);window.Conversations.previewReady`);
  await js(`(()=>{window.__pointerStart();const r=document.querySelector('.conversation-scroll').getBoundingClientRect();window.__pointerMove(r.left+r.width/2,r.bottom-5);})()`);
  await new Promise(resolve=>setTimeout(resolve,220));
  const autoScrolled=await js('document.querySelector(".conversation-scroll").scrollTop');
  await js(`window.__pointerEnd('pointercancel',0,0)`);
  check('pointer sorting edge autoscrolls and cancel retains order',autoScrolled>0&&await js('window.Conversations.document.turns.map(t=>t.id).join(",")==="turn-a,turn-b,turn-c"&&!document.querySelector(".conversation-pointer-sorting")'),{scrollTop:autoScrolled});
  await js(`document.body.dataset.readonly='true'`);
  await until('document.querySelector(".conversation-grip").disabled');
  await js(`(()=>{const start=window.__pointerStart();window.__pointerMove(start.x+70,start.y+70);window.__pointerEnd('pointerup',start.x+70,start.y+70);})()`);
  check('read-only pointer sorting cannot begin',await js('window.Conversations.document.turns.map(t=>t.id).join(",")==="turn-a,turn-b,turn-c"&&!document.querySelector(".conversation-pointer-sorting")'));
  await js(`document.body.dataset.readonly='false';document.querySelector('.conversation-search input').value='代码';document.querySelector('.conversation-search input').dispatchEvent(new Event('input',{bubbles:true}));`);
  await js(`(()=>{const start=window.__pointerStart();window.__pointerMove(start.x+70,start.y+70);window.__pointerEnd('pointerup',start.x+70,start.y+70);})()`);
  check('search-filtered pointer sorting cannot begin',await js('window.Conversations.document.turns.map(t=>t.id).join(",")==="turn-a,turn-b,turn-c"&&!document.querySelector(".conversation-pointer-sorting")'));
  await js(`document.querySelector('.conversation-search input').value='';document.querySelector('.conversation-search input').dispatchEvent(new Event('input',{bubbles:true}));window.Conversations.previewReady`);
  if(fs&&path&&win){const out=path.join(__dirname,'..','verification','20261020-conversations');await fs.mkdir(out,{recursive:true});const image=await win.webContents.capturePage();await fs.writeFile(path.join(out,'conversation-ui.png'),image.toPNG());}
  // Import uses fake local records; no private conversation is opened by this regression.
  await js(`window.__conversationImported=null;window.Conversations.init({listLocal:async()=>({items:[{id:'fake-local',title:'本机导入回归',updatedAt:'2026-10-20T00:00:00Z'}]}),readLocal:async()=>({text:window.CyporaConversation.toMarkdown(window.__conversationFixture),filename:'fake.md'}),onImport:async doc=>{window.__conversationImported=doc;return false;}});window.Conversations.showImport()`);
  await until('document.querySelectorAll(".conversation-local-item").length===1');
  await js(`(()=>{const c=document.querySelector('.conversation-local-item input');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#conversation-import-submit').click();})()`);
  await until('Boolean(window.__conversationImported)');
  check('local conversation import parses selected record and respects canceled guard',await js('window.__conversationImported.turns.length===3&&document.querySelector("#conversation-import-dialog").open'));
  await js(`document.querySelector("#conversation-import-dialog").close();window.Conversations.init({listLocal:async()=>({items:Array.from({length:21},(_,i)=>({id:'limit-'+i,title:'对话 '+i}))})});window.Conversations.showImport()`);
  await until('document.querySelectorAll(".conversation-local-item").length===21');
  await js(`for(const item of document.querySelectorAll('.conversation-local-item input')){item.checked=true;item.dispatchEvent(new Event('change',{bubbles:true}));}`);
  check('local import selection is bounded to 20 conversations',await js('document.querySelectorAll(".conversation-local-item input:checked").length===20&&document.querySelector("#conversation-import-error").textContent.includes("20")'));
  await js(`document.querySelector("#conversation-import-dialog").close();window.__conversationImported=null;window.__pendingConversationReadResolve=null;window.Conversations.init({listLocal:async()=>({items:[{id:'pending-local',title:'等待读取'}]}),readLocal:()=>new Promise(resolve=>window.__pendingConversationReadResolve=resolve)});window.Conversations.showImport()`);
  await until('document.querySelectorAll(".conversation-local-item").length===1');
  await js(`(()=>{const c=document.querySelector('.conversation-local-item input');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#conversation-import-submit').click();})()`);
  await until('typeof window.__pendingConversationReadResolve==="function"');
  await js(`document.querySelector("#conversation-import-dialog").close();window.__pendingConversationReadResolve({text:CyporaConversation.toMarkdown(window.__conversationFixture),filename:'late.md'})`);
  await new Promise(resolve=>setTimeout(resolve,60));
  check('closing import discards asynchronous read result',await js('window.__conversationImported===null&&!document.querySelector("#conversation-import-dialog").open'));
  await js('window.Conversations.close()');
};
