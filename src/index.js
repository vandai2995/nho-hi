// Nhớ Hỉ — Cloudflare Worker: webhook Telegram + cron nhắc (7:00, 12:00, 20:00 giờ Việt Nam) + lịch .ics.
// Mỗi người có một lịch riêng, và có thể tham gia một lịch chung của gia đình. Ngày mới mặc định là riêng; muốn chung thì bấm chia sẻ.
import {
  vnTodayJd,
  vnHour,
  parseAdd,
  parseConvert,
  parseOffsets,
  sanitizeEvents,
  builtinEvents,
  dedupeHolidays,
  buildDays,
  nextOccurrence,
  describeEvent,
  listMessage,
  buildDaily,
  eveningMessage,
  convertMessage,
  pruneExpired,
  icsCalendar,
  almanacText,
  whenText,
  upcoming,
  esc,
  DEFAULT_OFFSETS,
} from './core.js';
import { jdToDate } from './lunar.js';

// ---------- Giao diện: nút cố định dưới ô nhập tin ----------

const BTN = { add: '➕ Thêm ngày', list: '📋 Danh sách', today: '📅 Hôm nay', settings: '⚙️ Cài đặt' };
const MENU = {
  keyboard: [
    [{ text: BTN.add }, { text: BTN.list }],
    [{ text: BTN.today }, { text: BTN.settings }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const kb = (...rows) => ({ inline_keyboard: rows });
const btn = (text, data) => ({ text, callback_data: data });

const WELCOME = `👋 Chào bạn, mình là <b>Nhớ Hỉ</b> — nhắc bạn những ngày cần nhớ, cả âm lịch lẫn dương lịch.

Nhắn cho mình như nói chuyện là mình lưu:
<i>giỗ ông nội rằm tháng ba</i>
<i>sinh nhật mẹ 20/10</i>

Nhập một lần, năm nào mình cũng tự tính ngày và nhắc lúc 7:00 sáng. Mọi thứ khác nằm ở 4 nút bên dưới.`;

const ADD_HINT = `Nhắn cho mình tên và ngày, ví dụ:

<i>giỗ ông nội rằm tháng ba</i>
<i>sinh nhật mẹ 20/10</i>
<i>ngày cưới 2/9/2015</i>  (có năm → báo "tròn N năm")
<i>cúng rằm hàng tháng</i>
<i>họp lớp 20/12/2026 một lần</i>

Ngày âm thì thêm chữ <b>âm</b> sau ngày: <i>giỗ bà 8/1 âm</i>`;

const HELP = `<b>Nhớ Hỉ — hướng dẫn nhanh</b>

<b>Thêm ngày:</b> nhắn tên và ngày, ví dụ <i>giỗ ông nội rằm tháng ba</i>.
<b>Xem, sửa, xoá:</b> bấm 📋 Danh sách rồi bấm số của ngày đó.
<b>Việc cần làm, ghi chép từng năm:</b> nằm trong thẻ của mỗi ngày.
<b>Chia sẻ với gia đình:</b> ngày bạn thêm là của riêng bạn; mở ngày đó và bấm "Chia sẻ với gia đình" để cả nhà cùng được nhắc.
<b>Ngày lễ, lịch chung, lịch điện thoại, sao lưu:</b> bấm ⚙️ Cài đặt.

<b>Bot nhắc khi nào</b>
• 7:00 sáng: đúng ngày, trước 1 ngày và trước 3 ngày (đổi được cho từng ngày).
• Đúng ngày mà chưa bấm "Đã biết" thì 20:00 nhắc lại.
• Ngày 1 hằng tháng: tổng kết tháng kèm file sao lưu.

<b>Lệnh gõ tay</b> (dùng trong nhóm, hoặc khi thích gõ)
/them Giỗ bà 8/1 âm nhắc 0,1,7 | mua hoa
/ds · /sapden 30 · /xoa 3 · /sua 3 16/3 âm
/homnay · /doi 15/3/2027 âm · /thu`;

// ---------- KV và Telegram (đếm số lượt gọi để không vượt giới hạn gói Free) ----------

const BUDGET = 40; // gói Free cho 50 lượt gọi ra ngoài mỗi lần chạy
let ops = 0;
const kv = {
  get: (env, k, type) => (ops++, env.REMINDERS.get(k, type)),
  put: (env, k, v, o) => (ops++, env.REMINDERS.put(k, v, o)),
  del: (env, k) => (ops++, env.REMINDERS.delete(k)),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tgFetch(env, method, init) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(400 * attempt);
    ops++;
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, init);
      if (res.ok) return (await res.json()).result;
      lastErr = Object.assign(new Error(`Telegram ${method} lỗi ${res.status}: ${await res.text()}`), { status: res.status });
      if (res.status !== 429 && res.status < 500) break; // lỗi do yêu cầu: thử lại cũng vô ích
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const tg = (env, method, body) =>
  tgFetch(env, method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function send(env, chatId, text, markup) {
  // Telegram giới hạn 4096 ký tự mỗi tin: cắt theo đoạn. Nút bấm gắn vào tin cuối.
  const chunks = [];
  let cur = '';
  for (const block of text.split('\n\n')) {
    if (cur && cur.length + block.length + 2 > 3800) {
      chunks.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    const body = { chat_id: chatId, text: chunks[i], parse_mode: 'HTML', disable_web_page_preview: true };
    if (markup && i === chunks.length - 1) body.reply_markup = markup;
    await tg(env, 'sendMessage', body);
  }
}

async function sendBackup(env, chatId, sp, caption) {
  const backup = { app: 'nho-hi', version: 2, holidays: sp.holidays, events: sp.events };
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('document', new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), 'nho-hi-saoluu.json');
  await tgFetch(env, 'sendDocument', { method: 'POST', body: form });
}

// Gửi cho mọi thành viên của sổ. Ai đã chặn bot hoặc nhóm đã xoá bot thì bỏ qua; lỗi khác thì dừng để lần sau gửi lại.
async function broadcast(env, sp, text, markup) {
  for (const m of sp.members) {
    try {
      await send(env, m.id, text, markup);
    } catch (err) {
      if (err.status !== 403 && err.status !== 400) throw err;
      console.error(`Bỏ qua ${m.id}:`, err.message);
    }
  }
}

async function botName(env) {
  let name = await kv.get(env, 'botname');
  if (!name) {
    name = (await tg(env, 'getMe', {})).username;
    await kv.put(env, 'botname', name);
  }
  return name;
}

// ---------- Sổ (space) ----------

const randHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const randCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

const normalize = (sp) => ({ kind: 'p', nextId: 1, events: [], members: [], holidays: {}, ack: null, icsToken: null, ...sp });
const saveSpace = (env, sp) => kv.put(env, `space:${sp.id}`, JSON.stringify(sp));
const saveChat = (env, chatId, rec) => kv.put(env, `chat:${chatId}`, JSON.stringify(rec));
const allEvents = (sp) => [...sp.events, ...builtinEvents(sp.holidays)];

// Mỗi ngày đang nạp được gắn mã tham chiếu ("p3" = ngày riêng số 3, "f3" = ngày chung số 3) và sổ chứa nó.
const refs = new WeakMap();
const homes = new WeakMap();
function track(sp, ev) {
  refs.set(ev, `${sp.kind}${ev.id}`);
  homes.set(ev, sp);
  return ev;
}
const ref = (ev) => refs.get(ev);
const home = (ev) => homes.get(ev);

async function loadSpace(env, id) {
  const raw = id && (await kv.get(env, `space:${id}`, 'json'));
  if (!raw) return null;
  const sp = normalize(raw);
  sp.events.forEach((ev) => track(sp, ev));
  return sp;
}

// kind 'p': lịch riêng của một người. kind 'f': lịch chung của gia đình, có mã mời.
async function newSpace(env, kind, chatId, name) {
  const sp = normalize({ id: randHex(8), kind, owner: chatId, members: [{ id: chatId, name }] });
  if (kind === 'f') {
    sp.invite = randCode();
    await kv.put(env, `invite:${sp.invite}`, sp.id);
  }
  await saveSpace(env, sp);
  return sp;
}

/** Lịch riêng và lịch chung của một chat. Nhóm chat chỉ có lịch chung. */
async function loadSpaces(env, chatId) {
  const rec = await kv.get(env, `chat:${chatId}`, 'json');
  if (!rec) return { rec: null, personal: null, family: null };
  return { rec, personal: await loadSpace(env, rec.space), family: await loadSpace(env, rec.family) };
}

const ownEvents = (ctx) => [...(ctx.personal?.events ?? []), ...(ctx.family?.events ?? [])];
// Bản sao có id duy nhất, dùng khi gộp ngày riêng, ngày chung và ngày lễ vào một phép tính.
const merged = (ctx) => [...ownEvents(ctx).map((ev) => ({ ...ev, id: ref(ev) })), ...builtinEvents(ctx.sp.holidays)];
// Để xem lịch (không phải để nhắc): mọi ngày lễ đều hiện, dù có bật nhắc hay không.
const calendar = (ctx) => [...ownEvents(ctx).map((ev) => ({ ...ev, id: ref(ev) })), ...builtinEvents({ annual: true, hue: true, monthly: true })];

async function moveEvent(env, ev, to) {
  const from = home(ev);
  from.events = from.events.filter((e) => e !== ev);
  const moved = track(to, { ...ev, id: to.nextId++ });
  to.events.push(moved);
  await saveSpace(env, from);
  await saveSpace(env, to);
  return moved;
}

async function leaveFamily(ctx) {
  const { env, family, personal, chatId, rec } = ctx;
  if (!family) return 'Bạn chưa tham gia lịch chung nào.';
  family.members = family.members.filter((m) => m.id !== chatId);
  let note = '';
  if (family.members.length) {
    if (family.owner === chatId) family.owner = family.members[0].id;
    await saveSpace(env, family);
  } else {
    // Người cuối cùng rời đi: giữ lại các ngày chung trong lịch riêng của họ rồi xoá lịch chung.
    if (personal && family.events.length) {
      for (const ev of family.events) personal.events.push(track(personal, { ...ev, id: personal.nextId++ }));
      await saveSpace(env, personal);
      note = ` ${family.events.length} ngày chung đã được chuyển về lịch riêng của bạn.`;
    }
    await kv.del(env, `space:${family.id}`);
    await kv.del(env, `invite:${family.invite}`);
    if (family.icsToken) await kv.del(env, `ics:${family.icsToken}`);
  }
  ctx.family = null;
  if (rec?.space) await saveChat(env, chatId, { space: rec.space });
  else await kv.del(env, `chat:${chatId}`);
  return `Đã rời lịch chung.${note}`;
}

async function joinFamily(ctx, code) {
  const { env, chatId, who } = ctx;
  const target = await loadSpace(env, await kv.get(env, `invite:${code}`));
  // Mã mời của bản cũ trỏ vào lịch riêng: không cho ai vào lịch riêng của người khác.
  if (target?.kind !== 'f') return 'Mã mời không đúng hoặc đã hết hiệu lực.';
  if (ctx.family?.id === target.id) return 'Bạn đã ở trong lịch chung này rồi.';
  if (ctx.family) await leaveFamily(ctx);
  target.members.push({ id: chatId, name: who });
  await saveSpace(env, target);
  ctx.rec = { space: ctx.personal?.id ?? null, family: target.id };
  await saveChat(env, chatId, ctx.rec);
  ctx.family = target;
  return `✅ Đã vào lịch chung (${target.members.length} thành viên, ${target.events.length} ngày chung).`;
}

// ---------- Các màn hình (text + nút) ----------

const PAGE = 8;
function findEvent(ctx, r) {
  const m = /^([pf])(\d+)$/.exec(String(r));
  const sp = m && (m[1] === 'p' ? ctx.personal : ctx.family);
  return sp?.events.find((e) => e.id === Number(m[2]));
}
const FAM = '👨‍👩‍👧';
const isShared = (ev) => home(ev)?.kind === 'f';
const byNumber = (ctx, n) => upcoming(ownEvents(ctx), ctx.today)[Number(n) - 1]?.ev;
const occOf = (ev, today) => nextOccurrence(ev, buildDays(today, 400));
const short = (s, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const section = (occ) => (!occ ? '⌛ Đã qua' : occ.diff <= 7 ? '🔜 Trong 7 ngày tới' : occ.diff <= 30 ? '🗓 Trong 30 ngày tới' : '⏳ Xa hơn');

const ALL_HOLIDAYS = builtinEvents({ annual: true, hue: true, monthly: true });
const HOLIDAY_WINDOW = 30;

// Lịch sắp tới: các ngày của người dùng (đánh số, bấm được) xen với ngày lễ trong 30 ngày tới (chỉ để xem).
function listView(ctx, today, page = 0) {
  const mine = upcoming(ownEvents(ctx), today).map((x, i) => ({ ...x, n: i + 1 }));
  const holidays = dedupeHolidays(upcoming(ALL_HOLIDAYS, today).filter((x) => x.occ && x.occ.diff <= HOLIDAY_WINDOW));
  const items = [...mine, ...holidays].sort((a, b) => (a.occ?.diff ?? Infinity) - (b.occ?.diff ?? Infinity));
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = items.slice(page * PAGE, page * PAGE + PAGE);
  const blocks = [];
  let prev = null;
  for (const { ev, occ, n } of slice) {
    const sec = section(occ);
    if (sec !== prev) blocks.push(`<b>${sec}</b>`);
    prev = sec;
    const when = occ ? whenText(ev, occ) : 'đã qua';
    blocks.push(n ? `${n}. ${isShared(ev) ? `${FAM} ` : ''}<b>${esc(ev.name)}</b>\n     ${when}` : `🏮 ${esc(ev.name)}\n     ${when}`);
  }
  const nums = slice.filter((x) => x.n).map(({ ev, n }) => btn(String(n), `e:${ref(ev)}`));
  const rows = [nums.slice(0, 4), nums.slice(4)].filter((r) => r.length);
  const nav = [];
  if (page > 0) nav.push(btn('‹ Trước', `ls:${page - 1}`));
  if (page < pages - 1) nav.push(btn('Sau ›', `ls:${page + 1}`));
  if (nav.length) rows.push(nav);

  const notes = [];
  if (mine.length) notes.push('Bấm số để xem, sửa hoặc xoá.');
  else notes.push('Bạn chưa lưu ngày nào. Nhắn tên và ngày để thêm, ví dụ: <i>giỗ ông nội rằm tháng ba</i>');
  if (slice.some((x) => x.n && isShared(x.ev))) notes.push(`${FAM} = ngày chung của gia đình.`);
  const h = ctx.sp.holidays;
  if (slice.some((x) => !x.n) && !(h.annual && h.hue && h.monthly)) notes.push('🏮 Muốn được nhắc ngày lễ: ⚙️ Cài đặt → Ngày lễ có sẵn.');
  const pageNote = pages > 1 ? ` · trang ${page + 1}/${pages}` : '';
  return {
    text: `📋 <b>Lịch sắp tới</b> (${mine.length} ngày của bạn${pageNote})\n\n${blocks.join('\n\n')}\n\n${notes.join('\n')}`,
    markup: rows.length ? kb(...rows) : undefined,
  };
}

function cardText(ev, today) {
  const occ = occOf(ev, today);
  const tasks = ev.tasks ?? [];
  const done = occ ? tasks.filter((t) => t.done === occ.jd).length : 0;
  let s = `<b>${esc(ev.name)}</b>\n${describeEvent(ev)}`;
  if (isShared(ev)) s += `\n${FAM} Ngày chung của gia đình`;
  if (ev.note) s += `\n📝 ${esc(ev.note)}`;
  s += `\n⏳ ${occ ? whenText(ev, occ) : 'đã qua'}`;
  if (tasks.length) s += `\n☑️ Việc cần làm: xong ${done}/${tasks.length}`;
  if (ev.log?.length) s += `\n📖 Có ghi chép của ${ev.log.length} năm`;
  return s;
}

function cardView(ctx, ev, today) {
  const rows = [
    [btn('✏️ Sửa', `ed:${ref(ev)}`), btn('☑️ Việc cần làm', `tk:${ref(ev)}`)],
    [btn('📖 Ghi chép', `lg:${ref(ev)}`), btn('🗑 Xoá', `dl:${ref(ev)}`)],
  ];
  // Chỉ hiện khi người này có cả lịch riêng lẫn lịch chung.
  if (ctx.personal && ctx.family) rows.push([btn(isShared(ev) ? '👤 Chuyển về lịch riêng' : `${FAM} Chia sẻ với gia đình`, `sh:${ref(ev)}`)]);
  rows.push([btn('‹ Danh sách', 'ls:0')]);
  return { text: cardText(ev, today), markup: kb(...rows) };
}

const editView = (ev, today) => ({
  text: `${cardText(ev, today)}\n\nBạn muốn sửa gì?`,
  markup: kb(
    [btn('Tên', `w:name:${ref(ev)}`), btn('Ngày', `w:date:${ref(ev)}`)],
    [btn('Nhắc trước mấy ngày', `of:${ref(ev)}`), btn('Giờ nhắc', `sl:${ref(ev)}`)],
    [btn('Ghi chú', `w:note:${ref(ev)}`)],
    [btn('‹ Quay lại', `e:${ref(ev)}`)],
  ),
});

function offsetsView(ev) {
  const offs = ev.offsets ?? DEFAULT_OFFSETS;
  const opt = (n, label) => btn(`${offs.includes(n) ? '✅' : '⬜'} ${label}`, `of:${ref(ev)}:${n}`);
  return {
    text: `<b>${esc(ev.name)}</b>\nNhắc vào những lúc nào? Bấm để bật/tắt.`,
    markup: kb(
      [opt(0, 'Đúng ngày'), opt(1, 'Trước 1 ngày')],
      [opt(3, 'Trước 3 ngày'), opt(7, 'Trước 7 ngày')],
      [opt(14, 'Trước 14 ngày'), opt(30, 'Trước 30 ngày')],
      [btn('‹ Quay lại', `ed:${ref(ev)}`)],
    ),
  };
}

function slotView(ev) {
  const cur = ev.slot ?? 'am';
  const opt = (slot, label) => btn(`${cur === slot ? '✅ ' : ''}${label}`, `sl:${ref(ev)}:${slot}`);
  return {
    text: `<b>${esc(ev.name)}</b>\nNhắc vào giờ nào trong ngày?`,
    markup: kb([opt('am', '7:00 sáng'), opt('noon', '12:00 trưa'), opt('pm', '20:00 tối')], [btn('‹ Quay lại', `ed:${ref(ev)}`)]),
  };
}

function tasksView(ev, today) {
  const occ = occOf(ev, today);
  const tasks = ev.tasks ?? [];
  const isDone = (t) => Boolean(occ) && t.done === occ.jd;
  const lines = tasks.map((t) => `${isDone(t) ? '☑️' : '☐'} ${esc(t.t)}${t.w ? ` — ${esc(t.w)}` : ''}`);
  const body = tasks.length
    ? `${lines.join('\n')}\n\nBấm vào việc để đánh dấu xong. Sang lần sau các việc tự trở lại "chưa xong".`
    : 'Chưa có việc nào. Ví dụ: mua hoa, đặt cỗ, báo bà con.';
  const rows = tasks.map((t, i) => [btn(`${isDone(t) ? '☑️' : '☐'} ${short(t.t)}`, `tt:${ref(ev)}:${i}`)]);
  rows.push([btn('➕ Thêm việc', `w:task:${ref(ev)}`), ...(tasks.length ? [btn('🧹 Xoá việc đã xong', `tc:${ref(ev)}`)] : [])]);
  rows.push([btn('‹ Quay lại', `e:${ref(ev)}`)]);
  return { text: `☑️ <b>Việc cần làm — ${esc(ev.name)}</b>\n\n${body}`, markup: kb(...rows) };
}

function logView(ev, today) {
  const year = jdToDate(today).y;
  const log = [...(ev.log ?? [])].sort((a, b) => b.y - a.y);
  const body = log.length
    ? log.map((x) => `<b>${x.y}</b>: ${esc(x.t)}`).join('\n\n')
    : 'Chưa có ghi chép. Ghi lại năm nay làm thế nào (mấy mâm, mời ai, lưu ý gì) để năm sau khỏi phải nhớ.';
  return {
    text: `📖 <b>Ghi chép — ${esc(ev.name)}</b>\n\n${body}`,
    markup: kb([btn(`➕ Ghi cho năm ${year}`, `w:log:${ref(ev)}`)], [btn('‹ Quay lại', `e:${ref(ev)}`)]),
  };
}

const settingsView = () => ({
  text: '⚙️ <b>Cài đặt</b>',
  markup: kb(
    [btn('🏮 Ngày lễ có sẵn', 'st:le')],
    [btn('👨‍👩‍👧 Dùng chung với gia đình', 'st:fam')],
    [btn('📆 Lịch trên điện thoại', 'st:cal')],
    [btn('💾 Sao lưu', 'st:bak'), btn('❓ Hướng dẫn', 'st:help')],
  ),
});
const BACK_SETTINGS = [btn('‹ Cài đặt', 'st:home')];

function holidayView(h) {
  const on = (v) => (v ? '✅ đang bật' : '⬜ đang tắt');
  return {
    text:
      `🏮 <b>Ngày lễ có sẵn</b>\n\n` +
      `<b>Lễ tết hằng năm</b> — ${on(h.annual)}\nTết Nguyên Đán, rằm tháng Giêng, Giỗ Tổ, Đoan Ngọ, Vu Lan, Trung thu, ông Táo, 8/3, 30/4, 2/9, 20/10, 20/11, 24/11, Giáng sinh...\n\n` +
      `<b>Ngày lễ Huế</b> — ${on(h.hue)}\nCúng âm hồn 23/5 âm (nhắc trước 3 ngày), giải phóng Huế 26/3, hội vật làng Sình, cầu ngư Thai Dương Hạ, lễ hội Quán Thế Âm.\n\n` +
      `<b>Mùng 1 và rằm hằng tháng</b> — ${on(h.monthly)}\n\nNgày lễ được nhắc đúng ngày và trước 1 ngày.`,
    markup: kb(
      [btn(`${h.annual ? 'Tắt' : 'Bật'} lễ tết hằng năm`, 'hol:annual')],
      [btn(`${h.hue ? 'Tắt' : 'Bật'} ngày lễ Huế`, 'hol:hue')],
      [btn(`${h.monthly ? 'Tắt' : 'Bật'} mùng 1 và rằm`, 'hol:monthly')],
      BACK_SETTINGS,
    ),
  };
}

async function familyView(ctx) {
  const { env, family } = ctx;
  if (!family) {
    return {
      text:
        `${FAM} <b>Dùng chung với gia đình</b>\nTạo một lịch chung để cả nhà cùng nhận tin nhắc những ngày như giỗ, tết, sinh nhật.\n\n` +
        `Ngày bạn thêm vẫn là <b>của riêng bạn</b>. Ngày nào muốn cả nhà cùng nhớ thì mở ngày đó và bấm "Chia sẻ với gia đình".`,
      markup: kb([btn('Tạo lịch chung và lấy link mời', 'fam:new')], BACK_SETTINGS),
    };
  }
  const names = family.members.map((m) => esc(m.name)).join(', ');
  return {
    text:
      `${FAM} <b>Lịch chung của gia đình</b>\nThành viên: ${names}\nĐang có ${family.events.length} ngày chung.\n\n` +
      `<b>Mời một người:</b> gửi cho họ link dưới đây, họ bấm vào là vào lịch chung.\nhttps://t.me/${await botName(env)}?start=join_${family.invite}\n\n` +
      `<b>Nhắc vào nhóm chat gia đình:</b> thêm bot vào nhóm rồi gõ trong nhóm:\n<code>/thamgia ${family.invite}</code>\n\n` +
      `Ngày bạn thêm mặc định là của riêng bạn. Muốn cả nhà cùng nhớ: mở ngày đó, bấm "Chia sẻ với gia đình".`,
    markup: kb([btn('Rời lịch chung', 'lv')], BACK_SETTINGS),
  };
}

async function calendarView(env, sp, origin, renew = false) {
  if (!sp.icsToken || renew) {
    if (sp.icsToken) await kv.del(env, `ics:${sp.icsToken}`);
    sp.icsToken = randHex(16);
    await kv.put(env, `ics:${sp.icsToken}`, sp.id);
    await saveSpace(env, sp);
  }
  return {
    text:
      `📆 <b>Lịch trên điện thoại</b>\nĐăng ký link này một lần, các ngày của bạn (ngày âm đã đổi sẵn sang dương) sẽ hiện trong ứng dụng lịch và tự cập nhật.\n\n` +
      `<code>${origin}/lich/${sp.icsToken}.ics</code>\n\n` +
      `• iPhone: Cài đặt → Lịch → Tài khoản → Thêm tài khoản → Khác → Thêm lịch đã đăng ký.\n` +
      `• Google Calendar (trên máy tính): Lịch khác → Từ URL.\n\nAi có link đều xem được lịch.`,
    markup: kb([btn('Đổi link khác', 'st:calnew')], BACK_SETTINGS),
  };
}

const ackKeyboard = (jd, kind) => kb([btn('✅ Đã biết', `ack:${jd}:${kind}`)]);

function savedReply(ev, today) {
  const occ = occOf(ev, today);
  const next = occ ? `\nLần tới: <b>${whenText(ev, occ)}</b>` : '';
  return `<b>${esc(ev.name)}</b>\n${describeEvent(ev)}${ev.note ? `\n📝 ${esc(ev.note)}` : ''}${next}`;
}

async function addEvent(ctx, parsed) {
  const { env, sp, today } = ctx;
  const ev = track(sp, { id: sp.nextId++, ...parsed });
  if (!ev.note) delete ev.note;
  sp.events.push(ev);
  await saveSpace(env, sp);
  const row = [btn('Xem / sửa', `e:${ref(ev)}`)];
  if (ctx.personal && ctx.family) row.push(btn(`${FAM} Chia sẻ với gia đình`, `sh:${ref(ev)}`));
  return { text: `✅ Đã lưu ${savedReply(ev, today)}`, markup: kb(row) };
}

// ---------- Chờ người dùng nhắn nội dung (đổi tên, đổi ngày, thêm việc...) ----------

const PROMPTS = {
  name: () => 'Nhắn tên mới:',
  date: () => 'Nhắn ngày mới, ví dụ <i>16/3 âm</i> hoặc <i>rằm tháng ba</i>. Thêm "hàng tháng" hay "một lần" nếu cần.',
  note: () => 'Nhắn ghi chú mới. Nhắn dấu <b>-</b> để xoá ghi chú.',
  task: () => 'Nhắn việc cần làm. Muốn ghi ai lo thì thêm tên sau dấu gạch, ví dụ: <i>Mua hoa - Lan</i>',
  log: (year) => `Nhắn ghi chép cho năm ${year} (làm mấy mâm, mời ai, lưu ý gì...).`,
};

async function askInput(ctx, kind, ev) {
  const { env, chatId, isPrivate, today } = ctx;
  if (!PROMPTS[kind]) return;
  await kv.put(env, `wait:${chatId}`, JSON.stringify({ kind, ref: ref(ev) }), { expirationTtl: 900 });
  // Trong nhóm bot chỉ đọc được tin trả lời chính nó, nên bật sẵn chế độ trả lời.
  const markup = isPrivate ? undefined : { force_reply: true };
  await send(env, chatId, `<b>${esc(ev.name)}</b>\n${PROMPTS[kind](jdToDate(today).y)}`, markup);
}

/** Xử lý tin nhắn trả lời cho một câu hỏi đang chờ. Trả màn hình để hiển thị, hoặc null nếu không có gì đang chờ. */
async function consumeInput(ctx, text) {
  const { env, chatId, today } = ctx;
  const wait = await kv.get(env, `wait:${chatId}`, 'json');
  if (!wait) return null;
  await kv.del(env, `wait:${chatId}`);
  const ev = findEvent(ctx, wait.ref);
  if (!ev) return { text: 'Ngày này không còn nữa.' };
  let view;
  if (wait.kind === 'name') {
    ev.name = text.slice(0, 200);
    view = cardView(ctx, ev, today);
  } else if (wait.kind === 'note') {
    if (text === '-') delete ev.note;
    else ev.note = text.slice(0, 300);
    view = cardView(ctx, ev, today);
  } else if (wait.kind === 'date') {
    const r = parseAdd(text, { nameOptional: true });
    if (r.error) return { text: `⚠️ ${r.error}\nBấm Sửa → Ngày để thử lại.`, markup: kb([btn('‹ Quay lại', `ed:${ref(ev)}`)]) };
    for (const k of ['cal', 'repeat', 'day', 'month', 'year']) {
      if (r.event[k] === undefined) delete ev[k];
      else ev[k] = r.event[k];
    }
    view = cardView(ctx, ev, today);
  } else if (wait.kind === 'task') {
    const [t, ...w] = text.split(/\s+-\s+/);
    const task = { t: t.trim().slice(0, 100) };
    if (w.length) task.w = w.join(' - ').trim().slice(0, 40);
    ev.tasks = [...(ev.tasks ?? []), task].slice(0, 30);
    view = tasksView(ev, today);
  } else {
    const year = jdToDate(today).y;
    ev.log = [...(ev.log ?? []).filter((x) => x.y !== year), { y: year, t: text.slice(0, 500) }];
    view = logView(ev, today);
  }
  await saveSpace(env, home(ev));
  return view;
}

// ---------- Lệnh gõ tay ----------

async function handleCommand(ctx, text) {
  const { env, sp, today, chatId, isPrivate, origin } = ctx;
  const m = text.match(/^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/i);
  if (!m) return HELP;
  const cmd = m[1].toLowerCase();
  const arg = m[2].trim();

  switch (cmd) {
    case 'start':
    case 'menu':
      return { text: WELCOME, markup: isPrivate ? MENU : undefined };
    case 'help':
      return HELP;

    case 'them':
    case 'add': {
      if (!arg) return ADD_HINT;
      const r = parseAdd(arg);
      return r.error ? `⚠️ ${r.error}` : addEvent(ctx, r.event);
    }

    case 'ds':
    case 'list':
      return listView(ctx, today);

    case 'sapden': {
      const n = arg ? Number(arg) : 30;
      if (!Number.isInteger(n) || n < 1 || n > 366) return 'Ví dụ: /sapden 30';
      return listMessage(calendar(ctx), today, n);
    }

    case 'sua': {
      const mm = arg.match(/^(\d+)\s+([\s\S]+)$/);
      if (!mm) return 'Ví dụ: /sua 3 16/3 âm  ·  /sua 3 Tên mới  ·  /sua 3 | ghi chú mới';
      const old = byNumber(ctx, mm[1]);
      if (!old) return 'Không tìm thấy. Dùng số đứng trước tên ngày trong 📋 Danh sách.';
      const r = parseAdd(mm[2], { nameOptional: true });
      let ev;
      if (r.code === 'nodate') {
        const [name, ...rest] = mm[2].split('|');
        ev = { ...old };
        if (name.trim()) ev.name = name.trim().slice(0, 200);
        if (rest.length) ev.note = rest.join('|').trim().slice(0, 300);
      } else if (r.error) {
        return `⚠️ ${r.error}`;
      } else {
        const { cal, repeat, day, month, year, ...keep } = old;
        ev = { ...keep, ...r.event };
      }
      if (!ev.note) delete ev.note;
      const at = home(old);
      at.events[at.events.indexOf(old)] = track(at, ev);
      await saveSpace(env, at);
      return `✏️ Đã sửa ${savedReply(ev, today)}`;
    }

    case 'xoa':
    case 'del': {
      const ev = byNumber(ctx, arg);
      if (!ev) return 'Không tìm thấy. Bấm 📋 Danh sách, chọn ngày rồi bấm Xoá.';
      const at = home(ev);
      at.events = at.events.filter((e) => e !== ev);
      await saveSpace(env, at);
      return `🗑 Đã xoá <b>${esc(ev.name)}</b>`;
    }

    case 'nhac': {
      const mm = arg.match(/^(\d+)\s+(.+)$/);
      const offsets = mm && parseOffsets(mm[2]);
      const ev = mm && byNumber(ctx, mm[1]);
      if (!offsets || !ev) return 'Ví dụ: /nhac 3 0,1,7';
      ev.offsets = offsets;
      await saveSpace(env, home(ev));
      return `✅ ${savedReply(ev, today)}`;
    }

    case 'caidat':
      return settingsView();
    case 'le':
      return holidayView(sp.holidays);
    case 'moi':
      return familyView(ctx);
    case 'lich':
      return calendarView(env, sp, origin, /^(moi|mới)$/i.test(arg));
    case 'roi':
      return leaveFamily(ctx);

    case 'xuat':
      await sendBackup(env, chatId, sp, `Sao lưu ${sp.events.length} ngày. Để khôi phục: gửi lại file này kèm chú thích /nhap`);
      return null;
    case 'nhap':
      return 'Gửi file sao lưu (.json) và ghi /nhap vào phần chú thích của file.';

    case 'homnay':
      return almanacText(today);

    case 'doi': {
      const q = parseConvert(arg);
      return q.error ? `⚠️ ${q.error}` : convertMessage(q, today);
    }

    case 'thu':
      return buildDaily(merged(ctx), today)?.text ?? 'Hôm nay không có gì cần nhắc. Bot vẫn hoạt động ✅';

    default:
      return 'Mình không biết lệnh này. Gõ /help để xem hướng dẫn.';
  }
}

const todayView = (ctx, today) => `${almanacText(today)}\n\n${listMessage(calendar(ctx), today, 7)}`;

async function handleImportFile(ctx, doc) {
  const { env, sp, chatId } = ctx;
  if (doc.file_size > 1024 * 1024) return 'File quá lớn.';
  let events, holidays;
  try {
    const file = await tg(env, 'getFile', { file_id: doc.file_id });
    ops++;
    const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
    const json = await res.json();
    events = sanitizeEvents(json.events);
    holidays = { annual: Boolean(json.holidays?.annual), hue: Boolean(json.holidays?.hue), monthly: Boolean(json.holidays?.monthly) };
  } catch {
    events = null;
  }
  if (!events) return '⚠️ File không đúng định dạng sao lưu của bot.';
  await kv.put(env, `pending:${chatId}`, JSON.stringify({ events, holidays }), { expirationTtl: 3600 });
  return {
    text: `File có <b>${events.length}</b> ngày. Thay thế toàn bộ <b>${sp.events.length}</b> ngày hiện có?`,
    markup: kb([btn('Thay thế', 'imp:yes'), btn('Huỷ', 'imp:no')]),
  };
}

// ---------- Nút bấm ----------

const EVENT_KINDS = ['e', 'ed', 'of', 'sl', 'tk', 'tt', 'tc', 'lg', 'dl', 'dy', 'w', 'sh'];

async function handleCallback(ctx, cq) {
  const { env, chatId, today, origin } = ctx;
  const messageId = cq.message.message_id;
  const [kind, a, b] = String(cq.data).split(':');
  let toast = '';
  let view = null; // màn hình thay cho tin hiện tại
  const needsEvent = EVENT_KINDS.includes(kind);
  const ev = needsEvent ? findEvent(ctx, kind === 'w' ? b : a) : null;
  const sp = ev ? home(ev) : ctx.sp; // sổ chứa ngày đang thao tác; nếu không thì sổ chính của chat

  if (needsEvent && !ev) {
    view = { text: 'Ngày này không còn nữa.', markup: kb([btn('‹ Danh sách', 'ls:0')]) };
  } else if (kind === 'ls') view = listView(ctx, today, Number(a));
  else if (kind === 'e') view = cardView(ctx, ev, today);
  else if (kind === 'sh') {
    if (ctx.personal && ctx.family) {
      const moved = await moveEvent(env, ev, isShared(ev) ? ctx.personal : ctx.family);
      toast = isShared(moved) ? 'Đã chia sẻ với gia đình.' : 'Đã chuyển về lịch riêng.';
      view = cardView(ctx, moved, today);
    } else view = await familyView(ctx);
  }
  else if (kind === 'ed') view = editView(ev, today);
  else if (kind === 'w') await askInput(ctx, a, ev);
  else if (kind === 'of') {
    if (b !== undefined) {
      const n = Number(b);
      const offs = new Set(ev.offsets ?? DEFAULT_OFFSETS);
      if (offs.has(n)) offs.delete(n);
      else offs.add(n);
      if (!offs.size) toast = 'Phải giữ ít nhất một lần nhắc.';
      else {
        ev.offsets = [...offs].sort((x, y) => x - y);
        await saveSpace(env, sp);
      }
    }
    view = offsetsView(ev);
  } else if (kind === 'sl') {
    if (['am', 'noon', 'pm'].includes(b)) {
      if (b === 'am') delete ev.slot;
      else ev.slot = b;
      await saveSpace(env, sp);
    }
    view = slotView(ev);
  } else if (kind === 'tk') view = tasksView(ev, today);
  else if (kind === 'tt') {
    const t = ev.tasks?.[Number(b)];
    const occ = occOf(ev, today);
    if (t && occ) {
      if (t.done === occ.jd) delete t.done;
      else t.done = occ.jd;
      await saveSpace(env, sp);
    }
    view = tasksView(ev, today);
  } else if (kind === 'tc') {
    const occ = occOf(ev, today);
    ev.tasks = (ev.tasks ?? []).filter((t) => !occ || t.done !== occ.jd);
    if (!ev.tasks.length) delete ev.tasks;
    await saveSpace(env, sp);
    view = tasksView(ev, today);
  } else if (kind === 'lg') view = logView(ev, today);
  else if (kind === 'dl')
    view = { text: `Xoá hẳn <b>${esc(ev.name)}</b>? Không khôi phục được.`, markup: kb([btn('Xoá hẳn', `dy:${ref(ev)}`), btn('Giữ lại', `e:${ref(ev)}`)]) };
  else if (kind === 'dy') {
    sp.events = sp.events.filter((e) => e !== ev);
    await saveSpace(env, sp);
    view = { text: `🗑 Đã xoá <b>${esc(ev.name)}</b>`, markup: kb([btn('‹ Danh sách', 'ls:0')]) };
  } else if (kind === 'st') {
    if (a === 'home') view = settingsView();
    else if (a === 'le') view = holidayView(sp.holidays);
    else if (a === 'fam') view = await familyView(ctx);
    else if (a === 'cal' || a === 'calnew') view = await calendarView(env, sp, origin, a === 'calnew');
    else if (a === 'help') view = { text: HELP, markup: kb(BACK_SETTINGS) };
    else if (a === 'bak') {
      await sendBackup(env, chatId, sp, `Sao lưu ${sp.events.length} ngày. Để khôi phục: gửi lại file này kèm chú thích /nhap`);
      toast = 'Đã gửi file sao lưu.';
    }
  } else if (kind === 'hol' && ['annual', 'hue', 'monthly'].includes(a)) {
    sp.holidays = { ...sp.holidays, [a]: !sp.holidays[a] };
    await saveSpace(env, sp);
    view = holidayView(sp.holidays);
  } else if (kind === 'fam' && a === 'new') {
    if (!ctx.family) {
      ctx.family = await newSpace(env, 'f', chatId, ctx.who);
      ctx.rec = { space: ctx.personal?.id ?? null, family: ctx.family.id };
      await saveChat(env, chatId, ctx.rec);
    }
    view = await familyView(ctx);
  } else if (kind === 'ack') {
    const target = (b === 'f' ? ctx.family : ctx.personal) ?? ctx.sp;
    target.ack = Number(a);
    await saveSpace(env, target);
    await tg(env, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: kb() });
    toast = 'Đã ghi nhận, tối nay không nhắc lại.';
  } else if (kind === 'lv') {
    view =
      a === 'yes'
        ? { text: await leaveFamily(ctx), markup: kb(BACK_SETTINGS) }
        : { text: 'Rời lịch chung? Bạn sẽ không còn nhận tin nhắc của các ngày chung. Lịch riêng của bạn giữ nguyên.', markup: kb([btn('Rời', 'lv:yes'), btn('Ở lại', 'st:fam')]) };
  } else if (kind === 'imp') {
    const pending = await kv.get(env, `pending:${chatId}`, 'json');
    if (a === 'yes' && pending) {
      sp.events = pending.events;
      sp.nextId = pending.events.length + 1;
      sp.holidays = pending.holidays;
      await saveSpace(env, sp);
      view = { text: `✅ Đã khôi phục ${pending.events.length} ngày.`, markup: kb([btn('📋 Danh sách', 'ls:0')]) };
    } else {
      view = { text: a === 'yes' ? 'Yêu cầu đã hết hạn, gửi lại file kèm /nhap.' : 'Đã huỷ, danh sách giữ nguyên.' };
    }
    await kv.del(env, `pending:${chatId}`);
  }

  if (view) {
    try {
      await tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: view.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: view.markup ?? kb(),
      });
    } catch (err) {
      if (err.status !== 400) throw err; // 400: nội dung không đổi
    }
  }
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: toast });
}

