import test from 'node:test';
import assert from 'node:assert/strict';
import { jdFromDate, jdToDate, lunarFromJd, jdFromLunar, canChi } from '../src/lunar.js';
import {
  parseAdd,
  parseConvert,
  sanitizeEvents,
  builtinEvents,
  buildDays,
  nextOccurrence,
  occurrences,
  buildDaily,
  eveningMessage,
  listMessage,
  pruneExpired,
  icsCalendar,
  vnTodayJd,
  vnHour,
} from '../src/core.js';
import worker from '../src/index.js';

const lunar = (d, m, y) => lunarFromJd(jdFromDate(d, m, y));
const solarOf = (d, m, y) => jdToDate(jdFromLunar(d, m, y));
const jd = jdFromDate;

test('Tết các năm khớp lịch Việt Nam', () => {
  const tet = { 1985: [21, 1], 2023: [22, 1], 2024: [10, 2], 2025: [29, 1], 2026: [17, 2], 2027: [6, 2], 2028: [26, 1], 2030: [2, 2] };
  for (const [y, [d, m]] of Object.entries(tet)) {
    assert.deepEqual(lunar(d, m, +y), { d: 1, m: 1, y: +y, leap: false }, `Tết ${y}`);
    assert.deepEqual(solarOf(1, 1, +y), { d, m, y: +y });
  }
});

test('tháng nhuận, trung thu, can chi', () => {
  assert.deepEqual(lunar(25, 7, 2025), { d: 1, m: 6, y: 2025, leap: true });
  assert.deepEqual(lunar(25, 6, 2025), { d: 1, m: 6, y: 2025, leap: false });
  assert.deepEqual(solarOf(15, 8, 2026), { d: 25, m: 9, y: 2026 });
  assert.deepEqual(solarOf(15, 8, 2025), { d: 6, m: 10, y: 2025 });
  assert.deepEqual(solarOf(23, 12, 2025), { d: 10, m: 2, y: 2026 });
  assert.equal(canChi(2026), 'Bính Ngọ');
});

test('đổi qua lại âm-dương nhất quán trong 30 năm', () => {
  for (let d = jd(1, 1, 2020); d < jd(1, 1, 2050); d++) {
    const l = lunarFromJd(d);
    assert.ok(l.d >= 1 && l.d <= 30 && l.m >= 1 && l.m <= 12);
    if (!l.leap) assert.equal(jdFromLunar(l.d, l.m, l.y), d);
  }
});

test('parseAdd: cú pháp lệnh', () => {
  assert.deepEqual(parseAdd('Giỗ ông nội 15/3 âm').event, { cal: 'lunar', repeat: 'yearly', day: 15, name: 'Giỗ ông nội', month: 3 });
  assert.deepEqual(parseAdd('Sinh nhật mẹ 20/10').event, { cal: 'solar', repeat: 'yearly', day: 20, name: 'Sinh nhật mẹ', month: 10 });
  assert.deepEqual(parseAdd('Kỷ niệm 10 năm cưới 2/9/2015').event, { cal: 'solar', repeat: 'yearly', day: 2, name: 'Kỷ niệm 10 năm cưới', month: 9, year: 2015 });
  assert.deepEqual(parseAdd('Cúng rằm 15 Âm Lịch hàng tháng').event, { cal: 'lunar', repeat: 'monthly', day: 15, name: 'Cúng rằm' });
  assert.deepEqual(parseAdd('Họp lớp 20/12/2026 một lần').event, { cal: 'solar', repeat: 'once', day: 20, name: 'Họp lớp', month: 12, year: 2026 });
  assert.deepEqual(parseAdd('Giỗ bà 8/1 am nhắc 7,0,1 | mua hoa, đặt bàn').event, {
    cal: 'lunar', repeat: 'yearly', day: 8, name: 'Giỗ bà', month: 1, offsets: [0, 1, 7], note: 'mua hoa, đặt bàn',
  });
  for (const bad of ['15/3 âm', 'Giỗ ông', 'Giỗ ông 15 âm', 'X 31/4', 'X 31/1 âm', 'X 5/13', 'X 1/2 một lần', 'X 1/2 nhắc 99'])
    assert.ok(parseAdd(bad).error, bad);
  assert.equal(parseAdd('Giỗ ông').code, 'nodate');
  assert.deepEqual(parseAdd('16/3 âm', { nameOptional: true }).event, { cal: 'lunar', repeat: 'yearly', day: 16, month: 3 });
  assert.deepEqual(parseConvert('15/3/2027 âm'), { cal: 'lunar', day: 15, month: 3, year: 2027 });
});

