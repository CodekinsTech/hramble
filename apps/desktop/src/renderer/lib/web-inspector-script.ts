// Embeddable in-page design inspector — sourced from the user's own original
// web-inspector.js. Element picker (WCAG contrast), colors, fonts, assets
// (ZIP export), CSS/JSON/Tailwind tokens, spacing measure tool, a self-drawn
// crosshair color picker (no OS-level eyedropper/magnifier). Recolored to
// Hramble's own dark-theme accent; tab names, the font-card layout, and the
// footer copy were deliberately changed from an earlier draft that read too
// close to a specific competitor's tool — same functionality, different
// presentation. Injected into the browser pane's loaded page on demand;
// renders its own floating button + side panel there.
export const WEB_INSPECTOR_SCRIPT = `/* web-inspector.js — an embeddable in-page design inspector.
 *
 * Drop into any app/web page and call WebInspect.init(). Injects a floating
 * button + a side panel to inspect elements, pull the page's colors & fonts,
 * extract images/SVGs, pick any element's color with a simple crosshair,
 * measure spacing between elements, and export design tokens.
 *
 * No extension APIs, no build step, no dependencies (includes its own ZIP writer).
 * Inspects the document it runs in (same-origin). 100% local — nothing is sent out.
 *
 *   WebInspect.init({ accent:'#ec4899', name:'Inspect' })
 *   WebInspect.open() / .close() / .toggle() / .pick()
 *
 * The tool's own DOM lives under #wbi-root and is excluded from all results.
 */
(function () {
  'use strict';
  if (window.WebInspect) return;

  var CFG = { accent: '#6fcbf3', name: 'Inspect' };
  var root, panel, btn, overlay, tipEl, mBoxA, mBoxB, mLabel, mSvg, mLine;
  var picking = false, measuring = false, colorPicking = false, mPhase = 0, mAnc = null, selected = null, tab = 'palette';

  /* ---------------- icons ---------------- */
  var IC = {
    cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6 16 2-6 6-2z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3l3 3-10 10-3 1 1-3z"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l12-6 6 12-12 6z"/><path d="M8.5 7.5l1 2M12 6l1 2M15.5 7.5l1 2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  /* ---------------- utilities ---------------- */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function mine(node) { return node && node.closest && node.closest('#wbi-root'); }
  function clamp(n) { return Math.max(0, Math.min(255, n)); }
  function toHex(rgb) {
    if (!rgb) return null;
    var m = rgb.match(/rgba?\\(([^)]+)\\)/); if (!m) return rgb.charAt(0) === '#' ? rgb : null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    if (p.length >= 4 && p[3] === 0) return null;
    return '#' + [p[0], p[1], p[2]].map(function (n) { return ('0' + clamp(Math.round(n)).toString(16)).slice(-2); }).join('');
  }
  function lum(hex) {
    var c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map(function (x) { return x + x; }).join('');
    var r = parseInt(c.substr(0, 2), 16) / 255, g = parseInt(c.substr(2, 2), 16) / 255, b = parseInt(c.substr(4, 2), 16) / 255;
    [r, g, b] = [r, g, b].map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) { try { var L1 = lum(a), L2 = lum(b); return ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)); } catch (e) { return null; } }
  function copy(text, note) {
    try { navigator.clipboard.writeText(text); } catch (e) {
      var t = el('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove();
    }
    // Whenever the copied value is itself a hex color, show a visible swatch
    // next to the confirmation — not just text — so it's obvious what got picked.
    var isHex = /^#[0-9a-f]{3,8}$/i.test(text);
    toast(note || 'Copied', isHex ? text : null);
  }
  var toastEl;
  function toast(msg, swatchHex) {
    if (!toastEl) { toastEl = el('div', { id: 'wbi-toast' }); root.appendChild(toastEl); }
    toastEl.innerHTML = (swatchHex ? '<span class="wbi-tipsw" style="background:' + swatchHex + '"></span>' : '') + msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1500);
  }
  function toolActive(id, on) { var e = root.querySelector('#wbi-tool-' + id); if (e) e.classList.toggle('on', !!on); }

  /* ---------------- collectors ---------------- */
  // Same-origin iframes are reachable via contentDocument; cross-origin ones
  // throw on access (browser security boundary no page script can cross) —
  // caught and silently skipped, so those frames just don't contribute.
  function frameDocs() {
    var docs = [];
    var frames;
    try { frames = document.querySelectorAll('iframe'); } catch (e) { return docs; }
    for (var i = 0; i < frames.length; i++) {
      try {
        var d = frames[i].contentDocument;
        if (d && d.body) docs.push(d);
      } catch (e) { /* cross-origin — inaccessible */ }
    }
    return docs;
  }
  function walk() {
    var nodes = Array.prototype.slice.call(document.body.querySelectorAll('*')).filter(function (n) { return !mine(n); });
    frameDocs().forEach(function (d) {
      try { nodes = nodes.concat(Array.prototype.slice.call(d.body.querySelectorAll('*'))); } catch (e) {}
    });
    return nodes;
  }
  function elementCount() { return walk().length; }
  function collectColors() {
    var map = {};
    walk().forEach(function (n) {
      var s = getComputedStyle(n);
      ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'fill', 'stroke'].forEach(function (p) {
        var h = toHex(s.getPropertyValue(p)); if (h) map[h] = (map[h] || 0) + 1;
      });
    });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).map(function (h) { return { hex: h, count: map[h] }; });
  }
  function collectFonts() {
    var map = {};
    walk().forEach(function (n) {
      var st = getComputedStyle(n), f = st.fontFamily; if (!f) return;
      var first = f.split(',')[0].replace(/["']/g, '').trim(); if (!first) return;
      if (!map[first]) map[first] = { count: 0, weights: {} };
      map[first].count++; var w = st.fontWeight; if (w) map[first].weights[w] = 1;
    });
    return Object.keys(map).sort(function (a, b) { return map[b].count - map[a].count; })
      .map(function (f) { return { family: f, count: map[f].count, weights: Object.keys(map[f].weights).sort(function (a, b) { return a - b; }) }; });
  }
  function collectAssets() {
    var imgs = [], svgs = [], seen = {};
    function addImgs(doc) {
      Array.prototype.forEach.call(doc.images, function (im) {
        if (mine(im) || !im.src || seen[im.src]) return; seen[im.src] = 1;
        imgs.push({ src: im.src, w: im.naturalWidth, h: im.naturalHeight });
      });
    }
    addImgs(document);
    frameDocs().forEach(function (d) { try { addImgs(d); } catch (e) {} });
    walk().forEach(function (n) {
      var m = getComputedStyle(n).backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (m && !seen[m[1]]) { seen[m[1]] = 1; imgs.push({ src: m[1], w: 0, h: 0, bg: true }); }
    });
    function addSvgs(doc) {
      Array.prototype.forEach.call(doc.querySelectorAll('svg'), function (sv) { if (!mine(sv)) svgs.push({ code: sv.outerHTML, w: sv.clientWidth, h: sv.clientHeight }); });
    }
    addSvgs(document);
    frameDocs().forEach(function (d) { try { addSvgs(d); } catch (e) {} });
    return { imgs: imgs, svgs: svgs };
  }

  /* ---------------- element detail ---------------- */
  var CSS_KEYS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'text-align', 'padding', 'margin', 'width', 'height', 'border', 'border-radius', 'box-shadow', 'display', 'opacity'];
  function detail(node) {
    var s = getComputedStyle(node), r = node.getBoundingClientRect(), css = {};
    CSS_KEYS.forEach(function (k) { css[k] = s.getPropertyValue(k); });
    return {
      tag: node.tagName.toLowerCase(),
      cls: (node.className && typeof node.className === 'string') ? '.' + node.className.trim().split(/\\s+/).join('.') : '',
      id: node.id ? '#' + node.id : '', rect: { w: Math.round(r.width), h: Math.round(r.height) },
      fg: toHex(s.color), bg: toHex(s.backgroundColor), css: css
    };
  }
  function cssText(d) {
    var sel = (d.tag + (d.id || '') + (d.cls || '')) || d.tag;
    var lines = Object.keys(d.css).filter(function (k) { var v = d.css[k]; return v && v !== 'none' && v !== 'normal' && v !== 'rgba(0, 0, 0, 0)' && v !== '0px'; })
      .map(function (k) { return '  ' + k + ': ' + d.css[k] + ';'; });
    return sel + ' {\\n' + lines.join('\\n') + '\\n}';
  }

  /* ---------------- tokens export ---------------- */
  function exportTokens(fmt) {
    var colors = collectColors().slice(0, 24), fonts = collectFonts().slice(0, 6);
    if (fmt === 'json') return JSON.stringify({ colors: colors.map(function (c) { return c.hex; }), fonts: fonts.map(function (f) { return f.family; }) }, null, 2);
    if (fmt === 'tailwind') {
      var col = colors.map(function (c, i) { return '        c' + (i + 1) + ": '" + c.hex + "'"; }).join(',\\n');
      var fon = fonts.map(function (f, i) { return "        f" + (i + 1) + ": ['" + f.family + "']"; }).join(',\\n');
      return 'export default {\\n  theme: {\\n    extend: {\\n      colors: {\\n' + col + '\\n      },\\n      fontFamily: {\\n' + fon + '\\n      }\\n    }\\n  }\\n}';
    }
    var c = colors.map(function (c, i) { return '  --color-' + (i + 1) + ': ' + c.hex + ';'; }).join('\\n');
    var f = fonts.map(function (f, i) { return '  --font-' + (i + 1) + ": '" + f.family + "';"; }).join('\\n');
    return ':root {\\n' + c + '\\n' + f + '\\n}';
  }

  /* ---------------- ZIP (store-only, no deps) ---------------- */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var chunks = [], central = [], offset = 0, enc = new TextEncoder();
    function u16(n) { return [n & 255, (n >> 8) & 255]; } function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, f.data);
      var cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cen), name); offset += local.length + name.length + sz;
    });
    var cenSize = 0; central.forEach(function (c) { cenSize += c.length; });
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cenSize), u32(offset), u16(0)));
    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  }
  function download(blob, name) { var a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 500); }
  function nameFromUrl(u, i) { try { var p = new URL(u, location.href).pathname.split('/').pop() || ('asset' + i); return p.indexOf('.') > 0 ? p : p + '.img'; } catch (e) { return 'asset' + i + '.img'; } }
  async function downloadAllImages(imgs) {
    toast('Packaging…'); var files = [], ok = 0;
    for (var i = 0; i < imgs.length; i++) { try { var r = await fetch(imgs[i].src); files.push({ name: nameFromUrl(imgs[i].src, i), data: new Uint8Array(await r.arrayBuffer()) }); ok++; } catch (e) {} }
    if (!files.length) { toast('Blocked by CORS — use single downloads'); return; }
    download(zip(files), 'assets.zip'); toast(ok + ' image(s) zipped' + (ok < imgs.length ? ' (' + (imgs.length - ok) + ' blocked)' : ''));
  }

  /* ---------------- color pick ---------------- */
  // A simple, self-drawn crosshair picker — hover an element, see its color
  // live in the tooltip, click to copy it. No OS-level magnifier overlay.
  function pickColorOf(t) {
    var s = getComputedStyle(t);
    return toHex(s.backgroundColor) || toHex(s.color) || '#000000';
  }
  function startColorPick() {
    if (picking) stopPick();
    if (measuring) stopMeasure();
    colorPicking = true; toolActive('eye', true); document.body.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onColorMove, true); document.addEventListener('click', onColorPick, true); document.addEventListener('keydown', onColorKey, true);
    toast('Click any element to pick its color · Esc to cancel');
  }
  function stopColorPick() {
    colorPicking = false; toolActive('eye', false); document.body.style.cursor = '';
    overlay.style.display = 'none'; overlay.style.borderColor = ''; tipEl.style.display = 'none';
    document.removeEventListener('mousemove', onColorMove, true); document.removeEventListener('click', onColorPick, true); document.removeEventListener('keydown', onColorKey, true);
  }
  function onColorMove(e) {
    var t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || mine(t)) { overlay.style.display = 'none'; tipEl.style.display = 'none'; return; }
    var r = t.getBoundingClientRect(), hex = pickColorOf(t);
    overlay.style.display = 'block'; overlay.style.left = r.left + 'px'; overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px'; overlay.style.height = r.height + 'px'; overlay.style.borderColor = hex;
    tipEl.style.display = 'block'; tipEl.innerHTML = '<span class="wbi-tipsw" style="background:' + hex + '"></span>' + hex;
    tipEl.style.left = Math.min(r.left, window.innerWidth - 160) + 'px'; tipEl.style.top = Math.max(0, r.top - 24) + 'px';
  }
  function onColorPick(e) {
    var t = document.elementFromPoint(e.clientX, e.clientY); if (!t || mine(t)) return;
    e.preventDefault(); e.stopPropagation();
    var hex = pickColorOf(t);
    stopColorPick();
    copy(hex, hex + ' copied');
  }
  function onColorKey(e) { if (e.key === 'Escape') stopColorPick(); }

  /* ---------------- pick mode ---------------- */
  function startPick() {
    if (measuring) stopMeasure();
    if (colorPicking) stopColorPick();
    picking = true; btn.classList.add('on'); toolActive('pick', true); document.body.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onMove, true); document.addEventListener('click', onPick, true); document.addEventListener('keydown', onKey, true);
    toast('Click any element · Esc to cancel');
  }
  function stopPick() {
    picking = false; btn.classList.remove('on'); toolActive('pick', false); document.body.style.cursor = '';
    overlay.style.display = 'none'; tipEl.style.display = 'none';
    document.removeEventListener('mousemove', onMove, true); document.removeEventListener('click', onPick, true); document.removeEventListener('keydown', onKey, true);
  }
  function onMove(e) {
    var t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || mine(t)) { overlay.style.display = 'none'; tipEl.style.display = 'none'; return; }
    var r = t.getBoundingClientRect();
    overlay.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    tipEl.style.display = 'block'; tipEl.textContent = t.tagName.toLowerCase() + ' · ' + Math.round(r.width) + '×' + Math.round(r.height);
    tipEl.style.left = Math.min(r.left, window.innerWidth - 160) + 'px'; tipEl.style.top = Math.max(0, r.top - 24) + 'px';
  }
  function onPick(e) { var t = document.elementFromPoint(e.clientX, e.clientY); if (!t || mine(t)) return; e.preventDefault(); e.stopPropagation(); selected = detail(t); stopPick(); tab = 'inspect'; open(); render(); }
  function onKey(e) { if (e.key === 'Escape') stopPick(); }

  /* ---------------- measure mode ---------------- */
  function startMeasure() {
    if (measuring) { stopMeasure(); return; }
    if (picking) stopPick();
    if (colorPicking) stopColorPick();
    measuring = true; mPhase = 0; mAnc = null; toolActive('measure', true); document.body.style.cursor = 'crosshair';
    document.addEventListener('mousemove', mMove, true); document.addEventListener('click', mClick, true); document.addEventListener('keydown', mKey, true);
    toast('Click two elements to measure the gap');
  }
  function stopMeasure() {
    measuring = false; toolActive('measure', false); document.body.style.cursor = '';
    [mBoxA, mBoxB, mLabel, mSvg].forEach(function (n) { n.style.display = 'none'; });
    document.removeEventListener('mousemove', mMove, true); document.removeEventListener('click', mClick, true); document.removeEventListener('keydown', mKey, true);
  }
  function showBox(box, r) { box.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px'; }
  function gapH(a, b) { if (b.left >= a.right) return Math.round(b.left - a.right); if (a.left >= b.right) return Math.round(a.left - b.right); return 0; }
  function gapV(a, b) { if (b.top >= a.bottom) return Math.round(b.top - a.bottom); if (a.top >= b.bottom) return Math.round(a.top - b.bottom); return 0; }
  function drawMeasure(a, b) {
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + b.height / 2;
    mSvg.style.display = 'block'; mLine.setAttribute('x1', ax); mLine.setAttribute('y1', ay); mLine.setAttribute('x2', bx); mLine.setAttribute('y2', by);
    mLabel.style.display = 'block'; mLabel.textContent = '↔ ' + gapH(a, b) + 'px   ↕ ' + gapV(a, b) + 'px';
    mLabel.style.left = Math.min(Math.max((ax + bx) / 2 - 45, 4), window.innerWidth - 110) + 'px';
    mLabel.style.top = Math.max(2, (ay + by) / 2 - 12) + 'px';
  }
  function mMove(e) { var t = document.elementFromPoint(e.clientX, e.clientY); if (!t || mine(t)) return; var r = t.getBoundingClientRect(); if (mPhase === 0) showBox(mBoxB, r); else if (mPhase === 1) { showBox(mBoxB, r); drawMeasure(mAnc, r); } }
  function mClick(e) {
    var t = document.elementFromPoint(e.clientX, e.clientY); if (!t || mine(t)) return; e.preventDefault(); e.stopPropagation();
    var r = t.getBoundingClientRect();
    if (mPhase === 0) { mAnc = r; showBox(mBoxA, r); mPhase = 1; toast('Now click a second element'); }
    else if (mPhase === 1) { showBox(mBoxB, r); drawMeasure(mAnc, r); mPhase = 2; }
    else { [mBoxB, mLabel, mSvg].forEach(function (n) { n.style.display = 'none'; }); mAnc = r; showBox(mBoxA, r); mPhase = 1; toast('Click a second element'); }
  }
  function mKey(e) { if (e.key === 'Escape') stopMeasure(); }

  /* ---------------- rendering ---------------- */
  function render() {
    var body = panel.querySelector('#wbi-body');
    if (tab === 'palette') body.innerHTML = renderStyles();
    else if (tab === 'assets') body.innerHTML = renderAssets();
    else if (tab === 'inspect') body.innerHTML = renderInspect();
    else if (tab === 'export') body.innerHTML = renderExport();
    Array.prototype.forEach.call(panel.querySelectorAll('.wbi-tab'), function (t) { t.classList.toggle('on', t.dataset.tab === tab); });
    var cnt = root.querySelector('#wbi-count'); if (cnt) cnt.textContent = elementCount() + ' elements';
    wireBody();
  }

  function renderStyles() {
    var cs = collectColors(), fs = collectFonts();
    var grid = cs.length ? cs.map(function (c) { return '<button class="wbi-sw2" style="background:' + c.hex + '" data-copy="' + c.hex + '" title="' + c.hex + ' · used ' + c.count + '"></button>'; }).join('') : '<div class="wbi-dim">No colors found</div>';
    var cards = fs.length ? fs.map(function (f, fi) {
      var wts = f.weights.map(function (w) { return '<span class="wbi-wt">' + w + '</span>'; }).join('');
      var css = "font-family: '" + f.family + "', sans-serif;";
      return '<div class="wbi-fcard" data-family="' + f.family + '"><div class="wbi-fname">' + f.family + '</div><div class="wbi-fsub">' + (wts || '<span class="wbi-wt">400</span>') + '</div>'
        + '<div class="wbi-fline"><code data-fsnippet="' + fi + '" data-fmt="css">' + css + '</code>'
        + '<span class="wbi-fswitch"><button class="wbi-fmt on" data-ffmt="css" data-idx="' + fi + '">CSS</button><button class="wbi-fmt" data-ffmt="tw" data-idx="' + fi + '">Tailwind</button></span>'
        + '<button class="wbi-pill" data-fcopy="' + fi + '">Copy</button></div></div>';
    }).join('') : '<div class="wbi-dim">No fonts found</div>';
    window.__wbiFonts = fs;
    return '<div class="wbi-sec"><div class="wbi-sechead"><span>' + dot() + ' Colors</span><i>' + cs.length + '</i></div>'
      + '<div class="wbi-swgrid">' + grid + '</div>'
      + '<div class="wbi-btnrow"><button class="wbi-btn" id="wbi-eye">◉ Pick color</button><button class="wbi-btn" id="wbi-exp">↓ Export palette</button></div></div>'
      + '<div class="wbi-sec"><div class="wbi-sechead"><span>T Typography</span><i>' + fs.length + '</i></div>' + cards + '</div>';
  }
  function dot() { return '<span class="wbi-cdot"></span>'; }
  function renderInspect() {
    if (!selected) return '<div class="wbi-empty"><div class="wbi-emoji">' + IC.cursor + '</div><p>Click an element to see its colors, type, box model and CSS.</p><button class="wbi-btn primary" id="wbi-pick2">Pick an element</button></div>';
    var d = selected, ratio = (d.fg && d.bg) ? contrast(d.fg, d.bg) : null;
    var grade = ratio ? (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail') : '';
    var rows = '';
    ['font-family', 'font-size', 'font-weight', 'line-height', 'padding', 'margin', 'border-radius', 'box-shadow'].forEach(function (k) {
      var v = d.css[k]; if (v && v !== 'none' && v !== 'normal' && v !== '0px') rows += '<div class="wbi-row"><span>' + k + '</span><code data-copy="' + v.replace(/"/g, '&quot;') + '">' + v + '</code></div>';
    });
    return '<div class="wbi-sel">' + d.tag + '<span class="wbi-dim2">' + (d.id || '') + (d.cls || '') + '</span><span class="wbi-badge">' + d.rect.w + '×' + d.rect.h + '</span></div>'
      + '<div class="wbi-colors2">'
      + (d.fg ? '<div class="wbi-c"><label>Text</label><span class="wbi-sw" style="background:' + d.fg + '" data-copy="' + d.fg + '"></span><code data-copy="' + d.fg + '">' + d.fg + '</code></div>' : '')
      + (d.bg ? '<div class="wbi-c"><label>Background</label><span class="wbi-sw" style="background:' + d.bg + '" data-copy="' + d.bg + '"></span><code data-copy="' + d.bg + '">' + d.bg + '</code></div>' : '')
      + '</div>'
      + (ratio ? '<div class="wbi-contrast ' + (ratio >= 4.5 ? 'ok' : 'bad') + '">Contrast ' + ratio.toFixed(2) + ':1 · ' + grade + '</div>' : '')
      + '<div class="wbi-rows">' + rows + '</div>'
      + '<button class="wbi-btn primary" id="wbi-copycss">Copy full CSS</button><button class="wbi-btn" id="wbi-pick2">Pick another</button>';
  }
  function renderAssets() {
    var a = collectAssets(); window.__wbiAssets = a;
    var html = '<div class="wbi-hint">' + a.imgs.length + ' images · ' + a.svgs.length + ' SVGs</div>';
    if (a.imgs.length) html += '<button class="wbi-btn primary" id="wbi-zip">Download all images (ZIP)</button>';
    html += '<div class="wbi-assets">';
    a.imgs.forEach(function (im, i) { html += '<div class="wbi-asset"><img src="' + im.src + '" loading="lazy"><div class="wbi-ameta">' + (im.w ? im.w + '×' + im.h : (im.bg ? 'bg' : 'img')) + '<div class="wbi-arow"><button class="wbi-mini" data-dl="' + i + '">↓</button><button class="wbi-mini" data-copy="' + im.src + '">url</button></div></div></div>'; });
    html += '</div>';
    a.svgs.forEach(function (sv, i) { html += '<div class="wbi-svg"><div class="wbi-svgprev">' + sv.code + '</div><div class="wbi-arow"><button class="wbi-mini" data-svg="' + i + '">copy code</button><button class="wbi-mini" data-svgdl="' + i + '">↓ .svg</button></div></div>'; });
    return html;
  }
  function renderExport() {
    return '<div class="wbi-seg"><button class="wbi-segb on" data-fmt="css">CSS vars</button><button class="wbi-segb" data-fmt="json">JSON</button><button class="wbi-segb" data-fmt="tailwind">Tailwind</button></div>'
      + '<textarea id="wbi-out" readonly spellcheck="false">' + exportTokens('css') + '</textarea><button class="wbi-btn primary" id="wbi-copyout">Copy</button>';
  }

  function wireBody() {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-copy]'), function (n) { n.onclick = function () { copy(n.getAttribute('data-copy')); }; });
    var q = function (id) { return panel.querySelector(id); };
    if (q('#wbi-pick2')) q('#wbi-pick2').onclick = startPick;
    if (q('#wbi-copycss')) q('#wbi-copycss').onclick = function () { copy(cssText(selected), 'CSS copied'); };
    if (q('#wbi-copyout')) q('#wbi-copyout').onclick = function () { copy(q('#wbi-out').value, 'Tokens copied'); };
    if (q('#wbi-eye')) q('#wbi-eye').onclick = startColorPick;
    if (q('#wbi-exp')) q('#wbi-exp').onclick = function () { tab = 'export'; render(); };
    if (q('#wbi-zip')) q('#wbi-zip').onclick = function () { downloadAllImages(window.__wbiAssets.imgs); };
    Array.prototype.forEach.call(panel.querySelectorAll('.wbi-segb'), function (b) { b.onclick = function () { Array.prototype.forEach.call(panel.querySelectorAll('.wbi-segb'), function (x) { x.classList.remove('on'); }); b.classList.add('on'); q('#wbi-out').value = exportTokens(b.dataset.fmt); }; });
    function fontSnippet(fam, fmt) {
      return fmt === 'tw' ? "font-['" + fam.replace(/ /g, '_') + "']" : "font-family: '" + fam + "', sans-serif;";
    }
    Array.prototype.forEach.call(panel.querySelectorAll('.wbi-fmt'), function (b) {
      b.onclick = function () {
        var idx = +b.dataset.idx, fmt = b.dataset.ffmt, fam = window.__wbiFonts[idx].family;
        var card = b.closest('.wbi-fcard');
        Array.prototype.forEach.call(card.querySelectorAll('.wbi-fmt'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var code = card.querySelector('[data-fsnippet="' + idx + '"]');
        code.textContent = fontSnippet(fam, fmt); code.dataset.fmt = fmt;
      };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-fcopy]'), function (n) {
      n.onclick = function () {
        var idx = +n.dataset.fcopy, fam = window.__wbiFonts[idx].family;
        var code = panel.querySelector('[data-fsnippet="' + idx + '"]');
        copy(fontSnippet(fam, code.dataset.fmt), (code.dataset.fmt === 'tw' ? 'Tailwind' : 'CSS') + ' copied');
      };
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-dl]'), function (n) { n.onclick = function () { var im = window.__wbiAssets.imgs[+n.dataset.dl]; fetch(im.src).then(function (r) { return r.blob(); }).then(function (b) { download(b, nameFromUrl(im.src, 0)); }).catch(function () { window.open(im.src, '_blank'); }); }; });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-svg]'), function (n) { n.onclick = function () { copy(window.__wbiAssets.svgs[+n.dataset.svg].code, 'SVG copied'); }; });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-svgdl]'), function (n) { n.onclick = function () { download(new Blob([window.__wbiAssets.svgs[+n.dataset.svgdl].code], { type: 'image/svg+xml' }), 'icon.svg'); }; });
  }

  /* ---------------- shell ---------------- */
  function open() { panel.classList.add('open'); render(); }
  function close() { panel.classList.remove('open'); if (picking) stopPick(); if (measuring) stopMeasure(); }
  function toggle() { panel.classList.contains('open') ? close() : open(); }

  function toolBtn(id, label, onClick) { var b = el('button', { class: 'wbi-ic', id: 'wbi-tool-' + id, title: label }, IC[id === 'pick' ? 'cursor' : id === 'measure' ? 'ruler' : id === 'eye' ? 'eye' : 'refresh']); b.onclick = onClick; return b; }

  function build() {
    root = el('div', { id: 'wbi-root' });
    root.appendChild(el('style', null, STYLES.replace(/__ACCENT__/g, CFG.accent)));
    overlay = el('div', { id: 'wbi-overlay' }); root.appendChild(overlay);
    tipEl = el('div', { id: 'wbi-tip' }); root.appendChild(tipEl);
    // measure elements
    mBoxA = el('div', { id: 'wbi-mA', class: 'wbi-mbox' }); mBoxB = el('div', { id: 'wbi-mB', class: 'wbi-mbox b' }); mLabel = el('div', { id: 'wbi-mlabel' });
    mSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); mSvg.setAttribute('id', 'wbi-msvg');
    mLine = document.createElementNS('http://www.w3.org/2000/svg', 'line'); mLine.setAttribute('id', 'wbi-mline'); mSvg.appendChild(mLine);
    [mBoxA, mBoxB, mLabel, mSvg].forEach(function (n) { root.appendChild(n); });

    btn = el('button', { id: 'wbi-btn', title: 'Inspect' }, '<span class="wbi-dot"></span>' + CFG.name);
    btn.onclick = function () { if (!panel.classList.contains('open')) open(); startPick(); };
    root.appendChild(btn);

    panel = el('div', { id: 'wbi-panel' });
    // head
    var head = el('div', { id: 'wbi-head' }, '<b>' + CFG.name + '</b>');
    var acts = el('div', { class: 'wbi-htools' });
    acts.appendChild(toolBtn('refresh', 'Rescan page', function () { render(); toast('Rescanned'); }));
    var closeB = el('button', { class: 'wbi-ic', title: 'Close' }, IC.close); closeB.onclick = close; acts.appendChild(closeB);
    head.appendChild(acts); panel.appendChild(head);
    // toolbar
    var tb = el('div', { id: 'wbi-toolbar' });
    tb.appendChild(toolBtn('pick', 'Inspect element', startPick));
    tb.appendChild(toolBtn('eye', 'Pick a color', startColorPick));
    tb.appendChild(toolBtn('measure', 'Measure spacing', startMeasure));
    panel.appendChild(tb);
    // tabs
    var tabs = el('div', { id: 'wbi-tabs' });
    [['palette', 'Palette'], ['assets', 'Assets'], ['inspect', 'Picker'], ['export', 'Tokens']].forEach(function (t) {
      var b = el('button', { class: 'wbi-tab', 'data-tab': t[0] }, t[1]); b.onclick = function () { tab = t[0]; render(); }; tabs.appendChild(b);
    });
    panel.appendChild(tabs);
    panel.appendChild(el('div', { id: 'wbi-body' }));
    panel.appendChild(el('div', { id: 'wbi-foot' }, '<span id="wbi-count">—</span><span class="wbi-kbd">Local only</span>'));
    root.appendChild(panel);
    (document.body || document.documentElement).appendChild(root);

    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); if (!panel.classList.contains('open')) open(); startPick(); } }, true);
  }

  var STYLES = "\\
#wbi-root{all:initial}\\
#wbi-root *{box-sizing:border-box;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}\\
#wbi-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:11px 16px;border:0;border-radius:30px;background:__ACCENT__;color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.24)}\\
#wbi-btn.on{background:#e5484d}#wbi-btn .wbi-dot{width:9px;height:9px;border-radius:50%;background:#fff;opacity:.9}\\
#wbi-overlay{position:fixed;z-index:2147482000;pointer-events:none;background:rgba(111,203,243,.16);border:2px solid __ACCENT__;border-radius:3px;display:none;transition:all .04s linear}\\
#wbi-tip{position:fixed;z-index:2147482500;pointer-events:none;background:#111;color:#fff;font:600 11px/1 sans-serif;padding:5px 8px;border-radius:6px;display:none;white-space:nowrap}\\
.wbi-tipsw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid rgba(255,255,255,.35)}\\
.wbi-mbox{position:fixed;z-index:2147482000;pointer-events:none;display:none;border:2px solid __ACCENT__;background:rgba(111,203,243,.12);border-radius:2px}\\
.wbi-mbox.b{border-color:#0ea5e9;background:rgba(14,165,233,.10)}\\
#wbi-msvg{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147482300;pointer-events:none;display:none}\\
#wbi-mline{stroke:__ACCENT__;stroke-width:2;stroke-dasharray:5 4}\\
#wbi-mlabel{position:fixed;z-index:2147482600;pointer-events:none;display:none;background:#111;color:#fff;font:700 12px/1 sans-serif;padding:6px 9px;border-radius:7px;white-space:nowrap}\\
#wbi-panel{position:fixed;top:0;right:0;height:100%;width:360px;max-width:90vw;z-index:2147483000;background:#ffffff;color:#14161c;transform:translateX(105%);transition:transform .22s cubic-bezier(.2,.8,.2,1);box-shadow:-10px 0 44px rgba(20,22,29,.14);display:flex;flex-direction:column;border-left:1px solid #ececf1}\\
#wbi-panel.open{transform:translateX(0)}\\
#wbi-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #f0f0f4}\\
#wbi-head b{font-size:15px}.wbi-htools{display:flex;gap:6px}\\
.wbi-ic{width:32px;height:32px;border-radius:9px;border:1px solid #ececf1;background:#fafafb;color:#5b6172;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}\\
.wbi-ic svg{width:17px;height:17px}.wbi-ic:hover{background:#f2f2f5;color:#14161c}\\
.wbi-ic.on{background:__ACCENT__;border-color:__ACCENT__;color:#fff}\\
#wbi-toolbar{display:flex;gap:8px;padding:10px 16px;border-bottom:1px solid #f0f0f4}\\
#wbi-tabs{display:flex;gap:2px;padding:8px 12px;border-bottom:1px solid #f0f0f4}\\
.wbi-tab{flex:1;background:transparent;border:0;color:#8a90a0;font-size:13px;font-weight:600;padding:8px 6px;border-radius:9px;cursor:pointer}\\
.wbi-tab.on{background:#fdeef6;color:__ACCENT__}\\
#wbi-body{flex:1;overflow-y:auto;padding:16px}\\
#wbi-foot{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid #f0f0f4;font-size:11.5px;color:#9aa0ae}\\
.wbi-kbd{background:#f4f4f7;border:1px solid #ececf1;border-radius:6px;padding:3px 7px;font-size:10.5px;color:#7b8192}\\
.wbi-sec{margin-bottom:20px}\\
.wbi-sechead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}\\
.wbi-sechead span{font:700 11px/1 sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#5b6172;display:flex;align-items:center;gap:7px}\\
.wbi-sechead i{font-style:normal;font-size:11px;color:#adb2be;background:#f4f4f7;border-radius:20px;padding:2px 9px}\\
.wbi-cdot{width:13px;height:13px;border-radius:4px;background:linear-gradient(135deg,__ACCENT__,#f59e0b);display:inline-block}\\
.wbi-swgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}\\
.wbi-sw2{aspect-ratio:1;border-radius:11px;border:1px solid rgba(0,0,0,.08);cursor:pointer;padding:0}\\
.wbi-sw2:hover{transform:scale(1.06);transition:.1s}\\
.wbi-btnrow{display:flex;gap:8px;margin-top:12px}\\
.wbi-btn{flex:1;padding:11px;border:1px solid #e7e8ee;border-radius:11px;background:#fafafb;color:#14161c;font-weight:600;font-size:13px;cursor:pointer}\\
.wbi-btn:hover{background:#f2f2f5}.wbi-btn.primary{background:__ACCENT__;border-color:__ACCENT__;color:#fff}.wbi-btn.primary:hover{filter:brightness(1.05)}\\
.wbi-btn+.wbi-btn{margin-top:8px}.wbi-btnrow .wbi-btn+.wbi-btn{margin-top:0}\\
.wbi-fcard{background:#fbfbfc;border:1px solid #eeeef2;border-radius:14px;padding:14px;margin-bottom:10px}\\
.wbi-fname{font-size:16px;font-weight:700;color:#14161c;margin-bottom:8px}\\
.wbi-fsub{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}\\
.wbi-wt{font:600 11px/1 sans-serif;color:#6b7280;background:#f1f1f5;border-radius:6px;padding:4px 8px}\\
.wbi-fline{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #eeeef2;border-radius:9px;padding:8px 10px;margin-top:7px;flex-wrap:wrap}\\
.wbi-fline code{flex:1;min-width:120px;font:12px/1.3 ui-monospace,Menlo,monospace;color:#4b5563;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\\
.wbi-fswitch{display:flex;gap:2px;background:#f1f1f5;border-radius:7px;padding:2px}\\
.wbi-fmt{background:transparent;border:0;color:#8a90a0;font:700 10px/1 sans-serif;padding:5px 8px;border-radius:5px;cursor:pointer}\\
.wbi-fmt.on{background:#fff;color:__ACCENT__;box-shadow:0 1px 2px rgba(0,0,0,.08)}\\
.wbi-pill{background:#14161c;color:#fff;border:0;border-radius:6px;font:700 10px/1 sans-serif;padding:6px 9px;cursor:pointer}.wbi-pill:hover{background:__ACCENT__}\\
.wbi-empty{text-align:center;color:#8a90a0;padding:28px 10px}.wbi-emoji{color:__ACCENT__;margin:0 auto 10px;width:38px}.wbi-emoji svg{width:38px;height:38px}\\
.wbi-sel{font-size:16px;font-weight:700;color:#14161c;margin-bottom:12px}\\
.wbi-dim{color:#9aa0ae;font-size:13px}.wbi-dim2{color:#9aa0ae;font-weight:500;font-size:13px;margin-left:5px}\\
.wbi-badge{float:right;background:#f4f4f7;color:#6b7280;font-size:11px;padding:3px 9px;border-radius:20px}\\
.wbi-colors2{display:flex;gap:10px;margin-bottom:10px}.wbi-c{flex:1;background:#fbfbfc;border:1px solid #eeeef2;border-radius:12px;padding:11px}\\
.wbi-c label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0ae;margin-bottom:7px}\\
.wbi-sw{display:inline-block;width:20px;height:20px;border-radius:6px;vertical-align:middle;border:1px solid rgba(0,0,0,.1);margin-right:8px;cursor:pointer}\\
.wbi-c code{font-size:12.5px;color:#374151;vertical-align:middle;cursor:pointer}\\
.wbi-contrast{font-size:12.5px;font-weight:600;padding:9px 11px;border-radius:9px;margin-bottom:12px}\\
.wbi-contrast.ok{background:#e9f7ee;color:#218a43}.wbi-contrast.bad{background:#fdecec;color:#c0392b}\\
.wbi-rows{margin:4px 0 8px}.wbi-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #f2f2f5;font-size:12.5px}\\
.wbi-row span{color:#8a90a0}.wbi-row code{color:#374151;cursor:pointer;text-align:right;word-break:break-all}\\
.wbi-hint{font-size:12px;color:#8a90a0;margin-bottom:10px}\\
.wbi-assets{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}\\
.wbi-asset{background:#fbfbfc;border:1px solid #eeeef2;border-radius:12px;overflow:hidden}\\
.wbi-asset img{width:100%;height:80px;object-fit:contain;background:#f4f4f7;display:block}\\
.wbi-ameta{padding:6px 8px;font-size:11px;color:#8a90a0}.wbi-arow{display:flex;gap:6px;margin-top:6px}\\
.wbi-mini{flex:1;background:#f2f2f5;border:1px solid #e7e8ee;color:#4b5563;font-size:11px;padding:5px;border-radius:7px;cursor:pointer}.wbi-mini:hover{background:#e8e8ee}\\
.wbi-svg{background:#fbfbfc;border:1px solid #eeeef2;border-radius:12px;padding:10px;margin-top:8px}\\
.wbi-svgprev{background:#fff;border:1px solid #f0f0f4;border-radius:9px;padding:12px;text-align:center;min-height:56px}.wbi-svgprev svg{max-width:60px;max-height:44px}\\
.wbi-seg{display:flex;gap:4px;background:#f4f4f7;border-radius:11px;padding:4px;margin-bottom:10px}\\
.wbi-segb{flex:1;background:transparent;border:0;color:#8a90a0;font-size:12px;font-weight:600;padding:8px;border-radius:8px;cursor:pointer}.wbi-segb.on{background:#fff;color:__ACCENT__;box-shadow:0 1px 3px rgba(0,0,0,.08)}\\
#wbi-out{width:100%;height:180px;background:#fafafb;border:1px solid #eeeef2;border-radius:11px;color:#374151;font:12px/1.5 ui-monospace,Menlo,monospace;padding:11px;resize:none}\\
#wbi-toast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%) translateY(10px);z-index:2147483600;background:#14161c;color:#fff;font-size:12.5px;font-weight:600;padding:10px 17px;border-radius:22px;opacity:0;transition:.2s;pointer-events:none;max-width:80vw;text-align:center}\\
#wbi-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}\\
";

  window.WebInspect = {
    init: function (opts) { if (opts) for (var k in opts) CFG[k] = opts[k]; if (!root) build(); return this; },
    open: function () { if (!root) build(); open(); }, close: close, toggle: function () { if (!root) build(); toggle(); },
    pick: function () { if (!root) build(); open(); startPick(); }
  };
})();
`
