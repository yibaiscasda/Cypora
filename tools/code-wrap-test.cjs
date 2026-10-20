module.exports=async({js,check,until,fs,path,win,out})=>{
  const Model=require('../settings-model.js'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  check('code wrap defaults on and persists independently',Model.defaults.codeWordWrap===true&&Model.load(JSON.parse(JSON.stringify(Model.patch({codeWordWrap:false,wordWrap:true})))).codeWordWrap===false&&Model.load({codeWordWrap:false,wordWrap:true}).wordWrap===true);
  const long='const message = "'+'long_code_fragment_'.repeat(35)+'";',fixture='普通正文\n\n```javascript\n'+long+'\nconsole.log(message);\n```\n\n后续正文\n';
  const value=()=>js('window.__cyporaTest.editor.getValue()');
  async function toggle(enabled){await js(`settings.codeWordWrap=${enabled};window.CodeBlocks.apply()`);await wait(110);}
  const metrics=()=>js(`(()=>{const b=window.CodeBlocks.blocks[0],c=b.code,s=getComputedStyle(c);return {whiteSpace:s.whiteSpace,width:c.clientWidth,scrollWidth:c.scrollWidth,scrollLeft:c.scrollLeft,gap:parseFloat(b.gutter.children[1]?.style.top)-parseFloat(b.gutter.children[0]?.style.top),lineHeight:parseFloat(s.lineHeight),lines:b.gutter.children.length};})()`);
  for(const mode of ['ir','wysiwyg','sv']){
    await js(`window.__cyporaTest.setDocument(${JSON.stringify(fixture)})`);
    await js(`window.__cyporaTest.run('mode',${JSON.stringify(mode)})`);
    await js('settings.codeLineNumbers=true;settings.wordWrap=false;document.body.dataset.wrap="false";window.CodeBlocks.apply()');
    await until('window.CodeBlocks.blocks.length===1');await wait(150);
    const original=await value();
    for(const editing of mode==='sv'?[false]:[false,true]){
      const context=mode+(editing?'-editing':'-preview');
      if(editing){await js(`{const b=window.CodeBlocks.blocks[0];b.wrapper.classList.add('vditor-ir__node--expand');b.sourceCode.parentElement.style.display='block';window.CodeBlocks.refresh();}`);await wait(100);}
      await toggle(true);let m=await metrics();
      check('wrapped long line and logical numbers '+context,m.whiteSpace==='pre-wrap'&&m.lines===2&&m.gap>m.lineHeight*2,m);
      await fs.writeFile(path.join(out,context+'-wrap.png'),(await win.webContents.capturePage()).toPNG());
      await toggle(false);m=await metrics();
      check('nowrap long line has horizontal overflow '+context,m.whiteSpace==='pre'&&m.scrollWidth>m.width&&Math.abs(m.gap-m.lineHeight)<2,m);
      await js('window.CodeBlocks.blocks[0].code.scrollLeft=200');await wait(80);
      check('native horizontal scroll works '+context,(await metrics()).scrollLeft>0,await metrics());
      await fs.writeFile(path.join(out,context+'-nowrap.png'),(await win.webContents.capturePage()).toPNG());
      await toggle(true);m=await metrics();
      check('wrap switch recomputes line placement '+context,m.gap>m.lineHeight*2&&m.lines===2,m);
      check('display settings never rewrite Markdown '+context,(await value())===original);
      check('source wordWrap stays independent '+context,await js('settings.wordWrap===false&&document.body.dataset.wrap==="false"&&settings.codeWordWrap===true'));
    }
  }
  // Exercise the same Vditor preview DOM used by conversation message bodies.
  await js(`(async()=>{document.querySelector('#editor').style.display='none';const view=document.createElement('div');view.id='conversation-view';view.style.cssText='width:700px;padding:30px';const markdown=document.createElement('div');markdown.className='conversation-markdown vditor-reset';view.append(markdown);document.body.append(view);await Vditor.preview(markdown,${JSON.stringify('```javascript\n'+long+'\nconsole.log(message);\n```\n')},{cdn:${JSON.stringify(new URL('file:///'+path.resolve(__dirname,'../node_modules/vditor').replaceAll('\\','/')).href)},hljs:{enable:true,lineNumber:true,style:'github'},actions:[]});window.CodeBlocks.apply();})()`);
  await until('document.querySelector("#conversation-view .vditor-linenumber__rows")?.children.length===2');
  const conversationMetrics=()=>js(`(()=>{const c=document.querySelector('#conversation-view pre>code'),r=c.querySelector('.vditor-linenumber__rows');return {whiteSpace:getComputedStyle(c).whiteSpace,rowHeight:parseFloat(r.children[0].style.height),lineHeight:parseFloat(getComputedStyle(c).lineHeight),width:c.clientWidth,scrollWidth:c.scrollWidth,text:[...c.childNodes].filter(n=>!n.classList?.contains('vditor-linenumber__temp')&&!n.classList?.contains('vditor-linenumber__rows')).map(n=>n.textContent).join('')};})()`);
  await toggle(true);let cm=await conversationMetrics();const originalCode=cm.text;
  check('conversation preview wraps and remeasures number row',cm.whiteSpace==='pre-wrap'&&cm.rowHeight>cm.lineHeight*2,cm);
  await fs.writeFile(path.join(out,'conversation-wrap.png'),(await win.webContents.capturePage()).toPNG());
  await toggle(false);cm=await conversationMetrics();
  check('conversation preview nowrap updates number row',cm.whiteSpace==='pre'&&cm.scrollWidth>cm.width&&Math.abs(cm.rowHeight-cm.lineHeight)<2,cm);
  check('conversation code content unchanged',cm.text===originalCode);
  await fs.writeFile(path.join(out,'conversation-nowrap.png'),(await win.webContents.capturePage()).toPNG());
  await js(`(()=>{const math=document.createElement('div');math.id='code-wrap-math-probe';math.innerHTML='<div class="conversation-markdown"><pre><code class="language-math" style="white-space:normal;overflow-wrap:normal">raw_latex</code></pre></div>';document.body.append(math)})()`);
  await toggle(true);
  check('math code excluded from wrap override',await js('getComputedStyle(document.querySelector("#code-wrap-math-probe code")).whiteSpace==="normal"'));
  await toggle(false);
  check('math code excluded from nowrap override',await js('getComputedStyle(document.querySelector("#code-wrap-math-probe code")).whiteSpace==="normal"&&document.querySelector("#code-wrap-math-probe code").textContent==="raw_latex"'));
};
