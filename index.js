/* ============================================================
 *  Drunk Tracker — учёт алкоголя и опьянения для SillyTavern
 *  • {{user}} и {{char}} отслеживаются независимо
 *  • напитки: автоматически (по тексту сообщений) и вручную
 *  • опьянение снижается ТОЛЬКО по событиям RP или вручную
 *  • уровень опьянения вшивается в промпт и меняет поведение
 * ============================================================ */

import * as Ext from '../../../extensions.js';
import * as Script from '../../../../script.js';
import * as LQ from './liquid.js';
import * as CMStorage from './cocktail/storage/storage.js';
import * as CMBridge from './cocktail/integration/st.js';
import * as CMApp from './cocktail/ui/app.js';

const { extension_settings, getContext } = Ext;
const { eventSource, event_types, saveSettingsDebounced, setExtensionPrompt, extension_prompt_types } = Script;

const MODULE = 'drunk_tracker';
const TAG = '[DrunkTracker]';
const MAX_EFF = 3.5;   // ‰, при этом значении шкала = 100 %
const MAX_BAC = 5;     // ‰, жёсткий потолок

/* ------------------------------------------------------------
 *  Стадии опьянения
 * ---------------------------------------------------------- */
const STAGES = [
    { min: 0,   name: 'Трезв',               emoji: '😐', color: '#7fd6b0' },
    { min: 0.2, name: 'Лёгкий хмель',        emoji: '🙂', color: '#b6dc6a' },
    { min: 0.6, name: 'Навеселе',            emoji: '😄', color: '#f2c14e' },
    { min: 1.2, name: 'Пьян',                emoji: '🥴', color: '#f2994a' },
    { min: 2.0, name: 'Очень пьян',          emoji: '😵‍💫', color: '#ee6a5b' },
    { min: 2.8, name: 'Вдрызг',              emoji: '🤢', color: '#d85ca8' },
    { min: 3.5, name: 'На грани отключки',   emoji: '💀', color: '#9a86f0' },
];

const DEFAULT_BEHAVIORS = [
    '',
    '{{name}} is slightly relaxed and a touch more talkative. Inhibitions are lowered a little: laughs more easily, may be a bit more candid or flirtatious. Speech and coordination are still normal.',
    '{{name}} is clearly buzzed: cheerful, loud, overly friendly and bold. Shares things they normally would not, makes impulsive jokes and decisions. Speech is mostly clear with occasional small slips; face is flushed.',
    '{{name}} is visibly drunk: slurred speech (stretched words and occasional typos in dialogue), poor balance, clumsy hands, spills and fumbles. Emotions swing and are exaggerated (affectionate, tearful or confrontational). Repeats themselves, loses the train of thought, judgment is poor.',
    '{{name}} is very drunk: heavy slurring, stumbling, needs support to stand or walk. Struggles to follow the conversation, has memory gaps, may say things they will regret. Nausea and dizziness appear. Dialogue is short, broken and sloppy.',
    '{{name}} is severely intoxicated: barely coherent, can hardly stand, vision is blurry, likely to vomit, collapse or doze off mid-sentence. Answers are fragmentary mumbles. Cannot perform precise or complex actions.',
    '{{name}} is on the verge of blackout: nearly unconscious, at most incoherent murmurs, may pass out at any moment and will not remember events afterwards. This is a dangerous state; people around should notice and react with concern.',
];

const DEFAULT_SETTINGS = {
    enabled: true,
    injectPrompt: true,
    injectDepth: 1,
    autoDrinks: true,
    autoSober: true,
    ignoreDialogue: true,
    showToasts: true,
    showFab: true,
    aiEnabled: false,       // ИИ-анализ сообщений вместо текстовых правил
    aiSource: 'st',         // 'st' — текущее подключение SillyTavern, 'custom' — свой API
    aiUrl: '', aiKey: '', aiModel: '', aiTemp: 0.1, aiMaxTokens: 500,
    eliminationRate: 0.15, // ‰ в час (для "прошло N часов", "сон" и т.п.)
    defaults: {
        user: { weight: 75, sex: 'm', tolerance: 1 },
        char: { weight: 60, sex: 'f', tolerance: 1 },
    },
    customDrinks: [],
    behaviors: [...DEFAULT_BEHAVIORS],
};

/* ------------------------------------------------------------
 *  Каталог напитков. abv — %, ml — порция, bottle — бутылка
 *  re — regexp-фрагмент для автоопределения (RU + EN)
 * ---------------------------------------------------------- */
const BUILTIN_DRINKS = [
    { id: 'beer',      name: 'Пиво',       emoji: '🍺', abv: 5,    ml: 500, bottle: 500, re: 'пив[а-яё]*|beers?|ales?|lagers?|stouts?' },
    { id: 'wine',      name: 'Вино',       emoji: '🍷', abv: 12,   ml: 150, bottle: 750, re: 'вин(?:о|а|у|ом|е)|wines?' },
    { id: 'champagne', name: 'Шампанское', emoji: '🥂', abv: 11.5, ml: 150, bottle: 750, re: 'шампанск[а-яё]*|champagne|prosecco|просекко|игристо[а-яё]*' },
    { id: 'vodka',     name: 'Водка',      emoji: '🍸', abv: 40,   ml: 50,  bottle: 500, re: 'водк[а-яё]*|vodka' },
    { id: 'whiskey',   name: 'Виски',      emoji: '🥃', abv: 40,   ml: 50,  bottle: 700, re: 'виски|whisk(?:e)?ys?|бурбон[а-яё]*|bourbon|scotch|скотч[а-яё]*' },
    { id: 'rum',       name: 'Ром',        emoji: '🏴‍☠️', abv: 40,  ml: 50,  bottle: 700, re: 'ром(?:а|у|ом|е)?|rum' },
    { id: 'cognac',    name: 'Коньяк',     emoji: '🥃', abv: 40,   ml: 50,  bottle: 500, re: 'коньяк[а-яё]*|cognac|brandy|бренди|armagnac' },
    { id: 'tequila',   name: 'Текила',     emoji: '🌵', abv: 40,   ml: 40,  bottle: 700, re: 'текил[а-яё]*|tequila|мескал[а-яё]*|mezcal' },
    { id: 'gin',       name: 'Джин',       emoji: '🫒', abv: 40,   ml: 50,  bottle: 700, re: 'джин(?:а|у|ом|е)?|gin' },
    { id: 'absinthe',  name: 'Абсент',     emoji: '🧪', abv: 70,   ml: 30,  bottle: 500, re: 'абсент[а-яё]*|absinthe' },
    { id: 'liqueur',   name: 'Ликёр',      emoji: '🍯', abv: 25,   ml: 40,  bottle: 500, re: 'ликёр[а-яё]*|ликер[а-яё]*|liqueurs?' },
    { id: 'cocktail',  name: 'Коктейль',   emoji: '🍹', abv: 15,   ml: 200, bottle: 600, re: 'коктейл[а-яё]*|cocktails?|мартини|martini|мохито|mojito|маргарит[а-яё]*|margarita' },
    { id: 'mead',      name: 'Медовуха',   emoji: '🍯', abv: 10,   ml: 250, bottle: 750, re: 'медовух[а-яё]*|mead' },
    { id: 'cider',     name: 'Сидр',       emoji: '🍏', abv: 5,    ml: 330, bottle: 500, re: 'сидр[а-яё]*|ciders?' },
    { id: 'sake',      name: 'Саке',       emoji: '🍶', abv: 15,   ml: 100, bottle: 360, re: 'саке|sake|соджу|soju' },
    { id: 'moonshine', name: 'Самогон',    emoji: '🫗', abv: 45,   ml: 50,  bottle: 500, re: 'самогон[а-яё]*|moonshine' },
    { id: 'generic',   name: 'Алкоголь',   emoji: '🥴', abv: 35,   ml: 50,  bottle: 500, re: 'алкогол[а-яё]*|alcohol|выпивк[а-яё]*|booze|liquor|spirits|шот[а-яё]*|shots?', generic: true },
];

/* ------------------------------------------------------------
 *  Визуал: цвета напитков, слои, подбор эффектов для стакана
 * ---------------------------------------------------------- */
