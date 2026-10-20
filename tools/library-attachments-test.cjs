'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Library } = require('../library.cjs');
const Files = require('../file-preferences.cjs');
const evidence = path.join(__dirname, '..', 'verification', '20261020-typora-claude', 'review', 'file-export');
const original = '# Keep exact bytes\r\n\r\n![](note.assets/image.svg)\r\n\r\n```md\r\n![](shared.assets/example.png)\r\n```\r\n\r\n$x_{i}^{2}$ and \\\\literal\r\n';
const imageBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
const exists = file => fs.lstat(file).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
const results = [];
let root;
async function fixture(label, own = true) {
  const base = path.join(root, label), source = path.join(base, 'source'), destination = path.join(base, 'destination');
  await fs.mkdir(source, { recursive: true }); await fs.mkdir(destination);
  const documentPath = path.join(source, 'note.md');
  await fs.writeFile(documentPath, original);
  if (own) {
    const image = path.join(base, 'image.svg'); await fs.writeFile(image, imageBytes);
    await Files.prepareImage({ sourcePath: image, documentPath, settings: { imageInsertMode: 'copy' } });
  }
  const state = {}, allowed = new Set(), library = new Library({ state, allowed, persist: async () => {}, home: source });
  const project = await library.addProject(destination), document = library.track(documentPath);
  return { base, source, destination, documentPath, state, library, project, document };
}
async function unchanged(test) {
  assert.equal(await fs.readFile(test.documentPath, 'utf8'), original);
  assert.equal(await exists(path.join(test.destination, 'note.md')), false);
  assert.equal(test.document.path, test.documentPath);
  assert.equal((await fs.readdir(test.destination)).some(name => name.startsWith('.cypora-attachments-')), false);
}
async function test(name, fn) { await fn(); results.push({ name, passed: true }); }
async function intercept(method, replacement, body) {
  const previous = fs[method]; fs[method] = (...args) => replacement(previous, ...args);
  try { await body(); } finally { fs[method] = previous; }
}
(async () => {
  await fs.mkdir(evidence, { recursive: true });
  root = await fs.mkdtemp(path.join(evidence, 'move-regression-'));
  await test('copied image, nested files and empty directories survive a move with exact Markdown bytes', async () => {
    const f = await fixture('normal');
    await fs.mkdir(path.join(f.source, 'note.assets', 'nested', 'empty'), { recursive: true });
    await fs.writeFile(path.join(f.source, 'note.assets', 'nested', 'extra.bin'), Buffer.from([0, 255, 31]));
    const moved = await f.library.move(f.document.id, f.project.id);
    assert.equal(await fs.readFile(moved.document.path, 'utf8'), original);
    assert.equal(await exists(f.documentPath), false);
    for (const base of [f.source, f.destination]) {
      assert.deepEqual(await fs.readFile(path.join(base, 'note.assets', 'image.svg')), imageBytes);
      assert.deepEqual(await fs.readFile(path.join(base, 'note.assets', 'nested', 'extra.bin')), Buffer.from([0, 255, 31]));
      assert.equal((await fs.stat(path.join(base, 'note.assets', 'nested', 'empty'))).isDirectory(), true);
    }
    assert.deepEqual(moved.document.attachmentFolders, ['note.assets']);
    assert.equal((await fs.readdir(f.destination)).some(name => name.startsWith('.cypora-attachments-')), false);
  });
  await test('shared images and unrelated .assets examples are not copied or rewritten', async () => {
    const f = await fixture('shared', false);
    await fs.mkdir(path.join(f.source, 'images')); await fs.writeFile(path.join(f.source, 'images', 'shared.svg'), imageBytes);
    await fs.mkdir(path.join(f.source, 'shared.assets')); await fs.writeFile(path.join(f.source, 'shared.assets', 'example.png'), 'retain');
    const text = original + '\r\n![](images/shared.svg)\r\n'; await fs.writeFile(f.documentPath, text);
    const moved = await f.library.move(f.document.id, f.project.id);
    assert.equal(await fs.readFile(moved.document.path, 'utf8'), text);
    assert.equal(await exists(path.join(f.destination, 'images')), false);
    assert.equal(await exists(path.join(f.destination, 'shared.assets')), false);
    assert.deepEqual(await fs.readFile(path.join(f.source, 'images', 'shared.svg')), imageBytes);
  });
  await test('rename records old attachment ownership through metadata reload and subsequent move', async () => {
    const f = await fixture('renamed');
    await f.library.rename(f.document.id, 'renamed.md');
    assert.deepEqual(f.document.attachmentFolders, ['note.assets']);
    const reloaded = new Library({ state: JSON.parse(JSON.stringify(f.state)), allowed: new Set(), persist: async () => {}, home: f.source });
    const moved = await reloaded.move(f.document.id, f.project.id);
    assert.equal(path.basename(moved.document.path), 'renamed.md');
    assert.equal(await fs.readFile(moved.document.path, 'utf8'), original);
    assert.deepEqual(await fs.readFile(path.join(f.destination, 'note.assets', 'image.svg')), imageBytes);
    assert.deepEqual(await fs.readFile(path.join(f.source, 'note.assets', 'image.svg')), imageBytes);
    assert.equal(await exists(path.join(f.destination, 'renamed.assets')), false);
  });
  await test('rename history does not duplicate a Windows attachment name by case', async () => {
    const f = await fixture('renamed-case');
    await f.library.rename(f.document.id, 'middle.md');
    await f.library.rename(f.document.id, 'Note.md');
    const moved = await f.library.move(f.document.id, f.project.id);
    assert.equal(await fs.readFile(moved.document.path, 'utf8'), original);
    assert.deepEqual(moved.document.attachmentFolders, ['note.assets']);
    assert.deepEqual(await fs.readFile(path.join(f.destination, 'note.assets', 'image.svg')), imageBytes);
  });
  for (const kind of ['directory', 'file']) await test('destination attachment ' + kind + ' collision preserves both originals', async () => {
    const f = await fixture('collision-' + kind), collision = path.join(f.destination, 'note.assets');
    if (kind === 'directory') { await fs.mkdir(collision); await fs.writeFile(path.join(collision, 'retain.txt'), 'pre-existing'); }
    else await fs.writeFile(collision, 'pre-existing');
    await assert.rejects(f.library.move(f.document.id, f.project.id), /不会覆盖/);
    await unchanged(f);
    assert.equal(await fs.readFile(kind === 'directory' ? path.join(collision, 'retain.txt') : collision, 'utf8'), 'pre-existing');
  });
  await test('old attachment collision after rename leaves renamed source and existing destination intact', async () => {
    const f = await fixture('renamed-collision');
    const renamed = await f.library.rename(f.document.id, 'new.md');
    await fs.mkdir(path.join(f.destination, 'note.assets')); await fs.writeFile(path.join(f.destination, 'note.assets', 'keep'), 'pre-existing');
    await assert.rejects(f.library.move(f.document.id, f.project.id), /不会覆盖/);
    assert.equal(await fs.readFile(renamed.document.path, 'utf8'), original);
    assert.equal(await exists(path.join(f.destination, 'new.md')), false);
    assert.equal(await fs.readFile(path.join(f.destination, 'note.assets', 'keep'), 'utf8'), 'pre-existing');
  });
  await test('destination Markdown collision rolls back only newly copied attachments', async () => {
    const f = await fixture('markdown-collision');
    await fs.writeFile(path.join(f.destination, 'note.md'), 'pre-existing document');
    await assert.rejects(f.library.move(f.document.id, f.project.id), /不会覆盖/);
    assert.equal(await fs.readFile(f.documentPath, 'utf8'), original);
    assert.equal(await fs.readFile(path.join(f.destination, 'note.md'), 'utf8'), 'pre-existing document');
    assert.equal(await exists(path.join(f.destination, 'note.assets')), false);
  });
  for (const nested of [false, true]) await test((nested ? 'nested' : 'top-level') + ' junction is rejected without copying its target', async () => {
    const f = await fixture('junction-' + nested, nested), external = path.join(f.base, 'external');
    await fs.mkdir(external); await fs.writeFile(path.join(external, 'keep'), 'outside bytes');
    await fs.symlink(external, path.join(f.source, 'note.assets', ...(nested ? ['redirect'] : [])), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.library.move(f.document.id, f.project.id), /普通文件夹|符号链接|目录联接/);
    await unchanged(f);
    assert.equal(await fs.readFile(path.join(external, 'keep'), 'utf8'), 'outside bytes');
    assert.equal(await exists(path.join(f.destination, 'note.assets')), false);
  });
  await test('a source attachment path that is a regular file fails without moving the document', async () => {
    const f = await fixture('source-file', false); await fs.writeFile(path.join(f.source, 'note.assets'), 'keep');
    await assert.rejects(f.library.move(f.document.id, f.project.id), /普通文件夹/); await unchanged(f);
  });
  await test('invalid private attachment metadata cannot select a parent or shared images directory', async () => {
    const f = await fixture('metadata', false);
    f.document.attachmentFolders = ['../outside.assets', 'images', 'C:\\outside.assets', ''];
    const moved = await f.library.move(f.document.id, f.project.id);
    assert.deepEqual(moved.document.attachmentFolders, []);
    assert.equal(await fs.readFile(moved.document.path, 'utf8'), original);
  });
  for (const phase of ['stage', 'publish', 'document']) await test('injected ' + phase + ' copy failure keeps source and cleans owned destination files', async () => {
    const f = await fixture('failure-' + phase);
    await fs.writeFile(path.join(f.destination, 'pre-existing'), 'keep');
    await intercept('copyFile', async (previous, source, destination, flags) => {
      const matches = phase === 'stage' ? source === path.join(f.source, 'note.assets', 'image.svg') :
        phase === 'publish' ? destination === path.join(f.destination, 'note.assets', 'image.svg') : source === f.documentPath;
      if (matches) throw Object.assign(Error('synthetic copy failure'), { code: 'EIO' });
      return previous(source, destination, flags);
    }, () => assert.rejects(f.library.move(f.document.id, f.project.id), /synthetic copy failure/));
    await unchanged(f);
    assert.equal(await exists(path.join(f.destination, 'note.assets')), false);
    assert.deepEqual(await fs.readFile(path.join(f.source, 'note.assets', 'image.svg')), imageBytes);
    assert.equal(await fs.readFile(path.join(f.destination, 'pre-existing'), 'utf8'), 'keep');
  });
  await test('source unlink failure rolls back destination Markdown and attachments', async () => {
    const f = await fixture('unlink-failure');
    await intercept('unlink', async (previous, filename) => {
      if (filename === f.documentPath) throw Object.assign(Error('synthetic unlink failure'), { code: 'EACCES' });
      return previous(filename);
    }, () => assert.rejects(f.library.move(f.document.id, f.project.id), /synthetic unlink failure/));
    await unchanged(f); assert.equal(await exists(path.join(f.destination, 'note.assets')), false);
  });
  const report = { passed: true, count: results.length, results, fixtures: root, librarySha256: crypto.createHash('sha256').update(await fs.readFile(path.join(__dirname, '..', 'library.cjs'))).digest('hex'), limitations: 'Copies only current or tracked document-owned .assets folders. Arbitrary relative links, shared image folders, pre-existing untracked old names and save-as migration are outside this patch.' };
  await fs.writeFile(path.join(evidence, 'move-regression-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(async error => { console.error(error); await fs.writeFile(path.join(evidence, 'move-regression-failure.json'), JSON.stringify({ error: error.stack, results, fixtures: root }, null, 2)); process.exitCode = 1; });
