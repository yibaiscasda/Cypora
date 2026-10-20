// Isolated real Vditor renderer checks. No user profile or document is opened.
module.exports=async({js,check,until})=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const value=()=>js('window.__cyporaTest.editor.getValue()');
  const set=async(text,mode)=>{await js(`window.__cyporaTest.setDocument(${JSON.stringify(text)},${JSON.stringify(mode)})`);await wait(350);};
  const focusText=async(text,endText)=>js(`(()=>{
    const el=activeSurface(),w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,first,last;
    while(n=w.nextNode()){if(n.parentElement?.closest('.vditor-ir__preview,.vditor-wysiwyg__preview'))continue;if(!first&&n.textContent.includes(${JSON.stringify(text)}))first=n;if(n.textContent.includes(${JSON.stringify(endText||text)}))last=n;}
    if(!first||!last)throw Error('Selection text missing');
    const r=document.createRange();r.setStart(first,first.textContent.indexOf(${JSON.stringify(text)}));
    if(${!!endText})r.setEnd(last,last.textContent.indexOf(${JSON.stringify(endText||text)})+${(endText||text).length});else r.collapse(true);
    el.focus();getSelection().removeAllRanges();getSelection().addRange(r);window.EditorTools.remember();
  })()`);
  const command=async id=>{await js(`window.EditorTools.execute(${JSON.stringify(id)})`);await wait(400);};
  for(const mode of ['ir','wysiwyg','sv']){
    await set('保留段落\n\nHeading content\n\n尾段 $x_{i}^{2}$。\n',mode);
    const untouched=await value();
    await js('settings.headingStyle="setext";settings.unorderedListMarker="+";settings.orderedListStyle="repeat";settings.codeIndentSize=2;settings.tabSize=4;settings.indentWithTabs=false;window.EditorTools.apply()');
    check('preference apply never rewrites Markdown '+mode,(await value())===untouched);
    await focusText('Heading content');await command('h1');
    check('Setext heading in place '+mode,/Heading content\n=+\n/.test(await value())&&(await value()).includes('尾段 $x_{i}^{2}$。'),await value());
    await command('undo');check('heading style undo '+mode,!/Heading content\n=+\n/.test(await value())&&(await value()).includes('Heading content'),await value());
    await command('redo');check('heading style redo '+mode,/Heading content\n=+\n/.test(await value()),await value());
    await focusText('Heading content');await command('h3');
    check('Setext preference keeps H3 ATX '+mode,(await value()).includes('### Heading content')&&!/\n={3,}/.test(await value()),await value());
    await set('Target item\n\n保留段落 $x_{i}^{2}$。\n',mode);await focusText('Target item');await command('list');
    check('custom unordered marker '+mode,/^\+ Target item/m.test(await value())&&(await value()).includes('保留段落 $x_{i}^{2}$。'),await value());
    await command('undo');check('list marker undo '+mode,!/^\+ Target item/m.test(await value()),await value());
    await set('Task item\n\n保留段落\n',mode);await focusText('Task item');await command('check');
    check('custom task list marker '+mode,/^\+ \[ \] +Task item/m.test(await value()),await value());
    await set('Before code\n\n```python\nfirst = 1\nsecond = 2\n```\n\nAfter code\n',mode);
    if(mode!=='sv')await js(`{const code=activeSurface().querySelector('pre code');code.parentElement.style.display='block';code.closest('[data-type="code-block"]')?.classList.add('vditor-ir__node--expand');}`);
    await focusText('first = 1','second = 2');
    const codeSelection=await js(`(()=>{const r=getSelection().getRangeAt(0),p=document.createRange();p.selectNodeContents(activeSurface());p.setEnd(r.startContainer,r.startOffset);return {offset:p.toString().length,before:p.toString(),selection:r.toString(),value:editor.getValue(),html:activeSurface().innerHTML}})()`);
    await command('code-indent');
    check('selected code lines indent '+mode,(await value()).includes('```python\n  first = 1\n  second = 2\n```')&&(await value()).includes('Before code')&&(await value()).includes('After code'),{value:await value(),selected:codeSelection.selection});
    if(mode!=='sv')check('code command retains editing caret '+mode,await js(`!!(getSelection().anchorNode?.parentElement?.closest('pre > code'))`));
    await command('undo');check('code indent undo '+mode,(await value()).includes('```python\nfirst = 1\nsecond = 2\n```'),await value());
    await command('redo');check('code indent redo '+mode,(await value()).includes('```python\n  first = 1\n  second = 2\n```'),await value());
    if(mode!=='sv')await js(`{const code=activeSurface().querySelector('pre code');code.parentElement.style.display='block';code.closest('[data-type="code-block"]')?.classList.add('vditor-ir__node--expand');}`);
    await focusText('first = 1','second = 2');await command('code-outdent');
    check('selected code lines outdent '+mode,(await value()).includes('```python\nfirst = 1\nsecond = 2\n```'),await value());
    await js('document.body.dataset.readonly="true"');const readonly=await value();await command('code-indent');
    check('read-only rejects code indentation '+mode,(await value())===readonly);await js('document.body.dataset.readonly="false"');
    await set('Toolbar item\n\nkeep\n',mode);await js('window.EditorTools.apply()');await focusText('Toolbar item');
    await js(`editor.vditor.toolbar.element.querySelector('[data-type="list"]').click()`);await wait(400);
    check('toolbar creation uses configured marker '+mode,/^\+ Toolbar item/m.test(await value()),await value());
    await set('first item\n\nsecond item\n\nthird item\n\nkeep\n',mode);await focusText('first item','third item');await command('ordered-list');
    check('repeat numbering on selected paragraphs '+mode,/1\. first item/.test(await value())&&/1\. second item/.test(await value())&&/1\. third item/.test(await value()),await value());
    await command('undo');check('ordered list undo '+mode,!/^1\. first item/m.test(await value()),await value());
  }
  await set('first item\nsecond item\nthird item\n\nkeep\n','sv');await focusText('first item','third item');await command('ordered-list');
  check('source repeat numbering applies to selected lines',/^1\. first item\n1\. second item\n1\. third item\n\nkeep/m.test(await value()),await value());
  await command('undo');await js('settings.orderedListStyle="increment"');await focusText('first item','third item');await command('ordered-list');
  check('source sequential numbering applies to selected lines',/^1\. first item\n2\. second item\n3\. third item/m.test(await value()),await value());
  await set('outside code\n\n```js\nx\n```\n','sv');await focusText('outside code');const before=await value();await command('code-indent');
  check('code indentation outside fence is no-op',(await value())===before);
  await set('Title\n=====\n\nkeep\n','sv');await focusText('=====');await command('h2');
  check('source Setext underline selection changes heading not inserts duplicate',/^Title\n-+\n\nkeep/m.test(await value()),await value());
  await focusText('Title');await command('heading-up');
  check('source increase heading handles Setext',/^Title\n=+\n\nkeep/m.test(await value()),await value());
};