const DRINK_COLORS = {
    beer: '#e8a82a', wine: '#8e1f3a', champagne: '#f3d98a', vodka: '#cfe9f2', whiskey: '#b8651b', rum: '#8a4a1e',
    cognac: '#a2531a', tequila: '#e9d38a', gin: '#bfe6e0', absinthe: '#7fd36a', liqueur: '#c0397a', cocktail: '#ff7a5a',
    mead: '#e0a23a', cider: '#cfa83a', sake: '#efe9d4', moonshine: '#e8ecd8', generic: '#d9a05a',
};
const FIZZY = new Set(['beer', 'champagne', 'cider']);
function drinkColor(id) {
    if (DRINK_COLORS[id]) return DRINK_COLORS[id];
    let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const hsl = (h % 360) / 360, f = n => { const k = (n + hsl * 12) % 12; return Math.round(255 * (.62 - .3 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
function drinkLayers(st, key) {
    const m = new Map();
    for (const e of st.log) {
        if (e.kind !== 'drink' || e.subject !== key) continue;
        const cur = m.get(e.drinkId) || { id: e.drinkId, ml: 0, abv: e.abv || 0, color: null };
        cur.ml += e.ml || 0; if (e.color) cur.color = e.color; m.set(e.drinkId, cur);
    }
    // крепкое легче и плавает сверху, слабое оседает вниз
    return [...m.values()].filter(x => x.ml > 0).sort((a, b) => b.ml - a.ml).slice(0, 5).sort((a, b) => b.abv - a.abv)
        .map(x => ({ id: x.id, color: x.color || drinkColor(x.id), amount: x.ml }));
}
const TICKS = STAGES.slice(1).map(s => s.min / MAX_EFF);
function glassCfg(st, key, ev) {
    const lay = drinkLayers(st, key), tot = lay.reduce((a, l) => a + l.amount, 0);
    let color = ev.stage.color;
    if (tot > 0) {
        const rgb = [0, 0, 0];
        lay.forEach(l => hexRgb(l.color).forEach((c, i) => rgb[i] += c * l.amount / tot));
        color = '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    }
    const fizz = tot > 0 ? lay.filter(l => FIZZY.has(l.id)).reduce((a, l) => a + l.amount, 0) / tot : 0;
    const fx = [];
    if (fizz > .2) fx.push('bubbles');
    if (ev.idx >= 5) fx.push('glow', 'sparkle');
    return {
        glass: 'highball', color, fill: ev.pct / 100, layers: lay, mix: .55, ticks: TICKS,
        foam: fizz > .2 && ev.pct > 4 ? Math.min(1, fizz * 1.5) : 0,
        swirl: ev.idx >= 3 ? .25 + .1 * (ev.idx - 3) : 0, fx,
    };
}

/* ------------------------------------------------------------
 *  Быстрые действия «протрезветь» (вручную)
 * ---------------------------------------------------------- */
const SOBER_ACTIONS = {
    h1:     { label: '⏳ +1 час',            hours: 1 },
    h3:     { label: '⏳ +3 часа',           hours: 3 },
    sleep:  { label: '😴 Сон (8 ч)',         hours: 8 },
    coffee: { label: '☕ Кофе',              amount: 0.1 },
    shower: { label: '🚿 Холодный душ',      amount: 0.2 },
    vomit:  { label: '🤮 Рвота',             amount: 0.3 },
    full:   { label: '✨ Полностью трезв',   amount: Infinity },
};

/* ------------------------------------------------------------
 *  Утилиты
 * ---------------------------------------------------------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r3 = v => Math.round(v * 1000) / 1000;
const fmt = v => (Math.round(v * 100) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimNum = n => String(Math.round(n * 10) / 10).replace('.', ',');

const PRE = String.raw`(?<![\p{L}\p{N}])`;
const POST = String.raw`(?![\p{L}\p{N}])`;
const word = src => new RegExp(`${PRE}(?:${src})${POST}`, 'iu');
const wordG = src => new RegExp(`${PRE}(?:${src})${POST}`, 'giu');

const settings = () => extension_settings[MODULE];

function loadSettings() {
    const cur = extension_settings[MODULE] ?? {};
    const s = Object.assign(structuredClone(DEFAULT_SETTINGS), cur);
    s.defaults = {
        user: { ...DEFAULT_SETTINGS.defaults.user, ...(cur.defaults?.user || {}) },
        char: { ...DEFAULT_SETTINGS.defaults.char, ...(cur.defaults?.char || {}) },
    };
    if (!Array.isArray(s.behaviors) || s.behaviors.length !== 7) s.behaviors = [...DEFAULT_BEHAVIORS];
    if (!Array.isArray(s.customDrinks)) s.customDrinks = [];
    extension_settings[MODULE] = s;
}

function allDrinks() {
    return [...BUILTIN_DRINKS, ...settings().customDrinks];
}

function toast(msg) {
    if (!settings().showToasts || !window.toastr) return;
    window.toastr.info(msg, 'Drunk Tracker', { timeOut: 4200, escapeHtml: false });
}

/* ------------------------------------------------------------
 *  Состояние (хранится в метаданных чата)
 * ---------------------------------------------------------- */
function newSubject(key) {
    const d = settings().defaults[key];
    return { bac: 0, weight: d.weight, sex: d.sex, tolerance: d.tolerance };
}

function newState() {
    return { v: 1, subjects: { user: newSubject('user'), char: newSubject('char') }, log: [] };
}

function state(create = true) {
    const meta = getContext().chatMetadata;
    if (!meta) return null;
    if (!meta[MODULE]) {
        if (!create) return null;
        meta[MODULE] = newState();
    }
    const st = meta[MODULE];
    st.subjects ??= {};
    st.subjects.user ??= newSubject('user');
    st.subjects.char ??= newSubject('char');
    st.log ??= [];
    return st;
}

const viewState = () => state(false) ?? (getContext().chatMetadata ? newState() : null);

let saveTimer = null;
function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try { getContext().saveMetadata?.(); } catch (e) { console.warn(TAG, e); }
    }, 400);
}

function subjName(key) {
    const ctx = getContext();
    return (key === 'user' ? ctx.name1 : ctx.name2) || (key === 'user' ? 'User' : 'Char');
}

function evalSubject(sub) {
    const eff = sub.bac / (sub.tolerance || 1);
    let idx = 0;
    STAGES.forEach((s, i) => { if (eff >= s.min) idx = i; });
    return { eff, idx, stage: STAGES[idx], pct: clamp(Math.round(eff / MAX_EFF * 100), 0, 100) };
}

function totals(st, key) {
    let drinks = 0, grams = 0;
    for (const e of st.log) {
        if (e.kind === 'drink' && e.subject === key) { drinks += e.qty || 1; grams += e.grams || 0; }
    }
    return { drinks, grams };
}

function drinkSummary(st, key) {
    const map = new Map();
    for (const e of st.log) {
        if (e.kind !== 'drink' || e.subject !== key) continue;
        map.set(e.name, (map.get(e.name) || 0) + e.ml);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([n, ml]) => `${n} ${Math.round(ml)} ml`).join(', ');
}

/* ------------------------------------------------------------
 *  Расчёты (формула Видмарка)
 * ---------------------------------------------------------- */
function calcDelta(sub, abv, ml, qty) {
    const grams = ml * qty * (abv / 100) * 0.789;
    const r = sub.sex === 'f' ? 0.55 : 0.68;
    return { grams, delta: grams / (Math.max(20, sub.weight) * r) };
}

function pushLog(st, e) {
    e.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    e.t = Date.now();
    st.log.push(e);
    if (st.log.length > 600) st.log.splice(0, st.log.length - 600);
    return e;
}

function addDrinkEntry(st, { subject, drink, ml, qty, source, mesId }) {
    const sub = st.subjects[subject];
    const { grams, delta } = calcDelta(sub, drink.abv, ml, qty);
    const before = sub.bac;
    sub.bac = clamp(r3(sub.bac + delta), 0, MAX_BAC);
    return pushLog(st, {
        kind: 'drink', subject, drinkId: drink.id, name: drink.name, emoji: drink.emoji,
        abv: drink.abv, ml: ml * qty, qty, grams: r3(grams), delta: r3(sub.bac - before),
        source, mesId: mesId ?? null, color: drink.color ?? null,
    });
}

function addSober(st, subject, amount, label, source, mesId, kind = 'sober') {
    const sub = st.subjects[subject];
    const actual = Math.min(sub.bac, amount);
    if (!(actual > 0.0005)) return null;
    sub.bac = clamp(r3(sub.bac - actual), 0, MAX_BAC);
    return pushLog(st, { kind, subject, label, delta: -r3(actual), source, mesId: mesId ?? null });
}

function setBac(st, subject, value) {
    const sub = st.subjects[subject];
    const target = clamp(r3(value), 0, MAX_BAC);
    const diff = r3(target - sub.bac);
    if (Math.abs(diff) < 0.001) return;
    sub.bac = target;
    pushLog(st, { kind: 'adjust', subject, label: 'Ручная правка', delta: diff, source: 'manual', mesId: null });
}

function undoEntry(st, id) {
    const i = st.log.findIndex(e => e.id === id);
    if (i < 0) return;
    const e = st.log[i];
    const sub = st.subjects[e.subject];
    if (sub) sub.bac = clamp(r3(sub.bac - e.delta), 0, MAX_BAC);
    st.log.splice(i, 1);
}

function revertAuto(st, mesId) {
    let changed = false;
    const keep = [];
    for (const e of st.log) {
        if (e.source === 'auto' && e.mesId === mesId) {
            const sub = st.subjects[e.subject];
            if (sub) sub.bac = clamp(r3(sub.bac - e.delta), 0, MAX_BAC);
            changed = true;
        } else keep.push(e);
    }
    st.log = keep;
    return changed;
}

/* ------------------------------------------------------------
 *  Автоопределение: словари и регулярки
 * ---------------------------------------------------------- */
const VERB_SRC = [
    // RU
    'выпи(?:л|ла|ло|ли|вал|вала|вали|вает|вают|ваю)', 'пь[её]т', 'пьют', 'пью', 'пь[её]шь', 'пил(?:а|о|и)?',
    'осуши(?:л|ла|ли|вает)', 'опроки(?:нул|нула|нули|дывает)', 'хлопнул(?:а|и)?', 'глотнул(?:а|и)?',
    'хлебнул(?:а|и)?', 'отхлебнул(?:а|и)?', 'отпил(?:а|и)?', 'пригубил(?:а|и)?', 'пригубливает', 'допил(?:а|и)?',
    'накатил(?:а|и)?', 'потягивает', 'потягивал(?:а|и)?', 'смакует', 'делает глото(?:к|чек)',
    String.raw`сделал(?:а|и)? (?:\p{L}+ )?глото(?:к|чек)`,
    // EN
    'drank', 'drinking', 'drinks (?:the|a|an|her|his|their|it|some|from)',
    String.raw`(?:takes?|took|taking|has|had) (?:a |an |another |one )?(?:sip|swig|gulp|drink|shot)s?`,
    'sips?', 'sipped', 'sipping', 'chugs?', 'chugged', 'gulps?', 'gulped', 'swigs?', 'swigged',
    'quaff(?:s|ed)', 'knock(?:s|ed) (?:it )?back', 'toss(?:es|ed) back', 'downed', 'downs (?:the|a|an|her|his|their|it)',
    'empt(?:ies|ied)', 'slams?', 'slammed', 'finish(?:es|ed)', 'polish(?:es|ed) off', 'nurs(?:es|ed)',
].join('|');
const VERB_RE = wordG(VERB_SRC);
const VERB_TEST = word(VERB_SRC);

const NEGATION_RE = new RegExp(String.raw`${PRE}(?:не|ни|нет|not|never|no|didn['’]t|doesn['’]t|don['’]t|won['’]t|wouldn['’]t|refus\p{L}*|отказ\p{L}*)${POST}\s*(?:\p{L}+\s+){0,2}$`, 'iu');
const REFUSE_RE = word(String.raw`отказал[а-яё]*|отказыва[а-яё]*|declin\p{L}*|refus\p{L}*`);

const NUM_WORDS = {
    'один': 1, 'одна': 1, 'одну': 1, 'одного': 1, 'одно': 1, 'one': 1,
    'два': 2, 'две': 2, 'two': 2, 'пару': 2, 'пара': 2, 'couple': 2,
    'три': 3, 'three': 3, 'четыре': 4, 'four': 4, 'пять': 5, 'five': 5,
    'шесть': 6, 'six': 6, 'семь': 7, 'seven': 7, 'восемь': 8, 'eight': 8,
    'девять': 9, 'nine': 9, 'десять': 10, 'ten': 10,
    'несколько': 3, 'several': 3, 'few': 3, 'много': 6,
};
const NUMW = Object.keys(NUM_WORDS).join('|');
const numVal = t => /^\d/.test(t) ? parseFloat(t.replace(',', '.')) : (NUM_WORDS[t.toLowerCase()] ?? 1);

const CONT = {
    bottle: word(String.raw`бутылк[а-яё]*|бутыл[а-яё]*|bottles?|flasks?|фляг[а-яё]*`),
    shot:   word(String.raw`рюмк[а-яё]*|рюмок|стопк[а-яё]*|стопок|шот[а-яё]*|shots?`),
    sip:    word(String.raw`глот(?:ок|ка|ки|ков|ке)|глоточ[а-яё]*|sips?|swigs?|gulps?|sipped|swigged|gulped|sipping|отпил[а-яё]*|пригуб[а-яё]*`),
};
const CONT_ALL = String.raw`бутылк[а-яё]*|бутыл[а-яё]*|bottles?|рюмк[а-яё]*|рюмок|стопк[а-яё]*|стопок|шот[а-яё]*|shots?|бокал[а-яё]*|стакан[а-яё]*|glass(?:es)?|кружк[а-яё]*|кружек|mugs?|pints?|tankards?|чарк[а-яё]*|чаш[а-яё]*|cups?|глот(?:ок|ка|ки|ков)|sips?|swigs?|gulps?|порци[а-яё]*|drinks?|rounds?|раунд[а-яё]*`;
const COUNT_RE = new RegExp(`${PRE}(\\d+|${NUMW})\\s+(?:[\\p{L}-]+\\s+){0,2}?(?:${CONT_ALL})${POST}`, 'iu');
const ML_RE = /(\d{2,4})\s*(?:мл|ml|миллилитр)/iu;

const BOTH_RE = word(String.raw`мы|нас|нам|они|их|вместе|оба|обе|чокнул[а-яё]*|тост[а-яё]*|we|they|both|together|cheers|toasts?|toasted`);
const FIRST_RE = word(String.raw`я|мне|меня|мной|мой|моя|моё|i|me|my|myself`);
const SECOND_RE = word(String.raw`ты|тебе|тебя|тобой|твой|твоя|твоё|you|your|yours`);

const TIME_TRIGGER_RE = word(String.raw`спустя|через|прошл[оаи]|прошёл|прошел|минул[оаи]?|проходит|пролетел[оаи]?|позже|later|passed|went by|goes by|elapsed`);
const TIME_AMOUNT_RE = new RegExp(`${PRE}(\\d+(?:[.,]\\d+)?|${NUMW})\\s+(?:of\\s+)?(час(?:а|ов)?|ч|hours?|hrs?|минут[а-яё]*|мин|minutes?|mins?)${POST}`, 'iu');
const HOUR_WORD_RE = word(String.raw`час|hour`);
const HALF_HOUR_RE = /полчаса|half an hour|half-hour/iu;

const SLEEP_RE = word(String.raw`проспал[а-яё]*|выспал[а-яё]*|проспит|проснул[а-яё]*|просыпа[а-яё]*|на следующ[а-яё]+ утр[а-яё]+|наступил[а-яё]* утр[а-яё]+|woke up|wakes up|waking up|slept it off|sleeps it off|slept through|next morning|following morning|morning came|morning arrived`);
const COLD_RE = word(String.raw`холодн[а-яё]* (?:душ|воды|водой|воду)|cold (?:shower|water)|ice[- ]cold water|плеснул[а-яё]* (?:\p{L}+ )?(?:воды|водой|в лицо)|умы(?:л|ла|лся|лась)\s+(?:\p{L}+\s+)?холодн[а-яё]*|splash(?:es|ed) (?:\p{L}+ )?water`);
const VOMIT_RE = word(String.raw`вырвало|стошнил[а-яё]*|рвот[ауые]|vomit(?:s|ed|ing)?|threw up|throws up|throwing up|puk(?:e|es|ed|ing)|retch(?:es|ed|ing)?`);
const COFFEE_RE = word(String.raw`кофе|coffee|espresso|эспрессо|капучино|латте`);
const SOBER_RE = word(String.raw`протрезв[а-яё]*|sobered up|sobers up|sobering up|sobered|antidote|антипохмел[а-яё]*|нашатыр[а-яё]*|smelling salts`);

const drinkReCache = new Map();
function drinkRegex(d) {
    const src = d.re || `${escapeRe(String(d.name).toLowerCase())}[\\p{L}]*`;
    if (!drinkReCache.has(src)) drinkReCache.set(src, wordG(src));
    return drinkReCache.get(src);
}

/* ------------------------------------------------------------
 *  Разбор текста
 * ---------------------------------------------------------- */
// Блок от Cocktail Maker (учтён напрямую, при автоскане его игнорируем, чтобы не считать дважды)
const CM_BLOCK_RE = />\s*🍸\*\*[^\n]*?<span[^>]*>[\s\S]*?<\/span>|<system_note>[\s\S]*?<\/system_note>/giu;
function stripText(t, ignoreDialogue) {
    t = String(t || '').replace(CM_BLOCK_RE, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ');
    if (ignoreDialogue) t = t.replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/g, ' ');
    return t.replace(/[*_~`]+/g, '');
}

const splitSentences = t => t.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const isNegated = (sentence, idx) => NEGATION_RE.test(sentence.slice(Math.max(0, idx - 32), idx));

function nameHits(sentence, key) {
    const n = String(subjName(key) || '').trim();
    if (n.length < 2) return [];
    const stem = n.length >= 4 ? n.slice(0, -1) : n;
    const re = new RegExp(`${PRE}${escapeRe(stem)}`, 'giu');
    return [...sentence.matchAll(re)].map(m => ({ i: m.index, end: m.index + m[0].length }));
}

/** Определяет, кто именно совершил действие в предложении. */
function attribute(sentence, anchor, sender, fallback) {
    const other = sender === 'user' ? 'char' : 'user';
    const hu = nameHits(sentence, 'user');
    const hc = nameHits(sentence, 'char');

    if (hu.length || hc.length) {
        const bu = hu.filter(h => h.i <= anchor).pop();
        const bc = hc.filter(h => h.i <= anchor).pop();
        if (bu && bc) {
            const first = bu.i < bc.i ? bu : bc;
            const second = bu.i < bc.i ? bc : bu;
            const gap = sentence.slice(first.end, second.i);
            if (/^\s*(?:,|и|and|&|с|with)?\s*$/iu.test(gap)) return ['user', 'char'];
            return [bu.i > bc.i ? 'user' : 'char'];
        }
        if (bu) return ['user'];
        if (bc) return ['char'];
        const au = hu[0], ac = hc[0];
        if (au && ac) return [au.i < ac.i ? 'user' : 'char'];
        return au ? ['user'] : ['char'];
    }

    if (BOTH_RE.test(sentence)) return ['user', 'char'];
    if (fallback === 'both') return ['user', 'char'];

    const first = FIRST_RE.test(sentence);
    const second = SECOND_RE.test(sentence);
    if (first && !second) return [sender];
    if (second && !first) return [other];
    return [sender];
}

function parseAmount(sentence, drink) {
    const s = sentence.toLowerCase();
    let ml = drink.ml;
    if (CONT.sip.test(s)) ml = Math.max(10, Math.round(drink.ml * 0.2));
    else if (CONT.bottle.test(s)) ml = drink.bottle || drink.ml * 5;
    else if (CONT.shot.test(s) && drink.abv >= 20) ml = Math.min(drink.ml, 50);

    let qty = 1;
    const mm = ML_RE.exec(s);
    if (mm) ml = clamp(parseInt(mm[1], 10), 10, 2000);
    else {
        const m = COUNT_RE.exec(s);
        if (m) qty = clamp(Math.round(numVal(m[1])), 1, 12);
    }
    return { ml, qty };
}

function detectDrinks(sentence, sender) {
    const verbs = [...sentence.matchAll(VERB_RE)].filter(m => !isNegated(sentence, m.index));
    if (!verbs.length || REFUSE_RE.test(sentence)) return [];

    const hits = [];
    for (const d of allDrinks()) {
        const ms = [...sentence.matchAll(drinkRegex(d))];
        if (!ms.length) continue;
        const pos = ms[0].index;
        const verb = verbs.reduce((a, b) => Math.abs(b.index - pos) < Math.abs(a.index - pos) ? b : a);
        const { ml, qty } = parseAmount(sentence, d);
        hits.push({ drink: d, ml, qty, subjects: attribute(sentence, verb.index, sender, 'sender') });
    }
    const hasSpecific = hits.some(h => !h.drink.generic);
    return hasSpecific ? hits.filter(h => !h.drink.generic) : hits;
}

function findTimeSkip(sentence) {
    if (!TIME_TRIGGER_RE.test(sentence)) return 0;
    let hours = 0;
    if (HALF_HOUR_RE.test(sentence)) hours += 0.5;
    const m = TIME_AMOUNT_RE.exec(sentence);
    if (m) {
        const n = numVal(m[1]);
        hours += /^(мин|min)/i.test(m[2]) ? n / 60 : n;
    } else if (!hours && HOUR_WORD_RE.test(sentence)) hours += 1;
    return clamp(hours, 0, 48);
}

function detectEvents(sentence, sender) {
    const rate = settings().eliminationRate;
    const out = [];
    const notNeg = (re) => {
        const m = re.exec(sentence);
        return m && !isNegated(sentence, m.index) ? m : null;
    };

    const hours = findTimeSkip(sentence);
    if (hours > 0) {
        out.push({ amount: hours * rate, label: `⏳ Прошло ~${trimNum(hours)} ч`, subjects: attribute(sentence, 0, sender, 'both') });
    } else {
        const m = notNeg(SLEEP_RE);
        if (m) out.push({ amount: 8 * rate, label: '😴 Сон / наступило утро', subjects: attribute(sentence, m.index, sender, 'both') });
    }

    let m = notNeg(COLD_RE);
    if (m) out.push({ amount: 0.2, label: '🚿 Холодная вода', subjects: attribute(sentence, m.index, sender, 'sender') });

    m = notNeg(VOMIT_RE);
    if (m) out.push({ amount: 0.3, label: '🤮 Рвота', subjects: attribute(sentence, m.index, sender, 'sender') });

    m = notNeg(COFFEE_RE);
    if (m && VERB_TEST.test(sentence)) {
        out.push({ amount: 0.1, label: '☕ Кофе', subjects: attribute(sentence, m.index, sender, 'sender') });
    }

    m = notNeg(SOBER_RE);
    if (m) out.push({ amount: Infinity, label: '✨ Протрезвление', subjects: attribute(sentence, m.index, sender, 'sender') });

    return out;
}

/** Сканирует одно сообщение и пишет в состояние. Возвращает список заметок для тоста. */
function scanMessage(st, mesId) {
    const s = settings();
    const msg = getContext().chat?.[mesId];
    if (!msg || msg.is_system) return [];
    revertAuto(st, mesId);

    const sender = msg.is_user ? 'user' : 'char';
    const text = stripText(msg.mes, s.ignoreDialogue);
    const notes = [];

    for (const sentence of splitSentences(text)) {
        if (s.autoDrinks) {
            for (const hit of detectDrinks(sentence, sender)) {
                for (const subj of hit.subjects) {
                    const e = addDrinkEntry(st, { subject: subj, drink: hit.drink, ml: hit.ml, qty: hit.qty, source: 'auto', mesId });
                    notes.push(`${hit.drink.emoji} <b>${esc(subjName(subj))}</b>: ${esc(hit.drink.name)} ${Math.round(e.ml)} мл (+${fmt(e.delta)}‰)`);
                }
            }
        }
        if (s.autoSober) {
            for (const ev of detectEvents(sentence, sender)) {
                for (const subj of ev.subjects) {
                    const e = addSober(st, subj, ev.amount, ev.label, 'auto', mesId);
                    if (e) notes.push(`${esc(ev.label)} → <b>${esc(subjName(subj))}</b> (${fmt(e.delta)}‰)`);
                }
            }
        }
    }
    return notes;
}

/* ------------------------------------------------------------
 *  ИИ-анализ сообщений (нейросеть определяет, кто и что выпил)
 * ---------------------------------------------------------- */
const AI_SYSTEM = `You analyze roleplay text for an alcohol-tracking tool. Reply with ONE JSON object and nothing else (no markdown, no comments):
{"drinks":[{"who":"user"|"char"|"both","drink":"<catalog id or a short custom name>","abv":<percent or null>,"ml":<millilitres actually drunk or null>,"qty":<integer>}],"sober":[{"who":"user"|"char"|"both","type":"hours"|"sleep"|"cold_water"|"vomit"|"coffee"|"full","hours":<number or null>}]}
Rules:
- Count only alcohol that is actually drunk in the message being analyzed. Ignore refusals, offers, plans, memories, hypotheticals, and non-alcoholic drinks.
- "who": "user" or "char" for one person, "both" when both drink together (toast, shared round).
- "drink": use a catalog id when it fits; otherwise a short name and give "abv" if you can estimate it.
- "ml": the amount actually consumed (a sip is about 20% of a serving); null if unclear. "qty": number of servings, default 1.
- "sober": only if the text describes time passing (type "hours" + hours), sleep, cold water/shower, vomiting, coffee, or becoming sober.
- If nothing applies, return {"drinks":[],"sober":[]}.`;

function extractJson(text) {
    const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('в ответе нет JSON');
    try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('JSON не разобран'); }
}

async function aiCall(system, user) {
    const s = settings(), ctx = getContext();
    if (s.aiSource === 'custom') {
        let url = String(s.aiUrl || '').trim().replace(/\/+$/, '');
        if (!url) throw new Error('не указан адрес API');
        if (!/\/chat\/completions$/.test(url)) url += '/chat/completions';
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 40000);
        try {
            const res = await fetch(url, {
                method: 'POST', signal: ctl.signal,
                headers: { 'Content-Type': 'application/json', ...(s.aiKey ? { Authorization: `Bearer ${s.aiKey}` } : {}) },
                body: JSON.stringify({
                    model: s.aiModel || undefined, temperature: Number(s.aiTemp) || 0, max_tokens: Number(s.aiMaxTokens) || 500,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                }),
            });
            if (!res.ok) throw new Error(`API ответил ${res.status}`);
            const data = await res.json();
            return String(data?.choices?.[0]?.message?.content ?? '');
        } catch (e) {
            throw new Error(e.name === 'AbortError' ? 'тайм-аут запроса' : e.message);
        } finally { clearTimeout(timer); }
    }
    // текущее подключение SillyTavern
    if (typeof ctx.generateRaw === 'function') {
        try {
            const out = await ctx.generateRaw({ prompt: user, systemPrompt: system, responseLength: Number(s.aiMaxTokens) || 500 });
            if (out) return String(out);
        } catch { /* пробуем другой способ */ }
    }
    if (typeof ctx.generateQuietPrompt === 'function') {
        const out = await ctx.generateQuietPrompt({ quietPrompt: `${system}\n\n${user}` });
        if (out) return String(out);
    }
    throw new Error('нейросеть не ответила (проверь подключение SillyTavern)');
}

const cut = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function aiAnalyze(mesId, textOverride = null, senderOverride = null) {
    const s = settings(), ctx = getContext();
    const msg = ctx.chat?.[mesId];
    const sender = senderOverride ?? (msg?.is_user ? 'user' : 'char');
    const body = cut(stripText(textOverride ?? msg?.mes, s.ignoreDialogue), 3000);
    if (!body) return { drinks: [], sober: [] };
    const before = textOverride != null ? '' : (ctx.chat || []).slice(Math.max(0, mesId - 2), mesId).filter(m => !m.is_system)
        .map(m => `${m.name}: ${cut(stripText(m.mes, false), 400)}`).join('\n');
    const catalog = allDrinks().filter(d => !d.generic).map(d => `${d.id} = ${d.name}, ${d.abv}%, serving ${d.ml} ml`).join('\n');
    const user = `Participants: user = "${subjName('user')}", char = "${subjName('char')}".
Drink catalog:\n${catalog}
${before ? `Previous messages (context only, do not count them):\n${before}\n` : ''}
Message to analyze, written by ${sender} (${subjName(sender)}):\n${body}`;
    const out = extractJson(await aiCall(AI_SYSTEM, user));
    return { drinks: Array.isArray(out.drinks) ? out.drinks : [], sober: Array.isArray(out.sober) ? out.sober : [] };
}

const AI_WHO = w => { w = String(w || '').toLowerCase(); return w === 'both' ? ['user', 'char'] : w === 'user' ? ['user'] : w === 'char' ? ['char'] : []; };
const AI_SOBER = { sleep: ['😴 Сон / наступило утро', () => 8 * settings().eliminationRate], cold_water: ['🚿 Холодная вода', () => 0.2], vomit: ['🤮 Рвота', () => 0.3], coffee: ['☕ Кофе', () => 0.1], full: ['✨ Протрезвление', () => Infinity] };

function applyAi(st, mesId, res) {
    const s = settings(), notes = [], all = allDrinks();
    if (s.autoDrinks) {
        for (const d of res.drinks) {
            const key = String(d?.drink || '').trim().toLowerCase();
            if (!key) continue;
            let drink = all.find(x => x.id.toLowerCase() === key) || all.find(x => x.name.toLowerCase() === key);
            const abv = Number(d.abv);
            if (!drink) {
                if (!(abv > 0)) continue;
                drink = { id: 'ai_' + encodeURIComponent(key).slice(0, 30), name: String(d.drink).slice(0, 30), emoji: '🍹', abv: 10, ml: 200, bottle: 500 };
            }
            if (abv > 0) drink = { ...drink, abv: clamp(abv, 0.5, 96) };
            const ml = Number(d.ml) > 0 ? clamp(Number(d.ml), 10, 2000) : drink.ml;
            const qty = clamp(Math.round(Number(d.qty)) || 1, 1, 12);
            for (const subj of AI_WHO(d.who)) {
                const e = addDrinkEntry(st, { subject: subj, drink, ml, qty, source: 'auto', mesId });
                notes.push(`${drink.emoji} <b>${esc(subjName(subj))}</b>: ${esc(drink.name)} ${Math.round(e.ml)} мл (+${fmt(e.delta)}‰)`);
            }
        }
    }
    if (s.autoSober) {
        for (const d of res.sober) {
            const type = String(d?.type || '');
            let label, amount;
            if (type === 'hours') { const h = clamp(Number(d.hours) || 1, 0, 48); label = `⏳ Прошло ~${trimNum(h)} ч`; amount = h * s.eliminationRate; }
            else if (AI_SOBER[type]) { label = AI_SOBER[type][0]; amount = AI_SOBER[type][1](); }
            else continue;
            for (const subj of AI_WHO(d.who)) {
                const e = addSober(st, subj, amount, label, 'auto', mesId);
                if (e) notes.push(`${esc(label)} → <b>${esc(subjName(subj))}</b> (${fmt(e.delta)}‰)`);
            }
        }
    }
    return notes;
}

const aiTok = {};
/** Анализ одного сообщения нейросетью. При ошибке включается обычный текстовый разбор. */
async function aiProcess(mesId, silent = false) {
    const ctx = getContext(), meta = ctx.chatMetadata, msg = ctx.chat?.[mesId];
    if (!msg || msg.is_system || !state()) return null;
    const token = aiTok[mesId] = (aiTok[mesId] || 0) + 1, text = msg.mes;
    let notes;
    try {
        const res = await aiAnalyze(mesId);
        const now = getContext();
        if (token !== aiTok[mesId] || now.chatMetadata !== meta || now.chat?.[mesId]?.mes !== text) return null; // устарело
        const st = state();
        revertAuto(st, mesId);
        notes = applyAi(st, mesId, res);
    } catch (e) {
        console.warn(TAG, 'AI analysis failed', e);
        if (!silent) window.toastr?.warning(`ИИ-анализ не сработал (${e.message}), использован обычный разбор`, 'Drunk Tracker');
        notes = scanMessage(state(), mesId);
    }
    saveState(); renderAll(); updatePrompt();
    if (!silent && notes.length) toast(notes.slice(0, 4).join('<br>') + (notes.length > 4 ? `<br>…ещё ${notes.length - 4}` : ''));
    return notes.length;
}

function processMessage(mesId) {
    const s = settings();
    if (!s?.enabled || (!s.autoDrinks && !s.autoSober)) return;
    const ctx = getContext();
    const st = state();
    if (!st || !ctx.chat?.length) return;
    if (!Number.isFinite(mesId)) mesId = ctx.chat.length - 1;
    if (s.aiEnabled) { aiProcess(mesId); return; }
    try {
        const notes = scanMessage(st, mesId);
        saveState();
        renderAll();
        updatePrompt();
        if (notes.length) toast(notes.slice(0, 4).join('<br>') + (notes.length > 4 ? `<br>…ещё ${notes.length - 4}` : ''));
    } catch (e) {
        console.error(TAG, 'scan failed', e);
    }
}

async function rescanChatAi() {
    const ctx = getContext(), st = state();
    if (!st || !ctx.chat) return;
    new Set(st.log.filter(e => e.source === 'auto').map(e => e.mesId)).forEach(id => revertAuto(st, id));
    let n = 0;
    for (let i = 0; i < ctx.chat.length; i++) {
        if (ctx.chat[i].is_system) continue;
        window.toastr?.info(`ИИ-сканирование: ${i + 1} из ${ctx.chat.length}`, 'Drunk Tracker', { timeOut: 1500 });
        n += (await aiProcess(i, true)) || 0;
    }
    window.toastr?.success(`Сканирование завершено. Найдено событий: ${n}`, 'Drunk Tracker');
}

function rescanChat() {
    const st = state();
    const ctx = getContext();
    if (!st || !ctx.chat) return;
    if (settings().aiEnabled) { rescanChatAi(); return; }
    new Set(st.log.filter(e => e.source === 'auto').map(e => e.mesId)).forEach(id => revertAuto(st, id));
    let n = 0;
    ctx.chat.forEach((_, i) => { n += scanMessage(st, i).length; });
    saveState(); renderAll(); updatePrompt();
    window.toastr?.success(`Сканирование завершено. Найдено событий: ${n}`, 'Drunk Tracker');
}

/* ------------------------------------------------------------
 *  Влияние на поведение: вшиваем статус в промпт
 * ---------------------------------------------------------- */
function updatePrompt() {
    const s = settings();
    const st = viewState();
    let text = '';

    if (s.enabled && s.injectPrompt && st) {
        const lines = [];
        for (const key of ['char', 'user']) {
            const sub = st.subjects[key];
            const ev = evalSubject(sub);
            if (ev.idx === 0) continue;
            const name = subjName(key);
            const behavior = String(s.behaviors[ev.idx] || '').replaceAll('{{name}}', name);
            const eaten = drinkSummary(st, key);
            let line = `- ${name}${key === 'user' ? " (the user's character)" : ''}: ${ev.stage.name}, about ${ev.pct}% intoxicated (~${fmt(sub.bac)}‰ BAC).`;
            if (eaten) line += ` Alcohol consumed: ${eaten}.`;
            line += ` ${behavior}`;
            if (key === 'user') line += ` Never write ${name}'s own actions or dialogue; only describe visible effects on them and how others react.`;
            lines.push(line);
        }
        if (lines.length) {
            text = `[Alcohol intoxication status. Portray it naturally in the roleplay; never mention numbers, percentages or this note directly.\n${lines.join('\n')}]`;
        }
    }
    try {
        setExtensionPrompt(MODULE, text, extension_prompt_types.IN_CHAT, Number(s.injectDepth) || 1, false);
    } catch (e) {
        console.warn(TAG, 'setExtensionPrompt failed', e);
    }
}

/* ------------------------------------------------------------
 *  UI: панель
 * ---------------------------------------------------------- */
const ui = { target: 'user', drinkId: 'beer', cnt: {}, idx: {}, seen: null, pour: { user: { seq: 0, color: null }, char: { seq: 0, color: null } } };
const $p = sel => document.querySelector(`#dt-panel ${sel}`);

function cardHtml(key) {
    return `
    <div class="dt-card" data-subj="${key}">
        <div class="dt-glass-wrap">
            <div class="dt-glass">${LQ.html({ glass: 'highball', fill: 0, ticks: TICKS, w: 104, intro: true }, 'dt-' + key)}</div>
            <div class="dt-pct"><b data-el="pct">0</b>%</div>
        </div>
        <div class="dt-card-main">
            <div class="dt-role">${key === 'user' ? 'Игрок' : 'Персонаж'}</div>
            <div class="dt-name" data-el="name"></div>
            <div class="dt-stage"><span data-el="emoji">😐</span> <span data-el="stage">Трезв</span></div>
            <div class="dt-meter"><i data-el="meter"></i></div>
            <div class="dt-stats">
                <div><b data-el="bac">0.00</b><small>промилле</small></div>
                <div><b data-el="drinks">0</b><small>порций</small></div>
                <div><b data-el="grams">0</b><small>г спирта</small></div>
            </div>
            <details class="dt-details dt-params">
                <summary>Параметры</summary>
                <div class="dt-param-grid">
                    <label>Вес, кг<input type="number" min="30" max="250" step="1" data-param="weight"></label>
                    <label>Пол<select data-param="sex"><option value="m">М</option><option value="f">Ж</option></select></label>
                    <label>Стойкость<input type="number" min="0.3" max="3" step="0.1" data-param="tolerance"></label>
                    <label>Задать ‰<input type="number" min="0" max="5" step="0.05" data-param="bac"></label>
                </div>
            </details>
        </div>
    </div>`;
}

function soberButtons() {
    return Object.entries(SOBER_ACTIONS).map(([k, a]) => `<button type="button" class="dt-btn dt-soft" data-sober="${k}">${a.label}</button>`).join('');
}

function buildPanel() {
    const el = document.createElement('div');
    el.id = 'dt-panel';
    el.className = 'dt-panel';
    el.innerHTML = `
    <div class="dt-head">
        <div class="dt-title">
            <div class="dt-logo">🍸</div>
            <div><b>Drunk Tracker</b><span>учёт алкоголя в ролевой игре</span></div>
        </div>
        <div class="dt-head-btns">
            <button class="dt-cm-btn" data-act="open-cm" title="Открыть Cocktail Maker">🍹 Cocktail Maker</button>
            <button class="dt-x" data-act="close" title="Закрыть">✕</button>
        </div>
    </div>
    <div class="dt-body">
        <div class="dt-empty" id="dt-empty">Открой чат, и трекер начнёт работу.</div>
        <div id="dt-main">
            <div class="dt-cards">${cardHtml('user')}${cardHtml('char')}</div>

            <section class="dt-box">
                <h4>Добавить напиток</h4>
                <div class="dt-seg" id="dt-target"></div>
                <div class="dt-chips" id="dt-chips"></div>
                <div class="dt-fields">
                    <label>Объём, мл<input id="dt-ml" type="number" min="5" max="3000" step="5" value="500"></label>
                    <label>Количество
                        <span class="dt-stepper">
                            <button type="button" data-act="qty-">−</button>
                            <input id="dt-qty" type="number" min="1" max="20" value="1">
                            <button type="button" data-act="qty+">+</button>
                        </span>
                    </label>
                    <label>Крепость, %<input id="dt-abv" type="number" min="0.5" max="96" step="0.5" value="5"></label>
                </div>
                <div class="dt-preview" id="dt-preview"></div>
                <button type="button" class="dt-btn dt-primary" data-act="drink">Выпить</button>
                <details class="dt-details dt-custom-wrap">
                    <summary>Свой напиток</summary>
                    <div class="dt-fields dt-custom">
                        <label>Название<input id="dt-c-name" type="text" maxlength="30" placeholder="Например, глинтвейн"></label>
                        <label>Значок<input id="dt-c-emoji" type="text" maxlength="4" value="🍹"></label>
                        <label>Крепость, %<input id="dt-c-abv" type="number" min="0.5" max="96" step="0.5" value="10"></label>
                        <label>Порция, мл<input id="dt-c-ml" type="number" min="5" max="1000" step="5" value="200"></label>
                    </div>
                    <button type="button" class="dt-btn dt-soft" data-act="addcustom">Сохранить напиток</button>
                </details>
            </section>

            <section class="dt-box">
                <h4>Протрезветь <small>вручную или по событиям RP</small></h4>
                <div class="dt-sober-grid">${soberButtons()}</div>
                <div class="dt-hint">Действует на тех, кто выбран выше.</div>
            </section>

            <section class="dt-box">
                <h4>Журнал</h4>
                <div id="dt-log" class="dt-log"></div>
                <div class="dt-foot-actions">
                    <button type="button" class="dt-btn dt-ghost" data-act="rescan">Пересканировать чат</button>
                    <button type="button" class="dt-btn dt-ghost dt-danger" data-act="reset">Сбросить всё</button>
                </div>
            </section>
        </div>
    </div>`;
    document.body.appendChild(el);
    LQ.hydrate(el);
    LQ.setActive(false);

    el.addEventListener('click', onPanelClick);
    el.addEventListener('change', onPanelChange);
    el.addEventListener('input', onPanelInput);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
}

function buildFab() {
    const b = document.createElement('button');
    b.id = 'dt-fab';
    b.className = 'dt-fab';
    b.title = 'Drunk Tracker';
    b.innerHTML = `<span class="dt-fab-ic">🍸</span><span class="dt-minis"><i class="dt-mini" data-mini="user"><u></u></i><i class="dt-mini" data-mini="char"><u></u></i></span><span class="dt-fab-v"><b data-fab="user">0%</b><b data-fab="char">0%</b></span>`;
    b.addEventListener('click', togglePanel);
    document.body.appendChild(b);
}

function injectMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('dt_menu_btn')) return true;
    const b = document.createElement('div');
    b.id = 'dt_menu_btn';
    b.className = 'list-group-item flex-container flexGap5';
    b.innerHTML = '<div class="fa-solid fa-wine-glass extensionsMenuExtensionButton"></div><span>Drunk Tracker</span>';
    b.addEventListener('click', togglePanel);
    menu.appendChild(b);
    return true;
}

