// Shared, bounded preferences. Usable by Electron main and the isolated renderer.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CyporaSettings=factory();})(globalThis,()=>{
  const systemFont="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",codeFont="ui-monospace, 'Cascadia Code', Consolas, monospace";
  const codexBase={light:{name:'Codex',accent:'#0285ff',background:'#ffffff',foreground:'#0d0d0d',contrast:45,translucent:true,uiFont:systemFont,contentFont:'inherit',codeFont,uiWeight:430,contentWeight:400,codeWeight:400,uiItalic:false,contentItalic:false,codeItalic:false,codeTheme:'github'},dark:{name:'Codex',accent:'#339cff',background:'#181818',foreground:'#ffffff',contrast:60,translucent:true,uiFont:systemFont,contentFont:'inherit',codeFont,uiWeight:430,contentWeight:400,codeWeight:400,uiItalic:false,contentItalic:false,codeItalic:false,codeTheme:'github-dark'}};
  const base={"light":{"name":"Claude","accent":"#ae5630","background":"#faf9f5","foreground":"#30302e","contrast":35,"translucent":false,"uiFont":"'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif","contentFont":"Georgia, 'Microsoft YaHei', 'Segoe UI', serif","codeFont":"'Cascadia Code', Consolas, 'Microsoft YaHei', monospace","uiWeight":400,"contentWeight":400,"codeWeight":400,"uiItalic":false,"contentItalic":false,"codeItalic":false,"codeTheme":"github"},"dark":{"name":"Claude","accent":"#d99572","background":"#262624","foreground":"#e9e7df","contrast":35,"translucent":false,"uiFont":"'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif","contentFont":"Georgia, 'Microsoft YaHei', 'Segoe UI', serif","codeFont":"'Cascadia Code', Consolas, 'Microsoft YaHei', monospace","uiWeight":400,"contentWeight":400,"codeWeight":400,"uiItalic":false,"contentItalic":false,"codeItalic":false,"codeTheme":"github-dark"}};
  const commands=[
    ['create-document','新建文稿','文稿','Ctrl+N'],['open','打开文稿','文稿','Ctrl+O'],['folder','添加项目','文稿','Ctrl+Shift+O'],['save','保存','文稿','Ctrl+S'],['save-as','另存为','文稿','Ctrl+Shift+S'],['search-library','搜索文稿','应用','Ctrl+K'],['find','查找替换','编辑','Ctrl+F'],['mode-source','切换源码模式','编辑','Ctrl+/'],['mode-ir','即时渲染','编辑','Ctrl+Shift+1'],['mode-wysiwyg','所见即所得','编辑','Ctrl+Shift+2'],['insert-math','插入公式块','编辑','Ctrl+Shift+M'],['focus','专注模式','编辑','F8'],['typewriter','打字机模式','编辑','F9'],['sidebar','显示或隐藏侧栏','应用','Ctrl+Shift+L'],['outline','显示或隐藏大纲','编辑','Ctrl+Shift+H'],['preferences','设置','应用','Ctrl+,'],['tasks','定时任务','应用','Ctrl+Shift+T'],['add-task','添加文稿提醒','文稿','Ctrl+Alt+T'],['templates','模板储存','应用','Ctrl+Shift+U'],['save-template','保存内容为模板','文稿','Ctrl+Alt+M'],['export-pdf','导出 PDF','文稿','Ctrl+Shift+E'],['print','打印','文稿','Ctrl+P'],['history-back','后退','应用','Alt+Left'],['history-forward','前进','应用','Alt+Right'],['close-window','关闭窗口','应用','Ctrl+W']
  ].concat([...Array(6)].map((_,i)=>['edit-h'+(i+1),(i+1)+' 级标题','编辑','Ctrl+'+(i+1)]),[['edit-paragraph','正文','编辑','Ctrl+0'],['edit-bold','粗体','编辑','Ctrl+B'],['edit-italic','斜体','编辑','Ctrl+I'],['edit-underline','下划线','编辑','Ctrl+U'],['edit-strike','删除线','编辑','Alt+Shift+5'],['edit-code','代码块','编辑','Ctrl+Shift+K'],['edit-quote','引用','编辑','Ctrl+Shift+Q'],['edit-list','无序列表','编辑','Ctrl+Shift+]'],['edit-ordered-list','有序列表','编辑','Ctrl+Shift+['],['edit-link','超链接','编辑','Ctrl+L']]).map(([id,label,group,key])=>({id,label,group,key}));
  const defaults={appearanceMode:'system',themes:base,separateModes:false,advancedAppearance:false,uiSize:14,contentSize:17,codeSize:13,reduceMotion:'system',pointerCursors:false,fontSmoothing:'system',fullWidth:false,contentWidth:860,contentLineHeight:1.8,density:'default',zoom:100,reopenLast:true,rememberWindow:true,alwaysOnTop:false,closeConfirmation:'never',closeBehavior:'tasks',notifications:'always',notificationSound:'default',notificationPreview:true,notifyInApp:true,showStatusBar:true,showMenuBar:true,showToolbar:false,wordWrap:true,codeWordWrap:true,codeLineNumbers:true,sort:'manual',outlineDepth:6,outlineFlat:false,outlineHighlight:true,outlineFollow:true,spellcheck:false,copyWholeLine:true,markdownHighlight:true,markdownFootnotes:true,autoLinks:true,autoSpace:false,finalNewline:false,lineEnding:'preserve',equationNumbering:'all',defaultCodeLanguage:'',wordsPerMinute:300,showWordCount:true,firstLineIndent:false,zoomByMouse:false,autoPairBrackets:false,autoPairMarkdown:false,emojiAutocomplete:true,tabSize:4,codeIndentSize:4,indentWithTabs:false,smartQuotes:false,smartDashes:false,markdownSoftBreak:false,markdownInlineMath:true,markdownSubscript:false,markdownSuperscript:false,headingStyle:'atx',unorderedListMarker:'-',orderedListStyle:'increment',imageInsertMode:'link',imageRelativeDotPrefix:false,imagePathStyle:'relative',imageCopyFolder:'${filename}.assets',exportPageSize:'A4',exportLandscape:false,exportMargins:'default',imageEscape:true,codeLigatures:false,shortcuts:{}};
  const clone=v=>JSON.parse(JSON.stringify(v)),hex=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v),font=v=>typeof v==='string'&&v.length>0&&v.length<=240&&!/[;{}<>\\\r\n]|url\s*\(|var\s*\(/i.test(v);
  const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  function validateImageFolder(value){
    if(typeof value!=='string'||!value.trim()||value.length>120)throw Error('图片文件夹应为不超过 120 字符的相对路径');
    const normalized=value.replaceAll('\\','/');
    if(normalized.startsWith('/')||/[:\x00-\x1f<>|"*?]/.test(normalized))throw Error('图片文件夹不能使用绝对路径或特殊路径字符');
    if(/\$\{(?!filename\})/.test(normalized))throw Error('图片文件夹仅支持 ${filename} 变量');
    const reservedName=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
    for(const segment of normalized.split('/')){
      if(!segment||segment==='.'||segment==='..'||/[. ]$/.test(segment)||reservedName.test(segment))throw Error('图片文件夹包含无效路径');
    }
    return normalized;
  }
  function theme(value,variant){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('主题格式无效');const out={...base[variant]};
    for(const k of ['accent','background','foreground'])if(k in value){if(!hex(value[k]))throw Error('颜色必须为 #RRGGBB');out[k]=value[k].toLowerCase();}
    if('name'in value)out.name=String(value.name).slice(0,80);
    for(const k of ['uiFont','contentFont','codeFont'])if(k in value){if(!font(value[k]))throw Error('字体格式无效');out[k]=value[k];}
    for(const k of ['uiWeight','contentWeight','codeWeight'])if(k in value){if(!number(value[k],100,900))throw Error('字重应在 100–900 之间');out[k]=value[k];}
    if('contrast'in value){if(!number(value.contrast,0,100))throw Error('对比度应在 0–100 之间');out.contrast=value.contrast;}
    for(const k of ['translucent','uiItalic','contentItalic','codeItalic'])if(k in value)out[k]=!!value[k];
    if('codeTheme'in value){if(!['github','github-dark','atom-one-dark','dracula','monokai','solarized-light','solarized-dark'].includes(value.codeTheme))throw Error('不支持的代码主题');out.codeTheme=value.codeTheme;}
    return out;
  }
  function normalizeShortcut(value){
    if(value==='')return '';if(typeof value!=='string'||value.length>60)throw Error('快捷键格式无效');
    const parts=value.split('+'),mods=new Set(parts.slice(0,-1)),key=parts.at(-1);
    if([...mods].some(p=>!['Ctrl','Alt','Shift','Meta'].includes(p))||mods.size!==parts.length-1||!/^([A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Left|Right|Up|Down|Space|Tab|Enter|Home|End|PageUp|PageDown|Backspace|Delete|[\/,.\-=[\]`;'])$/.test(key))throw Error('请使用有效的按键组合');
    if(!mods.size&&!/^F\d+$/.test(key))throw Error('请加上 Ctrl、Alt 或 Shift，避免占用打字按键');
    if((mods.has('Alt')&&key==='F4')||(mods.has('Ctrl')&&['C','V','X','A','Z','Y','B','I'].includes(key)))throw Error('该组合保留给系统或文字编辑');
    return ['Ctrl','Alt','Shift','Meta'].filter(p=>mods.has(p)).concat(key).join('+');
  }
  function bindings(overrides={}){return Object.fromEntries(commands.map(c=>[c.id,c.id in overrides?overrides[c.id]:c.key]));}
  function patch(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('设置格式无效');const out={};
    const enums={headingStyle:['atx','setext'],unorderedListMarker:['-','*','+'],orderedListStyle:['increment','repeat'],imageInsertMode:['link','copy'],imagePathStyle:['relative','absolute'],exportPageSize:['A4','Letter','A5'],exportMargins:['default','narrow','wide'],appearanceMode:['system','light','dark','sepia'],reduceMotion:['system','on','off'],fontSmoothing:['system','on','off'],density:['default','compact','comfortable'],closeConfirmation:['never','shortcut','always'],closeBehavior:['tasks','tray','quit'],notifications:['always','unfocused','never'],notificationSound:['default','none'],theme:['light','dark','sepia'],mode:['ir','wysiwyg','sv'],sort:['recent','manual','name'],lineEnding:['preserve','lf','crlf'],equationNumbering:['all','none'],uiFont:['system','yahei'],contentFont:['system','serif'],codeFont:['Consolas','Cascadia Code','Courier New']};
    for(const [k,values]of Object.entries(enums))if(k in input){if(!values.includes(input[k]))throw Error('无效设置：'+k);out[k]=input[k];}
    const ranges={wordsPerMinute:[100,1000],uiSize:[12,24],contentSize:[12,32],codeSize:[10,28],contentWidth:[600,1400],contentLineHeight:[1.2,2.4],zoom:[75,175],sidebarWidth:[220,420],outlineDepth:[1,6]};
    for(const [k,[min,max]]of Object.entries(ranges))if(k in input){if(!number(input[k],min,max))throw Error('数值超出范围：'+k);out[k]=input[k];}
    for(const k of ['showWordCount','firstLineIndent','zoomByMouse','imageRelativeDotPrefix','autoPairBrackets','autoPairMarkdown','emojiAutocomplete','indentWithTabs','smartQuotes','smartDashes','markdownSoftBreak','markdownInlineMath','markdownSubscript','markdownSuperscript','exportLandscape','separateModes','advancedAppearance','pointerCursors','fullWidth','reopenLast','rememberWindow','alwaysOnTop','notificationPreview','notifyInApp','showStatusBar','showMenuBar','showToolbar','wordWrap','codeWordWrap','codeLineNumbers','sidebar','outline','typewriter','autoSave','outlineFlat','outlineHighlight','outlineFollow','spellcheck','copyWholeLine','markdownHighlight','markdownFootnotes','autoLinks','autoSpace','finalNewline','imageEscape','codeLigatures'])if(k in input)out[k]=!!input[k];
    for(const k of ['tabSize','codeIndentSize'])if(k in input){if(![2,4,8].includes(input[k]))throw Error('缩进宽度必须为 2、4 或 8');out[k]=input[k];}
    if('imageCopyFolder'in input)out.imageCopyFolder=validateImageFolder(input.imageCopyFolder);
    if('defaultCodeLanguage'in input){if(typeof input.defaultCodeLanguage!=='string'||!/^[-+a-zA-Z0-9_#]{0,40}$/.test(input.defaultCodeLanguage))throw Error('无效的代码语言');out.defaultCodeLanguage=input.defaultCodeLanguage;}
    if('themes'in input){out.themes={};for(const variant of ['light','dark'])out.themes[variant]=theme(input.themes[variant]||base[variant],variant);}
    if('shortcuts'in input){const overrides={};for(const c of commands)if(c.id in input.shortcuts)overrides[c.id]=normalizeShortcut(input.shortcuts[c.id]);const keys=new Set();for(const key of Object.values(bindings(overrides))){if(key&&keys.has(key))throw Error('快捷键与其他命令冲突');if(key)keys.add(key);}out.shortcuts=overrides;}
    return out;
  }
  function load(stored={}){
    const out={...clone(defaults)};for(const [k,v]of Object.entries(stored)){try{Object.assign(out,patch({[k]:v}));}catch{}}
    if(stored.sort==='recent')out.sort='manual';
    if(!stored.appearanceMode)out.appearanceMode=['light','dark','sepia'].includes(stored.theme)?stored.theme:'system';
    if(!stored.themes){for(const variant of ['light','dark']){if(stored.uiFont==='yahei')out.themes[variant].uiFont="'Microsoft YaHei UI', 'Segoe UI', sans-serif";if(stored.contentFont==='serif')out.themes[variant].contentFont="Georgia, 'Noto Serif SC', SimSun, serif";if(stored.codeFont)out.themes[variant].codeFont=stored.codeFont;}}
    return out;
  }
  const presets={Claude:{light:base.light,dark:base.dark},Codex:{light:codexBase.light,dark:codexBase.dark},Catppuccin:{light:{...codexBase.light,name:'Catppuccin',accent:'#8839ef',background:'#eff1f5',foreground:'#4c4f69'},dark:{...codexBase.dark,name:'Catppuccin',accent:'#cba6f7',background:'#1e1e2e',foreground:'#cdd6f4'}},Dracula:{light:{...codexBase.light,name:'Dracula',accent:'#7953b3',background:'#faf7ff',foreground:'#282a36'},dark:{...codexBase.dark,name:'Dracula',accent:'#ff79c6',background:'#282a36',foreground:'#f8f8f2',codeTheme:'dracula'}}};
  function exportTheme(value,variant){return JSON.stringify({format:'cypora-theme',version:1,variant,theme:theme(value,variant)},null,2);}
  function importTheme(text,variant){if(typeof text!=='string'||text.length>16000)throw Error('主题内容过长');let parsed;try{parsed=JSON.parse(text);}catch{throw Error('请粘贴 Cypora 主题 JSON');}if(parsed.format!=='cypora-theme'||parsed.version!==1)throw Error('不支持此主题格式，请使用 Cypora 导出的主题 JSON');return theme(parsed.theme,variant);}
  function eventShortcut(event){const raw=event.key;if(['Control','Alt','Shift','Meta','Escape'].includes(raw))return null;const aliases={ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',' ':'Space'},physical={Slash:'/',Comma:',',Period:'.',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Backquote:'`'};const key=/^Digit\d$/.test(event.code||'')?event.code.slice(-1):physical[event.code]||aliases[raw]||(raw.length===1?raw.toUpperCase():raw);return [event.ctrlKey?'Ctrl':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,event.metaKey?'Meta':null,key].filter(Boolean).join('+');}
  return {base,defaults,commands,presets,patch,load,theme,bindings,normalizeShortcut,eventShortcut,exportTheme,importTheme,clone,validateImageFolder};
});
