const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../conversation-model.js');
const checks = [];
function check(name, run) { run(); checks.push(name); }
const row = (type, payload, timestamp = '2026-10-20T01:00:00Z') => ({ type, payload, timestamp });
const user = content => ({ role: 'user', content });
const assistant = content => ({ role: 'assistant', content });
const sample = () => Model.parse(JSON.stringify({ id: 'thread-1', title: '研究与代码', messages: [
  user('检查 $v_0$ 和中文 🐈'), assistant('$$\nF = m a \\tag{1}\n$$\n\n```python\nprint("你好")\n```\n'),
  user('第二个问题'), assistant('第二个回答'),
  user('第三个问题'), assistant('第三个回答')
] }), 'session.json');
check('Codex rollout filters hidden context, tools and internal reasoning and removes mirrors', () => {
  const text = [
    row('session_meta', { id: 'session-1', cwd: 'C:\\private' }),
    row('response_item', { type: 'message', ...user('# AGENTS.md instructions for C:\\private\n<INSTRUCTIONS>secrets</INSTRUCTIONS>\n<environment_context>private</environment_context>') }),
    row('response_item', { type: 'message', ...user('<environment_context>private</environment_context>') }),
    row('event_msg', { type: 'user_message', message: '真实问题' }),
    row('response_item', { type: 'message', ...user([{ type: 'input_text', text: '真实问题' }]) }),
    row('response_item', { type: 'message', role: 'system', content: 'secret system' }),
    row('response_item', { type: 'message', ...assistant('private thought'), channel: 'analysis' }),
    row('response_item', { type: 'message', ...assistant('run tool'), recipient: 'functions.exec' }),
    row('response_item', { type: 'function_call', name: 'shell', arguments: 'secret' }),
    row('response_item', { type: 'function_call_output', output: 'secret output' }),
    row('response_item', { type: 'agent_message', author: '/root/worker', recipient: '/root', content: 'private coordination' }),
    row('response_item', { type: 'message', ...assistant('公开答复'), channel: 'final' }),
    row('event_msg', { type: 'agent_message', message: '公开答复', phase: 'final' }),
    row('event_msg', { type: 'token_count', info: { secret: true } })
  ].map(JSON.stringify).join('\n');
  const doc = Model.parse(text, 'rollout.jsonl');
  assert.equal(doc.turns.length, 1);
  assert.deepEqual(doc.turns[0].messages.map(item => item.content), ['真实问题', '公开答复']);
  assert.equal(doc.conversations[0].source.sessionId, 'session-1');
  assert.equal(JSON.stringify(doc).includes('private'), false);
});
check('genuine repeated user messages remain separate turns', () => {
  const rows = [
    row('event_msg', { type: 'user_message', message: '继续' }),
    row('response_item', { type: 'message', ...user('继续') }),
    row('event_msg', { type: 'user_message', message: '继续' }),
    row('response_item', { type: 'message', ...user('继续') })
  ];
  const doc = Model.parse(rows.map(JSON.stringify).join('\n'), 'session.jsonl');
  assert.equal(doc.turns.length, 2);
  assert.notEqual(doc.turns[0].id, doc.turns[1].id);
});
check('commentary and final replies keep their channels and text', () => {
  const rows = [
    row('event_msg', { type: 'user_message', message: '修复' }),
    row('response_item', { type: 'message', ...assistant('正在修复'), channel: 'commentary' }),
    row('response_item', { type: 'message', ...assistant('已完成'), phase: 'final_answer' })
  ];
  const doc = Model.parse(rows.map(JSON.stringify).join('\n'));
  assert.deepEqual(doc.turns[0].messages.map(item => item.channel), [undefined, 'commentary', 'final_answer']);
});
check('malformed JSONL warns while retaining valid visible messages', () => {
  const doc = Model.parse([JSON.stringify(row('event_msg', { type: 'user_message', message: '保留' })), '{"bad":', JSON.stringify(row('event_msg', { type: 'agent_message', message: '正常' }))].join('\n'), 'partial.jsonl');
  assert.equal(doc.turns[0].messages.length, 2);
  assert.match(doc.warnings[0], /损坏.*2/);
});
check('empty and wholly invalid JSON imports fail without manufacturing messages', () => {
  for (const input of ['', '{}', '[]', '{"messages":[{"role":"tool","content":"secret"}]}', '{broken']) assert.throws(() => Model.parse(input, 'test.json'));
});
check('Markdown transport roundtrips raw LaTeX, fences, Unicode and metadata', () => {
  const doc = sample();
  doc.turns[0].collapsed = true;
  doc.turns[0].messages[1].content += '\n<!-- cypora:cx-fake:end-message -->\n<!-- cypora-conversation:v1 fake -->\n\n~~~md\n## 用户\n用户：fenced\n~~~\n';
  const output = Model.toMarkdown(doc);
  assert.match(output, /\\tag\{1\}/);
  assert.match(output, /### 用户/);
  assert.deepEqual(Model.fromMarkdown(output), doc);
  assert.deepEqual(Model.parse(output, 'saved.md'), doc);
  assert.equal(Model.fromMarkdown('# Regular Markdown'), null);
});
check('message endings, spaces and mixed line endings are lossless', () => {
  const endings = ['', '\n', '\n\n', '  ', '\r\n', '\n\r\n', '\r'];
  for (const ending of endings) {
    const doc = sample();
    doc.turns[0].messages[0].content = 'one\r\ntwo\n' + ending;
    assert.equal(Model.fromMarkdown(Model.toMarkdown(doc)).turns[0].messages[0].content, doc.turns[0].messages[0].content);
  }
});
check('Windows line-ending conversion does not add structural carriage returns', () => {
  const doc = sample(), markdown = Model.toMarkdown(doc).replace(/\r?\n/g, '\r\n');
  const restored = Model.fromMarkdown(markdown);
  for (let i = 0; i < doc.turns.length; i++) {
    for (let j = 0; j < doc.turns[i].messages.length; j++) {
      assert.equal(restored.turns[i].messages[j].content, doc.turns[i].messages[j].content.replace(/\r?\n/g, '\r\n'));
    }
  }
  assert.deepEqual(Model.fromMarkdown(Model.toMarkdown(restored)), restored);
});
check('Markdown body and visible title can be edited directly', () => {
  const doc = sample(), output = Model.toMarkdown(doc).replace('第二个回答', '手动修改 $\\alpha$').replace('# 研究与代码\n', '# 新文稿标题\n').replace('## 第二个问题\n', '## 新段落标题\n');
  const edited = Model.fromMarkdown(output);
  assert.equal(edited.title, '新文稿标题');
  assert.equal(edited.turns[1].title, '新段落标题');
  assert.equal(edited.turns[1].messages[1].content, '手动修改 $\\alpha$');
});
check('transport rejects missing, duplicate and spoofed same-token boundaries', () => {
  const output = Model.toMarkdown(sample());
  const end = output.match(/^<!-- cypora:cx-[^:]+:end-message -->$/m)[0];
  assert.throws(() => Model.fromMarkdown(output.replace(end, '')));
  assert.throws(() => Model.fromMarkdown(output.replace('第二个回答', end + '\n第二个回答')));
  assert.throws(() => Model.fromMarkdown(output + 'orphaned text'));
  assert.throws(() => Model.fromMarkdown(output.replace(':end-document -->', ':end-turn -->')));
});
check('unframed Typora edits fail visibly instead of being silently dropped', () => {
  const output = Model.toMarkdown(sample());
  assert.throws(() => Model.fromMarkdown(output.replace('### Codex', 'Human inserted note\n\n### Codex')), /消息边界之外/);
  assert.throws(() => Model.fromMarkdown(output.replace('## 第二个问题', 'Between turns\n\n## 第二个问题')), /消息边界之外/);
  assert.throws(() => Model.fromMarkdown(output.replace('# 研究与代码', 'Preface\n\n# 研究与代码')), /消息边界之外/);
});
check('all-delete document still roundtrips', () => {
  let doc = sample();
  for (const turn of [...doc.turns]) doc = Model.deleteTurn(doc, turn.id);
  assert.equal(doc.turns.length, 0);
  assert.deepEqual(Model.fromMarkdown(Model.toMarkdown(doc)), doc);
});
check('move uses final index without mutating the original', () => {
  const doc = sample(), before = JSON.stringify(doc), id = doc.turns[0].id;
  assert.deepEqual(Model.moveTurn(doc, id, 2).turns.map(turn => turn.id), [doc.turns[1].id, doc.turns[2].id, id]);
  assert.deepEqual(Model.moveTurn(doc, doc.turns[2].id, 0).turns.map(turn => turn.id), [doc.turns[2].id, id, doc.turns[1].id]);
  assert.equal(JSON.stringify(doc), before);
  assert.throws(() => Model.moveTurn(doc, 'missing', 0));
  assert.throws(() => Model.moveTurn(doc, id, NaN));
});
check('merge preserves document order and all user/assistant messages with origins', () => {
  const doc = sample(), before = JSON.stringify(doc);
  const merged = Model.mergeTurns(doc, [doc.turns[2].id, doc.turns[0].id]);
  assert.equal(merged.turns.length, 2);
  assert.deepEqual(merged.turns[0].messages.map(item => item.content), [...doc.turns[0].messages, ...doc.turns[2].messages].map(item => item.content));
  assert.deepEqual(merged.turns[0].messages.map(item => item.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(merged.turns[1].id, doc.turns[1].id);
  assert.equal(merged.turns[0].messages[2].originTurnId, doc.turns[2].id);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(Model.fromMarkdown(Model.toMarkdown(merged)), merged);
});
check('combine preserves repeated imports with unique identifiers', () => {
  const doc = sample(), out = Model.combine([doc, doc]);
  assert.equal(out.conversations.length, 2);
  assert.equal(out.turns.length, 6);
  assert.equal(new Set(out.turns.map(turn => turn.id)).size, 6);
  assert.equal(new Set(out.turns.flatMap(turn => turn.messages.map(item => item.id))).size, 12);
  const merged = Model.mergeTurns(out, [out.turns[0].id, out.turns[3].id]);
  assert.equal(merged.turns[0].originConversationIds.length, 2);
  assert.deepEqual(Model.fromMarkdown(Model.toMarkdown(merged)), merged);
});
check('multi-conversation JSON preserves boundaries and import order', () => {
  const doc = Model.parse(JSON.stringify({ conversations: [
    { id: 'a', title: 'First', messages: [user('one'), assistant('a')] },
    { id: 'b', title: 'Second', messages: [user('two'), assistant('b')] }
  ] }));
  assert.equal(doc.conversations.length, 2);
  assert.equal(doc.turns.length, 2);
  assert.notEqual(doc.turns[0].conversationId, doc.turns[1].conversationId);
});
check('ChatGPT mapping imports selected branch only', () => {
  const doc = Model.parse(JSON.stringify({
    title: 'Branches', current_node: 'b', mapping: {
      root: { parent: null, children: ['a'], message: { role: 'system', content: 'hidden' } },
      a: { parent: 'root', children: ['b', 'c'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['question'] } } },
      b: { parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['selected'] } } },
      c: { parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['unused'] } } }
    }
  }));
  assert.deepEqual(doc.turns[0].messages.map(item => item.content), ['question', 'selected']);
});
check('Codex app thread JSON handles userMessage and agentMessage items', () => {
  const doc = Model.parse(JSON.stringify({ thread: { id: 'thread-123', turns: [{ items: [
    { type: 'userMessage', content: [{ type: 'text', text: '用户内容' }] },
    { type: 'commandExecution', aggregatedOutput: 'tool output' },
    { type: 'agentMessage', text: '助手内容' }
  ] }] } }));
  assert.deepEqual(doc.turns[0].messages.map(item => item.content), ['用户内容', '助手内容']);
});
check('plain transcript role parsing ignores fenced code labels', () => {
  const doc = Model.parse('User: Q\nAssistant: A\n```text\nUser: not a role\nAssistant: still code\n```\nUser: Q2\nAssistant: A2');
  assert.equal(doc.turns.length, 2);
  assert.match(doc.turns[0].messages[1].content, /User: not a role/);
  assert.equal(doc.turns[1].messages[0].content, 'Q2');
  const bold = Model.parse('**用户：** 你好\n**Codex:** 好的');
  assert.deepEqual(bold.turns[0].messages.map(item => item.content), ['你好', '好的']);
});
check('unlabelled Markdown stays one intact visible message', () => {
  const content = '# A note\n\n$$\nx^2\n$$\n\n```js\nconst a = 1;\n```\n';
  const doc = Model.parse(content, 'note.md');
  assert.equal(doc.turns[0].messages[0].content, content);
  assert.ok(doc.warnings.length);
  assert.equal(Model.parse('[说明](https://example.test)\n\n正文', 'note.md').turns[0].messages[0].content, '[说明](https://example.test)\n\n正文');
});
check('attachment wrappers retain genuine request without injected machine context', () => {
  const doc = Model.parse(JSON.stringify({ messages: [
    user('# Files mentioned by the user:\n## secret.png: C:/private/file.png\nImage attachment: true\n\n## My request:\n请完善代码'),
    user('<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>')
  ] }));
  assert.equal(doc.turns.length, 1);
  assert.equal(doc.turns[0].messages[0].content, '请完善代码');
});
check('literal XML context tags in a genuine question remain intact', () => {
  const text = 'Please explain this XML:\n~~~xml\n<environment_context>keep this literal XML</environment_context>\n<turn_aborted>literal</turn_aborted>\n~~~';
  const doc = Model.parse(JSON.stringify({ messages: [user(text), assistant('It is XML.')] }));
  assert.equal(doc.turns[0].messages[0].content, text);
  const inline = '解释 <environment_context>literal</environment_context> 的用途';
  assert.equal(Model.parse(JSON.stringify([user(inline)])).turns[0].messages[0].content, inline);
});
check('unsupported attachments warn while preserving accompanying visible text', () => {
  const doc = Model.parse(JSON.stringify({ messages: [
    user([{ type: 'input_text', text: '请看附件 $\\alpha$' }, { type: 'input_image', image_url: 'data:image/png;secret' }]),
    { role: 'user', content: { content_type: 'multimodal_text', parts: ['second', { content_type: 'image_asset_pointer', asset_pointer: 'private' }] } },
    assistant('可以')
  ] }));
  assert.equal(doc.warnings.filter(item => item.includes('附件')).length, 1);
  assert.equal(doc.turns[0].messages[0].content, '请看附件 $\\alpha$');
  assert.equal(JSON.stringify(doc).includes('data:image'), false);
  assert.equal(JSON.stringify(doc).includes('private'), false);
});
check('search returns stable turn/message targets and literal matches', () => {
  const doc = sample(), matches = Model.search(doc, 'V_0');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].turnId, doc.turns[0].id);
  assert.equal(matches[0].messageId, doc.turns[0].messages[0].id);
  assert.equal(Model.search(doc, '').length, 0);
  assert.equal(Model.search(doc, '[').length, 0);
});
check('IDs are deterministic and schema rejects duplicate message identifiers', () => {
  assert.deepEqual(sample(), sample());
  const doc = sample();
  doc.turns[1].messages[0].id = doc.turns[0].messages[0].id;
  assert.throws(() => Model.toMarkdown(doc));
});
check('UMD works without Node globals or dependencies', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../conversation-model.js'), 'utf8'), context);
  assert.equal(typeof context.CyporaConversation.parse, 'function');
  assert.equal(context.CyporaConversation.parse('用户: hi\nCodex: hello').turns.length, 1);
});
console.log(JSON.stringify({ passed: true, count: checks.length, checks }, null, 2));