const openPanel = () => { document.getElementById('dt-panel')?.classList.add('open'); LQ.setActive(true); renderAll(); };
const closePanel = () => { document.getElementById('dt-panel')?.classList.remove('open'); LQ.setActive(false); };
const togglePanel = () => document.getElementById('dt-panel')?.classList.contains('open') ? closePanel() : openPanel();

/* ------------------------------------------------------------
 *  UI: отрисовка
 * ---------------------------------------------------------- */
function renderAll() {
    renderCards();
    renderTarget();
    renderChips();
    renderLog();
    updatePreview();
    updateFab();
}

function renderCards() {
    const st = viewState();
    const empty = document.getElementById('dt-empty');
    const main = document.getElementById('dt-main');
    if (!empty || !main) return;
    empty.style.display = st ? 'none' : '';
    main.style.display = st ? '' : 'none';
    if (!st) return;

    for (const key of ['user', 'char']) {
        const card = $p(`.dt-card[data-subj="${key}"]`);
        if (!card) continue;
        const sub = st.subjects[key];
        const ev = evalSubject(sub);
        const tot = totals(st, key);
        const q = n => card.querySelector(`[data-el="${n}"]`);

        q('name').textContent = subjName(key);
        q('emoji').textContent = ev.stage.emoji;
        q('stage').textContent = ev.stage.name;
        q('pct').textContent = ev.pct;
        q('bac').textContent = fmt(sub.bac);
        q('drinks').textContent = tot.drinks;
        q('grams').textContent = Math.round(tot.grams);
        q('meter').style.width = `${Math.max(ev.pct, sub.bac > 0 ? 3 : 0)}%`;
        const cfg = glassCfg(st, key, ev), drinksNow = st.log.filter(e => e.kind === 'drink' && e.subject === key), isOpen = document.getElementById('dt-panel')?.classList.contains('open');
        const prevCnt = ui.cnt[key];
        if (prevCnt !== undefined && drinksNow.length > prevCnt && isOpen) { ui.pour[key].seq++; const lastD = drinksNow[drinksNow.length - 1]; ui.pour[key].color = lastD.color || drinkColor(lastD.drinkId); }
        ui.cnt[key] = drinksNow.length;
        cfg.pourSeq = ui.pour[key].seq; cfg.pourColor = ui.pour[key].color;
        const cv = card.querySelector('canvas.dt-liq'); if (cv) LQ.update(cv, cfg);
        if (ui.idx[key] !== undefined && ui.idx[key] !== ev.idx) { card.classList.remove('is-flash'); void card.offsetWidth; card.classList.add('is-flash'); setTimeout(() => card.classList.remove('is-flash'), 1000); }
        ui.idx[key] = ev.idx;
        card.style.setProperty('--c', ev.stage.color);
        card.classList.toggle('is-wobble', ev.idx >= 3);
        card.classList.toggle('is-blackout', ev.idx >= 6);

        card.querySelectorAll('[data-param]').forEach(inp => {
            if (document.activeElement === inp) return;
            const v = inp.dataset.param === 'bac' ? fmt(sub.bac) : sub[inp.dataset.param];
            if (String(inp.value) !== String(v)) inp.value = v;
        });
    }
}

