// Reminder inbox, project links and reusable Markdown templates.
(()=>{
  let data={tasks:[],templates:[],receipts:[]},page=null,editingTask=null,editingTemplate=null,templateBaseline='',refreshSerial=Promise.resolve();
  const repeatNames={once:'仅一次',daily:'每天',weekdays:'周一至周五',weekly:'每周'},statusNames={ACTIVE:'已启用',PAUSED:'已暂停',COMPLETED:'已完成'};
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const button=(label,fn,className='')=>{const b=el('button',className,label);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(fail);return b;};
  const formatDate=value=>value?new Date(value).toLocaleString('zh-CN',{month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}):'—';
  const localDate=value=>{const d=new Date(value);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  function confirmAction(title,description){return new Promise(resolve=>{const dialog=$('#organizer-confirm');$('#confirm-title').textContent=title;$('#confirm-description').textContent=description;const finish=answer=>{dialog.close();resolve(answer);};$('#confirm-cancel').onclick=()=>finish(false);$('#confirm-submit').onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();$('#confirm-cancel').focus();});}
  async function refresh(){refreshSerial=refreshSerial.catch(()=>{}).then(async()=>{data=await api('planner');render();});await refreshSerial;}
  function hide(){page=null;$('#organizer-page').hidden=true;document.querySelectorAll('[data-action="tasks"],[data-action="templates"]').forEach(b=>b.classList.remove('selected','active'));document.querySelector('.rail-button[data-view="home"]')?.classList.add('active');}
  async function show(next,filter){page=next;$('#preferences').close();$('#organizer-search').value='';$('#task-filter').value=filter||'all';$('#organizer-page').hidden=false;document.querySelectorAll('.rail-button').forEach(b=>b.classList.toggle('active',b.dataset.action===next));document.querySelectorAll('.library-tools [data-action]').forEach(b=>b.classList.toggle('selected',b.dataset.action===next));await refresh();}
  function linksFor(item){
    const links=el('div','organizer-links'),doc=libraryData.documents.find(d=>d.id===item.documentId),project=libraryData.projects.find(p=>p.id===item.projectId);
    if(item.projectId)links.append(project?button(project.name,()=>openProject(project.id)):el('span','missing-link','关联项目已移除'));
    if(item.documentId)links.append(doc&&!doc.missing?button(doc.name,()=>openDocument(doc.id)):el('span','missing-link','关联文稿已删除或失联'));
    return links;
  }
  async function openProject(id){const p=libraryData.projects.find(p=>p.id===id);if(!p)throw Error('关联项目已移除');await api('project-update',id,{expanded:true});hide();selectView('home');selectedProject=id;await refreshLibrary();const row=[...document.querySelectorAll('.project-row')].find(r=>r.dataset.project===id);row?.scrollIntoView({block:'nearest'});row?.focus();}
  async function openDocument(id){const doc=libraryData.documents.find(d=>d.id===id);if(!doc||doc.missing)throw Error('关联文稿已删除或失联');await run('open',doc.path);return filePath===doc.path;}
  async function openReminder(id){await refreshLibrary();await refresh();const receipt=data.receipts.find(r=>r.id===id);if(!receipt)return;
    if(receipt.documentId&&libraryData.documents.some(d=>d.id===receipt.documentId&&!d.missing)){if(!await openDocument(receipt.documentId))return;}
    else if(receipt.projectId&&libraryData.projects.some(p=>p.id===receipt.projectId))await openProject(receipt.projectId);
    else await show('tasks','inbox');
    await api('reminder-read',id);await refresh();
  }
  function render(){
    const unread=data.receipts.filter(r=>!r.read).length;$('#unread-count').hidden=!unread||settings.notifyInApp===false;$('#unread-count').textContent=unread;$('#reminder-banner').hidden=!unread||settings.notifyInApp===false;$('#reminder-summary').textContent=`你有 ${unread} 条未读提醒`;
    if(!page)return;
    const isTasks=page==='tasks',inbox=isTasks&&$('#task-filter').value==='inbox',query=$('#organizer-search').value.trim().toLocaleLowerCase(),list=$('#organizer-list');list.replaceChildren();
    $('#organizer-title').textContent=isTasks?'定时任务':'模板储存';$('#organizer-subtitle').textContent=isTasks?'把提醒关联到文稿和项目。':'保存常用格式，让下一份文稿从这里开始。';$('#organizer-new').textContent=isTasks?'添加定时任务':'新建模板';$('#task-filter').hidden=!isTasks;
    $('#organizer-note').textContent=isTasks?'按本机时区运行。有启用任务时关闭窗口会留在托盘继续提醒；从“文件 → 退出 Cypora”可彻底退出。关机、休眠或退出期间错过的提醒会在恢复后补发一次。':'模板独立储存在本机。套用模板会新建 Markdown 文件；相对图片路径按新文稿所在文件夹解析。';
    let items=isTasks?(inbox?data.receipts:data.tasks.filter(t=>$('#task-filter').value==='all'||t.status===$('#task-filter').value)):data.templates;
    items=items.filter(t=>[t.name,t.notes,t.content].filter(Boolean).some(v=>v.toLocaleLowerCase().includes(query)));
    if(isTasks&&!inbox)items=[...items].sort((a,b)=>Number(b.status==='ACTIVE')-Number(a.status==='ACTIVE')||new Date(a.nextRunAt||a.at)-new Date(b.nextRunAt||b.at));
    if(!isTasks)items=[...items].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    if(!items.length){const empty=el('div','organizer-empty',query?'没有匹配的结果':inbox?'暂无提醒记录':isTasks?'还没有定时任务':'还没有模板');empty.append(el('p','',isTasks?'在这里添加，或从编辑页的时钟按钮创建。':'点击“新建模板”，或把当前文稿保存为模板。'));list.append(empty);return;}
    for(const item of items){
      const card=el('article','organizer-card'),head=el('div','organizer-card-head'),actions=el('div','organizer-actions');card.dataset.id=item.id;
      head.append(button(item.name,()=>inbox?openReminder(item.id):isTasks?editTask(item):editTemplate(item)));
      if(isTasks){head.append(el('span','task-status '+(inbox?!item.read?'unread':'':item.status==='ACTIVE'?'active':''),inbox?(item.read?'已读':'未读'):statusNames[item.status]));card.append(head);
        card.append(el('div','organizer-meta',inbox?'提醒时间：'+formatDate(item.scheduledAt):`${repeatNames[item.repeat]} · ${item.status==='COMPLETED'?'已提醒：'+formatDate(item.lastRunAt):'下次：'+formatDate(item.nextRunAt)}`));
        if(item.notes)card.append(el('p','',item.notes));card.append(linksFor(item));
        if(inbox){actions.append(button('打开关联内容',()=>openReminder(item.id)));if(!item.read)actions.append(button('标为已读',async()=>{await api('reminder-read',item.id);await refresh();}));}
        else{actions.append(button('编辑',()=>editTask(item)));if(item.status!=='COMPLETED')actions.append(button(item.status==='ACTIVE'?'暂停':'启用',async()=>{await api('task-status',item.id,item.status!=='ACTIVE');await refresh();}));actions.append(button('删除',async()=>{if(await confirmAction('删除定时任务？',`删除“${item.name}”及其提醒记录，关联文稿和项目将保留。`)){await api('task-delete',item.id);await refresh();}},'danger'));}
      }else{card.append(head);card.append(el('div','organizer-meta','更新于 '+formatDate(item.updatedAt)));card.append(el('p','',item.content.slice(0,180)||'空白模板'));actions.append(button('用模板新建文稿',()=>useTemplate(item),'primary'),button('编辑模板',()=>editTemplate(item)),button('删除',async()=>{if(await confirmAction('删除模板？',`删除“${item.name}”，已创建的文稿将保留。`)){await api('template-delete',item.id);await refresh();}},'danger'));}
      card.append(actions);list.append(card);
    }
  }
  function fillSelect(select,items,empty){select.replaceChildren();const option=el('option','',empty);option.value='';select.append(option);for(const item of items){const o=el('option','',item.name);o.value=item.id;select.append(o);}}
  function fillDocuments(preferred){const p=$('#task-project').value;fillSelect($('#task-document'),libraryData.documents.filter(d=>!d.missing&&(!p||d.projectId===p)),p?'仅关联项目':'不关联文稿');if(preferred&&[...$('#task-document').options].some(o=>o.value===preferred))$('#task-document').value=preferred;}
  async function editTask(task=null,documentId=null,projectId=null){
    await refreshLibrary();editingTask=task?.id||null;const doc=libraryData.documents.find(d=>d.id===(task?.documentId||documentId));
    $('#task-dialog-title').textContent=task?'编辑定时任务':'添加定时任务';$('#task-submit').textContent=task?'保存修改':'创建任务';$('#task-name').value=task?.name||(doc?'阅读：'+doc.name.replace(/\.(md|markdown)$/i,''):'');$('#task-notes').value=task?.notes||'';
    $('#task-at').value=localDate(task?.at||Date.now()+3600000);$('#task-repeat').value=task?.repeat||'once';fillSelect($('#task-project'),libraryData.projects,'不关联项目');$('#task-project').value=task?.projectId||projectId||doc?.projectId||'';fillDocuments(doc?.id);$('#task-error').hidden=true;
    $('#task-dialog').showModal();$('#task-name').focus();
  }
  async function submitTask(event){event.preventDefault();$('#task-submit').disabled=true;try{
    const at=new Date($('#task-at').value);if(!Number.isFinite(at.getTime()))throw Error('请选择有效日期和时间');
    await api('task-save',{id:editingTask,name:$('#task-name').value,notes:$('#task-notes').value,at:at.toISOString(),repeat:$('#task-repeat').value,projectId:$('#task-project').value||null,documentId:$('#task-document').value||null});
    $('#task-dialog').close();await refresh();toast('定时任务已保存');
  }catch(e){$('#task-error').textContent=e.message;$('#task-error').hidden=false;}finally{$('#task-submit').disabled=false;}}
  function editTemplate(template=null,content=''){
    editingTemplate=template?.id||null;$('#template-dialog-title').textContent=template?'编辑模板':'新建模板';$('#template-name').value=template?.name||'';$('#template-content').value=template?.content??content;templateBaseline=JSON.stringify([$('#template-name').value,$('#template-content').value]);$('#template-error').hidden=true;$('#template-dialog').showModal();$('#template-name').focus();
  }
  async function cancelTemplate(){if(templateBaseline!==JSON.stringify([$('#template-name').value,$('#template-content').value])&&!await confirmAction('放弃模板修改？','尚未保存的模板修改会丢失，原文稿保持原样。'))return;$('#template-dialog').close();}
  async function useTemplate(template){
    if(!await guard())return;
    const choice=await inputDialog({title:'用模板新建文稿',value:template.name+'.md',description:'创建独立文件，同名文件不会覆盖。',project:true,submit:'创建文稿'});if(!choice)return;
    const doc=await api('template-create-document',template.id,choice.value,choice.projectId);await refreshLibrary();await run('open',doc.path);
  }
  $('#task-form').onsubmit=submitTask;$('#task-cancel').onclick=()=>$('#task-dialog').close();$('#task-project').onchange=()=>fillDocuments();
  $('#template-form').onsubmit=async e=>{e.preventDefault();$('#template-submit').disabled=true;try{await api('template-save',{id:editingTemplate,name:$('#template-name').value,content:$('#template-content').value});$('#template-dialog').close();await refresh();toast('模板已保存');}catch(error){$('#template-error').textContent=error.message;$('#template-error').hidden=false;}finally{$('#template-submit').disabled=false;}};
  $('#template-cancel').onclick=()=>cancelTemplate().catch(fail);$('#template-dialog').oncancel=e=>{e.preventDefault();cancelTemplate().catch(fail);};
  $('#organizer-new').onclick=()=>Promise.resolve(page==='tasks'?editTask():editTemplate()).catch(fail);$('#organizer-back').onclick=hide;$('#organizer-search').oninput=render;$('#task-filter').onchange=render;
  const workspaceRun=run;run=async(name,arg)=>{try{
    if(name==='tasks'||name==='templates')return await show(name);
    if(name==='task-inbox')return await show('tasks','inbox');
    if(name==='planner-changed')return await refresh();
    if(name==='add-task'){const d=currentDocument();return await editTask(null,d?.id,selectedProject);}
    if(name==='open-reminder')return await openReminder(arg);
    if(name==='save-template')return editTemplate(null,raw);
    if(name==='quit'){if(await guard()){clearTimeout(draftTimer);await draftQueue;await api('clear-draft');await api('quit-app');}return;}
    if(['open','create-document','new','help'].includes(name))hide();
    return await workspaceRun(name,arg);
  }catch(e){fail(e);}};
  const docMenu=documentMenu;documentMenu=(doc,anchor)=>{docMenu(doc,anchor);if(doc){const b=button('添加定时提醒…',()=>{closeMenu();return editTask(null,doc.id,doc.projectId);});b.prepend(icon('clock'));b.setAttribute('role','menuitem');$('#context-menu').append(b);}};
  const projMenu=projectMenu;projectMenu=(project,anchor)=>{projMenu(project,anchor);const b=button('添加项目定时提醒…',()=>{closeMenu();return editTask(null,null,project.id);});b.prepend(icon('clock'));b.setAttribute('role','menuitem');$('#context-menu').append(b);};
  const taskButton=button('',()=>run('add-task'),'icon-button');taskButton.id='document-task-button';taskButton.title='为当前文稿添加定时任务';taskButton.setAttribute('aria-label','为当前文稿添加定时任务');taskButton.append(icon('clock'));$('#outline-toggle').before(taskButton);
  const saveTemplateButton=button('保存当前内容为模板',()=>run('save-template'),'settings-control');const taskSettings=button('添加定时任务',()=>{$('#preferences').close();return run('add-task');},'settings-control');
  for(const [text,b]of [['当前文稿的定时提醒',taskSettings],['模板储存',saveTemplateButton]]){const row=el('div','preference-row');row.append(el('span','',text),b);document.querySelector('[data-settings-pane="editor"] .settings-card').append(row);}
  document.querySelectorAll('[data-action="tasks"],[data-action="templates"],[data-action="task-inbox"]').forEach(b=>b.onclick=()=>run(b.dataset.action));
  document.querySelectorAll('[data-view]').forEach(b=>{const previous=b.onclick;b.onclick=e=>{hide();previous?.(e);};});
  window.Organizer={initialize:refresh,hide,refresh,show,editTask,editTemplate,openProject,openReminder,get data(){return data;}};
})();