test('parseAdd: nhắn tự nhiên', () => {
  const p = (s) => parseAdd(s).event;
  assert.deepEqual(p('giỗ ông nội rằm tháng ba'), { cal: 'lunar', repeat: 'yearly', day: 15, name: 'giỗ ông nội', month: 3 });
  assert.deepEqual(p('gio ong noi ram thang ba'), { cal: 'lunar', repeat: 'yearly', day: 15, name: 'gio ong noi', month: 3 });
  assert.deepEqual(p('Giỗ bà mùng 8 tháng giêng nhắc 0,1'), { cal: 'lunar', repeat: 'yearly', day: 8, name: 'Giỗ bà', month: 1, offsets: [0, 1] });
  assert.deepEqual(p('sinh nhật vợ ngày 20 tháng 10 năm 1990'), { cal: 'solar', repeat: 'yearly', day: 20, name: 'sinh nhật vợ', month: 10, year: 1990 });
  assert.deepEqual(p('sinh nhật con 5 tháng năm'), { cal: 'solar', repeat: 'yearly', day: 5, name: 'sinh nhật con', month: 5 });
  assert.deepEqual(p('giỗ cụ 12 tháng 7 âm'), { cal: 'lunar', repeat: 'yearly', day: 12, name: 'giỗ cụ', month: 7 });
  assert.deepEqual(p('23 tháng chạp cúng ông Táo'), { cal: 'lunar', repeat: 'yearly', day: 23, name: 'cúng ông Táo', month: 12 });
  assert.deepEqual(p('giỗ cố 3 tháng mười một âm lịch'), { cal: 'lunar', repeat: 'yearly', day: 3, name: 'giỗ cố', month: 11 });
  assert.deepEqual(p('cúng rằm hàng tháng'), { cal: 'lunar', repeat: 'monthly', day: 15, name: 'cúng rằm' });
  assert.deepEqual(p('cúng mùng 1 hàng tháng'), { cal: 'lunar', repeat: 'monthly', day: 1, name: 'cúng mùng 1' });
  assert.deepEqual(p('giỗ ba hằng năm ngày 11 tháng 6 âm'), { cal: 'lunar', repeat: 'yearly', day: 11, name: 'giỗ ba', month: 6 });
  assert.deepEqual(p('giỗ ông nội 16/7 âm hàng năm'), { cal: 'lunar', repeat: 'yearly', day: 16, name: 'giỗ ông nội', month: 7 });
  assert.deepEqual(p('giỗ ba 11/6 âm mỗi năm nhắc 0,1'), { cal: 'lunar', repeat: 'yearly', day: 11, name: 'giỗ ba', month: 6, offsets: [0, 1] });
  assert.ok(parseAdd('cảm ơn bạn').error);
  assert.deepEqual(parseConvert('rằm tháng 8'), { cal: 'lunar', day: 15, month: 8, year: null });
});

test('lần kế tiếp: hằng năm, cuối tháng, một lần', () => {
  const days = buildDays(jd(15, 11, 2026), 400);
  const next = (ev) => {
    const o = nextOccurrence(ev, days);
    return o && `${o.s.d}/${o.s.m}/${o.s.y}`;
  };
  assert.equal(next({ cal: 'solar', repeat: 'yearly', day: 15, month: 11 }), '15/11/2026');
  assert.equal(next({ cal: 'solar', repeat: 'yearly', day: 14, month: 11 }), '14/11/2027');
  assert.equal(next({ cal: 'solar', repeat: 'yearly', day: 29, month: 2 }), '28/2/2027');
  assert.equal(next({ cal: 'solar', repeat: 'monthly', day: 31 }), '30/11/2026');
  assert.equal(next({ cal: 'lunar', repeat: 'yearly', day: 1, month: 1 }), '6/2/2027');
  assert.equal(next({ cal: 'lunar', repeat: 'yearly', day: 15, month: 8 }), '15/9/2027');
  assert.equal(next({ cal: 'lunar', repeat: 'yearly', day: 30, month: 12 }), '5/2/2027');
  assert.equal(next({ cal: 'solar', repeat: 'once', day: 1, month: 1, year: 2026 }), null);
  const ram = occurrences({ cal: 'lunar', repeat: 'monthly', day: 15 }, days);
  assert.ok(ram.length === 13 || ram.length === 14);
  assert.ok(ram.every((o) => o.l.d === 15));
});

const MOM = { id: 1, name: 'Sinh nhật <mẹ>', cal: 'solar', repeat: 'yearly', day: 20, month: 11, year: 1966, note: 'mua hoa' };