function renderTarget() {
    const box = document.getElementById('dt-target');
    if (!box) return;
    const nm = k => esc(String(subjName(k)).slice(0, 14));
    box.innerHTML = [['user', nm('user')], ['char', nm('char')], ['both', 'Оба']]
        .map(([k, label]) => `<button type="button" data-target="${k}" class="${ui.target === k ? 'on' : ''}">${label}</button>`).join('');
}

function currentDrink() {
    return allDrinks().find(d => d.id === ui.drinkId) ?? allDrinks()[0];
}

function renderChips() {
    const box = document.getElementById('dt-chips');
    if (!box) return;
    box.innerHTML = allDrinks().filter(d => !d.generic).map(d => `
        <button type="button" class="dt-chip ${d.id === ui.drinkId ? 'on' : ''}" style="--dc:${drinkColor(d.id)}" data-drink="${esc(d.id)}">
            <span class="dt-chip-e">${esc(d.emoji)}</span><b>${esc(d.name)}</b><small>${d.abv}%</small>
            ${d.custom ? `<i class="dt-chip-x" data-delcustom="${esc(d.id)}" title="Удалить">×</i>` : ''}
        </button>`).join('');
}

function renderLog() {
    const box = document.getElementById('dt-log');
    const st = viewState();
    if (!box || !st) return;
    if (!st.log.length) { box.innerHTML = '<div class="dt-log-empty">Пока никто не пил.</div>'; return; }
    const first = !ui.seen; ui.seen ??= new Set();
    box.innerHTML = [...st.log].reverse().slice(0, 60).map(e => {
        const isNew = !first && !ui.seen.has(e.id); ui.seen.add(e.id);
        const up = e.delta > 0;
        const icon = e.kind === 'drink' ? (e.emoji || '🍷') : e.kind === 'adjust' ? '🎚️' : '🌙';
        const title = e.kind === 'drink' ? `${esc(e.name)}, ${Math.round(e.ml)} мл, ${e.abv}%` : esc(e.label);
        const src = e.source === 'cocktail' ? 'Cocktail Maker' : e.source === 'auto' ? `авто${e.mesId != null ? `, сообщение #${e.mesId}` : ''}` : 'вручную';
        return `<div class="dt-log-item ${up ? 'up' : 'down'} ${isNew ? 'is-new' : ''}">
            <span class="dt-log-ic">${icon}</span>
            <div class="dt-log-main"><b>${esc(subjName(e.subject))}</b> ${title}<small>${src}</small></div>
            <span class="dt-log-d">${up ? '+' : '−'}${fmt(Math.abs(e.delta))}‰</span>
            <button type="button" class="dt-undo" data-undo="${e.id}" title="Отменить запись">↶</button>
        </div>`;
    }).join('');
}

