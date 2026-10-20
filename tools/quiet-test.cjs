// Regression entry point for normal desktop use: never show a test window,
// steal native focus, or open an OS popup menu.
const path=require('node:path');
const {app,BrowserWindow,Menu}=require('electron');
const root=path.resolve(__dirname,'..');
app.setAppPath(root);
for(const name of ['show','showInactive','focus'])BrowserWindow.prototype[name]=function(){};
Menu.prototype.popup=function(){};
app.on('browser-window-created',(_event,win)=>win.webContents.setBackgroundThrottling(false));
if(!process.argv.includes('--self-test'))process.argv.push('--self-test');
require(path.join(root,'main.cjs'));
