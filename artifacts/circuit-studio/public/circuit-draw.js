/*!
 * CircuitDraw 1.0.0
 * Turns a small JSON description of a circuit into a clean, standalone SVG.
 * No dependencies. Works in the browser (window.CircuitDraw) and in Node (require).
 *
 *   const svg = CircuitDraw.render(spec);            // returns an SVG string (throws if spec is invalid)
 *   const report = CircuitDraw.validate(spec);       // { errors: [...], warnings: [...] }
 *   const sheet = CircuitDraw.buildSheet(spec);      // Markdown parts list + nets, for rebuilding in EasyEDA
 *   const nl = CircuitDraw.netlist(spec);            // { parts: [...], nets: [{ name, pins }] }
 *
 * See AI_INSTRUCTIONS.md for the spec format.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CircuitDraw = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  var DEFAULT_THEME = {
    stroke: '#222222',      // wires and symbols
    text: '#222222',        // component names
    muted: '#555555',       // component values
    background: '#ffffff',  // set to null for a transparent background
    font: 'Arial, Helvetica, sans-serif',
    lineWidth: 1.5,
    dotRadius: 3,
    padding: 40             // used only when width/height are not given
  };

  var T = DEFAULT_THEME; // active theme while rendering

  /* ---------- small helpers ---------- */

  function f(v) { return Math.round(v * 100) / 100; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function key(x, y) { return f(x) + ',' + f(y); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isPt(p) { return Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]); }
  function ln(x1, y1, x2, y2, extra) {
    return '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"' + (extra || '') + '/>';
  }
  var ARROW = ' marker-end="url(#cd-arrow)"';

  var TEXTBOX = null; // collects estimated text extents so auto-sizing can include labels
  function textEl(x, y, s, anchor, size, bold, tone) {
    var fill = tone === 'muted' ? T.muted : T.text;
    if (TEXTBOX) {
      var w = String(s).length * (size || 12) * (bold ? 0.62 : 0.56), x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      TEXTBOX.push([x0, y - (size || 12), x0 + w, y + 4]);
    }
    return '<text x="' + f(x) + '" y="' + f(y) + '" text-anchor="' + (anchor || 'start') + '" font-size="' + (size || 12) + '"' +
      (bold ? ' font-weight="bold"' : '') + ' fill="' + fill + '">' + esc(s) + '</text>';
  }

  /* ---------- two-terminal symbols ----------
     Each symbol is drawn along +x in local space, between (0,0) and (L,0).
     c = L/2 is the centre. hl / hr = how far the body extends left / right of c.
     hp = half-width of the body, used to keep labels clear of it. */

  function diodeBody(c) {
    return '<polygon points="' + f(c - 10) + ',-10 ' + f(c - 10) + ',10 ' + f(c + 10) + ',0"/>' + ln(c + 10, -10, c + 10, 10);
  }

  var TWO = {
    resistor: { hl: 25, hr: 25, hp: 10, draw: function (c, el) {
      if (el.style === 'zigzag') {
        return { s: '<path d="M' + f(c - 25) + ' 0 L' + f(c - 19) + ' -10 L' + f(c - 9) + ' 10 L' + f(c + 1) + ' -10 L' +
          f(c + 11) + ' 10 L' + f(c + 19) + ' -10 L' + f(c + 25) + ' 0"/>' };
      }
      return { s: '<rect x="' + f(c - 25) + '" y="-10" width="50" height="20"/>' };
    } },
    capacitor: { hl: 6, hr: 6, hp: 14, draw: function (c) {
      return { s: ln(c - 6, -14, c - 6, 14) + ln(c + 6, -14, c + 6, 14) };
    } },
    electrolytic: { hl: 6, hr: 6, hp: 14, draw: function (c) {
      return { s: ln(c - 6, -14, c - 6, 14) + '<path d="M' + f(c + 9) + ' -14 Q' + f(c + 1) + ' 0 ' + f(c + 9) + ' 14"/>',
        t: [{ x: c - 16, y: -9, s: '+', anchor: 'middle', size: 13 }] };
    } },
    inductor: { hl: 32, hr: 32, hp: 8, draw: function (c) {
      var d = 'M' + f(c - 32) + ' 0';
      for (var i = 0; i < 4; i++) d += ' a8 8 0 0 1 16 0';
      return { s: '<path d="' + d + '"/>' };
    } },
    diode: { hl: 10, hr: 10, hp: 10, draw: function (c) { return { s: diodeBody(c) }; } },
    zener: { hl: 10, hr: 10, hp: 10, draw: function (c) {
      return { s: '<polygon points="' + f(c - 10) + ',-10 ' + f(c - 10) + ',10 ' + f(c + 10) + ',0"/>' +
        '<path d="M' + f(c + 14) + ' -14 L' + f(c + 10) + ' -10 L' + f(c + 10) + ' 10 L' + f(c + 6) + ' 14"/>' };
    } },
    led: { hl: 10, hr: 10, hp: 24, draw: function (c) {
      return { s: diodeBody(c) + ln(c - 4, -14, c + 6, -24, ARROW) + ln(c + 5, -9, c + 15, -19, ARROW) };
    } },
    battery: { hl: 5, hr: 5, hp: 14, draw: function (c) {
      return { s: ln(c - 5, -14, c - 5, 14) + ln(c + 5, -7, c + 5, 7, ' stroke-width="3"'),
        t: [{ x: c - 15, y: -10, s: '+', anchor: 'middle', size: 13 }] };
    } },
    switch: { hl: 18, hr: 18, hp: 16, draw: function (c, el) {
      var blade = el.closed ? ln(c - 18, 0, c + 18, 0) : ln(c - 18, 0, c + 14, -16);
      return { s: '<circle cx="' + f(c - 18) + '" cy="0" r="2.5"/><circle cx="' + f(c + 18) + '" cy="0" r="2.5"/>' + blade };
    } },
    mic: { hl: 18, hr: 18, hp: 18, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="18"/>', t: [{ x: c, y: 4, s: 'MIC', anchor: 'middle', size: 11 }] };
    } },
    speaker: { hl: 8, hr: 16, hp: 18, draw: function (c) {
      return { s: '<rect x="' + f(c - 8) + '" y="-9" width="10" height="18"/><polygon points="' +
        f(c + 2) + ',-9 ' + f(c + 16) + ',-18 ' + f(c + 16) + ',18 ' + f(c + 2) + ',9"/>' };
    } },
    lamp: { hl: 14, hr: 14, hp: 14, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="14"/>' + ln(c - 10, -10, c + 10, 10) + ln(c - 10, 10, c + 10, -10) };
    } },
    acsource: { hl: 16, hr: 16, hp: 16, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="16"/><path d="M' + f(c - 9) + ' 0 q4.5 -9 9 0 t9 0"/>' };
    } },
    crystal: { hl: 9, hr: 9, hp: 14, draw: function (c) {
      return { s: '<rect x="' + f(c - 5) + '" y="-9" width="10" height="18"/>' + ln(c - 9, -13, c - 9, 13) + ln(c + 9, -13, c + 9, 13) };
    } }
  };

  var MULTI = { npn: 1, pnp: 1, opamp: 1 };
  var SINGLE = { ground: 1, antenna: 1, terminal: 1 };
  var OTHER = { wire: 1, junction: 1, label: 1, box: 1 };

  function knownType(t) { return !!(TWO[t] || MULTI[t] || SINGLE[t] || OTHER[t]); }

  /* ---------- pins ---------- */

  function pinsOf(el) {
    var t = el.type, x, y;
    if (TWO[t]) return [{ n: 'from', p: el.from }, { n: 'to', p: el.to }];
    if (t === 'npn' || t === 'pnp') {
      x = el.at[0]; y = el.at[1];
      var fl = el.flip ? -1 : 1, bx = x - 25 * fl, ex = x + 25 * fl;
      return t === 'npn'
        ? [{ n: 'B', p: [bx, y] }, { n: 'C', p: [ex, y - 44] }, { n: 'E', p: [ex, y + 44] }]
        : [{ n: 'B', p: [bx, y] }, { n: 'E', p: [ex, y - 44] }, { n: 'C', p: [ex, y + 44] }];
    }
    if (t === 'opamp') {
      x = el.at[0]; y = el.at[1];
      return [{ n: 'INV', p: [x - 40, el.swap ? y + 20 : y - 20] }, { n: 'NONINV', p: [x - 40, el.swap ? y - 20 : y + 20] }, { n: 'OUT', p: [x + 40, y] }];
    }
    if (SINGLE[t]) return [{ n: 'at', p: el.at }];
    return [];
  }

  /* ---------- analysis: validation, junctions, bounds ---------- */

  function onSegInterior(px, py, a, b) {
    var cr = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (Math.abs(cr) > 0.01) return false;
    var dot = (px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1]);
    var len2 = (b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]);
    return dot > 0.01 && dot < len2 - 0.01;
  }

  function analyse(spec) {
    var res = { errors: [], warnings: [], junctions: [], bbox: null };
    var ends = {}, segs = [];
    var bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

    function track(x, y) {
      if (x < bb.x0) bb.x0 = x; if (x > bb.x1) bb.x1 = x;
      if (y < bb.y0) bb.y0 = y; if (y > bb.y1) bb.y1 = y;
    }
    function addEnd(p, owner) {
      var k = key(p[0], p[1]);
      if (!ends[k]) ends[k] = { x: p[0], y: p[1], n: 0, owners: [] };
      ends[k].n += 1; ends[k].owners.push(owner);
      track(p[0], p[1]);
    }

    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.elements)) {
      res.errors.push('The spec must be an object with an "elements" array.');
      return res;
    }

    spec.elements.forEach(function (el, i) {
      var id = (el && (el.id || el.label)) ? (el.type + ' "' + (el.id || el.label) + '"') : ((el && el.type) + ' #' + (i + 1));
      if (!el || typeof el !== 'object' || typeof el.type !== 'string') { res.errors.push('Element #' + (i + 1) + ' has no "type".'); return; }
      if (!knownType(el.type)) { res.errors.push(id + ': unknown type "' + el.type + '".'); return; }
      var t = el.type;

      if (t === 'wire') {
        if (!Array.isArray(el.points) || el.points.length < 2) { res.errors.push(id + ': "points" needs at least 2 [x,y] points.'); return; }
        for (var j = 0; j < el.points.length; j++) {
          if (!isPt(el.points[j])) { res.errors.push(id + ': point ' + (j + 1) + ' is not a [x,y] pair of numbers.'); return; }
        }
        for (var s = 0; s < el.points.length - 1; s++) {
          var a = el.points[s], b = el.points[s + 1];
          if (a[0] === b[0] && a[1] === b[1]) { res.warnings.push(id + ': has a zero-length segment at (' + a[0] + ',' + a[1] + ').'); continue; }
          if (a[0] !== b[0] && a[1] !== b[1]) res.warnings.push(id + ': segment (' + a[0] + ',' + a[1] + ')->(' + b[0] + ',' + b[1] + ') is diagonal; use horizontal and vertical wires.');
          segs.push([a, b]);
          addEnd(a, id); addEnd(b, id);
          if (el.open) { ends[key(a[0], a[1])].open = true; ends[key(b[0], b[1])].open = true; }
        }
        return;
      }

      if (t === 'junction') {
        if (!isNum(el.x) || !isNum(el.y)) { res.errors.push(id + ': needs numeric "x" and "y".'); return; }
        res.junctions.push([el.x, el.y]); track(el.x, el.y);
        return;
      }
      if (t === 'label') {
        if (!isPt(el.at) || typeof el.text !== 'string') { res.errors.push(id + ': needs "at":[x,y] and "text".'); return; }
        track(el.at[0], el.at[1]);
        return;
      }
      if (t === 'box') {
        if (!isNum(el.x) || !isNum(el.y) || !isNum(el.w) || !isNum(el.h)) { res.errors.push(id + ': needs numeric x, y, w, h.'); return; }
        track(el.x, el.y); track(el.x + el.w, el.y + el.h);
        return;
      }

      if (TWO[t]) {
        if (!isPt(el.from) || !isPt(el.to)) { res.errors.push(id + ': needs "from":[x,y] and "to":[x,y].'); return; }
        var L = Math.sqrt(Math.pow(el.to[0] - el.from[0], 2) + Math.pow(el.to[1] - el.from[1], 2));
        var need = TWO[t].hl + TWO[t].hr;
        if (L < need) { res.errors.push(id + ': "from" and "to" are only ' + f(L) + ' px apart; ' + t + ' needs at least ' + need + ' px.'); return; }
        if (L < need + 10) res.warnings.push(id + ': terminals are very close (' + f(L) + ' px); the symbol will have almost no lead wire.');
      } else if (!isPt(el.at)) {
        res.errors.push(id + ': needs "at":[x,y].'); return;
      }

      pinsOf(el).forEach(function (pin) { addEnd(pin.p, id + '.' + pin.n); });
      if (t === 'npn' || t === 'pnp') { track(el.at[0] - 44, el.at[1] - 44); track(el.at[0] + 44, el.at[1] + 80); }
      if (t === 'opamp') { track(el.at[0] - 40, el.at[1] - 70); track(el.at[0] + 40, el.at[1] + 40); }
      if (t === 'antenna') track(el.at[0], el.at[1] - (el.height || 55) - 40);
      if (t === 'ground') track(el.at[0], el.at[1] + 50);
    });

    spec.elements.forEach(function (el, i) {
      if (!el || !TWO[el.type] || !isPt(el.from) || !isPt(el.to)) return;
      var a0 = el.from, b0 = el.to, L2 = Math.pow(b0[0] - a0[0], 2) + Math.pow(b0[1] - a0[1], 2);
      var nm = el.type + ' "' + (el.label || el.id || '#' + (i + 1)) + '"';
      segs.forEach(function (sg) {
        var c1 = (b0[0] - a0[0]) * (sg[0][1] - a0[1]) - (b0[1] - a0[1]) * (sg[0][0] - a0[0]);
        var c2 = (b0[0] - a0[0]) * (sg[1][1] - a0[1]) - (b0[1] - a0[1]) * (sg[1][0] - a0[0]);
        if (Math.abs(c1) > 0.01 || Math.abs(c2) > 0.01) return;
        var t1 = ((sg[0][0] - a0[0]) * (b0[0] - a0[0]) + (sg[0][1] - a0[1]) * (b0[1] - a0[1])) / L2;
        var t2 = ((sg[1][0] - a0[0]) * (b0[0] - a0[0]) + (sg[1][1] - a0[1]) * (b0[1] - a0[1])) / L2;
        var lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
        if (hi - lo > 0.01) res.warnings.push('A wire runs over ' + nm + ' and would short it out. Wires must stop at its from/to points, not pass through.');
      });
    });

    // degree of every point = segment ends touching it + 2 for every wire passing straight through it
    Object.keys(ends).forEach(function (k) {
      var e = ends[k], deg = e.n;
      segs.forEach(function (sg) { if (onSegInterior(e.x, e.y, sg[0], sg[1])) deg += 2; });
      if (deg >= 3 && spec.autoJunctions !== false) res.junctions.push([e.x, e.y]);
      if (deg === 1 && !e.open) res.warnings.push(e.owners[0] + ' at (' + f(e.x) + ',' + f(e.y) + ') is not connected to anything.');
    });

    if (isFinite(bb.x0)) res.bbox = bb;
    return res;
  }

  function validate(spec) {
    var a = analyse(spec);
    return { errors: a.errors, warnings: a.warnings };
  }

  /* ---------- labels ---------- */

  function linesOf(el) {
    var l = [];
    if (el.label) l.push({ s: el.label, bold: true });
    if (el.value) l.push({ s: el.value, bold: false });
    return l;
  }

  // Place label lines around the point (px,py). pos: above | below | left | right
  function placeLabel(lines, px, py, pos, d, nudge) {
    var n = lines.length, out = '';
    nudge = nudge || [0, 0];
    for (var i = 0; i < n; i++) {
      var L = lines[i], x = px, y = py, a = 'middle';
      if (pos === 'above') { y = py - d - (n - 1 - i) * 16; }
      else if (pos === 'below') { y = py + d + 12 + i * 16; }
      else {
        y = py + (i - (n - 1) / 2) * 16 + 4;
        if (pos === 'left') { x = px - d; a = 'end'; } else { x = px + d; a = 'start'; }
      }
      out += textEl(x + nudge[0], y + nudge[1], L.s, a, L.bold ? 14 : 12, L.bold, L.bold ? 'text' : 'muted');
    }
    return out;
  }

  function placeAt(lines, el) {
    var out = '', anchor = el.labelAnchor || 'start';
    for (var i = 0; i < lines.length; i++) {
      out += textEl(el.labelAt[0], el.labelAt[1] + i * 16, lines[i].s, anchor, lines[i].bold ? 14 : 12, lines[i].bold, lines[i].bold ? 'text' : 'muted');
    }
    return out;
  }

  /* ---------- drawing ---------- */

  function drawTwo(el, parts) {
    var def = TWO[el.type], a = el.from, b = el.to;
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var L = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx), deg = ang * 180 / Math.PI, c = L / 2;
    var body = def.draw(c, el);

    parts.comp += '<g transform="translate(' + f(a[0]) + ' ' + f(a[1]) + ') rotate(' + f(deg) + ')">' +
      ln(0, 0, c - def.hl, 0) + ln(c + def.hr, 0, L, 0) + body.s + '</g>';

    (body.t || []).forEach(function (tx) {   // inner text, kept upright
      var gx = a[0] + tx.x * Math.cos(ang) - tx.y * Math.sin(ang);
      var gy = a[1] + tx.x * Math.sin(ang) + tx.y * Math.cos(ang);
      parts.text += textEl(gx, gy, tx.s, tx.anchor, tx.size, false, 'text');
    });

    var lines = linesOf(el);
    if (!lines.length) return;
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    var pos = el.labelPos || (Math.abs(dx) >= Math.abs(dy) ? 'above' : 'right');
    parts.text += placeLabel(lines, mx, my, pos, def.hp + 8, el.labelNudge);
  }

  function drawTransistor(el, parts) {
    var x = el.at[0], y = el.at[1], npn = el.type === 'npn', s = '';
    if (el.circle !== false) s += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="44" stroke-width="0.5"/>';
    s += ln(x - 25, y - 30, x - 25, y + 30, ' stroke-width="3"');
    if (npn) {
      s += ln(x - 25, y - 14, x + 25, y - 44) + ln(x - 25, y + 14, x + 23, y + 43, ARROW);
    } else {
      s += ln(x - 25, y + 14, x + 25, y + 44) + ln(x + 25, y - 44, x - 24, y - 14.6, ARROW);
    }
    if (el.flip) s = '<g transform="translate(' + f(2 * x) + ' 0) scale(-1 1)">' + s + '</g>';
    parts.comp += s;
    var lines = linesOf(el);
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    var lx = x + 10 * (el.flip ? -1 : 1), ly = y + 62;
    for (var i = 0; i < lines.length; i++) {
      parts.text += textEl(lx + (el.labelNudge ? el.labelNudge[0] : 0), ly + i * 16 + (el.labelNudge ? el.labelNudge[1] : 0),
        lines[i].s, el.flip ? 'start' : 'end', lines[i].bold ? 14 : 12, lines[i].bold, lines[i].bold ? 'text' : 'muted');
    }
  }

  function drawOpamp(el, parts) {
    var x = el.at[0], y = el.at[1], top = el.swap ? '+' : '\u2212', bot = el.swap ? '\u2212' : '+';
    parts.comp += '<polygon points="' + f(x - 40) + ',' + f(y - 40) + ' ' + f(x - 40) + ',' + f(y + 40) + ' ' + f(x + 40) + ',' + f(y) + '"/>';
    parts.text += textEl(x - 33, y - 16, top, 'start', 14, false, 'text') + textEl(x - 33, y + 24, bot, 'start', 14, false, 'text');
    var lines = linesOf(el);
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x - 5, y - 40, el.labelPos || 'above', 6, el.labelNudge);
  }

  var WIRESEGS = [];
  function wireDirAt(x, y) {
    for (var i = 0; i < WIRESEGS.length; i++) {
      var a = WIRESEGS[i][0], b = WIRESEGS[i][1], o = null;
      if (a[0] === x && a[1] === y) o = b; else if (b[0] === x && b[1] === y) o = a;
      if (o) {
        if (o[1] === y) return o[0] > x ? 'right' : 'left';
        if (o[0] === x) return o[1] > y ? 'down' : 'up';
      }
    }
    return null;
  }

  function drawSingle(el, parts) {
    var x = el.at[0], y = el.at[1], lines = linesOf(el), pos, px = x, py = y, d = 8;
    if (el.type === 'ground') {
      parts.comp += ln(x, y, x, y + 10) + ln(x - 12, y + 10, x + 12, y + 10) + ln(x - 8, y + 15, x + 8, y + 15) + ln(x - 4, y + 20, x + 4, y + 20);
      pos = 'below'; py = y + 20; d = 4;
    } else if (el.type === 'antenna') {
      var h = el.height || 55;
      parts.comp += ln(x, y, x, y - h) + ln(x, y - h + 16, x - 12, y - h) + ln(x, y - h + 16, x + 12, y - h);
      pos = 'above'; py = y - h; d = 8;
    } else { // terminal: put the label on the side away from the wire
      parts.comp += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="4"/>';
      pos = 'right'; d = 10;
      var wl = wireDirAt(x, y);
      if (wl === 'right') pos = 'left'; else if (wl === 'left') pos = 'right';
      else if (wl === 'down') { pos = 'above'; d = 10; } else if (wl === 'up') { pos = 'below'; d = 4; }
    }
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, px, py, el.labelPos || pos, d, el.labelNudge);
  }

  /* ---------- main entry ---------- */

  function render(spec, opts) {
    var a = analyse(spec);
    if (a.errors.length) throw new Error('Invalid circuit spec:\n- ' + a.errors.join('\n- '));

    T = {};
    [DEFAULT_THEME, spec.theme || {}, opts || {}].forEach(function (src) { for (var k in src) T[k] = src[k]; });

    var parts = { box: '', wire: '', comp: '', text: '' };
    WIRESEGS = []; TEXTBOX = [];
    spec.elements.forEach(function (el) {
      if (el.type === 'wire') for (var i = 0; i < el.points.length - 1; i++) WIRESEGS.push([el.points[i], el.points[i + 1]]);
    });

    spec.elements.forEach(function (el) {
      var t = el.type;
      if (t === 'box') {
        parts.box += '<rect x="' + f(el.x) + '" y="' + f(el.y) + '" width="' + f(el.w) + '" height="' + f(el.h) +
          '" rx="8" stroke="' + T.muted + '" stroke-width="0.8" stroke-dasharray="6 4"/>';
        if (el.label) parts.text += textEl(el.x + 14, el.y + 22, el.label, 'start', 14, true, 'text');
      } else if (t === 'wire') {
        parts.wire += '<polyline points="' + el.points.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '"/>';
      } else if (t === 'label') {
        var lsz = el.size || 14;
        parts.text += textEl(el.at[0], el.at[1], el.text, el.anchor || 'start', lsz, el.bold !== undefined ? !!el.bold : lsz >= 14, el.muted ? 'muted' : 'text');
      } else if (TWO[t]) { drawTwo(el, parts);
      } else if (t === 'npn' || t === 'pnp') { drawTransistor(el, parts);
      } else if (t === 'opamp') { drawOpamp(el, parts);
      } else if (SINGLE[t]) { drawSingle(el, parts); }
    });

    var dots = '', seen = {};
    a.junctions.forEach(function (j) {
      var k = key(j[0], j[1]);
      if (seen[k]) return; seen[k] = 1;
      dots += '<circle cx="' + f(j[0]) + '" cy="' + f(j[1]) + '" r="' + T.dotRadius + '"/>';
    });

    var vx = 0, vy = 0, W = spec.width, H = spec.height;
    if (!isNum(W) || !isNum(H)) {
      var bb = a.bbox ? { x0: a.bbox.x0, y0: a.bbox.y0, x1: a.bbox.x1, y1: a.bbox.y1 } : { x0: 0, y0: 0, x1: 200, y1: 200 }, pad = T.padding;
      TEXTBOX.forEach(function (b) { bb.x0 = Math.min(bb.x0, b[0]); bb.y0 = Math.min(bb.y0, b[1]); bb.x1 = Math.max(bb.x1, b[2]); bb.y1 = Math.max(bb.y1, b[3]); });
      vx = Math.floor(bb.x0 - pad); vy = Math.floor(bb.y0 - pad);
      W = Math.ceil(bb.x1 - bb.x0 + 2 * pad); H = Math.ceil(bb.y1 - bb.y0 + 2 * pad);
    }

    TEXTBOX = null;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + vx + ' ' + vy + ' ' + W + ' ' + H +
      '" font-family="' + esc(T.font) + '">' +
      '<title>' + esc(spec.title || 'Circuit schematic') + '</title>' +
      '<defs><marker id="cd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M2 1L8 5L2 9" fill="none" stroke="' + T.stroke + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>' +
      (T.background ? '<rect x="' + vx + '" y="' + vy + '" width="' + W + '" height="' + H + '" fill="' + T.background + '"/>' : '') +
      '<g fill="none" stroke="' + T.stroke + '" stroke-width="' + T.lineWidth + '" stroke-linecap="round" stroke-linejoin="round">' +
      parts.box + parts.wire + parts.comp + '</g>' +
      '<g fill="' + T.stroke + '" stroke="none">' + dots + '</g>' +
      '<g>' + parts.text + '</g></svg>';
  }


  /* ---------- build sheet: parts list + nets, for rebuilding in another tool ---------- */

  var PINNAMES = {
    diode: ['A', 'K'], zener: ['A', 'K'], led: ['A', 'K'],
    battery: ['+', '-'], electrolytic: ['+', '-']
  };
  var NICE = { resistor: 'Resistor', capacitor: 'Capacitor', electrolytic: 'Electrolytic capacitor', inductor: 'Inductor / coil',
    diode: 'Diode', zener: 'Zener diode', led: 'LED', battery: 'Battery', switch: 'Switch', mic: 'Microphone', speaker: 'Speaker',
    lamp: 'Lamp', acsource: 'AC source', crystal: 'Crystal', npn: 'NPN transistor', pnp: 'PNP transistor', opamp: 'Op-amp',
    antenna: 'Antenna (a plain wire)' };

  function netlist(spec) {
    var rep = analyse(spec);
    if (rep.errors.length) throw new Error('Invalid circuit spec:\n- ' + rep.errors.join('\n- '));
    var parent = {};
    function find(k) { if (parent[k] === undefined) parent[k] = k; while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

    var segs = [], wirePts = [], pins = [], junctions = [], parts = [], auto = 0;
    spec.elements.forEach(function (el) {
      if (el.type === 'wire') {
        el.points.forEach(function (p) { wirePts.push(p); });
        for (var i = 0; i < el.points.length - 1; i++) segs.push([el.points[i], el.points[i + 1]]);
      } else if (el.type === 'junction') {
        junctions.push([el.x, el.y]);
      } else if (el.type !== 'label' && el.type !== 'box') {
        var des = el.label || el.id;
        var isPart = !!NICE[el.type];
        if (isPart && !des) des = el.type.toUpperCase().slice(0, 1) + '?' + (++auto);
        var names = PINNAMES[el.type];
        pinsOf(el).forEach(function (pin, idx) {
          var pn = names ? names[idx] : (TWO[el.type] || pin.n === 'at' ? String(idx + 1) : pin.n);
          pins.push({ el: el, des: des, pin: pn, p: pin.p });
        });
        if (isPart) parts.push({ des: des, type: NICE[el.type], value: el.value || '', el: el });
      }
    });

    segs.forEach(function (sg) { union(key(sg[0][0], sg[0][1]), key(sg[1][0], sg[1][1])); });
    var touch = pins.map(function (q) { return q.p; }).concat(wirePts);
    touch.forEach(function (pt) {
      segs.forEach(function (sg) { if (onSegInterior(pt[0], pt[1], sg[0], sg[1])) union(key(pt[0], pt[1]), key(sg[0][0], sg[0][1])); });
    });
    junctions.forEach(function (j) {
      segs.forEach(function (sg) { if (onSegInterior(j[0], j[1], sg[0], sg[1]) || (sg[0][0] === j[0] && sg[0][1] === j[1]) || (sg[1][0] === j[0] && sg[1][1] === j[1])) union(key(j[0], j[1]), key(sg[0][0], sg[0][1])); });
    });
    pins.forEach(function (q) { find(key(q.p[0], q.p[1])); });

    var groups = {}, order = [];
    pins.forEach(function (q) {
      var r = find(key(q.p[0], q.p[1]));
      if (!groups[r]) { groups[r] = { pins: [], names: [], hasGnd: false, hasPlus: false }; order.push(r); }
      var g = groups[r];
      if (q.el.type === 'ground') g.hasGnd = true;
      else if (q.el.type === 'terminal' && q.el.label) g.names.push(q.el.label);
      else if (q.el.type === 'battery' && q.pin === '+') g.hasPlus = true;
      if (q.el.type !== 'ground' && q.el.type !== 'terminal') g.pins.push(q.des + '.' + q.pin);
    });

    var used = {}, n = 0, nets = [];
    function clean(t) { return String(t).replace(/[^A-Za-z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'NET'; }
    order.forEach(function (r) {
      var g = groups[r], name;
      if (g.hasGnd) name = 'GND';
      else if (g.names.length) {
        var raw = String(g.names[0]);
        name = /^\+?\s*\d+(\.\d+)?\s*V$/i.test(raw) ? (used.VCC ? 'V' + clean(raw.replace('.', 'p')).replace(/V$/i, '') : 'VCC') : clean(raw);
      }
      else if (g.hasPlus && !used.VCC) name = 'VCC';
      else name = 'N' + (++n);
      if (name === 'GND') {
        var ex = nets.filter(function (x) { return x.name === 'GND'; })[0];
        if (ex) { ex.pins = ex.pins.concat(g.pins); return; }
      } else if (used[name]) name = name + '_' + (++n);
      used[name] = 1;
      if (g.pins.length) nets.push({ name: name, pins: g.pins });
    });
    // fixed order: GND first, VCC second, then the rest
    nets.sort(function (a, b) { var w = function (x) { return x === 'GND' ? 0 : x === 'VCC' ? 1 : 2; }; return w(a.name) - w(b.name); });
    parts.sort(function (a, b) {
      return a.des.replace(/\d+/g, '').localeCompare(b.des.replace(/\d+/g, '')) || (parseInt(a.des.replace(/\D/g, ''), 10) || 0) - (parseInt(b.des.replace(/\D/g, ''), 10) || 0);
    });
    return { parts: parts.map(function (x) { return { designator: x.des, type: x.type, value: x.value }; }), nets: nets };
  }

  function buildSheet(spec) {
    var nl = netlist(spec), out = [];
    out.push('# Build sheet: ' + (spec.title || 'Circuit'), '', '## Parts', '', '| Designator | Part | Value |', '|---|---|---|');
    nl.parts.forEach(function (x) { out.push('| ' + x.designator + ' | ' + x.type + ' | ' + (x.value || '-') + ' |'); });
    out.push('', '## Nets (everything on one line is joined together)', '');
    nl.nets.forEach(function (nt) { out.push('- ' + nt.name + ': ' + nt.pins.join(', ')); });
    out.push('', 'Pin names: resistor / capacitor / inductor / switch pins are 1 and 2. Diode and LED: A = anode (the triangle side), K = cathode (the bar). Battery and electrolytic: + and -. Transistor: B, C, E. Op-amp: INV, NONINV, OUT.');
    return out.join('\n');
  }

  return {
    version: VERSION,
    render: render,
    validate: validate,
    netlist: netlist,
    buildSheet: buildSheet,
    types: Object.keys(TWO).concat(Object.keys(MULTI), Object.keys(SINGLE), Object.keys(OTHER)),
    defaults: DEFAULT_THEME
  };
});
