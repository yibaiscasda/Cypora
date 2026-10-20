// Exercise the real main/renderer bridge, not just the pure transport serializer.
module.exports=async({js,check,until,fs,path,out,allowed,openFile})=>{
  const Model=require('../conversation-model.js');
  const doc=Model.parse(JSON.stringify({title:'对话保存回归',messages:[
    {role:'user',content:'第一问：保留原始代码。'},
    {role:'assistant',content:'```python\nprint("中文")\n```\n\n公式：$x_{i}^{2}$。'},
    {role:'user',content:'第二问：保存后还能调整顺序吗？'},
    {role:'assistant',content:'可以继续编辑。'}
  ]}),'save-fixture.json');
  const p=path.join(out,'对话保存重开.md'), initial=Model.toMarkdown(doc);
  await fs.writeFile(p,initial,'utf8');allowed.add(p);
  const opened=await openFile(p);
  await js(`(async()=>{await window.__cyporaTest.setDocument(${JSON.stringify(opened.text)},${JSON.stringify(opened.path)},${JSON.stringify(opened.baseURL)});await window.PreferencesUI.savePatch({autoSave:false,lineEnding:'crlf'});})()`);
  await until('window.Conversations.active');
  const message=doc.turns[0].messages[1], newText=message.content+'\n\n本机保存新增内容。';
  await js(`window.Conversations.beginEdit(${JSON.stringify(message.id)});{const input=document.querySelector('.conversation-markdown-input');input.value=${JSON.stringify(newText)};input.dispatchEvent(new Event('input',{bubbles:true}));}window.__cyporaTest.run('save')`);
  const bytes=await fs.readFile(p,'utf8'),parsed=Model.fromMarkdown(bytes);
  check('conversation Ctrl-S path saves active draft through real IPC',parsed.turns[0].messages[1].content.replace(/\r\n/g,'\n')===newText,parsed.turns[0].messages[1].content);
  check('conversation CRLF preference produces CRLF file',bytes.includes('\r\n')&&!/(?<!\r)\n/.test(bytes));
  await js(`(async()=>{window.Conversations.finishEdit(false);window.Conversations.move(${JSON.stringify(doc.turns[1].id)},0);window.Conversations.toggle(${JSON.stringify(doc.turns[0].id)});await window.__cyporaTest.run('save');await window.__cyporaTest.run('open',${JSON.stringify(p)});})()`);
  check('conversation real save-reopen preserves ordering and collapse',await js(`window.Conversations.active&&window.Conversations.document.turns[0].id===${JSON.stringify(doc.turns[1].id)}&&window.Conversations.document.turns[1].collapsed===true`));
  await js(`window.__cyporaTest.run('mode','sv')`);
  check('conversation source switch restores ordinary editor',await js('!window.Conversations.active&&window.__cyporaTest.mode==="sv"&&window.__cyporaTest.raw.includes("本机保存新增内容")'));
  await js(`window.__cyporaTest.run('conversation-view');window.__cyporaTest.run('find')`);
  check('conversation shared find command targets conversation search',await js('document.activeElement===document.querySelector(".conversation-search input")'));
  await js(`(async()=>{await window.PreferencesUI.savePatch({autoSave:true,lineEnding:'preserve'});window.Conversations.close();})()`);
};
