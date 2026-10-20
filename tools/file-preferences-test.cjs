'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const FilePreferences = require('../file-preferences.cjs');
const SettingsModel = require('../settings-model.js');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cypora-file-preferences-'));
  const docFolder = path.join(root, '文稿'), sourceFolder = path.join(root, '来源');
  await fs.mkdir(docFolder); await fs.mkdir(sourceFolder);
  const documentPath = path.join(docFolder, '我的笔记.md');
  const original = '# Preserve me\r\n\r\nOriginal content.\r\n';
  await fs.writeFile(documentPath, original);
  const sourcePath = path.join(sourceFolder, '原始 图片.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(sourcePath, png);
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); };

  await check('default image mode preserves a relative link without copying', async () => {
    const result = await FilePreferences.prepareImage({ sourcePath, documentPath });
    assert.equal(result.src, '../来源/原始 图片.png'); assert.equal(result.copied, false);
    assert.deepEqual(await fs.readdir(docFolder), ['我的笔记.md']);
  });
  await check('absolute image links are file URLs and escape spaces', async () => {
    const result = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imagePathStyle: 'absolute' } });
    assert.equal(result.src, pathToFileURL(sourcePath).href); assert.match(result.src, /%20/);
  });
  await check('unsaved document may link a local image using a file URL', async () => {
    const result = await FilePreferences.prepareImage({ sourcePath });
    assert.equal(result.src, pathToFileURL(sourcePath).href);
  });
  await check('copy requires a saved document before making a directory', async () => {
    await assert.rejects(FilePreferences.prepareImage({ sourcePath, settings: { imageInsertMode: 'copy' } }), /保存文稿/);
    await assert.rejects(FilePreferences.prepareImage({ sourcePath, documentPath: path.join(docFolder, 'missing.md'), settings: { imageInsertMode: 'copy' } }), /不存在/);
  });
  await check('copy resolves the filename template and preserves source bytes', async () => {
    const result = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy' } });
    assert.equal(result.src, '我的笔记.assets/原始 图片.png');
    assert.equal(result.copied, true);
    assert.deepEqual(await fs.readFile(result.absolutePath), png);
    assert.deepEqual(await fs.readFile(sourcePath), png);
  });
  await check('filename collisions preserve existing content and choose a new name', async () => {
    const occupied = path.join(docFolder, '我的笔记.assets', '原始 图片.png');
    await fs.writeFile(occupied, 'Existing independent bytes');
    const result = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy' } });
    assert.equal(path.basename(result.absolutePath), '原始 图片-2.png');
    assert.equal(await fs.readFile(occupied, 'utf8'), 'Existing independent bytes');
    assert.deepEqual(await fs.readFile(result.absolutePath), png);
  });
  await check('parallel copies never overwrite each other', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy', imageCopyFolder: 'images/parallel' } })));
    assert.equal(new Set(results.map(result => result.absolutePath)).size, 4);
    for (const result of results) assert.deepEqual(await fs.readFile(result.absolutePath), png);
  });
  await check('nested copy folder and absolute result are honored', async () => {
    const result = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy', imageCopyFolder: 'media/${filename}', imagePathStyle: 'absolute' } });
    assert.equal(result.src, pathToFileURL(path.join(docFolder, 'media', '我的笔记', path.basename(sourcePath))).href);
  });
  await check('optional dot prefix affects document-local relative links only', async () => {
    const local = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy', imageCopyFolder: 'dot-images', imageRelativeDotPrefix: true } });
    assert.equal(local.src, './dot-images/原始 图片.png');
    const parent = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageRelativeDotPrefix: true } });
    assert.equal(parent.src, '../来源/原始 图片.png');
    const absolute = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imagePathStyle: 'absolute', imageRelativeDotPrefix: true } });
    assert.equal(absolute.src, pathToFileURL(sourcePath).href);
  });
  await check('unsafe folder paths and unsupported placeholders are rejected', () => {
    for (const folder of ['../outside', '/absolute', 'C:\\outside', 'nested/../outside', 'a//b', 'a/.', 'a/CON', '${file}.assets', 'trailing.']) {
      assert.throws(() => FilePreferences.patch({ imageCopyFolder: folder }));
    }
  });
  await check('symlink or junction cannot redirect copying outside the document folder', async () => {
    const outside = path.join(root, 'outside'), redirect = path.join(docFolder, 'redirect');
    await fs.mkdir(outside);
    await fs.symlink(outside, redirect, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy', imageCopyFolder: 'redirect' } }), /普通文件夹/);
    assert.deepEqual(await fs.readdir(outside), []);
  });
  await check('a regular file cannot be used as a copy directory', async () => {
    await fs.writeFile(path.join(docFolder, 'blocked'), 'retain');
    await assert.rejects(FilePreferences.prepareImage({ sourcePath, documentPath, settings: { imageInsertMode: 'copy', imageCopyFolder: 'blocked' } }), /普通文件夹/);
    assert.equal(await fs.readFile(path.join(docFolder, 'blocked'), 'utf8'), 'retain');
  });
  await check('unsupported source types and remote paths are rejected', async () => {
    await assert.rejects(FilePreferences.prepareImage({ sourcePath: 'https://example.com/a.png', documentPath }), /本地/);
    await assert.rejects(FilePreferences.prepareImage({ sourcePath: documentPath, documentPath }), /格式/);
  });
  await check('oversized images are rejected before copying', async () => {
    const large = path.join(sourceFolder, 'too-large.png');
    const handle = await fs.open(large, 'wx'); await handle.truncate(FilePreferences.MAX_IMAGE_BYTES + 1); await handle.close();
    await assert.rejects(FilePreferences.prepareImage({ sourcePath: large, documentPath, settings: { imageInsertMode: 'copy' } }), /32 MB/);
  });
  await check('clipboard images persist as unique PNG files even in link mode', async () => {
    const first = await FilePreferences.saveClipboardImage({ png, documentPath });
    const second = await FilePreferences.saveClipboardImage({ png, documentPath });
    assert.equal(path.basename(first.absolutePath), 'image.png');
    assert.equal(path.basename(second.absolutePath), 'image-2.png');
    assert.equal(first.copied, true); assert.deepEqual(await fs.readFile(first.absolutePath), png);
  });
  await check('empty clipboard and unsaved clipboard targets fail explicitly', async () => {
    await assert.rejects(FilePreferences.saveClipboardImage({ png: Buffer.alloc(0), documentPath }), /PNG/);
    await assert.rejects(FilePreferences.saveClipboardImage({ png }), /保存文稿/);
  });
  await check('PDF defaults keep A4 and existing half inch margins', () => {
    assert.deepEqual(FilePreferences.pdfOptions(), { printBackground: true, pageSize: 'A4', landscape: false, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
  });
  await check('every PDF size, orientation and margin option affects native export options', () => {
    for (const size of ['A4', 'Letter', 'A5']) {
      for (const [setting, width] of [['default', 0.5], ['narrow', 0.25], ['wide', 1]]) {
        const result = FilePreferences.pdfOptions({ exportPageSize: size, exportLandscape: true, exportMargins: setting });
        assert.equal(result.pageSize, size); assert.equal(result.landscape, true);
        assert.deepEqual(result.margins, { top: width, bottom: width, left: width, right: width });
      }
    }
  });
  await check('printing uses custom pixel margins rather than PDF inches or microns', () => {
    assert.deepEqual(FilePreferences.printOptions(), {
      silent: false, printBackground: true, pageSize: 'A4', landscape: false,
      margins: { marginType: 'custom', top: 48, bottom: 48, left: 48, right: 48 },
    });
    assert.equal(FilePreferences.pdfOptions().margins.top, 0.5);
    assert.equal('marginType' in FilePreferences.pdfOptions().margins, false);
  });
  await check('every paper, orientation and margin option reaches the native print contract', () => {
    for (const size of ['A4', 'Letter', 'A5']) {
      for (const landscape of [false, true]) {
        for (const [setting, pixels] of [['default', 48], ['narrow', 24], ['wide', 96]]) {
          const result = FilePreferences.printOptions({ exportPageSize: size, exportLandscape: landscape, exportMargins: setting });
          assert.equal(result.pageSize, size); assert.equal(result.landscape, landscape);
          assert.deepEqual(result.margins, { marginType: 'custom', top: pixels, bottom: pixels, left: pixels, right: pixels });
          assert.equal(result.silent, false);
          assert.equal('deviceName' in result, false);
        }
      }
    }
  });
  await check('native print options reject invalid settings and do not share mutable margins', () => {
    assert.throws(() => FilePreferences.printOptions({ exportMargins: 'printer-specific' }));
    assert.throws(() => FilePreferences.printOptions({ exportPageSize: 'invalid' }));
    const first = FilePreferences.printOptions(); first.margins.top = 9000;
    assert.equal(FilePreferences.printOptions().margins.top, 48);
  });
  await check('invalid options are rejected and unrelated settings are ignored', () => {
    for (const value of [{ imageInsertMode: 'upload' }, { exportPageSize: 'A0' }, { exportMargins: 5 }, { exportLandscape: 'yes' }, { imagePathStyle: 'http' }]) assert.throws(() => FilePreferences.patch(value));
    assert.deepEqual(FilePreferences.patch({ autoSave: true, themes: {} }), {});
  });
  await check('review regression: malformed copy folder cannot disable PDF, print or image linking', async () => {
    for (const folder of ['a//b', '${file}.assets', 'nested/CON']) {
      const historical = { imageCopyFolder: folder, imageInsertMode: 'link', exportPageSize: 'Letter', exportMargins: 'wide' };
      assert.equal(FilePreferences.pdfOptions(historical).pageSize, 'Letter');
      assert.equal(FilePreferences.printOptions(historical).margins.left, 96);
      const result = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: historical });
      assert.equal(result.src, '../来源/原始 图片.png'); assert.equal(result.copied, false);
      await assert.rejects(FilePreferences.prepareImage({ sourcePath, documentPath, settings: { ...historical, imageInsertMode: 'copy' } }));
      await assert.rejects(FilePreferences.saveClipboardImage({ png, documentPath, settings: historical }));
    }
  });
  await check('runtime image and export settings validate only their own functional scope', async () => {
    const invalidImages = { imageInsertMode: 'obsolete', imagePathStyle: 'old', imageRelativeDotPrefix: 'old', imageCopyFolder: '../old', exportPageSize: 'A5' };
    assert.equal(FilePreferences.pdfOptions(invalidImages).pageSize, 'A5');
    assert.equal(FilePreferences.printOptions(invalidImages).pageSize, 'A5');
    const invalidExports = { exportPageSize: 'obsolete', exportLandscape: 'old', exportMargins: 'old', imageInsertMode: 'copy', imageCopyFolder: 'scope-images' };
    const copy = await FilePreferences.prepareImage({ sourcePath, documentPath, settings: invalidExports });
    assert.match(copy.src, /^scope-images\//);
    const clipboard = await FilePreferences.saveClipboardImage({ png, documentPath, settings: { ...invalidExports, imageInsertMode: 'obsolete' } });
    assert.match(clipboard.src, /^scope-images\//);
  });
  await check('settings UI and image backend share one folder validation contract', () => {
    assert.equal(FilePreferences.validateFolder, SettingsModel.validateImageFolder);
    for (const folder of ['a//b', '${file}.assets', 'nested/CON', 'assets/LPT9.png', 'a'.repeat(121), 'space ', 'tail.']) {
      assert.throws(() => SettingsModel.patch({ imageCopyFolder: folder }));
      assert.throws(() => FilePreferences.patch({ imageCopyFolder: folder }));
      assert.equal(SettingsModel.load({ imageCopyFolder: folder }).imageCopyFolder, '${filename}.assets');
    }
    for (const folder of ['assets', 'images/${filename}', 'parent\\child', 'a'.repeat(120)]) {
      assert.equal(SettingsModel.patch({ imageCopyFolder: folder }).imageCopyFolder, FilePreferences.patch({ imageCopyFolder: folder }).imageCopyFolder);
    }
  });
  await check('source image and document bytes remain unchanged', async () => {
    assert.equal(await fs.readFile(documentPath, 'utf8'), original);
    assert.deepEqual(await fs.readFile(sourcePath), png);
  });

  const report = {
    passed: true, count: checks.length, checks, fixtureDirectory: root,
    documentPath, documentSha256: crypto.createHash('sha256').update(await fs.readFile(documentPath)).digest('hex'),
    moduleSha256: crypto.createHash('sha256').update(await fs.readFile(path.join(__dirname, '..', 'file-preferences.cjs'))).digest('hex'),
    note: 'Fixtures retained. This verifies backend behavior, not Typora UI equivalence or a physical printer.',
  };
  const evidence = path.join(__dirname, '..', 'verification', '20261020-typora-claude', 'files');
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
