// Игровой движок: вся математика здесь. Детерминированный, без Math.random.
import { INGREDIENTS, GLASSES, GARNISHES, SYNERGIES, MAX_AMOUNT } from './data.js';
import { scoreMix } from './mixing-engine.js';
export { scoreMix };
const IM = Object.fromEntries(INGREDIENTS.map(i => [i.id, i]));
export const num = (v, d, a = 0, b = 100) => {
  const n = (typeof v === 'string' && v.trim() === '') || v === null || typeof v === 'boolean' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d;
};
export const hash = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h; };
export const DEFAULT_CFG = {
  weights: { orderFit: .45, balance: .25, technique: .20, presentation: .10 },
  mix: { accuracy: .5, stability: .3, intensity: .2 },
  rankMins: [90, 75, 60, 40],
};
const RANKS = [['outstanding', 'Выдающийся'], ['excellent', 'Отличный'], ['good', 'Хороший'], ['mediocre', 'Посредственный']];
export function rankOf(score, mins = DEFAULT_CFG.rankMins) {
  for (let i = 0; i < RANKS.length; i++) if (score >= mins[i]) return { id: RANKS[i][0], label: RANKS[i][1], stars: 5 - i };
  return { id: 'bad', label: 'Неудачный', stars: 1 };
}
export function cleanItems(items) {
  const m = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !IM[it.id]) continue;
    const a = Math.round(num(it.amount, 0, 0, MAX_AMOUNT));
    if (a > 0) m.set(it.id, a);
  }
  return [...m].map(([id, amount]) => ({ id, amount }));
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
export function calcTaste(items) {
  const list = cleanItems(items);
  const map = { sweetness: 'sweet', sourness: 'sour', bitterness: 'bitter', freshness: 'fresh', richness: 'rich', aroma: 'aroma' };
  const s = { sweetness: 0, sourness: 0, bitterness: 0, freshness: 0, richness: 0, aroma: 0 };
  const rgb = [0, 0, 0], fx = new Set(); let tot = 0, alc = 0;
  for (const { id, amount } of list) {
    const g = IM[id]; tot += amount; alc += amount * (g.abv || 0) / 100;
    for (const k in map) s[k] += g[map[k]] * amount;
    hex(g.color).forEach((c, i) => rgb[i] += c * amount);
    g.fx.forEach(f => fx.add(f));
  }
  const syn = [];
  if (tot > 0) {
    for (const k in s) s[k] /= tot;
    const has = id => list.some(x => x.id === id && x.amount >= 5);
    for (const sy of SYNERGIES) if (has(sy.a) && has(sy.b)) { syn.push(sy.name); for (const k in sy.bonus) s[k] += sy.bonus[k]; }
  }
  for (const k in s) s[k] = Math.round(num(s[k], 0));
  const color = '#' + rgb.map(c => Math.round(tot ? c / tot : 80).toString(16).padStart(2, '0')).join('');
  return { taste: s, volume: tot, color, fx: [...fx], synergies: syn, alcoholMl: +alc.toFixed(2), abv: tot ? +(alc / tot * 100).toFixed(1) : 0 };
}
export function calcBalance(t, glass) {
  const { sweetness: a, sourness: b, bitterness: c } = t.taste, sum = a + b + c;
  let bal = 100;
  if (sum > 0) bal -= Math.max(0, Math.max(a, b, c) / sum - .55) * 110; else bal -= 20;
  bal -= Math.max(0, Math.max(a, b, c) - 85);
  const min = glass.cap * .5;
  if (t.volume < min) bal -= (min - t.volume) * 1.2;
  bal += t.synergies.length * 4;
  return Math.round(num(bal, 0));
}
export function paramScore(dev, tol) {
  return dev <= tol ? 100 - (dev / tol) * 10 : Math.max(0, 90 - (dev - tol) * 90 / 50);
}
const TEMP = { cold: [75, 25], cool: [55, 25], warm: [25, 25] };
export const LABELS = { sweetness: 'Сладость', sourness: 'Кислотность', bitterness: 'Горечь', intensity: 'Насыщенность', temperature: 'Температура' };
export function orderFit(taste, order) {
  const rows = [['sweetness', taste.sweetness], ['sourness', taste.sourness], ['bitterness', taste.bitterness], ['intensity', taste.richness]]
    .map(([key, actual]) => ({ key, actual, target: order[key].target, tol: order[key].tolerance }));
  if (TEMP[order.temperature]) rows.push({ key: 'temperature', actual: taste.freshness, target: TEMP[order.temperature][0], tol: TEMP[order.temperature][1] });
  const details = rows.map(r => {
    const score = Math.round(paramScore(Math.abs(r.actual - r.target), r.tol));
    return { ...r, label: LABELS[r.key], score, ok: Math.abs(r.actual - r.target) <= r.tol };
  });
  return { score: Math.round(details.reduce((a, d) => a + d.score, 0) / details.length), details };
}
export function calcPresentation(glass, garnish, style) {
  const any = !style || style === 'any';
  return 40 + (garnish.id !== 'none' ? 20 : 0) + (any || garnish.styles.includes(style) ? 20 : 0) + (any || glass.style === style ? 20 : 0);
}
let seq = 0;
export function sanitizeOrder(raw, source = 'menu') {
  const o = raw && typeof raw === 'object' ? raw : {};
  const p = (k, dt) => { const v = o[k], isO = v && typeof v === 'object'; return { target: Math.round(num(isO ? v.target : v, dt)), tolerance: Math.round(num(isO ? v.tolerance : undefined, 20, 5, 40)) }; };
  const order = {
    id: 'order_' + Date.now().toString(36) + (++seq), source,
    temperature: ['cold', 'cool', 'warm', 'any'].includes(o.temperature) ? o.temperature : 'any',
    sweetness: p('sweetness', 40), sourness: p('sourness', 40), bitterness: p('bitterness', 25), intensity: p('intensity', 45),
    presentation: ['elegant', 'casual', 'bold', 'any'].includes(o.presentation) ? o.presentation : 'any',
    description: String(o.description || 'Налей что-нибудь на своё усмотрение.').replace(/[<>]/g, '').slice(0, 200),
  };
  const avg = (order.sweetness.tolerance + order.sourness.tolerance + order.bitterness.tolerance + order.intensity.tolerance) / 4;
  order.difficulty = avg >= 30 ? 1 : avg >= 22 ? 2 : avg >= 15 ? 3 : 4; // решает движок; предложение нейросети игнорируется
  return order;
}
export function autoName(items) {
  const A = ['Лунный', 'Полночный', 'Янтарный', 'Серебряный', 'Тихий'], B = ['сад', 'бриз', 'закат', 'шёпот', 'огонь'];
  const h = hash(cleanItems(items).map(i => i.id + i.amount).join());
  return A[h % 5] + ' ' + B[(h >> 3) % 5];
}
export function recipeMatch(a, b, tol = 5) {
  const x = cleanItems(a), y = cleanItems(b);
  return x.length === y.length && x.every(i => y.some(j => j.id === i.id && Math.abs(j.amount - i.amount) <= tol));
}
export function evaluate({ items, glassId, garnishId, order, shots, cfg = DEFAULT_CFG, name }) {
  const list = cleanItems(items);
  const glass = GLASSES.find(g => g.id === glassId) || GLASSES[0];
  const garnish = GARNISHES.find(g => g.id === garnishId) || GARNISHES[0];
  const t = calcTaste(list), balance = calcBalance(t, glass);
  const fit = order ? orderFit(t.taste, order) : null;
  const m = scoreMix(shots, cfg.mix), pres = calcPresentation(glass, garnish, order ? order.presentation : 'any');
  const w = cfg.weights, wo = fit ? w.orderFit : 0, sw = (wo + w.balance + w.technique + w.presentation) || 1;
  const ofv = fit ? fit.score : null; // без заказа оценки соответствия нет, итог считается без неё
  const total = Math.round(num(((fit ? fit.score * wo : 0) + balance * w.balance + m.technique * w.technique + pres * w.presentation) / sw, 0));
  const rk = rankOf(total, cfg.rankMins);
  return {
    type: 'cocktail_result', orderId: order ? order.id : null, drinkName: String(name || autoName(list)).slice(0, 40),
    ingredients: list, glass: glass.id, garnish: garnish.id, taste: t.taste, volume: t.volume, abv: t.abv, alcoholMl: t.alcoholMl, color: t.color, fx: t.fx, synergies: t.synergies,
    scores: { orderFit: ofv, balance, technique: m.technique, presentation: pres, total },
    mixDetail: { accuracy: m.accuracy, stability: m.stability, intensity: m.intensity },
    rank: rk.id, rankLabel: rk.label, stars: rk.stars, matches: fit ? fit.details : [], mix: shots || null,
    orderDesc: order ? order.description : '', mode: order ? 'order' : 'free',
  };
}
