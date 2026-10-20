window.MathJax={
  loader:{paths:{mathjax:new URL('node_modules/mathjax',location.href).href}},
  startup:{typeset:false},
  tex:{tags:'none',packages:{'[+]':['ams','autoload','textmacros','noundefined']},maxBuffer:10240},
  svg:{scale:1,minScale:80,fontCache:'local'},
  options:{enableMenu:false},
  output:{fontURL:new URL('node_modules/@mathjax/mathjax-newcm-font/svg',location.href).href}
};
