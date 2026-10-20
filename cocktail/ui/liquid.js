// Рендер бокалов и жидкости на canvas: волны, слои, пузырьки, струя при наливе, вихрь при смешивании.
// Чисто визуальный слой: на расчёт игры не влияет. Одна общая петля requestAnimationFrame на все canvas.
const W = 120, H = 158, OY = 18, TAU = Math.PI * 2;
const GL = {
  coupe: { p: 'M18 18H102Q102 68 60 80Q18 68 18 18Z', y0: 22, y1: 80, top: 18, rx: 42, base: 124, stem: true,
    hl: [['M25 26Q27 54 48 69', .55, 2.4], ['M96 28Q95 40 90 50', .22, 1.6]] },
  highball: { p: 'M30 14H90L85 124H35Z', y0: 18, y1: 124, top: 14, rx: 30, base: 124, stem: false,
    hl: [['M36 22L39 114', .4, 3], ['M84 26L81 98', .18, 2]] },
  rocks: { p: 'M24 46H96L90 124H30Z', y0: 50, y1: 124, top: 46, rx: 36, base: 124, stem: false,
    hl: [['M31 54L34 114', .4, 3.2], ['M89 56L86 104', .18, 2]] },
};
const DEF = { glass: 'coupe', color: '#e8a33d', fill: .7, garnish: 'none', fx: [], layers: null, mix: 1, swirl: 0, pourSeq: 0, pourColor: null, w: 150, still: false, intro: false };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const hx = h => (/^#[0-9a-f]{6}$/i.test(String(h)) ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : [232, 163, 61]);
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const light = (c, t) => mixc(c, [255, 255, 255], t);
const rnd = i => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P2 = {};
function path(id) {
  if (!P2[id]) P2[id] = { body: new Path2D(GL[id].p), stem: new Path2D('M60 80V122'), hl: GL[id].hl.map(h => ({ p: new Path2D(h[0]), a: h[1], w: h[2] })) };
  return P2[id];
}

const memory = new Map(), registry = new WeakMap(), insts = new Set();
let raf = 0, last = 0;

function newState(c) {
  return { t: 0, ph: 0, fill: c.intro ? 0 : c.fill, rgb: hx(c.color), mixv: c.mix, sw: c.swirl, slosh: 0, layers: [], bubbles: [], pops: [], sparks: [], bacc: 0, sacc: 0, pourT: 0, pourRgb: [255, 255, 255], lastPour: null };
}
const surfaceY = (g, fill) => g.y1 - (g.y1 - g.y0) * clamp(fill);
const fxOf = c => (Array.isArray(c.fx) ? c.fx : []);

function targetLayers(inst) {
  const L = inst.cfg.layers, k = L ? JSON.stringify(L) : '';
  if (inst.lk !== k) {
    inst.lk = k;
    const list = (L || []).filter(l => l && l.amount > 0), tot = list.reduce((a, l) => a + l.amount, 0) || 1;
    inst.tl = list.map(l => ({ rgb: hx(l.color), f: l.amount / tot }));
  }
  return inst.tl;
}

function snap(inst) {
  const s = inst.state, c = inst.cfg;
  s.fill = clamp(c.fill); s.rgb = hx(c.color); s.mixv = c.mix; s.sw = c.swirl;
  s.layers = targetLayers(inst).map(l => ({ rgb: l.rgb.slice(), f: l.f }));
}

function step(inst, dtRaw) {
  const s = inst.state, c = inst.cfg, dt = dtRaw * (inst.fast ? 1.8 : 1), tf = Math.min(1, dt * 6), g = GL[c.glass] || GL.coupe, fx = fxOf(c);
  s.t += dt; s.ph += dt * (2.6 + s.sw * 4);
  const d = clamp(c.fill) - s.fill;
  s.fill += d * Math.min(1, dt * 5);
  s.slosh = Math.min(5, s.slosh + Math.abs(d) * tf * 14);
  const tc = hx(c.color);
  s.slosh = Math.min(5, s.slosh + (Math.abs(tc[0] - s.rgb[0]) + Math.abs(tc[1] - s.rgb[1]) + Math.abs(tc[2] - s.rgb[2])) * .0009 * tf);
  s.rgb = mixc(s.rgb, tc, Math.min(1, dt * 5));
  s.mixv += (c.mix - s.mixv) * Math.min(1, dt * 3);
  s.sw += (c.swirl - s.sw) * Math.min(1, dt * 4);
  if (c.pourSeq !== s.lastPour) { s.lastPour = c.pourSeq; if (c.pourColor) { s.pourT = .6; s.pourRgb = hx(c.pourColor); } }
  if (s.pourT > 0) { s.pourT = Math.max(0, s.pourT - dt); s.slosh = Math.max(s.slosh, 1.6); }
  s.slosh *= Math.exp(-dt * 1.8);
  const tl = targetLayers(inst);
  if (s.layers.length !== tl.length) s.layers = tl.map(l => ({ rgb: l.rgb.slice(), f: l.f }));
  else s.layers.forEach((l, i) => { l.rgb = mixc(l.rgb, tl[i].rgb, tf); l.f += (tl[i].f - l.f) * tf; });
  const ys = surfaceY(g, s.fill);
  // пузырьки
  const rate = (fx.includes('bubbles') ? 12 : 0) + s.sw * 14;
  if (s.fill > .08) s.bacc += rate * dt;
  while (s.bacc >= 1) {
    s.bacc -= 1;
    if (s.bubbles.length < 36) s.bubbles.push({ x: 60 + (Math.random() * 2 - 1) * (g.stem ? 14 : 24), y: g.y1 - 4, r: .9 + Math.random() * 1.6, v: 10 + Math.random() * 14, ph: Math.random() * TAU });
  }
  s.bubbles = s.bubbles.filter(b => {
    b.y -= b.v * dt; b.x += Math.sin(s.t * 3 + b.ph) * .12;
    if (b.y < ys + 1.5) { if (s.pops.length < 20) s.pops.push({ x: b.x, y: ys, u: 0 }); return false; }
    return true;
  });
  s.pops = s.pops.filter(p => (p.u += dt * 4) < 1);
  // искры
  if (fx.includes('sparkle')) s.sacc += 9 * dt;
  while (s.sacc >= 1) { s.sacc -= 1; if (s.sparks.length < 24) s.sparks.push({ x: 8 + Math.random() * 104, y: 4 + Math.random() * 124, u: 0, sp: .6 + Math.random() * .8, sz: 2 + Math.random() * 3 }); }
  s.sparks = s.sparks.filter(k => (k.u += dt * k.sp) < 1);
}

function curve(ctx, wy, dy = 0, rev = false) {
  if (!rev) { ctx.moveTo(0, wy(0) + dy); for (let x = 3; x <= W; x += 3) ctx.lineTo(x, wy(x) + dy); }
  else for (let x = W; x >= 0; x -= 3) ctx.lineTo(x, wy(x) + dy);
}

function drawGarnish(ctx, c, g, s, t) {
  const gar = c.garnish, top = g.top;
  if (gar === 'mint') {
    const sway = Math.sin(t * 1.5) * .05;
    [[-52, 1], [-18, .9], [18, .8]].forEach(([deg, k], i) => {
      ctx.save(); ctx.translate(g.rx > 40 ? 88 : 86, top - 1); ctx.rotate(deg * Math.PI / 180 + sway * (i + 1));
      const lg = ctx.createLinearGradient(0, -5, 0, 5); lg.addColorStop(0, '#7be39c'); lg.addColorStop(1, '#2f9a58');
      ctx.fillStyle = lg; ctx.strokeStyle = 'rgba(20,80,40,.7)'; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.ellipse(10 * k, 0, 11 * k, 4.8 * k, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20 * k, 0); ctx.stroke();
      ctx.restore();
    });
  } else if (gar === 'citrus') {
    ctx.save(); ctx.translate(g.rx > 40 ? 100 : 92, top + 1); ctx.rotate(-.28);
    ctx.fillStyle = '#ffc93c'; ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(0, 0, 9.4, 0, TAU); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8; ctx.fillStyle = i % 2 ? 'rgba(255,214,90,.85)' : 'rgba(255,230,130,.85)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 8.4, a + .05, a + TAU / 8 - .05); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 10.4, 3.6, 5.2); ctx.stroke();
    ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, TAU); ctx.stroke();
    ctx.restore();
  } else if (gar === 'sugar') {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2.4; ctx.setLineDash([1.6, 1.1]);
    ctx.beginPath(); ctx.ellipse(60, top, g.rx, 3.6, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (i + rnd(i) * .6) / 26, x = 60 - Math.cos(a) * g.rx, y = top + Math.sin(a) * 3.6 - 1 - rnd(i + 40) * 1.6;
      ctx.fillStyle = `rgba(255,255,255,${.55 + .45 * Math.sin(t * 3 + i * 1.7) ** 2})`; ctx.fillRect(x - .8, y - .8, 1.7, 1.7);
    }
  } else if (gar === 'orb') {
    const y = top - 14 + Math.sin(t * 1.7) * 2.2, p = .7 + .3 * Math.sin(t * 2.4);
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(60, y, 2, 60, y, 26); hg.addColorStop(0, `rgba(130,220,255,${.5 * p})`); hg.addColorStop(1, 'rgba(130,220,255,0)');
    ctx.fillStyle = hg; ctx.fillRect(30, y - 28, 60, 56); ctx.globalCompositeOperation = 'source-over';
    const og = ctx.createRadialGradient(57, y - 3, 1, 60, y, 8.5); og.addColorStop(0, '#fff'); og.addColorStop(.35, '#b6f1ff'); og.addColorStop(1, '#2fa8ff');
    ctx.fillStyle = og; ctx.beginPath(); ctx.arc(60, y, 8.5, 0, TAU); ctx.fill();
  }
}