// ---------- Tin nhắn đến ----------

async function handleUpdate(env, update, origin) {
  const cq = update.callback_query;
  const msg = update.message ?? cq?.message;
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const isPrivate = msg.chat.type === 'private';
  const text = (update.message?.text ?? update.message?.caption ?? '').trim();
  const who = isPrivate ? ((cq ?? update.message).from?.first_name ?? 'Bạn') : (msg.chat.title ?? 'Nhóm');
  const reply = (r) => (r ? send(env, chatId, r.text ?? r, r.markup) : null);

  // Ai nhắn riêng với bot cũng có ngay một lịch riêng. Nhóm chat chỉ có lịch chung, sau khi /thamgia.
  const spaces = await loadSpaces(env, chatId);
  if (!spaces.personal && isPrivate) {
    spaces.personal = await newSpace(env, 'p', chatId, who);
    spaces.rec = { space: spaces.personal.id, ...(spaces.rec?.family ? { family: spaces.rec.family } : {}) };
    await saveChat(env, chatId, spaces.rec);
  }
  const ctx = { env, chatId, isPrivate, who, origin, today: vnTodayJd(), ...spaces };
  ctx.sp = ctx.personal ?? ctx.family; // sổ chính của chat này: nơi lưu ngày mới và cài đặt ngày lễ

  // Vào lịch chung bằng link mời (/start join_mã) hoặc /thamgia mã.
  const join = text.match(/^\/(?:start(?:@\w+)?\s+join_|thamgia(?:@\w+)?\s+)([a-z0-9]{8})$/i);
  if (join) {
    const code = join[1].toLowerCase();
    const target = await loadSpace(env, await kv.get(env, `invite:${code}`));
    if (target?.kind !== 'f') return reply('Mã mời không đúng hoặc đã hết hiệu lực.');
    const names = target.members.map((m) => esc(m.name)).join(', ');
    const keep = isPrivate ? '\nCác ngày bạn đã lưu vẫn là của riêng bạn; ngày nào muốn cả nhà cùng nhớ thì bấm chia sẻ.' : '';
    return reply({
      text: `Vào lịch chung với <b>${names}</b> (${target.events.length} ngày chung)?${keep}`,
      markup: kb([btn('Tham gia', `join:${code}`), btn('Huỷ', 'join:no')]),
    });
  }
  if (cq && String(cq.data).startsWith('join:')) {
    const code = cq.data.slice(5);
    const result = code === 'no' ? 'Đã huỷ.' : await joinFamily(ctx, code);
    await tg(env, 'editMessageText', { chat_id: chatId, message_id: msg.message_id, text: result, reply_markup: kb() });
    if (isPrivate && code !== 'no') await send(env, chatId, 'Dùng 4 nút bên dưới để xem và thêm ngày.', MENU);
    return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  }

  if (!ctx.sp) {
    if (cq || !text.startsWith('/')) return;
    return reply('Nhóm này chưa nối với lịch chung nào. Trong chat riêng với bot, bấm ⚙️ Cài đặt → Dùng chung với gia đình để lấy mã, rồi gõ ở đây: /thamgia &lt;mã&gt;');
  }

  if (cq) return handleCallback(ctx, cq);
  if (update.message.document && /^\/nhap\b/i.test(text)) return reply(await handleImportFile(ctx, update.message.document));
  if (!text) return;
  if (text.startsWith('/')) return reply(await handleCommand(ctx, text));

  if (text === BTN.add) return reply(ADD_HINT);
  if (text === BTN.list) return reply(listView(ctx, ctx.today));
  if (text === BTN.today) return reply(todayView(ctx, ctx.today));
  if (text === BTN.settings) return reply(settingsView());

  const answered = await consumeInput(ctx, text);
  if (answered) return reply(answered);
  if (!isPrivate) return; // trong nhóm chỉ nghe lệnh và câu trả lời cho bot

  // Nhắn tự nhiên: "giỗ ông nội rằm tháng ba"
  const r = parseAdd(text);
  return reply(r.error ? { text: `Mình chưa hiểu ngày nào.\n\n${ADD_HINT}`, markup: MENU } : await addEvent(ctx, r.event));
}

