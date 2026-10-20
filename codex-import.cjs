// Read-only local conversation discovery. Never edits Codex state or follows links.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const MAX_BYTES = 32 * 1024 * 1024;

class CodexImport {
  constructor(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
    this.home = path.resolve(home);
    this.files = new Map();
  }
  async list() {
    const found = [], titles = new Map();
    this.files.clear();
    const indexPath = path.join(this.home, 'session_index.jsonl');
    const indexStat = await fs.lstat(indexPath).catch(() => null);
    if (indexStat?.isFile() && !indexStat.isSymbolicLink() && indexStat.size < MAX_BYTES) {
      for (const line of (await fs.readFile(indexPath, 'utf8')).split('\n')) {
        try { const row = JSON.parse(line); if (typeof row.id === 'string') titles.set(row.id, String(row.thread_name || row.title || '')); } catch {}
      }
    }
    let truncated = false, skipped = 0;
    const visit = async (dir, archived, depth = 0) => {
      if (depth > 5) return;
      const stat = await fs.lstat(dir).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
      const entries = await fs.readdir(dir, {withFileTypes: true}).catch(error => {
        if (['ENOENT','EACCES','EPERM'].includes(error.code)) { skipped++; return []; }
        throw error;
      });
      // Recent date directories first; cap deliberately bounded.
      entries.sort((a, b) => b.name.localeCompare(a.name));
      for (const entry of entries) {
        if (found.length >= 5000) { truncated = true; return; }
        if (entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(file, archived, depth + 1);
        else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
          const st = await fs.stat(file).catch(error => {
            if (['ENOENT','EACCES','EPERM'].includes(error.code)) { skipped++; return null; }
            throw error;
          });
          if (!st) continue;
          const threadId = entry.name.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
          const id = crypto.createHash('sha256').update(file).digest('hex');
          this.files.set(id, file);
          found.push({id, title: titles.get(threadId) || entry.name.replace(/^rollout-/, '').replace(/\.jsonl$/i, ''), updatedAt: st.mtime.toISOString(), archived, bytes: st.size});
        }
      }
    };
    await visit(path.join(this.home, 'sessions'), false);
    await visit(path.join(this.home, 'archived_sessions'), true);
    found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {items: found, truncated, skipped};
  }
  async read(id) {
    const filename = this.files.get(id);
    if (!filename) throw Error('请从本地对话列表选择会话，或刷新后重试。');
    const real = await fs.realpath(filename);
    const root = await fs.realpath(this.home);
    const relative = path.relative(root, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('会话路径已变更，请刷新后重试。');
    return readImportFile(filename);
  }
}
async function readImportFile(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('请选择普通文本文件。');
  if (stat.size > MAX_BYTES) throw Error('单个对话文件不能超过 32 MB。请先按会话拆分。');
  const bytes = await fs.readFile(filename);
  if (bytes.length > MAX_BYTES || bytes.includes(0)) throw Error('文件过大或不是 UTF-8 文本。');
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { throw Error('请将对话保存为 UTF-8 文本后重新导入。'); }
  return {text, filename:path.basename(filename)};
}
module.exports = {CodexImport, readImportFile};
