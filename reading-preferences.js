/* Reading-only preferences. No Markdown, selection, or undo state is modified. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingPreferences = api;
})(typeof window === 'object' ? window : null, function (win) {
  'use strict';
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const speed = value => typeof value === 'number' && Number.isFinite(value) ? clamp(value, 100, 1000) : 300;
  // Count Unicode code points, not UTF-16 units. The declared scope is Markdown
  // source: code and formulas remain literal, and neither is executed or altered.
  function count(text, wordsPerMinute = 300) {
    const source = String(text ?? '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
    const chinese = (source.match(/\p{Script=Han}/gu) || []).length;
    const other = source.replace(/\p{Script=Han}/gu, ' ');
    const words = (other.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
    const units = chinese + words;
    const characters = [...source].filter(character => !/\s/u.test(character)).length;
    const paragraphs = source.trim() ? source.trim().split(/\n[\t ]*\n(?:[\t ]*\n)*/).filter(part => part.trim()).length : 0;
    return {
      chinese, words, units, characters, paragraphs,
      lines: source ? source.split('\n').length : 0,
      wordsPerMinute: speed(wordsPerMinute),
      minutes: units ? Math.ceil(units / speed(wordsPerMinute)) : 0
    };
  }
  const hooks = {getText: () => '', getSettings: () => ({})};
  let initialized = false, popup = null, counter = null, zoomTimer = null, pendingZoom = null, lastText = null, lastSpeed = null, cached = null;
  function settings() { return hooks.getSettings?.() || {}; }
  function stats() {
    const text = String(hooks.getText?.() ?? ''), rate = speed(settings().wordsPerMinute);
    if (text !== lastText || rate !== lastSpeed || !cached) {
      lastText = text; lastSpeed = rate; cached = count(text, rate);
    }
    return cached;
  }
  function element(tag, className, text) {
    const node = win.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function init() {
    if (!win?.document || initialized) return;
    if (!win.document.body) {
      win.document.addEventListener('DOMContentLoaded', init, {once: true});
      return;
    }
    initialized = true;
    const style = element('style');
    style.id = 'reading-preferences-style';
    style.textContent = `
      body[data-first-line-indent="true"] #editor .vditor-ir>.vditor-reset>p,
      body[data-first-line-indent="true"] #editor .vditor-wysiwyg>.vditor-reset>p,
      body[data-first-line-indent="true"] #editor .vditor-preview .vditor-reset>p,
      body[data-first-line-indent="true"] #conversation-view .conversation-markdown>p {text-indent:2em}
      #reading-statistics {position:fixed;z-index:260;width:304px;box-sizing:border-box;padding:19px 20px 16px;
        border:1px solid var(--line);border-radius:14px;background:var(--paper);color:var(--ink);
        font:var(--ui-size,14px)/1.5 var(--ui-font,sans-serif);box-shadow:0 10px 34px #00000018;
        overflow:auto;overscroll-behavior:contain}
      #reading-statistics[hidden],#counter[hidden] {display:none!important}
      #reading-statistics .reading-statistics-heading {display:flex;align-items:center;justify-content:space-between;gap:12px}
      #reading-statistics h2 {font-size:15px;font-weight:600;margin:0}
      #reading-statistics .reading-statistics-close {display:grid;place-items:center;width:26px;height:26px;padding:4px;
        color:var(--muted);border-radius:6px}
      #reading-statistics .reading-statistics-close svg {display:block;width:16px;height:16px}
      #reading-statistics dl {display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 18px;margin:18px 0 15px}
      #reading-statistics dt {color:var(--muted)}
      #reading-statistics dd {margin:0;font-variant-numeric:tabular-nums;text-align:right}
      #reading-statistics .reading-statistics-note {border-top:1px solid var(--line);padding-top:12px;margin:0;
        font-size:11px;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}
      #reading-statistics button:focus-visible {outline:2px solid var(--accent);outline-offset:2px}
      @media(max-width:420px){#reading-statistics{padding:16px}}
    `;
    win.document.head.append(style);
    popup = element('section');
    popup.id = 'reading-statistics';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-labelledby', 'reading-statistics-title');
    const heading = element('div', 'reading-statistics-heading');
    const title = element('h2', '', '文稿统计');
    title.id = 'reading-statistics-title';
    const closeButton = element('button', 'reading-statistics-close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭文稿统计');
    closeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    closeButton.addEventListener('click', () => close(true));
    heading.append(title, closeButton);
    popup.append(heading, element('dl', 'reading-statistics-values'), element('p', 'reading-statistics-note'));
    win.document.body.append(popup);
    win.document.addEventListener('click', event => {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.('#counter')) {
        if (!counter?.hidden && !win.document.querySelector('dialog[open]')) popup.hidden ? open() : close(true);
      } else if (!popup.hidden && !popup.contains(target)) close(false);
    });
    win.document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !popup.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
      }
    }, true);
    win.document.addEventListener('focusin', event => {
      if (!popup.hidden && event.target !== counter && !popup.contains(event.target)) close(false);
    });
    win.document.addEventListener('wheel', onWheel, {passive: false});
    win.addEventListener('resize', () => { if (!popup.hidden) position(); });
    win.document.addEventListener('scroll', () => { if (!popup.hidden) position(); }, {capture: true, passive: true});
    apply();
  }
  function position() {
    if (!popup || popup.hidden || !counter) return;
    const margin = 12, width = Math.max(120, Math.min(304, win.innerWidth - margin * 2));
    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${Math.max(80, win.innerHeight - margin * 2)}px`;
    const anchor = counter.getBoundingClientRect();
    const height = popup.getBoundingClientRect().height;
    popup.style.left = `${clamp(anchor.right - width, margin, Math.max(margin, win.innerWidth - width - margin))}px`;
    popup.style.top = `${clamp(anchor.top - height - 10, margin, Math.max(margin, win.innerHeight - height - margin))}px`;
  }
  function populate() {
    if (!popup) return;
    const data = stats(), list = popup.querySelector('dl');
    list.replaceChildren();
    const number = value => value.toLocaleString('zh-CN');
    for (const [label, value] of [
      ['汉字', number(data.chinese)], ['其他词', number(data.words)],
      ['字符（不含空白）', number(data.characters)], ['段落', number(data.paragraphs)],
      ['预计阅读', data.minutes ? `约 ${number(data.minutes)} 分钟` : '0 分钟']
    ]) list.append(element('dt', '', label), element('dd', '', value));
    popup.querySelector('.reading-statistics-note').textContent =
      `基于当前 Markdown 源码统计，代码和公式源码也计入；按每分钟 ${number(data.wordsPerMinute)} 字词估算。`;
  }
  function open() {
    if (!counter || counter.hidden || !popup) return;
    populate();
    popup.hidden = false;
    counter.setAttribute('aria-expanded', 'true');
    position();
    popup.querySelector('button').focus({preventScroll: true});
  }
  function close(restoreFocus = false) {
    if (!popup) return;
    const ownedFocus = popup.contains(win.document.activeElement);
    popup.hidden = true;
    counter?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && ownedFocus && counter && !counter.hidden) counter.focus({preventScroll: true});
  }
  function onWheel(event) {
    const prefs = settings();
    if (!prefs.zoomByMouse || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !event.deltaY || !event.cancelable) return;
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (!target?.closest?.('#editor, #conversation-view .conversation-scroll')) return;
    if (win.document.querySelector('dialog[open]') ||
      target.closest('input,textarea,select,[role="dialog"],[role="listbox"],[role="menu"]') ||
      win.document.activeElement?.matches('input,textarea,select')) return;
    const savePatch = win.PreferencesUI?.savePatch;
    if (typeof savePatch !== 'function') return;
    event.preventDefault();
    const current = pendingZoom ?? (typeof prefs.zoom === 'number' ? prefs.zoom : 100);
    pendingZoom = clamp(current + (event.deltaY > 0 ? -5 : 5), 75, 175);
    win.clearTimeout(zoomTimer);
    zoomTimer = win.setTimeout(() => {
      const zoom = pendingZoom;
      pendingZoom = null; zoomTimer = null;
      if (!settings().zoomByMouse || zoom === settings().zoom) return;
      Promise.resolve(savePatch({zoom})).catch(error => console.error('无法保存阅读缩放：', error));
    }, 80);
  }
  function refresh() {
    if (!initialized) { init(); return; }
    counter = win.document.querySelector('#counter');
    if (counter) {
      const data = stats();
      counter.hidden = settings().showWordCount === false;
      counter.textContent = `${data.units.toLocaleString('zh-CN')} 字词 · ${data.lines.toLocaleString('zh-CN')} 行`;
      counter.title = '查看文稿统计';
      counter.setAttribute('aria-label', `文稿统计：${data.units.toLocaleString('zh-CN')} 字词`);
      counter.setAttribute('aria-haspopup', 'dialog');
      counter.setAttribute('aria-controls', 'reading-statistics');
      counter.setAttribute('aria-expanded', String(!popup.hidden));
    }
    if (!counter || counter.hidden || settings().showStatusBar === false) close(false);
    else if (!popup.hidden) { populate(); position(); }
  }
  function apply() {
    if (!initialized) { init(); return; }
    win.document.body.dataset.firstLineIndent = String(!!settings().firstLineIndent);
    if (!settings().zoomByMouse) {
      win.clearTimeout(zoomTimer); zoomTimer = null; pendingZoom = null;
    }
    refresh();
  }
  function configure(options = {}) {
    Object.assign(hooks, options);
    init(); apply();
    return api;
  }
  const api = {configure, apply, refresh, count, close};
  return api;
});
