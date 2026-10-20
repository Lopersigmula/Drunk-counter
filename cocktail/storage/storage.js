// Хранилище: extension_settings SillyTavern (settings.json). Свой ключ, чат не затрагивается.
import { DEFAULT_CFG, num } from '../core/engine.js';
import { migrate } from './migrations.js';
const KEY = 'cocktail_maker', VER = 1;
let host, state;
export const defaults = () => ({
  v: VER, served: 0, recipes: [], history: [],
  settings: { auto: false, out: 'input', anim: 'normal', sound: false, simple: false, nums: true, hints: true },
  config: JSON.parse(JSON.stringify(DEFAULT_CFG)),
});
export function freeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; }
export function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const r = migrate(raw);
  const s = r.settings && typeof r.settings === 'object' ? r.settings : {};
  for (const k of ['auto', 'sound', 'simple', 'nums', 'hints']) if (typeof s[k] === 'boolean') d.settings[k] = s[k];
  if (['normal', 'fast', 'off'].includes(s.anim)) d.settings.anim = s.anim;
  if (['input', 'last'].includes(s.out)) d.settings.out = s.out;
  d.served = Math.round(num(r.served, 0, 0, 1e6));
  const c = r.config || {};
  for (const g of ['weights', 'mix']) for (const k in d.config[g]) d.config[g][k] = num(c[g] && c[g][k], d.config[g][k], 0, 1);
  if (Array.isArray(c.rankMins) && c.rankMins.length === 4 && c.rankMins.every(x => Number.isFinite(+x))) d.config.rankMins = c.rankMins.map(Number);
  d.recipes = (Array.isArray(r.recipes) ? r.recipes : []).filter(x => x && typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.items)).slice(0, 200);
  d.history = (Array.isArray(r.history) ? r.history : []).filter(e => e && typeof e.id === 'string' && e.r && e.r.type === 'cocktail_result' && e.r.scores).slice(0, 300).map(e => ({ id: e.id, sent: typeof e.sent === 'string' ? e.sent : (e.sent ? 'chat' : ''), drink: e.drink && typeof e.drink === 'object' ? { ok: !!e.drink.ok, names: Array.isArray(e.drink.names) ? e.drink.names.map(String).slice(0, 2) : [], note: String(e.drink.note || '') } : null, r: freeze(e.r) }));
  return d;
}
export function init(h) { host = h; state = sanitize(host.settings[KEY]); host.settings[KEY] = state; }
export const get = () => state;
export function save() { host.settings[KEY] = state; host.save(); }
export function reset() { state = defaults(); save(); return state; }
export function exportJSON() { return JSON.stringify({ app: 'cocktail_maker', ...state }, null, 1); }
export function importJSON(text) {
  let o; try { o = JSON.parse(text); } catch { throw new Error('файл не является JSON'); }
  if (!o || typeof o !== 'object' || !('served' in o || 'recipes' in o || 'history' in o)) throw new Error('это не сохранение Cocktail Maker');
  state = sanitize(o); save();
}
