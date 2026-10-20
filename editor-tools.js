// Semantic editing, selection bookmarks, and a CRLF-safe document outline.
(()=>{
  let bookmark=null,contextNode=null,outlineItems=[],outlineKey='',collapsed=new Set(),outlineFrame=0,toolbarDispatchDepth=0;
  const esc=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  function selection(){const s=getSelection();return s?.rangeCount?s.getRangeAt(0):null;}
  function remember(){const r=selection(),el=activeSurface();if(r&&el?.contains(r.commonAncestorContainer))bookmark=r.cloneRange();}
  function restore(){const el=activeSurface();if(!el)return null;el.focus();const s=getSelection();if(bookmark&&el.contains(bookmark.commonAncestorContainer)){s.removeAllRanges();s.addRange(bookmark.cloneRange());}else if(!s.rangeCount||!el.contains(s.anchorNode)){const r=document.createRange();r.selectNodeContents(el);r.collapse(false);s.removeAllRanges();s.addRange(r);}return selection();}
  function nodeElement(node){return node?.nodeType===3?node.parentElement:node;}
  function plain(node){const clone=node.cloneNode(true);clone.querySelectorAll?.('.vditor-ir__marker,.vditor-ir__preview,.vditor-wysiwyg__preview').forEach(n=>n.remove());return clone.textContent;}
  function block(){const el=nodeElement(selection()?.startContainer);return el?.closest('td,th,li,p,h1,h2,h3,h4,h5,h6,pre,blockquote,[data-block="0"]');}
  function pick(node,contents=false){const r=document.createRange();contents?r.selectNodeContents(node):r.selectNode(node);const s=getSelection();s.removeAllRanges();s.addRange(r);bookmark=r.cloneRange();return r;}
  function markdown(node){if(mode==='sv')return node.textContent;const l=editor.vditor.lute;return mode==='ir'?l.VditorIRDOM2Md(node.outerHTML):l.VditorDOM2Md(node.outerHTML);}
  function sync(record=true){changed(editor.getValue());remember();if(record)editor.vditor.undo.addToUndoStack(editor.vditor);}
  function insert(md){editor.insertMD(md);sync();}
  function replaceBlock(md,node=block()){
    if(!node||!activeSurface().contains(node)){insert(md);return;}
    if(mode==='sv'){pick(node);editor.updateValue(esc(md));sync();return;}
    const surface=activeSurface(),l=editor.vditor.lute,template=document.createElement('template');
    template.innerHTML=mode==='ir'?l.Md2VditorIRDOM(md):l.Md2VditorDOM(md);
    // Replace structural blocks directly; insertHTML can merge neighbors or move a table.
    if(node.tagName==='LI'&&template.content.firstElementChild?.matches('ul,ol')){const list=template.content.firstElementChild;template.content.replaceChildren(...list.childNodes);}
    let top=node;while(top.parentElement!==surface&&top.parentElement)top=top.parentElement;
    const index=[...surface.children].indexOf(top);node.replaceWith(template.content);
    const value=editor.getValue();editor.setValue(value);
    const target=surface.children[Math.min(Math.max(0,index),surface.children.length-1)];if(target){const r=pick(target,true);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);}
    sync();
  }
  function dispatchToolbar(button){toolbarDispatchDepth++;try{button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));}finally{toolbarDispatchDepth--;}}
  function toolbar(type){const b=editor.vditor.toolbar.element.querySelector(`[data-type="${type}"]`);if(!b)throw Error('此操作尚未提供');dispatchToolbar(b);sync(!['undo','redo'].includes(type));}
  function positionAt(offset){const el=activeSurface(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(offset<=n.length)return [n,offset];offset-=n.length;}return [el,el.childNodes.length];}
  function sourceLine(transform){const el=activeSurface(),r=selection(),before=document.createRange();before.selectNodeContents(el);before.setEnd(r.startContainer,r.startOffset);const offset=before.toString().length,value=editor.getValue(),start=value.lastIndexOf('\n',Math.max(0,offset-1))+1,end=value.indexOf('\n',offset),stop=end<0?value.length:end,line=value.slice(start,stop);const next=transform(line);editor.setValue(value.slice(0,start)+next+value.slice(stop));const p=positionAt(start+next.length),nr=document.createRange();nr.setStart(...p);nr.collapse(true);getSelection().removeAllRanges();getSelection().addRange(nr);sync();}
  function indentUnit(code=false){return settings.indentWithTabs?'\t':' '.repeat([2,4,8].includes(Number(code?settings.codeIndentSize:settings.tabSize))?Number(code?settings.codeIndentSize:settings.tabSize):4);}
  function sourceOffsets(){
    const surface=activeSurface(),range=selection();if(!range||!surface.contains(range.commonAncestorContainer))return null;
    const before=document.createRange();before.selectNodeContents(surface);before.setEnd(range.startContainer,range.startOffset);
    const start=before.toString().length;before.setEnd(range.endContainer,range.endOffset);
    return {start,end:before.toString().length};
  }
  function sourceReplace(start,end,text,select=false){
    const value=editor.getValue(),expected=value.slice(0,start)+text+value.slice(end);editor.setValue(expected);
    // Lute's source renderer can trim the first code line's leading whitespace.
    // Restore the source difference in the editable DOM before recording or saving.
    const actual=editor.getValue();
    if(actual!==expected){
      let left=0,right=0;
      while(left<actual.length&&left<expected.length&&actual[left]===expected[left])left++;
      while(right<actual.length-left&&right<expected.length-left&&actual[actual.length-1-right]===expected[expected.length-1-right])right++;
      const repair=document.createRange();repair.setStart(...positionAt(left));repair.setEnd(...positionAt(actual.length-right));repair.deleteContents();repair.insertNode(document.createTextNode(expected.slice(left,expected.length-right)));
    }
    const range=document.createRange();range.setStart(...positionAt(start+(select?0:text.length)));range.setEnd(...positionAt(start+text.length));
    activeSurface().focus();getSelection().removeAllRanges();getSelection().addRange(range);sync();
  }
  function sourceLines(transform){
    const offsets=sourceOffsets();if(!offsets)return;
    const value=editor.getValue(),start=value.lastIndexOf('\n',Math.max(0,offsets.start-1))+1;
    const last=offsets.end>offsets.start&&value[offsets.end-1]==='\n'?offsets.end-1:offsets.end;
    const next=value.indexOf('\n',last),end=next<0?value.length:next;
    sourceReplace(start,end,transform(value.slice(start,end)),offsets.end>offsets.start);
  }
  function headingMarkdown(text,level){
    const content=text.replace(/^\s{0,3}#{1,6}[ \t]+/,'').replace(/\n[=-]+[ \t]*$/,'');
    return !level?content:settings.headingStyle==='setext'&&level<3?content+'\n'+(level===1?'=':'-').repeat(Math.max(3,content.length)):'#'.repeat(level)+' '+content;
  }
  function heading(level){
    if(mode==='sv'){
      const offsets=sourceOffsets(),value=editor.getValue();if(!offsets)return;
      let start=value.lastIndexOf('\n',Math.max(0,offsets.start-1))+1,next=value.indexOf('\n',offsets.start),end=next<0?value.length:next;
      if(/^[=-]+[ \t]*$/.test(value.slice(start,end))&&start>0){const previous=value.lastIndexOf('\n',start-2)+1;if(value.slice(previous,start-1).trim())start=previous;}
      else if(end<value.length){const stop=value.indexOf('\n',end+1),nextEnd=stop<0?value.length:stop;if(/^[=-]+[ \t]*$/.test(value.slice(end+1,nextEnd)))end=nextEnd;}
      sourceReplace(start,end,headingMarkdown(value.slice(start,end),level));return;
    }
    const current=block();
    if(current?.matches('p,h1,h2,h3,h4,h5,h6')){
      replaceBlock(headingMarkdown(markdown(current).trim(),level)+'\n',current);return;
    }
    if(level){
      const button=editor.vditor.toolbar.element.querySelector(`[data-tag="h${level}"]`);dispatchToolbar(button);
      const h=nodeElement(selection()?.startContainer)?.closest('h1,h2,h3,h4,h5,h6');
      if(h){
        const setext=settings.headingStyle==='setext'&&level<3,marker=setext?(level===1?'=':'-'):'#';
        h.setAttribute('data-marker',marker);
        const label=h.querySelector('[data-type="heading-marker"]');
        if(label){label.textContent=setext?'\n'+marker.repeat(Math.max(3,plain(h).length)):'#'.repeat(level)+' ';label.dataset.render=setext?'2':'1';}
      }
      sync();
    }else{const b=block();if(b)replaceBlock(headingMarkdown(markdown(b).trim(),0),b);}
  }
  function listCommand(id){
    const marker=['-','*','+'].includes(settings.unorderedListMarker)?settings.unorderedListMarker:'*';
    if(mode==='sv'){
      sourceLines(text=>{
        const lines=text.split('\n'),desired=id==='ordered-list'?/^[ \t]*\d+[.)] /:id==='check'?/^[ \t]*[-*+] \[[ xX]\] /:/^[ \t]*[-*+] (?!\[[ xX]\] )/;
        const remove=lines.filter(line=>line.trim()).every(line=>desired.test(line));
        let number=0;return lines.map(line=>{
          if(!line.trim())return line;number++;const prefix=line.match(/^[ \t]*/)[0],content=line.slice(prefix.length).replace(/^(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] )/,'');
          return prefix+(remove?'':id==='ordered-list'?(settings.orderedListStyle==='repeat'?1:number)+'. ':marker+(id==='check'?' [ ] ':' '))+content;
        }).join('\n');
      });return;
    }
    const range=selection(),surface=activeSurface();
    const selected=range&&!range.collapsed?[...surface.children].filter(node=>range.intersectsNode(node)):[];
    if(selected.length>1&&selected.every(node=>node.matches('p,h1,h2,h3,h4,h5,h6'))){
      const md=selected.map((node,index)=>{
        const content=headingMarkdown(markdown(node).trim(),0),prefix=id==='ordered-list'?(settings.orderedListStyle==='repeat'?1:index+1)+'. ':marker+(id==='check'?' [ ] ':' ');
        return prefix+content.replace(/\n/g,'\n'+' '.repeat(prefix.length));
      }).join('\n\n')+'\n';
      const template=document.createElement('template'),l=editor.vditor.lute;
      template.innerHTML=mode==='ir'?l.Md2VditorIRDOM(md):l.Md2VditorDOM(md);
      const list=template.content.firstElementChild;
      if(id==='ordered-list'&&settings.orderedListStyle==='repeat')list?.querySelectorAll(':scope > li').forEach(li=>li.dataset.marker='1.');
      selected[0].before(template.content);selected.forEach(node=>node.remove());
      if(list){const next=pick(list.firstElementChild||list,true);next.collapse(true);getSelection().removeAllRanges();getSelection().addRange(next);}
      sync();return;
    }
    const button=editor.vditor.toolbar.element.querySelector(`[data-type="${id}"]`);if(!button)return;
    dispatchToolbar(button);
    const list=nodeElement(selection()?.startContainer)?.closest(id==='ordered-list'?'ol':'ul');
    if(list){
      if(id!=='ordered-list')list.setAttribute('data-marker',marker);
      let number=Number(list.getAttribute('start'))||1;
      for(const li of list.children){if(li.tagName!=='LI')continue;li.setAttribute('data-marker',id==='ordered-list'?(settings.orderedListStyle==='repeat'?1:number++)+'.':marker);}
    }
    sync();
  }
  function codeIndent(outdent=false){
    const unit=indentUnit(true),transform=text=>text.split('\n').map(line=>outdent?line.replace(new RegExp('^(?:\\t| {1,'+unit.length+'})'),''):line?unit+line:line).join('\n');
    if(mode==='sv'){
      const value=editor.getValue(),offsets=sourceOffsets();if(!offsets)return;
      let fence=null,bodyStart=0,bodyEnd=value.length,offset=0;
      for(const line of value.split('\n')){
        const match=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if(match&&!fence){fence=match[1];bodyStart=offset+line.length+1;}
        else if(match&&fence&&match[1][0]===fence[0]&&match[1].length>=fence.length&&!match[2].trim()){
          if(offsets.start>=bodyStart&&offsets.end<=offset){bodyEnd=offset;break;}fence=null;
        }
        offset+=line.length+1;
      }
      if(!fence||offsets.start<bodyStart||offsets.end>bodyEnd){toast('请将光标放在代码内容中');return;}
      const start=Math.max(bodyStart,value.lastIndexOf('\n',Math.max(0,offsets.start-1))+1);
      const last=offsets.end>offsets.start&&value[offsets.end-1]==='\n'?offsets.end-1:offsets.end,next=value.indexOf('\n',last);
      sourceReplace(start,Math.min(bodyEnd,next<0?value.length:next),transform(value.slice(start,Math.min(bodyEnd,next<0?value.length:next))),offsets.end>offsets.start);return;
    }
    const record=codeRecord()||window.CodeBlocks?.blocks.find(b=>b.sourceCode?.contains(selection()?.startContainer));
    const code=record?.sourceCode||contextElement('pre > code');if(!code)return;
    const sourceCodes=()=>[...activeSurface().querySelectorAll('pre > code')].filter(node=>!node.closest('.vditor-ir__preview,.vditor-wysiwyg__preview'));
    const codeIndex=sourceCodes().indexOf(code);
    let range=selection();
    if(!range||!code.contains(range.startContainer)||!code.contains(range.endContainer))range=pick(code,true);
    const before=document.createRange();before.selectNodeContents(code);before.setEnd(range.startContainer,range.startOffset);const offset=before.toString().length;
    before.setEnd(range.endContainer,range.endOffset);const endOffset=before.toString().length,value=code.textContent;
    const start=value.lastIndexOf('\n',Math.max(0,offset-1))+1,last=endOffset>offset&&value[endOffset-1]==='\n'?endOffset-1:endOffset,next=value.indexOf('\n',last),end=next<0?value.length:next;
    code.textContent=value.slice(0,start)+transform(value.slice(start,end))+value.slice(end);
    const after=editor.getValue();editor.setValue(after);
    window.CodeBlocks?.refresh();
    const replacement=sourceCodes()[codeIndex];
    if(replacement?.isConnected){
      replacement.parentElement.style.display='block';replacement.closest('[data-type="code-block"]')?.classList.add('vditor-ir__node--expand');
      const r=document.createRange(),position=Math.min(replacement.textContent.length,start+transform(value.slice(start,end)).length);
      const walker=document.createTreeWalker(replacement,NodeFilter.SHOW_TEXT);let node,last,left=position;
      while(node=walker.nextNode()){last=node;if(left<=node.length)break;left-=node.length;}
      node=node||last||replacement;r.setStart(node,node===replacement?0:Math.min(left,node.length));r.collapse(true);activeSurface().focus();getSelection().removeAllRanges();getSelection().addRange(r);
    }
    sync();
  }
  function wrap(before,after=before){const r=selection();let text=r.toString();if(!r.collapsed&&mode!=='sv'){const div=document.createElement('div');div.append(r.cloneContents());const l=editor.vditor.lute;text=mode==='ir'?l.VditorIRDOM2Md(div.innerHTML).trim():l.VditorDOM2Md(div.innerHTML).trim();}insert(before+text+after);}
  function contextElement(selector){const el=(contextNode?.isConnected?contextNode:nodeElement(selection()?.startContainer))?.closest(selector);return el&&el!==activeSurface()&&activeSurface()?.contains(el)?el:null;}
  async function ask(title,value='',description=''){return window.Workspace.inputDialog({title,value,description});}
  const readOnlyCommand=id=>/^(copy(?:-|$)|select-|document-|refresh-)/.test(id)||['code-copy','math-copy','table-copy','link-copy','link-open','image-copy','image-copy-content','image-open','image-reveal','image-save','image-reload','code-lines','code-wrap'].includes(id);
  function replaceInline(md,node){
    const template=document.createElement('template'),l=editor.vditor.lute;
    // Parse in an inline context: a standalone <img> otherwise becomes an HTML
    // block, splitting the surrounding paragraph when Lute serializes it.
    const inline='cyporaInlineStart'+md+'cyporaInlineEnd';
    template.innerHTML=mode==='ir'?l.Md2VditorIRDOM(inline):l.Md2VditorDOM(inline);
    const p=template.content.firstElementChild;
    const walker=document.createTreeWalker(template.content,NodeFilter.SHOW_TEXT),texts=[];let text;
    while(text=walker.nextNode())texts.push(text);
    if(texts.length){texts[0].textContent=texts[0].textContent.replace(/^cyporaInlineStart/,'');texts.at(-1).textContent=texts.at(-1).textContent.replace(/cyporaInlineEnd$/,'');}
    if(p?.tagName==='P'&&template.content.children.length===1)node.replaceWith(...p.childNodes);
    else node.replaceWith(template.content);
    editor.setValue(editor.getValue());sync();
  }
  function imageHTML(img,change={}){
    // Do not serialize resolved URLs, editor classes or event handlers.
    const clean=document.createElement('img');
    for(const attr of ['src','alt','title','width','height'])if(img.hasAttribute(attr))clean.setAttribute(attr,img.getAttribute(attr));
    for(const [key,value] of Object.entries(change))value===null?clean.removeAttribute(key):clean.setAttribute(key,value);
    return clean.outerHTML;
  }
  function imageTarget(node=contextNode||nodeElement(selection()?.startContainer)){
    const element=nodeElement(node);if(!activeSurface()?.contains(element))return null;
    const html=element?.closest('[data-type="html-inline"],[data-type="html-block"]');
    if(html){
      const source=html.querySelector('code')?.textContent||html.textContent,template=document.createElement('template');
      template.innerHTML=source.trim();
      if(template.content.children.length===1&&template.content.firstElementChild?.tagName==='IMG')return {img:template.content.firstElementChild,wrapper:html,isHTML:true};
    }
    const live=element?.closest('img')||element?.closest('[data-type="img"]')?.querySelector('img');
    if(!live)return null;
    const wrapper=mode==='ir'?live.closest('[data-type="img"]')||live:live;
    const div=document.createElement('div');div.innerHTML=editor.vditor.lute.Md2HTML(markdown(wrapper));
    // IR preview images omit title; recover it from the authored Markdown.
    const img=div.querySelector('img')||live;
    return {img,wrapper,isHTML:false};
  }
  function imageMarkdown(img){
    const alt=(img.getAttribute('alt')||'').replace(/[\\[\]]/g,'\\$&'),src=(img.getAttribute('src')||'').replace(/[\s<>()]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),title=img.getAttribute('title');
    return '!['+alt+'](<'+src+'>'+(title?' "'+title.replace(/["\\]/g,'\\$&')+'"':'')+')';
  }
  const imageURL=img=>{try{return new URL(img.getAttribute('src'),document.baseURI).href;}catch{return '';}};
  function codeRecord(){
    if(mode!=='sv')return window.CodeBlocks?.recordFor(contextNode||nodeElement(selection()?.startContainer));
    const offsets=sourceOffsets();return offsets&&window.CodeBlocks?.blocks.find(record=>record.fence&&offsets.start>=record.fence.start&&offsets.start<record.fence.end);
  }
  function replaceImage(md,wrapper){if(wrapper.dataset.type==='html-block')replaceBlock(md,wrapper);else replaceInline(md,wrapper);}
  function cleanSelection(){
    const range=selection(),div=document.createElement('div');div.append(range.cloneContents());
    if(mode==='sv')div.innerHTML=editor.vditor.lute.Md2HTML(range.toString());
    else{
      const lute=editor.vditor.lute,md=mode==='ir'?lute.VditorIRDOM2Md(div.innerHTML):lute.VditorDOM2Md(div.innerHTML);
      div.innerHTML=lute.Md2HTML(md);
    }
    div.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
    for(const element of div.querySelectorAll('*'))for(const attr of [...element.attributes]){
      if(!['href','src','alt','title','colspan','rowspan'].includes(attr.name)||(['href','src'].includes(attr.name)&&/^\s*(?:javascript|vbscript|data):/i.test(attr.value)))element.removeAttribute(attr.name);
    }
    return {text:div.textContent,html:div.innerHTML};
  }
  async function tableCommand(id){
    const cell=contextElement('td,th'),table=cell?.closest('table')||contextElement('table');if(!table)return;
    if(id==='table-copy'){await api('write-clipboard',markdown(table));return;}
    if(id==='table-prettify'){replaceBlock(markdown(table),table);return;}
    if(id==='table-delete'){pick(table);insert('');return;}
    const clone=table.cloneNode(true),rows=[...clone.rows],ri=cell?.parentElement.rowIndex??0,ci=cell?.cellIndex??0,row=rows[ri],count=rows[0]?.cells.length||1;
    const empty=(tag='td')=>{const c=document.createElement(tag);c.textContent=' ';return c;};
    if(id==='table-row-before'||id==='table-row-after'){const newRow=document.createElement('tr');for(let i=0;i<count;i++)newRow.append(empty());if(ri===0)rows[1]?rows[1].before(newRow):(clone.tBodies[0]||clone.createTBody()).append(newRow);else row[id.endsWith('before')?'before':'after'](newRow);}
    if(id==='table-delete-row'){if(ri===0){if(rows.length===1)return;[...rows[1].cells].forEach((c,i)=>row.cells[i].innerHTML=c.innerHTML);rows[1].remove();}else row.remove();}
    if(id==='table-column-before'||id==='table-column-after')rows.forEach(r=>r.cells[ci][id.endsWith('before')?'before':'after'](empty(r.cells[ci].tagName.toLowerCase())));
    if(id==='table-delete-column'){if(count===1){pick(table);insert('');return;}rows.forEach(r=>r.cells[ci]?.remove());}
    if(id==='table-row-up'&&ri>1)row.previousElementSibling.before(row);
    if(id==='table-row-down'&&ri>0&&row.nextElementSibling)row.nextElementSibling.after(row);
    if(id==='table-column-left'&&ci>0)rows.forEach(r=>r.cells[ci-1].before(r.cells[ci]));
    if(id==='table-column-right'&&ci<count-1)rows.forEach(r=>r.cells[ci+1].after(r.cells[ci]));
    if(id.startsWith('table-align-'))rows.forEach(r=>{r.cells[ci].setAttribute('align',id.slice(12));r.cells[ci].style.textAlign=id.slice(12);});
    replaceBlock(markdown(clone),table);
  }
  async function execute(id){
    if(window.Conversations?.active){
      if(document.body.dataset.readonly==='true'&&!/^(copy|select|document-)/.test(id))return;
      if(id==='undo')return window.Conversations.undo();
      if(id==='redo')return window.Conversations.redo();
      if(id==='copy'||id==='copy-plain'){await api('write-clipboard',getSelection()?.toString()||'');return;}
      toast('请在对话中的消息上点击“编辑”');return;
    }
    if(!ready)return;restore();if(!['undo','redo'].includes(id))editor.vditor.undo.addToUndoStack(editor.vditor);
    if(document.body.dataset.readonly==='true'&&!readOnlyCommand(id))return;
    if(id==='code-lines'||id==='code-wrap'){const key=id==='code-lines'?'codeLineNumbers':'codeWordWrap';await window.PreferencesUI.savePatch({[key]:!settings[key]});return;}
    if(id==='code-language'){const record=codeRecord();if(record)window.CodeBlocks.openPicker(record,record.languageButton);return;}
    if(id==='insert-before'||id==='insert-after'){
      if(mode==='sv'){
        const record=codeRecord();
        if(record){const offset=id==='insert-before'?record.fence.start:record.fence.end;sourceReplace(offset,offset,'\n\n');const range=document.createRange();range.setStart(...positionAt(offset));range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);remember();return;}
      }
      const target=contextElement('[data-type="code-block"],[data-type="math-block"]')||contextElement('pre');
      if(target){const p=document.createElement('p');p.setAttribute('data-block','0');p.innerHTML='<wbr>';target[id==='insert-before'?'before':'after'](p);const r=pick(p,true);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);sync();return;}
    }
    if(/^h[1-6]$/.test(id))return heading(Number(id[1]));
    if(id==='paragraph')return heading(0);
    if(['list','ordered-list','check'].includes(id))return listCommand(id);
    if(id==='code-indent'||id==='code-outdent')return codeIndent(id==='code-outdent');
    if((id==='indent'||id==='outdent')&&mode!=='sv'&&contextElement('pre > code'))return codeIndent(id==='outdent');
    if(mode==='sv'&&(id==='indent'||id==='outdent')){
      sourceLines(text=>text.split('\n').map(line=>id==='indent'?indentUnit()+line:line.replace(new RegExp('^(?:\\t| {1,'+indentUnit().length+'})'),'')).join('\n'));return;
    }
    if(mode==='sv'&&(id==='heading-up'||id==='heading-down')){
      const offsets=sourceOffsets(),value=editor.getValue();if(!offsets)return;
      const start=value.lastIndexOf('\n',Math.max(0,offsets.start-1))+1,following=value.slice(start).split('\n'),atx=following[0].match(/^(#{1,6})\s+/);
      const level=atx?atx[1].length:/^=+$/.test(following[0])||/^=+$/.test(following[1]||'')?1:/^-+$/.test(following[0])||/^-+$/.test(following[1]||'')?2:2;
      return heading(Math.max(1,Math.min(6,level+(id==='heading-up'?-1:1))));
    }
    if(mode==='sv'&&['quote','list','ordered-list','check','indent','outdent','task-toggle','task-complete','task-incomplete','code','math','heading-up','heading-down'].includes(id)){
      sourceLine(s=>{
        if(id==='indent')return indentUnit()+s;if(id==='outdent')return s.replace(new RegExp('^(?:\\t| {1,'+indentUnit().length+'})'),'');
        if(id.startsWith('task-'))return s.replace(/\[([ xX])\]/,(_,x)=>id==='task-complete'?'[x]':id==='task-incomplete'?'[ ]':x===' '?'[x]':'[ ]');
        if(id==='code'||id==='math')return (id==='math'?'$$':'```'+(settings.defaultCodeLanguage||''))+'\n'+s+'\n'+(id==='math'?'$$':'```');
        if(id.startsWith('heading-')){const m=s.match(/^(#{1,6})\s+/),level=Math.max(1,Math.min(6,(m?m[1].length:2)+(id==='heading-up'?-1:1)));return headingMarkdown(s,level);}
        const prefix={quote:'> ',list:'- ','ordered-list':'1. ',check:'- [ ] '}[id];return s.startsWith(prefix)?s.slice(prefix.length):prefix+s.replace(/^(?:> |[-*+] (?:\[[ xX]\] )?|\d+\. )/,'');
      });return;
    }
    if(id==='heading-up'||id==='heading-down'){const h=nodeElement(selection()?.startContainer)?.closest('h1,h2,h3,h4,h5,h6');return heading(Math.max(1,Math.min(6,Number(h?.tagName[1]||2)+(id==='heading-up'?-1:1))));}
    if(['bold','italic','strike','inline-code','quote','list','ordered-list','check','indent','outdent','line','undo','redo','insert-before','insert-after'].includes(id)){toolbar(id);return;}
    if(id.startsWith('table-'))return tableCommand(id);
    if(id==='code'||id==='math'){const b=block(),whole=getSelection().isCollapsed&&b,text=whole?markdown(b).trim():selection().toString(),md=id==='math'?'$$\n'+text+'\n$$\n':'```'+(settings.defaultCodeLanguage||'')+'\n'+text+'\n```\n';if(whole)replaceBlock(md,b);else insert(md);return;}
    if(id==='table'){const r=await ask('插入表格','3 × 3','输入列数 × 行数（包含表头），例如 3 × 3');if(!r)return;const m=r.value.match(/^\s*(\d+)\s*[x×*，, ]\s*(\d+)\s*$/i);if(!m||+m[1]<1||+m[2]<2||+m[1]>30||+m[2]>100)throw Error('请输入 1–30 列、2–100 行');restore();const [cols,rows]=m.slice(1).map(Number),row='|'+Array(cols).fill('   ').join('|')+'|\n';insert(row+'|'+Array(cols).fill(' --- ').join('|')+'|\n'+row.repeat(rows-1));return;}
    const wrappers={underline:['<u>','</u>'],'inline-math':['$','$'],mark:['==','=='],sup:['<sup>','</sup>'],sub:['<sub>','</sub>'],comment:['<!-- ',' -->']};
    if(wrappers[id]){wrap(...wrappers[id]);return;}
    if(id==='link'||id==='image-url'){const image=id==='image-url',r=await ask(image?'插入图片链接':'插入超链接','https://','请输入链接地址');if(!r)return;restore();wrap((image?'!':'')+'[',']('+r.value.replace(/[<>\n\r]/g,'').replace(/ /g,'%20')+')');return;}
    if(id==='image'||id==='image-clipboard'){await run(id);return;}
    if(id==='toc'){insert('\n\n[toc]\n\n');return;}
    if(id==='yaml'){const value=editor.getValue();if(/^---\r?\n/.test(value)){toast('文稿已包含 YAML 元信息');return;}editor.setValue('---\n\n---\n\n'+value);sync();return;}
    if(id==='html'){wrap('<div>\n','\n</div>');return;}
    if(id==='footnote'||id==='link-reference'){const key='ref'+Date.now().toString(36),selected=selection().toString();insert(id==='footnote'?`[^${key}]`:`[${selected}][${key}]`);const r=document.createRange();r.selectNodeContents(activeSurface());r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);insert(id==='footnote'?`\n\n[^${key}]: \n`:`\n\n[${key}]: https://\n`);return;}
    if(id.startsWith('alert-')){const b=block(),text=b?markdown(b).trim():selection().toString();replaceBlock('> [!'+id.slice(6).toUpperCase()+']\n> '+text.replace(/\n/g,'\n> ')+'\n',b);return;}
    if(id.startsWith('task-')){const li=contextElement('li'),input=li?.querySelector('input[type="checkbox"]');if(input){const md=markdown(li).replace(/\[[ xX]\]/,id==='task-complete'?'[x]':id==='task-incomplete'?'[ ]':input.checked?'[ ]':'[x]');replaceBlock(md,li);}return;}
    if(id==='clear-format'){const r=selection();if(r.collapsed){const b=block();if(b)replaceBlock(plain(b).replace(/^#{1,6}\s+/,''),b);}else{const d=document.createElement('div');d.append(r.cloneContents());insert(plain(d));}return;}
    if(id==='copy-clean'){if(selection()?.collapsed&&settings.copyWholeLine)selectUnit('line');await api('write-rich-clipboard',cleanSelection());return;}
    if(['copy','cut','copy-markdown','copy-html','copy-plain'].includes(id)){
      const r=selection();if(r.collapsed&&settings.copyWholeLine){selectUnit('line');}
      const current=selection(),div=document.createElement('div');div.append(current.cloneContents());let text=current.toString();if(id==='copy-markdown'){const l=editor.vditor.lute;text=mode==='sv'?text:mode==='ir'?l.VditorIRDOM2Md(div.innerHTML):l.VditorDOM2Md(div.innerHTML);}if(id==='copy-html')text=mode==='sv'?editor.vditor.lute.Md2HTML(text):div.innerHTML;
      await api('write-clipboard',text);if(id==='cut'){restore();document.execCommand('delete');sync();}return;
    }
    if(id==='paste'||id==='paste-plain'){const text=await api('read-editor-clipboard');restore();if(id==='paste-plain'){document.execCommand('insertText',false,text);sync();}else insert(text);return;}
    if(id==='select-all'){pick(activeSurface(),true);return;}
    if(id.startsWith('select-')){selectUnit(id.slice(7));return;}
    if(id.startsWith('delete-')){selectUnit(id.slice(7));document.execCommand('delete');sync();return;}
    if(id==='document-selection'){nodeElement(selection()?.startContainer)?.scrollIntoView({block:'center'});return;}
    if(id==='document-start'||id==='document-end'){const r=pick(activeSurface(),true);r.collapse(id==='document-start');getSelection().removeAllRanges();getSelection().addRange(r);remember();nodeElement(r.startContainer)?.scrollIntoView({block:id==='document-start'?'start':'end'});return;}
    if(id==='refresh-math'){await mount(raw,mode);return;}
    if(id==='code-copy'||id==='math-copy'){
      if(id==='code-copy'&&mode==='sv'){const record=codeRecord();if(record)await api('write-clipboard',record.fence.body);return;}
      const wrapper=contextElement('[data-type="math-block"],[data-type="code-block"]')||contextElement('pre');
      const source=wrapper?.querySelector('pre > code')||wrapper?.querySelector('code');
      const el=source||contextElement('.language-math');
      if(el){const clone=el.cloneNode(true);clone.querySelectorAll('.vditor-linenumber__rows,.vditor-linenumber__temp').forEach(n=>n.remove());await api('write-clipboard',el.getAttribute('data-math')||clone.textContent.replace(/\u200b/g,''));}return;
    }
    if(id==='code-delete'){if(mode==='sv'){const record=codeRecord();if(record)sourceReplace(record.fence.start,record.fence.end,'');return;}const el=contextElement('[data-type="code-block"],[data-type="math-block"]')||contextElement('pre');if(el)replaceBlock('',el);return;}
    if(id==='link-open'||id==='link-copy'){const el=contextElement('a,[data-type="a"]'),url=el?.getAttribute('href')||el?.querySelector('.vditor-ir__marker--link')?.textContent?.replace(/^\]\(|\)$/g,'');if(url){if(id==='link-copy')await api('write-clipboard',url);else await api('external',url);}return;}
    if(id==='link-edit'||id==='link-remove'){
      const el=contextElement('a,[data-type="a"]');if(!el)return;
      const lute=editor.vditor.lute,html=document.createElement('div');html.innerHTML=lute.Md2HTML(markdown(el));
      const link=html.querySelector('a');if(!link)return;
      if(id==='link-remove'){replaceInline(lute.HTML2Md(link.innerHTML),el);return;}
      const result=await ask('编辑链接',link.getAttribute('href')||'','修改地址，保留链接文字和格式');if(!result)return;
      if(!result.value.trim()||/[\r\n<>]/.test(result.value))throw Error('请输入有效的链接地址');
      link.setAttribute('href',result.value.trim());
      replaceInline(lute.HTML2Md(link.outerHTML),el);return;
    }
    if(id.startsWith('image-')){const target=imageTarget();if(!target)return;const {img,wrapper,isHTML}=target;
      if(id==='image-copy')await api('write-clipboard',img.getAttribute('src')||'');
      if(id==='image-open'){const url=imageURL(img);if(new URL(url).protocol==='file:')await api('image-location','open',url);else await api('external',url);}
      if(id==='image-reveal')await api('image-location','reveal',imageURL(img));
      if(id==='image-copy-content'||id==='image-save'){
        const loaded=new Image();loaded.src=new URL(img.getAttribute('src'),document.baseURI).href;
        await loaded.decode();if(!loaded.naturalWidth||!loaded.naturalHeight||loaded.naturalWidth*loaded.naturalHeight>32e6)throw Error('图片无法加载或尺寸过大');
        const canvas=document.createElement('canvas');canvas.width=loaded.naturalWidth;canvas.height=loaded.naturalHeight;
        canvas.getContext('2d').drawImage(loaded,0,0);
        let png;try{png=canvas.toDataURL('image/png');}catch{throw Error('这张网络图片不允许读取内容，请先下载到本地再操作');}
        await api('image-content',id==='image-save'?'save':'copy',png);
      }
      if(['image-edit','image-alt','image-title'].includes(id)){
        const attr={'image-edit':'src','image-alt':'alt','image-title':'title'}[id],label={'src':'图片地址','alt':'替代文字','title':'图片标题'}[attr];
        const result=await ask('编辑'+label,img.getAttribute(attr)||'');if(!result)return;
        if(attr==='src'&&(!result.value.trim()||/^\s*(?:javascript|vbscript):/i.test(result.value)))throw Error('请输入有效的图片地址');
        img.setAttribute(attr,result.value);replaceImage(isHTML?imageHTML(img):imageMarkdown(img),wrapper);
      }
      if(id==='image-syntax'){
        replaceImage(isHTML?imageMarkdown(img):imageHTML(img),wrapper);
      }
      if(id==='image-delete'){pick(wrapper);insert('');}
      if(id==='image-reload'){const live=wrapper.matches('img')?wrapper:wrapper.querySelector('img');if(live){const src=live.getAttribute('src');live.removeAttribute('src');live.setAttribute('src',src);}}
      if(id==='image-resize'){const r=await ask('设置图片宽度',img.getAttribute('width')||'100%','输入百分比或像素，例如 50% 或 640；输入 auto 恢复原始大小');if(r){if(r.value!=='auto'&&!/^[1-9]\d{0,3}%?$/.test(r.value))throw Error('请输入大于零的像素、百分比或 auto');replaceImage(imageHTML(img,{height:null,width:r.value==='auto'?null:r.value}),wrapper);}}
      return;
    }
  }
  function selectUnit(unit){if(unit==='style'){const el=nodeElement(selection()?.startContainer)?.closest('strong,em,s,mark,u,code,sup,sub,[data-type="strong"],[data-type="em"],[data-type="s"],[data-type="code"]');if(el)pick(el,true);else if(block())pick(block(),true);}else if(unit==='paragraph'){const b=block();if(b)pick(b,true);}else{const s=getSelection();s.collapseToStart();s.modify('move','backward',unit==='word'?'word':'lineboundary');s.modify('extend','forward',unit==='word'?'word':'lineboundary');}remember();}
  function parseOutline(value){
    const lines=value.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n').split('\n'),items=[];let fence=null,math=false,yaml=lines[0]==='---';
    for(let i=0;i<lines.length;i++){const line=lines[i];if(yaml){if(i>0&&/^(---|\.\.\.)\s*$/.test(line))yaml=false;continue;}const f=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length&&!f[2].trim())fence=null;continue;}if(fence)continue;if(/^\s*\$\$\s*$/.test(line)){math=!math;continue;}if(math)continue;
      const m=line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);if(m){items.push({level:m[1].length,text:(m[2]||'').replace(/\s+#+\s*$/,''),line:i});continue;}
      if(line.trim()&&i+1<lines.length&&/^ {0,3}(=+|-+)\s*$/.test(lines[i+1])){items.push({level:lines[i+1].trim()[0]==='='?1:2,text:line.trim(),line:i});i++;}
    }return items;
  }
  function headingElements(){return [...(mode==='sv'?editor?.vditor.preview?.element:activeSurface())?.querySelectorAll('h1,h2,h3,h4,h5,h6')||[]];}
  function navigate(item,index){const el=headingElements()[index];if(mode==='sv'){const offset=raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n').split('\n').slice(0,item.line).join('\n').length+(item.line?1:0),p=positionAt(offset),r=document.createRange();r.setStart(...p);r.collapse(true);activeSurface().focus();getSelection().removeAllRanges();getSelection().addRange(r);nodeElement(p[0])?.scrollIntoView({block:'center'});remember();}else if(el){el.scrollIntoView({behavior:settings.reduceMotion==='on'?'instant':'smooth',block:'start'});const r=pick(el,true);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);remember();}highlight(index);}
  function highlight(index){$('#outline').querySelectorAll('.outline-item').forEach(b=>{b.classList.toggle('current',settings.outlineHighlight!==false&&+b.dataset.index===index);if(+b.dataset.index===index&&settings.outlineFollow)b.scrollIntoView({block:'nearest'});});}
  function updateHighlight(){cancelAnimationFrame(outlineFrame);outlineFrame=requestAnimationFrame(()=>{const headings=headingElements(),r=selection();let index=-1;if(r&&mode!=='sv'&&activeSurface()?.contains(r.startContainer)){const h=nodeElement(r.startContainer)?.closest('h1,h2,h3,h4,h5,h6');index=headings.indexOf(h);}if(index<0){const top=activeSurface()?.getBoundingClientRect().top||0;headings.forEach((h,i)=>{if(h.getBoundingClientRect().top<top+100)index=i;});}if(index<0&&headings.length)index=0;highlight(index);});}
  function bindCreationToolbar(){
    const bar=editor?.vditor?.toolbar?.element;if(!bar||bar.dataset.cyporaCreationBound)return;
    bar.dataset.cyporaCreationBound='true';
    bar.addEventListener('click',event=>{
      if(toolbarDispatchDepth)return;
      const button=event.target.closest?.('[data-tag],[data-type]');if(!button)return;
      const command=/^h[1-6]$/.test(button.dataset.tag||'')?button.dataset.tag:['list','ordered-list','check'].includes(button.dataset.type)?button.dataset.type:null;
      if(!command)return;event.preventDefault();event.stopImmediatePropagation();execute(command).catch(fail);
    },true);
  }
  function renderOutline(force=false){
    const key=(filePath||'')+'\0'+raw+'\0'+[settings.outlineDepth,settings.outlineFlat,settings.outlineHighlight].join();if(!force&&key===outlineKey){updateHighlight();return;}outlineKey=key;outlineItems=parseOutline(raw);const root=$('#outline');root.hidden=false;root.replaceChildren();let hiddenBelow=7;
    outlineItems.forEach((item,i)=>{if(item.level>=hiddenBelow)return;hiddenBelow=7;if(item.level>(settings.outlineDepth||6))return;const children=outlineItems[i+1]?.level>item.level,row=document.createElement('div');row.className='outline-entry';row.style.paddingLeft=(settings.outlineFlat?0:(item.level-1)*10)+'px';
      const fold=document.createElement('button');fold.className='outline-fold';fold.textContent=children?(collapsed.has(i)?'›':'⌄'):'';fold.disabled=!children;fold.setAttribute('aria-label',collapsed.has(i)?'展开章节':'折叠章节');fold.setAttribute('aria-expanded',String(!collapsed.has(i)));fold.onclick=()=>{collapsed.has(i)?collapsed.delete(i):collapsed.add(i);renderOutline(true);};
      const b=document.createElement('button');b.className='outline-item';b.dataset.index=i;b.title=item.text;b.textContent=item.text.replace(/!?\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`~]/g,'');b.onclick=()=>navigate(item,i);row.append(fold,b);root.append(row);if(collapsed.has(i))hiddenBelow=item.level+1;
    });if(!outlineItems.length){const p=document.createElement('p');p.className='outline-empty';p.textContent='使用标题建立大纲';root.append(p);}updateHighlight();
  }
  document.addEventListener('selectionchange',()=>{remember();updateHighlight();});
  $('#editor').addEventListener('scroll',updateHighlight,true);
  document.querySelectorAll('[data-menu]').forEach(b=>b.addEventListener('pointerdown',e=>{remember();e.preventDefault();}));
  function contextFor(node){const surface=activeSurface(),within=selector=>{const el=nodeElement(node)?.closest(selector);return !!el&&el!==surface&&surface?.contains(el);};const image=imageTarget(node);return {table:within('table'),code:!image&&(within('pre,[data-type="code-block"]')||mode==='sv'&&!!codeRecord()),math:within('.language-math,[data-type="math-block"]'),link:within('a,[data-type="a"]'),image:!!image,task:within('li')&&!!nodeElement(node)?.closest('li')?.querySelector('input[type="checkbox"]'),readonly:document.body.dataset.readonly==='true',localImage:!!image&&imageURL(image.img).startsWith('file:'),codeLines:!!settings.codeLineNumbers,codeWrap:settings.codeWordWrap!==false};}
  $('#editor').addEventListener('contextmenu',e=>{
    if(!activeSurface()?.contains(e.target))return;e.preventDefault();
    const range=selection();
    // Preserve an existing selection only when the clicked point belongs to it.
    const inside=range&&!range.collapsed&&[...range.getClientRects()].some(rect=>e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom);
    if(!inside){const caret=document.caretRangeFromPoint(e.clientX,e.clientY);if(caret&&activeSurface().contains(caret.startContainer)){getSelection().removeAllRanges();getSelection().addRange(caret);}}
    remember();contextNode=nodeElement(e.target);api('editor-context',contextFor(contextNode)).catch(fail);
  });
  $('#outline-panel').addEventListener('contextmenu',e=>{e.preventDefault();api('outline-context').catch(fail);});
  const previousRun=run;run=async(name,arg)=>{if(name==='find-next'||name==='find-previous'){findNext(name==='find-previous');return;}if(name==='edit-command')return execute(arg).catch(fail).finally(()=>contextNode=null);if(name==='outline'){toggleOutline();return;}if(name==='toggle-pref'&&['showToolbar','showStatusBar','alwaysOnTop'].includes(arg)){await window.PreferencesUI.savePatch({[arg]:!settings[arg]});return;}if(name==='editor-preferences'){await previousRun('preferences');window.PreferencesUI.selectTab('editor');return;}if(name==='outline-expand'||name==='outline-collapse'){collapsed=name==='outline-expand'?new Set():new Set(outlineItems.map((_,i)=>i));renderOutline(true);return;}if(name==='readonly'){document.body.dataset.readonly=String(document.body.dataset.readonly!=='true');activeSurface()?.setAttribute('contenteditable',document.body.dataset.readonly==='true'?'false':'true');return;}return previousRun(name,arg);};
  window.EditorTools={execute,remember,restore,renderOutline,parseOutline,contextFor,apply:()=>{activeSurface()?.setAttribute('spellcheck',String(!!settings.spellcheck));if(document.body.dataset.readonly==='true')activeSurface()?.setAttribute('contenteditable','false');bindCreationToolbar();renderOutline(true);window.CodeBlocks?.apply();},reset:()=>{bookmark=null;contextNode=null;collapsed.clear();outlineKey='';},get items(){return outlineItems;}};
})();
