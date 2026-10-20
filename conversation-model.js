/* Portable, local-only conversation documents. No renderer or Node dependency. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CyporaConversation = factory();
})(globalThis, () => {
  'use strict';
  const VERSION = 1;
  const HEADER = '<!-- cypora-conversation:v1 ';
  const MAX_INPUT = 64 * 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
  const cleanTitle = value => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 180);
  const heading = value => cleanTitle(value).replace(/([\\`*_[\]<>#])/g, '\\$1');
  const unheading = value => value.replace(/\\([\\`*_[\]<>#])/g, '$1');
  const encode = value => encodeURIComponent(JSON.stringify(value)).replace(/-/g, '%2D');
  function decode(value) {
    try { return JSON.parse(decodeURIComponent(value)); }
    catch { throw Error('对话文稿的元数据已损坏，请保留原文件并检查注释标记。'); }
  }
  function hash(value) {
    let a = 2166136261, b = 2246822507;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 3266489909);
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }
  const idFor = (prefix, value) => prefix + '-' + hash(String(value));
  const unique = (candidate, used) => {
    let id = candidate, suffix = 2;
    while (used.has(id)) id = candidate + '-' + suffix++;
    used.add(id);
    return id;
  };
  function plainTitle(content) {
    const line = String(content || '').split(/\r?\n/).find(value => value.trim() && !/^\s*(?:<!--|```|~~~)/.test(value)) || '';
    return cleanTitle(line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/[*`]/g, '')).slice(0, 90) || '未命名对话';
  }
  function textContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(textContent).filter(value => value !== '').join('\n');
    if (!object(content)) return '';
    // Only explicit text payloads are imported. Tool arguments, images and reasoning
    // objects must not be accidentally serialized into a visible message.
    if (content.type && !['text', 'input_text', 'output_text'].includes(content.type)) return '';
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content.parts)) return textContent(content.parts);
    if (typeof content.content === 'string') return content.content;
    return '';
  }
  function visibleUserText(value) {
    let text = value;
    if (/^\s*# AGENTS\.md instructions for [^\r\n]+/i.test(text) &&
        /<INSTRUCTIONS>|<environment_context>/i.test(text)) return '';
    if (/^\s*<(?:INSTRUCTIONS|user_instructions)>[\s\S]*<\/(?:INSTRUCTIONS|user_instructions)>\s*$/i.test(text)) return '';
    // These are app-generated pseudo-user messages only when the whole
    // message consists of context wrappers. Never strip literal XML quoted in
    // a real request (especially fenced code examples).
    const wrappers = /<(environment_context|external_codex_apps_open_page|turn_aborted|permissions_instructions|collaboration_mode)\b[^>]*>[\s\S]*?<\/\1>/gi;
    if (!text.replace(wrappers, '').trim()) return '';
    // The app wraps a genuine request with attachment bookkeeping; the request
    // itself is still retained without importing a list of local machine paths.
    if (/^\s*# Files mentioned by the user:/i.test(text) && /^## My request:\s*$/m.test(text)) {
      text = text.slice(text.search(/^## My request:\s*$/m)).replace(/^## My request:\s*\r?\n?/, '');
    }
    return text.trim() ? text : '';
  }
  function hasAttachments(value) {
    if (Array.isArray(value)) return value.some(hasAttachments);
    if (!object(value)) return false;
    const type = value.type || value.content_type || '';
    if (/^(?:input_image|output_image|image|image_url|image_asset_pointer|input_audio|output_audio|audio|audio_url|file|input_file|file_attachment)$/.test(type)) return true;
    return hasAttachments(value.parts) || hasAttachments(value.content);
  }
  function timestampOf(raw) {
    const value = raw.timestamp ?? raw.create_time ?? raw.created_at;
    if (typeof value === 'string') return value.slice(0, 80);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return undefined;
  }
  function candidate(raw, origin, outer = {}, warnings = []) {
    if (!object(raw)) return null;
    let role = raw.role || raw.author?.role;
    if (raw.type === 'userMessage' || raw.type === 'user_message') role = 'user';
    if (raw.type === 'agentMessage' || raw.type === 'agent_message') role = 'assistant';
    if (!['user', 'assistant'].includes(role)) return null;
    const channel = raw.channel || raw.phase || raw.metadata?.channel;
    if (channel && !['final', 'final_answer', 'commentary'].includes(channel)) return null;
    if (raw.metadata?.is_visually_hidden_from_conversation === true) return null;
    if (raw.recipient && raw.recipient !== 'all') return null;
    if (raw.type && !['message', 'userMessage', 'user_message', 'agentMessage', 'agent_message'].includes(raw.type)) return null;
    if (hasAttachments(raw.content) || (Array.isArray(raw.attachments) && raw.attachments.length)) {
      const warning = '文件包含图片、音频或文件附件；已导入可见文字，附件本身未复制。';
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    let content = textContent(raw.content ?? raw.message ?? raw.text);
    if (role === 'user') content = visibleUserText(content);
    if (!content.trim()) return null;
    return {
      role, content, origin,
      ...(typeof raw.id === 'string' ? { sourceId: raw.id } : {}),
      ...(channel ? { channel } : {}),
      ...(timestampOf(raw) !== undefined ? { timestamp: timestampOf(raw) } :
        timestampOf(outer) !== undefined ? { timestamp: timestampOf(outer) } : {})
    };
  }
  function deduplicateMirrors(messages) {
    const result = [];
    for (const message of messages) {
      const last = result[result.length - 1];
      const mirrored = last && last.role === message.role && last.content === message.content &&
        new Set([last.origin, message.origin]).size === 2 &&
        [last.origin, message.origin].every(origin => ['event_msg', 'response_item'].includes(origin));
      if (mirrored) {
        // A mirrored pair is consumed only once. Three equal genuine messages
        // are not collapsed merely because their text happens to match.
        if (message.origin === 'response_item') result[result.length - 1] = { ...message, origin: 'paired' };
        else last.origin = 'paired';
      } else result.push(message);
    }
    return result;
  }
  function buildConversation(messages, info, ids) {
    if (!messages.length) return null;
    const title = cleanTitle(info.title) || plainTitle(messages.find(message => message.role === 'user')?.content || messages[0].content);
    const seed = info.sourceId || title + '\0' + messages.map(message => message.role + '\0' + message.content).join('\0');
    const conversationId = unique(idFor('conversation', seed), ids.conversations);
    const turns = [];
    for (const raw of messages) {
      let turn = turns[turns.length - 1];
      if (raw.role === 'user' || !turn) {
        turn = {
          id: unique(idFor('turn', conversationId + '\0' + turns.length + '\0' + raw.content), ids.turns),
          conversationId, title: plainTitle(raw.content), collapsed: false, messages: []
        };
        turns.push(turn);
      }
      const message = {
        id: unique(idFor('message', conversationId + '\0' + (raw.sourceId || turns.length + '\0' + turn.messages.length + '\0' + raw.content)), ids.messages),
        role: raw.role, content: raw.content
      };
      for (const key of ['channel', 'timestamp', 'sourceId']) if (raw[key] !== undefined) message[key] = raw[key];
      turn.messages.push(message);
    }
    return { conversation: { id: conversationId, title, source: info.source || {} }, turns };
  }
  function newIds() { return { conversations: new Set(), turns: new Set(), messages: new Set() }; }
  function buildDocument(groups, filename, format, warnings) {
    const ids = newIds(), conversations = [], turns = [];
    for (const group of groups) {
      const built = buildConversation(group.messages, group, ids);
      if (built) { conversations.push(built.conversation); turns.push(...built.turns); }
    }
    if (!turns.length) throw Error('未找到可导入的用户或 Codex 回复。系统提示、工具调用和内部推理不会导入。');
    return {
      version: VERSION, id: idFor('document', conversations.map(item => item.id).join('\0')),
      title: conversations.length === 1 ? conversations[0].title : '对话合集',
      source: { filename: String(filename || ''), format }, conversations, turns, warnings
    };
  }
  function jsonlGroups(records, filename, warnings) {
    const groups = [];
    let current = { messages: [], source: { filename, format: 'codex-jsonl' } };
    for (const record of records) {
      if (!object(record)) continue;
      if (record.type === 'session_meta') {
        if (current.messages.length) {
          current.messages = deduplicateMirrors(current.messages);
          groups.push(current);
          current = { messages: [], source: { filename, format: 'codex-jsonl' } };
        }
        const payload = record.payload || {};
        if (typeof payload.id === 'string') {
          current.sourceId = payload.id;
          current.source.sessionId = payload.id;
        }
        if (typeof payload.title === 'string') current.title = payload.title;
        continue;
      }
      let item;
      // agent_message response items are agent-to-agent coordination records,
      // despite sharing a name with the older user-visible event_msg variant.
      if (record.type === 'response_item' && record.payload?.type === 'message') item = candidate(record.payload, 'response_item', record, warnings);
      else if (record.type === 'event_msg') {
        if (['user_message', 'agent_message'].includes(record.payload?.type)) item = candidate(record.payload, 'event_msg', record, warnings);
      } else if (record.role || record.author || ['userMessage', 'agentMessage'].includes(record.type)) {
        item = candidate(record, 'json', record, warnings);
      }
      if (item) current.messages.push(item);
    }
    current.messages = deduplicateMirrors(current.messages);
    if (current.messages.length) groups.push(current);
    return groups;
  }
  function mappingMessages(value, warnings) {
    const mapping = value.mapping, keys = Object.keys(mapping);
    if (!keys.length) return [];
    let current = typeof value.current_node === 'string' && mapping[value.current_node] ? value.current_node : null;
    if (!current) {
      const leaves = keys.filter(key => !(mapping[key]?.children || []).some(child => Object.hasOwn(mapping, child)));
      current = (leaves.length ? leaves : keys).sort((a, b) => {
        const ta = Number(mapping[a]?.message?.create_time) || 0, tb = Number(mapping[b]?.message?.create_time) || 0;
        return ta - tb || keys.indexOf(a) - keys.indexOf(b);
      }).at(-1);
      if (leaves.length > 1) warnings.push('导出文件未指定当前分支；已导入时间最新的完整分支，未混合其他分支。');
    }
    const seen = new Set(), path = [];
    while (current && Object.hasOwn(mapping, current)) {
      if (seen.has(current)) throw Error('对话分支数据存在循环，无法安全导入。');
      seen.add(current);
      const node = mapping[current];
      if (!object(node)) break;
      const item = candidate(node.message, 'json', {}, warnings);
      if (item) path.push(item);
      current = node.parent;
    }
    return path.reverse();
  }
  function jsonGroups(value, filename, warnings) {
    const groups = [];
    function visit(node) {
      if (Array.isArray(node)) {
        if (node.some(item => object(item) && (item.role || item.author || ['userMessage', 'agentMessage'].includes(item.type)))) {
          const messages = node.map(item => candidate(item, 'json', {}, warnings)).filter(Boolean);
          groups.push({ messages, source: { filename, format: 'json' } });
        } else if (node.some(item => ['session_meta', 'response_item', 'event_msg'].includes(item?.type))) {
          groups.push(...jsonlGroups(node, filename, warnings));
        } else node.forEach(visit);
        return;
      }
      if (!object(node)) return;
      if (Array.isArray(node.conversations)) { node.conversations.forEach(visit); return; }
      if (object(node.conversation)) { visit(node.conversation); return; }
      if (object(node.thread)) { visit(node.thread); return; }
      let messages;
      if (object(node.mapping)) messages = mappingMessages(node, warnings);
      else if (Array.isArray(node.messages)) messages = node.messages.map(item => candidate(item, 'json', {}, warnings)).filter(Boolean);
      else if (Array.isArray(node.turns)) messages = node.turns.flatMap(turn => {
        if (Array.isArray(turn.items)) return turn.items.map(item => candidate(item, 'json', {}, warnings)).filter(Boolean);
        if (Array.isArray(turn.messages)) return turn.messages.map(item => candidate(item, 'json', {}, warnings)).filter(Boolean);
        return [];
      });
      else if (Array.isArray(node.items)) messages = node.items.map(item => candidate(item, 'json', {}, warnings)).filter(Boolean);
      else {
        const one = candidate(node, 'json', {}, warnings);
        if (one) messages = [one];
      }
      if (messages) groups.push({
        messages, title: node.title || node.name,
        sourceId: typeof node.id === 'string' ? node.id : node.conversation_id,
        source: {
          filename, format: 'json',
          ...(typeof (node.id || node.conversation_id) === 'string' ? { conversationId: node.id || node.conversation_id } : {})
        }
      });
    }
    visit(value);
    return groups;
  }
  function transcriptGroups(text, filename, warnings) {
    const messages = [];
    let active = null, fence = null;
    const lines = text.split(/\r?\n/);
    const flush = () => {
      if (active && active.lines.join('\n').trim()) messages.push({ role: active.role, content: active.lines.join('\n'), origin: 'transcript' });
    };
    const preamble = [];
    for (const line of lines) {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const mark = fenceMatch[1];
        if (!fence) fence = { char: mark[0], length: mark.length };
        else if (mark[0] === fence.char && mark.length >= fence.length && /^\s{0,3}(?:`+|~+)\s*$/.test(line)) fence = null;
        (active ? active.lines : preamble).push(line);
        continue;
      }
      const match = !fence && /^(?:#{1,6}\s+)?(?:\*\*)?(user|you|human|用户|你|assistant|codex|chatgpt|助手|助理)(?:\*\*)?\s*(?:[:：](?:\*\*)?\s*(.*)|\s*)$/i.exec(line);
      if (match) {
        flush();
        active = {
          role: /^(user|you|human|用户|你)$/i.test(match[1]) ? 'user' : 'assistant',
          lines: match[2] === undefined || match[2] === '' ? [] : [match[2]]
        };
      } else (active ? active.lines : preamble).push(line);
    }
    flush();
    if (messages.length) {
      if (preamble.join('\n').trim()) {
        // Unlabelled content stays visible rather than being silently discarded.
        messages.unshift({ role: 'user', content: preamble.join('\n'), origin: 'transcript' });
        warnings.push('角色标签前的未标注文本已保留为单独一段。');
      }
    } else {
      const content = visibleUserText(text);
      if (content.trim()) messages.push({ role: 'user', content, origin: 'transcript' });
      warnings.push('未识别到角色标签，已将文本保留为一段用户记录。');
    }
    return [{ messages, source: { filename, format: 'transcript' } }];
  }
  function parse(text, filename = '') {
    if (typeof text !== 'string' || !text.trim()) throw Error('导入内容为空。');
    if (text.length > MAX_INPUT) throw Error('导入文件过大，请按对话拆分为 64 MB 以内的文件。');
    text = text.replace(/^\uFEFF/, '');
    const restored = fromMarkdown(text);
    if (restored) return restored;
    const warnings = [];
    let input = text.trim(), format = 'transcript', groups;
    const wrapped = /^```(?:json|jsonl)\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(input);
    if (wrapped) input = wrapped[1];
    const jsonFilename = /\.(?:json|jsonl|ndjson)$/i.test(filename);
    const looksJson = /^\s*(?:\{|(?:\[\s*(?:\{|\[|"|\]|null\b|true\b|false\b|-?\d)))/.test(input);
    if (looksJson || jsonFilename || wrapped) {
      let value, parsed = false;
      try { value = JSON.parse(input); parsed = true; } catch {}
      if (parsed) {
        format = 'json';
        if (['session_meta', 'response_item', 'event_msg'].includes(value?.type)) groups = jsonlGroups([value], filename, warnings);
        else groups = jsonGroups(value, filename, warnings);
      } else {
        const records = [], malformed = [];
        input.split(/\r?\n/).forEach((line, index) => {
          if (!line.trim()) return;
          try { records.push(JSON.parse(line)); } catch { malformed.push(index + 1); }
        });
        if (!records.length) throw Error('JSON / JSONL 格式无效，未导入任何内容。');
        if (malformed.length) warnings.push('已跳过 ' + malformed.length + ' 行损坏的 JSONL（行号：' + malformed.slice(0, 12).join('、') + (malformed.length > 12 ? '…' : '') + '）。');
        groups = jsonlGroups(records, filename, warnings);
        format = 'codex-jsonl';
      }
    } else groups = transcriptGroups(text, filename, warnings);
    return buildDocument(groups, filename, format, warnings);
  }
  function validate(doc) {
    if (!object(doc) || doc.version !== VERSION || !safeId(doc.id) || typeof doc.title !== 'string' ||
        !Array.isArray(doc.conversations) || !Array.isArray(doc.turns)) throw Error('对话文稿格式无效。');
    const ids = newIds();
    for (const item of doc.conversations) {
      if (!object(item) || !safeId(item.id) || ids.conversations.has(item.id) || typeof item.title !== 'string') throw Error('对话来源标识无效或重复。');
      ids.conversations.add(item.id);
    }
    for (const turn of doc.turns) {
      if (!object(turn) || !safeId(turn.id) || ids.turns.has(turn.id) || !ids.conversations.has(turn.conversationId) ||
          typeof turn.title !== 'string' || !Array.isArray(turn.messages) || !turn.messages.length) throw Error('对话段落标识或内容无效。');
      ids.turns.add(turn.id);
      for (const message of turn.messages) {
        if (!object(message) || !safeId(message.id) || ids.messages.has(message.id) ||
            !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw Error('对话消息标识、角色或内容无效。');
        ids.messages.add(message.id);
      }
    }
    return doc;
  }
  function toMarkdown(doc) {
    validate(doc);
    const { turns, ...meta } = clone(doc);
    const haystack = JSON.stringify(doc);
    let token = 'cx-' + hash(haystack), suffix = 0;
    while (haystack.includes(token)) token = 'cx-' + hash(haystack) + '-' + ++suffix;
    const marker = (kind, value) => '<!-- cypora:' + token + ':' + kind + (value ? ' ' + encode(value) : '') + ' -->';
    const chunks = [HEADER + encode({ ...meta, token }) + ' -->\n# ' + heading(doc.title) + '\n\n'];
    for (const turn of turns) {
      const { messages, ...turnMeta } = turn;
      chunks.push(marker('turn', turnMeta) + '\n## ' + heading(turn.title) + '\n\n');
      for (const message of messages) {
        const { content, ...messageMeta } = message;
        chunks.push('### ' + (message.role === 'user' ? '用户' : 'Codex') + '\n\n' +
          marker('message', messageMeta) + '\n' + content + '\n' + marker('end-message') + '\n\n');
      }
      chunks.push(marker('end-turn') + '\n\n');
    }
    chunks.push(marker('end-document') + '\n');
    return chunks.join('');
  }
  function fromMarkdown(text) {
    if (typeof text !== 'string') return null;
    const input = text.replace(/^\uFEFF/, '');
    if (!input.startsWith(HEADER)) return null;
    const firstLineEnd = input.indexOf('\n');
    const firstLine = (firstLineEnd < 0 ? input : input.slice(0, firstLineEnd)).replace(/\r$/, '');
    if (!firstLine.endsWith(' -->')) throw Error('对话文稿开头的元数据不完整。');
    const meta = decode(firstLine.slice(HEADER.length, -4));
    if (!object(meta) || !/^cx-[a-z0-9-]{1,80}$/.test(meta.token || '')) throw Error('对话文稿分隔标记无效。');
    const { token, ...doc } = meta;
    doc.turns = [];
    const regex = new RegExp('^<!-- cypora:' + token + ':(turn|message|end-message|end-turn|end-document)(?: ([^\\r\\n]*))? -->\\r?$', 'gm');
    let match, turn = null, message = null, messageStart = 0, messageSeparator = '\n', ended = false, firstTurnStart = null;
    let outsideStart = firstLineEnd + 1;
    function outside(end, kind, role) {
      const lines = input.slice(outsideStart, end).split(/\r?\n/).filter(line => line.trim());
      const fail = () => { throw Error('消息边界之外存在新文字或注释。请将它移入用户或 Codex 消息正文；原文没有被覆盖。'); };
      if (kind === 'document') {
        if (lines.length !== 1 || !/^# /.test(lines[0])) fail();
        doc.title = cleanTitle(unheading(lines[0].slice(2)));
      } else if (kind === 'first-message') {
        if (lines.length !== 2 || !/^## /.test(lines[0]) || lines[1] !== '### ' + (role === 'user' ? '用户' : 'Codex')) fail();
        turn.title = cleanTitle(unheading(lines[0].slice(3)));
      } else if (kind === 'message') {
        if (lines.length !== 1 || lines[0] !== '### ' + (role === 'user' ? '用户' : 'Codex')) fail();
      } else if (lines.length) fail();
    }
    while ((match = regex.exec(input))) {
      const kind = match[1], data = match[2];
      if (ended) throw Error('对话文稿结束标记之后存在重复段落。');
      if (kind === 'turn' && !turn && !message) {
        outside(match.index, firstTurnStart === null ? 'document' : 'empty');
        if (firstTurnStart === null) firstTurnStart = match.index;
        turn = decode(data);
        if (!object(turn)) throw Error('对话段落元数据无效。');
        turn.messages = [];
      } else if (kind === 'message' && turn && !message) {
        message = decode(data);
        if (!object(message)) throw Error('对话消息元数据无效。');
        outside(match.index, !turn.messages.length ? 'first-message' : 'message', message.role);
        messageStart = regex.lastIndex + (input[regex.lastIndex] === '\n' ? 1 : 0);
        messageSeparator = match[0].endsWith('\r') ? '\r\n' : '\n';
      } else if (kind === 'end-message' && turn && message && !data) {
        const body = input.slice(messageStart, match.index);
        if (!body.endsWith(messageSeparator)) throw Error('对话消息结束标记必须单独占一行。');
        message.content = body.slice(0, -messageSeparator.length);
        turn.messages.push(message);
        message = null;
      } else if (kind === 'end-turn' && turn && !message && !data) {
        outside(match.index, 'empty');
        doc.turns.push(turn);
        turn = null;
      } else if (kind === 'end-document' && !turn && !message && !data) {
        outside(match.index, firstTurnStart === null ? 'document' : 'empty');
        ended = true;
        if (input.slice(regex.lastIndex).trim()) throw Error('对话文稿结束标记之后有未归属的内容，请移入消息段落。');
      } else throw Error('对话文稿分隔标记缺失、重复或次序错误；未覆盖原内容。');
      outsideStart = regex.lastIndex + (input[regex.lastIndex] === '\n' ? 1 : 0);
    }
    if (!ended || turn || message) throw Error('对话文稿不完整，请检查消息和段落的结束标记。');
    return validate(doc);
  }
  function moveTurn(doc, id, toIndex) {
    validate(doc);
    const index = doc.turns.findIndex(turn => turn.id === id);
    if (index < 0) throw Error('找不到要移动的对话。');
    if (!Number.isInteger(toIndex)) throw Error('移动位置必须是整数。');
    const out = clone(doc), [turn] = out.turns.splice(index, 1);
    out.turns.splice(Math.max(0, Math.min(toIndex, out.turns.length)), 0, turn);
    return out;
  }
  function deleteTurn(doc, id) {
    validate(doc);
    if (!doc.turns.some(turn => turn.id === id)) throw Error('找不到要删除的对话。');
    const out = clone(doc);
    out.turns = out.turns.filter(turn => turn.id !== id);
    return out;
  }
  function mergeTurns(doc, ids) {
    validate(doc);
    if (!Array.isArray(ids)) throw Error('请选择要合并的对话。');
    const selected = new Set(ids);
    if (selected.size < 2) throw Error('至少选择两段对话再合并。');
    if ([...selected].some(id => !doc.turns.some(turn => turn.id === id))) throw Error('找不到部分待合并的对话。');
    const out = clone(doc), chosen = out.turns.filter(turn => selected.has(turn.id)), first = out.turns.findIndex(turn => selected.has(turn.id));
    const merged = {
      id: idFor('turn', chosen.map(turn => turn.id).join('\0')),
      conversationId: chosen[0].conversationId,
      originConversationIds: [...new Set(chosen.flatMap(turn => turn.originConversationIds || [turn.conversationId]))],
      title: chosen[0].title, collapsed: false,
      messages: chosen.flatMap(turn => turn.messages.map(message => ({
        ...message,
        originTurnId: message.originTurnId || turn.id,
        originConversationId: message.originConversationId || turn.conversationId
      })))
    };
    const remaining = out.turns.filter(turn => !selected.has(turn.id));
    merged.id = unique(merged.id, new Set(remaining.map(turn => turn.id)));
    remaining.splice(first, 0, merged);
    out.turns = remaining;
    return out;
  }
  function combine(docs) {
    if (!Array.isArray(docs) || !docs.length) throw Error('没有可以合并的对话文稿。');
    docs.forEach(validate);
    if (docs.length === 1) return clone(docs[0]);
    const out = { version: VERSION, id: '', title: '对话合集', source: { format: 'collection' }, conversations: [], turns: [], warnings: [] };
    const ids = newIds();
    for (const input of docs) {
      const doc = clone(input), remap = new Map(), turnRemap = new Map();
      for (const conversation of doc.conversations) {
        const id = unique(conversation.id, ids.conversations);
        remap.set(conversation.id, id);
        out.conversations.push({ ...conversation, id });
      }
      for (const turn of doc.turns) turnRemap.set(turn.id, unique(turn.id, ids.turns));
      for (const turn of doc.turns) {
        turn.id = turnRemap.get(turn.id);
        turn.conversationId = remap.get(turn.conversationId);
        if (turn.originConversationIds) turn.originConversationIds = turn.originConversationIds.map(id => remap.get(id) || id);
        for (const message of turn.messages) {
          message.id = unique(message.id, ids.messages);
          if (message.originConversationId) message.originConversationId = remap.get(message.originConversationId) || message.originConversationId;
          if (message.originTurnId) message.originTurnId = turnRemap.get(message.originTurnId) || message.originTurnId;
        }
        out.turns.push(turn);
      }
      out.warnings.push(...(doc.warnings || []));
    }
    out.id = idFor('document', out.conversations.map(item => item.id).join('\0'));
    return validate(out);
  }
  function search(doc, query) {
    validate(doc);
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return [];
    const result = [];
    for (const turn of doc.turns) {
      for (const message of turn.messages) {
        const index = message.content.toLocaleLowerCase().indexOf(needle);
        if (index < 0) continue;
        const start = Math.max(0, index - 50), end = Math.min(message.content.length, index + needle.length + 110);
        result.push({
          turnId: turn.id, messageId: message.id, role: message.role, index,
          excerpt: (start ? '…' : '') + message.content.slice(start, end).replace(/\s+/g, ' ') + (end < message.content.length ? '…' : '')
        });
      }
    }
    return result;
  }
  return { VERSION, parse, fromMarkdown, toMarkdown, moveTurn, deleteTurn, mergeTurns, combine, search, validate };
});