function targets() {
    return ui.target === 'both' ? ['user', 'char'] : [ui.target];
}

function readDrinkForm() {
    const base = currentDrink();
    return {
        drink: { ...base, abv: clamp(parseFloat($p('#dt-abv').value) || base.abv, 0.5, 96) },
        ml: clamp(parseFloat($p('#dt-ml').value) || base.ml, 5, 3000),
        qty: clamp(parseInt($p('#dt-qty').value, 10) || 1, 1, 20),
    };
}

function updatePreview() {
    const box = document.getElementById('dt-preview');
    const st = viewState();
    if (!box || !st || !$p('#dt-abv')) return;
    const { drink, ml, qty } = readDrinkForm();
    const parts = targets().map(k => {
        const { delta } = calcDelta(st.subjects[k], drink.abv, ml, qty);
        return `${esc(subjName(k))}: <b>+${fmt(delta)}‰</b>`;
    });
    box.innerHTML = `${drink.emoji} ${Math.round(ml * qty)} мл, ${drink.abv}% → ${parts.join(' · ')}`;
}

function updateFab() {
    const fab = document.getElementById('dt-fab');
    if (!fab) return;
    fab.style.display = settings().enabled && settings().showFab ? '' : 'none';
    const st = viewState();
    for (const key of ['user', 'char']) {
        const el = fab.querySelector(`[data-fab="${key}"]`);
        if (!el || !st) continue;
        const ev = evalSubject(st.subjects[key]);
        el.textContent = `${ev.stage.emoji} ${ev.pct}%`;
        el.style.color = ev.stage.color;
        const mini = fab.querySelector(`[data-mini="${key}"]`);
        if (mini) { mini.style.setProperty('--c', ev.stage.color); mini.firstElementChild.style.height = `${Math.max(ev.pct, st.subjects[key].bac > 0 ? 6 : 0)}%`; }
    }
    fab.classList.toggle('is-hot', ['user', 'char'].some(k => st && evalSubject(st.subjects[k]).idx >= 4));
}

