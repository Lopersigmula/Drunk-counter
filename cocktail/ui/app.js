import { INGREDIENTS, GLASSES, GARNISHES, MAX_AMOUNT, STEP, isUnlocked, OFFLINE_ORDERS } from '../core/data.js';
import * as E from '../core/engine.js';
import { createSim, DT } from '../core/mixing-engine.js';
import * as S from '../storage/storage.js';
import * as ST from '../integration/st.js';
import * as LQ from './liquid.js';

const IM = Object.fromEntries(INGREDIENTS.map(i => [i.id, i]));
const GM = Object.fromEntries(GLASSES.map(g => [g.id, g]));
const AM = Object.fromEntries(GARNISHES.map(g => [g.id, g]));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['bar', '🍸', 'Бар'], ['station', '🧪', 'Станция'], ['recipes', '📖', 'Рецепты'], ['ingredients', '🌿', 'Состав'], ['history', '🕮', 'История'], ['settings', '⚙️', 'Опции']];
const TEMP = { cold: 'холодный', cool: 'прохладный', warm: 'тёплый', any: 'любой' };
const PRES = { elegant: 'элегантная', casual: 'простая', bold: 'яркая', any: 'любая' };
const STATS = [['sweetness', 'Сладость'], ['sourness', 'Кислотность'], ['bitterness', 'Горечь'], ['freshness', 'Свежесть'], ['richness', 'Насыщенность'], ['aroma', 'Аромат']];
const ORDKEY = { sweetness: 'sweetness', sourness: 'sourness', bitterness: 'bitterness', richness: 'intensity' };
const newDraft = (order = null, items = [], glass = 'coupe', garnish = 'none') => ({ order, items, glass, garnish, shots: null, name: '' });
const names = () => { const c = host.getContext(); return { user: c.name1 || 'Игрок', char: c.name2 || 'Персонаж' }; };
const DRINKERS = { user: ['user'], char: ['char'], both: ['user', 'char'], none: [] };

let root = null, mg = null, host = null, offIdx = 0, toastT = 0, ac = null;
let ui = { tab: 'bar', step: 0, draft: newDraft(), entry: null, pour: { seq: 0, color: null } };
const st = () => S.get();
export function init(h) { host = h; }

// ---------- helpers ----------
function toast(msg) {
  if (!root) return;
  let t = root.querySelector('.cm-toast');
  if (!t) { t = document.createElement('div'); t.className = 'cm-toast'; root.appendChild(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 4000);
}
function beep(f = 520, ms = 90) {
  if (!st().settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = f; g.gain.value = .05; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000);
  } catch { /* звук необязателен */ }
}
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const bar = (label, val, target, tol) => {
  const lo = target == null ? 0 : Math.max(0, target - tol), hi = target == null ? 0 : Math.min(100, target + tol);
  return `<div class="cm-bw"><label>${label}</label><div class="bar"><i style="width:${val}%"></i>${target != null ? `<b class="tz" style="left:${lo}%;width:${hi - lo}%"></b>` : ''}</div><em>${val}</em></div>`;
};

// Слои по плотности: лёгкое сверху, тяжёлое (сладкое/насыщенное) внизу.
const layersOf = items => E.cleanItems(items).sort((a, b) => (IM[a.id].sweet + IM[a.id].rich * .5) - (IM[b.id].sweet + IM[b.id].rich * .5)).map(i => ({ color: IM[i.id].color, amount: i.amount }));
const liqCfg = (d, o = {}) => { const t = E.calcTaste(d.items); return { glass: d.glass, color: t.color, fill: t.volume / GM[d.glass].cap, garnish: d.garnish, fx: t.fx, layers: layersOf(d.items), ...o }; };
const bumpPour = id => { ui.pour.seq++; ui.pour.color = IM[id].color; };

