// Real Vditor renderer and Chromium input checks. Uses only an isolated profile.
module.exports=async({js,check,until,win})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const baseline=await js('JSON.stringify(settings)');
  const value=()=>js('window.__cyporaTest.editor.getValue()');
  const set=async(text,mode='sv')=>{
    await js(`window.__cyporaTest.setDocument(${JSON.stringify(text)})`);
    await js(`window.__cyporaTest.run('mode',${JSON.stringify(mode)})`);
    await js('window.EditorPreferences.apply()');await wait(120);
  };
  const patch=async(values)=>{await js(`Object.assign(settings,${JSON.stringify(values)});window.EditorPreferences.apply()`);};
  const place=async(token,atEnd=true)=>js(`(()=>{
    const v=window.__cyporaTest.editor.vditor,surface=v[v.currentMode].element;surface.focus();
    const walker=document.createTreeWalker(surface,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){
      const at=n.textContent.indexOf(${JSON.stringify(token)});if(at>=0){const r=document.createRange();r.setStart(n,at+${atEnd?token.length:0});r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);return;}
    }throw Error('Selection token missing');
  })()`);
  const input=async text=>{await win.webContents.insertText(text);await wait(180);};
  const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait(180);};
  try{
    await patch({autoPairBrackets:false,autoPairMarkdown:false,smartQuotes:false,smartDashes:false,markdownSoftBreak:false,markdownInlineMath:true,markdownSubscript:false,markdownSuperscript:false});
    const fencedFixtures={
      'Python leading spaces':'```python\n  first = 1\n    second = 2\n```\n',
      'multiple mixed fences':'```python\n  first\n```\n\n~~~~js\n\tsecond\n~~~~\n',
      'empty first line':'```python\n\n  first\n```\n',
      'whitespace first and last lines':'```python\n  \n  first  \n  \n\n```\n',
      'only whitespace':'```text\n \t \n\n```\n',
      'CRLF source':'```python\r\n  first\r\n\tsecond\r\n```\r\n',
      'blockquote fence':'> ```python\n>   first\n>   second\n> ```\n',
      'list nested fence':'- item\n\n  ```python\n    first\n    second\n  ```\n',
      'indented opener':'  ```python\n    first\n    second\n  ```\n',
      'long fence containing short fence':'`````text\n  ```\n  literal\n`````\n'
    };
    const semanticCode=expression=>js(`(()=>{const t=document.createElement('template');t.innerHTML=Lute.New().Md2VditorIRDOM(${expression});return [...t.content.querySelectorAll('[data-type="code-block"] .vditor-ir__marker--pre>code')].map(code=>code.textContent);})()`);
    for(const [name,fenced]of Object.entries(fencedFixtures)){
      const fixture='Unrelated prose\n\n'+fenced+'\nEnd prose\n',expected=await semanticCode(JSON.stringify(fixture));
      for(const mode of ['sv','ir','wysiwyg']){
        await set(fixture,mode);await place('Unrelated prose');await input(' edited');
        const actual=await semanticCode('window.__cyporaTest.editor.getValue()');
        check('fenced code preserved through unrelated typing: '+name+' / '+mode,JSON.stringify(actual)===JSON.stringify(expected),{expected,actual,markdown:await value()});
      }
    }
    const caret=await js(`(()=>{const html=Lute.New().SpinVditorSVDOM('~~~python\\n  '+Lute.Caret+'first\\n~~~\\n');return {html,kept:html.includes('  <wbr>first')};})()`);
    check('source whitespace correction preserves code caret marker',caret.kept,caret);
    const paste=await js(`(()=>{const t=document.createElement('template');t.innerHTML=Lute.New().HTML2VditorSVDOM('<pre><code class="language-python">  first\\n\\n</code></pre>');return t.content.textContent;})()`);
    check('HTML code pasted into source mode retains boundary whitespace',paste.includes('  first\n\n'),paste);
    const untouched='\ufeff# 原文\r\n\r\nH~2~O and x^2^ / $x$.\r\n\r\n```js\r\nconst raw = "--";\r\n```\r\n';
    await set(untouched);await patch({markdownSubscript:true,markdownSuperscript:true,markdownSoftBreak:true});
    check('preferences preserve untouched BOM and CRLF bytes',await js(`window.__cyporaTest.raw===${JSON.stringify(untouched)}`),await js('window.__cyporaTest.raw'));
    let rendered=await js('Lute.New().Md2HTML("H~2~O x^2^\\nsecond\\n\\n`H~2~O x^2^`\\n\\n```js\\nH~2~O x^2^\\n```")');
    check('subscript and superscript render with native Lute options',rendered.includes('<sub>2</sub>')&&rendered.includes('<sup>2</sup>'),rendered);
    check('single line break setting renders a real break',rendered.includes('<br />')||rendered.includes('<br>'),rendered);
    check('inline code and fenced code remain literal',rendered.includes('<code>H~2~O x^2^</code>')&&rendered.includes('H~2~O x^2^\n</code>'),rendered);
    await patch({markdownInlineMath:false,markdownSubscript:false,markdownSuperscript:false,markdownSoftBreak:false});
    rendered=await js('Lute.New().Md2HTML("H~2~O x^2^\\nsecond\\n\\n$x$\\n\\n$$\\nx\\n$$")');
    check('disabled extensions restore baseline Markdown interpretation',!rendered.includes('<sub>')&&!rendered.includes('<sup>')&&rendered.includes('$x$'),rendered);
    check('disabling inline math preserves display math',rendered.includes('language-math'),rendered);
    check('soft breaks can be disabled',!rendered.includes('<br'),rendered);
    await patch({autoPairBrackets:true});
    for(const mode of ['sv','ir','wysiwyg']){
      await set('alpha  tail\n',mode);await place('alpha ');
      await input('(');check('native bracket pairing '+mode,(await value()).includes('alpha ()'),await value());
      await input(')');check('typing closing bracket skips existing closer '+mode,(await value()).includes('alpha ()')&&!(await value()).includes('())'),await value());
    }
    await set('alpha  tail\n');await place('alpha ');await input('(');await key('Backspace');
    check('paired Backspace removes both characters',(await value()).includes('alpha  tail'),await value());
    await patch({autoPairBrackets:false});await set('alpha  tail\n');await place('alpha ');await input('(');
    check('pair preference off inserts only typed character',(await value()).includes('alpha (')&&!(await value()).includes('()'),await value());
    await patch({autoPairBrackets:true});await set('alpha  tail\n');await place('alpha ');await wait(950);await input('(');await wait(950);
    await js('window.__cyporaTest.editor.vditor.undo.undo(window.__cyporaTest.editor.vditor)');await wait(150);
    check('paired typing participates in editor undo',!(await value()).includes('()'),await value());
    await js('window.__cyporaTest.editor.vditor.undo.redo(window.__cyporaTest.editor.vditor)');await wait(150);
    check('paired typing participates in editor redo',(await value()).includes('()'),await value());
    await patch({autoPairMarkdown:true});await set('alpha  tail\n');await place('alpha ');await input('*');
    check('Markdown marker pairing inserts two literal markers',(await value()).includes('alpha **'),await value());
    await patch({markdownInlineMath:true});
    for(const mode of ['sv','ir','wysiwyg'])for(const marker of ['$','`']){
      await set('alpha  tail\n',mode);await place('alpha ');await input(marker);await input('x');await input(marker);
      check('generated inline marker closes once '+mode+' / '+marker,(await value()).includes('alpha '+marker+'x'+marker+' tail'),await value());
      await set('alpha  tail\n',mode);await place('alpha ');await input(marker);await key('Backspace');
      check('empty generated inline pair deletes together '+mode+' / '+marker,(await value()).includes('alpha  tail')&&!(await value()).includes(marker),await value());
    }
    for(const marker of ['$','`']){
      await set('alpha '+marker+'x '+marker+' tail\n','sv');await place('x ');
      const protectedInput=await js(`(()=>{const input=new InputEvent('beforeinput',{data:${JSON.stringify(marker)},inputType:'insertText',bubbles:true,cancelable:true});window.__cyporaTest.editor.vditor.sv.element.dispatchEvent(input);return input.defaultPrevented;})()`);
      check('existing inline literal closer is not intercepted '+marker,protectedInput===false);
    }
    await set('alpha  tail\n','wysiwyg');await place('alpha ');await input('$');await wait(1200);
    check('paused empty math pair reaches real input callback',await js('window.__cyporaTest.raw.includes("alpha $$ tail")'),await js('window.__cyporaTest.raw'));
    check('paused empty math pair can be serialized for saving',(await value()).includes('alpha $$ tail'),await value());
    await js("window.__cyporaTest.run('mode','sv')");await wait(150);
    check('paused empty math pair survives mode switch',(await value()).includes('alpha $$ tail'),await value());
    await patch({autoPairMarkdown:false,smartQuotes:true,smartDashes:true});await set('alpha  tail\n');await place('alpha ');
    await input('"');await input('word');await input('"');
    check('smart quotes affect only new prose typing',(await value()).includes('“word”'),await value());
    await set('alpha  tail\n');await place('alpha ');await input('-');await input('-');await input('-');
    check('three prose hyphens become em dash',(await value()).includes('alpha —'),await value());
    await set('alpha \n\n```js\nliteral\n```\n');await place('literal');await input('"');await input('-');await input('-');await input('-');
    check('code literal typing bypasses smart typography',(await value()).includes('literal"---'),await value());
    await patch({autoPairBrackets:true});await set('alpha  tail\n');await place('alpha ');
    const ime=await js(`(()=>{const e=window.__cyporaTest.editor.vditor.sv.element;const input=new InputEvent('beforeinput',{data:'(',inputType:'insertCompositionText',isComposing:true,bubbles:true,cancelable:true});e.dispatchEvent(input);return input.defaultPrevented;})()`);
    check('IME composition is not intercepted',ime===false);
    await js('document.body.dataset.readonly="true"');
    const readOnly=await js(`(()=>{const e=window.__cyporaTest.editor.vditor.sv.element;const input=new InputEvent('beforeinput',{data:'(',inputType:'insertText',bubbles:true,cancelable:true});e.dispatchEvent(input);return input.defaultPrevented;})()`);
    check('read-only editing is not intercepted',readOnly===false);await js('document.body.dataset.readonly="false"');
    await js('EditorPreferences.configure({isConversation:()=>true})');
    const chat=await js(`(()=>{const e=window.__cyporaTest.editor.vditor.sv.element;const input=new InputEvent('beforeinput',{data:'(',inputType:'insertText',bubbles:true,cancelable:true});e.dispatchEvent(input);return input.defaultPrevented;})()`);
    check('chat editing does not mutate hidden Markdown editor',chat===false);await js('EditorPreferences.configure({isConversation:()=>!!window.Conversations?.active})');
    await patch({smartQuotes:false,smartDashes:false,tabSize:2,codeIndentSize:4,indentWithTabs:false});await set('alpha  tail\n');await place('alpha ');
    await key('Tab');await input('beta');check('Tab uses configured prose width',(await value()).includes('alpha   beta'),await value());
    await set('  alpha\n');await place('alpha');await key('Tab',['shift']);
    check('Shift+Tab removes the configured indentation',(await value()).trimStart().startsWith('alpha')&&!(await value()).startsWith('  '),await value());
    await set('```js\nliteral\n```\n');await place('literal');await key('Tab');await input('x');
    check('code Tab uses independent code width',(await value()).includes('literal    x'),await value());
    await patch({indentWithTabs:true});await set('```js\nliteral\n```\n');await place('literal');await key('Tab');await input('x');
    check('Tab character mode writes a tab in code',(await value()).includes('literal\tx'),await value());
    await patch({emojiAutocomplete:false});await set('alpha :smile\n');await place(':smile');await js('window.__cyporaTest.editor.vditor.hint.render(window.__cyporaTest.editor.vditor)');await wait(100);
    check('emoji autocomplete off hides suggestions',await js('window.__cyporaTest.editor.vditor.hint.element.style.display!=="block"'));
    await patch({emojiAutocomplete:true});await js('window.__cyporaTest.editor.vditor.hint.render(window.__cyporaTest.editor.vditor)');await wait(100);
    check('emoji autocomplete on produces actual suggestions',await js('window.__cyporaTest.editor.vditor.hint.element.style.display==="block"&&window.__cyporaTest.editor.vditor.hint.element.textContent.includes("smile")'));
    await key('Enter');
    check('emoji suggestion accepts the keyboard Enter key',!(await value()).includes(':smile')&&/[\u{1f600}-\u{1f64f}]/u.test(await value()),await value());
  }finally{await js(`Object.assign(settings,${baseline});window.EditorPreferences.apply()`);}
};

