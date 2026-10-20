// Code block chrome lives outside the editable DOM: controls and line numbers
// must never be copied into Markdown, a selection, or Vditor's undo history.
(()=>{
  const root=document.querySelector('#editor');
  if(!root)return;
  const layer=document.createElement('div');
  layer.id='code-block-layer';
  layer.setAttribute('aria-label','代码块工具');
  document.body.append(layer);
  const languages=[
    ['', '未指定语言'],['plaintext','纯文本'],['javascript','JavaScript'],['typescript','TypeScript'],
    ['python','Python'],['json','JSON'],['html','HTML'],['css','CSS'],['bash','Bash / Shell'],
    ['powershell','PowerShell'],['c','C'],['cpp','C++'],['csharp','C#'],['java','Java'],
    ['rust','Rust'],['go','Go'],['sql','SQL'],['yaml','YAML'],['xml','XML'],['markdown','Markdown'],
    ['latex','LaTeX'],['swift','Swift'],['kotlin','Kotlin'],['ruby','Ruby'],['php','PHP'],
    ['dockerfile','Dockerfile'],['diff','Diff'],['r','R'],['matlab','MATLAB'],['lua','Lua']
  ];
  const names=new Map(languages), aliases={js:'javascript',ts:'typescript',py:'python',sh:'bash',ps1:'powershell',cs:'csharp',md:'markdown',yml:'yaml',tex:'latex','c++':'cpp','c#':'csharp'};
  const diagramLanguages=new Set(['math','mermaid','flowchart','echarts','mindmap','markmap','plantuml','smiles','abc','graphviz']);
  let blocks=[],frame=0,picker=null,pickerTarget=null,observer=null,conversationRoot=null,conversationObserver=null,conversationResize=null;
  const codeLanguage=code=>[...code.classList].find(c=>c.startsWith('language-'))?.slice(9)||'';
  const label=value=>names.get(aliases[value]||value)||value||'未指定语言';
  const lineCount=value=>Math.max(1,value.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').length);
  function textOf(code){const copy=code.cloneNode(true);copy.querySelectorAll('.vditor-linenumber__rows,.vditor-linenumber__temp').forEach(n=>n.remove());return copy.textContent.replace(/\u200b/g,'');}
  function visible(node){return node?.isConnected&&node.getBoundingClientRect().height>0&&getComputedStyle(node).visibility!=='hidden';}
  function recordFor(node){return blocks.find(b=>b.wrapper?.contains(node)||b.pre===node||b.pre.contains(node));}
  function focusCode(record){
    if(mode==='sv')return;
    const code=record.sourceCode;if(!code?.isConnected)return;
    const pre=code.parentElement;
    if(getComputedStyle(pre).display==='none')pre.style.display='block';
    if(mode==='ir')record.wrapper.classList.add('vditor-ir__node--expand');
    const range=document.createRange();range.selectNodeContents(code);range.collapse(true);
    activeSurface()?.focus({preventScroll:true});getSelection().removeAllRanges();getSelection().addRange(range);
    window.EditorTools?.remember();refresh();
  }
  // Keep offsets, delimiters, whitespace, and CRLF in source mode intact.
  function fenceRecords(value){
    const lines=value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)||[];
    const records=[];let offset=0,current=null;
    for(const line of lines){
      const clean=line.replace(/[\r\n]+$/,''),match=clean.match(/^((?:[ \t]*>[ \t]?)*[ \t]{0,3})(`{3,}|~{3,})(.*)$/);
      if(match){
        if(!current){
          const info=match[3].match(/^([ \t]*)([-+\w#]*)(.*)$/);
          if(info&&!(match[2][0]==='`'&&match[3].includes('`'))){
            current={start:offset,languageStart:offset+match[1].length+match[2].length+info[1].length,
              languageEnd:offset+match[1].length+match[2].length+info[1].length+info[2].length,
              language:info[2],bodyStart:offset+line.length,body:'',prefix:match[1],fence:match[2]};
          }
        }else if(match[2][0]===current.fence[0]&&match[2].length>=current.fence.length&&!match[3].trim()){
          current.body=value.slice(current.bodyStart,offset).replace(/\r\n?/g,'\n');
          current.end=offset+line.length;
          records.push(current);current=null;
        }
      }
      offset+=line.length;
    }
    if(current){current.body=value.slice(current.bodyStart).replace(/\r\n?/g,'\n');current.end=value.length;records.push(current);}
    return records;
  }
  function rememberCaret(code){
    const selection=getSelection();if(!selection?.rangeCount||!code?.contains(selection.anchorNode))return null;
    const range=document.createRange();range.selectNodeContents(code);range.setEnd(selection.anchorNode,selection.anchorOffset);
    return range.toString().length;
  }
  function restoreCaret(code,offset){
    if(!code)return;
    const walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);let node,last;
    while(node=walker.nextNode()){last=node;if(offset<=node.length)break;offset-=node.length;}
    node=node||last||code;if(node===code)offset=0;else offset=Math.min(offset,node.length);
    const range=document.createRange();range.setStart(node,offset);range.collapse(true);
    activeSurface()?.focus({preventScroll:true});getSelection().removeAllRanges();getSelection().addRange(range);
    window.EditorTools?.remember();
  }
  function setLanguage(target,value){
    const record=typeof target==='number'?blocks[target]:target;
    if(!record||!record.pre.isConnected||document.body.dataset.readonly==='true')return false;
    value=String(value).trim().toLowerCase();
    if(!/^[-+a-z0-9_#]{0,40}$/.test(value))throw Error('语言名称只能包含字母、数字、下划线、加号、减号或 #');
    if(value===record.language){closePicker();return true;}
    const instance=editor.vditor,surface=activeSurface(),scrollNode=surface?.parentElement;
    const scrollTop=scrollNode?.scrollTop||0,caret=rememberCaret(record.sourceCode),index=record.index;
    // Record the previous content before changing only the language metadata.
    instance.undo.addToUndoStack(instance);
    let valueAfter;
    if(mode==='sv'){
      const markdown=editor.getValue(),fence=record.fence;
      if(!fence||markdown.slice(fence.languageStart,fence.languageEnd)!==record.language)return false;
      valueAfter=markdown.slice(0,fence.languageStart)+value+markdown.slice(fence.languageEnd);
    }else{
      if(!record.sourceCode?.isConnected)return false;
      record.sourceCode.className=value?'language-'+value:'';
      const info=record.wrapper.querySelector('[data-type="code-block-info"]');
      if(info)info.textContent=value;
      valueAfter=editor.getValue();
    }
    editor.setValue(valueAfter);
    changed(editor.getValue());
    closePicker();
    scan();
    const replacement=blocks[index];
    if(mode!=='sv'&&replacement){focusCode(replacement);restoreCaret(replacement.sourceCode,caret??0);}
    if(scrollNode)scrollNode.scrollTop=scrollTop;
    instance.undo.addToUndoStack(instance);
    refresh();
    return true;
  }
  function closePicker(){if(picker){picker.remove();picker=null;}pickerTarget=null;}
  function openPicker(record,button){
    closePicker();if(document.body.dataset.readonly==='true')return;
    pickerTarget=record;window.EditorTools?.remember();
    picker=document.createElement('div');picker.className='code-language-picker';picker.setAttribute('role','dialog');picker.setAttribute('aria-label','选择代码语言');
    const search=document.createElement('input');search.type='search';search.placeholder='搜索语言，或输入自定义名称';search.setAttribute('aria-label','搜索代码语言');
    search.autocomplete='off';search.spellcheck=false;
    const list=document.createElement('div');list.className='code-language-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','代码语言');
    const all=[...languages],known=new Set(all.map(([value])=>value));
    for(const value of window.hljs?.listLanguages?.().sort()||[])if(!known.has(value))all.push([value,value]);
    let selected=0,filtered=[];
    const choose=value=>{try{setLanguage(record,value);}catch(error){typeof fail==='function'?fail(error):console.error(error);}};
    const mark=()=>{list.querySelectorAll('button').forEach((button,i)=>{button.classList.toggle('current',i===selected);button.setAttribute('aria-selected',String(i===selected));});list.children[selected]?.scrollIntoView({block:'nearest'});};
    const render=()=>{
      const query=search.value.trim().toLowerCase();filtered=all.filter(([value,name])=>value.includes(query)||name.toLowerCase().includes(query));
      if(query&&/^[-+a-z0-9_#]{1,40}$/.test(query)&&!all.some(([value])=>value===query))filtered.unshift([query,'使用 “'+query+'”']);
      selected=0;list.replaceChildren();
      for(const [value,name]of filtered){
        const option=document.createElement('button');option.type='button';option.setAttribute('role','option');option.dataset.language=value;
        const title=document.createElement('span');title.textContent=name;const code=document.createElement('small');code.textContent=value===record.language?'✓':value;
        option.append(title,code);option.onmousedown=e=>e.preventDefault();option.onclick=()=>choose(value);list.append(option);
      }
      if(!filtered.length){const empty=document.createElement('p');empty.textContent='没有匹配语言';list.append(empty);}mark();
    };
    search.oninput=render;search.onkeydown=e=>{
      if(e.isComposing)return;
      if(e.key==='Escape'){e.preventDefault();closePicker();button.focus();}
      else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selected=Math.max(0,Math.min(filtered.length-1,selected+(e.key==='ArrowDown'?1:-1)));mark();}
      else if(e.key==='Enter'&&filtered[selected]){e.preventDefault();choose(filtered[selected][0]);}
    };
    picker.append(search,list);document.body.append(picker);
    const bounds=button.getBoundingClientRect();picker.style.left=Math.max(8,Math.min(bounds.left,innerWidth-296))+'px';picker.style.top=Math.max(8,Math.min(bounds.bottom+6,innerHeight-380))+'px';
    render();search.focus();
  }
  function newChrome(record){
    const chrome=document.createElement('div');chrome.className='code-block-chrome';chrome.dataset.codeIndex=record.index;
    const toolbar=document.createElement('div');toolbar.className='code-block-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','代码块');
    const language=document.createElement('button');language.type='button';language.className='code-language-button';language.setAttribute('aria-label','选择代码语言');language.setAttribute('aria-haspopup','dialog');
    const title=document.createElement('span');title.textContent=label(record.language);const arrow=document.createElement('span');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');language.append(title,arrow);
    language.onpointerdown=e=>e.preventDefault();language.onclick=()=>openPicker(record,language);language.disabled=document.body.dataset.readonly==='true';
    const controls=document.createElement('div');controls.className='code-block-actions';
    const numbers=document.createElement('button');numbers.type='button';numbers.className='code-number-toggle';numbers.textContent='行号';numbers.title='显示或隐藏代码块行号';numbers.setAttribute('aria-pressed',String(!!settings.codeLineNumbers));
    numbers.onpointerdown=e=>e.preventDefault();numbers.onclick=async()=>{try{if(window.PreferencesUI)await window.PreferencesUI.savePatch({codeLineNumbers:!settings.codeLineNumbers});else settings.codeLineNumbers=!settings.codeLineNumbers;apply();}catch(error){if(typeof fail==='function')fail(error);}};
    const copy=document.createElement('button');copy.type='button';copy.className='code-copy-button';copy.textContent='复制';copy.title='复制代码';
    copy.onpointerdown=e=>e.preventDefault();copy.onclick=async()=>{
      try{const text=textOf(record.sourceCode||record.code);if(typeof api==='function')await api('write-clipboard',text);else await navigator.clipboard.writeText(text);copy.textContent='已复制';setTimeout(()=>{if(copy.isConnected)copy.textContent='复制';},1200);}
      catch(error){if(typeof fail==='function')fail(error);}
    };
    controls.append(numbers,copy);toolbar.append(language,controls);
    const gutter=document.createElement('div');gutter.className='code-line-gutter';gutter.setAttribute('aria-hidden','true');
    chrome.append(toolbar,gutter);layer.append(chrome);
    Object.assign(record,{chrome,toolbar,gutter,languageButton:language});
  }
  function scan(){
    if(typeof editor==='undefined'||!editor?.vditor){layer.replaceChildren();blocks=[];return;}
    const previous=new Map(blocks.map(record=>[record.pre,record])),next=[];
    if(mode==='sv'){
      const fences=fenceRecords(editor.getValue()).filter(f=>!diagramLanguages.has(f.language));
      let fenceIndex=0;
      editor.vditor.preview?.element.querySelectorAll('pre > code').forEach(code=>{
        if(diagramLanguages.has(codeLanguage(code)))return;
        const normalized=value=>value.replace(/\r\n?/g,'\n').replace(/\n$/,'');
        const body=normalized(textOf(code));
        const match=fences.findIndex((f,i)=>i>=fenceIndex&&normalized(f.body.split('\n').map(line=>f.prefix&&line.startsWith(f.prefix)?line.slice(f.prefix.length):line).join('\n'))===body);
        // Indented Markdown can produce a preview pre without any fence.
        // Do not accidentally associate it with the next fenced block.
        if(match<0)return;const fence=fences[match];fenceIndex=match+1;
        next.push({pre:code.parentElement,code,language:fence.language,fence,index:next.length});
      });
    }else{
      activeSurface()?.querySelectorAll('[data-type="code-block"]').forEach(wrapper=>{
        const sourcePre=wrapper.querySelector('pre'),sourceCode=sourcePre?.querySelector('code');if(!sourceCode)return;
        const lang=codeLanguage(sourceCode);if(diagramLanguages.has(lang))return;
        const pres=[...wrapper.querySelectorAll('pre')].filter(pre=>pre.querySelector(':scope > code'));
        const pre=visible(sourcePre)?sourcePre:pres.find(visible)||sourcePre,code=pre.querySelector(':scope > code');
        next.push({wrapper,pre,code,sourceCode,language:lang,index:next.length});
      });
    }
    for(const record of next){
      // Only annotate pre, never code: WYSIWYG treats a code className as
      // the complete fence language, including any presentation-only classes.
      if(!record.pre.classList.contains('cypora-code-block'))record.pre.classList.add('cypora-code-block');
      const old=previous.get(record.pre);
      if(old&&old.language===record.language&&old.sourceCode===record.sourceCode){
        Object.assign(old,record);next[record.index]=old;previous.delete(record.pre);
        old.chrome.dataset.codeIndex=record.index;
        old.chrome.querySelector('.code-number-toggle').setAttribute('aria-pressed',String(!!settings.codeLineNumbers));
        old.languageButton.disabled=document.body.dataset.readonly==='true';
      }else newChrome(record);
    }
    previous.forEach(record=>record.chrome.remove());blocks=next;
    if(pickerTarget&&!pickerTarget.pre.isConnected)closePicker();
    position();
    syncConversationNumbers();
  }
  function linePositions(code){
    const style=getComputedStyle(code),lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.65;
    const count=lineCount(textOf(code)),top=code.getBoundingClientRect().top+parseFloat(style.paddingTop||0);
    // Rendered code uses pre-wrap; use actual character positions for long wrapped lines.
    const nodes=[],walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);let node,total=0;
    while(node=walker.nextNode()){if(node.parentElement.closest('.vditor-linenumber__rows,.vditor-linenumber__temp'))continue;nodes.push({node,start:total});total+=node.length;}
    const content=nodes.map(n=>n.node.textContent).join(''),starts=[0];for(let i=0;i<content.length;i++)if(content[i]==='\n'&&starts.length<count)starts.push(i+1);
    let at=0,last=top;
    return starts.map((offset,i)=>{
      while(at<nodes.length-1&&nodes[at].start+nodes[at].node.length<=offset)at++;
      const item=nodes[at];let y=top+i*lineHeight;
      if(item){
        const range=document.createRange(),local=Math.max(0,Math.min(offset-item.start,item.node.length));
        range.setStart(item.node,local);range.setEnd(item.node,Math.min(local+1,item.node.length));
        const rect=range.getClientRects()[0];if(rect?.height)y=rect.top+(rect.height-lineHeight)/2;else y=i?last+lineHeight:top;
      }
      last=y;return {top:y,height:lineHeight};
    });
  }
  function position(){
    const viewport=root.getBoundingClientRect();
    layer.style.clipPath=`inset(${Math.max(0,viewport.top)}px ${Math.max(0,innerWidth-viewport.right)}px ${Math.max(0,innerHeight-viewport.bottom)}px ${Math.max(0,viewport.left)}px)`;
    for(const record of blocks){
      const rect=record.pre.getBoundingClientRect();
      record.gutter.hidden=!settings.codeLineNumbers;
      record.chrome.hidden=!visible(record.pre)||rect.bottom<viewport.top||rect.top>viewport.bottom||!visible(root);
      if(record.chrome.hidden)continue;
      record.chrome.style.left=rect.left+'px';record.chrome.style.top=rect.top+'px';record.chrome.style.width=rect.width+'px';
      record.gutter.style.height=rect.height+'px';
      record.gutter.style.clipPath=`inset(38px 0 ${Math.max(0,record.code.offsetHeight-record.code.clientHeight)}px 0)`;
      if(settings.codeLineNumbers){
        const lines=linePositions(record.code),font=getComputedStyle(record.code);
        record.gutter.style.fontFamily=font.fontFamily;record.gutter.style.fontSize=font.fontSize;
        // Reuse rows while scrolling or typing to avoid flicker and accessibility noise.
        while(record.gutter.children.length>lines.length)record.gutter.lastChild.remove();
        while(record.gutter.children.length<lines.length){const row=document.createElement('span');row.textContent=record.gutter.children.length+1;record.gutter.append(row);}
        lines.forEach((line,i)=>{const row=record.gutter.children[i];row.style.top=(line.top-rect.top)+'px';row.style.height=line.height+'px';row.style.lineHeight=line.height+'px';});
      }
    }
  }
  function watchConversation(){
    const target=document.querySelector('#conversation-view');if(!target||target===conversationRoot)return;
    conversationObserver?.disconnect();conversationResize?.disconnect();conversationRoot=target;
    conversationObserver=new MutationObserver(refresh);
    conversationObserver.observe(target,{childList:true,subtree:true,characterData:true});
    conversationResize=new ResizeObserver(refresh);conversationResize.observe(target);
  }
  function syncConversationNumbers(){
    watchConversation();
    // Conversation preview uses Vditor's existing number rows. Resize those
    // rows from rendered text without re-highlighting or rewriting message text.
    conversationRoot?.querySelectorAll('.conversation-markdown pre>code:not(.language-math)').forEach(code=>{
      const rows=code.querySelector('.vditor-linenumber__rows');if(!rows||!visible(code))return;
      const lines=linePositions(code);
      [...rows.children].forEach((row,i)=>{if(!lines[i])return;const height=lines[i+1]?lines[i+1].top-lines[i].top:lines[i].height;row.style.height=Math.max(lines[i].height,height)+'px';});
    });
  }
  // A timeout also refreshes while the app window is hidden or occluded;
  // Chromium can suspend requestAnimationFrame in those states.
  function refresh(){clearTimeout(frame);frame=setTimeout(scan,16);}
  function apply(){
    document.body.dataset.codeLines=String(!!settings.codeLineNumbers);
    document.body.dataset.codeWrap=String(settings.codeWordWrap!==false);
    watchConversation();
    blocks.forEach(record=>{record.gutter.hidden=!settings.codeLineNumbers;record.chrome.querySelector('.code-number-toggle').setAttribute('aria-pressed',String(!!settings.codeLineNumbers));});
    // Vditor adds numbers inside rendered code only. Our overlay covers editing
    // and preview consistently and avoids serializable gutter nodes altogether.
    if(editor?.vditor)editor.vditor.options.preview.hljs.lineNumber=false;
    refresh();
  }
  observer=new MutationObserver(refresh);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style']});
  new ResizeObserver(refresh).observe(root);
  root.addEventListener('scroll',refresh,true);root.addEventListener('input',refresh,true);
  window.addEventListener('resize',refresh);document.addEventListener('selectionchange',refresh);
  document.addEventListener('pointerdown',event=>{if(picker&&!picker.contains(event.target)&&!event.target.closest?.('.code-language-button'))closePicker();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&picker)closePicker();
    if(event.altKey&&event.key==='Enter'){
      const record=recordFor(getSelection()?.anchorNode?.parentElement);
      if(record){event.preventDefault();openPicker(record,record.languageButton);}
    }
  });
  window.CodeBlocks={apply,refresh,setLanguage,recordFor,openPicker,fenceRecords,lineCount,get blocks(){return blocks;}};
})();