// ---------- views ----------
function orderCard(o, compact) {
  if (!o) return '';
  const sk = [['sweetness', 'Сладость'], ['sourness', 'Кислотность'], ['bitterness', 'Горечь'], ['intensity', 'Насыщенность']];
  return `<div class="cm-card cm-order"><div class="cm-q">«${esc(o.description)}»</div>
  <div class="cm-meta"><span>Сложность ${'★'.repeat(o.difficulty)}${'☆'.repeat(4 - o.difficulty)}</span><span>${TEMP[o.temperature]}</span><span>подача: ${PRES[o.presentation]}</span></div>
  ${compact && !st().settings.hints ? '' : sk.map(([k, l]) => bar(l, o[k].target, o[k].target, o[k].tolerance)).join('')}</div>`;
}
function viewBar() {
  const s = st(), o = ui.draft.order;
  return `<div class="cm-scene"><div class="cm-shelf">🍾 🥃 🍷 🍸</div>${LQ.html({ glass: 'coupe', color: '#ff9a3d', fill: .64, garnish: 'citrus', fx: ['glow', 'sparkle'], layers: [{ color: '#ffd27a', amount: 1 }, { color: '#ff8a3d', amount: 1.3 }, { color: '#d6394a', amount: 1 }], mix: .3, intro: true, w: 190 }, 'scene')}</div>
  ${o ? orderCard(o) + '<button class="cm-btn pri" data-act="goto-station">К рабочей станции</button><button class="cm-btn" data-act="drop-order">Отказаться от заказа</button>'
    : '<div class="cm-card"><b>Нет активного заказа</b><p class="cm-mut">Готовь свободно или возьми заказ из меню, чтобы получить оценку.</p></div>'}
  <button class="cm-btn pri" data-act="free">🧪 Приготовить коктейль</button>
  <button class="cm-btn" data-act="menu-order">📋 Заказ из меню (с оценкой)</button>
  <div class="cm-stats"><span>Заказов: ${s.served}</span><span>Рецептов: ${s.recipes.length}</span></div>`;
}
function viewStation() {
  const d = ui.draft, step = ui.step;
  const dots = ['Бокал', 'Состав', 'Смешивание', 'Подача'].map((n, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}">${i + 1}. ${n}</span>`).join('');
  let body = '';
  if (step === 0) {
    body = `<p class="cm-mut">Выбери бокал. От него зависят объём и стиль подачи.</p><div class="cm-grid3">${GLASSES.map(g => `<button class="cm-glass ${d.glass === g.id ? 'on' : ''}" data-act="glass" data-id="${g.id}">${LQ.html({ glass: g.id, fill: 0, still: true, w: 76 })}<span>${g.name}</span><small>${g.cap} мл</small></button>`).join('')}</div>`;
  } else if (step === 1) {
    const av = INGREDIENTS.filter(i => isUnlocked(i, st().served));
    body = `<p class="cm-mut">Нажми на ингредиент, чтобы добавить 10 мл. Меняй количество кнопками или ползунком.</p>
    <div class="cm-vol"><i id="cm-volbar"></i><span id="cm-voltxt"></span></div>
    <div class="cm-chips">${av.map(i => `<button class="cm-chip" style="--c:${i.color}" data-act="add" data-id="${i.id}">${i.emoji} ${esc(i.name)}${i.abv ? ` <small>${i.abv}%</small>` : ''}</button>`).join('')}</div>
    <div id="cm-rows">${d.items.map(rowHTML).join('')}</div><div id="cm-prev"></div>`;
  } else if (step === 2) {
    body = mixHTML();
  } else {
    const t = E.calcTaste(d.items), unl = GARNISHES.filter(g => isUnlocked(g, st().served));
    body = `<div class="cm-center">${LQ.html(liqCfg(d, { mix: 1, w: 180 }), 'fin')}</div>
    <p class="cm-mut">Украшение:</p><div class="cm-chips">${unl.map(g => `<button class="cm-chip ${d.garnish === g.id ? 'on' : ''}" data-act="garnish" data-id="${g.id}">${g.emoji} ${g.name}</button>`).join('')}</div>
    <input id="cm-name" class="cm-input" maxlength="40" placeholder="Название (по умолчанию: ${esc(E.autoName(d.items))})" value="${esc(d.name)}">`;
  }
  const canNext = step === 2 ? !!d.shots : true;
  return `${d.order ? orderCard(d.order, true) : '<div class="cm-chip on">Свободное приготовление</div>'}
  <div class="cm-steps">${dots}</div><div class="cm-step ${st().settings.anim}">${body}</div>
  <div class="cm-foot"><button class="cm-btn" data-act="cancel">Отмена</button><button class="cm-btn" data-act="back" ${step === 0 ? 'disabled' : ''}>Назад</button><button class="cm-btn pri" data-act="next" ${canNext ? '' : 'disabled'}>${step === 3 ? '🍸 Подать' : 'Далее'}</button></div>`;
}
function rowHTML(it) {
  const g = IM[it.id];
  return `<div class="cm-row" data-id="${it.id}"><span class="dot" style="background:${g.color};color:${g.color}"></span><b>${esc(g.name)}</b><span class="amt">${it.amount} мл</span>
  <button class="cm-sm" data-act="dec" data-id="${it.id}">−</button><input type="range" data-range min="0" max="${MAX_AMOUNT}" step="${STEP}" value="${it.amount}"><button class="cm-sm" data-act="inc" data-id="${it.id}">+</button><button class="cm-sm x" data-act="del" data-id="${it.id}">✕</button></div>`;
}
function paintStation1() {
  const d = ui.draft, t = E.calcTaste(d.items), cap = GM[d.glass].cap;
  const vb = root.querySelector('#cm-volbar'), vt = root.querySelector('#cm-voltxt'), pv = root.querySelector('#cm-prev');
  if (!vb) return;
  vb.style.width = Math.min(100, t.volume / cap * 100) + '%'; vt.textContent = `${t.volume} / ${cap} мл` + (t.abv > 0 ? ` · ${t.abv}%` : '');
  root.querySelectorAll('.cm-row').forEach(r => { const it = d.items.find(i => i.id === r.dataset.id); if (it) r.querySelector('.amt').textContent = it.amount + ' мл'; });
  const o = d.order;
  const cfg = liqCfg(d, { mix: .3, w: 170, pourSeq: ui.pour.seq, pourColor: ui.pour.color });
  const cv = pv.querySelector('canvas.cm-liq');
  if (cv) LQ.update(cv, cfg);
  else { pv.innerHTML = `<div class="cm-center">${LQ.html(cfg, 'prev')}</div><div id="cm-info"></div>`; LQ.hydrate(pv); }
  pv.querySelector('#cm-info').innerHTML = (st().settings.nums ? STATS.map(([k, l]) => bar(l, t.taste[k], o && ORDKEY[k] ? o[ORDKEY[k]].target : null, o && ORDKEY[k] ? o[ORDKEY[k]].tolerance : 0)).join('') : '') +
    (t.synergies.length ? `<p class="cm-syn">✨ Сочетание: ${t.synergies.map(esc).join(', ')}</p>` : '');
}
function mixHTML() {
  const d = ui.draft;
  if (!mg) {
    const m = E.scoreMix(d.shots, st().config.mix), w = d.shots && d.shots.win;
    const gc = liqCfg(d, { mix: 1, w: 150 }); if (w) gc.fx = [...gc.fx, 'sparkle'];
    return `<div class="cm-center">${LQ.html(gc, 'mix')}</div><div class="cm-card"><b>${w ? 'Смесь собрана! 🍸' : 'Смесь вышла неровной'}</b><p>Техника: <b>${m.technique}</b>/100<br><span class="cm-mut">Точность ${m.accuracy} · Стабильность ${m.stability} · Завершённость ${m.intensity}</span></p></div><button class="cm-btn" data-act="remix">↻ Повторить смешивание</button>`;
  }
  const h = mg.sim.h;
  return `<p class="cm-mut">Удерживай кнопку, чтобы поднимать зелёную полосу, и отпускай, чтобы она опускалась. Держи каплю 💧 внутри полосы: справа растёт шкала смеси. Игра начнётся с первого нажатия.</p>
  <div class="cm-mixrow">${LQ.html(liqCfg(d, { mix: .4, swirl: 0, w: 150 }), 'mix')}<div class="cm-fish"><div class="fld"><div class="fb" id="cm-fb" style="height:${h}%;bottom:0"></div><div class="ff" id="cm-ff"></div></div><div class="prog"><i id="cm-fp"></i></div></div></div>
  <div class="cm-mut cm-center" id="cm-ft">Время: 30 с</div>
  <button class="cm-hold" data-hold>Держи, чтобы поднимать</button>`;
}
function paintFish() {
  if (!root || !mg) return;
  const s = mg.sim, fb = root.querySelector('#cm-fb'), ff = root.querySelector('#cm-ff'), fp = root.querySelector('#cm-fp'), ft = root.querySelector('#cm-ft');
  if (!fb) return;
  fb.style.bottom = (s.bar - s.h / 2) + '%'; ff.style.bottom = s.fish + '%'; fp.style.height = Math.max(0, s.progress) + '%';
  fb.classList.toggle('hit', Math.abs(s.fish - s.bar) <= s.h / 2);
  if (!mg.cv || !mg.cv.isConnected) mg.cv = root.querySelector('canvas.cm-liq[data-key="mix"]');
  if (mg.cv) LQ.update(mg.cv, { mix: Math.max(0, s.progress) / 100, swirl: mg.running ? (mg.holding ? 1 : .55) : 0 });
  if (ft) ft.textContent = 'Время: ' + Math.max(0, Math.ceil(30 - s.t)) + ' с';
}
function viewRecipes() {
  const rs = [...st().recipes].sort((a, b) => b.best - a.best);
  const dom = r => STATS.slice(0, 4).map(([k]) => k).reduce((a, k) => (r.taste[k] > r.taste[a] ? k : a), 'sweetness');
  return `<input id="cm-q" class="cm-input" placeholder="Поиск по названию"><select id="cm-f" class="cm-input"><option value="">Любой вкус</option><option value="sweetness">Сладкие</option><option value="sourness">Кислые</option><option value="bitterness">Горькие</option></select>
  <div id="cm-rlist">${rs.map(r => `<div class="cm-card cm-rec" data-n="${esc(r.name.toLowerCase())}" data-d="${dom(r)}"><b>${esc(r.name)}</b>
  <p class="cm-mut">${r.items.map(i => esc((IM[i.id] || { name: i.id }).name) + ' ' + i.amount).join(' · ')}<br>${esc((GM[r.glass] || { name: '' }).name)}, ${esc((AM[r.garnish] || { name: '' }).name)} · ${esc(String(r.created || '').slice(0, 10))}</p>
  <div class="cm-two"><button class="cm-btn pri" data-act="repeat" data-id="${esc(r.id)}">Приготовить</button><button class="cm-btn" data-act="del-recipe" data-id="${esc(r.id)}">Удалить</button></div></div>`).join('') || '<p class="cm-mut">Рецептов пока нет. Хорошие напитки (от 60 баллов) сохраняются сами.</p>'}</div>`;
}
function viewIngredients() {
  return INGREDIENTS.map(i => {
    const open = isUnlocked(i, st().served);
    return `<div class="cm-card ${open ? '' : 'lock'}"><b>${i.emoji} ${esc(i.name)}</b> <span class="cm-mut">${i.abv ? 'алкоголь, ' + i.abv + '%' : i.rarity}</span>${open ? STATS.map(([k, l], n) => bar(l, [i.sweet, i.sour, i.bitter, i.fresh, i.rich, i.aroma][n])).join('') : `<p class="cm-mut">🔒 Откроется после ${i.unlock} заказов</p>`}</div>`;
  }).join('');
}
const sentLabel = e => e.sent === 'input' ? '✅ в поле ввода' : e.sent === 'last' ? '✅ в сообщении' : e.sent ? '✅ передано' : '';
function viewHistory() {
  return st().history.map(e => `<div class="cm-card"><b>${esc(e.r.drinkName)}</b>
  <p class="cm-mut">${e.r.mode === 'order' ? '«' + esc(e.r.orderDesc) + '»' : 'Свободное приготовление'}</p>
  <div class="cm-two"><button class="cm-btn" data-act="open-entry" data-id="${esc(e.id)}">Открыть</button><span class="cm-mut">${sentLabel(e)}</span></div><div class="cm-two"><button class="cm-btn" data-act="send-input" data-id="${esc(e.id)}">В поле ввода</button><button class="cm-btn" data-act="send-last" data-id="${esc(e.id)}">В сообщение</button></div></div>`).join('') || '<p class="cm-mut">История пуста.</p>';
}
function viewSettings() {
  const s = st().settings, ck = (k, l) => `<label class="cm-tog"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}> ${l}</label>`;
  return `<div class="cm-card">${ck('auto', 'Автоматически выводить результат при подаче')}
  <label class="cm-tog">Куда выводить: <select data-set="out" class="cm-input"><option value="input" ${s.out === 'input' ? 'selected' : ''}>в поле ввода</option><option value="last" ${s.out === 'last' ? 'selected' : ''}>в последнее сообщение пользователя</option></select></label>${ck('sound', 'Звуки')}${ck('simple', 'Упрощённая мини-игра (шире зона, медленнее шкала)')}${ck('nums', 'Показывать числовые характеристики')}${ck('hints', 'Показывать подсказки по заказу')}
  <label class="cm-tog">Анимации: <select data-set="anim" class="cm-input"><option value="normal" ${s.anim === 'normal' ? 'selected' : ''}>обычные</option><option value="fast" ${s.anim === 'fast' ? 'selected' : ''}>быстрые</option><option value="off" ${s.anim === 'off' ? 'selected' : ''}>выключены</option></select></label></div>
  <button class="cm-btn" data-act="export">⬇ Экспорт прогресса (JSON)</button><button class="cm-btn" data-act="import">⬆ Импорт прогресса</button><input type="file" id="cm-file" accept="application/json,.json" hidden>
  <button class="cm-btn danger" data-act="reset">Сбросить прогресс</button>`;
}
function drinkBlock(e) {
  const r = e.r;
  if (!(r.abv > 0)) return '<div class="cm-card cm-mut">Безалкогольный коктейль: в Drunk Tracker нечего записывать.</div>';
  const head = `🥃 Крепость ~${r.abv}% · объём ${r.volume} мл`;
  if (e.drink) return `<div class="cm-card">${head}<br><span class="cm-mut">${e.drink.ok ? '✅ Учтено в Drunk Tracker: ' + esc(e.drink.names.join(', ')) : e.drink.names.length ? '⚠️ ' + esc(e.drink.note || 'не удалось учесть') : 'Никто не пьёт'}</span></div>`;
  const nm = names();
  return `<div class="cm-card">${head}<p><b>Кто выпьет этот коктейль?</b></p><div class="cm-chips">${[['user', nm.user], ['char', nm.char], ['both', 'Оба'], ['none', 'Никто']].map(([k, l]) => `<button class="cm-chip" data-act="drink-confirm" data-id="${k}">${esc(String(l).slice(0, 18))}</button>`).join('')}</div><p class="cm-mut">Подтверждение сразу запишет напиток в Drunk Tracker.</p></div>`;
}
function viewResult() {
  const e = ui.entry, r = e.r, rec = st().recipes.some(x => E.recipeMatch(x.items, r.ingredients));
  const G = GM[r.glass];
  return `<div class="cm-center">${LQ.html({ glass: r.glass, color: r.color, fill: r.volume / (G ? G.cap : 90), garnish: r.garnish, fx: r.fx || [], layers: layersOf(r.ingredients), mix: 1, intro: true, w: 200 }, 'res')}</div>
  <h2 class="cm-title">${esc(r.drinkName)}</h2>
  <div class="cm-card">${STATS.map(([k, l]) => bar(l, r.taste[k])).join('')}</div>
  <p class="cm-mut">${r.ingredients.map(i => esc((IM[i.id] || { name: i.id }).name) + ' ' + i.amount + ' мл').join(' · ')}${r.synergies.length ? '<br>✨ ' + r.synergies.map(esc).join(', ') : ''}</p>
  ${drinkBlock(e)}
  ${e.sent ? `<div class="cm-chip on">${sentLabel(e)}</div>` : ''}
  <div class="cm-two"><button class="cm-btn pri" data-act="send-input" data-id="${esc(e.id)}">⌨️ В поле ввода</button><button class="cm-btn pri" data-act="send-last" data-id="${esc(e.id)}">💬 В последнее сообщение</button></div>
  ${rec ? '<div class="cm-chip">📖 В книге рецептов</div>' : '<button class="cm-btn" data-act="save-recipe">📖 Сохранить рецепт</button>'}
  <button class="cm-btn" data-act="to-bar">Вернуться за стойку</button>`;
}

// ---------- render ----------
const VIEWS = { bar: viewBar, station: viewStation, recipes: viewRecipes, ingredients: viewIngredients, history: viewHistory, settings: viewSettings, result: viewResult };
function render() {
  if (!root) return;
  const body = root.querySelector('.cm-body'), keep = body ? body.scrollTop : 0, key = ui.tab + ui.step;
  let html;
  try { html = VIEWS[ui.tab](); } catch (e) { console.error('[Cocktail Maker]', e); html = '<div class="cm-card">Ошибка отображения. Закрой и открой бар заново.</div>'; }
  root.className = 'cm-root cm-anim-' + st().settings.anim;
  root.innerHTML = `<header class="cm-head"><button class="cm-back" data-act="to-tracker">📊 Трекер</button><span>🍸 Cocktail Maker</span><button class="cm-x" data-act="close" aria-label="Закрыть">✕</button></header>
  <main class="cm-body">${html}</main>
  <nav class="cm-nav">${TABS.map(([id, ic, n]) => `<button class="${ui.tab === id ? 'on' : ''}" data-act="tab" data-id="${id}"><span>${ic}</span>${n}</button>`).join('')}</nav>`;
  const nb = root.querySelector('.cm-body'); if (nb && key === root._key) nb.scrollTop = keep; root._key = key;
  LQ.hydrate(root);
  if (ui.tab === 'station' && ui.step === 1) paintStation1();
  if (ui.tab === 'station' && ui.step === 2) paintFish();
}

// ---------- mini-game ----------
function stopMix() {
  if (mg && mg.raf) cancelAnimationFrame(mg.raf);
  window.removeEventListener('pointerup', holdEnd); window.removeEventListener('pointercancel', holdEnd);
  mg = null;
}
function startMix() {
  stopMix();
  const d = ui.draft, seed = (d.order ? d.order.id : 'free') + d.items.map(i => i.id + i.amount).join();
  d.shots = null;
  mg = { sim: createSim(d.order ? d.order.difficulty : 2, seed, st().settings.simple), holding: false, running: false, acc: 0, last: 0, raf: 0 };
}
function loop(now) {
  if (!mg) return;
  mg.acc += Math.min(100, now - mg.last) / 1000; mg.last = now;
  let n = 0;
  while (mg.acc >= DT && !mg.sim.done && n++ < 8) { mg.sim.step(mg.holding); mg.acc -= DT; }
  paintFish();
  if (mg.sim.done) { ui.draft.shots = mg.sim.stats(); beep(mg.sim.win ? 880 : 220, 160); stopMix(); render(); return; }
  mg.raf = requestAnimationFrame(loop);
}
function holdStart(e) {
  if (!mg || mg.holding) return;
  e.preventDefault(); mg.holding = true;
  if (!mg.running) { mg.running = true; mg.last = performance.now(); mg.raf = requestAnimationFrame(loop); }
  window.addEventListener('pointerup', holdEnd); window.addEventListener('pointercancel', holdEnd);
}
function holdEnd() {
  if (mg) mg.holding = false;
  window.removeEventListener('pointerup', holdEnd); window.removeEventListener('pointercancel', holdEnd);
}

// ---------- logic ----------
function setAmount(id, a) {
  const d = ui.draft, it = d.items.find(i => i.id === id); if (!it) return false;
  const others = d.items.reduce((s, i) => s + (i.id === id ? 0 : i.amount), 0);
  a = Math.round(E.num(a, 0, 0, MAX_AMOUNT) / STEP) * STEP;
  a = Math.min(a, GM[d.glass].cap - others);
  d.shots = null;
  if (a <= 0) { d.items = d.items.filter(i => i.id !== id); return true; }
  it.amount = a; return false;
}
function addIngredient(id) {
  const d = ui.draft; if (!IM[id] || !isUnlocked(IM[id], st().served)) return;
  const total = d.items.reduce((s, i) => s + i.amount, 0), cap = GM[d.glass].cap;
  if (total >= cap) return toast('Бокал полон');
  d.shots = null;
  const it = d.items.find(i => i.id === id);
  if (it) setAmount(id, it.amount + 10); else d.items.push({ id, amount: Math.min(10, cap - total) });
  bumpPour(id);
}
function finalize() {
  const d = ui.draft, s = st();
  if (!E.cleanItems(d.items).length || !d.shots) return toast('Сначала добавь ингредиенты и смешай');
  const before = INGREDIENTS.filter(i => isUnlocked(i, s.served)).length;
  const r = E.evaluate({ items: d.items, glassId: d.glass, garnishId: d.garnish, order: d.order, shots: d.shots, cfg: s.config, name: (d.name || '').trim() || E.autoName(d.items) });
  r.createdAt = new Date().toISOString();
  const entry = { id: 'h_' + Date.now().toString(36) + s.history.length, sent: '', drink: null, r: S.freeze(r) };
  s.history.unshift(entry); s.history = s.history.slice(0, 300);
  if (d.order) s.served++;
  const added = autoRecipe(r);
  S.save();
  const after = INGREDIENTS.filter(i => isUnlocked(i, s.served)).length;
  ui.entry = entry; ui.tab = 'result'; ui.draft = newDraft(); ui.step = 0; stopMix(); LQ.forget('prev', 'mix', 'fin');
  beep(880, 160); render();
  if (after > before) toast('🔓 Открыт новый ингредиент!'); else if (added) toast('📖 Рецепт добавлен в книгу');
}
function autoRecipe(r) {
  const s = st(), ex = s.recipes.find(x => E.recipeMatch(x.items, r.ingredients));
  if (ex) { ex.best = Math.max(ex.best, r.scores.total); return false; }
  if (r.scores.total < 60) return false;
  s.recipes.unshift({ id: 'r_' + Date.now().toString(36), name: r.drinkName, items: r.ingredients, glass: r.glass, garnish: r.garnish, taste: r.taste, best: r.scores.total, created: r.createdAt });
  s.recipes = s.recipes.slice(0, 200); return true;
}
function confirmDrink(entry, key) {
  if (!entry || entry.drink) return;
  const r = entry.r, who = DRINKERS[key] || [], nm = names(), list = who.map(k => nm[k]);
  let ok = false, note = '';
  if (who.length && r.abv > 0 && host && typeof host.logDrink === 'function') {
    try {
      const res = host.logDrink({ subjects: who, name: r.drinkName, abv: r.abv, ml: r.volume, color: r.color });
      ok = !!(res && res.ok); if (!ok) note = (res && res.reason) || 'не удалось учесть в трекере';
    } catch (e) { console.error('[Cocktail Maker]', e); note = 'не удалось учесть в трекере'; }
  }
  entry.drink = { ok, names: list, note }; S.save();
  toast(ok ? 'Записано в Drunk Tracker' : who.length ? '⚠️ ' + note : 'Напиток никто не пьёт');
  render();
  if (st().settings.auto) sendEntry(entry);
}
async function sendEntry(entry, target) {
  if (!entry || entry._busy) return;
  target = target || st().settings.out;
  entry._busy = true;
  try { await ST.sendResult(entry.r, target, entry.drink && entry.drink.ok ? entry.drink.names : []); entry.sent = target; S.save(); toast(target === 'last' ? 'Добавлено в последнее сообщение' : 'Добавлено в поле ввода'); }
  catch (e) { toast('Не удалось вывести: ' + e.message); }
  finally { delete entry._busy; render(); }
}
const entryById = id => st().history.find(e => e.id === id);

function onClick(e) {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act, id = a.dataset.id, d = ui.draft;
  switch (act) {
    case 'close': return close();
    case 'tab': if (ui.tab === 'station' && ui.step === 2) stopMix(); ui.tab = id; if (id === 'station' && ui.step === 2 && !d.shots) { ui.step = 1; } return render();
    case 'to-tracker': close(); if (host && host.openTracker) host.openTracker(); return;
    case 'drink-confirm': return confirmDrink(ui.entry, id);
    case 'menu-order': ui.draft = newDraft(E.sanitizeOrder(OFFLINE_ORDERS[offIdx++ % OFFLINE_ORDERS.length], 'menu')); return render();
    case 'free': LQ.forget('prev', 'mix', 'fin'); ui.draft = newDraft(); ui.step = 0; ui.tab = 'station'; return render();
    case 'drop-order': ui.draft = newDraft(); return render();
    case 'goto-station': ui.tab = 'station'; ui.step = 0; return render();
    case 'glass': d.glass = id; d.shots = null; { const cap = GM[id].cap; let t = 0; d.items = d.items.map(i => { const x = { ...i, amount: Math.min(i.amount, cap - t) }; t += x.amount; return x; }).filter(i => i.amount > 0); } return render();
    case 'add': addIngredient(id); return render();
    case 'inc': { const it = d.items.find(i => i.id === id); if (it) { const b4 = it.amount; setAmount(id, it.amount + STEP); if (it.amount > b4) bumpPour(id); } return render(); }
    case 'dec': { const it = d.items.find(i => i.id === id); if (it) setAmount(id, it.amount - STEP); return render(); }
    case 'del': d.items = d.items.filter(i => i.id !== id); d.shots = null; return render();
    case 'garnish': d.garnish = id; return render();
    case 'back': stopMix(); ui.step = Math.max(0, ui.step - 1); return render();
    case 'next':
      if (ui.step === 1) { if (!E.cleanItems(d.items).length) return toast('Добавь хотя бы один ингредиент'); ui.step = 2; if (!d.shots) startMix(); return render(); }
      if (ui.step === 3) return finalize();
      ui.step++; return render();
    case 'remix': startMix(); return render();
    case 'cancel': if (confirm('Отменить приготовление? Прогресс текущего напитка будет потерян.')) { stopMix(); LQ.forget('prev', 'mix', 'fin'); ui.draft = newDraft(ui.draft.order); ui.step = 0; ui.tab = 'bar'; render(); } return;
    case 'to-bar': ui.tab = 'bar'; return render();
    case 'send-input': return sendEntry(entryById(id), 'input');
    case 'send-last': return sendEntry(entryById(id), 'last');
    case 'open-entry': ui.entry = entryById(id); if (ui.entry) { ui.tab = 'result'; render(); } return;
    case 'save-recipe': { const r = ui.entry.r; const s = st();
      if (!s.recipes.some(x => E.recipeMatch(x.items, r.ingredients))) { s.recipes.unshift({ id: 'r_' + Date.now().toString(36), name: r.drinkName, items: r.ingredients, glass: r.glass, garnish: r.garnish, taste: r.taste, best: r.scores.total, created: r.createdAt }); S.save(); } return render(); }
    case 'repeat': { const r = st().recipes.find(x => x.id === id); if (!r) return; ui.draft = newDraft(d.order, E.cleanItems(r.items).filter(i => isUnlocked(IM[i.id], st().served)), GM[r.glass] ? r.glass : 'coupe', AM[r.garnish] ? r.garnish : 'none'); ui.step = 1; ui.tab = 'station'; return render(); }
    case 'del-recipe': if (confirm('Удалить рецепт?')) { const s = st(); s.recipes = s.recipes.filter(x => x.id !== id); S.save(); render(); } return;
    case 'export': { const b = new Blob([S.exportJSON()], { type: 'application/json' }), u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = 'cocktail-maker-save.json'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); return; }
    case 'import': { const f = root.querySelector('#cm-file'); if (f) f.click(); return; }
    case 'reset': if (confirm('Сбросить весь прогресс (рецепты, историю, ингредиенты)? Это нельзя отменить.')) { S.reset(); ui = { tab: 'bar', step: 0, draft: newDraft(), entry: null, pour: { seq: 0, color: null } }; render(); } return;
  }
}
function onInput(e) {
  const t = e.target;
  if (t.matches('[data-range]')) { const row = t.closest('.cm-row'); const removed = setAmount(row.dataset.id, t.value); if (removed) render(); else paintStation1(); }
  else if (t.id === 'cm-name') ui.draft.name = t.value;
  else if (t.id === 'cm-q' || t.id === 'cm-f') {
    const q = root.querySelector('#cm-q').value.trim().toLowerCase(), f = root.querySelector('#cm-f').value;
    root.querySelectorAll('.cm-rec').forEach(c => { c.hidden = !(c.dataset.n.includes(q) && (!f || c.dataset.d === f)); });
  }
}
function onChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.set) { const s = st().settings; s[t.dataset.set] = t.type === 'checkbox' ? t.checked : t.value; S.save(); render(); }
  else if (t.id === 'cm-file' && t.files[0]) {
    const rd = new FileReader();
    rd.onload = () => { try { if (confirm('Заменить текущий прогресс данными из файла?')) { S.importJSON(String(rd.result)); ui = { tab: 'bar', step: 0, draft: newDraft(), entry: null, pour: { seq: 0, color: null } }; toast('Прогресс импортирован'); render(); } } catch (err) { toast('Импорт не удался: ' + err.message); } };
    rd.readAsText(t.files[0]);
  }
}
function onDown(e) { const h = e.target.closest('[data-hold]'); if (h) holdStart(e); }

export function open() {
  if (root) return;
  root = document.createElement('div');
  root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange);
  root.addEventListener('pointerdown', onDown); root.addEventListener('contextmenu', e => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
  document.body.appendChild(root); render();
}
export function close() { stopMix(); LQ.reset(); if (root) { root.remove(); root = null; } }
