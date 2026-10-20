// Real renderer regression checks, reusable from the application's Electron suite.
module.exports=async({js,check,until,fs,path,win,out})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const fixture='代码块之前\n\n```python\nfirst = 1\nsecond = 2\nprint(first + second)\n```\n\n中间段落\n\n```json\n{"keep": true}\n```\n\n代码块之后\n';
  const value=()=>js('window.__cyporaTest.editor.getValue()');
  async function set(text,mode){
    await js(`window.__cyporaTest.setDocument(${JSON.stringify(text)});`);
    await js(`window.__cyporaTest.run('mode',${JSON.stringify(mode)})`);
    await js(`settings.codeLineNumbers=true;window.CodeBlocks.apply()`);
    await until('window.CodeBlocks.blocks.length===2');await wait(180);
  }
  for(const mode of ['ir','wysiwyg','sv']){
    await set(fixture,mode);
    await js('window.CodeBlocks.blocks[0].pre.scrollIntoView({block:"center"});window.CodeBlocks.refresh()');await wait(70);
    check('code language control exists '+mode,await js('window.CodeBlocks.blocks[0].languageButton.textContent.includes("Python")'));
    check('code editing and preview line count '+mode,await js('window.CodeBlocks.blocks[0].gutter.children.length===3'),await js('window.CodeBlocks.blocks.map(b=>({lang:b.language,lines:b.gutter.children.length,pre:b.pre.outerHTML}))'));
    const before=await value();
    check('code UI never serialized '+mode,!/code-block-toolbar|选择代码语言|code-line-gutter|行号/.test(before)&&before.includes('first = 1'));
    await js('window.CodeBlocks.blocks[0].languageButton.click()');
    check('searchable language picker opens '+mode,await js('!!document.querySelector(".code-language-picker input")'));
    if(mode==='ir'&&fs&&path&&win&&out){await wait(100);await fs.writeFile(path.join(out,'code-language-picker.png'),(await win.webContents.capturePage()).toPNG());}
    await js(`{const input=document.querySelector('.code-language-picker input');input.value='typescript';input.dispatchEvent(new Event('input'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}`);
    await wait(300);
    const after=await value();
    check('language selection updates only target fence '+mode,after.includes('```typescript\nfirst = 1')&&after.includes('```json\n{"keep": true}')&&after.includes('中间段落')&&after.includes('代码块之后'),after);
    await js('window.__cyporaTest.editor.vditor.undo.undo(window.__cyporaTest.editor.vditor)');await wait(300);
    check('language undo '+mode,(await value()).includes('```python\nfirst = 1'),await value());
    await js('window.__cyporaTest.editor.vditor.undo.redo(window.__cyporaTest.editor.vditor)');await wait(300);
    check('language redo '+mode,(await value()).includes('```typescript\nfirst = 1'),await value());
    await js(`settings.codeLineNumbers=false;window.CodeBlocks.apply()`);await wait(80);
    check('line number toggle immediate '+mode,await js('window.CodeBlocks.blocks.every(b=>b.gutter.hidden)&&document.body.dataset.codeLines==="false"'));
    await js(`settings.codeLineNumbers=true;window.CodeBlocks.apply()`);await wait(80);
    check('line number toggle restored '+mode,await js('window.CodeBlocks.blocks[0].gutter.children.length===3&&!window.CodeBlocks.blocks[0].gutter.hidden'));
    await js('window.CodeBlocks.blocks[0].chrome.querySelector(".code-number-toggle").click()');
    await until('document.body.dataset.codeLines==="false"');
    await js('window.CodeBlocks.blocks[0].chrome.querySelector(".code-number-toggle").click()');
    await until('document.body.dataset.codeLines==="true"');
    check('visible line number switch works '+mode,true);
    if(mode!=='sv'){
      await js(`(()=>{const block=window.CodeBlocks.blocks[0];const code=block.sourceCode;code.parentElement.style.display='block';block.wrapper.classList.add('vditor-ir__node--expand');const walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);let node,last;while(node=walker.nextNode())last=node;const range=document.createRange();range.setStart(last,Math.max(0,last.length-1));range.collapse(true);window.__cyporaTest.editor.vditor[${JSON.stringify(mode)}].element.focus();getSelection().removeAllRanges();getSelection().addRange(range);})()`);
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await win.webContents.insertText('fourth = 4');
      await wait(350);await js('window.CodeBlocks.refresh()');await wait(100);
      check('line numbers follow real code editing '+mode,await js('window.CodeBlocks.blocks[0].gutter.children.length===4'),await value());
    }else{
      await js(`{const next=window.__cyporaTest.editor.getValue().replace('print(first + second)','print(first + second)\\nfourth = 4');window.__cyporaTest.editor.setValue(next);window.__cyporaTest.changed(next);}`);
      await wait(400);
      check('source preview line count follows source edit',await js('window.CodeBlocks.blocks[0].gutter.children.length===4'),await js('window.CodeBlocks.blocks.map(b=>b.gutter.children.length)'));
    }
    if(fs&&path&&win&&out){await js('window.CodeBlocks.blocks[0].pre.scrollIntoView({block:"center"});window.CodeBlocks.refresh()');await wait(100);await fs.writeFile(path.join(out,'code-'+mode+'.png'),(await win.webContents.capturePage()).toPNG());}
  }
  const tricky='before\r\n\r\n````python  \r\nvalue = "```"\r\n\r\nprint(value)\r\n````\r\n\r\n```json\r\n{}\r\n```\r\n';
  await set(tricky,'sv');
  const before=await value();await js('window.CodeBlocks.setLanguage(0,"rust")');await wait(200);
  check('long fence and internal backticks preserved',(await value())===before.replace('````python','````rust'),await value());
  check('empty and trailing line counts',await js('window.CodeBlocks.lineCount("")===1&&window.CodeBlocks.lineCount("one\\n")===1&&window.CodeBlocks.lineCount("one\\n\\n")===2'));
  await js('document.body.dataset.readonly="true"');const readOnly=await value();const allowed=await js('window.CodeBlocks.setLanguage(0,"java")');
  check('read-only blocks language mutation',allowed===false&&(await value())===readOnly);await js('document.body.dataset.readonly="false"');
};

