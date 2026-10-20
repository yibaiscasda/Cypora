// Behavioral regression tests for the user's reported editor and sidebar failures.
module.exports=async({js,check,until,fs,path,library,app,win})=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const set=async(text,mode='ir')=>{await js(`window.__cyporaTest.setDocument(${JSON.stringify(text)});`);await js(`window.__cyporaTest.run('mode',${JSON.stringify(mode)})`);await wait(350);};
  const focus=async(selector,start=0,end=start)=>js(`(()=>{const el=window.__cyporaTest.editor.vditor[window.__cyporaTest.mode].element,n=el.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing target '+${JSON.stringify(selector)});el.focus();const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t=w.nextNode();if(!t){t=n.appendChild(document.createTextNode(''));}const r=document.createRange();r.setStart(t,Math.min(t.length,${start}));r.setEnd(t,Math.min(t.length,${end}));const s=getSelection();s.removeAllRanges();s.addRange(r);window.EditorTools.remember();})()`);
  const command=async id=>{await js(`window.EditorTools.execute(${JSON.stringify(id)})`);await wait(400);};
  const value=()=>js('window.__cyporaTest.editor.getValue()');
  const outlineFixture='\ufeff# 标题一\r\n\r\n## 子标题\r\n\r\n```md\r\n# 不是标题\r\n```\r\n\r\nSetext 标题\r\n==========\r\n\r\n### 第三层\r\n';
  await set(outlineFixture);await until('document.querySelectorAll("#outline .outline-item").length===4');
  check('CRLF BOM and Setext outline',await js('window.EditorTools.items.map(i=>i.text).join("|")==="标题一|子标题|Setext 标题|第三层"'));
  await js(`document.querySelectorAll('#outline .outline-item')[1].click()`);
  check('outline click selects heading',await js('((getSelection().anchorNode.nodeType===3?getSelection().anchorNode.parentElement:getSelection().anchorNode).closest("h2"))?.textContent.includes("子标题")'),await js('({mode:window.__cyporaTest.mode,selection:getSelection().anchorNode?.outerHTML||getSelection().anchorNode?.textContent,html:window.__cyporaTest.editor.vditor.ir.element.innerHTML})'));
  await js(`document.querySelector('#outline .outline-fold').click()`);
  check('outline collapse hides child only',await js('document.querySelectorAll("#outline .outline-item").length===3'));
  await js(`window.__cyporaTest.run('outline-expand')`);
  check('outline expands all',await js('document.querySelectorAll("#outline .outline-item").length===4'));
  // Read the real report only; never open it through the library/autosave bridge.
  const report=process.env.CYPORA_REGRESSION_DOCUMENT;
  if(report&&await fs.stat(report).catch(()=>null)){const text=await fs.readFile(report,'utf8');await set(text);check('optional document outline populated',await js('window.EditorTools.items.length>20&&document.querySelectorAll("#outline .outline-item").length>20'));}
  for(const mode of ['ir','wysiwyg','sv']){
    const text='前段内容\n\n待转换的同一行\n\n后段保持原样\n';
    await set(text,mode);await focus(mode==='sv'?'[data-block="0"]':'p:nth-of-type(2)',0);
    if(mode==='sv')await js(`(()=>{const el=window.__cyporaTest.editor.vditor.sv.element,w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const i=n.textContent.indexOf('待转换');if(i>=0){const r=document.createRange();r.setStart(n,i+2);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);break;}}window.EditorTools.remember();})()`);
    await command('h1');let result=await value();check('heading transforms current paragraph '+mode,result.includes('# 待转换的同一行')&&result.includes('前段内容')&&result.includes('后段保持原样')&&!result.includes('标题'),result);
    await command('undo');result=await value();check('heading undo '+mode,!result.includes('# 待转换')&&result.includes('待转换的同一行'),result);
    await command('redo');result=await value();check('heading redo '+mode,result.includes('# 待转换的同一行'),result);
    await set('中文选择格式测试\n\n另一段\n',mode);await focus(mode==='sv'?'[data-block="0"]':'p',2,4);await command('bold');result=await value();check('bold wraps selection '+mode,result.includes('中文**选择**格式测试')&&result.includes('另一段'),result);
  }
  await set('第一段\n\n第二段\n');await focus('p',1);await command('quote');check('quote converts paragraph',/^> 第一段/m.test(await value()),await value());
  await set('第一段\n\n第二段\n');await focus('p',1);await command('list');check('list converts paragraph',/^[-*] 第一段/m.test(await value()),await value());
  await set('公式内容\n\n下一段\n');await focus('p',2);await command('math');check('math block uses current content',(await value()).startsWith('$$\n公式内容\n$$')&&!(await value()).includes('E = mc'),await value());
  await set('代码内容\n\n下一段\n');await focus('p',2);await command('code');check('code block uses current content',(await value()).startsWith('```\n代码内容\n```'),await value());
  await set('中文选择格式测试\n');await focus('p',2,4);await command('underline');check('underline preserves selection',(await value()).includes('<u>选择</u>'),await value());
  await set('| A | B |\n| --- | --- |\n| C | D |\n\n下一段\n');await focus('td',0);await command('table-column-after');check('table column insertion preserves cells',await js('document.querySelectorAll("#editor .vditor-ir table tr")[1].cells.length===3'),await value());
  await focus('td',0);await command('table-row-after');check('table row insertion',await js('document.querySelector("#editor .vditor-ir table").rows.length===3'),await value());
  await focus('td',0);await command('table-align-center');check('table alignment serialized',/:-+:/.test(await value())&&(await value()).trim().startsWith('| A'),await value());
  await focus('td',0);await command('table-delete-column');check('table column deletion',await js('document.querySelector("#editor .vditor-ir table").rows[0].cells.length===2'),await value());
  for(const mode of ['ir','wysiwyg','sv']){
    await set('段落一\n\n段落二\n',mode);await focus(mode==='sv'?'[data-block="0"]':'p',1);await command('quote');check('quote keeps current position '+mode,(await value()).startsWith('> 段落一'),await value());
    await set('段落一\n\n段落二\n',mode);await focus(mode==='sv'?'[data-block="0"]':'p',1);await command('code');check('code keeps current position '+mode,(await value()).startsWith('```\n段落一\n```'),await value());
    await set('段落一\n\n段落二\n',mode);await focus(mode==='sv'?'[data-block="0"]':'p',1);await command('yaml');check('YAML inserts at top '+mode,(await value()).startsWith('---\n')&&(await value()).includes('段落二'),await value());
  }
  await set('任务文字\n\n保留段落\n');await focus('p',1);await command('check');await focus('li',0);await command('task-complete');check('complete task retains neighbors',(await value())[0]===(await js('settings.unorderedListMarker'))&&/^[-*+] \[[xX]\] +任务文字\n/.test(await value())&&(await value()).includes('保留段落'),await value());
  await set('警报内容\n\n保留段落\n');await focus('p',1);await command('alert-warning');check('warning wraps paragraph in place',(await value()).startsWith('> [!WARNING]\n> 警报内容')&&(await value()).includes('保留段落'),await value());
  await set('第一段\n\n## 标题内容\n\n下一段\n');await focus('h2',0);await command('paragraph');check('heading to paragraph preserves order',!/^## /m.test(await value())&&/第一段\n\n标题内容\n\n下一段/.test(await value()),await value());
  await js(`window.__cyporaTest.run('editor-preferences')`);check('editor preferences integrated',await js('!document.querySelector("[data-settings-pane=editor]").hidden&&Boolean(document.querySelector("#pref-outline-depth"))&&Boolean(document.querySelector("#pref-line-ending"))'));
  await js(`window.PreferencesUI.savePatch({outlineDepth:2,outlineFlat:true,outlineHighlight:true,spellcheck:true,lineEnding:'crlf',finalNewline:true,equationNumbering:'none'})`);
  let stored=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8'));check('editor settings persist',stored.outlineDepth===2&&stored.outlineFlat&&stored.lineEnding==='crlf'&&stored.equationNumbering==='none',stored.equationNumbering);
  await js(`document.querySelector('#preferences').close();window.PreferencesUI.savePatch({outlineDepth:6,outlineFlat:false,spellcheck:false,lineEnding:'preserve',finalNewline:false,equationNumbering:'all'})`);
  check('top menus exposed',await js('["段落","格式","视图","主题"].every(label=>[...document.querySelectorAll("[data-menu]")].some(b=>b.dataset.menu===label))'));
  for(const mode of ['ir','wysiwyg','sv']){await set('正文右键\n\n```js\nconst n=1;\n```\n',mode);check('plain context is not code '+mode,await js(`!window.EditorTools.contextFor(window.__cyporaTest.editor.vditor[${JSON.stringify(mode)}].element.querySelector(${JSON.stringify(mode==='sv'?'[data-block="0"]':'p')})).code`));if(mode!=='sv')check('code context recognized '+mode,await js(`window.EditorTools.contextFor(window.__cyporaTest.editor.vditor[${JSON.stringify(mode)}].element.querySelector('code')).code`));}
  await set('# 排列测试\n');const root=path.join(__dirname,'..','verification','排列测试');await fs.mkdir(root,{recursive:true});const project=await library.addProject(root);for(const name of ['顺序甲.md','顺序乙.md','顺序丙.md'])await fs.writeFile(path.join(root,name),'# '+name+'\n');await library.scan(project);await js('window.Workspace.refreshLibrary()');
  const docs=library.state.documents.filter(d=>d.projectId===project.id).sort((a,b)=>a.order-b.order),[a,b,c]=docs;
  await js(`(async()=>{await window.cypora.call('library-reorder','documents',${JSON.stringify(a.id)},${JSON.stringify(c.id)},true);await window.Workspace.refreshLibrary();})()`);
  const ids=()=>js(`[...document.querySelectorAll('.project-row[data-project="${project.id}"]+.project-children .document-row')].map(n=>n.dataset.id)`);
  const order=await ids();await js(`window.__cyporaTest.run('open',${JSON.stringify(b.path)})`);check('opening file does not reorder or pin',JSON.stringify(await ids())===JSON.stringify(order)&&!library.get(b.id).pinned,{before:order,after:await ids()});
  await js(`(()=>{const row=id=>document.querySelector('.project-row[data-project="${project.id}"]+.project-children .document-row[data-id="'+id+'"]'),dt=new DataTransfer();row('${a.id}').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));row('${b.id}').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
  await until(`document.querySelector('.project-row[data-project="${project.id}"]+.project-children .document-row')?.dataset.id==='${a.id}'`);
  check('sidebar drop handler reorders rows',(await ids())[0]===a.id);
  // Restore the expected order through the same persisted command after the UI drop.
  await js(`(async()=>{await window.cypora.call('library-reorder','documents',${JSON.stringify(a.id)},${JSON.stringify(c.id)},true);await window.Workspace.refreshLibrary();})()`);
  await js(`(async()=>{await window.cypora.call('document-update',${JSON.stringify(a.id)},{pinned:true});await window.cypora.call('document-update',${JSON.stringify(b.id)},{pinned:true});await window.Workspace.refreshLibrary();})()`);
  await js(`(async()=>{await window.cypora.call('library-reorder','pinned',${JSON.stringify(a.id)},${JSON.stringify(b.id)},false);await window.Workspace.refreshLibrary();})()`);
  check('explicit pin order independent of visits',await js(`[...document.querySelectorAll('#pinned-list .document-row')].findIndex(n=>n.dataset.id==='${a.id}')<[...document.querySelectorAll('#pinned-list .document-row')].findIndex(n=>n.dataset.id==='${b.id}')`));
  stored=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8'));const {Library}=require('../library.cjs'),restored=new Library({state:stored,persist:async()=>{},allowed:new Set(),home:root});check('manual order persists across model restart',restored.get(a.id).order>restored.get(c.id).order&&restored.get(a.id).pinOrder<restored.get(b.id).pinOrder,{a:restored.get(a.id),b:restored.get(b.id),c:restored.get(c.id),live:[a,b,c]});
  await js(`(async()=>{await window.cypora.call('document-update',${JSON.stringify(a.id)},{pinned:false});await window.cypora.call('document-update',${JSON.stringify(b.id)},{pinned:false});await window.Workspace.refreshLibrary();})()`);
};