test('tin nhắc buổi sáng và buổi tối', () => {
  const ev = [MOM];
  assert.equal(buildDaily(ev, jd(15, 11, 2026)), null);
  const d3 = buildDaily(ev, jd(17, 11, 2026));
  assert.match(d3.text, /Còn 3 ngày<\/b> — Sinh nhật &lt;mẹ&gt; \(tròn 60 năm\)[\s\S]*📝 mua hoa/);
  assert.equal(d3.ackable, false);
  assert.equal(buildDaily(ev, jd(18, 11, 2026)), null);
  const d0 = buildDaily(ev, jd(20, 11, 2026));
  assert.match(d0.text, /HÔM NAY/);
  assert.equal(d0.ackable, true);
  assert.match(eveningMessage(ev, jd(20, 11, 2026)), /Nhắc lại[\s\S]*Sinh nhật &lt;mẹ&gt; \(tròn 60 năm\)/);
  assert.equal(eveningMessage(ev, jd(19, 11, 2026)), null);
  const dec = buildDaily([], jd(1, 12, 2026));
  assert.match(dec.text, /Tháng 12\/2026[\s\S]*Bot vẫn đang chạy/);
  assert.equal(dec.monthStart, true);
  assert.match(listMessage(ev, jd(15, 11, 2026)), /#1 Sinh nhật[\s\S]*📝 mua hoa/);
  const once = [{ id: 2, name: 'x', cal: 'solar', repeat: 'once', day: 16, month: 11, year: 2026 }];
  assert.equal(pruneExpired(once, jd(16, 11, 2026)).length, 1);
  assert.equal(pruneExpired(once, jd(17, 11, 2026)).length, 0);
  assert.equal(vnTodayJd(Date.UTC(2026, 10, 14, 17, 0)), jd(15, 11, 2026));
  assert.equal(vnHour(Date.UTC(2026, 10, 14, 13, 0)), 20);
});

test('nhắc bù khi bot lỡ chạy', () => {
  const ev = [MOM];
  // Lỡ ngày 17 (còn 3 ngày): ngày 18 phải gửi bù với "Còn 2 ngày".
  const late = buildDaily(ev, jd(18, 11, 2026), jd(16, 11, 2026));
  assert.match(late.text, /lỡ 1 ngày[\s\S]*Còn 2 ngày<\/b> — Sinh nhật/);
  // Chạy đều đặn thì ngày 18 không có gì.
  assert.equal(buildDaily(ev, jd(18, 11, 2026), jd(17, 11, 2026)), null);
  // Lỡ đúng ngày sinh nhật: hôm sau báo "đã qua".
  assert.match(buildDaily(ev, jd(21, 11, 2026), jd(19, 11, 2026)).text, /Đã qua hôm qua<\/b> — Sinh nhật/);
  // Lỡ rất lâu: chỉ gửi bù tối đa 3 ngày, không lặp lại chuyện cũ.
  assert.equal(buildDaily(ev, jd(30, 11, 2026), jd(1, 11, 2026)), null);
  // Lỡ ngày 1: ngày 2 vẫn gửi tổng kết tháng.
  assert.equal(buildDaily([], jd(2, 12, 2026), jd(30, 11, 2026)).monthStart, true);
});

test('ngày lễ có sẵn', () => {
  assert.equal(builtinEvents({}).length, 0);
  assert.match(buildDaily(builtinEvents({ annual: true }), jd(24, 11, 2026)).text, /HÔM NAY<\/b> — 🏮 Ngày Văn hóa Việt Nam/);
  const all = builtinEvents({ annual: true, monthly: true });
  // 5/2/2027 là 29 tháng Chạp (tháng thiếu): Tất niên + Tết ngày mai, không lặp "Mùng 1".
  const t = buildDaily(all, jd(5, 2, 2027)).text;
  assert.match(t, /HÔM NAY<\/b> — 🏮 Tất niên/);
  assert.match(t, /Ngày mai<\/b> — 🏮 Tết Nguyên Đán/);
  assert.doesNotMatch(t, /Mùng 1/);
  assert.equal(buildDaily(all, jd(5, 2, 2027)).ackable, false);
  // Rằm tháng 10 âm (23/11/2026) không trùng lễ nào nên hiện "Rằm".
  assert.match(buildDaily(all, jd(23, 11, 2026)).text, /HÔM NAY<\/b> — 🏮 Rằm/);
  assert.match(listMessage(all, jd(15, 11, 2026), 10), /🏮 Nhà giáo Việt Nam[\s\S]*🏮 Rằm/);
  assert.match(listMessage(all, jd(15, 11, 2026)), /Chưa có ngày nào/);
  // Huế: 23/5 âm năm 2027 là 27/6/2027, nhắc trước 3 ngày.
  const hue = builtinEvents({ hue: true });
  assert.equal(hue.length, 5);
  assert.deepEqual(jdToDate(jdFromLunar(23, 5, 2027)), { d: 27, m: 6, y: 2027 });
  assert.match(buildDaily(hue, jd(24, 6, 2027)).text, /Còn 3 ngày<\/b> — 🏮 Cúng âm hồn 23\/5/);
  assert.match(buildDaily(hue, jd(27, 6, 2027)).text, /HÔM NAY<\/b> — 🏮 Cúng âm hồn 23\/5/);
  assert.match(buildDaily(hue, jd(26, 3, 2027)).text, /Giải phóng Thừa Thiên Huế/);
});

test('sao lưu và lịch .ics', () => {
  assert.deepEqual(sanitizeEvents([{ id: 9, name: ' A ', cal: 'lunar', repeat: 'yearly', day: 15, month: 3, offsets: [1, 0], junk: 1 }]), [
    { id: 1, name: 'A', cal: 'lunar', repeat: 'yearly', day: 15, month: 3, offsets: [0, 1] },
  ]);
  for (const bad of [null, [{ name: 'x' }], [{ name: 'x', cal: 'solar', repeat: 'yearly', day: 40, month: 1 }], [{ name: 'x', cal: 'solar', repeat: 'once', day: 1, month: 1 }]])
    assert.equal(sanitizeEvents(bad), null);
  const ics = icsCalendar([MOM, ...builtinEvents({ annual: true })], jd(15, 11, 2026));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nSUMMARY:Sinh nhật <mẹ> \(tròn 60 năm\)\r\nDESCRIPTION:12\/10\/2026 âm lịch\\nmua hoa/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270206\r\nDTEND;VALUE=DATE:20270207\r\nSUMMARY:Tết Nguyên Đán/);
  assert.equal((ics.match(/SUMMARY:Sinh nhật/g) ?? []).length, 2); // 2026, 2027
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});

