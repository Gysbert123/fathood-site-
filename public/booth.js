/* Fathood Meme Booth */
function bootBooth(M) {
  var CA = '0xf97bE5444346befC52571e7140394a4cC22B1111';
  var SITE = 'fathood.org';
  var SIZE = 1080;
  var root = document.getElementById('booth');
  if (!root || !M) return;
  M.scenes = M.scenes || [];

  var cv = root.querySelector('#bt-canvas');
  var ctx = cv.getContext('2d');
  cv.width = SIZE; cv.height = SIZE;

  var imgs = {};
  function loadImg(src) {
    if (imgs[src]) return imgs[src];
    var p = new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = rej;
      im.src = src;
    });
    imgs[src] = p; p.catch(function () {});
    return p;
  }
  var ready = {};
  function getImg(src) {
    if (ready[src]) return ready[src];
    loadImg(src).then(function (im) { ready[src] = im; draw(); });
    return null;
  }

  /* ---------- state ---------- */
  var S = { bg: { type: 'scene', id: 'lime' }, objs: [], shirt: null, shorts: null };
  var sel = null, uid = 1, history = [], userPhoto = null;
  function find(id) { for (var i = 0; i < S.objs.length; i++) if (S.objs[i].id === id) return S.objs[i]; return null; }
  function snapshot() {
    history.push(JSON.stringify({ S: S, uid: uid }));
    if (history.length > 60) history.shift();
  }
  function undo() {
    if (!history.length) return;
    var h = JSON.parse(history.pop()); S = h.S; uid = h.uid; sel = null; ui(); draw();
  }

  /* ---------- recolour shirt / shorts ---------- */
  var recCache = {};
  function hueOf(hex) {
    var r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    var l = (mx + mn) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return { h: h, s: s, l: l };
  }
  function hsl2rgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function recoloured(src) {
    if (!S.shirt && !S.shorts) return getImg(src);
    var key = src + '|' + S.shirt + '|' + S.shorts;
    if (recCache[key]) return recCache[key];
    var im = getImg(src); if (!im) return null;
    var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    var x = c.getContext('2d'); x.drawImage(im, 0, 0);
    var d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    var t1 = S.shirt ? hueOf(S.shirt) : null, t2 = S.shorts ? hueOf(S.shorts) : null;
    var W = c.width, H = c.height, N = W * H, kind = new Uint8Array(N), hs = new Float32Array(N), ls = new Float32Array(N), ss = new Float32Array(N), opaque = 0;
    for (var i = 0, j = 0; i < p.length; i += 4, j++) {
      if (p[i + 3] < 20) continue; opaque++;
      var hh = hueOf('#' + ((1 << 24) + (p[i] << 16) + (p[i + 1] << 8) + p[i + 2]).toString(16).slice(1));
      hs[j] = hh.h; ls[j] = hh.l; ss[j] = hh.s;
      if (t1 && hh.s > 0.42 && hh.l > 0.18 && hh.l < 0.66 && (hh.h < 12 || hh.h > 348)) kind[j] = 1;
      else if (t2 && hh.s > 0.35 && hh.l > 0.15 && hh.l < 0.75 && hh.h > 195 && hh.h < 240) kind[j] = 2;
    }
    // only recolour the big connected areas (the shirt and the shorts), never small bits like the tongue
    var seen = new Uint8Array(N), stack = new Int32Array(N), minSize = opaque * 0.035;
    for (var st = 0; st < N; st++) {
      if (!kind[st] || seen[st]) continue;
      var k = kind[st], sp = 0, comp = []; stack[sp++] = st; seen[st] = 1;
      while (sp) {
        var q = stack[--sp]; comp.push(q); var qx = q % W;
        if (qx > 0 && !seen[q - 1] && kind[q - 1] === k) { seen[q - 1] = 1; stack[sp++] = q - 1; }
        if (qx < W - 1 && !seen[q + 1] && kind[q + 1] === k) { seen[q + 1] = 1; stack[sp++] = q + 1; }
        if (q >= W && !seen[q - W] && kind[q - W] === k) { seen[q - W] = 1; stack[sp++] = q - W; }
        if (q < N - W && !seen[q + W] && kind[q + W] === k) { seen[q + W] = 1; stack[sp++] = q + W; }
      }
      if (comp.length < minSize) continue;
      var tgt = k === 1 ? t1 : t2;
      for (var m = 0; m < comp.length; m++) {
        var px = comp[m], o = px * 4, hl = ls[px], hsat = ss[px];
        var nl = tgt.l < 0.12 ? hl * 0.35 : tgt.l > 0.9 ? Math.min(0.95, hl + 0.45) : hl * (0.55 + tgt.l * 0.9);
        var ns = tgt.s < 0.08 ? 0.03 : Math.min(1, hsat * (0.5 + tgt.s * 0.6));
        var rgb = hsl2rgb(tgt.h, ns, Math.max(0, Math.min(1, nl)));
        p[o] = rgb[0]; p[o + 1] = rgb[1]; p[o + 2] = rgb[2];
      }
    }
    x.putImageData(d, 0, 0);
    recCache[key] = c; return c;
  }

  /* ---------- scenes ---------- */
  var sceneCache = {};
  var noise = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    for (var i = 0; i < 1400; i++) {
      x.strokeStyle = Math.random() < .5 ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.6)';
      x.lineWidth = 1 + Math.random() * 1.5; var X = Math.random() * 256, Y = Math.random() * 256, L = 6 + Math.random() * 14;
      x.beginPath(); x.moveTo(X, Y); x.lineTo(X + L * .8, Y - L * .6); x.stroke();
    }
    return c;
  })();
  function texture(x, a) { x.save(); x.globalAlpha = a || .13; x.fillStyle = x.createPattern(noise, 'repeat'); x.fillRect(0, 0, SIZE, SIZE); x.restore(); }
  function ink(x, w) { x.strokeStyle = '#111'; x.lineWidth = w || 9; x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke(); }
  function grad(x, stops, y0, y1) { var g = x.createLinearGradient(0, y0 || 0, 0, y1 || SIZE); stops.forEach(function (s, i) { g.addColorStop(i / (stops.length - 1), s); }); return g; }
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function cloud(x, cx, cy, s) {
    x.beginPath(); [[0, 0, 60], [55, -25, 55], [110, 0, 60], [55, 18, 50]].forEach(function (b) { x.moveTo(cx + b[0] * s + b[2] * s, cy + b[1] * s); x.arc(cx + b[0] * s, cy + b[1] * s, b[2] * s, 0, 7); });
    x.fillStyle = '#fff'; x.fill(); x.lineWidth = 7;
  }
  function stars(x, n, seed, maxY) { var r = rng(seed); x.fillStyle = '#fff'; for (var i = 0; i < n; i++) { var s = r() * 3 + 1; x.globalAlpha = .5 + r() * .5; x.fillRect(r() * SIZE, r() * (maxY || SIZE), s, s); } x.globalAlpha = 1; }
  var SCENES = {
    lime: function (x) {
      x.fillStyle = '#D4F53C'; x.fillRect(0, 0, SIZE, SIZE);
      x.save(); x.translate(SIZE / 2, SIZE * .62); x.fillStyle = 'rgba(255,255,255,.28)';
      for (var i = 0; i < 24; i++) { x.rotate(Math.PI / 12); x.beginPath(); x.moveTo(0, 0); x.lineTo(1500, -90); x.lineTo(1500, 90); x.fill(); i++; x.rotate(Math.PI / 12); }
      x.restore(); texture(x, .1);
    },
    sky: function (x) {
      x.fillStyle = grad(x, ['#5DB7F5', '#BFE6FF']); x.fillRect(0, 0, SIZE, SIZE);
      x.fillStyle = '#FFD23F'; x.beginPath(); x.arc(880, 170, 85, 0, 7); x.fill(); ink(x, 8);
      cloud(x, 130, 200, 1); ink(x, 7); cloud(x, 560, 120, .8); ink(x, 7);
      x.beginPath(); x.moveTo(0, 820); x.quadraticCurveTo(300, 700, 620, 800); x.quadraticCurveTo(880, 870, 1080, 760); x.lineTo(1080, 1080); x.lineTo(0, 1080); x.closePath();
      x.fillStyle = '#5CC23A'; x.fill(); ink(x, 9); texture(x, .15);
    },
    mountains: function (x) {
      x.fillStyle = grad(x, ['#6EC6FF', '#E3F4FF']); x.fillRect(0, 0, SIZE, SIZE);
      cloud(x, 760, 150, .8); ink(x, 7);
      [[-120, 900, 320, 260, 760], [260, 900, 600, 200, 980], [620, 900, 900, 300, 1200]].forEach(function (m, i) {
        x.beginPath(); x.moveTo(m[0], m[1]); x.lineTo(m[2], m[3]); x.lineTo(m[4], m[1]); x.closePath(); x.fillStyle = ['#7D8FA8', '#66778F', '#8A9AB2'][i]; x.fill(); ink(x, 9);
        var h = (m[1] - m[3]) * .28, wl = (m[2] - m[0]) * .28, wr = (m[4] - m[2]) * .28;
        x.beginPath(); x.moveTo(m[2], m[3]); x.lineTo(m[2] - wl, m[3] + h); x.lineTo(m[2] - wl * .4, m[3] + h * .8); x.lineTo(m[2], m[3] + h * 1.1); x.lineTo(m[2] + wr * .4, m[3] + h * .8); x.lineTo(m[2] + wr, m[3] + h); x.closePath(); x.fillStyle = '#fff'; x.fill(); ink(x, 7);
      });
      x.fillStyle = '#69B84A'; x.fillRect(0, 880, SIZE, 200); x.beginPath(); x.moveTo(0, 880); x.lineTo(SIZE, 880); ink(x, 9); texture(x, .15);
    },
    beach: function (x) {
      x.fillStyle = grad(x, ['#FF9E5E', '#FFD7A1'], 0, 600); x.fillRect(0, 0, SIZE, 620);
      x.fillStyle = '#FFE15C'; x.beginPath(); x.arc(540, 560, 140, Math.PI, 0); x.fill(); ink(x, 8);
      x.fillStyle = grad(x, ['#2E86DE', '#1B5FA8'], 560, 800); x.fillRect(0, 560, SIZE, 260);
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 6; for (var i = 0; i < 9; i++) { x.beginPath(); x.moveTo(380 + (i % 3) * 30, 600 + i * 22); x.lineTo(700 - (i % 3) * 30, 600 + i * 22); x.stroke(); }
      x.beginPath(); x.moveTo(0, 820); x.quadraticCurveTo(540, 760, 1080, 820); x.lineTo(1080, 1080); x.lineTo(0, 1080); x.closePath(); x.fillStyle = '#F5D58A'; x.fill(); ink(x, 9);
      x.beginPath(); x.moveTo(0, 560); x.lineTo(SIZE, 560); ink(x, 7); texture(x, .14);
    },
    underwater: function (x) {
      x.fillStyle = grad(x, ['#3FC6D6', '#1667A8', '#0B2F63']); x.fillRect(0, 0, SIZE, SIZE);
      x.save(); x.globalAlpha = .18; x.fillStyle = '#fff'; for (var i = 0; i < 5; i++) { x.beginPath(); x.moveTo(150 + i * 220, 0); x.lineTo(230 + i * 220, 0); x.lineTo(60 + i * 260, 1080); x.lineTo(-40 + i * 260, 1080); x.fill(); } x.restore();
      var r = rng(5); for (var b = 0; b < 26; b++) { x.beginPath(); x.arc(r() * SIZE, r() * 900, 6 + r() * 22, 0, 7); x.fillStyle = 'rgba(255,255,255,.25)'; x.fill(); x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,.8)'; x.stroke(); }
      x.beginPath(); x.moveTo(0, 940); x.quadraticCurveTo(540, 880, 1080, 950); x.lineTo(1080, 1080); x.lineTo(0, 1080); x.closePath(); x.fillStyle = '#E8C77A'; x.fill(); ink(x, 9);
      [[90, '#2FA84F'], [180, '#3CC060'], [930, '#2FA84F'], [1010, '#46C96A']].forEach(function (s) { x.beginPath(); x.moveTo(s[0], 960); for (var k = 1; k < 9; k++) x.lineTo(s[0] + (k % 2 ? 26 : -26), 960 - k * 48); x.lineWidth = 24; x.strokeStyle = '#111'; x.stroke(); x.lineWidth = 14; x.strokeStyle = s[1]; x.stroke(); });
      texture(x, .12);
    },
    moon: function (x) {
      x.fillStyle = '#05060C'; x.fillRect(0, 0, SIZE, SIZE); stars(x, 220, 3, 700);
      x.beginPath(); x.arc(820, 240, 120, 0, 7); x.fillStyle = '#2E7CD6'; x.fill();
      x.fillStyle = '#4CBF4A'; x.beginPath(); x.ellipse(780, 210, 50, 34, .4, 0, 7); x.fill(); x.beginPath(); x.ellipse(870, 290, 36, 26, -.3, 0, 7); x.fill();
      x.beginPath(); x.arc(820, 240, 120, 0, 7); ink(x, 8);
      x.beginPath(); x.moveTo(0, 760); x.quadraticCurveTo(540, 690, 1080, 770); x.lineTo(1080, 1080); x.lineTo(0, 1080); x.closePath(); x.fillStyle = '#B9BCC4'; x.fill(); ink(x, 9);
      [[170, 880, 80], [560, 960, 110], [900, 860, 60], [380, 800, 40]].forEach(function (c) { x.beginPath(); x.ellipse(c[0], c[1], c[2], c[2] * .35, 0, 0, 7); x.fillStyle = '#8F939C'; x.fill(); ink(x, 6); });
      texture(x, .13);
    },
    space: function (x) {
      x.fillStyle = grad(x, ['#1A0B3B', '#2B0F5C', '#0A0420']); x.fillRect(0, 0, SIZE, SIZE);
      x.save(); x.globalAlpha = .35; var g = x.createRadialGradient(300, 700, 10, 300, 700, 420); g.addColorStop(0, '#E04FD0'); g.addColorStop(1, 'rgba(224,79,208,0)'); x.fillStyle = g; x.fillRect(0, 0, SIZE, SIZE); x.restore();
      stars(x, 300, 9);
      x.beginPath(); x.arc(850, 230, 110, 0, 7); x.fillStyle = '#F2A33A'; x.fill(); ink(x, 8);
      x.beginPath(); x.ellipse(850, 230, 190, 40, -.35, 0, 7); x.lineWidth = 22; x.strokeStyle = '#111'; x.stroke(); x.lineWidth = 12; x.strokeStyle = '#FFE08A'; x.stroke();
      x.beginPath(); x.arc(170, 200, 55, 0, 7); x.fillStyle = '#3FC6D6'; x.fill(); ink(x, 7);
      x.beginPath(); x.arc(930, 860, 70, 0, 7); x.fillStyle = '#E84A5F'; x.fill(); ink(x, 7);
      texture(x, .1);
    },
    'city-night': function (x) {
      x.fillStyle = grad(x, ['#0B1033', '#2A2F6B']); x.fillRect(0, 0, SIZE, SIZE); stars(x, 120, 4, 500);
      x.beginPath(); x.arc(860, 170, 80, 0, 7); x.fillStyle = '#FFF2B0'; x.fill(); ink(x, 7);
      var r = rng(11), X = -20; while (X < SIZE) { var w = 120 + r() * 120, h = 300 + r() * 420; x.beginPath(); x.rect(X, 1000 - h, w, h + 100); x.fillStyle = ['#262B4F', '#1D2140', '#30365E'][Math.floor(r() * 3)]; x.fill(); ink(x, 7);
        for (var wy = 1000 - h + 30; wy < 960; wy += 52) for (var wx = X + 18; wx < X + w - 30; wx += 40) if (r() < .55) { x.fillStyle = '#FFD86B'; x.fillRect(wx, wy, 20, 28); } X += w - 4; }
      x.fillStyle = '#15172B'; x.fillRect(0, 1000, SIZE, 80); texture(x, .1);
    },
    graveyard: function (x) {
      x.fillStyle = grad(x, ['#0B1410', '#132A1E']); x.fillRect(0, 0, SIZE, SIZE); stars(x, 80, 8, 400);
      x.beginPath(); x.arc(780, 220, 120, 0, 7); x.fillStyle = '#E8F5D0'; x.fill(); ink(x, 8);
      x.beginPath(); x.moveTo(0, 860); x.quadraticCurveTo(540, 800, 1080, 870); x.lineTo(1080, 1080); x.lineTo(0, 1080); x.closePath(); x.fillStyle = '#1E3A22'; x.fill(); ink(x, 9);
      [[150, 830, 110, 170, -.08], [380, 800, 90, 140, .05], [760, 820, 120, 180, .07], [960, 860, 80, 120, -.05]].forEach(function (t) {
        x.save(); x.translate(t[0], t[1]); x.rotate(t[4]); x.beginPath(); x.moveTo(-t[2] / 2, 0); x.lineTo(-t[2] / 2, -t[3] + t[2] / 2); x.arc(0, -t[3] + t[2] / 2, t[2] / 2, Math.PI, 0); x.lineTo(t[2] / 2, 0); x.closePath(); x.fillStyle = '#8A918A'; x.fill(); ink(x, 8); x.restore(); });
      x.save(); x.globalAlpha = .5; var g = x.createLinearGradient(0, 760, 0, 1080); g.addColorStop(0, 'rgba(92,255,59,0)'); g.addColorStop(1, 'rgba(92,255,59,.45)'); x.fillStyle = g; x.fillRect(0, 760, SIZE, 320); x.restore();
      texture(x, .1);
    },
    torch: function (x) {
      x.fillStyle = '#060806'; x.fillRect(0, 0, SIZE, SIZE);
      var g = x.createRadialGradient(540, 900, 20, 540, 800, 700); g.addColorStop(0, 'rgba(92,255,59,.55)'); g.addColorStop(.5, 'rgba(92,255,59,.12)'); g.addColorStop(1, 'rgba(92,255,59,0)'); x.fillStyle = g; x.fillRect(0, 0, SIZE, SIZE);
      var r = rng(2); x.fillStyle = '#7CFF5E'; for (var i = 0; i < 70; i++) { x.globalAlpha = .3 + r() * .6; x.beginPath(); x.arc(r() * SIZE, r() * SIZE, 1 + r() * 3, 0, 7); x.fill(); } x.globalAlpha = 1;
    },
    pump: function (x) {
      x.fillStyle = '#0D1117'; x.fillRect(0, 0, SIZE, SIZE);
      x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 2; for (var i = 0; i <= SIZE; i += 90) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, SIZE); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(SIZE, i); x.stroke(); }
      var r = rng(21), y = 900; for (var c = 0; c < 17; c++) { var up = r() < .78, h = 30 + r() * 90, cx = 40 + c * 62; var top = up ? y - h : y, bot = up ? y : y + h * .6; x.strokeStyle = up ? '#3FD62A' : '#E5484D'; x.lineWidth = 4; x.beginPath(); x.moveTo(cx, top - 25); x.lineTo(cx, bot + 25); x.stroke(); x.fillStyle = x.strokeStyle; x.fillRect(cx - 16, top, 32, Math.max(8, bot - top)); y = up ? top : bot; }
    }
  };
  var SCENE_LIST = M.scenes.map(function (s) { return [s.id, s.label]; }).concat([['lime', 'Fat rays'], ['sky', 'Sunny hill'], ['city-night', 'City at night'], ['graveyard', 'Graveyard'], ['torch', 'Torchlight'], ['pump', 'Green candles']]);
  function sceneCanvas(id) {
    if (sceneCache[id]) return sceneCache[id];
    var sc = M.sceneIndex && M.sceneIndex[id];
    if (sc) {
      var im = getImg(sc.src); if (!im) { var ph = document.createElement('canvas'); ph.width = ph.height = SIZE; var px = ph.getContext('2d'); px.fillStyle = '#D4F53C'; px.fillRect(0, 0, SIZE, SIZE); return ph; }
      var ci = document.createElement('canvas'); ci.width = ci.height = SIZE; var cx = ci.getContext('2d'); var r = Math.max(SIZE / im.naturalWidth, SIZE / im.naturalHeight);
      cx.drawImage(im, (SIZE - im.naturalWidth * r) / 2, (SIZE - im.naturalHeight * r) / 2, im.naturalWidth * r, im.naturalHeight * r); sceneCache[id] = ci; return ci;
    }
    var c = document.createElement('canvas'); c.width = c.height = SIZE; SCENES[id](c.getContext('2d')); sceneCache[id] = c; return c;
  }

  /* ---------- geometry ---------- */
  function objSize(o) {
    if (o.kind === 'text') {
      ctx.font = textFont(o); var lines = o.text.split('\n'), w = 0; lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l).width); });
      return { w: Math.max(40, w + o.size * .3), h: o.size * 1.15 * lines.length + o.size * .2 };
    }
    var it = itemById(o.item); return { w: it.w * o.s, h: it.h * o.s };
  }
  function itemById(id) { return M.index[id]; }
  function poseAnchors(p) {
    var it = itemById(p.item), pts = it.pts, out = {};
    var cs = Math.cos(p.rot), sn = Math.sin(p.rot), fx = p.flip ? -1 : 1;
    Object.keys(pts).forEach(function (k) {
      var lx = (pts[k][0] - it.w / 2) * p.s * fx, ly = (pts[k][1] - it.h / 2) * p.s;
      out[k] = { x: p.x + lx * cs - ly * sn, y: p.y + lx * sn + ly * cs };
    });
    var L = out.l, R = out.r; if (p.flip) { var t = L; L = R; R = t; }
    out.eyeDist = Math.hypot(R.x - L.x, R.y - L.y); out.eyeAng = Math.atan2(R.y - L.y, R.x - L.x);
    out.eyeMid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 }; out.L = L; out.R = R; out.s = p.s;
    return out;
  }
  // resolve the drawn transform of any object (attached accessories follow their pose)
  function tf(o) {
    if (o.kind === 'acc' && o.attach) {
      var p = find(o.attach);
      if (!p) { o.attach = null; }
      else {
        var A = poseAnchors(p), it = itemById(o.item), base, w;
        if (it.anchor === 'top') { base = A.top; w = A.eyeDist * it.fit; }
        else if (it.anchor === 'neck') { base = A.neck; w = A.eyeDist * it.fit; }
        else { base = A.eyeMid; w = A.eyeDist * it.fit; }
        var s = w / it.w * (o.ds || 1), ang = A.eyeAng + (o.dr || 0);
        var oy = (it.oy || 0) * it.h * s;
        var cx = base.x + (o.dx || 0) * A.s - Math.sin(ang) * oy, cy = base.y + (o.dy || 0) * A.s + Math.cos(ang) * oy;
        return { x: cx, y: cy, s: s, rot: ang, flip: false, A: A };
      }
    }
    return { x: o.x, y: o.y, s: o.s, rot: o.rot, flip: o.flip };
  }

  /* ---------- drawing ---------- */
  function textFont(o) { return (o.font === 'grotesk' ? '700 ' : '400 ') + o.size + 'px ' + (o.font === 'grotesk' ? '"Space Grotesk", sans-serif' : '"Bowlby One", Impact, sans-serif'); }
  function drawBg(x) {
    if (S.bg.type === 'color') { x.fillStyle = S.bg.value; x.fillRect(0, 0, SIZE, SIZE); }
    else if (S.bg.type === 'photo' && userPhoto) {
      var im = userPhoto, r = Math.max(SIZE / im.width, SIZE / im.height); x.drawImage(im, (SIZE - im.width * r) / 2, (SIZE - im.height * r) / 2, im.width * r, im.height * r);
    } else x.drawImage(sceneCanvas(S.bg.id || 'lime'), 0, 0);
  }
  function drawObj(x, o) {
    var it = o.kind === 'text' ? null : itemById(o.item);
    var T = tf(o);
    if (o.kind === 'acc' && it.anchor === 'eyepair' && T.A) {
      var im = getImg(it.src); if (!im) return;
      [T.A.L, T.A.R].forEach(function (E) {
        var bw = T.A.eyeDist * it.fit * (o.ds || 1), bh = bw * it.h / it.w, dir = find(o.attach).flip ? Math.PI : 0;
        x.save(); x.translate(E.x, E.y); x.rotate(T.A.eyeAng * .4 + dir + (o.dr || 0)); x.drawImage(im, 0, -bh / 2, bw, bh); x.restore();
      });
      return;
    }
    x.save(); x.translate(T.x, T.y); x.rotate(T.rot); if (T.flip) x.scale(-1, 1);
    if (o.kind === 'text') {
      x.font = textFont(o); x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      var lines = o.text.split('\n'), lh = o.size * 1.15, y0 = -(lines.length - 1) * lh / 2;
      lines.forEach(function (l, i) {
        if (o.stroke) { x.lineWidth = o.size * .16; x.strokeStyle = o.stroke; x.strokeText(l, 0, y0 + i * lh); }
        x.fillStyle = o.color; x.fillText(l, 0, y0 + i * lh);
      });
    } else {
      var src = o.kind === 'pose' ? recoloured(it.src) : getImg(it.src);
      if (src) x.drawImage(src, -it.w * T.s / 2, -it.h * T.s / 2, it.w * T.s, it.h * T.s);
    }
    x.restore();
  }
  function render(x, withUI) {
    drawBg(x);
    S.objs.forEach(function (o) { drawObj(x, o); });
    if (withUI && sel) {
      var o = find(sel); if (!o) return;
      var b = bounds(o);
      x.save(); x.translate(b.x, b.y); x.rotate(b.rot);
      x.setLineDash([16, 10]); x.lineWidth = 4; x.strokeStyle = '#1F4FD1'; x.strokeRect(-b.w / 2 - 10, -b.h / 2 - 10, b.w + 20, b.h + 20); x.setLineDash([]);
      x.beginPath(); x.arc(b.w / 2 + 10, b.h / 2 + 10, 26, 0, 7); x.fillStyle = '#1F4FD1'; x.fill(); x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke();
      x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.arc(b.w / 2 + 10, b.h / 2 + 10, 12, -2.6, 1.2); x.stroke();
      x.restore();
    }
  }
  var raf = 0;
  function draw() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; render(ctx, true); }); }
  function bounds(o) {
    var T = tf(o), sz;
    if (o.kind === 'text') sz = objSize(o); else { var it = itemById(o.item); sz = { w: it.w * T.s, h: it.h * T.s }; }
    if (o.kind === 'acc' && itemById(o.item).anchor === 'eyepair' && T.A) { return { x: T.A.eyeMid.x, y: T.A.eyeMid.y, w: T.A.eyeDist * 2.2, h: T.A.eyeDist * .9, rot: T.A.eyeAng }; }
    return { x: T.x, y: T.y, w: sz.w, h: sz.h, rot: T.rot };
  }
  function local(o, px, py) { var b = bounds(o), dx = px - b.x, dy = py - b.y, c = Math.cos(-b.rot), s = Math.sin(-b.rot); return { x: dx * c - dy * s, y: dx * s + dy * c, b: b }; }

  /* ---------- adding things ---------- */
  function firstPose() { for (var i = S.objs.length - 1; i >= 0; i--) if (S.objs[i].kind === 'pose') return S.objs[i]; return null; }
  function selectedPose() { var o = sel && find(sel); if (o && o.kind === 'pose') return o; if (o && o.kind === 'acc' && o.attach) return find(o.attach); return firstPose(); }
  function addPose(id) {
    snapshot(); var it = itemById(id), cur = selectedPose();
    if (cur) { var oldH = itemById(cur.item).h; cur.item = id; cur.s = cur.s * oldH / it.h; sel = cur.id; }
    else { var o = { id: uid++, kind: 'pose', item: id, x: SIZE / 2, y: SIZE * .58, s: 780 / it.h, rot: 0, flip: false }; S.objs.push(o); sel = o.id; reorderAcc(); }
    ui(); draw();
  }
  function reorderAcc() { // keep attached accessories above their pose
    var poses = S.objs.filter(function (o) { return o.kind === 'pose'; });
    poses.forEach(function (p) {
      var acc = S.objs.filter(function (o) { return o.kind === 'acc' && o.attach === p.id; });
      if (!acc.length) return;
      S.objs = S.objs.filter(function (o) { return acc.indexOf(o) < 0; });
      var i = S.objs.indexOf(p); var back = acc.filter(function (a) { return itemById(a.item).behind; }), front = acc.filter(function (a) { return !itemById(a.item).behind; });
      S.objs.splice.apply(S.objs, [i + 1, 0].concat(front)); if (back.length) S.objs.splice.apply(S.objs, [S.objs.indexOf(p), 0].concat(back));
    });
  }
  function addAcc(id) {
    snapshot(); var it = itemById(id), p = selectedPose();
    if (p) {
      // one item per slot: replace an existing item in the same slot on this pose
      S.objs = S.objs.filter(function (o) { return !(o.kind === 'acc' && o.attach === p.id && itemById(o.item).slot === it.slot); });
      var o = { id: uid++, kind: 'acc', item: id, attach: p.id, dx: 0, dy: 0, ds: 1, dr: 0 };
      S.objs.push(o); reorderAcc(); sel = o.id;
    } else {
      var o2 = { id: uid++, kind: 'acc', item: id, x: SIZE / 2, y: SIZE / 2, s: 360 / it.w, rot: 0, flip: false }; S.objs.push(o2); sel = o2.id;
    }
    ui(); draw();
  }
  function addProp(id) {
    snapshot(); var it = itemById(id), n = S.objs.length;
    var o = { id: uid++, kind: 'prop', item: id, x: SIZE * (.3 + Math.random() * .4), y: SIZE * (.3 + Math.random() * .4), s: (it.def || 300) / Math.max(it.w, it.h), rot: 0, flip: false };
    S.objs.push(o); sel = o.id; ui(); draw();
  }
  function addText(t) {
    if (!t.trim()) return; snapshot();
    var o = { id: uid++, kind: 'text', text: t.trim(), font: TXT.font, color: TXT.color, stroke: TXT.stroke ? (TXT.color === '#111111' ? '#FFFFFF' : '#111111') : null, size: 96, x: SIZE / 2, y: SIZE * .14, s: 1, rot: 0, flip: false };
    var tops = S.objs.filter(function (q) { return q.kind === 'text'; }).length; if (tops === 1) o.y = SIZE * .88; if (tops > 1) o.y = SIZE / 2;
    S.objs.push(o); sel = o.id; ui(); draw();
  }

  /* ---------- pointer interaction ---------- */
  var drag = null;
  function pt(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * SIZE / r.width, y: (e.clientY - r.top) * SIZE / r.height }; }
  function hit(p) {
    if (sel) { var o = find(sel); if (o) { var l = local(o, p.x, p.y); if (Math.hypot(l.x - (l.b.w / 2 + 10), l.y - (l.b.h / 2 + 10)) < 46) return { o: o, handle: true }; } }
    for (var i = S.objs.length - 1; i >= 0; i--) { var q = S.objs[i], L = local(q, p.x, p.y); if (Math.abs(L.x) <= L.b.w / 2 + 6 && Math.abs(L.y) <= L.b.h / 2 + 6) return { o: q }; }
    return null;
  }
  cv.addEventListener('pointerdown', function (e) {
    var p = pt(e), h = hit(p);
    if (!h) { sel = null; ui(); draw(); return; }
    cv.setPointerCapture(e.pointerId); e.preventDefault();
    sel = h.o.id; snapshot();
    var o = h.o, T = tf(o);
    drag = { o: o, handle: !!h.handle, start: p, T: T, ox: o.x, oy: o.y, odx: o.dx || 0, ody: o.dy || 0, os: o.s, ods: o.ds || 1, orot: o.rot, odr: o.dr || 0, size: o.size,
      d0: Math.hypot(p.x - T.x, p.y - T.y), a0: Math.atan2(p.y - T.y, p.x - T.x), moved: false };
    if (o.kind === 'acc' && o.attach && itemById(o.item).anchor === 'eyepair') { var b = bounds(o); drag.T = { x: b.x, y: b.y }; drag.d0 = Math.hypot(p.x - b.x, p.y - b.y); drag.a0 = Math.atan2(p.y - b.y, p.x - b.x); }
    ui(); draw();
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return; var p = pt(e), o = drag.o; drag.moved = true;
    if (drag.handle) {
      var k = Math.max(.1, Math.hypot(p.x - drag.T.x, p.y - drag.T.y) / Math.max(1, drag.d0)), da = Math.atan2(p.y - drag.T.y, p.x - drag.T.x) - drag.a0;
      if (o.kind === 'acc' && o.attach) { o.ds = Math.min(5, drag.ods * k); o.dr = drag.odr + da; }
      else if (o.kind === 'text') { o.size = Math.max(20, Math.min(400, drag.size * k)); o.rot = drag.orot + da; }
      else { o.s = Math.max(.02, drag.os * k); o.rot = drag.orot + da; }
    } else {
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (o.kind === 'acc' && o.attach) { var A = drag.T.A || poseAnchors(find(o.attach)); o.dx = drag.odx + dx / A.s; o.dy = drag.ody + dy / A.s; }
      else { o.x = drag.ox + dx; o.y = drag.oy + dy; }
    }
    draw();
  });
  function end() { if (drag && !drag.moved) history.pop(); drag = null; }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  /* ---------- UI ---------- */
  var TXT = { font: 'bowlby', color: '#FFFFFF', stroke: true };
  var COLORS = ['#D4F53C', '#FFD23F', '#FF8A3D', '#E5484D', '#FF7AC6', '#9B5DE5', '#1F4FD1', '#3FC6D6', '#3FD62A', '#FFFFFF', '#111111'];
  var SHIRTS = [null, '#1F4FD1', '#3FD62A', '#111111', '#FFFFFF', '#FFD23F', '#9B5DE5', '#FF7AC6', '#FF8A3D'];
  var SHORTS = [null, '#E5484D', '#111111', '#3FD62A', '#FFD23F', '#FFFFFF', '#9B5DE5'];
  function $(s) { return root.querySelector(s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function thumbBtn(label, src, on, cb, sceneId) {
    var b = el('button', 'bt-thumb' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
    if (sceneId) { var c = document.createElement('canvas'); c.width = c.height = 120; c.getContext('2d').drawImage(sceneCanvas(sceneId), 0, 0, 120, 120); b.appendChild(c); }
    else { var im = new Image(); im.src = src; im.alt = ''; im.loading = 'lazy'; b.appendChild(im); }
    var s = el('span', null); s.textContent = label; b.appendChild(s);
    b.addEventListener('click', cb); return b;
  }
  function swatch(color, on, cb, label) {
    var b = el('button', 'bt-sw' + (on ? ' on' : '')); b.type = 'button';
    if (color) b.style.background = color; else { b.classList.add('orig'); b.textContent = 'Original'; }
    b.setAttribute('aria-label', label || color || 'Original'); b.addEventListener('click', cb); return b;
  }
  var tab = 'fathood';
  function panel() {
    var P = $('#bt-panel'); P.innerHTML = '';
    if (tab === 'bg') {
      P.appendChild(el('h4', null, 'Scenes'));
      var g = el('div', 'bt-grid'); SCENE_LIST.forEach(function (s) { var isImg = M.sceneIndex[s[0]]; g.appendChild(thumbBtn(s[1], isImg ? isImg.src : null, S.bg.type === 'scene' && S.bg.id === s[0], function () { snapshot(); S.bg = { type: 'scene', id: s[0] }; panel(); draw(); }, isImg ? null : s[0])); }); P.appendChild(g);
      P.appendChild(el('h4', null, 'Plain colour'));
      var r = el('div', 'bt-row'); COLORS.forEach(function (c) { r.appendChild(swatch(c, S.bg.type === 'color' && S.bg.value === c, function () { snapshot(); S.bg = { type: 'color', value: c }; panel(); draw(); })); });
      var ci = el('input'); ci.type = 'color'; ci.className = 'bt-color'; ci.value = S.bg.type === 'color' ? S.bg.value : '#D4F53C'; ci.setAttribute('aria-label', 'Pick any colour');
      ci.addEventListener('input', function () { S.bg = { type: 'color', value: ci.value }; draw(); }); r.appendChild(ci); P.appendChild(r);
      P.appendChild(el('h4', null, 'Your own photo'));
      var lab = el('label', 'bt-btn ghost', 'Upload a photo'); var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true; lab.appendChild(fi);
      fi.addEventListener('change', function () { var f = fi.files[0]; if (!f) return; var u = URL.createObjectURL(f), im = new Image(); im.onload = function () { snapshot(); userPhoto = im; S.bg = { type: 'photo' }; panel(); draw(); }; im.src = u; });
      P.appendChild(lab);
    } else if (tab === 'fathood') {
      P.appendChild(el('h4', null, 'Pose'));
      var cur = selectedPose(); var g2 = el('div', 'bt-grid');
      M.poses.forEach(function (it) { g2.appendChild(thumbBtn(it.label, it.src, cur && cur.item === it.id, function () { addPose(it.id); })); }); P.appendChild(g2);
      var add = el('button', 'bt-btn ghost', 'Add another Fathood'); add.type = 'button';
      add.addEventListener('click', function () { snapshot(); var it = M.poses[Math.floor(Math.random() * M.poses.length)]; var o = { id: uid++, kind: 'pose', item: it.id, x: SIZE * (.3 + Math.random() * .4), y: SIZE * .62, s: 560 / it.h, rot: 0, flip: Math.random() < .5 }; S.objs.push(o); sel = o.id; ui(); draw(); });
      P.appendChild(add);
      P.appendChild(el('h4', null, 'Shirt colour'));
      var r1 = el('div', 'bt-row'); SHIRTS.forEach(function (c) { r1.appendChild(swatch(c, S.shirt === c, function () { snapshot(); S.shirt = c; panel(); draw(); }, c ? 'Shirt ' + c : 'Original shirt')); }); P.appendChild(r1);
      P.appendChild(el('h4', null, 'Shorts colour'));
      var r2 = el('div', 'bt-row'); SHORTS.forEach(function (c) { r2.appendChild(swatch(c, S.shorts === c, function () { snapshot(); S.shorts = c; panel(); draw(); }, c ? 'Shorts ' + c : 'Original shorts')); }); P.appendChild(r2);
    } else if (tab === 'wear') {
      P.appendChild(el('p', 'bt-hint', 'Tap an item and it snaps onto Fathood. Drag it to nudge it, or use the blue handle to resize.'));
      var g3 = el('div', 'bt-grid'); M.acc.forEach(function (it) { g3.appendChild(thumbBtn(it.label, it.thumb || it.src, false, function () { addAcc(it.id); })); }); P.appendChild(g3);
    } else if (tab === 'props') {
      var g4 = el('div', 'bt-grid'); M.props.forEach(function (it) { g4.appendChild(thumbBtn(it.label, it.src, false, function () { addProp(it.id); })); }); P.appendChild(g4);
    } else if (tab === 'text') {
      var o = sel && find(sel), editing = o && o.kind === 'text';
      var ta = el('textarea', 'bt-input'); ta.rows = 2; ta.maxLength = 80; ta.placeholder = 'Type your meme text'; ta.value = editing ? o.text : '';
      ta.setAttribute('aria-label', 'Meme text');
      P.appendChild(ta);
      if (editing) ta.addEventListener('input', function () { o.text = ta.value || ' '; draw(); });
      var fr = el('div', 'bt-row');
      [['bowlby', 'Chunky'], ['grotesk', 'Clean']].forEach(function (f) { var b = el('button', 'bt-chip' + (TXT.font === f[0] ? ' on' : ''), f[1]); b.type = 'button'; b.addEventListener('click', function () { TXT.font = f[0]; if (editing) { snapshot(); o.font = f[0]; draw(); } panel(); }); fr.appendChild(b); });
      var sb = el('button', 'bt-chip' + (TXT.stroke ? ' on' : ''), 'Outline'); sb.type = 'button'; sb.addEventListener('click', function () { TXT.stroke = !TXT.stroke; if (editing) { snapshot(); o.stroke = TXT.stroke ? (o.color === '#111111' ? '#FFFFFF' : '#111111') : null; draw(); } panel(); }); fr.appendChild(sb);
      P.appendChild(fr);
      var cr = el('div', 'bt-row'); COLORS.forEach(function (c) { cr.appendChild(swatch(c, TXT.color === c, function () { TXT.color = c; if (editing) { snapshot(); o.color = c; if (o.stroke) o.stroke = c === '#111111' ? '#FFFFFF' : '#111111'; draw(); } panel(); })); }); P.appendChild(cr);
      if (!editing) { var ab = el('button', 'bt-btn', 'Add text'); ab.type = 'button'; ab.addEventListener('click', function () { addText(ta.value); }); P.appendChild(ab); }
      else P.appendChild(el('p', 'bt-hint', 'Editing the selected text. Tap empty space on the picture to finish.'));
    }
  }
  function toolbar() {
    var T = $('#bt-tools'), o = sel && find(sel);
    T.hidden = !o; if (!o) return;
    $('#bt-flip').hidden = o.kind === 'acc' && !!o.attach;
  }
  function ui() {
    root.querySelectorAll('.bt-tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
    var o = sel && find(sel); if (o && o.kind === 'text' && tab !== 'text') { /* keep tab */ }
    panel(); toolbar();
  }
  root.querySelectorAll('.bt-tab').forEach(function (b) { b.addEventListener('click', function () { tab = b.dataset.tab; ui(); }); });
  $('#bt-undo').addEventListener('click', undo);
  $('#bt-clear').addEventListener('click', function () { snapshot(); S.objs = []; sel = null; ui(); draw(); });
  $('#bt-random').addEventListener('click', randomise);
  $('#bt-del').addEventListener('click', function () { var o = find(sel); if (!o) return; snapshot(); S.objs = S.objs.filter(function (q) { return q !== o && !(q.attach === o.id); }); sel = null; ui(); draw(); });
  $('#bt-flip').addEventListener('click', function () { var o = find(sel); if (!o) return; snapshot(); o.flip = !o.flip; draw(); });
  $('#bt-fwd').addEventListener('click', function () { var o = find(sel); if (!o) return; snapshot(); var i = S.objs.indexOf(o); if (i < S.objs.length - 1) { S.objs.splice(i, 1); S.objs.splice(i + 1, 0, o); } reorderAcc(); draw(); });
  $('#bt-back').addEventListener('click', function () { var o = find(sel); if (!o) return; snapshot(); var i = S.objs.indexOf(o); if (i > 0) { S.objs.splice(i, 1); S.objs.splice(i - 1, 0, o); } draw(); });
  $('#bt-dup').addEventListener('click', function () { var o = find(sel); if (!o) return; snapshot(); var c = JSON.parse(JSON.stringify(o)); c.id = uid++; if (c.attach) { c.dx = (c.dx || 0) + 30; } else { c.x += 40; c.y += 40; } S.objs.push(c); sel = c.id; ui(); draw(); });

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function randomise() {
    snapshot(); S.objs = []; sel = null;
    S.bg = Math.random() < .8 ? { type: 'scene', id: pick(SCENE_LIST)[0] } : { type: 'color', value: pick(COLORS) };
    S.shirt = Math.random() < .5 ? null : pick(SHIRTS.slice(1)); S.shorts = Math.random() < .6 ? null : pick(SHORTS.slice(1));
    var pz = pick(M.poses); var p = { id: uid++, kind: 'pose', item: pz.id, x: SIZE * (.42 + Math.random() * .16), y: SIZE * .6, s: 760 / pz.h, rot: 0, flip: Math.random() < .3 }; S.objs.push(p);
    var slots = {}; M.acc.slice().sort(function () { return Math.random() - .5; }).forEach(function (a) { if (Object.keys(slots).length < 2 && !slots[a.slot] && Math.random() < .6) { slots[a.slot] = 1; S.objs.push({ id: uid++, kind: 'acc', item: a.id, attach: p.id, dx: 0, dy: 0, ds: 1, dr: 0 }); } });
    reorderAcc();
    var n = Math.floor(Math.random() * 3); for (var i = 0; i < n; i++) { var it = pick(M.props); var corner = [[.16, .2], [.84, .2], [.15, .8], [.85, .78]][i % 4]; S.objs.push({ id: uid++, kind: 'prop', item: it.id, x: SIZE * corner[0], y: SIZE * corner[1], s: (it.def || 260) / Math.max(it.w, it.h) * .9, rot: (Math.random() - .5) * .5, flip: Math.random() < .5 }); }
    if (Math.random() < .55) S.objs.push({ id: uid++, kind: 'text', text: pick(['HOLDING UNTIL\nWE’RE FAT', 'NO BUNDLES\nNO RUGS', 'FAT BAGS ONLY', 'RUGS FEAR HIM', 'GM FATTIES', '$FATHOOD']), font: 'bowlby', color: '#FFFFFF', stroke: '#111111', size: 88, x: SIZE / 2, y: SIZE * .13, s: 1, rot: 0, flip: false });
    ui(); draw();
  }

  /* ---------- snap & share ---------- */
  var POSE_ACT = { standing: 'raising the fat fist', running: 'running down the scammers', dancing: 'dancing on the rugs', singing: 'singing the rugs to sleep', driving: 'driving straight past the paper hands', fishing: 'fishing for rug pullers', eating: 'eating the market', sign: 'holding the line', 'arms-out': 'ready to swallow the market', kicking: 'kicking out the paid KOLs', juggling: 'juggling fat bags' };
  var LINES = [
    'Fathood is {act}. The trenches could never.', 'POV: you held. Now you’re {act}.', 'KOLs shilling. Fathood {act}.', 'No bundles. No rugs. Just fat bags.',
    'Holding until we’re fat 🍔', 'Paper hands left. Fathood stayed.', 'Built different. Built fat.', 'Wall Street called. Fathood ate the phone.',
    'GM from the fattest hood on Robinhood Chain', 'Rugs fear him.', 'Exit liquidity? Not this guy.', 'Fathood doesn’t sell. Fathood snacks.',
    'Me after the scammers got swallowed whole', 'Fair launch energy only', 'Somebody tell the rugs Fathood is {act}.'
  ];
  function caption() {
    var p = firstPose(), act = p ? (POSE_ACT[p.item.replace('pose-', '')] || 'eating the market') : 'eating the market';
    var line = pick(LINES).replace('{act}', act);
    return line + '\n\n$FATHOOD on Torchpad 🔥\nCA: ' + CA + '\n' + SITE;
  }
  var lastBlob = null, lastCanvas = null;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  function snap() {
    sel = null; ui();
    var c = document.createElement('canvas'); c.width = c.height = SIZE; var x = c.getContext('2d'); render(x, false);
    x.font = '400 34px "Bowlby One", Impact, sans-serif'; x.textAlign = 'right'; x.textBaseline = 'bottom'; x.lineJoin = 'round';
    x.lineWidth = 8; x.strokeStyle = '#111'; x.strokeText('$FATHOOD', SIZE - 24, SIZE - 20); x.fillStyle = '#D4F53C'; x.fillText('$FATHOOD', SIZE - 24, SIZE - 20);
    lastCanvas = c;
    c.toBlob(function (b) {
      lastBlob = b; var url = URL.createObjectURL(b);
      $('#bt-shot').src = url; $('#bt-post').value = caption(); $('#bt-status').textContent = ''; $('#bt-count').textContent = $('#bt-post').value.length + ' / 280';
      $('#bt-modal').hidden = false; $('#bt-modal').querySelector('.bt-close').focus();
      if ($('#bt-wall').checked) submit(b);
    }, 'image/jpeg', .88);
    draw();
  }
  function submit(b) {
    var st = $('#bt-status'); st.textContent = 'Sending your meme to the Wall of Fat…';
    fetch('/api/submit', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: b })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) { st.textContent = r.ok ? 'Sent to the Wall of Fat. It appears there once the team approves it.' : (r.j.error || 'Couldn’t send it to the Wall of Fat right now.'); })
      .catch(function () { st.textContent = 'The Wall of Fat goes live once the site is on Netlify. Your meme still works for sharing.'; });
  }
  function file() { return new File([lastBlob], 'fathood-meme.jpg', { type: 'image/jpeg' }); }
  function download() { var a = document.createElement('a'); a.href = URL.createObjectURL(lastBlob); a.download = 'fathood-meme.jpg'; document.body.appendChild(a); a.click(); a.remove(); }
  function intent() { window.open('https://x.com/intent/post?text=' + encodeURIComponent($('#bt-post').value), '_blank', 'noopener'); }
  $('#bt-snap').addEventListener('click', snap);
  function pngBlob() { return new Promise(function (res, rej) { lastCanvas.toBlob(function (b) { b ? res(b) : rej(); }, 'image/png'); }); }
  $('#bt-share').addEventListener('click', function () {
    var text = $('#bt-post').value, f = file(), st = $('#bt-status');
    // phones: the share sheet hands the image straight to the X app
    if (navigator.canShare && navigator.canShare({ files: [f] }) && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
      navigator.clipboard && navigator.clipboard.writeText(text).catch(function () {});
      navigator.share({ files: [f], text: text }).catch(function () {});
      return;
    }
    // computers: copy the meme to the clipboard, open X with the text filled in, paste the image there
    var copied = null;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) copied = navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
    } catch (e) { copied = null; }
    intent();
    if (!copied) { download(); st.textContent = 'Your meme downloaded. In the X post that opened, click the photo icon and pick fathood-meme.jpg.'; return; }
    st.textContent = 'Copying your meme…';
    copied.then(function () {
      st.innerHTML = '<strong>Meme copied!</strong> In the X post that just opened, click in the text box and press <strong>' + (IS_MAC ? 'Cmd+V' : 'Ctrl+V') + '</strong> to paste it.';
    }).catch(function () { download(); st.textContent = 'Your meme downloaded. In the X post that opened, click the photo icon and pick fathood-meme.jpg.'; });
  });
  $('#bt-dl').addEventListener('click', download);
  $('#bt-copy').addEventListener('click', function () { var b = $('#bt-copy'); (navigator.clipboard ? navigator.clipboard.writeText($('#bt-post').value) : Promise.reject()).then(function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = 'Copy post text'; }, 1500); }).catch(function () { $('#bt-post').select(); }); });
  $('#bt-newcap').addEventListener('click', function () { $('#bt-post').value = caption(); $('#bt-count').textContent = $('#bt-post').value.length + ' / 280'; });
  function closeModal() { $('#bt-modal').hidden = true; }
  root.querySelectorAll('.bt-close').forEach(function (b) { b.addEventListener('click', closeModal); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#bt-modal').hidden) closeModal(); });
  $('#bt-post').addEventListener('input', function () { $('#bt-count').textContent = $('#bt-post').value.length + ' / 280'; });

  /* ---------- start ---------- */
  M.index = {}; M.sceneIndex = {};
  M.scenes.forEach(function (s) { M.sceneIndex[s.id] = s; });
  [].concat(M.poses, M.acc, M.props).forEach(function (it) { M.index[it.id] = it; });
  var fontsReady = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('400 40px "Bowlby One"'), document.fonts.load('700 40px "Space Grotesk"')]).catch(function () {}) : Promise.resolve();
  fontsReady.then(function () {
    var p = M.poses[0]; S.objs.push({ id: uid++, kind: 'pose', item: p.id, x: SIZE / 2, y: SIZE * .6, s: 780 / p.h, rot: 0, flip: false });
    S.objs.push({ id: uid++, kind: 'text', text: 'HOLDING UNTIL\nWE’RE FAT', font: 'bowlby', color: '#FFFFFF', stroke: '#111111', size: 92, x: SIZE / 2, y: SIZE * .13, s: 1, rot: 0, flip: false });
    ui(); draw();
  });
  window.addEventListener('resize', draw);
}