// ---------- Cron ----------
// Mỗi khung giờ chạy nhiều lần cách nhau 2 phút; mỗi lần xử lý một lô sổ rồi ghi lại vị trí, lần sau làm tiếp.
// Lô nào lỗi (Telegram sập...) thì vị trí không tiến, nên sẽ được gửi lại; ngày nào lỡ hẳn thì hôm sau gửi bù.

const PHASES = [
  ['am', 7],
  ['noon', 12],
  ['pm', 20],
];

async function processSpace(env, sp, phase, today, lastAm) {
  const events = allEvents(sp);
  // Sổ trống và không bật ngày lễ nào thì không gửi gì (kể cả tổng kết đầu tháng).
  const quiet = !sp.events.length && !Object.values(sp.holidays).some(Boolean);
  const head = sp.kind === 'f' ? `${FAM} <b>Lịch chung của gia đình</b>\n` : '';
  const keys = ackKeyboard(today, sp.kind);
  if (phase === 'am') {
    const daily = buildDaily(events, today, lastAm, 'am');
    if (daily && !quiet) await broadcast(env, sp, head + daily.text, daily.ackable ? keys : undefined);
    const kept = pruneExpired(sp.events, today);
    if (kept.length !== sp.events.length) {
      sp.events = kept;
      await saveSpace(env, sp);
    }
    if (daily?.monthStart && sp.events.length) {
      try {
        const what = sp.kind === 'f' ? 'lịch chung' : 'lịch riêng';
        await sendBackup(env, sp.owner, sp, `Sao lưu tự động đầu tháng (${what}). Giữ file này để khôi phục khi cần (gửi lại kèm /nhap).`);
      } catch (err) {
        console.error('Không gửi được file sao lưu:', err.message);
      }
    }
    return;
  }
  const daily = buildDaily(events, today, today - 1, phase);
  if (daily) await broadcast(env, sp, head + daily.text, daily.ackable ? keys : undefined);
  if (phase === 'pm' && sp.ack !== today) {
    const again = eveningMessage(sp.events, today);
    if (again) await broadcast(env, sp, head + again, keys);
  }
}