// ---------- Worker với KV và Telegram giả ----------

function harness() {
  const store = new Map();
  const env = {
    TELEGRAM_BOT_TOKEN: 'T',
    WEBHOOK_SECRET: 's3',
    REMINDERS: {
      get: async (k, type) => (store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
      list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }),
    },
  };
  const calls = [];
  const h = { store, env, calls, failNext: 0, file: null };
  h.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('/file/bot')) return new Response(JSON.stringify(h.file));
    const method = url.split('/').pop();
    if (h.failNext > 0) {
      h.failNext--;
      return new Response('down', { status: 502 });
    }
    const body = init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body);
    calls.push({ method, ...body });
    const result = method === 'getFile' ? { file_path: 'f.json' } : method === 'getMe' ? { username: 'nhohi_bot' } : {};
    return new Response(JSON.stringify({ ok: true, result }));
  };
  h.update = (update, secret = 's3') =>
    worker.fetch(
      new Request('https://x.workers.dev/webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(update) }),
      env,
    );
  const chatOf = (id) => (id < 0 ? { id, type: 'group', title: 'Nhà mình' } : { id, type: 'private' });
  h.say = (chat, text) => h.update({ message: { chat: chatOf(chat), from: { first_name: `U${chat}` }, text } });
  h.click = (chat, data) => h.update({ callback_query: { id: 'q', data, from: { first_name: `U${chat}` }, message: { message_id: 7, chat: chatOf(chat) } } });
  h.last = () => calls.at(-1);
  h.sent = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').at(-1); // bỏ qua answerCallbackQuery
  h.space = (chat) => JSON.parse(store.get(`space:${JSON.parse(store.get(`chat:${chat}`)).space}`));
  h.family = (chat) => JSON.parse(store.get(`space:${JSON.parse(store.get(`chat:${chat}`)).family}`));
  h.buttons = () => h.sent().reply_markup.inline_keyboard.flat().map((b) => b.text);
  h.cron = (y, m, d, utcHour, min = 0) => worker.scheduled({ scheduledTime: Date.UTC(y, m - 1, d, utcHour, min) }, env);
  return h;
}

