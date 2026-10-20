// Capture synthetic documentation fixtures without showing a desktop window.
const path=require('node:path'),fs=require('node:fs');
const {app}=require('electron');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs','images');
const profile=path.join(root,'verification','documentation',Date.now().toString(),'profile');
fs.mkdirSync(out,{recursive:true});app.setAppPath(root);
const setPath=app.setPath.bind(app);
app.setPath=(name,value)=>setPath(name,name==='userData'?profile:value);
process.argv.push('--self-test');
const entry=path.join(root,'tools','self-test.cjs');
require.cache[entry]={id:entry,filename:entry,loaded:true,exports:async({win})=>{
  const js=code=>win.webContents.executeJavaScript(code,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
  try{
    for(let i=0;i<100&&!await js('!!window.__cyporaTest?.ready');i++)await wait(100);
    win.setSize(1380,920);
    await js("PreferencesUI.savePatch({appearanceMode:'light',themes:CyporaSettings.clone(CyporaSettings.defaults.themes),autoSave:false,reduceMotion:'on',codeLineNumbers:true,outline:true})");
    const document='# 留一点空间，给好想法\n\n把零散的记录整理成清晰的文字。在 Cypora 中，写作、代码与对话可以自然地放在一起。\n\n## 今天的写作计划\n\n- [x] 整理项目笔记\n- [x] 为代码补充说明\n- [ ] 将讨论整理成一篇文稿\n\n## 代码也有清楚的层次\n\n```javascript\nconst notes = [\"阅读\", \"记录\", \"整理\"];\n\nfor (const [index, note] of notes.entries()) {\n  console.log(`${index + 1}. ${note}`);\n}\n```\n\n## 一张小表格\n\n| 内容 | 状态 | 下一步 |\n| --- | --- | --- |\n| 设计笔记 | 已整理 | 继续补充细节 |\n| 讨论记录 | 待归纳 | 合并相关问题 |\n| 发布文稿 | 草稿 | 检查后导出 |\n';
    await js(`__cyporaTest.setDocument(${JSON.stringify(document)})`);await wait(900);
    fs.writeFileSync(path.join(out,'editor.png'),(await win.webContents.capturePage()).toPNG());
    const conversation='# 用户\n我想把这次讨论整理成一篇清楚的项目笔记。\n\n# Codex\n## 从想法到一份可以继续编辑的文稿\n\n先保留问题与回复的关系，再把相近的话题整理到一起。这样回顾时能看见结论，也能找到它的上下文。\n\n- 给每一轮讨论一个清晰的主题。\n- 将代码、行动项与说明留在同一处。\n- 合并重复问题，保留重要细节。\n\n# 用户\n代码和待办事项也能一起保留吗？\n\n# Codex\n可以。代码使用独立代码块展示，任务列表则继续保留为可编辑的 Markdown。\n\n```javascript\nconst next = { title: \"整理发布说明\", done: false };\n```\n\n- [ ] 核对功能说明\n- [ ] 补充使用示例\n- [ ] 保存项目笔记\n\n# 用户\n之后还可以调整这些讨论的顺序吗？\n\n# Codex\n可以拖动左侧手柄调整整轮顺序，也可以折叠、合并和编辑内容。右侧短横线帮助你快速回到某个问题。\n';
    await js(`__cyporaTest.setDocument(CyporaConversation.toMarkdown(CyporaConversation.parse(${JSON.stringify(conversation)},'讨论整理示例.md')));Conversations.previewReady`);await wait(900);
    fs.writeFileSync(path.join(out,'conversations.png'),(await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({screenshots:['editor.png','conversations.png'],hidden:!win.isVisible(),synthetic:true}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
}};
require(path.join(root,'main.cjs'));
