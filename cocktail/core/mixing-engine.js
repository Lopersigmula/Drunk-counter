// Мини-игра «рыбалка» (как в Stardew Valley): удерживай кнопку, чтобы поднимать зелёную полосу,
// и держи в ней убегающую каплю. Симуляция детерминирована: фиксированный шаг 1/60 с и сид вместо Math.random.
const clamp = (v, a = 0, b = 100) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);
const hash = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h; };
function rng(seed) {
  let a = hash(seed) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const DT = 1 / 60, LIMIT = 30;
// h — высота полосы (% шкалы), fish — макс. скорость капли, gain/loss — прирост/потеря прогресса в секунду, iv — интервал смены цели
const P = {
  1: { h: 36, fish: 26, gain: 26, loss: 8, iv: [.9, 1.8] },
  2: { h: 30, fish: 36, gain: 24, loss: 10, iv: [.7, 1.5] },
  3: { h: 24, fish: 48, gain: 22, loss: 12, iv: [.55, 1.2] },
  4: { h: 19, fish: 62, gain: 20, loss: 14, iv: [.4, 1.0] },
};
export function createSim(difficulty, seed, simple = false) {
  const p = P[difficulty] || P[2];
  const h = Math.min(60, Math.round(p.h * (simple ? 1.45 : 1))), loss = p.loss * (simple ? .55 : 1), spd = p.fish * (simple ? .7 : 1);
  const r = rng(seed), pick = () => 8 + r() * 84;
  const s = { h, bar: h / 2, vel: 0, fish: 50, target: pick(), nextAt: 0, progress: 40, t: 0, n: 0, inZone: 0, streak: 0, best: 0, sum: 0, sq: 0, done: false, win: false };
  s.step = hold => {
    if (s.done) return s;
    s.vel = clamp(s.vel + (hold ? 240 : -180) * DT, -110, 110);
    s.bar += s.vel * DT;
    const lo = h / 2, hi = 100 - h / 2;
    if (s.bar < lo) { s.bar = lo; s.vel = s.vel < 0 ? -s.vel * .3 : s.vel; }
    if (s.bar > hi) { s.bar = hi; s.vel = 0; }
    s.t += DT;
    if (s.t >= s.nextAt) { s.target = pick(); s.nextAt = s.t + p.iv[0] + r() * (p.iv[1] - p.iv[0]); }
    s.fish += Math.max(-spd * DT, Math.min(spd * DT, (s.target - s.fish) * 4 * DT));
    const e = s.fish - s.bar, inz = Math.abs(e) <= h / 2;
    s.n++; s.sum += e; s.sq += e * e; if (inz) { s.inZone++; s.streak += DT; if (s.streak > s.best) s.best = s.streak; } else s.streak = 0;
    s.progress = Math.min(100, s.progress + (inz ? p.gain : -loss) * DT);
    if (s.progress >= 100) { s.done = true; s.win = true; } else if (s.progress <= 0 || s.t >= LIMIT) s.done = true;
    return s;
  };
  s.stats = () => {
    const m = s.n ? s.sum / s.n : 0, sd = Math.sqrt(Math.max(0, (s.n ? s.sq / s.n : 0) - m * m));
    return { inZone: +(s.n ? s.inZone / s.n : 0).toFixed(3), sd: +sd.toFixed(2), streak: +s.best.toFixed(2), progress: Math.round(clamp(s.progress)), win: s.win, time: +s.t.toFixed(1) };
  };
  return s;
}
// Оценка техники 0–100 по фактическим действиям игрока. Веса настраиваются в config.mix.
export function scoreMix(stats, w = { accuracy: .5, stability: .3, intensity: .2 }) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return { technique: 0, accuracy: 0, stability: 0, intensity: 0 };
  const accuracy = Math.round(clamp(Number(stats.inZone) * 115));                // доля времени, когда капля внутри полосы
  const stability = Math.round(clamp(Number(stats.streak) * 40));                // самая долгая непрерывная серия удержания (2,5 с = 100)
  const intensity = Math.round(clamp(stats.win ? 100 : Number(stats.progress))); // завершённость: удалось ли «поймать» смесь
  const sw = (w.accuracy + w.stability + w.intensity) || 1;
  return { accuracy, stability, intensity, technique: Math.round(clamp((accuracy * w.accuracy + stability * w.stability + intensity * w.intensity) / sw)) };
}