function draw(inst) {
  const { ctx, canvas: cv, cfg: c, state: s } = inst, id = GL[c.glass] ? c.glass : 'coupe', g = GL[id], pp = path(id), sc = cv.width / W, t = s.t, col = s.rgb, fx = fxOf(c);
  ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(0, OY);
  const fill = clamp(s.fill), ys = surfaceY(g, fill), glow = fx.includes('glow');

  // ореол, тень и отражение на стойке
  const ha = (glow ? .34 + .08 * Math.sin(t * 2) : .14) * (fill > .02 ? 1 : .3);
  const hg = ctx.createRadialGradient(60, ys + 18, 6, 60, ys + 18, 82); hg.addColorStop(0, rgba(light(col, .25), ha)); hg.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = hg; ctx.fillRect(-20, -OY, W + 40, H);
  ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.beginPath(); ctx.ellipse(60, g.base + 1.5, g.stem ? 31 : 36, 4.2, 0, 0, TAU); ctx.fill();
  if (fill > .02) {
    ctx.save(); ctx.translate(60, g.base + 1); ctx.scale(1, .16);
    const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 48); rg.addColorStop(0, rgba(col, glow ? .6 : .4)); rg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = rg; ctx.fillRect(-52, -52, 104, 104); ctx.restore();
  }

  // содержимое бокала
  ctx.save(); ctx.clip(pp.body);
  if (fill > .012) {
    const amp = Math.min(6, .5 + s.slosh * 1.1 + s.sw * 2.2), tl = (s.slosh * .8 + s.sw * 2.2) * Math.sin(s.ph) * .045;
    const wy = x => ys + amp * (.55 * Math.sin(x * .11 + t * 2.4) + .35 * Math.sin(x * .19 - t * 1.9 + 1.3)) + (x - 60) * tl;
    const grad = ctx.createLinearGradient(0, ys - amp, 0, g.y1), L = s.layers.length ? s.layers : [{ rgb: col, f: 1 }], tot = L.reduce((a, l) => a + l.f, 0) || 1;
    let acc = 0;
    L.forEach(l => {
      const a = acc / tot, b = (acc += l.f) / tot, pad = (b - a) * .18, lc = rgba(mixc(l.rgb, col, clamp(s.mixv)), .93);
      grad.addColorStop(clamp(a + pad), lc); grad.addColorStop(clamp(b - pad), lc);
    });
    ctx.beginPath(); curve(ctx, wy); ctx.lineTo(W, 150); ctx.lineTo(0, 150); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    const dg = ctx.createLinearGradient(0, ys, 0, g.y1); dg.addColorStop(0, 'rgba(255,255,255,.22)'); dg.addColorStop(.25, 'rgba(255,255,255,.04)'); dg.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = dg; ctx.fill();
    const sg = ctx.createLinearGradient(12, 0, 108, 0); sg.addColorStop(0, 'rgba(0,0,0,.4)'); sg.addColorStop(.22, 'rgba(255,255,255,.1)'); sg.addColorStop(.35, 'rgba(255,255,255,0)'); sg.addColorStop(.75, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = sg; ctx.fill();
    // каустика на дне
    ctx.globalCompositeOperation = 'lighter';
    const cx = 60 + Math.sin(t * .8) * 16, cy = g.y1 - 14 + Math.cos(t * .6) * 3, cg = ctx.createRadialGradient(cx, cy, 1, cx, cy, 24);
    cg.addColorStop(0, rgba(light(col, .5), .28)); cg.addColorStop(1, rgba(col, 0)); ctx.fillStyle = cg; ctx.fillRect(0, 0, W, 140);
    ctx.globalCompositeOperation = 'source-over';
    // вихрь при смешивании
    if (s.sw > .03) {
      ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const yy = ys + 7 + i * Math.max(4, (g.y1 - ys - 10) / 3.6), rx = (g.stem ? 8 + (3 - i) * 3 : 14 + (3 - i) * 4) + (g.stem ? 0 : 6);
        if (yy > g.y1 - 3) break;
        ctx.strokeStyle = `rgba(255,255,255,${.3 * s.sw})`; ctx.setLineDash([9, 13]); ctx.lineDashOffset = -t * (34 + i * 12);
        ctx.beginPath(); ctx.ellipse(60, yy, rx, 3.4, 0, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // пузырьки
    s.bubbles.forEach(b => {
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(b.x - b.r * .45, b.y - b.r * .5, .8, .8);
    });
    // блик на поверхности
    ctx.beginPath(); curve(ctx, wy); ctx.strokeStyle = 'rgba(255,255,255,.62)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); curve(ctx, wy); curve(ctx, wy, 6, true); ctx.closePath();
    const bg = ctx.createLinearGradient(0, ys - 2, 0, ys + 7); bg.addColorStop(0, 'rgba(255,255,255,.3)'); bg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = bg; ctx.fill();
    s.pops.forEach(p => { ctx.strokeStyle = `rgba(255,255,255,${.7 * (1 - p.u)})`; ctx.lineWidth = .6; ctx.beginPath(); ctx.ellipse(p.x, p.y, 1 + p.u * 4, .5 + p.u * 1.2, 0, 0, TAU); ctx.stroke(); });
  }
  // лёд
  if (c.garnish === 'ice') {
    const b = Math.sin(t * 1.3) * 1.2;
    [[46, ys + 10 + b, 17, 12], [71, ys + 15 - b, 15, -10]].forEach(([x, y, sz, deg]) => {
      ctx.save(); ctx.translate(x, Math.min(y, g.y1 - 10)); ctx.rotate(deg * Math.PI / 180);
      ctx.fillStyle = 'rgba(255,255,255,.26)'; ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 1;
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz); ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(-sz / 2 + 2, -sz / 2 + 2, sz * .45, 2); ctx.fillRect(-sz / 2 + 2, -sz / 2 + 2, 2, sz * .4);
      ctx.restore();
    });
  }
  // толстое дно и общая тонировка стекла
  if (!g.stem) {
    const bg = ctx.createLinearGradient(0, g.y1 - 8, 0, g.y1); bg.addColorStop(0, 'rgba(255,255,255,.04)'); bg.addColorStop(1, 'rgba(255,255,255,.3)');
    ctx.fillStyle = bg; ctx.fillRect(0, g.y1 - 8, W, 8); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(0, g.y1 - 8, W, .8);
  }
  const tg = ctx.createLinearGradient(12, 0, 108, 0); tg.addColorStop(0, 'rgba(255,255,255,.16)'); tg.addColorStop(.18, 'rgba(255,255,255,.03)'); tg.addColorStop(.8, 'rgba(255,255,255,.02)'); tg.addColorStop(1, 'rgba(255,255,255,.12)');
  ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 140);
  ctx.restore();

  // контур, ножка, ободок, блики
  const og = ctx.createLinearGradient(14, 0, 106, 0); og.addColorStop(0, 'rgba(255,255,255,.85)'); og.addColorStop(.5, 'rgba(255,255,255,.35)'); og.addColorStop(1, 'rgba(255,255,255,.7)');
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = og; ctx.lineWidth = 2.2; ctx.stroke(pp.body);
  if (g.stem) {
    ctx.strokeStyle = 'rgba(235,225,205,.75)'; ctx.lineWidth = 3.2; ctx.stroke(pp.stem);
    ctx.beginPath(); ctx.ellipse(60, 124, 25, 3.6, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.4; ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(60, g.top, g.rx, 3.6, 0, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.3; ctx.stroke();
  pp.hl.forEach(h => { ctx.strokeStyle = `rgba(255,255,255,${h.a})`; ctx.lineWidth = h.w; ctx.stroke(h.p); });

  drawGarnish(ctx, c, g, s, t);

  // струя при наливе
  if (s.pourT > 0) {
    const p = Math.min(1, s.pourT * 8), x = 60 + Math.sin(t * 9) * .6;
    ctx.lineCap = 'round'; ctx.strokeStyle = rgba(s.pourRgb, .88 * p); ctx.lineWidth = 3.4 * p;
    ctx.beginPath(); ctx.moveTo(x + 3, -OY); ctx.quadraticCurveTo(x - 2, ys * .45, x, ys); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${.5 * p})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 2.2, -OY); ctx.quadraticCurveTo(x - 2.8, ys * .45, x - .8, ys); ctx.stroke();
    ctx.fillStyle = rgba(s.pourRgb, .9 * p);
    for (let i = 0; i < 6; i++) { const a = Math.abs(Math.sin(t * 14 + i * 1.7)); ctx.beginPath(); ctx.arc(60 + (i - 2.5) * 4.5, ys - a * 6, .9 + a * .4, 0, TAU); ctx.fill(); }
  }
  // искры
  s.sparks.forEach(k => {
    const a = Math.sin(k.u * Math.PI), z = k.sz * (.4 + .6 * a);
    ctx.strokeStyle = `rgba(255,236,170,${a})`; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(k.x - z, k.y); ctx.lineTo(k.x + z, k.y); ctx.moveTo(k.x, k.y - z); ctx.lineTo(k.x, k.y + z); ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(k.x - .6, k.y - .6, 1.2, 1.2);
  });
  ctx.restore();
}

function frame(now) {
  raf = 0;
  const dt = Math.min(.05, (now - last) / 1000 || .016); last = now;
  for (const i of insts) {
    if (!i.canvas.isConnected) { insts.delete(i); continue; }
    try { step(i, dt); draw(i); } catch (e) { console.error('[Cocktail Maker] liquid', e); insts.delete(i); }
  }
  if (insts.size) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf && insts.size) { last = performance.now(); raf = requestAnimationFrame(frame); } }

