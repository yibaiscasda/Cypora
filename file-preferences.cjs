'use strict';

// Local image insertion and export options. This module does not show dialogs,
// upload data, execute helpers, or modify a document.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateImageFolder: validateFolder } = require('./settings-model.js');

const defaults = Object.freeze({
  imageInsertMode: 'link',
  imagePathStyle: 'relative',
  imageRelativeDotPrefix: false,
  imageCopyFolder: '${filename}.assets',
  exportPageSize: 'A4',
  exportLandscape: false,
  exportMargins: 'default',
});
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.avif']);

function patch(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('文件设置格式无效');
  const out = {};
  const enums = {
    imageInsertMode: ['link', 'copy'],
    imagePathStyle: ['relative', 'absolute'],
    exportPageSize: ['A4', 'Letter', 'A5'],
    exportMargins: ['default', 'narrow', 'wide'],
  };
  for (const [key, values] of Object.entries(enums)) {
    if (key in input) {
      if (!values.includes(input[key])) throw Error('无效设置：' + key);
      out[key] = input[key];
    }
  }
  if ('imageCopyFolder' in input) out.imageCopyFolder = validateFolder(input.imageCopyFolder);
  for (const key of ['exportLandscape', 'imageRelativeDotPrefix']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw Error('无效设置：' + key);
      out[key] = input[key];
    }
  }
  return out;
}

function settings(input = {}) {
  return { ...defaults, ...patch(input) };
}

function scopedSettings(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('文件设置格式无效');
  const relevant = {};
  for (const key of keys) if (key in input) relevant[key] = input[key];
  return settings(relevant);
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function savedDocument(documentPath) {
  if (typeof documentPath !== 'string' || !path.isAbsolute(documentPath)) throw Error('请先保存文稿，再复制或粘贴图片');
  const absolutePath = path.resolve(documentPath);
  let stat;
  try { stat = await fs.stat(absolutePath); } catch { throw Error('文稿文件不存在，请先保存文稿'); }
  if (!stat.isFile()) throw Error('文稿路径不是文件');
  // Resolve the directory, not the document: a symlinked Markdown document still
  // refers to images relative to the location through which it was opened.
  const directory = await fs.realpath(path.dirname(absolutePath));
  return { absolutePath, directory, filename: path.basename(absolutePath, path.extname(absolutePath)) };
}

async function imageFolder(document, folderTemplate) {
  const folder = validateFolder(folderTemplate.split('${filename}').join(document.filename));
  let target = document.directory;
  // Reject pre-existing symlinks/junctions at every component. A document-local
  // image preference must not redirect copied data into another folder.
  for (const segment of folder.split('/')) {
    target = path.join(target, segment);
    if (!inside(document.directory, target)) throw Error('图片文件夹超出文稿目录');
    let stat;
    try { stat = await fs.lstat(target); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fs.mkdir(target); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(target);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('图片文件夹必须是文稿目录内的普通文件夹');
    const real = await fs.realpath(target);
    if (!inside(document.directory, real)) throw Error('图片文件夹超出文稿目录');
    target = real;
  }
  return target;
}

function imageSource(absolutePath, documentPath, options) {
  if (options.imagePathStyle === 'relative' && documentPath) {
    const relative = path.relative(path.dirname(path.resolve(documentPath)), absolutePath);
    // Across Windows drives a relative path cannot be expressed.
    if (!path.isAbsolute(relative)) {
      const src = relative.replaceAll('\\', '/');
      return options.imageRelativeDotPrefix && !src.startsWith('../') ? './' + src : src;
    }
  }
  return pathToFileURL(absolutePath).href;
}

async function writeUnique(folder, filename, writer) {
  const extension = path.extname(filename), stem = path.basename(filename, extension);
  for (let attempt = 0; attempt < 10000; attempt++) {
    const target = path.join(folder, stem + (attempt ? '-' + (attempt + 1) : '') + extension);
    try {
      await writer(target);
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw Error('同名图片过多，请改用其他图片文件夹');
}

async function prepareImage({ sourcePath, documentPath = null, settings: input = {} } = {}) {
  const options = scopedSettings(input, ['imageInsertMode', 'imagePathStyle', 'imageRelativeDotPrefix']);
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw Error('请选择本地图片文件');
  const source = path.resolve(sourcePath), extension = path.extname(source).toLowerCase();
  if (!imageExtensions.has(extension)) throw Error('不支持此图片格式');
  const stat = await fs.stat(source);
  if (!stat.isFile()) throw Error('所选路径不是图片文件');
  if (stat.size > MAX_IMAGE_BYTES) throw Error('图片不能超过 32 MB');
  let absolutePath = source;
  if (options.imageInsertMode === 'copy') {
    const { imageCopyFolder } = scopedSettings(input, ['imageCopyFolder']);
    const document = await savedDocument(documentPath);
    const folder = await imageFolder(document, imageCopyFolder);
    absolutePath = await writeUnique(folder, path.basename(source), target => fs.copyFile(source, target, constants.COPYFILE_EXCL));
  }
  return { src: imageSource(absolutePath, documentPath, options), absolutePath, copied: options.imageInsertMode === 'copy' };
}

async function saveClipboardImage({ png, documentPath = null, settings: input = {} } = {}) {
  const options = scopedSettings(input, ['imagePathStyle', 'imageRelativeDotPrefix', 'imageCopyFolder']);
  if (!Buffer.isBuffer(png) || png.length < 8 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('剪贴板没有可用的 PNG 图片');
  if (png.length > MAX_IMAGE_BYTES) throw Error('图片不能超过 32 MB');
  const document = await savedDocument(documentPath);
  const folder = await imageFolder(document, options.imageCopyFolder);
  const absolutePath = await writeUnique(folder, 'image.png', target => fs.writeFile(target, png, { flag: 'wx' }));
  return { src: imageSource(absolutePath, documentPath, options), absolutePath, copied: true };
}

function pdfOptions(input = {}) {
  const options = scopedSettings(input, ['exportPageSize', 'exportLandscape', 'exportMargins']);
  const margin = { default: 0.5, narrow: 0.25, wide: 1 }[options.exportMargins];
  return { printBackground: true, pageSize: options.exportPageSize, landscape: options.exportLandscape, margins: { top: margin, bottom: margin, left: margin, right: margin } };
}

function printOptions(input = {}) {
  const pdf = pdfOptions(input);
  // Electron 41.1.0 electron.d.ts:23871 documents WebContentsPrintOptions'
  // custom margins in pixels, unlike printToPDF's inch-based values. CSS uses
  // 96 px per inch. Microns are not the public API unit for these margins.
  const margins = { marginType: 'custom' };
  for (const side of ['top', 'bottom', 'left', 'right']) margins[side] = Math.round(pdf.margins[side] * 96);
  return { silent: false, printBackground: true, pageSize: pdf.pageSize, landscape: pdf.landscape, margins };
}

module.exports = { defaults, patch, settings, validateFolder, prepareImage, saveClipboardImage, pdfOptions, printOptions, MAX_IMAGE_BYTES };
