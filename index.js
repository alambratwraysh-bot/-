import TelegramBot from 'node-telegram-bot-api';
import crypto from 'node:crypto';

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error('ضع BOT_TOKEN في المتغيرات');

const bot = new TelegramBot(TOKEN, { polling: true });
const API = 'https://api.mail.tm';
const users = new Map(); // chatId -> { id, address, password, token, ids: [] }

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || data['hydra:description'] || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function login(u) {
  const t = await api('/token', {
    method: 'POST',
    body: { address: u.address, password: u.password },
  });
  u.token = t.token;
}

async function withAuth(u, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === 401) {
      await login(u);
      return fn();
    }
    throw e;
  }
}

async function createAccount() {
  const domains = await api('/domains');
  const domain = domains['hydra:member'][0].domain;
  const address = `${crypto.randomBytes(5).toString('hex')}@${domain}`;
  const password = crypto.randomBytes(9).toString('hex');
  const acc = await api('/accounts', { method: 'POST', body: { address, password } });
  const u = { id: acc.id, address, password, token: null, ids: [] };
  await login(u);
  return u;
}

bot.onText(/^\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'أهلاً! أنشئ بريداً مؤقتاً واستقبل الرسائل هنا.\n\n' +
      '/new - بريد مؤقت جديد\n' +
      '/inbox - عرض الرسائل\n' +
      '/read رقم - قراءة رسالة\n' +
      '/delete - حذف البريد'
  );
});

bot.onText(/^\/new/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const u = await createAccount();
    users.set(chatId, u);
    bot.sendMessage(chatId, `تم إنشاء بريدك المؤقت:\n\n${u.address}\n\nاستخدمه ثم اكتب /inbox لرؤية الرسائل.`);
  } catch (e) {
    bot.sendMessage(chatId, 'تعذر إنشاء البريد: ' + e.message);
  }
});

bot.onText(/^\/inbox/, async (msg) => {
  const chatId = msg.chat.id;
  const u = users.get(chatId);
  if (!u) return bot.sendMessage(chatId, 'ليس لديك بريد. اكتب /new أولاً.');
  try {
    const data = await withAuth(u, () => api('/messages', { token: u.token }));
    const list = data['hydra:member'];
    u.ids = list.map((m) => m.id);
    if (!list.length) return bot.sendMessage(chatId, `لا توجد رسائل بعد في:\n${u.address}`);
    const text = list
      .slice(0, 15)
      .map((m, i) => `${i + 1}. ${m.from?.address || '?'}\n   ${m.subject || '(بدون عنوان)'}`)
      .join('\n\n');
    bot.sendMessage(chatId, text + '\n\nللقراءة: /read 1');
  } catch (e) {
    bot.sendMessage(chatId, 'خطأ: ' + e.message);
  }
});

bot.onText(/^\/read\s+(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const u = users.get(chatId);
  if (!u) return bot.sendMessage(chatId, 'اكتب /new أولاً.');
  const id = u.ids[Number(match[1]) - 1];
  if (!id) return bot.sendMessage(chatId, 'رقم غير صحيح. اكتب /inbox أولاً.');
  try {
    const m = await withAuth(u, () => api(`/messages/${id}`, { token: u.token }));
    const body = (m.text || '(الرسالة بدون نص)').slice(0, 3500);
    bot.sendMessage(chatId, `من: ${m.from?.address}\nالعنوان: ${m.subject}\n\n${body}`);
  } catch (e) {
    bot.sendMessage(chatId, 'خطأ: ' + e.message);
  }
});

bot.onText(/^\/delete/, async (msg) => {
  const chatId = msg.chat.id;
  const u = users.get(chatId);
  if (!u) return bot.sendMessage(chatId, 'ليس لديك بريد.');
  try {
    await withAuth(u, () => api(`/accounts/${u.id}`, { method: 'DELETE', token: u.token }));
    users.delete(chatId);
    bot.sendMessage(chatId, 'تم حذف البريد.');
  } catch (e) {
    bot.sendMessage(chatId, 'خطأ: ' + e.message);
  }
});

console.log('Bot is running...');