/* ------------------------------------------------------------
 *  UI: обработчики
 * ---------------------------------------------------------- */
function afterChange() {
    saveState();
    renderAll();
    updatePrompt();
}

function applyDrinkManual() {
    const st = state();
    if (!st) return;
    const { drink, ml, qty } = readDrinkForm();
    const notes = [];
    for (const k of targets()) {
        const e = addDrinkEntry(st, { subject: k, drink, ml, qty, source: 'manual' });
        notes.push(`${drink.emoji} <b>${esc(subjName(k))}</b>: +${fmt(e.delta)}‰`);
    }
    afterChange();
    toast(notes.join('<br>'));
}

function applySoberManual(kind) {
    const st = state();
    const a = SOBER_ACTIONS[kind];
    if (!st || !a) return;
    const amount = a.hours ? a.hours * settings().eliminationRate : a.amount;
    for (const k of targets()) addSober(st, k, amount, a.label, 'manual', null);
    afterChange();
}

function onPanelClick(e) {
    const t = e.target;

    const delc = t.closest('[data-delcustom]');
    if (delc) {
        e.stopPropagation();
        const id = delc.dataset.delcustom;
        const s = settings();
        s.customDrinks = s.customDrinks.filter(d => d.id !== id);
        if (ui.drinkId === id) ui.drinkId = 'beer';
        saveSettingsDebounced();
        renderChips(); selectDrink(ui.drinkId);
        return;
    }
    const chip = t.closest('[data-drink]');
    if (chip) { selectDrink(chip.dataset.drink); return; }

    const tg = t.closest('[data-target]');
    if (tg) { ui.target = tg.dataset.target; renderTarget(); updatePreview(); return; }

    const sb = t.closest('[data-sober]');
    if (sb) { applySoberManual(sb.dataset.sober); return; }

    const un = t.closest('[data-undo]');
    if (un) {
        const st = state();
        if (st) { undoEntry(st, un.dataset.undo); afterChange(); }
        return;
    }

    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') closePanel();
    else if (act === 'open-cm') openCocktailMaker();
    else if (act === 'drink') applyDrinkManual();
    else if (act === 'qty+' || act === 'qty-') {
        const q = $p('#dt-qty');
        q.value = clamp((parseInt(q.value, 10) || 1) + (act === 'qty+' ? 1 : -1), 1, 20);
        updatePreview();
    }
    else if (act === 'addcustom') addCustomDrink();
    else if (act === 'rescan') { if (confirm(settings().aiEnabled ? 'Пересканировать весь чат нейросетью? Это отправит отдельный запрос на каждое сообщение. Автозаписи будут пересчитаны, ручные записи и коктейли останутся.' : 'Пересканировать весь чат? Автоматические записи будут пересчитаны, ручные останутся.')) rescanChat(); }
    else if (act === 'reset') {
        if (!confirm('Сбросить опьянение и журнал в этом чате?')) return;
        const meta = getContext().chatMetadata;
        if (meta) { meta[MODULE] = newState(); afterChange(); }
    }
}

