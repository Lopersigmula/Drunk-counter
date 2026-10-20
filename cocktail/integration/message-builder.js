// Формирует сообщение с данными коктейля. Формат:
// > 🍸**Название:** <span style="display:none;">
// <system_note>
// данные коктейля
// </system_note>
// </span>
import { INGREDIENTS, GLASSES, GARNISHES } from '../core/data.js';

const IM = Object.fromEntries(INGREDIENTS.map(i => [i.id, i]));
const GM = Object.fromEntries(GLASSES.map(g => [g.id, g]));
const AM = Object.fromEntries(GARNISHES.map(g => [g.id, g]));
const clean = s => String(s ?? '').replace(/[<>*_`|]/g, '').replace(/\{\{/g, '{ {').replace(/\s+/g, ' ').trim();
const fmtNum = n => String(Math.round(n * 10) / 10).replace('.', ',');

/** who — массив имён тех, кто пьёт этот коктейль (может быть пустым). */
export function cocktailMessage(r, who = []) {
  const name = clean(r.drinkName) || 'Коктейль';
  const t = r.taste;
  const ing = r.ingredients.map(i => `${clean((IM[i.id] || { name: i.id }).name)} ${i.amount} мл`).join(', ');
  const glass = clean((GM[r.glass] || { name: r.glass }).name);
  const garnish = r.garnish && r.garnish !== 'none' ? clean((AM[r.garnish] || { name: r.garnish }).name) : 'без украшения';
  const strength = r.abv > 0 ? `крепость около ${fmtNum(r.abv)}% (чистого спирта ~${fmtNum(r.alcoholMl)} мл)` : 'безалкогольный';
  const lines = [
    `Приготовлен коктейль «${name}». Состав: ${ing}. Объём ${r.volume} мл, ${strength}.`,
    `Бокал: ${glass}; украшение: ${garnish}.`,
    `Вкус (0–100): сладость ${t.sweetness}, кислотность ${t.sourness}, горечь ${t.bitterness}, свежесть ${t.freshness}, насыщенность ${t.richness}, аромат ${t.aroma}.`,
  ];
  if (r.mode === 'order' && r.orderDesc) lines.push(`Заказ был такой: «${clean(r.orderDesc)}».`);
  lines.push(who.length ? `Коктейль выпивает: ${who.map(clean).join(' и ')}.` : 'Коктейль пока никто не пьёт.');
  return `> 🍸**${name}:** <span style="display:none;">\n<system_note>\n${lines.join('\n')}\n</system_note>\n</span>`;
}