if(require.main===module||(process.versions.electron&&process.argv[1]?.endsWith('markdown-preferences-test.cjs'))){
  const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
  const root=path.resolve(__dirname,'..'),out=path.join(root,'verification','20261020-typora-claude','commands');
  app.setPath('userData',path.join(out,'profile'));app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(async()=>{
    await fs.mkdir(out,{recursive:true});const file=name=>pathToFileURL(path.join(root,name)).href;
    const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${file('node_modules/vditor/dist/index.css')}"><style>#editor{height:760px}#outline-panel{display:none}</style></head><body><div id="editor"></div><div id="outline-panel"><div id="outline"></div></div><script src="${file('node_modules/vditor/dist/index.min.js')}"></script><script>
    var editor,mode='ir',ready=false,raw='',filePath=null,settings={headingStyle:'atx',unorderedListMarker:'*',orderedListStyle:'increment',codeIndentSize:4,tabSize:4},$=s=>document.querySelector(s);
    const api=async()=>{},toast=()=>{},fail=e=>{throw e},toggleOutline=()=>{},findNext=()=>{};var run=async()=>{};
    function activeSurface(){return editor?.vditor[mode]?.element}
    function changed(value){raw=value}
    async function mount(value,newMode=mode){ready=false;mode=newMode;if(editor)editor.destroy();$('#editor').replaceChildren();await window.EditorPreferences.prepare(${JSON.stringify(file('node_modules/vditor'))});await new Promise(resolve=>{editor=new Vditor('editor',{cdn:${JSON.stringify(file('node_modules/vditor'))},mode,value,lang:'en_US',height:760,cache:{enable:false},customWysiwygToolbar:()=>{},toolbar:['headings','bold','list','ordered-list','check','indent','outdent','undo','redo'],preview:{delay:50,hljs:{enable:false},actions:[]},input:changed,after:()=>{ready=true;resolve()}})});window.EditorPreferences.apply();}
    async function setDocument(value,newMode=mode){window.EditorTools?.reset();raw=value;await mount(value,newMode)}
    window.__cyporaTest={get editor(){return editor},get mode(){return mode},get ready(){return ready},setDocument};
    </script><script src="${file('editor-preferences.js')}"></script><script src="${file('editor-tools.js')}"></script><script>window.EditorPreferences.configure({getSettings:()=>settings,getEditor:()=>editor,isReadOnly:()=>document.body.dataset.readonly==='true',isConversation:()=>false});setDocument('')</script></body></html>`;
    await fs.writeFile(path.join(out,'fixture.html'),html);
    const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
    const results=[],errors=[],js=code=>win.webContents.executeJavaScript(code,true);
    const check=(name,passed,detail)=>{results.push({name,passed:!!passed,detail});if(!passed)throw Error(name)};
    const until=async(code,ms=8000)=>{const start=Date.now();while(Date.now()-start<ms){if(await js(code))return;await new Promise(r=>setTimeout(r,60));}throw Error('Timeout: '+code)};
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
    try{await win.loadFile(path.join(out,'fixture.html'));await until('window.__cyporaTest.ready');await module.exports({js,check,until});check('no runtime errors',!errors.some(e=>/Uncaught|TypeError|ReferenceError/.test(e)),errors);const crypto=require('node:crypto'),sha256={};for(const file of ['editor-tools.js','editor-menu.cjs','editor-preferences.js'])sha256[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');await fs.writeFile(path.join(out,'results.json'),JSON.stringify({passed:true,results,errors,lutePreferencesHook:await js('!!window.Lute.New.cyporaPreferences'),sha256},null,2));console.log(JSON.stringify({passed:true,tests:results.length,out}));app.exit(0);}
    catch(error){const diagnostic=await js('({mode,raw,value:editor?.getValue(),html:activeSurface()?.innerHTML})').catch(()=>null);await fs.writeFile(path.join(out,'results.json'),JSON.stringify({passed:false,error:error.stack,results,errors,diagnostic},null,2));console.error(error);app.exit(1);}
  });
}