function onPanelChange(e) {
    const inp = e.target.closest('[data-param]');
    if (!inp) return;
    const st = state();
    const key = inp.closest('.dt-card')?.dataset.subj;
    if (!st || !key) return;
    const p = inp.dataset.param;
    if (p === 'bac') setBac(st, key, parseFloat(inp.value) || 0);
    else if (p === 'sex') st.subjects[key].sex = inp.value === 'f' ? 'f' : 'm';
    else if (p === 'weight') st.subjects[key].weight = clamp(parseFloat(inp.value) || 70, 30, 250);
    else if (p === 'tolerance') st.subjects[key].tolerance = clamp(parseFloat(inp.value) || 1, 0.3, 3);
    afterChange();
}

function onPanelInput(e) {
    if (['dt-ml', 'dt-qty', 'dt-abv'].includes(e.target.id)) updatePreview();
}

function selectDrink(id) {
    ui.drinkId = id;
    const d = currentDrink();
    $p('#dt-ml').value = d.ml;
    $p('#dt-abv').value = d.abv;
    renderChips();
    updatePreview();
}

function addCustomDrink() {
    const name = $p('#dt-c-name').value.trim();
    if (!name) { window.toastr?.warning('Введи название напитка', 'Drunk Tracker'); return; }
    const abv = clamp(parseFloat($p('#dt-c-abv').value) || 10, 0.5, 96);
    const ml = clamp(parseFloat($p('#dt-c-ml').value) || 200, 5, 1000);
    const id = 'c_' + Date.now().toString(36);
    settings().customDrinks.push({
        id, name, emoji: $p('#dt-c-emoji').value.trim() || '🍹', abv, ml, bottle: Math.max(ml, 500), custom: true,
    });
    saveSettingsDebounced();
    $p('#dt-c-name').value = '';
    selectDrink(id);
}

