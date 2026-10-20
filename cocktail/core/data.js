// Игровые данные. Всё, что влияет на расчёт, определяется здесь, а не нейросетью.
export const MAX_AMOUNT = 60, STEP = 5;
export const INGREDIENTS = [
  { id: 'moon_citrus', name: 'Лунный цитрус', emoji: '🍋', sweet: 20, sour: 85, bitter: 10, fresh: 70, rich: 25, aroma: 60, color: '#e8f08a', rarity: 'common', unlock: 0, abv: 0, fx: [] },
  { id: 'amber_syrup', name: 'Янтарный сироп', emoji: '🍯', sweet: 90, sour: 5, bitter: 5, fresh: 10, rich: 60, aroma: 40, color: '#e09a2b', rarity: 'common', unlock: 0, abv: 0, fx: [] },
  { id: 'frost_berry', name: 'Морозная ягода', emoji: '🫐', sweet: 45, sour: 55, bitter: 10, fresh: 90, rich: 30, aroma: 50, color: '#8a6fe0', rarity: 'common', unlock: 0, abv: 0, fx: [] },
  { id: 'bitter_root', name: 'Горький корень', emoji: '🪵', sweet: 10, sour: 5, bitter: 90, fresh: 20, rich: 70, aroma: 35, color: '#5a3a22', rarity: 'common', unlock: 0, abv: 0, fx: [] },
  { id: 'flower_extract', name: 'Сладкий цветочный экстракт', emoji: '🌸', sweet: 75, sour: 10, bitter: 5, fresh: 40, rich: 35, aroma: 90, color: '#f08ab8', rarity: 'uncommon', unlock: 2, abv: 0, fx: [] },
  { id: 'silver_mint', name: 'Серебряная мята', emoji: '🌿', sweet: 15, sour: 10, bitter: 25, fresh: 95, rich: 15, aroma: 85, color: '#b8ffe0', rarity: 'uncommon', unlock: 3, abv: 0, fx: ['glow'] },
  { id: 'dark_infusion', name: 'Тёмный настой', emoji: '🫖', sweet: 15, sour: 10, bitter: 65, fresh: 15, rich: 95, aroma: 55, color: '#2a1a3a', rarity: 'rare', unlock: 5, abv: 0, fx: [] },
  { id: 'spark_essence', name: 'Искристая эссенция', emoji: '✨', sweet: 35, sour: 35, bitter: 10, fresh: 70, rich: 45, aroma: 70, color: '#9fe8ff', rarity: 'rare', unlock: 8, abv: 0, fx: ['bubbles'] },
  // --- Алкоголь (abv — крепость в %, доступен сразу) ---
  { id: 'vodka', name: 'Водка', emoji: '🍸', sweet: 0, sour: 0, bitter: 5, fresh: 35, rich: 45, aroma: 10, color: '#cfe9f2', rarity: 'alcohol', unlock: 0, abv: 40, fx: [] },
  { id: 'gin', name: 'Джин', emoji: '🫒', sweet: 5, sour: 5, bitter: 40, fresh: 55, rich: 45, aroma: 80, color: '#bfe6e0', rarity: 'alcohol', unlock: 0, abv: 40, fx: [] },
  { id: 'rum', name: 'Ром', emoji: '🏴‍☠️', sweet: 35, sour: 0, bitter: 10, fresh: 15, rich: 65, aroma: 55, color: '#a86a2a', rarity: 'alcohol', unlock: 0, abv: 40, fx: [] },
  { id: 'tequila', name: 'Текила', emoji: '🌵', sweet: 10, sour: 10, bitter: 20, fresh: 40, rich: 55, aroma: 50, color: '#e9d38a', rarity: 'alcohol', unlock: 0, abv: 40, fx: [] },
  { id: 'whiskey', name: 'Виски', emoji: '🥃', sweet: 15, sour: 0, bitter: 35, fresh: 5, rich: 85, aroma: 75, color: '#b8651b', rarity: 'alcohol', unlock: 0, abv: 40, fx: [] },
  { id: 'cognac', name: 'Коньяк', emoji: '🥃', sweet: 25, sour: 0, bitter: 25, fresh: 5, rich: 85, aroma: 85, color: '#a2531a', rarity: 'alcohol', unlock: 0, abv: 40, fx: [] },
  { id: 'liqueur', name: 'Апельсиновый ликёр', emoji: '🍊', sweet: 80, sour: 10, bitter: 15, fresh: 35, rich: 50, aroma: 85, color: '#f0a03a', rarity: 'alcohol', unlock: 0, abv: 25, fx: [] },
  { id: 'vermouth', name: 'Вермут', emoji: '🍷', sweet: 40, sour: 15, bitter: 50, fresh: 20, rich: 45, aroma: 80, color: '#c9a64a', rarity: 'alcohol', unlock: 0, abv: 16, fx: [] },
  { id: 'sparkling', name: 'Игристое', emoji: '🥂', sweet: 30, sour: 40, bitter: 5, fresh: 85, rich: 20, aroma: 55, color: '#f3d98a', rarity: 'alcohol', unlock: 0, abv: 11.5, fx: ['bubbles'] },
];
export const GLASSES = [
  { id: 'coupe', name: 'Купе', cap: 90, style: 'elegant' },
  { id: 'highball', name: 'Хайбол', cap: 150, style: 'casual' },
  { id: 'rocks', name: 'Рокс', cap: 110, style: 'bold' },
];
export const GARNISHES = [
  { id: 'none', name: 'Без украшения', emoji: '—', styles: [], unlock: 0 },
  { id: 'mint', name: 'Лист мяты', emoji: '🌿', styles: ['elegant', 'casual'], unlock: 0 },
  { id: 'citrus', name: 'Долька цитруса', emoji: '🍋', styles: ['casual', 'elegant'], unlock: 0 },
  { id: 'sugar', name: 'Сахарный ободок', emoji: '✨', styles: ['bold', 'elegant'], unlock: 0 },
  { id: 'ice', name: 'Лёд', emoji: '🧊', styles: ['casual', 'bold'], unlock: 0 },
  { id: 'orb', name: 'Светящаяся сфера', emoji: '🔮', styles: ['bold'], unlock: 6 },
];
export const SYNERGIES = [
  { a: 'moon_citrus', b: 'silver_mint', name: 'Лунный бриз', bonus: { aroma: 15, freshness: 5 } },
  { a: 'amber_syrup', b: 'bitter_root', name: 'Карамельная горечь', bonus: { richness: 15 } },
  { a: 'frost_berry', b: 'spark_essence', name: 'Ледяные искры', bonus: { freshness: 10 } },
  { a: 'flower_extract', b: 'moon_citrus', name: 'Цветочно-цитрусовая нота', bonus: { aroma: 10 } },
  { a: 'gin', b: 'vermouth', name: 'Мартини', bonus: { aroma: 12, richness: 5 } },
  { a: 'rum', b: 'moon_citrus', name: 'Дайкири', bonus: { freshness: 10 } },
  { a: 'tequila', b: 'moon_citrus', name: 'Маргарита', bonus: { freshness: 8, aroma: 6 } },
  { a: 'whiskey', b: 'bitter_root', name: 'Олд фэшн', bonus: { richness: 10, aroma: 8 } },
  { a: 'vodka', b: 'frost_berry', name: 'Ягодный лёд', bonus: { freshness: 8 } },
  { a: 'sparkling', b: 'liqueur', name: 'Игристый вечер', bonus: { aroma: 10, freshness: 5 } },
];
export const isUnlocked = (x, served) => (x.unlock || 0) <= served;
// Запасные заказы, когда нейросеть недоступна.
export const OFFLINE_ORDERS = [
  { description: 'Хочется чего-то прохладного, с лёгкой кислинкой, без лишней сладости.', temperature: 'cold', sweetness: { target: 25, tolerance: 32 }, sourness: { target: 65, tolerance: 32 }, bitterness: { target: 15, tolerance: 32 }, intensity: { target: 40, tolerance: 32 }, presentation: 'any' },
  { description: 'Что-нибудь сладкое и ароматное, чтобы выдохнуть.', temperature: 'cool', sweetness: { target: 70, tolerance: 20 }, sourness: { target: 20, tolerance: 20 }, bitterness: { target: 10, tolerance: 20 }, intensity: { target: 50, tolerance: 20 }, presentation: 'elegant' },
  { description: 'Покрепче и погорче. Вечер был тяжёлым.', temperature: 'warm', sweetness: { target: 25, tolerance: 15 }, sourness: { target: 15, tolerance: 15 }, bitterness: { target: 65, tolerance: 15 }, intensity: { target: 75, tolerance: 15 }, presentation: 'bold' },
  { description: 'Сладко-кислый, но холодный и яркий. Удиви меня.', temperature: 'cold', sweetness: { target: 50, tolerance: 12 }, sourness: { target: 50, tolerance: 12 }, bitterness: { target: 20, tolerance: 12 }, intensity: { target: 55, tolerance: 12 }, presentation: 'bold' },
];
