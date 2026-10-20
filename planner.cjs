// Local reminders and Markdown templates. No AI, shell commands or network execution.
const crypto=require('node:crypto');
const REPEATS=new Set(['once','daily','weekdays','weekly']);
function nextOccurrence(anchor,repeat,after){
  const date=new Date(anchor),limit=Number(after);
  if(!Number.isFinite(date.getTime())||!REPEATS.has(repeat))throw Error('无效的提醒时间');
  if(date.getTime()>limit&&(repeat!=='weekdays'||(date.getDay()>0&&date.getDay()<6)))return date.toISOString();
  if(repeat==='once')return null;
  const hours=date.getHours(),minutes=date.getMinutes();
  // Calendar arithmetic preserves local wall-clock time across daylight-saving changes.
  const cursor=new Date(Math.max(limit,date.getTime()));cursor.setHours(hours,minutes,0,0);
  if(cursor<=limit)cursor.setDate(cursor.getDate()+1);
  for(let i=0;i<8;i++){
    if((repeat==='daily')||(repeat==='weekdays'&&cursor.getDay()>0&&cursor.getDay()<6)||(repeat==='weekly'&&cursor.getDay()===date.getDay()))return cursor.toISOString();
    cursor.setDate(cursor.getDate()+1);cursor.setHours(hours,minutes,0,0);
  }
  throw Error('无法计算下次提醒');
}
class Planner{
  constructor({state={},persist,library,notify=()=>{},now=()=>Date.now()}){
    this.state={tasks:Array.isArray(state.tasks)?state.tasks:[],templates:Array.isArray(state.templates)?state.templates:[],receipts:Array.isArray(state.receipts)?state.receipts:[]};
    this.persist=persist;this.library=library;this.notify=notify;this.now=now;this.queue=Promise.resolve();
  }
  serial(fn){const result=this.queue.catch(()=>{}).then(async()=>{const before=this.snapshot();try{return await fn();}catch(e){this.state=before;throw e;}});this.queue=result;return result;}
  async save(){await this.persist(JSON.stringify(this.state,null,2));}
  snapshot(){return structuredClone(this.state);}
  task(id){const t=this.state.tasks.find(t=>t.id===id);if(!t)throw Error('定时任务不存在');return t;}
  template(id){const t=this.state.templates.find(t=>t.id===id);if(!t)throw Error('模板不存在');return t;}
  get hasActive(){return this.state.tasks.some(t=>t.status==='ACTIVE'&&t.nextRunAt);}
  saveTask(input){return this.serial(async()=>{
    const old=input.id?this.task(input.id):null,name=String(input.name||'').trim();
    if(!name||name.length>120)throw Error('任务名称须为 1–120 个字符');
    if(!REPEATS.has(input.repeat))throw Error('请选择提醒频率');
    const date=new Date(input.at);if(!Number.isFinite(date.getTime()))throw Error('请选择有效日期和时间');
    const at=date.toISOString(),scheduleChanged=!old||old.at!==at||old.repeat!==input.repeat;
    if(scheduleChanged&&date.getTime()<=this.now())throw Error('请选择未来的首次提醒时间');
    const projectId=input.projectId||null,documentId=input.documentId||null;
    if(projectId)this.library.project(projectId);
    if(documentId){const doc=this.library.get(documentId);if(projectId&&doc.projectId!==projectId)throw Error('关联文稿不属于所选项目');}
    if(!old&&this.state.tasks.length>=500)throw Error('最多储存 500 个任务');
    const task={...old,id:old?.id||crypto.randomUUID(),name,notes:String(input.notes||'').slice(0,4000),projectId,documentId,repeat:input.repeat,at,status:old?.status||'ACTIVE',createdAt:old?.createdAt||new Date(this.now()).toISOString()};
    if(scheduleChanged){task.nextRunAt=nextOccurrence(at,input.repeat,this.now());if(task.status==='COMPLETED')task.status='ACTIVE';}
    if(old)this.state.tasks[this.state.tasks.indexOf(old)]=task;else this.state.tasks.push(task);
    await this.save();return structuredClone(task);
  });}
  setStatus(id,active){return this.serial(async()=>{
    const t=this.task(id);
    if(active){const next=nextOccurrence(t.at,t.repeat,this.now());if(!next)throw Error('该单次提醒已过期，请编辑为未来时间');t.nextRunAt=next;t.status='ACTIVE';}else t.status='PAUSED';
    await this.save();return structuredClone(t);
  });}
  removeTask(id){return this.serial(async()=>{this.task(id);this.state.tasks=this.state.tasks.filter(t=>t.id!==id);this.state.receipts=this.state.receipts.filter(r=>r.taskId!==id);await this.save();});}
  markRead(id){return this.serial(async()=>{const r=this.state.receipts.find(r=>r.id===id);if(r)r.read=true;await this.save();});}
  tick(){return this.serial(async()=>{
    const now=this.now(),due=this.state.tasks.filter(t=>t.status==='ACTIVE'&&t.nextRunAt&&new Date(t.nextRunAt).getTime()<=now);
    if(!due.length)return [];
    const receipts=[];
    for(const t of due){
      const scheduledAt=t.nextRunAt;
      const receipt={id:crypto.randomUUID(),taskId:t.id,name:t.name,notes:t.notes,projectId:t.projectId,documentId:t.documentId,scheduledAt,deliveredAt:new Date(now).toISOString(),read:false};
      receipts.push(receipt);t.lastRunAt=receipt.deliveredAt;t.nextRunAt=nextOccurrence(t.at,t.repeat,now);if(!t.nextRunAt)t.status='COMPLETED';
    }
    this.state.receipts=[...receipts,...this.state.receipts].slice(0,200);
    // Commit delivery claims before side effects, so polling/restarts cannot deliver twice.
    await this.save();
    for(const receipt of receipts){try{await this.notify(structuredClone(receipt));}catch{ /* receipt remains in the in-app inbox */ }}
    return structuredClone(receipts);
  });}
  saveTemplate(input){return this.serial(async()=>{
    const old=input.id?this.template(input.id):null,name=String(input.name||'').trim(),content=input.content;
    if(!name||name.length>120)throw Error('模板名称须为 1–120 个字符');
    if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>2*1024*1024)throw Error('模板正文须小于 2 MB');
    if(!old&&this.state.templates.length>=200)throw Error('最多储存 200 个模板');
    const template={id:old?.id||crypto.randomUUID(),name,content,updatedAt:new Date(this.now()).toISOString()};
    if(old)this.state.templates[this.state.templates.indexOf(old)]=template;else this.state.templates.push(template);
    await this.save();return structuredClone(template);
  });}
  removeTemplate(id){return this.serial(async()=>{this.template(id);this.state.templates=this.state.templates.filter(t=>t.id!==id);await this.save();});}
}
module.exports={Planner,nextOccurrence};
