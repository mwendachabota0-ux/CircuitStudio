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
    module.exports = factory(root.CircuitGeometry);
  } else {
    root.CircuitDraw = factory(root.CircuitGeometry);
  }
})(typeof self !== 'undefined' ? self : this, function (CircuitGeometry) {
  'use strict';

  if (!CircuitGeometry || typeof CircuitGeometry.getCircuitPins !== 'function') {
    throw new Error('CircuitGeometry must be loaded before CircuitDraw.');
  }

  var VERSION = '1.0.0';
  var PIN_SNAP_TOLERANCE = 8;

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
  var TEXTOWNER = '';
  var TEXTROLE = 'symbol-text';
  function textEl(x, y, s, anchor, size, bold, tone) {
    var fill = tone === 'muted' ? T.muted : T.text;
    if (TEXTBOX) {
      var w = String(s).length * (size || 12) * (bold ? 0.62 : 0.56), x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      var box = [x0, y - (size || 12), x0 + w, y + 4];
      box.owner = TEXTOWNER;
      box.role = TEXTROLE;
      box.text = String(s);
      TEXTBOX.push(box);
    }
    return '<text x="' + f(x) + '" y="' + f(y) + '" text-anchor="' + (anchor || 'start') + '" font-size="' + (size || 12) + '"' +
      (bold ? ' font-weight="bold"' : '') + ' fill="' + fill + '">' + esc(s) + '</text>';
  }
  function withTextRole(role, draw) {
    var previousRole = TEXTROLE;
    TEXTROLE = role;
    try { return draw(); }
    finally { TEXTROLE = previousRole; }
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
    } },
    fuse: { hl: 18, hr: 18, hp: 12, draw: function (c) {
      return { s: '<rect x="' + f(c - 18) + '" y="-9" width="36" height="18" rx="2"/>' +
        ln(c - 10, -5, c + 10, 5) };
    } },
    thermistor: { hl: 25, hr: 25, hp: 15, draw: function (c) {
      return { s: '<rect x="' + f(c - 18) + '" y="-10" width="36" height="20"/>' +
        ln(c - 18, 15, c + 18, -15), t: [{ x: c + 23, y: -13, s: 'T', anchor: 'start', size: 9 }] };
    } },
    photoresistor: { hl: 25, hr: 25, hp: 18, draw: function (c) {
      return { s: '<rect x="' + f(c - 18) + '" y="-10" width="36" height="20"/>' +
        ln(c - 31, -20, c - 20, -9, ARROW) + ln(c - 19, -27, c - 8, -16, ARROW) };
    } },
    varistor: { hl: 25, hr: 25, hp: 16, draw: function (c) {
      return { s: '<rect x="' + f(c - 18) + '" y="-10" width="36" height="20"/>' +
        ln(c - 25, 17, c + 25, -17, ARROW) };
    } },
    photodiode: { hl: 10, hr: 10, hp: 24, draw: function (c) {
      return { s: diodeBody(c) + ln(c - 24, -22, c - 12, -10, ARROW) +
        ln(c - 12, -29, c, -17, ARROW) };
    } },
    schottky: { hl: 12, hr: 12, hp: 12, draw: function (c) {
      return { s: '<polygon points="' + f(c - 10) + ',-10 ' + f(c - 10) + ',10 ' + f(c + 10) + ',0"/>' +
        ln(c + 10, -10, c + 10, 10) + ln(c + 10, -10, c + 15, -5) + ln(c + 10, 10, c + 15, 5) };
    } },
    dcsource: { hl: 21, hr: 21, hp: 21, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="21"/>' +
        ln(c - 12, 0, c - 4, 0) + ln(c - 8, -4, c - 8, 4) + ln(c + 5, 0, c + 13, 0) };
    } },
    currentsource: { hl: 21, hr: 21, hp: 21, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="21"/>' +
        ln(c, 11, c, -11, ARROW) };
    } },
    motor: { hl: 22, hr: 22, hp: 20, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="22"/>',
        t: [{ x: c, y: 4, s: 'M', anchor: 'middle', size: 15 }] };
    } },
    buzzer: { hl: 22, hr: 22, hp: 22, draw: function (c) {
      return { s: '<circle cx="' + f(c) + '" cy="0" r="22"/>' +
        '<path d="M' + f(c + 9) + ' -12 q13 12 0 24 M' + f(c + 14) + ' -17 q19 17 0 34"/>' };
    } },
    solarcell: { hl: 22, hr: 22, hp: 22, draw: function (c) {
      return { s: '<rect x="' + f(c - 20) + '" y="-15" width="40" height="30"/>' +
        ln(c - 24, -25, c - 15, -16, ARROW) + ln(c - 8, -27, c + 1, -18, ARROW) +
        ln(c - 9, -4, c + 9, -4) + ln(c, -13, c, 5, ARROW) };
    } }
  };

  var MULTI = {
    npn: 1, pnp: 1, opamp: 1, potentiometer: 1, nmos: 1, pmos: 1, mosfet: 1, njfet: 1, pjfet: 1,
    regulator: 1, comparator: 1, transformer: 1, relay: 1, bridge: 1, opto: 1, ic: 1, connector: 1
  };
  var SINGLE = { ground: 1, antenna: 1, terminal: 1 };
  var OTHER = { wire: 1, junction: 1, crossing: 1, label: 1, box: 1 };

  function knownType(t) {
    return CircuitGeometry.isSupportedCircuitElementType(t);
  }

  /* ---------- pins ---------- */

  function pinsOf(el) {
    return CircuitGeometry.getCircuitPins(el).map(function (pin) {
      return { n: pin.name, p: pin.point };
    });
  }

  function kicadUnitOf(el) {
    if (!el || !el.symbolData || !Array.isArray(el.symbolData.units)) return null;
    var unitNumber = Number.isInteger(el.unit) ? el.unit : 1;
    var bodyStyle = Number.isInteger(el.bodyStyle) ? el.bodyStyle : 1;
    return el.symbolData.units.filter(function (unit) {
      return unit && unit.unit === unitNumber && unit.bodyStyle === bodyStyle;
    })[0] || null;
  }

  function transformKicadPoint(point, el) {
    var flip = el.flip === true ? -1 : 1;
    var rotation = Number(el.rotation || 0) * Math.PI / 180;
    var x = point[0] * flip, y = point[1];
    return [
      el.at[0] + x * Math.cos(rotation) - y * Math.sin(rotation),
      el.at[1] + x * Math.sin(rotation) + y * Math.cos(rotation)
    ];
  }

  function kicadTransform(el) {
    var rotation = Number(el.rotation || 0);
    var flip = el.flip === true ? -1 : 1;
    return 'translate(' + f(el.at[0]) + ' ' + f(el.at[1]) + ') rotate(' +
      f(rotation) + ') scale(' + flip + ' 1)';
  }

  function trackKicadSymbol(el, track) {
    var unit = kicadUnitOf(el);
    if (!unit) return;
    (unit.pins || []).forEach(function (pin) {
      if (pin && isPt(pin.point)) {
        var endpoint = transformKicadPoint(pin.point, el);
        track(endpoint[0], endpoint[1]);
      }
      if (pin && isPt(pin.bodyPoint)) {
        var bodyPoint = transformKicadPoint(pin.bodyPoint, el);
        track(bodyPoint[0], bodyPoint[1]);
      }
    });
    (unit.graphics || []).forEach(function (graphic) {
      if (!graphic) return;
      var points = Array.isArray(graphic.points) ? graphic.points : [];
      points.forEach(function (point) {
        if (!isPt(point)) return;
        var world = transformKicadPoint(point, el);
        track(world[0], world[1]);
      });
      if (graphic.type === 'circle' && points.length && isNum(graphic.radius)) {
        var center = transformKicadPoint(points[0], el), radius = Math.abs(graphic.radius);
        track(center[0] - radius, center[1] - radius);
        track(center[0] + radius, center[1] + radius);
      }
      if (graphic.type === 'text' && points.length) {
        var textPoint = transformKicadPoint(points[0], el);
        var fontSize = isNum(graphic.fontSize) ? graphic.fontSize : 12;
        var textWidth = String(graphic.text || '').length * fontSize * 0.6;
        track(textPoint[0] - textWidth / 2, textPoint[1] - fontSize);
        track(textPoint[0] + textWidth / 2, textPoint[1] + fontSize);
      }
    });
  }

  function elementName(el, index) {
    var type = el && typeof el.type === 'string' ? el.type : 'element';
    var label = el && (el.id || el.label);
    return label ? type + ' "' + label + '"' : type + ' #' + (index + 1);
  }

  function nearestPin(point, pins, excludeOwner) {
    var best = null;
    pins.forEach(function (pin) {
      if (pin.owner === excludeOwner) return;
      var dx = pin.point[0] - point[0], dy = pin.point[1] - point[1];
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (!best || distance < best.distance) {
        best = { owner: pin.owner, point: pin.point, distance: distance };
      }
    });
    return best;
  }

  /* ---------- analysis: validation, junctions, bounds ---------- */

  function onSegInterior(px, py, a, b) {
    var cr = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (Math.abs(cr) > 0.01) return false;
    var dot = (px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1]);
    var len2 = (b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]);
    return dot > 0.01 && dot < len2 - 0.01;
  }

  function isAdvisoryUnconnectedPin(element, pinName) {
    if (!element || typeof CircuitGeometry.isAdvisoryUnconnectedCircuitPin !== 'function') return false;
    return CircuitGeometry.isAdvisoryUnconnectedCircuitPin(element, pinName);
  }

  function analyse(spec, options) {
    var requireConnectedWireEnds = !!(options && options.requireConnectedWireEnds);
    var res = { errors: [], warnings: [], junctions: [], crossings: [], bbox: null, freeEnds: [] };
    var ends = {}, segs = [], allPins = [];
    var bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

    function track(x, y) {
      if (x < bb.x0) bb.x0 = x; if (x > bb.x1) bb.x1 = x;
      if (y < bb.y0) bb.y0 = y; if (y > bb.y1) bb.y1 = y;
    }
    function addEnd(p, owner, kind) {
      var k = key(p[0], p[1]);
      if (!ends[k]) ends[k] = { x: p[0], y: p[1], n: 0, owners: [], pinOwners: [], wireOwners: [] };
      ends[k].n += 1; ends[k].owners.push(owner);
      if (kind === 'pin') ends[k].pinOwners.push(owner);
      if (kind === 'wire') ends[k].wireOwners.push(owner);
      track(p[0], p[1]);
    }

    function pinHasConnection(pin) {
      if (!pin) return false;
      var pointKey = key(pin.point[0], pin.point[1]);
      var node = ends[pointKey];
      if (node && (node.wireOwners.length || node.pinOwners.some(function (owner) {
        return owner !== pin.owner;
      }))) return true;
      return segs.some(function (segment) {
        return onSegInterior(pin.point[0], pin.point[1], segment.a, segment.b);
      });
    }

    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.elements)) {
      res.errors.push('The spec must be an object with an "elements" array.');
      return res;
    }

    spec.elements.forEach(function (el, i) {
      var id = elementName(el, i);
      if (!el || typeof el !== 'object' || typeof el.type !== 'string') { res.errors.push('Element #' + (i + 1) + ' has no "type".'); return; }
      if (!knownType(el.type)) {
        res.errors.push(id + ': unsupported CircuitDraw type "' + el.type + '". No pin model exists for this element. Use only: ' + CircuitGeometry.CIRCUIT_SUPPORTED_ELEMENT_TYPES.join(', ') + '; otherwise report the requested part as unsupported instead of inventing a symbol or pins.');
        return;
      }
      var t = el.type;
      if (t === 'ic' || t === 'connector') {
        var pinSchemaError = CircuitGeometry.getCircuitElementSchemaError(el);
        if (pinSchemaError) { res.errors.push(id + ': ' + pinSchemaError); return; }
      }
      if (t === 'kicad') {
        var kicadSchemaError = CircuitGeometry.getCircuitElementSchemaError(el);
        if (kicadSchemaError) { res.errors.push(id + ': ' + kicadSchemaError); return; }
        if (!el.symbolData) {
          res.errors.push(id + ': the exact KiCad drawing and pin data have not been loaded. Rebuild the proposal with the selected library symbol.');
          return;
        }
        if (!kicadUnitOf(el)) {
          res.errors.push(id + ': the selected KiCad symbol unit and body style are not present in its imported data.');
          return;
        }
      }

      if (t === 'wire') {
        if (!Array.isArray(el.points) || el.points.length < 2) { res.errors.push(id + ': "points" needs at least 2 [x,y] points.'); return; }
        for (var j = 0; j < el.points.length; j++) {
          if (!isPt(el.points[j])) { res.errors.push(id + ': point ' + (j + 1) + ' is not a [x,y] pair of numbers.'); return; }
        }
        for (var s = 0; s < el.points.length - 1; s++) {
          var a = el.points[s], b = el.points[s + 1];
          if (a[0] === b[0] && a[1] === b[1]) { res.warnings.push(id + ': has a zero-length segment at (' + a[0] + ',' + a[1] + '); remove the duplicate point.'); continue; }
          if (a[0] !== b[0] && a[1] !== b[1]) res.warnings.push(id + ': segment (' + a[0] + ',' + a[1] + ')->(' + b[0] + ',' + b[1] + ') is diagonal; add an orthogonal corner point to route horizontally and vertically.');
          segs.push({ a: a, b: b, owner: id, number: s + 1 });
           addEnd(a, id, 'wire'); addEnd(b, id, 'wire');
          if (el.open) { ends[key(a[0], a[1])].open = true; ends[key(b[0], b[1])].open = true; }
        }
        return;
      }

      if (t === 'junction') {
        if (!isNum(el.x) || !isNum(el.y)) { res.errors.push(id + ': needs numeric "x" and "y".'); return; }
        res.junctions.push([el.x, el.y]); track(el.x, el.y);
        return;
      }
      if (t === 'crossing') {
        var crossingSchemaError = CircuitGeometry.getCircuitElementSchemaError(el);
        if (crossingSchemaError) { res.errors.push(id + ': ' + crossingSchemaError); return; }
        if (!isPt(el.at)) { res.errors.push(id + ': needs "at":[x,y].'); return; }
        var orientation = el.orientation || 'horizontal';
        res.crossings.push({ at: el.at, orientation: orientation, owner: id });
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

      pinsOf(el).forEach(function (pin) {
        var owner = id + '.' + pin.n;
        addEnd(pin.p, owner, 'pin');
        allPins.push({ owner: owner, point: pin.p, element: el, name: pin.n });
      });
      if (t === 'kicad') trackKicadSymbol(el, track);
      if (t === 'npn' || t === 'pnp') { track(el.at[0] - 44, el.at[1] - 44); track(el.at[0] + 44, el.at[1] + 80); }
      if (t === 'opamp') { track(el.at[0] - 40, el.at[1] - 70); track(el.at[0] + 40, el.at[1] + 40); }
      if (t === 'comparator') { track(el.at[0] - 48, el.at[1] - 50); track(el.at[0] + 48, el.at[1] + 50); }
      if (t === 'potentiometer') { track(el.at[0] - 30, el.at[1] - 55); track(el.at[0] + 30, el.at[1] + 15); }
      if (t === 'regulator') { track(el.at[0] - 34, el.at[1] - 28); track(el.at[0] + 34, el.at[1] + 28); }
      if (t === 'transformer') { track(el.at[0] - 40, el.at[1] - 46); track(el.at[0] + 40, el.at[1] + 46); }
      if (t === 'relay') { track(el.at[0] - 42, el.at[1] - 44); track(el.at[0] + 42, el.at[1] + 44); }
      if (t === 'opto') { track(el.at[0] - 40, el.at[1] - 38); track(el.at[0] + 40, el.at[1] + 38); }
      if (t === 'ic' || t === 'connector') {
        var leftPinCount = el.pins.filter(function (pin) { return pin.side === 'left'; }).length;
        var rightPinCount = el.pins.filter(function (pin) { return pin.side === 'right'; }).length;
        var blockHeight = Math.max(48, Math.max(leftPinCount, rightPinCount) * 24 + 16);
        track(el.at[0] - 44, el.at[1] - blockHeight / 2);
        track(el.at[0] + 44, el.at[1] + blockHeight / 2);
      }
      if (t === 'antenna') track(el.at[0], el.at[1] - (el.height || 55) - 40);
      if (t === 'ground') track(el.at[0], el.at[1] + 50);
    });

    res.crossings.forEach(function (crossing) {
      var horizontal = [], vertical = [];
      segs.forEach(function (sg) {
        if (!onSegInterior(crossing.at[0], crossing.at[1], sg.a, sg.b)) return;
        if (sg.a[1] === sg.b[1]) horizontal.push(sg);
        if (sg.a[0] === sg.b[0]) vertical.push(sg);
      });
      if (
        horizontal.length !== 1 ||
        vertical.length !== 1 ||
        horizontal[0].owner === vertical[0].owner
      ) {
        res.errors.push(
          crossing.owner + ' must sit at the interior crossing of one horizontal and one vertical segment from different wires.',
        );
      }
      if (res.junctions.some(function (junction) {
        return key(junction[0], junction[1]) === key(crossing.at[0], crossing.at[1]);
      })) {
        res.errors.push(crossing.owner + ' conflicts with a junction at the same point; keep only the junction for a connected crossing.');
      }
    });

    spec.elements.forEach(function (el, i) {
      if (!el || !TWO[el.type] || !isPt(el.from) || !isPt(el.to)) return;
      var a0 = el.from, b0 = el.to, L2 = Math.pow(b0[0] - a0[0], 2) + Math.pow(b0[1] - a0[1], 2);
      var nm = el.type + ' "' + (el.label || el.id || '#' + (i + 1)) + '"';
      segs.forEach(function (sg) {
        var c1 = (b0[0] - a0[0]) * (sg.a[1] - a0[1]) - (b0[1] - a0[1]) * (sg.a[0] - a0[0]);
        var c2 = (b0[0] - a0[0]) * (sg.b[1] - a0[1]) - (b0[1] - a0[1]) * (sg.b[0] - a0[0]);
        if (Math.abs(c1) > 0.01 || Math.abs(c2) > 0.01) return;
        var t1 = ((sg.a[0] - a0[0]) * (b0[0] - a0[0]) + (sg.a[1] - a0[1]) * (b0[1] - a0[1])) / L2;
        var t2 = ((sg.b[0] - a0[0]) * (b0[0] - a0[0]) + (sg.b[1] - a0[1]) * (b0[1] - a0[1])) / L2;
        var lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
        if (hi - lo > 0.01) {
          var pins = pinsOf(el);
          res.errors.push(sg.owner + ' segment ' + sg.number + ' (' + f(sg.a[0]) + ',' + f(sg.a[1]) + ')->(' + f(sg.b[0]) + ',' + f(sg.b[1]) + ') passes through ' + nm + ' between pins ' + pins[0].n + ' and ' + pins[1].n + ', directly shorting it. Reroute around the symbol; terminate wires only at its actual pin coordinates.');
        }
      });
    });

    spec.elements.forEach(function (el, i) {
      if (!el || el.type !== 'junction' || !isNum(el.x) || !isNum(el.y)) return;
      var point = [el.x, el.y];
      var node = ends[key(el.x, el.y)];
      var touchesWire = (node && node.wireOwners.length > 0) ||
        segs.some(function (segment) {
          return onSegInterior(el.x, el.y, segment.a, segment.b);
        });
      if (touchesWire) addEnd(point, elementName(el, i), 'junction');
    });

    // degree of every point = segment ends touching it + 2 for every wire passing straight through it
    Object.keys(ends).forEach(function (k) {
      var e = ends[k], deg = e.n;
      segs.forEach(function (sg) { if (onSegInterior(e.x, e.y, sg.a, sg.b)) deg += 2; });
      if (deg >= 3 && spec.autoJunctions !== false) res.junctions.push([e.x, e.y]);
      if (deg === 1 && (!e.open || requireConnectedWireEnds)) {
        var owner = e.owners[0];
        var point = [e.x, e.y];
        var nearest = nearestPin(point, allPins, e.pinOwners.indexOf(owner) >= 0 ? owner : null);
        var location = '(' + f(e.x) + ',' + f(e.y) + ')';
        var detail = nearest
          ? ' Nearest pin is ' + nearest.owner + ' at (' + f(nearest.point[0]) + ',' + f(nearest.point[1]) + '), ' + f(nearest.distance) + ' px away.'
          : ' No component pin was found.';
        if (e.wireOwners.length) {
          res.errors.push(owner + ' endpoint at ' + location + ' is not connected.' + detail + (nearest
            ? ' Move this endpoint exactly to (' + f(nearest.point[0]) + ',' + f(nearest.point[1]) + ') if that is the intended connection; set open:true only if the wire is intentionally left open.'
            : ' Connect it to a supported component pin or another wire endpoint; set open:true only if it is intentionally left open.'));
          res.freeEnds.push({ point: point, kind: 'wire' });
        } else {
          var pin = allPins.filter(function (entry) { return entry.owner === owner; })[0];
          var message = owner + ' at ' + location + ' is not connected to a wire.' + detail;
          if (pin && !isAdvisoryUnconnectedPin(pin.element, pin.name)) {
            res.errors.push(message + ' This required pin must be connected before the proposal can be applied.');
          } else {
            res.warnings.push(message + ' If this pin should be connected, route a wire endpoint exactly to (' + f(e.x) + ',' + f(e.y) + '); otherwise leave it intentionally unused.');
          }
          res.freeEnds.push({ point: point, kind: 'pin' });
        }
      }
    });

    spec.elements.forEach(function (el, i) {
      if (!el || el.type !== 'relay') return;
      var relayPins = allPins.filter(function (pin) { return pin.element === el; });
      var nc = relayPins.filter(function (pin) { return pin.name === 'NC'; })[0];
      var no = relayPins.filter(function (pin) { return pin.name === 'NO'; })[0];
      if (!pinHasConnection(nc) && !pinHasConnection(no)) {
        res.errors.push(elementName(el, i) + ' has neither NC nor NO contact connected. Connect at least one contact; the unused contact may remain open.');
      }
    });

    if (isFinite(bb.x0)) res.bbox = bb;
    return res;
  }

  function validate(spec, options) {
    var a = analyse(spec, options);
    var topology = circuitTopologyFindings(spec);
    var topologyErrors = astableTopologyFindings(spec).concat(topology.errors);
    return {
      errors: a.errors.concat(topologyErrors),
      warnings: a.warnings.concat(topology.warnings),
      topologyErrors: topologyErrors,
      topologyWarnings: topology.warnings
    };
  }

  function circuitTopologyFindings(spec) {
    var result = { errors: [], warnings: [] };
    if (!spec || !Array.isArray(spec.elements)) return result;

    var connectivity;
    try {
      connectivity = netlist(spec, true);
    } catch (_) {
      return result;
    }

    var designators = new Map();
    var auto = 0;
    spec.elements.forEach(function (el) {
      if (!el || !NICE[el.type]) return;
      var designator = el.label || el.id;
      if (!designator) designator = el.type.toUpperCase().slice(0, 1) + '?' + (++auto);
      designators.set(el, String(designator));
    });

    function netFor(element, pin) {
      var designator = designators.get(element);
      if (!designator || pin == null) return null;
      var member = designator + '.' + String(pin);
      return connectivity.nets.filter(function (net) { return net.pins.indexOf(member) >= 0; })[0] || null;
    }
    function polarity(name) {
      var value = String(name || '').trim();
      if (/^(?:\+|plus|positive|v\+)$/i.test(value)) return 'positive';
      if (/^(?:-|−|minus|negative|v-)$/i.test(value)) return 'negative';
      return null;
    }
    function terminalPins(element) {
      if (element.type === 'kicad') {
        var unit = kicadUnitOf(element);
        return unit && Array.isArray(unit.pins) ? unit.pins : [];
      }
      return pinsOf(element).map(function (pin) {
        return { number: pin.n, name: pin.n };
      });
    }

    var sources = [];
    spec.elements.forEach(function (element, index) {
      if (!element) return;
      var pins = terminalPins(element);
      var sourceFamily = element.type === 'battery' || element.type === 'dcsource' ||
        (element.type === 'kicad' &&
          /^(?:Device:Battery(?:_Cell)?|Simulation_SPICE:V(?:DC|AC))$/i.test(
            String(element.symbolId || ''),
          ));
      if (!sourceFamily) return;

      var positivePin = null;
      var negativePin = null;
      pins.forEach(function (pin) {
        var sign = polarity(pin.name);
        if (sign === 'positive') positivePin = pin.number || pin.n;
        if (sign === 'negative') negativePin = pin.number || pin.n;
      });
      if (positivePin == null && element.type !== 'kicad') positivePin = '+';
      if (negativePin == null && element.type !== 'kicad') negativePin = '-';
      if (positivePin == null || negativePin == null) return;

      sources.push({
        element: element,
        name: elementName(element, index),
        positiveNet: netFor(element, positivePin),
        negativeNet: netFor(element, negativePin)
      });
    });

    sources.forEach(function (source) {
      if (source.positiveNet && source.positiveNet === source.negativeNet) {
        result.errors.push(
          source.name + ' has its positive and negative terminals on the same net; this directly shorts the source.',
        );
      }
    });

    var switches = spec.elements.filter(function (element) {
      if (!element) return false;
      if (element.type === 'switch') return true;
      return element.type === 'kicad' &&
        /^Switch:SW_(?:SPST|SPDT|DPST|DPDT|SP3T|DP3T)/i.test(String(element.symbolId || ''));
    });
    switches.forEach(function (switchElement, switchIndex) {
      var pins = terminalPins(switchElement);
      var switchPins = pins.map(function (pin) { return pin.number || pin.n; })
        .filter(function (pin) { return pin != null; });
      if (switchPins.length < 2) return;
      var switchName = elementName(switchElement, spec.elements.indexOf(switchElement));
      sources.forEach(function (source) {
        if (!source.positiveNet || !source.negativeNet) return;
        for (var left = 0; left < switchPins.length; left++) {
          for (var right = left + 1; right < switchPins.length; right++) {
            var leftNet = netFor(switchElement, switchPins[left]);
            var rightNet = netFor(switchElement, switchPins[right]);
            if (
              (leftNet === source.positiveNet && rightNet === source.negativeNet) ||
              (rightNet === source.positiveNet && leftNet === source.negativeNet)
            ) {
              result.errors.push(
                switchName + ' bridges ' + source.name + ' positive and negative rails; closing the switch would directly short the source.',
              );
              return;
            }
          }
        }
      });
    });

    spec.elements.forEach(function (element, index) {
      if (!element) return;
      var isResistor = element.type === 'resistor' ||
        (element.type === 'kicad' && /^Device:R(?:_|$)/i.test(String(element.symbolId || '')));
      if (!isResistor) return;
      var pins = terminalPins(element);
      var first = pins[0] && (pins[0].number || pins[0].n);
      var second = pins[1] && (pins[1].number || pins[1].n);
      if (first == null || second == null) return;
      if (netFor(element, first) !== netFor(element, second)) return;
      if (/^0(?:\.0*)?(?:\s*(?:r|ohm|Ω))?$/i.test(String(element.value || '').trim())) return;
      result.warnings.push(
        elementName(element, index) + ' is bypassed: both resistor terminals are on the same net, so it cannot provide its stated resistance.',
      );
    });

    return result;
  }

  function astableTopologyFindings(spec) {
    if (!spec || !Array.isArray(spec.elements)) return [];

    var transistors = spec.elements.filter(function (el) { return el && (el.type === 'npn' || el.type === 'pnp'); });
    if (transistors.length !== 2 || transistors[0].type !== transistors[1].type) return [];
    var capacitors = spec.elements.filter(function (el) { return el && (el.type === 'capacitor' || el.type === 'electrolytic'); });
    if (capacitors.length < 2) return [];

    var partNames = [], auto = 0;
    spec.elements.forEach(function (el) {
      var designator = el.label || el.id;
      if (NICE[el.type] && !designator) designator = el.type.toUpperCase().slice(0, 1) + '?' + (++auto);
      partNames.push(designator);
    });
    function partName(el) { return partNames[spec.elements.indexOf(el)]; }

    var connectivity;
    try {
      connectivity = netlist(spec, true);
    } catch (error) {
      return [];
    }
    function netFor(designator, pin) {
      if (!designator) return null;
      var member = designator + '.' + pin;
      return connectivity.nets.filter(function (net) { return net.pins.indexOf(member) >= 0; })[0] || null;
    }
    function sameNet(left, right) { return !!left && !!right && left === right; }

    var transistorNets = transistors.map(function (transistor) {
      var name = partName(transistor);
      return {
        name: String(name || transistor.type),
        type: transistor.type,
        base: netFor(name, 'B'),
        collector: netFor(name, 'C'),
        emitter: netFor(name, 'E'),
      };
    });

    var positiveSupply = connectivity.nets.filter(function (net) {
      return /^(VCC|VDD|V\d+(?:p\d+)?)$/i.test(net.name);
    })[0] || null;
    var groundSupply = connectivity.nets.filter(function (net) {
      return /^(GND|GROUND|VSS|0V|COM)$/i.test(net.name);
    })[0] || null;

    function resistorElementsBetween(firstNet, secondNet) {
      return spec.elements.filter(function (element) {
        if (!element || element.type !== 'resistor') return false;
        var name = partName(element);
        return (sameNet(netFor(name, '1'), firstNet) && sameNet(netFor(name, '2'), secondNet)) ||
          (sameNet(netFor(name, '2'), firstNet) && sameNet(netFor(name, '1'), secondNet));
      });
    }
    function hasResistorBetween(firstNet, secondNet) {
      return resistorElementsBetween(firstNet, secondNet).length > 0;
    }

    // Titles and descriptions are presentation text. Classify only a clearly
    // wired two-transistor feedback oscillator, using the paired collector-to-
    // base timing capacitors as the defining structure. Keep the feed and
    // emitter checks below active when those connections are the fault.
    if (
      !positiveSupply ||
      !groundSupply ||
      sameNet(positiveSupply, groundSupply) ||
      transistorNets.some(function (transistor) {
        return !transistor.base || !transistor.collector || !transistor.emitter;
      }) ||
      sameNet(transistorNets[0].collector, transistorNets[1].collector)
    ) return [];

    var feedbackCollectors = new Set();
    capacitors.forEach(function (capacitor) {
      var name = partName(capacitor);
      var pinNames = capacitor.type === 'electrolytic' ? ['+', '-'] : ['1', '2'];
      var firstNet = netFor(name, pinNames[0]);
      var secondNet = netFor(name, pinNames[1]);
      transistorNets.forEach(function (transistor, index) {
        var feedbackToBase = transistorNets.some(function (baseOwner) {
          return sameNet(firstNet, transistor.collector) && sameNet(secondNet, baseOwner.base) ||
            sameNet(secondNet, transistor.collector) && sameNet(firstNet, baseOwner.base);
        });
        if (feedbackToBase) feedbackCollectors.add(index);
      });
    });
    if (feedbackCollectors.size !== transistorNets.length) return [];

    var findings = [];
    if (sameNet(transistorNets[0].base, transistorNets[1].base)) {
      findings.push(
        transistorNets[0].name + '.B and ' + transistorNets[1].name +
          '.B share one net; a two-transistor astable needs separate base nets.',
      );
    }

    transistorNets.forEach(function (transistor) {
      if (sameNet(transistor.base, transistor.collector)) {
        findings.push(transistor.name + '.B and ' + transistor.name + '.C share one net; this shorts the base to the collector and prevents normal astable switching.');
      }
      if (sameNet(transistor.base, transistor.emitter)) {
        findings.push(transistor.name + '.B and ' + transistor.name + '.E share one net; an astable base must not be shorted to its emitter.');
      }
    });

    transistorNets.forEach(function (transistor) {
      var baseRail = transistor.type === 'pnp' ? groundSupply : positiveSupply;
      var emitterRail = transistor.type === 'pnp' ? positiveSupply : groundSupply;
      var baseFeedLabel = transistor.type === 'pnp' ? 'ground' : 'the positive supply';
      var emitterRailLabel = transistor.type === 'pnp' ? 'the positive supply' : 'ground';
      var hasBaseFeed = hasResistorBetween(transistor.base, baseRail);
      if (!hasBaseFeed) {
        findings.push(transistor.name + '.B needs its own resistor to ' + baseFeedLabel + '.');
      }
      if (!sameNet(transistor.emitter, emitterRail) && !hasResistorBetween(transistor.emitter, emitterRail)) {
        findings.push(transistor.name + '.E must connect to ' + emitterRailLabel + ' directly or through a resistor.');
      }
    });

    var validDirections = {};
    capacitors.forEach(function (capacitor) {
      var name = partName(capacitor);
      var pinNames = capacitor.type === 'electrolytic' ? ['+', '-'] : ['1', '2'];
      var firstNet = netFor(name, pinNames[0]);
      var secondNet = netFor(name, pinNames[1]);
      var sameSide = null, oppositeSide = null;
      for (var i = 0; i < transistorNets.length; i++) {
        for (var j = 0; j < transistorNets.length; j++) {
          if (i === j) continue;
          var left = transistorNets[i], right = transistorNets[j];
          var forward = sameNet(firstNet, left.collector) && sameNet(secondNet, right.base);
          var reverse = sameNet(secondNet, left.collector) && sameNet(firstNet, right.base);
          if (i === j) continue;
          if (sameNet(firstNet, left.collector) && sameNet(secondNet, left.base)) {
            sameSide = { transistor: left };
          } else if (sameNet(secondNet, left.collector) && sameNet(firstNet, left.base)) {
            sameSide = { transistor: left };
          }
          if (forward || reverse) oppositeSide = { from: i, to: j };
        }
      }
      if (sameSide) {
        findings.push('Capacitor "' + name + '" connects ' + sameSide.transistor.name + '.C back to ' + sameSide.transistor.name + '.B; connect it to the opposite transistor base instead.');
      } else if (oppositeSide) {
        validDirections[oppositeSide.from + '>' + oppositeSide.to] = true;
      } else {
        findings.push('Capacitor "' + name + '" must connect a collector to the opposite transistor base.');
      }
    });

    for (var direction = 0; direction < 2; direction++) {
      var other = 1 - direction;
      if (!validDirections[direction + '>' + other]) {
        findings.push('No timing capacitor connects ' + transistorNets[direction].name + '.C to ' + transistorNets[other].name + '.B.');
      }
    }
    return findings;
  }

  var WIRE_ROUTE_CLEARANCE = 8;
  var ROUTE_CONTACT_CLEARANCE = 5;

  function pointInsideBounds(point, bounds) {
    return point[0] > bounds.x0 + 0.001 && point[0] < bounds.x1 - 0.001 &&
      point[1] > bounds.y0 + 0.001 && point[1] < bounds.y1 - 0.001;
  }

  function segmentIntersectsBounds(start, end, bounds) {
    var dx = end[0] - start[0], dy = end[1] - start[1];
    var minX = bounds.x0 + 0.01, maxX = bounds.x1 - 0.01;
    var minY = bounds.y0 + 0.01, maxY = bounds.y1 - 0.01;
    var enter = 0, leave = 1;

    function clip(p, q) {
      if (Math.abs(p) < 0.000001) return q >= 0;
      var ratio = q / p;
      if (p < 0) {
        if (ratio > leave) return false;
        if (ratio > enter) enter = ratio;
      } else {
        if (ratio < enter) return false;
        if (ratio < leave) leave = ratio;
      }
      return true;
    }

    if (!clip(-dx, start[0] - minX) ||
        !clip(dx, maxX - start[0]) ||
        !clip(-dy, start[1] - minY) ||
        !clip(dy, maxY - start[1])) return false;
    return leave - enter > 0.0001 &&
      Math.sqrt(dx * dx + dy * dy) * (leave - enter) > 0.5;
  }

  function samePoint(left, right) {
    return isPt(left) && isPt(right) && key(left[0], left[1]) === key(right[0], right[1]);
  }

  function expandedBounds(bounds, amount) {
    return {
      x0: bounds.x0 - amount,
      y0: bounds.y0 - amount,
      x1: bounds.x1 + amount,
      y1: bounds.y1 + amount
    };
  }

  function routeBodies(spec) {
    var bodies = [];
    spec.elements.forEach(function (element, index) {
      var bounds = componentBodyBounds(element, index);
      if (!bounds) return;
      bodies.push({
        element: element,
        index: index,
        bounds: bounds,
        expanded: expandedBounds(bounds, WIRE_ROUTE_CLEARANCE),
        pins: pinsOf(element).map(function (pin) {
          return { name: pin.n, point: pin.p };
        })
      });
    });
    return bodies;
  }

  function routeTapPoints(spec, currentWireIndex, start, end) {
    var points = [];
    function add(point) {
      if (!isPt(point) || samePoint(point, start) || samePoint(point, end)) return;
      if (!points.some(function (existing) { return samePoint(existing, point); })) points.push(point);
    }

    spec.elements.forEach(function (element, index) {
      if (!element || typeof element !== 'object') return;
      if (element.type === 'wire' && Array.isArray(element.points)) {
        if (index !== currentWireIndex) element.points.forEach(add);
        return;
      }
      if (element.type === 'junction' && isNum(element.x) && isNum(element.y)) {
        add([element.x, element.y]);
        return;
      }
      if (element.type === 'label' || element.type === 'box') return;
      try {
        pinsOf(element).forEach(function (pin) { add(pin.p); });
      } catch (_error) {}
    });
    return points;
  }

  function routeWireSegments(spec, currentWireIndex) {
    var segments = [];
    spec.elements.forEach(function (element, index) {
      if (!element || element.type !== 'wire' || !Array.isArray(element.points)) return;
      for (var i = 0; i < element.points.length - 1; i++) {
        if (index === currentWireIndex) continue;
        segments.push({ start: element.points[i], end: element.points[i + 1] });
      }
    });
    return segments;
  }

  function routePointOnWire(point, segments) {
    return segments.some(function (segment) {
      return onSegInterior(point[0], point[1], segment.start, segment.end);
    });
  }

  function routePointParameter(point, start, end) {
    var dx = end[0] - start[0], dy = end[1] - start[1];
    var lengthSquared = dx * dx + dy * dy;
    return lengthSquared
      ? ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
      : 0;
  }

  function pointOnRouteSegment(point, start, end) {
    var dx = end[0] - start[0], dy = end[1] - start[1];
    var cross = dx * (point[1] - start[1]) - dy * (point[0] - start[0]);
    if (Math.abs(cross) > 0.01) return false;
    var parameter = routePointParameter(point, start, end);
    return parameter > 0.0001 && parameter < 0.9999;
  }

  function sortRoutePoints(points, start, end) {
    return points.sort(function (left, right) {
      return routePointParameter(left, start, end) - routePointParameter(right, start, end);
    });
  }

  function pinOutwardDirection(body, point, target) {
    var element = body.element, dx = 0, dy = 0;
    if (element.type === 'kicad') {
      var unit = kicadUnitOf(element);
      (unit && unit.pins || []).some(function (pin) {
        if (!isPt(pin.point) || !samePoint(transformKicadPoint(pin.point, element), point)) return false;
        if (isPt(pin.bodyPoint)) {
          var bodyPoint = transformKicadPoint(pin.bodyPoint, element);
          dx = point[0] - bodyPoint[0];
          dy = point[1] - bodyPoint[1];
        } else {
          dx = point[0] - element.at[0];
          dy = point[1] - element.at[1];
        }
        return true;
      });
    } else if (TWO[element.type]) {
      var twoPins = pinsOf(element);
      if (twoPins.length >= 2) {
        dx = point[0] - (twoPins[0].p[0] + twoPins[1].p[0]) / 2;
        dy = point[1] - (twoPins[0].p[1] + twoPins[1].p[1]) / 2;
      }
    } else if (isPt(element.at)) {
      dx = point[0] - element.at[0];
      dy = point[1] - element.at[1];
    }

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      dx = target[0] - point[0];
      dy = target[1] - point[1];
    }
    if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.001) return [dx > 0 ? 1 : -1, 0];
    if (Math.abs(dy) > 0.001) return [0, dy > 0 ? 1 : -1];
    return null;
  }

  function routeEndpointEscape(point, target, bodies) {
    var colliding = bodies.filter(function (body) {
      return pointInsideBounds(point, body.expanded);
    });
    if (!colliding.length) return [point[0], point[1]];

    var owners = colliding.filter(function (body) {
      return body.pins.some(function (pin) { return samePoint(pin.point, point); });
    });
    if (owners.length !== 1) return null;
    var owner = owners[0], direction = pinOutwardDirection(owner, point, target);
    if (!direction) return null;
    var escape = [point[0], point[1]];
    if (direction[0] < 0) escape[0] = owner.expanded.x0;
    else if (direction[0] > 0) escape[0] = owner.expanded.x1;
    else if (direction[1] < 0) escape[1] = owner.expanded.y0;
    else escape[1] = owner.expanded.y1;

    var leavesOtherBody = bodies.some(function (body) {
      return body !== owner && segmentIntersectsBounds(point, escape, body.expanded);
    });
    return leavesOtherBody ? null : escape;
  }

  function pushRouteHeap(heap, item) {
    var index = heap.length;
    heap.push(item);
    while (index > 0) {
      var parent = Math.floor((index - 1) / 2);
      if (heap[parent].cost <= item.cost) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = item;
  }

  function popRouteHeap(heap) {
    if (!heap.length) return null;
    var first = heap[0], last = heap.pop();
    if (heap.length) {
      var index = 0;
      while (true) {
        var left = index * 2 + 1, right = left + 1, child = left;
        if (left >= heap.length) break;
        if (right < heap.length && heap[right].cost < heap[left].cost) child = right;
        if (heap[child].cost >= last.cost) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  }

  function routeCoordinates(values) {
    values.sort(function (left, right) { return left - right; });
    var unique = [];
    values.forEach(function (value) {
      if (!isNum(value)) return;
      if (!unique.length || Math.abs(unique[unique.length - 1] - value) > 0.01) unique.push(value);
    });
    return unique;
  }

  function routeSegmentOverlapsWire(start, end, wireSegments) {
    return wireSegments.some(function (segment) {
      var a = segment.start, b = segment.end;
      if (Math.abs(start[1] - end[1]) < 0.001 &&
          Math.abs(a[1] - b[1]) < 0.001 &&
          Math.abs(start[1] - a[1]) < 0.001) {
        return Math.min(Math.max(start[0], end[0]), Math.max(a[0], b[0])) -
          Math.max(Math.min(start[0], end[0]), Math.min(a[0], b[0])) > 0.5;
      }
      if (Math.abs(start[0] - end[0]) < 0.001 &&
          Math.abs(a[0] - b[0]) < 0.001 &&
          Math.abs(start[0] - a[0]) < 0.001) {
        return Math.min(Math.max(start[1], end[1]), Math.max(a[1], b[1])) -
          Math.max(Math.min(start[1], end[1]), Math.min(a[1], b[1])) > 0.5;
      }
      return false;
    });
  }

  function routeEdgeIsClear(start, end, obstacles, tapPoints, wireSegments) {
    if (Math.abs(start[0] - end[0]) > 0.001 &&
        Math.abs(start[1] - end[1]) > 0.001) return false;
    if (obstacles.some(function (obstacle) {
      return segmentIntersectsBounds(start, end, obstacle);
    })) return false;
    if (tapPoints.some(function (point) {
      return pointOnRouteSegment(point, start, end);
    })) return false;
    return !routeSegmentOverlapsWire(start, end, wireSegments);
  }

  function findOrthogonalRoute(start, end, bodies, tapPoints, wireSegments) {
    var expandedBodies = bodies.map(function (body) { return body.expanded; });
    var startEscape = routeEndpointEscape(start, end, bodies);
    var endEscape = routeEndpointEscape(end, start, bodies);
    if (!startEscape || !endEscape) return null;

    var baseMinX = Math.min(startEscape[0], endEscape[0]) - 160;
    var baseMaxX = Math.max(startEscape[0], endEscape[0]) + 160;
    var baseMinY = Math.min(startEscape[1], endEscape[1]) - 160;
    var baseMaxY = Math.max(startEscape[1], endEscape[1]) + 160;
    var localObstacles = expandedBodies.filter(function (bounds) {
      return bounds.x1 >= baseMinX && bounds.x0 <= baseMaxX &&
        bounds.y1 >= baseMinY && bounds.y0 <= baseMaxY;
    });
    var localTaps = tapPoints.filter(function (point) {
      return point[0] >= baseMinX && point[0] <= baseMaxX &&
        point[1] >= baseMinY && point[1] <= baseMaxY &&
        !samePoint(point, startEscape) && !samePoint(point, endEscape);
    });
    var obstacles = localObstacles.slice();
    localTaps.forEach(function (point) {
      obstacles.push({
        x0: point[0] - ROUTE_CONTACT_CLEARANCE,
        y0: point[1] - ROUTE_CONTACT_CLEARANCE,
        x1: point[0] + ROUTE_CONTACT_CLEARANCE,
        y1: point[1] + ROUTE_CONTACT_CLEARANCE
      });
    });

    var xs = [startEscape[0], endEscape[0]];
    var ys = [startEscape[1], endEscape[1]];
    obstacles.forEach(function (bounds) {
      xs.push(bounds.x0, bounds.x1);
      ys.push(bounds.y0, bounds.y1);
    });
    var minX = Math.min.apply(Math, xs), maxX = Math.max.apply(Math, xs);
    var minY = Math.min.apply(Math, ys), maxY = Math.max.apply(Math, ys);
    xs.push(minX - 24, maxX + 24);
    ys.push(minY - 24, maxY + 24);
    xs = routeCoordinates(xs);
    ys = routeCoordinates(ys);
    if (xs.length * ys.length > 16000) return null;

    var nodes = [], nodeByKey = Object.create(null), rows = [], columns = [];
    ys.forEach(function (y) {
      var row = [];
      xs.forEach(function (x) {
        var point = [x, y];
        if (obstacles.some(function (bounds) { return pointInsideBounds(point, bounds); })) return;
        var endpoint = samePoint(point, startEscape) || samePoint(point, endEscape);
        if (!endpoint && routePointOnWire(point, wireSegments)) return;
        var nodeIndex = nodes.length;
        nodes.push(point);
        nodeByKey[key(x, y)] = nodeIndex;
        row.push(nodeIndex);
      });
      rows.push(row);
    });
    xs.forEach(function (x) {
      var column = [];
      ys.forEach(function (y) {
        var nodeIndex = nodeByKey[key(x, y)];
        if (nodeIndex !== undefined) column.push(nodeIndex);
      });
      columns.push(column);
    });
    var startIndex = nodeByKey[key(startEscape[0], startEscape[1])];
    var endIndex = nodeByKey[key(endEscape[0], endEscape[1])];
    if (startIndex === undefined || endIndex === undefined) return null;
    var adjacency = nodes.map(function () { return []; });

    function connectLine(indices) {
      for (var i = 0; i < indices.length - 1; i++) {
        var first = indices[i], second = indices[i + 1];
        if (!routeEdgeIsClear(nodes[first], nodes[second], obstacles, tapPoints, wireSegments)) continue;
        var direction = Math.abs(nodes[first][1] - nodes[second][1]) < 0.001 ? 1 : 2;
        adjacency[first].push({ index: second, direction: direction });
        adjacency[second].push({ index: first, direction: direction });
      }
    }
    rows.forEach(connectLine);
    columns.forEach(connectLine);

    var stateCount = nodes.length * 3;
    var distance = new Array(stateCount), previous = new Array(stateCount);
    for (var stateIndex = 0; stateIndex < stateCount; stateIndex++) distance[stateIndex] = Infinity;
    var startState = startIndex * 3;
    distance[startState] = 0;
    var heap = [];
    pushRouteHeap(heap, { state: startState, cost: 0 });
    var goalState = -1;
    while (heap.length) {
      var current = popRouteHeap(heap);
      if (current.cost !== distance[current.state]) continue;
      var currentNode = Math.floor(current.state / 3);
      var previousDirection = current.state % 3;
      if (currentNode === endIndex) {
        goalState = current.state;
        break;
      }
      adjacency[currentNode].forEach(function (edge) {
        var edgeDistance = Math.abs(nodes[currentNode][0] - nodes[edge.index][0]) +
          Math.abs(nodes[currentNode][1] - nodes[edge.index][1]);
        var cost = current.cost + edgeDistance +
          (previousDirection && previousDirection !== edge.direction ? 14 : 0);
        var nextState = edge.index * 3 + edge.direction;
        if (cost >= distance[nextState]) return;
        distance[nextState] = cost;
        previous[nextState] = current.state;
        pushRouteHeap(heap, { state: nextState, cost: cost });
      });
    }
    if (goalState < 0) return null;

    var route = [];
    var routeState = goalState;
    while (routeState !== startState) {
      route.push(nodes[Math.floor(routeState / 3)]);
      routeState = previous[routeState];
      if (routeState === undefined) return null;
    }
    route.push(nodes[startIndex]);
    route.reverse();
    var complete = [[start[0], start[1]]];
    if (!samePoint(start, startEscape)) complete.push(startEscape);
    route.slice(1, -1).forEach(function (point) { complete.push(point); });
    if (!samePoint(end, endEscape)) complete.push(endEscape);
    complete.push([end[0], end[1]]);
    return complete;
  }

  function routeConnectivitySignature(spec) {
    try {
      var memberships = netlist(spec, true, true);
      var groups = Object.create(null);
      function addGroup(netKey, member) {
        if (!groups[netKey]) groups[netKey] = [];
        groups[netKey].push(member);
      }
      memberships.pinMembership.forEach(function (member) {
        addGroup(member.netKey, 'P:' + member.elementIndex + ':' + member.pinIndex + ':' + (member.connected ? 1 : 0));
      });
      memberships.routeMembership.forEach(function (member) {
        addGroup(member.netKey, 'W:' + member.elementIndex);
      });
      return JSON.stringify(Object.keys(groups).map(function (netKey) {
        return groups[netKey].sort();
      }).sort(function (left, right) {
        return JSON.stringify(left).localeCompare(JSON.stringify(right));
      }));
    } catch (_error) {
      return null;
    }
  }

  function crossingMarkerStatuses(spec) {
    var wires = [];
    spec.elements.forEach(function (element, wireIndex) {
      if (!element || element.type !== 'wire' || !Array.isArray(element.points)) return;
      for (var i = 0; i < element.points.length - 1; i++) {
        wires.push({
          wireIndex: wireIndex,
          start: element.points[i],
          end: element.points[i + 1]
        });
      }
    });
    var junctionKeys = {};
    spec.elements.forEach(function (element) {
      if (element && element.type === 'junction') junctionKeys[key(element.x, element.y)] = true;
    });
    return spec.elements.map(function (element, index) {
      if (!element || element.type !== 'crossing' || !isPt(element.at)) return null;
      var horizontal = [], vertical = [];
      wires.forEach(function (wire) {
        if (!pointOnRouteSegment(element.at, wire.start, wire.end)) return;
        if (Math.abs(wire.start[1] - wire.end[1]) < 0.001) horizontal.push(wire);
        if (Math.abs(wire.start[0] - wire.end[0]) < 0.001) vertical.push(wire);
      });
      return index + ':' + (horizontal.length === 1 && vertical.length === 1 &&
        horizontal[0].wireIndex !== vertical[0].wireIndex && !junctionKeys[key(element.at[0], element.at[1])] ? '1' : '0');
    }).filter(Boolean).sort().join('|');
  }

  function simplifyRoutePoints(points, protectedPoints) {
    var result = [];
    points.forEach(function (point) {
      if (!isPt(point)) return;
      var copy = [point[0], point[1]];
      if (result.length && samePoint(result[result.length - 1], copy)) return;
      while (result.length >= 2) {
        var first = result[result.length - 2], middle = result[result.length - 1];
        var collinear = Math.abs(
          (middle[0] - first[0]) * (copy[1] - middle[1]) -
          (middle[1] - first[1]) * (copy[0] - middle[0])
        ) < 0.01;
        var protectedMiddle = protectedPoints.some(function (point) {
          return samePoint(point, middle);
        });
        if (!collinear || protectedMiddle) break;
        result.pop();
      }
      result.push(copy);
    });
    return result;
  }

  function autoRouteWiresAroundBodies(spec) {
    var fixed = JSON.parse(JSON.stringify(spec));
    var changes = [];
    var bodies = routeBodies(fixed);
    if (!bodies.length) return { spec: fixed, changes: changes };

    fixed.elements.forEach(function (wire, wireIndex) {
      if (!wire || wire.type !== 'wire' || !Array.isArray(wire.points) || wire.points.length < 2) return;
      var originalPoints = wire.points.map(function (point) { return [point[0], point[1]]; });
      var candidatePoints = [originalPoints[0]];
      var changed = false;
      var wireSegments = routeWireSegments(fixed, wireIndex);
      var tapPoints = routeTapPoints(fixed, wireIndex, originalPoints[0], originalPoints[originalPoints.length - 1]);

      for (var segmentIndex = 0; segmentIndex < originalPoints.length - 1; segmentIndex++) {
        var start = originalPoints[segmentIndex], end = originalPoints[segmentIndex + 1];
        var interiorPoints = tapPoints.filter(function (point) {
          return pointOnRouteSegment(point, start, end);
        });
        interiorPoints = sortRoutePoints(interiorPoints, start, end);
        var markers = fixed.elements.filter(function (element) {
          return element && element.type === 'crossing' && isPt(element.at) &&
            pointOnRouteSegment(element.at, start, end);
        }).map(function (element) { return element.at; });
        markers.forEach(function (point) {
          if (!interiorPoints.some(function (existing) { return samePoint(existing, point); })) {
            interiorPoints.push(point);
          }
        });
        interiorPoints = sortRoutePoints(interiorPoints, start, end);
        var waypoints = [start].concat(interiorPoints, [end]);

        for (var pointIndex = 0; pointIndex < waypoints.length - 1; pointIndex++) {
          var from = waypoints[pointIndex], to = waypoints[pointIndex + 1];
          var intersectingBody = bodies.some(function (body) {
            return segmentIntersectsBounds(from, to, body.bounds);
          });
          if (!intersectingBody) {
            candidatePoints.push(to);
            continue;
          }
          var route = findOrthogonalRoute(
            from,
            to,
            bodies,
            tapPoints.filter(function (point) {
              return !samePoint(point, from) && !samePoint(point, to);
            }),
            wireSegments,
          );
          if (!route) {
            candidatePoints = originalPoints;
            changed = false;
            return;
          }
          route.slice(1).forEach(function (point) { candidatePoints.push(point); });
          changed = true;
        }
      }

      if (!changed) return;
      var protectedPoints = tapPoints.concat(originalPoints.slice(1, -1));
      var routedPoints = simplifyRoutePoints(candidatePoints, protectedPoints);
      var candidate = JSON.parse(JSON.stringify(fixed));
      candidate.elements[wireIndex].points = routedPoints;
      var beforeConnectivity = routeConnectivitySignature(fixed);
      var afterConnectivity = routeConnectivitySignature(candidate);
      if (
        beforeConnectivity === null ||
        beforeConnectivity !== afterConnectivity ||
        crossingMarkerStatuses(fixed) !== crossingMarkerStatuses(candidate)
      ) return;

      fixed.elements[wireIndex].points = routedPoints;
      changes.push('Rerouted ' + elementName(wire, wireIndex) + ' around component bodies.');
      wire = fixed.elements[wireIndex];
      wireSegments = routeWireSegments(fixed, wireIndex);
      tapPoints = routeTapPoints(fixed, wireIndex, routedPoints[0], routedPoints[routedPoints.length - 1]);
    });
    return { spec: fixed, changes: changes };
  }

  function topologyPinName(pin, index) {
    return pin.n === 'at' ? String(index + 1) : String(pin.n);
  }

  function topologyReferenceKey(elementId, pinName) {
    return String(elementId) + '\u0000' + String(pinName);
  }

  function inspectTopologyContract(spec, topology) {
    var errors = [], warnings = [];
    var pinsByReference = Object.create(null);
    var assignments = Object.create(null);
    var netPins = [];
    var elementsById = Object.create(null);

    if (!spec || !Array.isArray(spec.elements)) {
      return { errors: ['The topology has no usable component layout.'], warnings: [] };
    }
    if (!topology || !Array.isArray(topology.nets) || !Array.isArray(topology.unconnectedPins)) {
      return { errors: ['The proposal is missing its explicit pin-to-net topology.'], warnings: [] };
    }

    spec.elements.forEach(function (element, elementIndex) {
      if (!element || OTHER[element.type] || element.type === 'label' || element.type === 'box') return;
      var pins;
      try { pins = pinsOf(element); }
      catch (_error) {
        errors.push(elementName(element, elementIndex) + ' has no readable pin geometry.');
        return;
      }
      if (!pins.length) return;
      if (typeof element.id !== 'string' || !element.id.trim()) {
        errors.push(elementName(element, elementIndex) + ' needs a stable id before pins can be assigned to nets.');
        return;
      }
      if (elementsById[element.id]) {
        errors.push('Component id "' + element.id + '" is used more than once.');
        return;
      }
      elementsById[element.id] = element;
      pins.forEach(function (pin, pinIndex) {
        var name = topologyPinName(pin, pinIndex);
        var refKey = topologyReferenceKey(element.id, name);
        if (!pinsByReference[refKey]) pinsByReference[refKey] = [];
        pinsByReference[refKey].push({
          element: element,
          elementId: element.id,
          pinName: name,
          sourcePinName: pin.n,
          point: pin.p,
          refKey: refKey
        });
      });
    });

    var seenNetIds = Object.create(null);
    topology.nets.forEach(function (net, netIndex) {
      if (!net || typeof net.id !== 'string' || !net.id.trim()) {
        errors.push('Net ' + (netIndex + 1) + ' needs a non-empty name.');
        netPins.push([]);
        return;
      }
      if (seenNetIds[net.id]) errors.push('Net name "' + net.id + '" is used more than once.');
      seenNetIds[net.id] = true;
      if (!Array.isArray(net.pins) || net.pins.length < 2) {
        errors.push('Net "' + net.id + '" must contain at least two distinct pins.');
        netPins.push([]);
        return;
      }
      var physicalPins = [], netSeen = Object.create(null);
      net.pins.forEach(function (reference) {
        if (!reference || typeof reference.elementId !== 'string' || typeof reference.pin !== 'string') {
          errors.push('Net "' + net.id + '" contains an invalid pin reference.');
          return;
        }
        var refKey = topologyReferenceKey(reference.elementId, reference.pin);
        var matches = pinsByReference[refKey];
        if (!matches || !matches.length) {
          errors.push('Net "' + net.id + '" refers to missing pin ' + reference.elementId + '.' + reference.pin + '.');
          return;
        }
        if (netSeen[refKey]) {
          errors.push('Pin ' + reference.elementId + '.' + reference.pin + ' appears more than once in net "' + net.id + '".');
          return;
        }
        netSeen[refKey] = true;
        if (Object.prototype.hasOwnProperty.call(assignments, refKey)) {
          errors.push('Pin ' + reference.elementId + '.' + reference.pin + ' is assigned to more than one topology entry.');
          return;
        }
        assignments[refKey] = net.id;
        physicalPins = physicalPins.concat(matches);
      });
      netPins.push(physicalPins);
    });

    topology.unconnectedPins.forEach(function (reference) {
      if (!reference || typeof reference.elementId !== 'string' || typeof reference.pin !== 'string') {
        errors.push('The topology contains an invalid intentionally-unused pin reference.');
        return;
      }
      var refKey = topologyReferenceKey(reference.elementId, reference.pin);
      var matches = pinsByReference[refKey];
      if (!matches || !matches.length) {
        errors.push('The topology marks missing pin ' + reference.elementId + '.' + reference.pin + ' as intentionally unused.');
        return;
      }
      if (Object.prototype.hasOwnProperty.call(assignments, refKey)) {
        errors.push('Pin ' + reference.elementId + '.' + reference.pin + ' is assigned to more than one topology entry.');
        return;
      }
      assignments[refKey] = null;
      matches.forEach(function (pin) {
        if (!isAdvisoryUnconnectedPin(pin.element, pin.sourcePinName)) {
          errors.push(
            'Required pin ' + pin.elementId + '.' + pin.pinName +
            ' cannot be intentionally left unconnected.',
          );
        } else {
          warnings.push(
            pin.elementId + '.' + pin.pinName + ' is intentionally unconnected.',
          );
        }
      });
    });

    Object.keys(pinsByReference).forEach(function (refKey) {
      if (!Object.prototype.hasOwnProperty.call(assignments, refKey)) {
        var pin = pinsByReference[refKey][0];
        errors.push('Pin ' + pin.elementId + '.' + pin.pinName + ' is missing from the topology.');
      }
    });

    Object.keys(elementsById).forEach(function (elementId) {
      var element = elementsById[elementId];
      if (element.type !== 'relay') return;
      var relayPins = pinsOf(element).map(function (pin, index) {
        return { name: topologyPinName(pin, index), refKey: topologyReferenceKey(elementId, topologyPinName(pin, index)) };
      });
      ['COIL1', 'COIL2', 'COM'].forEach(function (requiredName) {
        var requiredPin = relayPins.filter(function (pin) { return pin.name === requiredName; })[0];
        if (requiredPin && assignments[requiredPin.refKey] == null) {
          errors.push(elementId + '.' + requiredName + ' must be connected.');
        }
      });
      var hasContact = relayPins.some(function (pin) {
        return (pin.name === 'NC' || pin.name === 'NO') &&
          Object.prototype.hasOwnProperty.call(assignments, pin.refKey) &&
          assignments[pin.refKey] !== null;
      });
      if (!hasContact) errors.push(elementId + ' must connect at least one of NC or NO.');
    });

    var expectedGroups = [];
    topology.nets.forEach(function (net, netIndex) {
      var members = netPins[netIndex] || [];
      if (members.length) expectedGroups.push(members.map(function (pin) { return pin.refKey; }));
    });
    topology.unconnectedPins.forEach(function (reference) {
      if (!reference || typeof reference.elementId !== 'string' || typeof reference.pin !== 'string') return;
      var matches = pinsByReference[topologyReferenceKey(reference.elementId, reference.pin)] || [];
      matches.forEach(function (pin) { expectedGroups.push([pin.refKey]); });
    });

    return {
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      pinsByReference: pinsByReference,
      netPins: netPins,
      expectedGroups: expectedGroups
    };
  }

  function canonicalTopologyGroups(groups) {
    return groups.map(function (group) {
      return group.slice().sort();
    }).sort(function (left, right) {
      return JSON.stringify(left).localeCompare(JSON.stringify(right));
    });
  }

  function checkMaterializedTopology(spec, contract) {
    if (!contract || contract.errors.length) return [];
    var memberships;
    try {
      memberships = netlist(spec, true, true);
    } catch (_error) {
      return ['The generated wire geometry could not be compared with the declared topology.'];
    }
    var actualByNet = Object.create(null);
    memberships.pinMembership.forEach(function (member) {
      var element = spec.elements[member.elementIndex];
      if (!element || typeof element.id !== 'string') return;
      var referenceKey = topologyReferenceKey(element.id, member.pinName);
      if (!actualByNet[member.netKey]) actualByNet[member.netKey] = [];
      actualByNet[member.netKey].push(referenceKey);
    });
    var actualGroups = canonicalTopologyGroups(Object.keys(actualByNet).map(function (netKey) {
      return actualByNet[netKey];
    }));
    var expectedGroups = canonicalTopologyGroups(contract.expectedGroups);
    return JSON.stringify(actualGroups) === JSON.stringify(expectedGroups)
      ? []
      : ['The routed wires do not preserve the declared pin-to-net topology; a branch may be disconnected or two separate nets may have joined.'];
  }

  function topologyCrossings(spec) {
    var wires = [];
    spec.elements.forEach(function (element, index) {
      if (!element || element.type !== 'wire' || !Array.isArray(element.points)) return;
      for (var segmentIndex = 0; segmentIndex < element.points.length - 1; segmentIndex++) {
        wires.push({
          wireIndex: index,
          netId: element.netId,
          start: element.points[segmentIndex],
          end: element.points[segmentIndex + 1]
        });
      }
    });
    var markerMap = Object.create(null), errors = [];
    function record(point, type) {
      var pointKey = key(point[0], point[1]);
      if (!markerMap[pointKey]) markerMap[pointKey] = { point: point, type: type };
      else if (markerMap[pointKey].type !== type) {
        errors.push('The generated routes require both a junction and a non-connecting crossing at (' + point[0] + ', ' + point[1] + ').');
      }
    }
    function within(value, first, second) {
      return value >= Math.min(first, second) - 0.01 && value <= Math.max(first, second) + 0.01;
    }
    for (var firstIndex = 0; firstIndex < wires.length; firstIndex++) {
      for (var secondIndex = firstIndex + 1; secondIndex < wires.length; secondIndex++) {
        var first = wires[firstIndex], second = wires[secondIndex];
        var firstHorizontal = Math.abs(first.start[1] - first.end[1]) < 0.01;
        var secondHorizontal = Math.abs(second.start[1] - second.end[1]) < 0.01;
        if (firstHorizontal === secondHorizontal) continue;
        var horizontal = firstHorizontal ? first : second;
        var vertical = firstHorizontal ? second : first;
        var point = [vertical.start[0], horizontal.start[1]];
        if (!within(point[0], horizontal.start[0], horizontal.end[0]) ||
            !within(point[1], vertical.start[1], vertical.end[1])) continue;
        var firstInterior = pointOnRouteSegment(point, first.start, first.end);
        var secondInterior = pointOnRouteSegment(point, second.start, second.end);
        if (first.netId !== second.netId && (firstInterior || secondInterior) && !(firstInterior && secondInterior)) {
          errors.push('Routes for separate nets meet at an endpoint near (' + point[0] + ', ' + point[1] + ').');
          continue;
        }
        if (first.netId === second.netId && (firstInterior || secondInterior)) {
          record(point, 'junction');
        } else if (first.netId !== second.netId && firstInterior && secondInterior) {
          record(point, 'crossing');
        }
      }
    }
    var junctions = [], crossings = [];
    Object.keys(markerMap).forEach(function (pointKey) {
      var marker = markerMap[pointKey];
      if (marker.type === 'junction') junctions.push({ type: 'junction', id: 'J' + (junctions.length + 1), x: marker.point[0], y: marker.point[1] });
      else crossings.push({ type: 'crossing', id: 'X' + (crossings.length + 1), at: marker.point });
    });
    return { junctions: junctions, crossings: crossings, errors: [...new Set(errors)] };
  }

  function materializeTopology(spec, topology) {
    var contract = inspectTopologyContract(spec, topology);
    var base = JSON.parse(JSON.stringify(spec));
    base.elements = base.elements.filter(function (element) {
      return element && element.type !== 'wire' && element.type !== 'junction' && element.type !== 'crossing';
    });
    if (contract.errors.length) return { spec: base, errors: contract.errors, warnings: contract.warnings };

    var routeCount = contract.netPins.reduce(function (total, pins) {
      return total + Math.max(0, pins.length - 1);
    }, 0);
    if (routeCount > 300) {
      return {
        spec: base,
        errors: ['This topology has too many pin connections to route in one proposal. Split it into smaller sections.'],
        warnings: contract.warnings
      };
    }

    var usedIds = Object.create(null);
    base.elements.forEach(function (element) {
      if (element && typeof element.id === 'string') usedIds[element.id] = true;
    });
    function nextId(prefix) {
      var suffix = 1, candidate = prefix + suffix;
      while (usedIds[candidate]) candidate = prefix + (++suffix);
      usedIds[candidate] = true;
      return candidate;
    }

    var bodies = routeBodies(base), routeErrors = [];
    topology.nets.forEach(function (net, netIndex) {
      var members = contract.netPins[netIndex] || [];
      if (members.length < 2) return;
      members = members.slice().sort(function (left, right) {
        return left.refKey.localeCompare(right.refKey) ||
          left.point[0] - right.point[0] || left.point[1] - right.point[1];
      });
      var root = members[0], bestDistance = Infinity;
      members.forEach(function (candidate) {
        var distance = members.reduce(function (sum, other) {
          return sum + Math.abs(candidate.point[0] - other.point[0]) +
            Math.abs(candidate.point[1] - other.point[1]);
        }, 0);
        if (distance < bestDistance) {
          bestDistance = distance;
          root = candidate;
        }
      });

      members.forEach(function (target) {
        if (target === root || samePoint(root.point, target.point)) return;
        var route = findOrthogonalRoute(
          root.point,
          target.point,
          bodies,
          routeTapPoints(base, -1, root.point, target.point),
          routeWireSegments(base, -1),
        );
        if (!route || route.length < 2) {
          routeErrors.push(
            'Could not create a clear orthogonal route for net "' + net.id + '" between ' +
            root.elementId + '.' + root.pinName + ' and ' +
            target.elementId + '.' + target.pinName + '.',
          );
          return;
        }
        base.elements.push({
          type: 'wire',
          id: nextId('W'),
          netId: net.id,
          points: simplifyRoutePoints(route, [root.point, target.point])
        });
      });
    });
    if (routeErrors.length) return { spec: base, errors: [...new Set(routeErrors)], warnings: contract.warnings };

    var routed = autoRouteWiresAroundBodies(base).spec;
    var markers = topologyCrossings(routed);
    if (markers.errors.length) return { spec: base, errors: markers.errors, warnings: contract.warnings };
    markers.junctions.forEach(function (marker) {
      marker.id = nextId('J');
      routed.elements.push(marker);
    });
    markers.crossings.forEach(function (marker) {
      marker.id = nextId('X');
      routed.elements.push(marker);
    });

    var connectivityErrors = checkMaterializedTopology(routed, contract);
    if (connectivityErrors.length) return { spec: base, errors: connectivityErrors, warnings: contract.warnings };
    routed.elements.forEach(function (element) {
      if (element && element.type === 'wire') delete element.netId;
    });
    return { spec: routed, errors: [], warnings: contract.warnings };
  }

  function autoFix(spec) {
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.elements)) {
      return { spec: spec, changes: [] };
    }
    var fixed = JSON.parse(JSON.stringify(spec));
    var changes = [];

    function collectPins() {
      var pins = [];
      fixed.elements.forEach(function (element, index) {
        if (!element || element.type === 'wire' || element.type === 'junction' || element.type === 'label' || element.type === 'box') return;
        pinsOf(element).forEach(function (pin) {
          pins.push({ owner: elementName(element, index) + '.' + pin.n, point: pin.p });
        });
      });
      return pins;
    }

    var pinEntries = collectPins();
    var firstAnalysis = analyse(fixed);
    var looseWireKeys = {};
    firstAnalysis.freeEnds.forEach(function (entry) {
      if (entry.kind === 'wire') looseWireKeys[key(entry.point[0], entry.point[1])] = true;
    });

    fixed.elements.forEach(function (element) {
      if (!element || element.type !== 'wire' || element.open || !Array.isArray(element.points) || element.points.length < 2) return;
      [0, element.points.length - 1].forEach(function (pointIndex) {
        var point = element.points[pointIndex];
        if (!isPt(point) || !looseWireKeys[key(point[0], point[1])]) return;
        var nearby = pinEntries.filter(function (pin) {
          var dx = pin.point[0] - point[0], dy = pin.point[1] - point[1];
          return Math.sqrt(dx * dx + dy * dy) <= PIN_SNAP_TOLERANCE;
        });
        if (nearby.length !== 1) return;
        var target = nearby[0].point;
        if (key(point[0], point[1]) === key(target[0], target[1])) return;
        element.points[pointIndex] = [target[0], target[1]];
        changes.push('Snapped a wire endpoint to ' + nearby[0].owner + '.');
      });
    });

    var afterSnap = analyse(fixed);
    looseWireKeys = {};
    afterSnap.freeEnds.forEach(function (entry) {
      if (entry.kind === 'wire') looseWireKeys[key(entry.point[0], entry.point[1])] = true;
    });

    function isPositiveTerminal(element) {
      if (!element || element.type !== 'terminal') return false;
      return /^(?:\+\s*\d+(?:\.\d+)?\s*v?|vcc|vdd|v\+|power)$/i.test(String(element.label || element.value || '').trim());
    }
    function hasRailMarker(point) {
      return fixed.elements.some(function (element) {
        if (!element || (element.type !== 'ground' && !isPositiveTerminal(element))) return false;
        return isPt(element.at) && key(element.at[0], element.at[1]) === key(point[0], point[1]);
      });
    }
    function attachmentPoints(railIndex, rail, start, end) {
      var found = {};
      fixed.elements.forEach(function (element, index) {
        if (!element || index === railIndex) return;
        var points = [];
        if (element.type === 'wire' && Array.isArray(element.points)) {
          points = element.points.filter(isPt);
        } else if (element.type === 'junction' && isNum(element.x) && isNum(element.y)) {
          points = [[element.x, element.y]];
        } else if (element.type !== 'label' && element.type !== 'box') {
          points = pinsOf(element).map(function (pin) { return pin.p; });
        }
        points.forEach(function (point) {
          if (!onSegInterior(point[0], point[1], start, end)) return;
          found[key(point[0], point[1])] = point;
        });
      });
      return Object.keys(found).map(function (pointKey) { return found[pointKey]; });
    }
    function segmentParameter(point, start, end) {
      var dx = end[0] - start[0], dy = end[1] - start[1];
      var lengthSquared = dx * dx + dy * dy;
      return lengthSquared ? ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared : 0;
    }

    fixed.elements.forEach(function (element, index) {
      if (!element || element.type !== 'wire' || element.open || !Array.isArray(element.points) || element.points.length !== 2) return;
      var start = element.points[0], end = element.points[1];
      if (!isPt(start) || !isPt(end)) return;
      var dx = end[0] - start[0], dy = end[1] - start[1];
      var length = Math.sqrt(dx * dx + dy * dy);
      if ((dx !== 0 && dy !== 0) || length < 120) return;
      var startMarked = hasRailMarker(start), endMarked = hasRailMarker(end);
      if (startMarked === endMarked) return;
      var tail = startMarked ? end : start;
      if (!looseWireKeys[key(tail[0], tail[1])]) return;
      var attachments = attachmentPoints(index, element, start, end);
      if (attachments.length < 2) return;
      var values = attachments.map(function (point) {
        return { point: point, parameter: segmentParameter(point, start, end) };
      }).sort(function (left, right) { return left.parameter - right.parameter; });
      var target = startMarked ? values[values.length - 1] : values[0];
      if (!target || target.parameter <= 0.01 || target.parameter >= 0.99) return;
      var original = tail.slice();
      if (startMarked) element.points[1] = [target.point[0], target.point[1]];
      else element.points[0] = [target.point[0], target.point[1]];
      changes.push('Trimmed a dangling power/ground rail tail from (' + original[0] + ',' + original[1] + ') to (' + target.point[0] + ',' + target.point[1] + ').');
    });

    var routed = autoRouteWiresAroundBodies(fixed);
    fixed = routed.spec;
    changes = changes.concat(routed.changes);
    return { spec: fixed, changes: changes };
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
    return withTextRole('component-label', function () {
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
    });
  }

  function placeAt(lines, el) {
    return withTextRole('component-label', function () {
      var out = '', anchor = el.labelAnchor || 'start';
      for (var i = 0; i < lines.length; i++) {
        out += textEl(el.labelAt[0], el.labelAt[1] + i * 16, lines[i].s, anchor, lines[i].bold ? 14 : 12, lines[i].bold, lines[i].bold ? 'text' : 'muted');
      }
      return out;
    });
  }

  /* ---------- drawing ---------- */

  function drawTwo(el, parts) {
    var def = TWO[el.type], twoPins = pinsOf(el), a = twoPins[0].p, b = twoPins[1].p;
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
    var pins = pinsOf(el), base = pins.filter(function (pin) { return pin.n === 'B'; })[0].p;
    var collector = pins.filter(function (pin) { return pin.n === 'C'; })[0].p;
    var emitter = pins.filter(function (pin) { return pin.n === 'E'; })[0].p;
    if (el.circle !== false) s += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="44" stroke-width="0.5"/>';
    s += ln(base[0], y - 30, base[0], y + 30, ' stroke-width="3"');
    if (npn) {
      s += ln(base[0], y - 14, collector[0], collector[1]) + ln(base[0], y + 14, emitter[0], emitter[1], ARROW);
    } else {
      s += ln(base[0], y + 14, collector[0], collector[1]) + ln(emitter[0], emitter[1], base[0] + (el.flip ? -1 : 1), y - 14.6, ARROW);
    }
    parts.comp += s;
    var lines = linesOf(el);
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    var lx = x + 10 * (el.flip ? -1 : 1), ly = y + 62;
    parts.text += withTextRole('component-label', function () {
      var text = '';
      for (var i = 0; i < lines.length; i++) {
        text += textEl(lx + (el.labelNudge ? el.labelNudge[0] : 0), ly + i * 16 + (el.labelNudge ? el.labelNudge[1] : 0),
          lines[i].s, el.flip ? 'start' : 'end', lines[i].bold ? 14 : 12, lines[i].bold, lines[i].bold ? 'text' : 'muted');
      }
      return text;
    });
  }

  function drawOpamp(el, parts) {
    var x = el.at[0], y = el.at[1], pins = pinsOf(el);
    var inv = pins.filter(function (pin) { return pin.n === 'INV'; })[0].p;
    var noninv = pins.filter(function (pin) { return pin.n === 'NONINV'; })[0].p;
    var out = pins.filter(function (pin) { return pin.n === 'OUT'; })[0].p;
    parts.comp += '<polygon points="' + f(inv[0]) + ',' + f(y - 40) + ' ' + f(inv[0]) + ',' + f(y + 40) + ' ' + f(out[0]) + ',' + f(out[1]) + '"/>';
    parts.text += textEl(inv[0] + 7, inv[1] + 4, '\u2212', 'start', 14, false, 'text') + textEl(noninv[0] + 7, noninv[1] + 4, '+', 'start', 14, false, 'text');
    var lines = linesOf(el);
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x - 5, y - 40, el.labelPos || 'above', 6, el.labelNudge);
  }

  function drawPotentiometer(el, parts) {
    var x = el.at[0], y = el.at[1];
    parts.comp += '<rect x="' + f(x - 20) + '" y="' + f(y - 10) + '" width="40" height="20"/>' +
      ln(x - 44, y, x - 20, y) + ln(x + 20, y, x + 44, y) +
      ln(x, y - 52, x, y - 15, ARROW);
    var lines = linesOf(el);
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y - 10, el.labelPos || 'above', 18, el.labelNudge);
  }

  function drawFieldEffectTransistor(el, parts) {
    var x = el.at[0], y = el.at[1], mirror = el.flip ? -1 : 1;
    var typeIsP = el.type === 'pmos' || el.type === 'pjfet' || (el.type === 'mosfet' && el.channel === 'p');
    var symbol = '<g transform="translate(' + f(x) + ' ' + f(y) + ') scale(' + mirror + ' 1)">' +
      ln(-40, 0, -12, 0) + ln(-12, -27, -12, 27, ' stroke-width="3"') +
      ln(0, -25, 0, 25, ' stroke-width="3"') +
      ln(20, -40, 20, -25) + ln(20, -25, 4, -25) +
      ln(20, 40, 20, 25) + ln(20, 25, 4, 25) +
      ln(-4, -13, 0, -13, typeIsP ? ARROW : '') + '</g>';
    parts.comp += symbol;
    var lines = linesOf(el);
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y + 48, el.labelPos || 'below', 8, el.labelNudge);
  }

  function drawRegulator(el, parts) {
    var x = el.at[0], y = el.at[1];
    parts.comp += '<rect x="' + f(x - 28) + '" y="' + f(y - 22) + '" width="56" height="44"/>' +
      ln(x - 50, y, x - 28, y) + ln(x + 28, y, x + 50, y) + ln(x, y + 22, x, y + 50);
    parts.text += textEl(x, y + 4, 'REG', 'middle', 10, true, 'text');
    var lines = linesOf(el);
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y - 22, el.labelPos || 'above', 5, el.labelNudge);
  }

  function drawTransformer(el, parts) {
    var x = el.at[0], y = el.at[1], coils = '';
    for (var i = 0; i < 3; i++) {
      var cy = y - 24 + i * 16;
      coils += '<path d="M' + f(x - 18) + ' ' + f(cy) + ' a8 8 0 0 1 16 0"/>' +
        '<path d="M' + f(x + 18) + ' ' + f(cy) + ' a8 8 0 0 0 -16 0"/>';
    }
    parts.comp += coils + ln(x - 2, y - 43, x - 2, y + 43) + ln(x + 2, y - 43, x + 2, y + 43);
    parts.comp += '<circle cx="' + f(x - 31) + '" cy="' + f(y - 30) + '" r="2.5" fill="' + T.stroke + '"/>' +
      '<circle cx="' + f(x + 31) + '" cy="' + f(y - 30) + '" r="2.5" fill="' + T.stroke + '"/>';
    var lines = linesOf(el);
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y + 52, el.labelPos || 'below', 8, el.labelNudge);
  }

  function drawRelay(el, parts) {
    var x = el.at[0], y = el.at[1];
    parts.comp += '<rect x="' + f(x - 36) + '" y="' + f(y - 28) + '" width="70" height="56" rx="3"/>' +
      '<path d="M' + f(x - 24) + ' ' + f(y - 10) + ' q12 -18 24 0 t24 0"/>' +
      ln(x + 34, y, x + 45, y) + ln(x + 45, y, x + 55, y - 30) +
      ln(x + 45, y, x + 55, y + 30);
    parts.comp += '<circle cx="' + f(x + 45) + '" cy="' + f(y) + '" r="2.5" fill="' + T.stroke + '"/>' +
      '<circle cx="' + f(x + 55) + '" cy="' + f(y - 30) + '" r="2.5" fill="' + T.stroke + '"/>' +
      '<circle cx="' + f(x + 55) + '" cy="' + f(y + 30) + '" r="2.5" fill="' + T.stroke + '"/>';
    var lines = linesOf(el);
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y - 32, el.labelPos || 'above', 7, el.labelNudge);
  }

  function drawBridge(el, parts) {
    var x = el.at[0], y = el.at[1];
    parts.comp += '<polygon points="' + f(x) + ',' + f(y - 30) + ' ' + f(x + 30) + ',' + f(y) + ' ' +
      f(x) + ',' + f(y + 30) + ' ' + f(x - 30) + ',' + f(y) + '"/>' +
      '<path d="M' + f(x - 14) + ' ' + f(y - 8) + ' l12 0 l-6 -6 z M' + f(x + 14) + ' ' + f(y + 8) +
      ' l-12 0 l6 6 z M' + f(x - 8) + ' ' + f(y + 14) + ' l0 -12 l-6 6 z M' + f(x + 8) + ' ' + f(y - 14) + ' l0 12 l6 -6 z"/>';
    var lines = linesOf(el);
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y - 34, el.labelPos || 'above', 7, el.labelNudge);
  }

  function drawOptocoupler(el, parts) {
    var x = el.at[0], y = el.at[1];
    parts.comp += '<rect x="' + f(x - 34) + '" y="' + f(y - 30) + '" width="68" height="60" rx="4"/>' +
      ln(x, y - 28, x, y + 28, ' stroke-dasharray="4 3"') +
      ln(x - 26, y - 12, x - 10, y - 12) + ln(x - 26, y + 12, x - 10, y + 12) +
      ln(x - 10, y - 20, x - 10, y + 20) +
      '<path d="M' + f(x + 8) + ' ' + f(y - 18) + ' l14 12 l-14 12 z"/>' +
      ln(x + 22, y - 18, x + 22, y + 6) + ln(x + 22, y - 15, x + 30, y - 24, ARROW);
    var lines = linesOf(el);
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, x, y - 34, el.labelPos || 'above', 8, el.labelNudge);
  }

  function drawPinBlock(el, parts) {
    var x = el.at[0], y = el.at[1];
    var left = el.pins.filter(function (pin) { return pin.side === 'left'; });
    var right = el.pins.filter(function (pin) { return pin.side === 'right'; });
    var height = Math.max(48, Math.max(left.length, right.length) * 24 + 16);
    parts.comp += '<rect x="' + f(x - 44) + '" y="' + f(y - height / 2) + '" width="88" height="' + f(height) + '"/>';
    pinsOf(el).forEach(function (pin) {
      var leftSide = el.pins.filter(function (item) { return item.side === 'left'; });
      var index = leftSide.findIndex(function (item) { return item.name === pin.n; });
      var side = index >= 0 ? 'left' : 'right';
      var group = side === 'left' ? left : right;
      index = group.findIndex(function (item) { return item.name === pin.n; });
      var offsetY = (index - (group.length - 1) / 2) * 24;
      var pinX = x + (side === 'left' ? -64 : 64);
      parts.comp += ln(pinX, y + offsetY, x + (side === 'left' ? -44 : 44), y + offsetY);
      parts.text += withTextRole('pin-label', function () {
        return textEl(x + (side === 'left' ? -48 : 48), y + offsetY + 3, pin.n, side === 'left' ? 'end' : 'start', 9, false, 'muted');
      });
    });
    if (el.value) parts.text += withTextRole('component-label', function () {
      return textEl(x, y + 4, el.value, 'middle', 11, true, 'text');
    });
    if (el.label) parts.text += withTextRole('component-label', function () {
      return textEl(x, y + height / 2 + 17, el.label, 'middle', 11, true, 'text');
    });
  }

  function kicadArcPath(points) {
    var a = points[0], m = points[1], b = points[2];
    var determinant = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
    if (Math.abs(determinant) < 0.001) {
      var controlX = 2 * m[0] - (a[0] + b[0]) / 2;
      var controlY = 2 * m[1] - (a[1] + b[1]) / 2;
      return 'M' + f(a[0]) + ' ' + f(a[1]) + ' Q' + f(controlX) + ' ' + f(controlY) + ' ' + f(b[0]) + ' ' + f(b[1]);
    }
    var aa = a[0] * a[0] + a[1] * a[1];
    var mm = m[0] * m[0] + m[1] * m[1];
    var bb = b[0] * b[0] + b[1] * b[1];
    var centerX = (aa * (m[1] - b[1]) + mm * (b[1] - a[1]) + bb * (a[1] - m[1])) / determinant;
    var centerY = (aa * (b[0] - m[0]) + mm * (a[0] - b[0]) + bb * (m[0] - a[0])) / determinant;
    var radius = Math.sqrt(Math.pow(a[0] - centerX, 2) + Math.pow(a[1] - centerY, 2));
    var tau = Math.PI * 2;
    function angle(point) { return Math.atan2(point[1] - centerY, point[0] - centerX); }
    function positiveAngle(value) { return (value % tau + tau) % tau; }
    var start = angle(a), middle = angle(m), end = angle(b);
    var clockwiseSpan = positiveAngle(end - start);
    var middleClockwise = positiveAngle(middle - start);
    var sweep = middleClockwise <= clockwiseSpan + 0.001 ? 1 : 0;
    var span = sweep ? clockwiseSpan : positiveAngle(start - end);
    return 'M' + f(a[0]) + ' ' + f(a[1]) + ' A' + f(radius) + ' ' + f(radius) + ' 0 ' +
      (span > Math.PI ? 1 : 0) + ' ' + sweep + ' ' + f(b[0]) + ' ' + f(b[1]);
  }

  function drawKicadGraphic(graphic) {
    var points = Array.isArray(graphic.points) ? graphic.points : [];
    var fill = graphic.fillType === 'background' ? (T.background || '#fff') : 'none';
    var width = isNum(graphic.strokeWidth) ? Math.max(0, graphic.strokeWidth) : T.lineWidth;
    var style = ' stroke-width="' + f(width) + '" fill="' + esc(fill) + '"';
    if (graphic.type === 'polyline' || graphic.type === 'bezier') {
      if (points.length < 2) return '';
      var path = '';
      if (graphic.type === 'bezier' && points.length === 4) {
        path = 'M' + f(points[0][0]) + ' ' + f(points[0][1]) +
          ' C' + f(points[1][0]) + ' ' + f(points[1][1]) + ' ' +
          f(points[2][0]) + ' ' + f(points[2][1]) + ' ' + f(points[3][0]) + ' ' + f(points[3][1]);
      } else {
        path = 'M' + f(points[0][0]) + ' ' + f(points[0][1]);
        for (var p = 1; p < points.length; p++) path += ' L' + f(points[p][0]) + ' ' + f(points[p][1]);
      }
      if (graphic.closed) path += ' Z';
      return '<path d="' + path + '"' + style + '/>';
    }
    if (graphic.type === 'rectangle' && points.length >= 2) {
      var x = Math.min(points[0][0], points[1][0]), y = Math.min(points[0][1], points[1][1]);
      return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(Math.abs(points[1][0] - points[0][0])) +
        '" height="' + f(Math.abs(points[1][1] - points[0][1])) + '"' + style + '/>';
    }
    if (graphic.type === 'circle' && points.length && isNum(graphic.radius) && graphic.radius >= 0) {
      return '<circle cx="' + f(points[0][0]) + '" cy="' + f(points[0][1]) + '" r="' +
        f(graphic.radius) + '"' + style + '/>';
    }
    if (graphic.type === 'arc' && points.length >= 3) {
      return '<path d="' + kicadArcPath(points) + '"' + style + '/>';
    }
    if (graphic.type === 'text' && points.length && typeof graphic.text === 'string') {
      var size = isNum(graphic.fontSize) ? Math.max(1, graphic.fontSize) : 12;
      return '<text x="' + f(points[0][0]) + '" y="' + f(points[0][1]) + '" text-anchor="middle"' +
        ' dominant-baseline="middle" font-size="' + f(size) + '" fill="' + esc(T.text) +
        '" stroke="none">' + esc(graphic.text) + '</text>';
    }
    return '';
  }

  function drawKicadPin(pin, el, parts) {
    var point = pin.point, bodyPoint = pin.bodyPoint;
    if (!isPt(point) || !isPt(bodyPoint)) return;
    var dx = bodyPoint[0] - point[0], dy = bodyPoint[1] - point[1];
    var length = Math.sqrt(dx * dx + dy * dy);
    var ux = length > 0.001 ? dx / length : 1, uy = length > 0.001 ? dy / length : 0;
    var worldPoint = transformKicadPoint(point, el);
    var worldDirection = transformKicadPoint([point[0] + ux, point[1] + uy], el);
    var worldUx = worldDirection[0] - worldPoint[0];
    var marker = '';
    if (length > 0.001) marker += ln(point[0], point[1], bodyPoint[0], bodyPoint[1]);
    var shape = typeof pin.shape === 'string' ? pin.shape : '';
    if (/inverted/.test(shape)) {
      marker += '<circle cx="' + f(bodyPoint[0]) + '" cy="' + f(bodyPoint[1]) +
        '" r="4" fill="' + esc(T.background || '#fff') + '"/>';
    }
    if (/clock/.test(shape)) {
      var tipX = bodyPoint[0] + ux * 8, tipY = bodyPoint[1] + uy * 8;
      var baseX = bodyPoint[0] - ux * 3, baseY = bodyPoint[1] - uy * 3;
      var perpendicularX = -uy * 5, perpendicularY = ux * 5;
      marker += '<path d="M' + f(tipX) + ' ' + f(tipY) + ' L' + f(baseX + perpendicularX) + ' ' +
        f(baseY + perpendicularY) + ' L' + f(baseX - perpendicularX) + ' ' +
        f(baseY - perpendicularY) + ' Z" fill="' + esc(T.background || '#fff') + '"/>';
    }
    if (marker) parts.comp += '<g transform="' + kicadTransform(el) + '">' + marker + '</g>';

    var anchor = worldUx > 0.25 ? 'start' : worldUx < -0.25 ? 'end' : 'middle';
    if (pin.showNumber && pin.number) {
      var numberPoint = transformKicadPoint([point[0] - ux * 8, point[1] - uy * 8], el);
      parts.text += textEl(numberPoint[0], numberPoint[1] + 3, pin.number, anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : 'middle', 8, false, 'muted');
    }
    if (pin.showName && pin.name) {
      var namePoint = transformKicadPoint([bodyPoint[0] + ux * 5, bodyPoint[1] + uy * 5], el);
      parts.text += textEl(namePoint[0], namePoint[1] + 3, pin.name, anchor, 9, false, 'text');
    }
  }

  function drawKicadSymbol(el, parts) {
    var unit = kicadUnitOf(el);
    if (!unit) return;
    var drawing = (unit.graphics || []).map(drawKicadGraphic).join('');
    parts.comp += '<g transform="' + kicadTransform(el) + '">' + drawing + '</g>';
    (unit.pins || []).forEach(function (pin) {
      withTextRole('pin-label', function () { drawKicadPin(pin, el, parts); });
    });

    var lines = linesOf(el);
    if (!lines.length) return;
    if (el.labelAt) { parts.text += placeAt(lines, el); return; }
    parts.text += placeLabel(lines, el.at[0], el.at[1], el.labelPos || 'above', 8, el.labelNudge);
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
    var pin = pinsOf(el)[0].p;
    var x = pin[0], y = pin[1], lines = linesOf(el), pos, px = x, py = y, d = 8;
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

  function render(spec, opts, layoutBoxes) {
    var a = analyse(spec);
    if (a.errors.length && !(opts && opts.allowStructuralErrors === true)) {
      throw new Error('Invalid circuit spec:\n- ' + a.errors.join('\n- '));
    }

    T = {};
    [DEFAULT_THEME, spec.theme || {}, opts || {}].forEach(function (src) { for (var k in src) T[k] = src[k]; });

    var parts = { box: '', wire: '', comp: '', text: '' };
    WIRESEGS = []; TEXTBOX = [];
    spec.elements.forEach(function (el, index) {
      if (el.type === 'wire') {
        for (var i = 0; i < el.points.length - 1; i++) {
          WIRESEGS.push([el.points[i], el.points[i + 1], elementName(el, index)]);
        }
      }
    });

    spec.elements.forEach(function (el, index) {
      var t = el.type;
      TEXTOWNER = elementName(el, index);
      TEXTROLE = 'symbol-text';
      if (t === 'box') {
        parts.box += '<rect x="' + f(el.x) + '" y="' + f(el.y) + '" width="' + f(el.w) + '" height="' + f(el.h) +
          '" rx="8" stroke="' + T.muted + '" stroke-width="0.8" stroke-dasharray="6 4"/>';
        if (el.label) parts.text += withTextRole('annotation-label', function () {
          return textEl(el.x + 14, el.y + 22, el.label, 'start', 14, true, 'text');
        });
      } else if (t === 'wire') {
        parts.wire += '<polyline points="' + el.points.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '"/>';
      } else if (t === 'label') {
        var lsz = el.size || 14;
        parts.text += withTextRole('annotation-label', function () {
          return textEl(el.at[0], el.at[1], el.text, el.anchor || 'start', lsz, el.bold !== undefined ? !!el.bold : lsz >= 14, el.muted ? 'muted' : 'text');
        });
      } else if (t === 'crossing') {
        // Keep the saved non-connection annotation; the wires themselves stay continuous.
      } else if (t === 'kicad') { drawKicadSymbol(el, parts);
      } else if (TWO[t]) { drawTwo(el, parts);
      } else if (t === 'npn' || t === 'pnp') { drawTransistor(el, parts);
      } else if (t === 'nmos' || t === 'pmos' || t === 'mosfet' || t === 'njfet' || t === 'pjfet') { drawFieldEffectTransistor(el, parts);
      } else if (t === 'potentiometer') { drawPotentiometer(el, parts);
      } else if (t === 'opamp' || t === 'comparator') { drawOpamp(el, parts);
      } else if (t === 'regulator') { drawRegulator(el, parts);
      } else if (t === 'transformer') { drawTransformer(el, parts);
      } else if (t === 'relay') { drawRelay(el, parts);
      } else if (t === 'bridge') { drawBridge(el, parts);
      } else if (t === 'opto') { drawOptocoupler(el, parts);
      } else if (t === 'ic' || t === 'connector') { drawPinBlock(el, parts);
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

    if (Array.isArray(layoutBoxes)) {
      TEXTBOX.forEach(function (box) { layoutBoxes.push(box); });
    }
    TEXTBOX = null;
    TEXTOWNER = '';
    TEXTROLE = 'symbol-text';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + vx + ' ' + vy + ' ' + W + ' ' + H +
      '" preserveAspectRatio="xMidYMid meet" font-family="' + esc(T.font) + '">' +
      '<title>' + esc(spec.title || 'Circuit schematic') + '</title>' +
      '<defs><marker id="cd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M2 1L8 5L2 9" fill="none" stroke="' + T.stroke + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>' +
      (T.background ? '<rect x="' + vx + '" y="' + vy + '" width="' + W + '" height="' + H + '" fill="' + T.background + '"/>' : '') +
      '<g fill="none" stroke="' + T.stroke + '" stroke-width="' + T.lineWidth + '" stroke-linecap="round" stroke-linejoin="round">' +
      parts.box + parts.wire + parts.comp + '</g>' +
      '<g fill="' + T.stroke + '" stroke="none">' + dots + '</g>' +
      '<g>' + parts.text + '</g></svg>';
  }

  var TWO_BODY_BOUNDS = {
    resistor: [-25, -10, 25, 10],
    capacitor: [-6, -14, 6, 14],
    electrolytic: [-16, -14, 9, 14],
    inductor: [-32, -8, 32, 8],
    diode: [-10, -10, 10, 10],
    zener: [-10, -14, 14, 14],
    led: [-10, -24, 15, 10],
    battery: [-15, -14, 5, 14],
    switch: [-18, -16, 18, 3],
    mic: [-18, -18, 18, 18],
    speaker: [-8, -18, 16, 18],
    lamp: [-14, -14, 14, 14],
    acsource: [-16, -16, 16, 16],
    crystal: [-9, -13, 9, 13],
    fuse: [-18, -9, 18, 9],
    thermistor: [-25, -15, 25, 15],
    photoresistor: [-31, -27, 25, 20],
    varistor: [-25, -17, 25, 17],
    photodiode: [-24, -29, 10, 10],
    schottky: [-10, -10, 15, 10],
    dcsource: [-21, -21, 21, 21],
    currentsource: [-21, -21, 21, 21],
    motor: [-22, -22, 22, 22],
    buzzer: [-33, -22, 33, 22],
    solarcell: [-24, -27, 22, 15]
  };

  var MULTI_BODY_BOUNDS = {
    npn: [-44, -44, 44, 44],
    pnp: [-44, -44, 44, 44],
    opamp: [-40, -40, 40, 40],
    comparator: [-40, -40, 40, 40],
    potentiometer: [-20, -52, 20, 10],
    nmos: [-20, -40, 20, 40],
    pmos: [-20, -40, 20, 40],
    mosfet: [-20, -40, 20, 40],
    njfet: [-20, -40, 20, 40],
    pjfet: [-20, -40, 20, 40],
    regulator: [-28, -22, 28, 22],
    transformer: [-31, -43, 31, 43],
    relay: [-36, -30, 55, 30],
    bridge: [-30, -30, 30, 30],
    opto: [-34, -30, 34, 30]
  };

  function boundsFromPoints(points, padding) {
    if (!points.length) return null;
    var bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    points.forEach(function (point) {
      if (!isPt(point)) return;
      bounds.x0 = Math.min(bounds.x0, point[0]);
      bounds.y0 = Math.min(bounds.y0, point[1]);
      bounds.x1 = Math.max(bounds.x1, point[0]);
      bounds.y1 = Math.max(bounds.y1, point[1]);
    });
    if (!isFinite(bounds.x0)) return null;
    var pad = padding || 0;
    return { x0: bounds.x0 - pad, y0: bounds.y0 - pad, x1: bounds.x1 + pad, y1: bounds.y1 + pad };
  }

  function localBoundsAt(element, localBounds) {
    if (!isPt(element.at) || !localBounds) return null;
    return {
      x0: element.at[0] + localBounds[0],
      y0: element.at[1] + localBounds[1],
      x1: element.at[0] + localBounds[2],
      y1: element.at[1] + localBounds[3]
    };
  }

  function kicadBodyBounds(element) {
    var unit = kicadUnitOf(element);
    if (!unit) return null;
    var points = [];
    (unit.graphics || []).forEach(function (graphic) {
      var graphicPoints = Array.isArray(graphic.points) ? graphic.points : [];
      graphicPoints.forEach(function (point) {
        if (isPt(point)) points.push(transformKicadPoint(point, element));
      });
      if (graphic.type === 'circle' && graphicPoints.length && isNum(graphic.radius)) {
        var center = transformKicadPoint(graphicPoints[0], element);
        points.push([center[0] - graphic.radius, center[1] - graphic.radius]);
        points.push([center[0] + graphic.radius, center[1] + graphic.radius]);
      } else if (graphic.type === 'text' && graphicPoints.length && typeof graphic.text === 'string') {
        var size = isNum(graphic.fontSize) ? Math.max(1, graphic.fontSize) : 12;
        var textPoint = transformKicadPoint(graphicPoints[0], element);
        var width = graphic.text.length * size * 0.6;
        points.push([textPoint[0] - width / 2, textPoint[1] - size / 2]);
        points.push([textPoint[0] + width / 2, textPoint[1] + size / 2]);
      }
    });
    if (!points.length) {
      (unit.pins || []).forEach(function (pin) {
        if (isPt(pin.bodyPoint)) points.push(transformKicadPoint(pin.bodyPoint, element));
      });
    }
    return boundsFromPoints(points, 4);
  }

  function componentBodyBounds(element, index) {
    if (!element || OTHER[element.type] || element.type === 'box') return null;
    if (TWO[element.type]) {
      var pins = pinsOf(element);
      var localBounds = TWO_BODY_BOUNDS[element.type];
      if (pins.length < 2 || !localBounds) return null;
      var a = pins[0].p, b = pins[1].p;
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var angle = Math.atan2(dy, dx), cos = Math.cos(angle), sin = Math.sin(angle);
      var middle = Math.sqrt(dx * dx + dy * dy) / 2;
      var localCorners = [
        [localBounds[0], localBounds[1]],
        [localBounds[0], localBounds[3]],
        [localBounds[2], localBounds[1]],
        [localBounds[2], localBounds[3]]
      ];
      return boundsFromPoints(localCorners.map(function (point) {
        var localX = middle + point[0], localY = point[1];
        return [
          a[0] + localX * cos - localY * sin,
          a[1] + localX * sin + localY * cos
        ];
      }), 0);
    }
    if (element.type === 'kicad') return kicadBodyBounds(element);
    if (element.type === 'ground' && isPt(element.at)) {
      return localBoundsAt(element, [-12, 0, 12, 20]);
    }
    if (element.type === 'antenna' && isPt(element.at)) {
      var height = isNum(element.height) ? element.height : 55;
      return localBoundsAt(element, [-12, -height, 12, 0]);
    }
    if (element.type === 'terminal' && isPt(element.at)) {
      return localBoundsAt(element, [-4, -4, 4, 4]);
    }
    if ((element.type === 'npn' || element.type === 'pnp') && element.circle === false) {
      return localBoundsAt(element, [-25, -30, 25, 30]);
    }
    if (MULTI_BODY_BOUNDS[element.type]) {
      return localBoundsAt(element, MULTI_BODY_BOUNDS[element.type]);
    }
    if (element.type === 'ic' || element.type === 'connector') {
      var componentPins = Array.isArray(element.pins) ? element.pins : [];
      var leftCount = componentPins.filter(function (pin) { return pin.side === 'left'; }).length;
      var rightCount = componentPins.filter(function (pin) { return pin.side === 'right'; }).length;
      var height = Math.max(48, Math.max(leftCount, rightCount) * 24 + 16);
      return localBoundsAt(element, [-44, -height / 2, 44, height / 2]);
    }
    return null;
  }

  function wireCrossesBody(segment, bounds) {
    var a = segment[0], b = segment[1];
    if (Math.abs(a[1] - b[1]) < 0.001) {
      return a[1] > bounds.y0 + 2 && a[1] < bounds.y1 - 2 &&
        Math.min(Math.max(a[0], b[0]), bounds.x1) -
          Math.max(Math.min(a[0], b[0]), bounds.x0) > 4;
    }
    if (Math.abs(a[0] - b[0]) < 0.001) {
      return a[0] > bounds.x0 + 2 && a[0] < bounds.x1 - 2 &&
        Math.min(Math.max(a[1], b[1]), bounds.y1) -
          Math.max(Math.min(a[1], b[1]), bounds.y0) > 4;
    }
    return false;
  }

  function segmentEndsAtPin(segment, pins) {
    return pins.some(function (pin) {
      return key(pin[0], pin[1]) === key(segment[0][0], segment[0][1]) ||
        key(pin[0], pin[1]) === key(segment[1][0], segment[1][1]);
    });
  }

  function layoutWarnings(spec) {
    var boxes = [];
    try {
      render(spec, { allowStructuralErrors: true }, boxes);
    } catch (_error) {
      TEXTBOX = null;
      TEXTOWNER = '';
      TEXTROLE = 'symbol-text';
      return [];
    }

    var warnings = [], seen = {};
    function addWarning(message) {
      if (seen[message] || warnings.length >= 12) return;
      seen[message] = true;
      warnings.push(message);
    }
    function overlaps(a, b) {
      return Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 2 &&
        Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 2;
    }
    var componentBoxes = [];
    spec.elements.forEach(function (element, index) {
      var bounds = componentBodyBounds(element, index);
      if (bounds) {
        componentBoxes.push({
          bounds: bounds,
          owner: elementName(element, index),
          pins: pinsOf(element).map(function (pin) { return pin.p; })
        });
      }
    });
    // Body crossings are blocking-quality issues, so report them before lower-priority spacing notes.
    WIRESEGS.forEach(function (segment) {
      componentBoxes.forEach(function (component) {
        if (!segmentEndsAtPin(segment, component.pins) && wireCrossesBody(segment, component.bounds)) {
          addWarning('Visual layout issue: ' + (segment[2] || 'a wire') + ' crosses the symbol body for ' + component.owner + '; reroute the wire outside the symbol.');
        }
      });
    });
    for (var bodyIndex = 0; bodyIndex < componentBoxes.length; bodyIndex++) {
      for (var otherIndex = bodyIndex + 1; otherIndex < componentBoxes.length; otherIndex++) {
        var firstBody = componentBoxes[bodyIndex], secondBody = componentBoxes[otherIndex];
        var overlapX = Math.min(firstBody.bounds.x1, secondBody.bounds.x1) -
          Math.max(firstBody.bounds.x0, secondBody.bounds.x0);
        var overlapY = Math.min(firstBody.bounds.y1, secondBody.bounds.y1) -
          Math.max(firstBody.bounds.y0, secondBody.bounds.y0);
        if (overlapX > 2 && overlapY > 2) {
          addWarning('Visual layout issue: symbol bodies for ' + firstBody.owner + ' and ' + secondBody.owner + ' overlap; reposition the symbols and reroute their wires.');
          continue;
        }
        var gapX = Math.max(0, -overlapX), gapY = Math.max(0, -overlapY);
        var clearance = Math.sqrt(gapX * gapX + gapY * gapY);
        if (clearance < 12) {
          addWarning('Visual layout issue: symbol bodies for ' + firstBody.owner + ' and ' + secondBody.owner + ' are too close; leave at least 12 px of clear space between them.');
        }
      }
    }
    for (var i = 0; i < boxes.length; i++) {
      for (var j = i + 1; j < boxes.length; j++) {
        var first = boxes[i], second = boxes[j];
        var sameOwner = first.owner === second.owner;
        if (sameOwner && first.role !== 'component-label' && second.role !== 'component-label') continue;
        if (!overlaps(first, second)) continue;
        if (sameOwner) {
          addWarning('Visual layout issue: text for ' + first.owner + ' overlaps other text on the same element; move the label away from its symbol or pins.');
        } else {
          addWarning('Visual layout issue: text for ' + first.owner + ' overlaps text for ' + second.owner + '; reposition a component or label.');
        }
      }
    }

    WIRESEGS.forEach(function (segment) {
      var a = segment[0], b = segment[1], wireName = segment[2] || 'a wire';
      boxes.forEach(function (box) {
        var crossesText = false;
        if (Math.abs(a[1] - b[1]) < 0.001) {
          var y = a[1];
          crossesText = y >= box[1] - 2 && y <= box[3] + 2 &&
            Math.min(Math.max(a[0], b[0]), box[2]) - Math.max(Math.min(a[0], b[0]), box[0]) > 6;
        } else if (Math.abs(a[0] - b[0]) < 0.001) {
          var x = a[0];
          crossesText = x >= box[0] - 2 && x <= box[2] + 2 &&
            Math.min(Math.max(a[1], b[1]), box[3]) - Math.max(Math.min(a[1], b[1]), box[1]) > 6;
        }
        if (crossesText) {
          addWarning('Visual layout issue: ' + wireName + ' crosses text for ' + box.owner + '; reroute the wire or move the label.');
        }
      });
    });

    return warnings;
  }


  /* ---------- build sheet: parts list + nets, for rebuilding in another tool ---------- */

  var NICE = { resistor: 'Resistor', capacitor: 'Capacitor', electrolytic: 'Electrolytic capacitor', inductor: 'Inductor / coil',
    diode: 'Diode', zener: 'Zener diode', led: 'LED', battery: 'Battery', switch: 'Switch', mic: 'Microphone', speaker: 'Speaker',
    lamp: 'Lamp', acsource: 'AC source', crystal: 'Crystal', fuse: 'Fuse', thermistor: 'Thermistor',
    photoresistor: 'Photoresistor', varistor: 'Varistor', photodiode: 'Photodiode', schottky: 'Schottky diode',
    dcsource: 'DC voltage source', currentsource: 'Current source', motor: 'DC motor', buzzer: 'Buzzer',
    solarcell: 'Solar cell', npn: 'NPN transistor', pnp: 'PNP transistor', nmos: 'N-channel MOSFET',
    pmos: 'P-channel MOSFET', mosfet: 'MOSFET', njfet: 'N-channel JFET', pjfet: 'P-channel JFET',
    potentiometer: 'Potentiometer', regulator: 'Voltage regulator', comparator: 'Comparator',
    transformer: 'Transformer', relay: 'Relay', bridge: 'Bridge rectifier', opto: 'Optocoupler',
    ic: 'Integrated circuit', connector: 'Connector', kicad: 'KiCad library symbol',
    opamp: 'Op-amp', antenna: 'Antenna (a plain wire)' };

  function netlist(spec, allowStructuralErrors, includeMembership) {
    var rep = analyse(spec);
    if (rep.errors.length && !allowStructuralErrors) throw new Error('Invalid circuit spec:\n- ' + rep.errors.join('\n- '));
    var parent = {};
    function find(k) { if (parent[k] === undefined) parent[k] = k; while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

    var segs = [], wirePts = [], pins = [], junctions = [], parts = [], auto = 0;
    spec.elements.forEach(function (el, elementIndex) {
      if (el.type === 'wire') {
        el.points.forEach(function (p) { wirePts.push(p); });
        for (var i = 0; i < el.points.length - 1; i++) segs.push([el.points[i], el.points[i + 1]]);
      } else if (el.type === 'junction') {
        junctions.push([el.x, el.y]);
      } else if (el.type !== 'label' && el.type !== 'box') {
        var des = el.label || el.id;
        var isPart = !!NICE[el.type];
        if (isPart && !des) des = el.type.toUpperCase().slice(0, 1) + '?' + (++auto);
        pinsOf(el).forEach(function (pin, idx) {
          var pn = pin.n === 'at' ? String(idx + 1) : pin.n;
          pins.push({ el: el, des: des, pin: pn, p: pin.p, elementIndex: elementIndex, pinIndex: idx });
        });
        if (isPart) parts.push({
          des: des,
          type: el.type === 'kicad' ? (el.symbolId || NICE[el.type]) : NICE[el.type],
          value: el.value || '',
          el: el
        });
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
      if (!groups[r]) { groups[r] = { pins: [], members: [], names: [], hasGnd: false, hasPlus: false }; order.push(r); }
      var g = groups[r];
      g.members.push(q);
      if (q.el.type === 'ground') g.hasGnd = true;
      else if (q.el.type === 'terminal' && q.el.label) g.names.push(q.el.label);
      else if (q.el.type === 'battery' && q.pin === '+') g.hasPlus = true;
      if (q.el.type !== 'ground' && q.el.type !== 'terminal') g.pins.push(q.des + '.' + q.pin);
    });

    var used = {}, n = 0, nets = [];
    var netByRoot = {}, pinMembership = [], routeMembership = [];
    function clean(t) { return String(t).replace(/[^A-Za-z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'NET'; }
    function isPinConnected(pin) {
      var pinKey = key(pin.p[0], pin.p[1]);
      if (wirePts.some(function (point) { return key(point[0], point[1]) === pinKey; })) return true;
      if (segs.some(function (segment) { return onSegInterior(pin.p[0], pin.p[1], segment[0], segment[1]); })) return true;
      return pins.some(function (other) {
        return other !== pin && key(other.p[0], other.p[1]) === pinKey;
      });
    }
    order.forEach(function (r) {
      var g = groups[r], name;
      if (g.hasGnd) name = 'GND';
      else if (g.names.length) {
        var raw = String(g.names[0]);
        name = /^\+?\s*\d+(\.\d+)?\s*V$/i.test(raw) ? (used.VCC ? 'V' + clean(raw.replace('.', 'p')).replace(/V$/i, '') : 'VCC') : clean(raw);
      }
      else if (g.hasPlus && !used.VCC) name = 'VCC';
      else name = 'N' + (++n);
      var netKey = g.hasGnd ? 'legacy:GND' : 'legacy:' + r;
      netByRoot[r] = { key: netKey, name: name };
      if (name === 'GND') {
        var ex = nets.filter(function (x) { return x.name === 'GND'; })[0];
        if (ex) { ex.pins = ex.pins.concat(g.pins); return; }
      } else if (used[name]) name = name + '_' + (++n);
      used[name] = 1;
      if (g.pins.length) nets.push({ name: name, pins: g.pins });
    });
    if (includeMembership) {
      order.forEach(function (r) {
        var g = groups[r], net = netByRoot[r];
        g.members.forEach(function (member) {
          pinMembership.push({
            elementIndex: member.elementIndex,
            pinIndex: member.pinIndex,
            pinName: member.pin,
            netKey: net.key,
            netName: net.name,
            connected: isPinConnected(member)
          });
        });
      });
      spec.elements.forEach(function (el, elementIndex) {
        if (el.type !== 'wire' || !Array.isArray(el.points) || el.points.length < 2) return;
        var root = find(key(el.points[0][0], el.points[0][1]));
        if (!netByRoot[root]) {
          var name = 'N' + (++n);
          while (used[name]) name = 'N' + (++n);
          used[name] = 1;
          netByRoot[root] = { key: 'legacy:' + root, name: name };
        }
        routeMembership.push({
          elementIndex: elementIndex,
          netKey: netByRoot[root].key,
          netName: netByRoot[root].name
        });
      });
    }
    // fixed order: GND first, VCC second, then the rest
    nets.sort(function (a, b) { var w = function (x) { return x === 'GND' ? 0 : x === 'VCC' ? 1 : 2; }; return w(a.name) - w(b.name); });
    parts.sort(function (a, b) {
      return a.des.replace(/\d+/g, '').localeCompare(b.des.replace(/\d+/g, '')) || (parseInt(a.des.replace(/\D/g, ''), 10) || 0) - (parseInt(b.des.replace(/\D/g, ''), 10) || 0);
    });
    var result = { parts: parts.map(function (x) { return { designator: x.des, type: x.type, value: x.value }; }), nets: nets };
    if (includeMembership) {
      result.pinMembership = pinMembership;
      result.routeMembership = routeMembership;
    }
    return result;
  }

  function buildSheet(spec) {
    var nl = netlist(spec), out = [];
    out.push('# Build sheet: ' + (spec.title || 'Circuit'), '', '## Parts', '', '| Designator | Part | Value |', '|---|---|---|');
    nl.parts.forEach(function (x) { out.push('| ' + x.designator + ' | ' + x.type + ' | ' + (x.value || '-') + ' |'); });
    out.push('', '## Nets (everything on one line is joined together)', '');
    nl.nets.forEach(function (nt) { out.push('- ' + nt.name + ': ' + nt.pins.join(', ')); });
    out.push('', 'Pin names: two-terminal parts use the names in their symbol reference. Diode-family parts: A = anode, K = cathode. Battery and polarized source: + and -. BJT: B, C, E. FET: G, D, S. Potentiometer: A, W, B. Op-amp/comparator: INV, NONINV, OUT. IC and connector pin names follow the declared pin list. KiCad library symbols use the exact pin numbers from the selected library symbol; this netlist is a drafting aid, not an electrical simulation.');
    return out.join('\n');
  }

  return {
    version: VERSION,
    render: render,
    validate: validate,
    layoutWarnings: layoutWarnings,
    autoFix: autoFix,
    materializeTopology: materializeTopology,
    validateTopology: function (spec, topology) {
      var contract = inspectTopologyContract(spec, topology);
      return {
        errors: contract.errors.concat(checkMaterializedTopology(spec, contract)),
        warnings: contract.warnings,
      };
    },
    netlist: netlist,
    netlistWithMembership: function (spec, allowStructuralErrors) {
      return netlist(spec, allowStructuralErrors, true);
    },
    buildSheet: buildSheet,
    types: CircuitGeometry.CIRCUIT_SUPPORTED_ELEMENT_TYPES.slice(),
    defaults: DEFAULT_THEME
  };
});