async function withFetch(h, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = h.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('worker: 4 nút chính, thêm bằng lời, thẻ sự kiện và sửa bằng nút', async () => {
  const h = harness();
  await withFetch(h, async () => {
    assert.equal((await h.update({ message: { chat: { id: 1, type: 'private' }, text: '/start' } }, 'sai')).status, 403);
    assert.equal(h.calls.length, 0);

    await h.say(1, '/start');
    assert.match(h.sent().text, /Nhớ Hỉ/);
    assert.deepEqual(h.sent().reply_markup.keyboard.flat().map((b) => b.text), ['➕ Thêm ngày', '📋 Danh sách', '📅 Hôm nay', '⚙️ Cài đặt']);

    await h.say(1, '📋 Danh sách');
    assert.match(h.sent().text, /Lịch sắp tới<\/b> \(0 ngày của bạn\)[\s\S]*🏮 [\s\S]*Bạn chưa lưu ngày nào/);
    assert.equal(h.sent().reply_markup, undefined);
    await h.say(1, 'giỗ ông nội rằm tháng ba');
    assert.match(h.sent().text, /Đã lưu <b>giỗ ông nội<\/b>\n15\/3 âm lịch · hằng năm/);
    assert.deepEqual(h.buttons(), ['Xem / sửa']);
    await h.say(1, 'sinh nhật mẹ 20/10/1966');
    await h.say(1, 'cảm ơn');
    assert.match(h.sent().text, /chưa hiểu/);

    await h.say(1, '📋 Danh sách');
    assert.match(h.sent().text, /Lịch sắp tới<\/b> \(2 ngày của bạn[\s\S]*Bấm số[\s\S]*Muốn được nhắc ngày lễ/);
    assert.deepEqual(h.buttons().filter((b) => /^\d+$/.test(b)), ['1', '2']);
    await h.say(1, '📅 Hôm nay');
    assert.match(h.sent().text, /âm lịch\nNgày .*, tháng .*, năm [\s\S]*Giờ hoàng đạo/);
    await h.say(1, '➕ Thêm ngày');
    assert.match(h.sent().text, /Nhắn cho mình tên và ngày/);

    // Thẻ sự kiện: 4 nút chính + quay lại.
    await h.click(1, 'e:p1');
    assert.equal(h.sent().method, 'editMessageText');
    assert.deepEqual(h.buttons(), ['✏️ Sửa', '☑️ Việc cần làm', '📖 Ghi chép', '🗑 Xoá', '‹ Danh sách']);
    await h.click(1, 'ed:p1');
    assert.deepEqual(h.buttons(), ['Tên', 'Ngày', 'Nhắc trước mấy ngày', 'Giờ nhắc', 'Ghi chú', '‹ Quay lại']);

    // Đổi tên, ngày, ghi chú: bấm nút rồi nhắn nội dung.
    await h.click(1, 'w:name:p1');
    assert.match(h.sent().text, /Nhắn tên mới/);
    await h.say(1, 'Giỗ ông ngoại');
    assert.equal(h.space(1).events[0].name, 'Giỗ ông ngoại');
    assert.equal(h.space(1).events.length, 2); // không bị hiểu thành thêm ngày mới
    await h.click(1, 'w:date:p1');
    await h.say(1, '16/3 âm');
    assert.deepEqual(h.space(1).events[0], { id: 1, cal: 'lunar', repeat: 'yearly', day: 16, name: 'Giỗ ông ngoại', month: 3 });
    await h.click(1, 'w:date:p1');
    await h.say(1, 'ngày nào đó');
    assert.match(h.sent().text, /Không thấy ngày/);
    assert.equal(h.space(1).events[0].day, 16);
    await h.click(1, 'w:note:p1');
    await h.say(1, 'đặt bàn');
    assert.equal(h.space(1).events[0].note, 'đặt bàn');
    await h.click(1, 'w:note:p1');
    await h.say(1, '-');
    assert.equal(h.space(1).events[0].note, undefined);

    // Nhắc trước và giờ nhắc: bật/tắt bằng nút.
    await h.click(1, 'of:p1:7');
    await h.click(1, 'of:p1:3');
    assert.deepEqual(h.space(1).events[0].offsets, [0, 1, 7]);
    assert.ok(h.buttons().includes('✅ Trước 7 ngày') && h.buttons().includes('⬜ Trước 3 ngày'));
    await h.click(1, 'sl:p1:noon');
    assert.equal(h.space(1).events[0].slot, 'noon');
    assert.ok(h.buttons().includes('✅ 12:00 trưa'));

    // Việc cần làm và ghi chép.
    await h.click(1, 'w:task:p1');
    await h.say(1, 'Mua hoa - Lan');
    await h.click(1, 'w:task:p1');
    await h.say(1, 'Đặt cỗ');
    assert.deepEqual(h.space(1).events[0].tasks, [{ t: 'Mua hoa', w: 'Lan' }, { t: 'Đặt cỗ' }]);
    await h.click(1, 'tt:p1:0');
    assert.match(h.sent().text, /☑️ Mua hoa — Lan\n☐ Đặt cỗ/);
    await h.click(1, 'e:p1');
    assert.match(h.sent().text, /Việc cần làm: xong 1\/2/);
    await h.click(1, 'tc:p1');
    assert.deepEqual(h.space(1).events[0].tasks, [{ t: 'Đặt cỗ' }]);
    await h.click(1, 'w:log:p1');
    await h.say(1, 'Làm 3 mâm, mời 20 người');
    assert.equal(h.space(1).events[0].log[0].t, 'Làm 3 mâm, mời 20 người');
    assert.match(h.sent().text, /Ghi chép — Giỗ ông ngoại[\s\S]*Làm 3 mâm/);

    // Xoá có bước xác nhận.
    await h.click(1, 'dl:p2');
    assert.deepEqual(h.buttons(), ['Xoá hẳn', 'Giữ lại']);
    assert.equal(h.space(1).events.length, 2);
    await h.click(1, 'dy:p2');
    assert.equal(h.space(1).events.length, 1);
    await h.click(1, 'e:p2');
    assert.match(h.sent().text, /không còn nữa/);
  });
});

test('worker: lịch riêng, lịch chung, chia sẻ, nhóm chat', async () => {
  const h = harness();
  await withFetch(h, async () => {
    await h.say(1, 'giỗ ông nội 15/3 âm');
    await h.say(1, 'kỷ niệm riêng 1/4');
    await h.say(2, 'sinh nhật con 5/5');
    assert.deepEqual(h.space(1).events.map((e) => e.name), ['giỗ ông nội', 'kỷ niệm riêng']);
    assert.deepEqual(h.space(2).events.map((e) => e.name), ['sinh nhật con']);

    // Chưa có lịch chung: thẻ không có nút chia sẻ; Cài đặt mời tạo lịch chung.
    await h.click(1, 'e:p1');
    assert.ok(!h.buttons().some((b) => b.includes('Chia sẻ')));
    await h.say(1, '⚙️ Cài đặt');
    assert.deepEqual(h.buttons(), ['🏮 Ngày lễ có sẵn', '👨‍👩‍👧 Dùng chung với gia đình', '📆 Lịch trên điện thoại', '💾 Sao lưu', '❓ Hướng dẫn']);
    await h.click(1, 'st:fam');
    assert.deepEqual(h.buttons(), ['Tạo lịch chung và lấy link mời', '‹ Cài đặt']);
    await h.click(1, 'fam:new');
    const code = h.sent().text.match(/t\.me\/nhohi_bot\?start=join_([a-z0-9]{8})/)[1];
    assert.match(h.sent().text, new RegExp(`/thamgia ${code}`));

    // Chia sẻ một ngày: chuyển sang lịch chung, ngày kia vẫn riêng.
    await h.click(1, 'e:p1');
    assert.ok(h.buttons().includes('👨‍👩‍👧 Chia sẻ với gia đình'));
    await h.click(1, 'sh:p1');
    assert.deepEqual(h.space(1).events.map((e) => e.name), ['kỷ niệm riêng']);
    assert.deepEqual(h.family(1).events.map((e) => e.name), ['giỗ ông nội']);
    assert.match(h.sent().text, /Ngày chung của gia đình/);
    assert.ok(h.buttons().includes('👤 Chuyển về lịch riêng'));

    // Người thứ hai bấm link mời: hỏi lại; vào rồi thì ngày riêng của họ vẫn riêng.
    await h.say(2, `/start join_${code}`);
    assert.match(h.sent().text, /Vào lịch chung với <b>U1<\/b> \(1 ngày chung\)[\s\S]*vẫn là của riêng bạn/);
    await h.click(2, 'join:no');
    assert.equal(JSON.parse(h.store.get('chat:2')).family, undefined);
    await h.say(2, `/start join_${code}`);
    await h.click(2, `join:${code}`);
    assert.deepEqual(h.space(2).events.map((e) => e.name), ['sinh nhật con']);
    assert.equal(h.family(2).id, h.family(1).id);
    await h.say(2, '/start join_zzzzzzzz');
    assert.match(h.sent().text, /không đúng/);
    // Dữ liệu của bản đã deploy trước đó (lịch chưa có 'kind', kèm mã mời cũ) vẫn dùng được như lịch riêng,
    // và mã mời cũ không cho người khác vào lịch riêng đó.
    h.store.set('space:old', JSON.stringify({ id: 'old', invite: 'oldcode1', owner: '9', members: [{ id: '9', name: 'U9' }], nextId: 2, events: [{ id: 1, name: 'ngày cũ', cal: 'solar', repeat: 'yearly', day: 1, month: 6 }] }));
    h.store.set('chat:9', JSON.stringify({ space: 'old' }));
    h.store.set('invite:oldcode1', 'old');
    await h.say(9, '📋 Danh sách');
    assert.match(h.sent().text, /<b>ngày cũ<\/b>/);
    await h.say(2, '/start join_oldcode1');
    assert.match(h.sent().text, /không đúng/);

    // Danh sách của người 2: ngày riêng của mình + ngày chung, không thấy ngày riêng của người 1.
    await h.say(2, '📋 Danh sách');
    assert.match(h.sent().text, /👨‍👩‍👧 <b>giỗ ông nội<\/b>/);
    assert.match(h.sent().text, /<b>sinh nhật con<\/b>/);
    assert.doesNotMatch(h.sent().text, /kỷ niệm riêng/);
    assert.match(h.sent().text, /= ngày chung của gia đình/);
    // Thêm ngày mới khi đã có lịch chung: mặc định riêng, có sẵn nút chia sẻ.
    await h.say(2, 'giỗ bà ngoại 8/1 âm');
    assert.deepEqual(h.buttons(), ['Xem / sửa', '👨‍👩‍👧 Chia sẻ với gia đình']);
    assert.equal(h.family(2).events.length, 1);
    await h.click(2, 'sh:p2');
    assert.deepEqual(h.family(1).events.map((e) => e.name), ['giỗ ông nội', 'giỗ bà ngoại']);
    await h.click(2, 'sh:f2'); // đổi ý, chuyển về riêng
    assert.deepEqual(h.space(2).events.map((e) => e.name), ['sinh nhật con', 'giỗ bà ngoại']);

    // Nhóm chat: chưa nối thì chỉ trả lời lệnh; nối bằng /thamgia; ngày thêm trong nhóm là ngày chung.
    const n0 = h.calls.length;
    await h.say(-50, 'chào cả nhà');
    assert.equal(h.calls.length, n0);
    await h.say(-50, '/ds');
    assert.match(h.sent().text, /chưa nối với lịch chung nào/);
    await h.say(-50, `/thamgia ${code}`);
    await h.click(-50, `join:${code}`);
    assert.deepEqual(h.family(1).members.map((m) => m.name), ['U1', 'U2', 'Nhà mình']);
    await h.say(-50, '/them Tất niên cả nhà 28/12 âm');
    assert.equal(h.family(1).events.length, 2);
    await h.say(-50, '/ds@nhohi_bot');
    assert.match(h.sent().text, /Lịch sắp tới<\/b> \(2 ngày của bạn/);
    assert.equal(h.sent().chat_id, '-50');
    await h.click(-50, 'w:name:f1');
    assert.equal(h.sent().reply_markup.force_reply, true);
    await h.say(-50, 'Giỗ ông');
    assert.equal(h.family(1).events[0].name, 'Giỗ ông');

    // Tin nhắc: ngày chung đến cả nhà (có nhãn), ngày riêng chỉ đến chủ của nó.
    await h.say(1, '/them Việc riêng 5/5 nhắc 0');
    await h.say(-50, '/them Việc chung 5/5 nhắc 0');
    h.calls.length = 0;
    await h.cron(2027, 5, 5, 0);
    const byChat = (id) => h.calls.filter((c) => c.chat_id === id).map((c) => c.text);
    assert.equal(byChat('-50').length, 1);
    assert.match(byChat('-50')[0], /^👨‍👩‍👧 <b>Lịch chung của gia đình<\/b>\n[\s\S]*Việc chung/);
    assert.equal(byChat('1').length, 2);
    assert.ok(byChat('1').some((t) => /Việc riêng/.test(t) && !/Lịch chung/.test(t)));
    assert.ok(byChat('2').some((t) => /sinh nhật con/.test(t)) && !byChat('2').some((t) => /Việc riêng/.test(t)));
    // Bấm Đã biết trên tin chung chỉ ghi nhận cho lịch chung.
    await h.click(2, h.calls.find((c) => c.chat_id === '2' && /Lịch chung/.test(c.text)).reply_markup.inline_keyboard[0][0].callback_data);
    assert.ok(h.family(1).ack && !h.space(2).ack);

    // Lịch .ics của một người gồm cả ngày riêng lẫn ngày chung.
    await h.click(1, 'st:cal');
    const url = h.sent().text.match(/https:\/\/x\.workers\.dev\/lich\/[0-9a-f]{32}\.ics/)[0];
    const ics = await (await worker.fetch(new Request(url), h.env)).text();
    assert.match(ics, /SUMMARY:kỷ niệm riêng/);
    assert.match(ics, /SUMMARY:Giỗ ông/);
    assert.doesNotMatch(ics, /sinh nhật con/);

    // Rời lịch chung: có bước xác nhận, lịch riêng giữ nguyên.
    await h.click(2, 'lv');
    assert.deepEqual(h.buttons(), ['Rời', 'Ở lại']);
    await h.click(2, 'lv:yes');
    assert.equal(JSON.parse(h.store.get('chat:2')).family, undefined);
    assert.equal(h.space(2).events.length, 2);
    assert.equal(h.family(1).members.length, 2);
    await h.say(2, '/roi');
    assert.match(h.sent().text, /chưa tham gia/);
  });
});

test('worker: cron 3 khung giờ, nút Đã biết, gửi bù', async () => {
  const h = harness();
  await withFetch(h, async () => {
    await h.say(1, 'Sinh nhật mẹ 20/11/1966');
    await h.say(1, '/them Uống thuốc 20/11 nhắc 0');
    await h.click(1, 'sl:p2:noon');
    h.calls.length = 0;

    // 7:00 — chỉ sự kiện khung sáng, có nút Đã biết. Các lần chạy lặp trong giờ đó không gửi lại.
    await h.cron(2026, 11, 20, 0);
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0].text, /HÔM NAY<\/b> — Sinh nhật mẹ \(tròn 60 năm\)/);
    assert.doesNotMatch(h.calls[0].text, /Uống thuốc/);
    assert.equal(h.calls[0].reply_markup.inline_keyboard[0][0].callback_data.startsWith('ack:'), true);
    await h.cron(2026, 11, 20, 0, 2);
    assert.equal(h.calls.length, 1);

    // 12:00 — sự kiện khung trưa.
    h.calls.length = 0;
    await h.cron(2026, 11, 20, 5);
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0].text, /HÔM NAY<\/b> — Uống thuốc/);

    // 20:00 — chưa bấm thì nhắc lại; bấm rồi thì thôi.
    h.calls.length = 0;
    await h.cron(2026, 11, 20, 13);
    assert.match(h.calls[0].text, /Nhắc lại[\s\S]*Sinh nhật mẹ/);
    await h.click(1, h.calls[0].reply_markup.inline_keyboard[0][0].callback_data);
    assert.equal(h.calls.at(-2).method, 'editMessageReplyMarkup');
    h.store.set('sched', JSON.stringify({ ...JSON.parse(h.store.get('sched')), pm: undefined }));
    h.calls.length = 0;
    await h.cron(2026, 11, 20, 13, 4);
    assert.equal(h.calls.length, 0);

    // Telegram sập sáng 17/11/2027: vị trí không tiến; lần chạy 2 phút sau gửi được.
    await h.cron(2027, 11, 16, 0);
    h.calls.length = 0;
    h.failNext = 99;
    await assert.rejects(h.cron(2027, 11, 17, 0));
    assert.equal(JSON.parse(h.store.get('sched')).am.done, false);
    h.failNext = 2; // lỗi tạm thời: tự thử lại ngay trong lần chạy
    await h.cron(2027, 11, 17, 0, 2);
    assert.match(h.calls[0].text, /Còn 3 ngày<\/b> — Sinh nhật mẹ \(tròn 61 năm\)/);
    assert.equal(JSON.parse(h.store.get('sched')).am.done, true);

    // Lỡ hẳn ngày 19 (trước 1 ngày): sáng 20 gửi bù kèm thông báo.
    await h.cron(2027, 11, 18, 0);
    h.calls.length = 0;
    await h.cron(2027, 11, 21, 0);
    assert.match(h.calls[0].text, /lỡ 2 ngày[\s\S]*Đã qua hôm qua<\/b> — Sinh nhật mẹ/);

    // Ngày 1: tổng kết tháng + file sao lưu tự động.
    h.calls.length = 0;
    await h.cron(2027, 12, 1, 0);
    assert.match(h.calls[0].text, /Tháng 12\/2027/);
    assert.equal(h.last().method, 'sendDocument');
  });
});

