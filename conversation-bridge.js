// Route shared desktop commands to whichever editor is actually visible.
(()=>{
  const previous=run;
  run=async(name,arg)=>{
    if(window.Conversations?.active){
      if(name==='find'||name==='find-next'||name==='find-previous'){
        window.Conversations.focusSearch();return;
      }
      if(name==='outline'){window.Conversations.focusSearch();return;}
      if(name==='insert'||name==='image'||name==='image-clipboard'||name==='insert-math'){
        toast('请在对话消息上点击“编辑”，再修改 Markdown 内容。');return;
      }
    }
    const result=await previous(name,arg);
    if(name==='readonly')window.Conversations?.refreshReadonly?.();
    return result;
  };
})();