/* ------------------------------------------------------------
 *  Интеграция с Cocktail Maker
 * ---------------------------------------------------------- */
function openCocktailMaker() {
    closePanel();
    CMApp.open();
}

/** Вызывается из Cocktail Maker, когда коктейль подан: записывает выпитое в журнал. */
function logCocktail({ subjects, name, abv, ml, color }) {
    const st = state();
    if (!st) return { ok: false, reason: 'нет открытого чата, Drunk Tracker не учёл напиток' };
    if (!settings().enabled) return { ok: false, reason: 'Drunk Tracker выключен в настройках' };
    if (!(abv > 0) || !(ml > 0)) return { ok: false, reason: 'в коктейле нет алкоголя' };
    const drink = { id: 'cm_' + encodeURIComponent(String(name).toLowerCase()).slice(0, 40), name: String(name), emoji: '🍸', abv, ml, bottle: ml, color };
    const notes = [];
    for (const k of subjects) {
        if (!st.subjects[k]) continue;
        const e = addDrinkEntry(st, { subject: k, drink, ml, qty: 1, source: 'cocktail' });
        notes.push(`🍸 <b>${esc(subjName(k))}</b>: ${esc(drink.name)} (+${fmt(e.delta)}‰)`);
    }
    afterChange();
    if (notes.length) toast(notes.join('<br>'));
    return { ok: notes.length > 0, reason: notes.length ? '' : 'некого записывать' };
}

/* ------------------------------------------------------------
 *  UI: настройки в меню расширений
 * ---------------------------------------------------------- */
function buildSettings() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('dt-settings')) return;
    const s = settings();
    const chk = (k, label) => `<label class="checkbox_label"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span>${label}</span></label>`;
    const behaviors = STAGES.slice(1).map((st, i) => `
        <label class="dt-set-beh"><span>${st.emoji} ${st.name}</span>
            <textarea class="text_pole" rows="3" data-beh="${i + 1}">${esc(s.behaviors[i + 1])}</textarea>
        </label>`).join('');

    const wrap = document.createElement('div');
    wrap.id = 'dt-settings';
    wrap.className = 'inline-drawer';
    wrap.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>🍸 Drunk Tracker</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div class="dt-set">
            ${chk('enabled', 'Включить расширение')}
            ${chk('injectPrompt', 'Менять поведение персонажа (вшивать статус в промпт)')}
            ${chk('autoDrinks', 'Автоучёт напитков по тексту сообщений')}
            ${chk('autoSober', 'Автоматическое протрезвление по событиям RP (время, сон, душ…)')}
            ${chk('ignoreDialogue', 'Игнорировать реплики в кавычках при автоанализе')}
            ${chk('showToasts', 'Показывать уведомления об автозаписях')}
            ${chk('showFab', 'Показывать плавающую кнопку')}
            <div class="dt-set-row">
                <label>Глубина вставки в чат <input type="number" class="text_pole" min="0" max="20" step="1" data-set="injectDepth" value="${s.injectDepth}"></label>
                <label>Выведение, ‰ в час <input type="number" class="text_pole" min="0.01" max="1" step="0.01" data-set="eliminationRate" value="${s.eliminationRate}"></label>
            </div>
            <details class="dt-set-details" id="dt-ai-box">
                <summary>🤖 Нейросеть: анализ сообщений (API)</summary>
                <small>Нейросеть определяет, кто и что выпил или как протрезвел, вместо текстовых правил. Если запрос не удался, работает обычный разбор. Каждое новое сообщение = один дополнительный запрос.</small>
                <label class="checkbox_label"><input type="checkbox" data-ai="aiEnabled" ${s.aiEnabled ? 'checked' : ''}><span>Анализировать сообщения нейросетью</span></label>
                <label>Источник
                    <select class="text_pole" data-ai="aiSource">
                        <option value="st" ${s.aiSource === 'st' ? 'selected' : ''}>Текущее подключение SillyTavern</option>
                        <option value="custom" ${s.aiSource === 'custom' ? 'selected' : ''}>Свой API (OpenAI-совместимый)</option>
                    </select>
                </label>
                <label>Адрес API <input type="text" class="text_pole" data-ai="aiUrl" placeholder="https://api.openai.com/v1" value="${esc(s.aiUrl)}"></label>
                <label>Ключ API <input type="password" class="text_pole" data-ai="aiKey" autocomplete="off" value="${esc(s.aiKey)}"></label>
                <label>Модель <input type="text" class="text_pole" data-ai="aiModel" placeholder="gpt-4o-mini" value="${esc(s.aiModel)}"></label>
                <div class="dt-set-row">
                    <label>Температура <input type="number" class="text_pole" min="0" max="2" step="0.1" data-ai="aiTemp" value="${s.aiTemp}"></label>
                    <label>Макс. токенов <input type="number" class="text_pole" min="100" max="4000" step="50" data-ai="aiMaxTokens" value="${s.aiMaxTokens}"></label>
                </div>
                <small>Адрес, ключ и модель нужны только для «Свой API». Ключ хранится в настройках SillyTavern открытым текстом. Браузер может блокировать запросы на чужой адрес (CORS): тогда используй источник «Текущее подключение» или прокси.</small>
                <button type="button" class="menu_button" id="dt-ai-test">Проверить подключение</button>
            </details>
            <div class="dt-set-row">
                <button type="button" class="menu_button" id="dt-open-panel">Открыть панель</button>
                <button type="button" class="menu_button" id="dt-open-cm">🍹 Cocktail Maker</button>
            </div>
            <details class="dt-set-details">
                <summary>Тексты поведения по стадиям</summary>
                <small>Подставляется в промпт. {{name}} заменяется на имя. Лучше писать на английском.</small>
                ${behaviors}
                <button type="button" class="menu_button" id="dt-reset-beh">Вернуть стандартные тексты</button>
            </details>
        </div>
    </div>`;
    host.appendChild(wrap);

    wrap.querySelectorAll('[data-set]').forEach(inp => {
        inp.addEventListener('change', () => {
            const k = inp.dataset.set;
            settings()[k] = inp.type === 'checkbox' ? inp.checked : (parseFloat(inp.value) || DEFAULT_SETTINGS[k]);
            saveSettingsDebounced();
            renderAll();
            updatePrompt();
        });
    });
    wrap.querySelectorAll('[data-ai]').forEach(inp => {
        inp.addEventListener('change', () => {
            const k = inp.dataset.ai;
            settings()[k] = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? (parseFloat(inp.value) || DEFAULT_SETTINGS[k]) : inp.value.trim());
            saveSettingsDebounced();
        });
    });
    wrap.querySelector('#dt-ai-test').addEventListener('click', async () => {
        const btn = wrap.querySelector('#dt-ai-test'); btn.disabled = true;
        try {
            const res = await aiAnalyze(0, '*Anna drinks a glass of red wine and slowly sips it.*', 'char');
            window.toastr?.success('Ответ получен: ' + esc(JSON.stringify(res)).slice(0, 300), 'Drunk Tracker', { escapeHtml: false });
        } catch (e) { window.toastr?.error('Не удалось: ' + esc(e.message), 'Drunk Tracker', { escapeHtml: false }); }
        btn.disabled = false;
    });
    wrap.querySelectorAll('[data-beh]').forEach(t => {
        t.addEventListener('input', () => {
            settings().behaviors[Number(t.dataset.beh)] = t.value;
            saveSettingsDebounced();
            updatePrompt();
        });
    });
    wrap.querySelector('#dt-open-panel').addEventListener('click', openPanel);
    wrap.querySelector('#dt-open-cm').addEventListener('click', openCocktailMaker);
    wrap.querySelector('#dt-reset-beh').addEventListener('click', () => {
        settings().behaviors = [...DEFAULT_BEHAVIORS];
        wrap.querySelectorAll('[data-beh]').forEach(t => { t.value = DEFAULT_BEHAVIORS[Number(t.dataset.beh)]; });
        saveSettingsDebounced();
        updatePrompt();
    });
}

/* ------------------------------------------------------------
 *  Запуск
 * ---------------------------------------------------------- */
function onChatChanged() {
    renderAll();
    updatePrompt();
}

jQuery(async () => {
    try {
        loadSettings();
        const cmHost = { settings: extension_settings, save: saveSettingsDebounced, getContext, logDrink: logCocktail, openTracker: openPanel };
        CMStorage.init(cmHost); CMBridge.init(cmHost); CMApp.init(cmHost);
        buildPanel();
        buildFab();
        buildSettings();
        if (!injectMenuButton()) setTimeout(injectMenuButton, 1500);
        selectDrink('beer');

        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        eventSource.on(event_types.MESSAGE_SENT, id => processMessage(Number(id)));
        eventSource.on(event_types.MESSAGE_RECEIVED, id => processMessage(Number(id)));
        eventSource.on(event_types.MESSAGE_EDITED, id => processMessage(Number(id)));
        eventSource.on(event_types.MESSAGE_SWIPED, id => processMessage(Number(id)));

        renderAll();
        updatePrompt();
        console.log(TAG, 'loaded');
    } catch (e) {
        console.error(TAG, 'init failed', e);
    }
});