(function () {
  if (window.BOOTH_MANIFEST) { bootBooth(window.BOOTH_MANIFEST); return; }
  fetch('/booth/manifest.json').then(function (r) { return r.json(); }).then(bootBooth).catch(function () {
    var p = document.getElementById('bt-panel'); if (p) p.textContent = 'The meme pieces could not load. Refresh the page to try again.';
  });
})();

/* ---------- Wall of Fat ---------- */
(function () {
  var wall = document.getElementById('wall-grid'); if (!wall) return;
  var more = document.getElementById('wall-more'), empty = document.getElementById('wall-empty'), cursor = null;
  function tilt(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return ((h % 7) - 3) * .9; }
  function load() {
    fetch('/api/gallery' + (cursor ? '?before=' + encodeURIComponent(cursor) : ''))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        (j.items || []).forEach(function (it) {
          var a = document.createElement('button'); a.type = 'button'; a.className = 'wall-tile'; a.style.setProperty('--tilt', tilt(it.id) + 'deg');
          var im = new Image(); im.src = it.url; im.alt = 'A $FATHOOD meme made by the community'; im.loading = 'lazy'; a.appendChild(im);
          a.addEventListener('click', function () { var lb = document.getElementById('wall-lightbox'); lb.querySelector('img').src = it.url; lb.hidden = false; lb.querySelector('button').focus(); });
          wall.appendChild(a);
        });
        cursor = j.next || null; more.hidden = !cursor;
        empty.hidden = wall.children.length > 0;
        if (!wall.children.length) empty.textContent = 'No memes on the wall yet. Make one above and be the first.';
      })
      .catch(function () { empty.hidden = false; empty.textContent = 'The Wall of Fat goes live once the site is on Netlify. Make a meme above and it lands here after approval.'; });
  }
  more.addEventListener('click', load);
  var lb = document.getElementById('wall-lightbox');
  lb.addEventListener('click', function (e) { if (e.target === lb || e.target.tagName === 'BUTTON') lb.hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.hidden = true; });
  load();
})();