// `electron tools/code-blocks-test.cjs` runs the same behavior against an isolated
// renderer fixture. It never opens, saves, or changes the user's documents.
if(require.main===module||(process.versions.electron&&process.argv[1]?.endsWith('code-blocks-test.cjs'))){
  const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
  const wrapOnly=process.argv.includes('--code-wrap-only');
  const root=path.resolve(__dirname,'..'),out=wrapOnly?path.join(root,'verification','20261020-typora-claude','code-wrap'):path.join(root,'verification','code-blocks-20261020');
  app.setPath('userData',path.join(out,'profile'));app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(async()=>{
    await fs.mkdir(out,{recursive:true});
    const file=name=>pathToFileURL(path.join(root,name)).href;
    const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${file('node_modules/vditor/dist/index.css')}"><link rel="stylesheet" href="${file('code-blocks.css')}"><style>:root{--paper:#fff;--sidebar:#f7f7f7;--ink:#222;--muted:#888;--line:#e5e5e5;--hover:#eee;--ui-font:Segoe UI;--code-font:Consolas}*{box-sizing:border-box}body{margin:0}#editor{height:850px}.vditor-reset{font-size:16px}.vditor-reset pre code{font:13px/1.65 Consolas,monospace}</style></head><body><div id="editor"></div><script src="${file('node_modules/vditor/dist/index.min.js')}"></script><script>
      var editor,mode='ir',ready=false,settings={codeLineNumbers:true};var raw='';
      function activeSurface(){return editor?.vditor?.[mode]?.element}
      function changed(value){raw=value;window.CodeBlocks?.refresh()}
      async function mount(value,newMode=mode){ready=false;mode=newMode;if(editor)editor.destroy();document.querySelector('#editor').replaceChildren();await new Promise(resolve=>{editor=new Vditor('editor',{cdn:${JSON.stringify(file('node_modules/vditor'))},mode,value,lang:'en_US',height:850,cache:{enable:false},customWysiwygToolbar:()=>{},toolbar:['undo','redo'],preview:{delay:50,hljs:{enable:true,lineNumber:false},actions:[]},input:changed,after:()=>{ready=true;window.CodeBlocks?.apply();resolve()}})});}
      async function setDocument(value){raw=value;await mount(value)}
      window.__cyporaTest={get editor(){return editor},get mode(){return mode},get ready(){return ready},changed,setDocument,run:async(name,arg)=>{if(name==='mode'&&mode!==arg)await mount(editor.getValue(),arg)}};
    </script><script src="${file('code-blocks.js')}"></script><script>setDocument('')</script></body></html>`;
    await fs.writeFile(path.join(out,'fixture.html'),html);
    const win=new BrowserWindow({show:false,width:1240,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    const errors=[];win.webContents.on('console-message',(_event,...args)=>{const detail=args[0];if(typeof detail==='object'){if(detail.level==='error')errors.push(detail.message);}else if(args[0]>=2)errors.push(args[1]);});
    const results=[],js=source=>win.webContents.executeJavaScript(source,true);
    const check=(name,passed,detail)=>{results.push({name,passed:!!passed,detail});if(!passed)throw Error(name)};
    const until=async(expression,timeout=8000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await js(expression))return;await new Promise(r=>setTimeout(r,60));}throw Error('Timeout: '+expression)};
    try{
      await win.loadFile(path.join(out,'fixture.html'));await until('window.__cyporaTest.ready');
      await (wrapOnly?require('./code-wrap-test.cjs'):module.exports)({js,check,until,fs,path,win,out});
      check('no renderer runtime errors',!errors.some(e=>/TypeError|ReferenceError|Uncaught/.test(e)),errors);
      await fs.writeFile(path.join(out,'results.json'),JSON.stringify({passed:true,results,errors},null,2));
      console.log(JSON.stringify({passed:true,tests:results.length,out}));app.exit(0);
    }catch(error){
      const diagnostic=await js('({mode,html:document.querySelector("#editor").innerHTML,value:editor?.getValue(),blocks:window.CodeBlocks?.blocks.map(b=>({language:b.language,lines:b.gutter.children.length}))})').catch(()=>null);
      await fs.writeFile(path.join(out,'results.json'),JSON.stringify({passed:false,error:error.stack,results,errors,diagnostic},null,2));
      await fs.writeFile(path.join(out,'failed.png'),(await win.webContents.capturePage()).toPNG());console.error(error);app.exit(1);
    }
  });
}