test('worker: nhiều sổ được xử lý theo lô, không sót và không gửi trùng', async () => {
  const h = harness();
  await withFetch(h, async () => {
    for (let i = 1; i <= 60; i++) await h.say(i, 'Việc chung 20/11 nhắc 0');
    h.calls.length = 0;
    await h.cron(2026, 11, 20, 0);
    const first = h.calls.length;
    assert.ok(first > 5 && first < 30, `lô đầu gửi ${first} tin`);
    assert.equal(JSON.parse(h.store.get('sched')).am.done, false);
    for (let min = 2; min <= 10; min += 2) await h.cron(2026, 11, 20, 0, min);
    assert.equal(JSON.parse(h.store.get('sched')).am.done, true);
    assert.equal(h.calls.length, 60);
    assert.equal(new Set(h.calls.map((c) => c.chat_id)).size, 60);
  });
});

test('worker: ngày lễ, sao lưu/khôi phục, lịch .ics', async () => {
  const h = harness();
  await withFetch(h, async () => {
    await h.say(1, 'Giỗ ông nội 15/3 âm');

    await h.click(1, 'st:le');
    assert.match(h.sent().text, /Lễ tết hằng năm<\/b> — ⬜ đang tắt/);
    await h.click(1, 'hol:annual');
    await h.click(1, 'hol:hue');
    assert.deepEqual(h.space(1).holidays, { annual: true, hue: true });
    assert.match(h.sent().text, /Ngày lễ Huế<\/b> — ✅ đang bật/);
    await h.say(1, '/sapden 366');
    assert.match(h.sent().text, /🏮 Tết Nguyên Đán[\s\S]*🏮 Cúng âm hồn 23\/5/);

    await h.click(1, 'st:bak');
    const docCall = h.calls.filter((c) => c.method === 'sendDocument').at(-1);
    const exported = JSON.parse(await docCall.document.text());
    assert.equal(exported.events.length, 1);
    assert.equal(exported.holidays.hue, true);

    h.file = { events: [{ name: 'A', cal: 'solar', repeat: 'yearly', day: 1, month: 2, slot: 'pm', tasks: [{ t: 'x' }] }, { name: 'B', cal: 'lunar', repeat: 'monthly', day: 15 }] };
    const doc = { message: { chat: { id: 1, type: 'private' }, from: { first_name: 'U1' }, caption: '/nhap', document: { file_id: 'f', file_size: 100 } } };
    await h.update(doc);
    assert.match(h.sent().text, /File có <b>2<\/b> ngày. Thay thế toàn bộ <b>1<\/b>/);
    await h.click(1, 'imp:no');
    assert.equal(h.space(1).events.length, 1);
    await h.update(doc);
    await h.click(1, 'imp:yes');
    assert.deepEqual(h.space(1).events.map((e) => e.name), ['A', 'B']);
    assert.deepEqual(h.space(1).events[0].tasks, [{ t: 'x' }]);
    h.file = { events: [{ name: 'hỏng' }] };
    await h.update(doc);
    assert.match(h.sent().text, /không đúng định dạng/);

    await h.click(1, 'st:cal');
    const url = h.sent().text.match(/https:\/\/x\.workers\.dev\/lich\/[0-9a-f]{32}\.ics/)[0];
    const res = await worker.fetch(new Request(url), h.env);
    assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.match(await res.text(), /X-WR-CALNAME:Nhớ Hỉ[\s\S]*SUMMARY:A\r\n/);
    assert.equal((await worker.fetch(new Request(url.replace(/[0-9a-f]{32}/, '0'.repeat(32))), h.env)).status, 404);
    await h.click(1, 'st:calnew');
    assert.equal((await worker.fetch(new Request(url), h.env)).status, 404);
  });
});
