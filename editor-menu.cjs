// Shared native application and editor context menus. Commands operate on the selection.
const paragraph=[...[1,2,3,4,5,6].map(n=>[`h${n}`,`${'一二三四五六'[n-1]}级标题`]),['paragraph','正文'],null,['heading-up','提升标题级别'],['heading-down','降低标题级别'],null,['table','表格…'],['code','代码块'],['code-indent','增加代码行缩进'],['code-outdent','减少代码行缩进'],['math','公式块'],['quote','引用'],['list','无序列表'],['ordered-list','有序列表'],['check','任务列表'],['task-toggle','切换任务状态'],['task-complete','标记任务为已完成'],['task-incomplete','标记任务为未完成'],['indent','增加缩进'],['outdent','减少缩进'],null,['link-reference','链接引用'],['footnote','脚注'],['line','分隔线'],['toc','目录'],['yaml','YAML 元信息'],['html','HTML 块'],null,...['note','tip','important','warning','caution'].map((s,i)=>['alert-'+s,['注释','提示','重要','警告','注意'][i]+'块'])];
const format=[['bold','粗体'],['italic','斜体'],['underline','下划线'],['inline-code','行内代码'],['inline-math','行内公式'],['strike','删除线'],['mark','高亮'],['sup','上标'],['sub','下标'],['comment','注释'],null,['link','超链接…'],['image','插入本地图片…'],['image-clipboard','粘贴剪贴板图片'],['image-url','图片链接…'],null,['clear-format','清除格式']];
const editing=[['undo','撤销'],['redo','重做'],null,['cut','剪切'],['copy','复制'],['paste','粘贴'],['paste-plain','粘贴为纯文本'],['select-all','全选'],null,['copy-markdown','复制为 Markdown'],['copy-html','复制为 HTML 代码'],['copy-plain','复制为纯文本'],null,['select-paragraph','选中段落'],['select-line','选中行'],['select-word','选中词'],['select-style','选中当前格式文本'],['delete-paragraph','删除段落'],['delete-line','删除行'],['delete-word','删除词'],['delete-style','删除当前格式文本'],null,['document-start','跳转到文稿开头'],['document-selection','跳转到所选内容'],['document-end','跳转到文稿结尾'],['refresh-math','刷新公式']];
const table=[['table-row-before','在上方插入行'],['table-row-after','在下方插入行'],['table-column-before','在左侧插入列'],['table-column-after','在右侧插入列'],['table-row-up','上移一行'],['table-row-down','下移一行'],['table-column-left','左移一列'],['table-column-right','右移一列'],null,['table-align-left','左对齐'],['table-align-center','居中对齐'],['table-align-right','右对齐'],null,['table-delete-row','删除行'],['table-delete-column','删除列'],['table-copy','复制表格 Markdown'],['table-prettify','格式化表格源码'],['table-delete','删除表格']];
const readOnlyCommand=id=>/^(copy(?:-|$)|select-|document-|refresh-)/.test(id)||['code-copy','math-copy','table-copy','link-copy','link-open','image-copy','image-copy-content','image-open','image-reveal','image-save','image-reload','code-lines','code-wrap'].includes(id);
function build(items,dispatch,context){return items.map(row=>row?{id:row[0],label:row[1],enabled:!context?.readonly||readOnlyCommand(row[0]),click:()=>dispatch(row[0])}:{type:'separator'});}
function context(context={},dispatch){
  const make=rows=>build(rows,dispatch,context),items=[];
  if(context.image)items.push(...make([['image-open','打开图片'],['image-reveal','打开图片所在文件夹'],['image-save','图片另存为 PNG…'],['image-copy-content','复制图片内容'],['image-copy','复制图片地址'],null,['image-edit','编辑图片地址…'],['image-alt','编辑替代文字…'],['image-title','编辑图片标题…'],['image-resize','调整图片大小…'],['image-syntax','转换 Markdown / HTML 语法'],['image-reload','重新加载图片'],['image-delete','删除图片'],null]));
  if(context.link)items.push(...make([['link-open','打开链接'],['link-copy','复制链接地址'],['link-edit','编辑链接…'],['link-remove','取消链接'],null]));
  if(context.math||context.code){
    items.push(...make([[context.math?'math-copy':'code-copy',context.math?'复制 LaTeX 源码':'复制代码内容']]));
    if(!context.math)items.push(...make([['code-language','选择代码语言…'],['code-lines','显示行号'],['code-wrap','自动换行'],['code-indent','增加代码行缩进'],['code-outdent','减少代码行缩进']]));
    items.push(...make([['insert-before','在前面插入段落'],['insert-after','在后面插入段落'],['code-delete',context.math?'删除公式块':'删除代码块'],null]));
  }
  if(context.table)items.push({label:'表格',submenu:make(table)},{type:'separator'});
  items.push(...make(editing.slice(0,12)),...make([['copy-clean','复制内容并简化格式']]),{type:'separator'},
    {label:'段落',submenu:make(paragraph)},{label:'格式',submenu:make(format)});
  const section=prefix=>make(editing.filter(row=>row&&row[0].startsWith(prefix)&&row[0]!=='select-all'));
  items.push({type:'separator'},{label:'选中',submenu:section('select-')},{label:'删除',submenu:section('delete-')},{label:'跳转到',submenu:section('document-')},...make([['refresh-math','刷新公式']]));
  if(context.task)items.unshift(...make([['task-toggle','切换任务状态'],['task-complete','标记任务为已完成'],['task-incomplete','标记任务为未完成'],null]));
  for(const item of items){if(['code-lines','code-wrap'].includes(item.id)){item.type='checkbox';item.checked=!!context[item.id==='code-lines'?'codeLines':'codeWrap'];}if(item.id==='image-reveal')item.enabled=!!context.localImage;}
  return items;
}
module.exports={paragraph,format,editing,table,build,context,readOnlyCommand};