if(require.main===module||(process.versions.electron&&process.argv[1]?.endsWith('editor-preferences-test.cjs'))){
  const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
  const root=path.resolve(__dirname,'..'),out=path.join(root,'verification','20261020-typora-claude','editor');
  app.setPath('userData',path.join(out,'profile'));app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(async()=>{
    await fs.mkdir(out,{recursive:true});const file=name=>pathToFileURL(path.join(root,name)).href;
    const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${file('node_modules/vditor/dist/index.css')}"><style>body{margin:0}#editor{height:700px}</style></head><body><div id="editor"></div><script src="${file('settings-model.js')}"></script><script src="${file('node_modules/vditor/dist/index.min.js')}"></script><script src="${file('editor-preferences.js')}"></script><script>
      var editor,mode='ir',ready=false,settings=CyporaSettings.load(),raw='';
      const cdn=${JSON.stringify(file('node_modules/vditor'))};
      EditorPreferences.configure({getSettings:()=>settings,getEditor:()=>editor,isReadOnly:()=>document.body.dataset.readonly==='true',isConversation:()=>false});
      async function mount(value,newMode=mode){ready=false;mode=newMode;if(editor)editor.destroy();document.querySelector('#editor').replaceChildren();await EditorPreferences.prepare(cdn);await new Promise(resolve=>{editor=new Vditor('editor',{cdn,mode,value:value.replace(/^\\ufeff/,''),lang:'en_US',height:700,cache:{enable:false},...EditorPreferences.vditorOptions(settings),customWysiwygToolbar:()=>{},toolbar:['undo','redo'],preview:{delay:50,markdown:EditorPreferences.previewMarkdown(settings),hljs:{enable:false},actions:[]},input:value=>raw=value,after:()=>{ready=true;EditorPreferences.apply();resolve()}})});}
      async function setDocument(value){raw=value;await mount(value)}
      window.__cyporaTest={get editor(){return editor},get mode(){return mode},get raw(){return raw},get ready(){return ready},setDocument,run:async(name,arg)=>{if(name==='mode'&&mode!==arg)await mount(raw,arg)}};
      setDocument('');
    </script></body></html>`;
    await fs.writeFile(path.join(out,'fixture.html'),html);
    const win=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    const errors=[],results=[],js=source=>win.webContents.executeJavaScript(source,true);
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const check=(name,passed,detail)=>{results.push({name,passed:!!passed,detail});if(!passed)throw Error(name);};
    const until=async(expression)=>{const start=Date.now();while(Date.now()-start<10000){if(await js(expression))return;await new Promise(r=>setTimeout(r,60));}throw Error('Timeout: '+expression);};
    try{
      await win.loadFile(path.join(out,'fixture.html'));await until('window.__cyporaTest.ready');await module.exports({js,check,until,win});
      check('no renderer runtime errors',!errors.some(e=>/TypeError|ReferenceError|Uncaught/.test(e)),errors);
      await fs.writeFile(path.join(out,'results.json'),JSON.stringify({passed:true,results,errors},null,2));console.log(JSON.stringify({passed:true,tests:results.length,out}));app.exit(0);
    }catch(error){
      const diagnostic=await js('({mode,value:editor?.getValue(),html:document.querySelector("#editor").innerHTML})').catch(()=>null);
      await fs.writeFile(path.join(out,'results.json'),JSON.stringify({passed:false,error:error.stack,results,errors,diagnostic},null,2));console.error(error);app.exit(1);
    }
  });
}
