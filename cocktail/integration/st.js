// Единственный модуль, который общается с интерфейсом/API SillyTavern. Нейросеть не используется.
import { cocktailMessage } from './message-builder.js';
let host;
export const init = h => { host = h; };
const ctx = () => host.getContext();

function toInput(text) {
  const ta = document.getElementById('send_textarea');
  if (!ta) throw new Error('поле ввода не найдено');
  const cur = ta.value.replace(/\s+$/, '');
  ta.value = cur ? cur + '\n' + text : text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

async function toLastUser(text) {
  const c = ctx(), chat = c.chat || [];
  let i = chat.length - 1;
  while (i >= 0 && !chat[i].is_user) i--;
  if (i < 0) throw new Error('в чате нет сообщений пользователя');
  const m = chat[i];
  m.mes = (m.mes ? String(m.mes).replace(/\s+$/, '') + '\n\n' : '') + text;
  if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(i, m);
  else {
    const el = document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
    if (el && typeof c.messageFormatting === 'function') el.innerHTML = c.messageFormatting(m.mes, m.name, false, true, i);
  }
  if (typeof c.saveChat === 'function') await c.saveChat();
}

/** target: 'input' — в поле ввода, 'last' — в последнее сообщение пользователя. */
export async function sendResult(r, target, who = []) {
  const text = cocktailMessage(r, who);
  if (target === 'last') await toLastUser(text); else toInput(text);
}
