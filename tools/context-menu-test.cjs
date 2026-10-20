// Hidden Electron renderer, preload, IPC, native Menu construction and file writes.
// Never show popup menus or a test window: these checks must not interrupt users.
// Clipboard/shell/file dialogs are stubbed to avoid altering the user's clipboard or launching apps.
const path=require('path'),fs=require('fs'),{app,Menu,clipboard,dialog,shell,nativeImage}=require('electron');
const source=path.resolve(__dirname,'..'),out=path.join(source,'verification','20261020-context-menu','run-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});app.setAppPath(source);const setPath=app.setPath.bind(app);app.setPath=(key,value)=>setPath(key,key==='userData'?path.join(out,'profile'):value);process.argv.push('--self-test');
const test=path.join(source,'tools/self-test.cjs');
require.cache[test]={id:test,filename:test,loaded:true,exports:async({win,allowed,library})=>{
 const result={out,started:new Date().toISOString(),checks:[],errors:[],menus:[],mocks:['clipboard writes','OS shell open/reveal','save dialog','text dialog answers','native menu popup'],notPerformed:['visible native menus','Typora native UI clicks','Word external paste','remote image servers']};
 const js=code=>win.webContents.executeJavaScript(code,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(name,passed,detail)=>{result.checks.push({name,passed:!!passed,detail});if(!passed)throw Error(name+': '+JSON.stringify(detail));};
 const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await wait(80);}throw Error('Timeout '+code);};
 let lastMenu,clip='',rich=null,picture=null,location=null,savePath=path.join(out,'saved.png');
 clipboard.writeText=text=>clip=text;clipboard.write=data=>rich=data;clipboard.writeImage=image=>picture=image;
 shell.showItemInFolder=p=>location={kind:'reveal',path:p};shell.openPath=async p=>{location={kind:'open',path:p};return '';};
 dialog.showSaveDialog=async()=>({canceled:false,filePath:savePath});dialog.showMessageBox=async()=>({response:0});
 const originalPopup=Menu.prototype.popup;
 Menu.prototype.popup=function(){lastMenu=this;result.menus.push(this.items.map(i=>({id:i.id,label:i.label,enabled:i.enabled,type:i.type,checked:i.checked})));result.popupSuppressed=true;};
 win.webContents.on('console-message',e=>{if(e.level==='error')result.errors.push(e.message);});
 const raw=()=>js('__cyporaTest.editor.getValue()');
 const set=async(text,mode='ir')=>{await js(`(async()=>{document.body.dataset.readonly='false';await __cyporaTest.setDocument(${JSON.stringify(text)},${JSON.stringify(path.join(out,'fixture.md'))},${JSON.stringify(require('url').pathToFileURL(out+path.sep).href)});await __cyporaTest.run('mode',${JSON.stringify(mode)})})()`);await wait(300);};
 const focus=async selector=>js(`(()=>{const s=__cyporaTest.editor.vditor[__cyporaTest.mode].element,n=[...s.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.getBoundingClientRect().height>0)||(${JSON.stringify(selector)}==='img'?s.querySelector('[data-type="html-inline"],[data-type="html-block"]'):null);if(!n)throw Error('Missing '+${JSON.stringify(selector)});s.focus();const r=document.createRange();r.selectNodeContents(n);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);EditorTools.remember();})()`);
 const context=async(selector,native=false)=>{
  const point=await js(`(()=>{const s=__cyporaTest.editor.vditor[__cyporaTest.mode].element,n=[...s.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.getBoundingClientRect().height>0)||(${JSON.stringify(selector)}==='img'?s.querySelector('[data-type="html-inline"],[data-type="html-block"]'):null);if(!n)throw Error('Missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();const p={x:Math.round(r.x+Math.min(r.width/2,10)),y:Math.round(r.y+r.height/2)};${native?'':`n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y}));`}return p;})()`);
  if(native){for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'right',clickCount:1,...point});}
  await wait(240);
 };
 const command=async id=>{await js(`(async()=>{try{await EditorTools.execute(${JSON.stringify(id)});}catch(e){throw Error(e.name+': '+e.message)}})()`);await wait(220);};
 const answer=async value=>js(`window.Workspace.inputDialog=async()=>({value:${JSON.stringify(value)}});void 0`);
 try{
  await until('Boolean(window.__cyporaTest?.ready&&window.CodeBlocks)');win.hide();win.setSize(1280,900);win.webContents.setBackgroundThrottling(false);
  await js("window.PreferencesUI.savePatch({autoSave:false,reduceMotion:'on',codeLineNumbers:true,codeWordWrap:true,appearanceMode:'light'})");
  const png=nativeImage.createFromBitmap(Buffer.alloc(32*24*4,180),{width:32,height:24}).toPNG();
  const imgPath=path.join(out,'test image #1.png');fs.writeFileSync(imgPath,png);const doc=path.join(out,'fixture.md');fs.writeFileSync(doc,'# fixture\n');allowed.add(doc);await js(`__cyporaTest.run('open',${JSON.stringify(doc)})`);
  const imageMD='before ![示例](<test image %231.png> "原标题") after\n\nuntouched\n';
  for(const mode of ['ir','wysiwyg']){
   await set('first\n\n```javascript\nconst x = 1;\nconsole.log(x);\n```\n\nlast\n',mode);await until('CodeBlocks.blocks.length===1');
   await context('[data-type="code-block"] code',true);check('code context builds native Menu without popup '+mode,result.popupSuppressed&&lastMenu.getMenuItemById('code-language')&&lastMenu.getMenuItemById('code-copy'));
   lastMenu.getMenuItemById('code-copy').click();await wait(200);check('code copy excludes language and line numbers '+mode,clip==='const x = 1;\nconsole.log(x);\n',clip);
   await context('[data-type="code-block"]');await command('code-lines');check('line-number preference toggled '+mode,await js('settings.codeLineNumbers===false'));await command('code-lines');
   const before=await raw();await command('code-wrap');check('wrap preference does not change content '+mode,(await raw())===before);await command('code-wrap');
   await context('[data-type="code-block"]');await command('code-language');check('language popup opens '+mode,await js('!!document.querySelector(".code-language-picker")'));
   await js("document.querySelector('.code-language-options button[data-language=python]')?.click()");
   // Picker uses value in closure, so select its visible Python button.
   await js("[...document.querySelectorAll('.code-language-options button')].find(b=>b.textContent==='Python')?.click()");await wait(150);check('language selection changes fence '+mode,(await raw()).includes('```python'),await raw());
   await context('[data-type="code-block"] code');await command('code-indent');check('context indent changes authored code '+mode,/\n    (?:const x|console\.log)/.test(await raw()),await raw());await command('undo');check('context indentation undo '+mode,(await raw()).includes('\nconst x = 1;\n'),await raw());
   await context('[data-type="code-block"]');await js("document.body.dataset.readonly='true'");await command('code-copy');check('readonly code can copy '+mode,clip.includes('const x'));
   const frozen=await raw();await context('[data-type="code-block"]');check('readonly code deletion disabled in native menu '+mode,lastMenu.getMenuItemById('code-delete').enabled===false);await command('code-delete');check('readonly code cannot delete '+mode,(await raw())===frozen);await js("document.body.dataset.readonly='false'");
   await set('before [**link**](https://example.org/old "title") after\n\nuntouched\n',mode);const link=mode==='ir'?'[data-type="a"]':'a';
   await context(link);await answer('https://example.org/new?q=1&b=2');await command('link-edit');check('link edit preserves text and neighbors '+mode,(await raw()).includes('**link**')&&(await raw()).includes('/new?q=1&b=2')&&(await raw()).includes('before')&&(await raw()).includes('untouched'),await raw());
   await context(link);await command('link-remove');check('unlink preserves emphasis '+mode,!(await raw()).includes('https:')&&(await raw()).includes('**link**'),await raw());await command('undo');check('unlink can undo '+mode,(await raw()).includes('https:'),await raw());
   await set(imageMD,mode);await context('img');await command('image-copy-content');check('image clipboard receives pixels '+mode,picture&&!picture.isEmpty()&&picture.getSize().width===32,picture?.getSize());
   await context('img');await command('image-save');check('image save writes PNG '+mode,fs.existsSync(savePath)&&nativeImage.createFromPath(savePath).getSize().height===24);
   await context('img');await command('image-reveal');check('reveal resolves document-relative encoded path '+mode,location?.kind==='reveal'&&location.path===imgPath,location);
   await context('img');await command('image-open');check('open resolves local image '+mode,location?.kind==='open'&&location.path===imgPath,location);
   await context('img');await answer('新标题');await command('image-title');check('image title edits retain neighboring text '+mode,(await raw()).includes('新标题')&&(await raw()).includes('before')&&(await raw()).includes(' after'),await raw());
   await context('img');await answer('64');await command('image-resize');check('image resize writes width '+mode,(await raw()).includes('width="64"')&&(await raw()).includes('before'),await raw());
   await context('img');await answer('auto');await command('image-resize');check('image original size removes width '+mode,!(await raw()).includes('width='),await raw());
   await context('img');await command('image-syntax');check('HTML image converts to Markdown '+mode,(await raw()).includes('![示例]')&&(await raw()).includes('新标题'),await raw());
   await context('img');await command('image-syntax');check('Markdown image converts to HTML '+mode,(await raw()).includes('<img')&&(await raw()).includes(' after'),await raw());
   await context('img');check('HTML image has local location menu '+mode,lastMenu.getMenuItemById('image-reveal')?.enabled===true);await command('image-reveal');check('HTML local image reveal resolves correctly '+mode,location?.path===imgPath,location);
   await set('$$\nx^2 + y^2\n$$\n\nuntouched\n',mode);await context('[data-type="math-block"]');await command('math-copy');check('math copy is LaTex only '+mode,clip.trim()==='x^2 + y^2',clip);
   await set('| A | B |\n| --- | --- |\n| C | D |\n\nuntouched\n',mode);await context('td');await js("document.body.dataset.readonly='true'");await command('table-copy');check('readonly table copy works '+mode,clip.includes('| A')&&clip.includes('| C'),clip);await js("document.body.dataset.readonly='false'");
   await context('td');await command('table-prettify');check('table prettify preserves all cells '+mode,await js(`__cyporaTest.editor.vditor[__cyporaTest.mode].element.querySelector('table').textContent.replace(/\\s/g,'')==='ABCD'`));
   await set('**bold** and [link](https://example.org)\n',mode);await focus('p');await command('select-all');await command('copy-clean');check('clean rich clipboard has semantic HTML '+mode,rich?.html.includes('<strong>bold</strong>')&&!/data-|style=|vditor/.test(rich.html)&&rich.text.includes('bold'),rich);
  }
  await set('first paragraph\n\nsecond paragraph\n');await focus('p');await context('p:nth-of-type(2)',true);await command('h2');check('right click edits clicked paragraph rather than stale caret',(await raw()).includes('first paragraph\n\n## second paragraph'),await raw());
  await set('selection remains here\n');await js("(()=>{const el=__cyporaTest.editor.vditor.ir.element,p=el.querySelector('p'),n=p.firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,9);el.focus();getSelection().removeAllRanges();getSelection().addRange(r);EditorTools.remember()})()");await context('p',true);check('right click preserves selected text',await js("getSelection().toString()==='selection'"),await js('getSelection().toString()'));
  await set('```js\nconst x=1;\n```\n\nlast\n');await context('[data-type="code-block"]');await command('insert-after');await js("document.execCommand('insertText',false,'new paragraph');__cyporaTest.changed(__cyporaTest.editor.getValue())");check('insert after code targets surrounding paragraph',(await raw()).includes('```\n\nnew paragraph\n\nlast'),await raw());
  const grid='| A | B | C |\n| --- | --- | --- |\n| D | E | F |\n| G | H | I |\n\nneighbor\n';
  for(const mode of ['ir','wysiwyg'])for(const [id,target,expected] of [
    ['table-row-before','tbody tr:nth-child(2) td:nth-child(2)',[['A','B','C'],['D','E','F'],['','',''],['G','H','I']]],
    ['table-row-after','td',[['A','B','C'],['D','E','F'],['','',''],['G','H','I']]],
    ['table-column-before','td:nth-child(2)',[['A','','B','C'],['D','','E','F'],['G','','H','I']]],
    ['table-column-after','td:nth-child(2)',[['A','B','','C'],['D','E','','F'],['G','H','','I']]],
    ['table-row-up','tbody tr:nth-child(2) td',[['A','B','C'],['G','H','I'],['D','E','F']]],
    ['table-row-down','td',[['A','B','C'],['G','H','I'],['D','E','F']]],
    ['table-column-left','td:nth-child(2)',[['B','A','C'],['E','D','F'],['H','G','I']]],
    ['table-column-right','td:nth-child(2)',[['A','C','B'],['D','F','E'],['G','I','H']]],
    ['table-delete-row','td',[['A','B','C'],['G','H','I']]],
    ['table-delete-column','td:nth-child(2)',[['A','C'],['D','F'],['G','I']]]
  ]){
    await set(grid,mode);const before=await raw();await context(target);await command(id);
    const cells=await js("[...__cyporaTest.editor.vditor[__cyporaTest.mode].element.querySelector('table').rows].map(r=>[...r.cells].map(c=>c.textContent.trim()))");
    check(id+' preserves cells '+mode,JSON.stringify(cells)===JSON.stringify(expected)&&(await raw()).includes('neighbor'),cells);
    await command('undo');check(id+' undo '+mode,(await raw())===before,await raw());
  }
  await set('first\n\n```js\nconst source = 1;\n```\n\nlast\n','sv');await until('CodeBlocks.blocks.length===1');
  await js("(()=>{const s=__cyporaTest.editor.vditor.sv.element,w=document.createTreeWalker(s,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode())if(n.textContent.includes('const source')){const r=document.createRange();r.setStart(n,n.textContent.indexOf('const source')+2);r.collapse(true);s.focus();getSelection().removeAllRanges();getSelection().addRange(r);EditorTools.remember();break;}})()");
  check('source-mode code context recognized',await js('EditorTools.contextFor(getSelection().anchorNode).code'));
  await command('code-copy');check('source-mode code copied',clip==='const source = 1;\n',clip);
  const sourceBefore=await raw();await command('code-delete');check('source-mode delete preserves neighbors',(await raw()).includes('first')&&(await raw()).includes('last')&&!(await raw()).includes('const source'),await raw());await command('undo');check('source-mode delete undo',(await raw())===sourceBefore,await raw());
  await set('body ![same](test%20image%20%231.png)\n');const document=library.get(library.state.documents.find(d=>d.path===doc).id);fs.writeFileSync(doc,await raw());const bytes=fs.readFileSync(doc);
  const firstCopy=await js('cypora.call("duplicate-document",'+JSON.stringify(document.id)+')');
  const secondCopy=await js('cypora.call("duplicate-document",'+JSON.stringify(document.id)+')');
  check('duplicate copies bytes without overwriting source',fs.readFileSync(firstCopy.path).equals(bytes)&&fs.readFileSync(doc).equals(bytes));
  check('duplicate collision produces a separate name',firstCopy.path!==secondCopy.path&&fs.readFileSync(secondCopy.path).equals(bytes));
  check('duplicate retains relative image location',path.dirname(firstCopy.path)===path.dirname(doc)&&firstCopy.attachmentFolders.includes('fixture.assets'));
  await js('cypora.call("copy-document-path",'+JSON.stringify(document.id)+')');check('document path clipboard',clip===doc,clip);
  const properties=await js('cypora.call("document-properties",'+JSON.stringify(document.id)+')');check('document properties use actual disk stat',properties.path===doc&&properties.size===bytes.length&&!!properties.modified,properties);
  await js('Workspace.refreshLibrary()');await js('document.querySelector(\'.document-row[data-id="'+document.id+'"]\').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:120,clientY:170}))');
  check('sidebar exposes duplicate path and properties',await js('["创建副本","复制文件路径","属性"].every(label=>[...document.querySelectorAll("button")].some(b=>b.textContent===label))'));
  await js('cypora.call("open-file",'+JSON.stringify(doc)+')');
  await set('before ![示例](test%20image%20%231.png)\n\nend\n');await context('img');await answer('72');await command('image-resize');
  const saveValue=await raw();await js('cypora.call("save-file",__cyporaTest.editor.getValue(),false,false)');
  check('image context edit saved to real Markdown file',fs.readFileSync(doc,'utf8')===saveValue&&saveValue.includes('width="72"'));
  await set(fs.readFileSync(doc,'utf8'),'wysiwyg');check('image context edit reopens with preserved text',(await raw()).includes('width="72"')&&(await raw()).includes('before')&&(await raw()).includes('end'),await raw());
  check('tests keep window hidden and native popup suppressed',!win.isVisible()&&result.popupSuppressed);
  await fs.promises.writeFile(path.join(out,'editor.png'),(await win.webContents.capturePage()).toPNG());
  check('no JS runtime errors',!result.errors.some(e=>/TypeError|ReferenceError|Uncaught/.test(e)),result.errors);
 }catch(error){result.error=error.stack;await fs.promises.writeFile(path.join(out,'failed.png'),(await win.webContents.capturePage()).toPNG());result.imageInfo=await js('[...document.images].map(i=>({src:i.src,width:i.naturalWidth,complete:i.complete}))');result.dom=await js('__cyporaTest.editor.vditor[__cyporaTest.mode].element.innerHTML').catch(()=>null);}
 result.passed=!result.error&&result.checks.every(c=>c.passed);result.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(source,'verification/20261020-context-menu/results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,error:result.error,out}));Menu.prototype.popup=originalPopup;app.exit(result.passed?0:1);
}};require(path.join(source,'main.cjs'));