async function runPhase(env, phase, today, st, lastAm) {
  let cursor;
  do {
    ops++;
    const page = await env.REMINDERS.list({ prefix: 'space:', cursor });
    for (const key of page.keys) {
      if (key.name <= st.cursor) continue;
      if (ops >= BUDGET) return;
      const sp = await kv.get(env, key.name, 'json');
      if (sp) await processSpace(env, normalize(sp), phase, today, lastAm);
      st.cursor = key.name;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  st.done = true;
}

async function runScheduled(env, now) {
  ops = 0;
  const today = vnTodayJd(now);
  const hour = vnHour(now);
  const sched = (await kv.get(env, 'sched', 'json')) ?? {};
  for (const [phase, startHour] of PHASES) {
    if (hour < startHour) break;
    if (sched[phase]?.day !== today) sched[phase] = { day: today, cursor: '', done: false };
    const st = sched[phase];
    if (st.done) continue;
    try {
      await runPhase(env, phase, today, st, sched.lastAm ?? null);
      if (st.done && phase === 'am') sched.lastAm = today;
    } finally {
      await kv.put(env, 'sched', JSON.stringify(sched));
    }
    if (!st.done) break; // hết ngân sách cho lần chạy này
  }
}

export default {
  async fetch(request, env) {
    ops = 0;
    const url = new URL(request.url);

    const ics = request.method === 'GET' && url.pathname.match(/^\/lich\/([0-9a-f]{32})\.ics$/);
    if (ics) {
      const sp = await loadSpace(env, await kv.get(env, `ics:${ics[1]}`));
      if (!sp || sp.icsToken !== ics[1]) return new Response('not found', { status: 404 });
      // Lịch của một người gồm ngày riêng, ngày chung của gia đình, và ngày lễ người đó bật.
      const rec = sp.kind === 'p' ? await kv.get(env, `chat:${sp.owner}`, 'json') : null;
      const view = { sp, personal: sp.kind === 'p' ? sp : null, family: sp.kind === 'f' ? sp : await loadSpace(env, rec?.family) };
      return new Response(icsCalendar(merged(view), vnTodayJd()), {
        headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'max-age=3600' },
      });
    }

    if (request.method !== 'POST' || url.pathname !== '/webhook') return new Response('Nhớ Hỉ đang chạy.');
    if (!env.WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET)
      return new Response('forbidden', { status: 403 });
    try {
      await handleUpdate(env, await request.json(), url.origin);
    } catch (err) {
      console.error(err); // vẫn trả 200 để Telegram không gửi lại vô hạn
    }
    return new Response('ok');
  },

  async scheduled(event, env) {
    await runScheduled(env, event.scheduledTime ?? Date.now());
  },
};
