const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {CodexImport,readImportFile}=require('../codex-import.cjs');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cypora-import-'));
  try{
    const sessions=path.join(dir,'sessions','2026','10','20');
    await fs.mkdir(sessions,{recursive:true});
    const id='00000000-0000-4000-8000-000000000001';
    const file=path.join(sessions,`rollout-2026-10-20-${id}.jsonl`);
    const text='{"type":"event_msg","payload":{"type":"user_message","message":"中文问题"}}\n';
    await fs.writeFile(file,text);
    await fs.writeFile(path.join(dir,'session_index.jsonl'),JSON.stringify({id,thread_name:'中文任务'})+'\nINVALID\n');
    const service=new CodexImport(dir), listing=await service.list();
    assert.equal(listing.items.length,1);
    assert.equal(listing.items[0].title,'中文任务');
    assert.equal((await service.read(listing.items[0].id)).text,text);
    await assert.rejects(()=>service.read(file),/选择会话/);
    await assert.rejects(()=>service.read('../session_index.jsonl'),/选择会话/);
    const binary=path.join(dir,'binary.json');await fs.writeFile(binary,Buffer.from([0,1,2]));
    await assert.rejects(()=>readImportFile(binary),/UTF-8/);
    const invalid=path.join(dir,'invalid.json');await fs.writeFile(invalid,Buffer.from([0xff,0xfe]));
    await assert.rejects(()=>readImportFile(invalid),/UTF-8/);
    const oversized=path.join(dir,'oversized.json');const handle=await fs.open(oversized,'w');await handle.truncate(32*1024*1024+1);await handle.close();
    await assert.rejects(()=>readImportFile(oversized),/32 MB/);
    assert.equal((await new CodexImport(path.join(dir,'missing')).list()).items.length,0);
    assert.equal(await fs.readFile(file,'utf8'),text);
    console.log('Codex import: discovery, titles, scope, UTF-8, size, missing home, source preservation passed.');
  }finally{
    assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'cypora-import-')));
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