// ---------- публичный API ----------
export const html = (cfg = {}, key = '', cls = '') => `<canvas class="cm-liq ${cls}" ${key ? `data-key="${esc(key)}"` : ''} data-cfg="${esc(JSON.stringify(cfg))}"></canvas>`;

export function hydrate(el) {
  if (!el || typeof Path2D === 'undefined') return;
  el.querySelectorAll('canvas.cm-liq:not([data-ok])').forEach(cv => {
    cv.dataset.ok = '1';
    let cfg = {}; try { cfg = JSON.parse(cv.dataset.cfg || '{}'); } catch { /* пустой конфиг */ }
    cfg = { ...DEF, ...cfg };
    const key = cv.dataset.key; let state = key ? memory.get(key) : null;
    if (!state) { state = newState(cfg); if (key) memory.set(key, state); }
    if (state.lastPour === null) state.lastPour = cfg.pourSeq;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cfg.w, h = Math.round(w * H / W);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const inst = { canvas: cv, ctx: cv.getContext('2d'), cfg, state, still: !!cfg.still, animOff: !!cv.closest('.cm-anim-off'), fast: !!cv.closest('.cm-anim-fast') };
    registry.set(cv, inst);
    if (inst.still || inst.animOff) { snap(inst); draw(inst); } else { insts.add(inst); kick(); }
  });
}
export function update(cv, patch) {
  const inst = cv && registry.get(cv); if (!inst) return;
  Object.assign(inst.cfg, patch);
  if (inst.still || inst.animOff) { snap(inst); draw(inst); } else kick();
}
export const forget = (...keys) => keys.forEach(k => memory.delete(k));
export function reset() { memory.clear(); insts.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; }
