// Typora-inspired editing preferences, implemented against the installed Vditor/Lute APIs.
// Changing a preference never rewrites the document. Typography transforms apply only
// to a new, non-IME keystroke in prose; imported text, code, math and chat edits stay literal.
(()=>{
  let context={},composing=false,prepared,generatedLiteralPair=null;
  const getSettings=()=>context.getSettings?.()||{};
  const getEditor=()=>context.getEditor?.();
  const bracketPairs={'(':')','[':']','{':'}','"':'"',"'":"'",'（':'）','【':'】','「':'」','《':'》'};
  const markdownPairs={'*':'*','_':'_','~':'~','`':'`','$':'$'};
  function configure(options={}){context={...context,...options};installLuteHook();}
  const repairedLutes=new WeakSet();
  function safeEmptyMathDOM(html){
    if(typeof html!=='string'||!html.includes('data-type="math-inline"'))return html;
    const template=document.createElement('template');template.innerHTML=html;let changed=false;
    for(const wrapper of template.content.querySelectorAll('.vditor-wysiwyg__block[data-type="math-inline"]')){
      const code=wrapper.querySelector('code[data-type="math-inline"]');if(!code)continue;
      if(code.textContent.replace(/[\u200b\u2038]/g,'').trim()!=='')continue;
      // Lute dereferences a missing text node when serializing an empty inline
      // formula. Feed its literal delimiters back to the same parser instead.
      const literal=document.createDocumentFragment();literal.append(document.createTextNode('$'));
      const content=code.cloneNode(true),walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);let text;
      while(text=walker.nextNode())text.textContent=text.textContent.replace(/\u200b/g,'');
      literal.append(...content.childNodes,document.createTextNode('$'));wrapper.replaceWith(literal);changed=true;
    }
    return changed?template.innerHTML:html;
  }
  function preserveFencedWhitespace(lute,method,input,html){
    if(typeof input!=='string'||typeof html!=='string'||!html.includes('data-type="code-block-open-marker"'))return html;
    // Lute 1.7.6's source renderer trims both ends of fenced code bodies.
    // Its IR renderer retains those bytes and understands list/quote nesting.
    // Compare the same parser's code nodes, never guess a fence using regex.
    const reference=document.createElement('template'),output=document.createElement('template');
    reference.innerHTML=method==='HTML2VditorSVDOM'?lute.HTML2VditorIRDOM(input):lute.Md2VditorIRDOM(input);
    output.innerHTML=html;
    const expected=[...reference.content.querySelectorAll('[data-type="code-block"] .vditor-ir__marker--pre > code')];
    const starts=[...output.content.querySelectorAll('[data-type="code-block-open-marker"]')];
    const ends=[...output.content.querySelectorAll('[data-type="code-block-close-marker"]')];
    if(expected.length!==starts.length||starts.length!==ends.length)return html;
    expected.forEach(code=>{if(window.Lute?.Caret)code.innerHTML=code.innerHTML.replaceAll(window.Lute.Caret,'<wbr>');});
    let repaired=false;
    for(let i=0;i<starts.length;i++){
      const open=starts[i],close=ends[i];if(open.parentNode!==close.parentNode)continue;
      let newline=open.nextSibling;while(newline&&newline!==close&&newline.dataset?.type!=='newline')newline=newline.nextSibling;
      if(!newline||newline===close)continue;
      const range=document.createRange();range.setStartAfter(newline);range.setEndBefore(close);
      const body=range.cloneContents(),first=body.querySelector('[data-type="text"]');if(!first)continue;
      // Prefix nodes belong to Markdown containers, not to code indentation.
      const prefix=[];for(let node=body.firstChild;node&&node!==first;node=node.nextSibling){
        if(!['blockquote-marker','padding'].includes(node.dataset?.type)){prefix.length=0;break;}
        prefix.push(node.cloneNode(true));
      }
      body.querySelectorAll('[data-type="blockquote-marker"],[data-type="padding"]').forEach(node=>node.remove());
      const actual=body.textContent,wanted=expected[i].textContent;
      if(actual===wanted||actual.trim()!==wanted.trim())continue;
      // Only boundary whitespace differs. All non-whitespace content must agree.
      // Keep caret markers from the reference renderer when rebuilding the body.
      const replacement=document.createDocumentFragment(),lines=expected[i].innerHTML.replace(/\r\n?/g,'\n').split('\n');
      for(let line=0;line<lines.length;line++){
        prefix.forEach(node=>replacement.append(node.cloneNode(true)));
        if(line===lines.length-1&&lines[line]==='')break;
        const span=document.createElement('span');span.dataset.type='text';span.innerHTML=lines[line];replacement.append(span);
        if(line<lines.length-1){
          const enter=document.createElement('span');enter.dataset.type='newline';
          const hidden=document.createElement('span');hidden.style.display='none';hidden.textContent='\n';
          enter.append(document.createElement('br'),hidden);replacement.append(enter);
        }
      }
      range.deleteContents();range.insertNode(replacement);repaired=true;
    }
    return repaired?output.innerHTML:html;
  }
  function protectFencedWhitespace(lute){
    if(repairedLutes.has(lute))return;repairedLutes.add(lute);
    for(const method of ['Md2VditorSVDOM','SpinVditorSVDOM','HTML2VditorSVDOM']){
      if(typeof lute[method]!=='function')continue;const original=lute[method];
      lute[method]=function(input,...args){return preserveFencedWhitespace(lute,method,input,original.call(this,input,...args));};
    }
    for(const method of ['VditorDOM2Md','VditorDOM2HTML','SpinVditorDOM']){
      if(typeof lute[method]!=='function')continue;const original=lute[method];
      lute[method]=function(input,...args){return original.call(this,safeEmptyMathDOM(input),...args);};
    }
  }
  function configureLute(lute,s=getSettings()){
    for(const [method,value] of [
      ['SetSub',!!s.markdownSubscript],['SetSup',!!s.markdownSuperscript],
      ['SetInlineMath',s.markdownInlineMath!==false],['SetSoftBreak2HardBreak',!!s.markdownSoftBreak]
    ])if(typeof lute?.[method]==='function')lute[method](value);
    protectFencedWhitespace(lute);return lute;
  }
  function installLuteHook(){
    if(!window.Lute?.New||window.Lute.New.cyporaPreferences)return;
    const original=window.Lute.New;
    const create=function(...args){return configureLute(original.apply(this,args));};
    Object.defineProperty(create,'cyporaPreferences',{value:true});window.Lute.New=create;
  }
  async function prepare(cdn){
    if(!window.Lute){
      prepared ||= new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src=cdn+'/dist/js/lute/lute.min.js';
        script.onload=resolve;script.onerror=()=>{prepared=null;reject(Error('Markdown 引擎载入失败'));};
        document.head.append(script);
      });
      await prepared;
    }
    installLuteHook();
  }
  function previewMarkdown(s=getSettings()){
    return {toc:true,mark:s.markdownHighlight!==false,footnotes:s.markdownFootnotes!==false,autoSpace:!!s.autoSpace,gfmAutoLink:s.autoLinks!==false};
  }
  function vditorOptions(s=getSettings()){return {tab:s.indentWithTabs?'\t':' '.repeat(s.tabSize||4)};}
  function apply(){
    installLuteHook();const editor=getEditor(),s=getSettings(),v=editor?.vditor;if(!v)return;
    configureLute(v.lute,s);v.options.tab=vditorOptions(s).tab;
    // Vditor exposes the ':' autocomplete trigger through hint.extend. Removing
    // that trigger disables hints without changing rendering of existing emoji.
    if(v.options.hint){
      const extensions=v.options.hint.extend||[];
      if(s.emojiAutocomplete===false){
        v.options.hint.extend=extensions.filter(item=>item.key!==':');
        if(v.hint?.element)v.hint.element.style.display='none';
        clearTimeout(v.hint?.timeId);
      }else if(!extensions.some(item=>item.key===':'))v.options.hint.extend=[...extensions,{key:':'}];
    }
    for(const mode of ['ir','wysiwyg','sv']){
      const surface=v[mode]?.element;if(!surface)continue;
      surface.style.tabSize=String(s.tabSize||4);
      surface.querySelectorAll('pre,code').forEach(el=>el.style.tabSize=String(s.codeIndentSize||4));
    }
  }
  function editingState(event){
    if(composing||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||context.isReadOnly?.()||context.isConversation?.())return null;
    const v=getEditor()?.vditor,surface=v?.[v.currentMode]?.element,selection=getSelection();
    if(!surface||surface.getAttribute('contenteditable')==='false'||!selection?.rangeCount)return null;
    const range=selection.getRangeAt(0),element=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    if(!surface.contains(range.startContainer)||!surface.contains(range.endContainer)||!surface.contains(event.target))return null;
    let code=element.closest('pre code,[data-type="code-block-code"],[data-type="code-block-content"],[data-type="code-block-info"],[data-type="math-block"],[data-type="math-inline"],.language-math,code');
    const sourceBlock=v.currentMode==='sv'?element.closest('[data-block="0"]'):null;
    if(!code&&sourceBlock?.querySelector('[data-type="code-block-open-marker"],[data-type="math-block-open-marker"]'))code=sourceBlock;
    return {v,surface,range,selection,element,code};
  }
  function offsets(root,range){
    const left=document.createRange();left.selectNodeContents(root);left.setEnd(range.startContainer,range.startOffset);
    const right=document.createRange();right.selectNodeContents(root);right.setEnd(range.endContainer,range.endOffset);
    return {start:left.toString().length,end:right.toString().length};
  }
  function rangeAt(root,start,end=start){
    const range=document.createRange(),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let total=0,node,begin,endPoint;
    while(node=walker.nextNode()){
      if(!begin&&start<=total+node.length)begin=[node,Math.max(0,start-total)];
      if(end<=total+node.length){endPoint=[node,Math.max(0,end-total)];break;}total+=node.length;
    }
    if(!begin){range.selectNodeContents(root);range.collapse(false);return range;}
    range.setStart(...begin);range.setEnd(...(endPoint||begin));return range;
  }
  function select(range){const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  function insert(text,back=0){
    document.execCommand('insertText',false,text);
    for(let n=0;n<back;n++)getSelection().modify('move','backward','character');
  }
  function adjacent(state){
    const block=state.v.currentMode==='sv'?state.surface:(state.element.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote')||state.surface);
    const pos=offsets(block,state.range),text=block.textContent;
    return {block,...pos,text,before:text.slice(0,pos.start),after:text.slice(pos.end)};
  }
  function proseIsLiteral(state,near){
    if(state.code)return true;
    // Source mode also needs to recognize a just-typed, not-yet-parsed fence.
    if(state.v.currentMode==='sv'){
      let fence=null;for(const line of near.before.split('\n')){
        const match=line.match(/^ {0,3}(`{3,}|~{3,})/);if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length)fence=null;}
      }if(fence)return true;
    }
    const line=near.before.split('\n').at(-1);
    return (line.match(/(?<!\\)`/g)||[]).length%2===1||(line.match(/(?<!\\)\$/g)||[]).length%2===1;
  }
  function generatedInline(state,pair){
    if(pair?.v!==state.v||!state.code||state.v.currentMode==='sv')return null;
    const code=state.code.tagName==='CODE'?state.code:state.code.querySelector('code');
    if(!code||!code.contains(state.range.startContainer)||!code.contains(state.range.endContainer))return null;
    if(pair.key==='$'&&code.dataset.type!=='math-inline')return null;
    if(pair.key==='`'&&code.dataset.type==='math-inline')return null;
    const after=state.range.cloneRange();after.selectNodeContents(code);after.setStart(state.range.endContainer,state.range.endOffset);
    if(after.toString().replace(/\u200b/g,'')!=='')return null;
    const wrapper=state.v.currentMode==='ir'?code.closest('.vditor-ir__node'):(pair.key==='$'?code.closest('span[data-type="math-inline"]'):code);
    return wrapper?{code,wrapper}:null;
  }
  function type(event){
    if(event.defaultPrevented||event.inputType!=='insertText'||!event.data||[...event.data].length!==1)return;
    const state=editingState(event);if(!state)return;const s=getSettings(),near=adjacent(state);
    const key=event.data,before=near.before.at(-1)||'',after=near.after[0]||'';
    const ownPair=generatedLiteralPair;
    const ownInline=s.autoPairMarkdown&&state.range.collapsed&&key===ownPair?.key?generatedInline(state,ownPair):null;
    if(ownInline){
      consume(event);const range=document.createRange();range.setStartAfter(ownInline.wrapper);range.collapse(true);select(range);generatedLiteralPair=null;return;
    }
    if(s.autoPairMarkdown&&state.range.collapsed&&ownPair?.v===state.v&&key===ownPair.key&&near.before.startsWith(ownPair.before+key)&&after===key){
      consume(event);getSelection().modify('move','forward','character');generatedLiteralPair=null;return;
    }
    if(proseIsLiteral(state,near))return;
    if(before==='\\')return;
    if(s.smartQuotes&&(key==='"'||key==="'")){
      consume(event);const open=!before||/[\s([{（【—–]/.test(before);
      insert(key==='"'?(open?'“':'”'):(open?'‘':'’'));return;
    }
    if(s.smartDashes&&key==='-'&&state.range.collapsed&&near.before.endsWith('--')){
      // Do not convert list syntax, YAML fences, or horizontal-rule prefixes.
      if(/^\s*[-]+$/.test(near.before.split('\n').at(-1)))return;
      consume(event);select(rangeAt(near.block,near.start-2,near.start));insert('—');return;
    }
    const pairs={...(s.autoPairBrackets?bracketPairs:{}),...(s.autoPairMarkdown?markdownPairs:{})};
    if(state.range.collapsed&&after===key&&Object.values(pairs).includes(key)){consume(event);getSelection().modify('move','forward','character');return;}
    const close=pairs[key];if(!close)return;
    if(state.range.collapsed&&after&&!/[\s)\]}）》】」'"]/.test(after))return;
    if((key==='_'||key==="'")&&/[\p{L}\p{N}]/u.test(before))return;
    consume(event);
    if(key==='$'||key==='`')generatedLiteralPair={v:state.v,key,before:near.before};
    insert(key+state.range.toString()+close,close.length);
  }
  function indent(event,state){
    if(event.key!=='Tab'||state.element.closest('td,th')||(!state.code&&state.element.closest('li')))return false;
    const s=getSettings(),root=state.code&&state.code.tagName==='CODE'?state.code:(state.v.currentMode==='sv'?state.surface:state.element.closest('[data-block="0"],p')||state.surface);
    const pos=offsets(root,state.range),text=root.textContent,width=state.code?(s.codeIndentSize||4):(s.tabSize||4),unit=s.indentWithTabs?'\t':' '.repeat(width);
    if(!event.shiftKey&&state.range.collapsed){consume(event);insert(unit);return true;}
    const hadSelection=!state.range.collapsed,start=text.lastIndexOf('\n',pos.start-1)+1;
    let end=text.indexOf('\n',pos.end);if(end<0)end=text.length;
    const segment=text.slice(start,end),next=segment.split('\n').map(line=>event.shiftKey?line.replace(new RegExp('^(?:\\t| {1,'+width+'})'),''):unit+line).join('\n');
    consume(event);if(next===segment)return true;select(rangeAt(root,start,end));insert(next);
    // Reselect the edited lines for repeated Tab / Shift+Tab operations.
    if(hadSelection)select(rangeAt(root,start,start+next.length));
    return true;
  }
  function keydown(event){
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Escape'].includes(event.key))generatedLiteralPair=null;
    if(event.defaultPrevented)return;const state=editingState(event);if(!state)return;
    // Cypora hides Vditor's emoji toolbar. Vditor otherwise omits keyboard
    // selection when ':' is its only hint provider, although the popup is shown.
    if(getSettings().emojiAutocomplete!==false&&state.v.hint?.element.style.display==='block'&&['ArrowUp','ArrowDown','Enter'].includes(event.key)){
      if(state.v.hint.select(event,state.v)){consume(event);return;}
    }
    if(indent(event,state))return;
    if(event.key!=='Backspace'||!state.range.collapsed)return;
    const s=getSettings(),near=adjacent(state),ownPair=generatedLiteralPair,ownInline=s.autoPairMarkdown?generatedInline(state,ownPair):null;
    if(ownInline&&ownInline.code.textContent.replace(/\u200b/g,'')===''){
      consume(event);const range=document.createRange();range.selectNode(ownInline.wrapper);select(range);document.execCommand('delete');generatedLiteralPair=null;return;
    }
    if(s.autoPairMarkdown&&ownPair?.v===state.v&&near.before===ownPair.before+ownPair.key&&near.after.startsWith(ownPair.key)){
      consume(event);select(rangeAt(near.block,near.start-1,near.start+1));document.execCommand('delete');generatedLiteralPair=null;return;
    }
    if(proseIsLiteral(state,near))return;
    const pairs={...(s.autoPairBrackets?bracketPairs:{}),...(s.autoPairMarkdown?markdownPairs:{})};
    if(pairs[near.before.at(-1)]===near.after[0]&&near.after[0]){
      consume(event);select(rangeAt(near.block,near.start-1,near.start+1));document.execCommand('delete');
    }
  }
  document.addEventListener('compositionstart',()=>composing=true,true);
  document.addEventListener('compositionend',()=>composing=false,true);
  document.addEventListener('pointerdown',()=>generatedLiteralPair=null,true);
  document.addEventListener('beforeinput',type,true);
  document.addEventListener('keydown',keydown,true);
  window.EditorPreferences={configure,prepare,apply,previewMarkdown,vditorOptions,configureLute};
})();
