const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {count} = require('../reading-preferences.js');
const checks = [];
function check(name, action) { action(); checks.push({name, passed: true}); }
check('empty text has no words, paragraphs or reading time', () => {
  assert.deepEqual(count(''), {chinese:0,words:0,units:0,characters:0,paragraphs:0,lines:0,wordsPerMinute:300,minutes:0});
});
check('Chinese and non-Chinese words remain separate', () => {
  const result = count('你好 world hello-world 2026');
  assert.equal(result.chinese, 2); assert.equal(result.words, 4); assert.equal(result.units, 6);
});
check('Unicode Han extensions and emoji count by code point', () => {
  const result = count('𠮷你好🙂');
  assert.equal(result.chinese, 3); assert.equal(result.words, 0); assert.equal(result.characters, 4);
});
check('Unicode letters and contractions form words', () => {
  const result = count("café don't l’esprit Ελληνικά");
  assert.equal(result.words, 4);
});
check('BOM and CRLF do not inflate counts', () => {
  const plain = '你好 world\n\n下一段\n';
  assert.deepEqual(count('\ufeff' + plain.replaceAll('\n', '\r\n')), count(plain));
});
check('blank line groups separate paragraphs but wrapped lines do not', () => {
  const result = count('\n first\nwrapped\n \t\n\nsecond\n\n');
  assert.equal(result.paragraphs, 2);
});
check('whitespace alone is not a paragraph or character', () => {
  const result = count(' \t\n \r\n');
  assert.equal(result.paragraphs, 0); assert.equal(result.characters, 0); assert.equal(result.minutes, 0);
});
check('code, formulas and Markdown are counted as source without execution', () => {
  const source = '```js\nalert("hello")\n```\n\n$$\nx^{2}\n$$';
  const before = source;
  assert.equal(count(source).paragraphs, 2);
  assert.equal(count(source).words, 5);
  assert.equal(source, before);
});
check('reading speed adjusts rounded-up estimate', () => {
  assert.equal(count('中'.repeat(601), 300).minutes, 3);
  assert.equal(count('中'.repeat(601), 1000).minutes, 1);
});
check('reading speed is bounded and bad values use the default', () => {
  assert.equal(count('a', 50).wordsPerMinute, 100);
  assert.equal(count('a', 5000).wordsPerMinute, 1000);
  assert.equal(count('a', NaN).wordsPerMinute, 300);
  assert.equal(count('a', '200').wordsPerMinute, 300);
});
const result = {passed: true, checkCount: checks.length, checks};
const destination = path.resolve(__dirname, '../verification/20261020-typora-claude/reading');
fs.mkdirSync(destination, {recursive:true});
fs.writeFileSync(path.join(destination, 'pure-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
