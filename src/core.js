// Logic thuần (không phụ thuộc Cloudflare/Telegram): phân tích lệnh, tính ngày, soạn tin nhắn.
import { jdFromDate, jdToDate, lunarFromJd, jdFromLunar, canChi, dayCanChi, monthCanChi, solarTerm, isHoangDao, gioHoangDao } from './lunar.js';

export const DEFAULT_OFFSETS = [0, 1, 3];
export const MAX_OFFSET = 30;
const YEAR_WINDOW = 400;
const MAX_CATCHUP_DAYS = 3;

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const vnDate = (now) => new Date(now + 7 * 3600 * 1000);

/** Ngày hôm nay theo giờ Việt Nam, dạng JDN. */
export function vnTodayJd(now = Date.now()) {
  const t = vnDate(now);
  return jdFromDate(t.getUTCDate(), t.getUTCMonth() + 1, t.getUTCFullYear());
}
export const vnHour = (now = Date.now()) => vnDate(now).getUTCHours();

// Đổi âm lịch là phần tốn CPU nhất: nhớ lại kết quả để nhiều sổ dùng chung trong một lần chạy.
const dayCache = new Map();
function dayInfo(jd) {
  let info = dayCache.get(jd);
  if (!info) {
    if (dayCache.size > 5000) dayCache.clear();
    info = { jd, s: jdToDate(jd), l: lunarFromJd(jd) };
    dayCache.set(jd, info);
  }
  return info;
}

/** n+1 ngày liên tiếp bắt đầu từ startJd (phần tử cuối chỉ dùng để nhìn trước). */
export function buildDays(startJd, n) {
  const days = [];
  for (let i = 0; i <= n; i++) days.push(dayInfo(startJd + i));
  return days;
}

// Khớp ngày, có xử lý cuối tháng: ngày 30 âm trong tháng thiếu -> 29, 29/2 -> 28/2, 31 -> ngày cuối tháng.
function dayMatches(cur, next, day) {
  return cur.d === day || (cur.d < day && next.d === 1);
}

/** Mọi lần diễn ra trong cửa sổ `days` (>= days[0]). Mỗi phần tử: { jd, diff, s, l }. */
export function occurrences(ev, days, limit = Infinity) {
  const startJd = days[0].jd;
  if (ev.repeat === 'once') {
    const jd = ev.cal === 'lunar' ? jdFromLunar(ev.day, ev.month, ev.year) : jdFromDate(ev.day, ev.month, ev.year);
    if (jd === null || jd < startJd) return [];
    return [{ ...dayInfo(jd), diff: jd - startJd }];
  }
  const key = ev.cal === 'lunar' ? 'l' : 's';
  const out = [];
  for (let i = 0; i < days.length - 1 && out.length < limit; i++) {
    const cur = days[i][key];
    if (ev.repeat === 'yearly') {
      // sự kiện âm lịch hằng năm tính theo tháng thường, bỏ qua tháng nhuận
      if (cur.leap || cur.m !== ev.month) continue;
    }
    if (dayMatches(cur, days[i + 1][key], ev.day)) out.push({ ...days[i], diff: i });
  }
  return out;
}

/** Lần diễn ra kế tiếp (>= hôm nay) hoặc null. */
export const nextOccurrence = (ev, days) => occurrences(ev, days, 1)[0] ?? null;

// ---------- Ngày lễ có sẵn ----------

const hol = (name, cal, day, month, offsets = [0, 1]) => ({ name, cal, day, month, offsets });
const ANNUAL = [
  hol('Tết Dương lịch', 'solar', 1, 1),
  hol('Valentine', 'solar', 14, 2),
  hol('Quốc tế Phụ nữ', 'solar', 8, 3),
  hol('Giải phóng miền Nam', 'solar', 30, 4),
  hol('Quốc tế Lao động', 'solar', 1, 5),
  hol('Quốc tế Thiếu nhi', 'solar', 1, 6),
  hol('Quốc khánh', 'solar', 2, 9),
  hol('Phụ nữ Việt Nam', 'solar', 20, 10),
  hol('Nhà giáo Việt Nam', 'solar', 20, 11),
  hol('Giáng sinh', 'solar', 25, 12),
  hol('Tết Nguyên Đán', 'lunar', 1, 1, [0, 1, 3, 7]),
  hol('Rằm tháng Giêng', 'lunar', 15, 1),
  hol('Giỗ Tổ Hùng Vương', 'lunar', 10, 3),
  hol('Lễ Phật Đản', 'lunar', 15, 4),
  hol('Tết Đoan Ngọ', 'lunar', 5, 5),
  hol('Vu Lan', 'lunar', 15, 7),
  hol('Tết Trung thu', 'lunar', 15, 8),
  hol('Ông Công Ông Táo', 'lunar', 23, 12),
  hol('Tất niên', 'lunar', 30, 12),
  hol('Ngày Văn hóa Việt Nam', 'solar', 24, 11), // thêm ở cuối để mã của các ngày lễ cũ không đổi
];
// Ngày lễ riêng của Huế.
const HUE = [
  hol('Cúng âm hồn 23/5 (Thất thủ Kinh đô)', 'lunar', 23, 5, [0, 1, 3]),
  hol('Giải phóng Thừa Thiên Huế', 'solar', 26, 3),
  hol('Hội vật làng Sình', 'lunar', 10, 1),
  hol('Lễ cầu ngư Thai Dương Hạ (Thuận An)', 'lunar', 12, 1),
  hol('Lễ hội Quán Thế Âm (núi Tứ Tượng)', 'lunar', 19, 6),
];
const MONTHLY = [
  { name: 'Mùng 1', cal: 'lunar', day: 1, offsets: [0, 1] },
  { name: 'Rằm', cal: 'lunar', day: 15, offsets: [0, 1] },
];

/** settings: { annual: bool, hue: bool, monthly: bool } */
export function builtinEvents(settings = {}) {
  const out = [];
  if (settings.annual) ANNUAL.forEach((h, i) => out.push({ ...h, id: `le${i}`, repeat: 'yearly', holiday: 'annual' }));
  if (settings.hue) HUE.forEach((h, i) => out.push({ ...h, id: `hue${i}`, repeat: 'yearly', holiday: 'hue' }));
  if (settings.monthly) MONTHLY.forEach((h, i) => out.push({ ...h, id: `ram${i}`, repeat: 'monthly', holiday: 'monthly' }));
  return out;
}

// Rằm / mùng 1 hằng tháng trùng một ngày lễ âm lịch (Tết, Vu Lan...) thì chỉ giữ ngày lễ.
export function dedupeHolidays(items) {
  const named = new Set(items.filter((x) => x.ev.holiday === 'annual').map((x) => x.occ.jd));
  return items.filter((x) => x.ev.holiday !== 'monthly' || !named.has(x.occ.jd));
}

// ---------- Phân tích lệnh ----------

// Bỏ dấu, giữ nguyên độ dài chuỗi (để dùng chung chỉ số với chuỗi gốc).
function fold(s) {
  const f = s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  return f.length === s.length ? f : s.toLowerCase();
}

export function parseOffsets(str) {
  const nums = String(str)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (!nums.length || nums.some((n) => !Number.isInteger(n) || n < 0 || n > MAX_OFFSET)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

// Các mẫu dưới đây chạy trên chuỗi đã bỏ dấu.
const TAIL = {
  lunar: /(?:^|\s)(am lich|am|al)$/,
  solar: /(?:^|\s)(duong lich|duong|dl)$/,
  monthly: /(?:^|\s)(hang thang|moi thang)$/,
  once: /(?:^|\s)(mot lan|1 lan|1lan|motlan)$/,
  yearly: /(?:^|\s)(hang nam|moi nam)$/, // mặc định đã là hằng năm: chỉ cần bỏ khỏi tên
  offsets: /(?:^|\s)nhac(?: truoc)?\s*[=:]?\s*(\d+(?:\s*,\s*\d+)*)(?: ngay)?$/,
};
const DATE_TAIL = /(?:^|\s)(\d{1,2})(?:[\/\-.](\d{1,2})(?:[\/\-.](\d{4}))?)?$/;
const MONTH_WORDS = {
  gieng: 1, mot: 1, hai: 2, ba: 3, tu: 4, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9,
  muoi: 10, 'muoi mot': 11, 'muoi hai': 12, chap: 12,
};
// "rằm tháng ba", "mùng 5 tháng giêng", "ngày 20 tháng 10 năm 1990"
const NATURAL =
  /(?:^|\s)(?:(ram)|(?:(ngay|mung|mong)\s+)?(\d{1,2}))\s+thang\s+(muoi mot|muoi hai|muoi|gieng|mot|hai|bay|ba|tu|bon|nam|sau|tam|chin|chap|\d{1,2})(?:\s+nam\s+(\d{4}))?(?=\s|$)/;
// "rằm", "mùng 1" đứng riêng (dùng với "hàng tháng")
const NATURAL_DAY = /(?:^|\s)(?:(ram)|(?:mung|mong)\s+(\d{1,2}))(?=\s|$)/;

/** Tách ghi chú (sau dấu |), ngày, và các từ khoá: âm/dương, hàng tháng, một lần, nhắc ... */
function parseSpec(input) {
  let s = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  const out = { cal: null, monthly: false, once: false, offsets: null, note: undefined, day: null, month: null, year: null };
  const bar = s.indexOf('|');
  if (bar >= 0) {
    out.note = s.slice(bar + 1).trim().slice(0, 300);
    s = s.slice(0, bar).trim();
  }
  let lunarHint = false;

  const nat = fold(s).match(NATURAL);
  if (nat) {
    out.day = nat[1] ? 15 : Number(nat[3]);
    out.month = MONTH_WORDS[nat[4]] ?? Number(nat[4]);
    out.year = nat[5] ? Number(nat[5]) : null;
    lunarHint = Boolean(nat[1]) || /^(mung|mong)$/.test(nat[2] ?? '') || nat[4] === 'gieng' || nat[4] === 'chap';
    const before = s.slice(0, nat.index).trim();
    let after = s.slice(nat.index + nat[0].length).trim();
    const head = fold(after).match(/^(am lich|am|duong lich|duong)(?=\s|$)/);
    if (head) {
      out.cal = head[1].startsWith('am') ? 'lunar' : 'solar';
      after = after.slice(head[0].length).trim();
    }
    s = `${before} ${after}`.trim();
  }

  for (let guard = 0; guard < 8; guard++) {
    const f = fold(s);
    let m;
    if ((m = f.match(TAIL.lunar))) out.cal = 'lunar';
    else if ((m = f.match(TAIL.solar))) out.cal = 'solar';
    else if ((m = f.match(TAIL.monthly))) out.monthly = true;
    else if ((m = f.match(TAIL.once))) out.once = true;
    else if ((m = f.match(TAIL.yearly))) out.yearly = true;
    else if ((m = f.match(TAIL.offsets))) {
      out.offsets = parseOffsets(m[1]);
      if (!out.offsets) return { error: `Số ngày nhắc trước phải từ 0 đến ${MAX_OFFSET}, ví dụ: nhắc 0,1,7` };
    } else break;
    s = s.slice(0, m.index).trim();
  }

  if (!nat) {
    // "mùng 1" ở cuối là ngày âm, không phải số ngày trần.
    const mung = fold(s).match(/(?:^|\s)(?:mung|mong)\s+\d{1,2}$/);
    const dm = !mung && s.match(DATE_TAIL);
    const nd = !dm && fold(s).match(NATURAL_DAY);
    if (dm) {
      out.day = Number(dm[1]);
      out.month = dm[2] ? Number(dm[2]) : null;
      out.year = dm[3] ? Number(dm[3]) : null;
      s = s.slice(0, dm.index).trim();
    } else if (nd) {
      out.day = nd[1] ? 15 : Number(nd[2]); // giữ nguyên chữ "rằm"/"mùng 1" trong tên
      lunarHint = true;
    } else {
      return { error: 'Không thấy ngày. Viết ngày dạng 15/3, 15/3/1990 hoặc "rằm tháng ba".', code: 'nodate' };
    }
  }
  if (!out.cal) out.cal = lunarHint ? 'lunar' : 'solar';
  out.rest = s;
  return out;
}

function validateDate(cal, day, month, year) {
  const maxDay = cal === 'lunar' ? 30 : 31;
  if (!Number.isInteger(day) || day < 1 || day > maxDay) return `Ngày ${cal === 'lunar' ? 'âm' : 'dương'} phải từ 1 đến ${maxDay}.`;
  if (month !== null) {
    if (!Number.isInteger(month) || month < 1 || month > 12) return 'Tháng phải từ 1 đến 12.';
    if (cal === 'solar' && day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
      return `Tháng ${month} dương lịch không có ngày ${day}.`;
  }
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) return 'Năm phải trong khoảng 1900–2100.';
  return null;
}

/**
 * "<tên> <ngày>[/<tháng>[/<năm>]] [âm|dương] [hàng tháng|một lần] [nhắc 0,1,3] [| ghi chú]"
 * hoặc dạng tự nhiên: "giỗ ông nội rằm tháng ba".
 */
export function parseAdd(input, { nameOptional = false } = {}) {
  const t = parseSpec(input);
  if (t.error) return t;
  if (!t.rest && !nameOptional) return { error: 'Thiếu tên sự kiện. Ví dụ: /them Giỗ ông nội 15/3 âm' };
  if (t.monthly && t.once) return { error: 'Chỉ chọn một trong hai: "hàng tháng" hoặc "một lần".' };
  const repeat = t.monthly ? 'monthly' : t.once ? 'once' : 'yearly';
  if (repeat !== 'monthly' && t.month === null)
    return { error: 'Thiếu tháng. Viết 15/3, hoặc thêm "hàng tháng" nếu muốn nhắc ngày 15 mỗi tháng.' };
  if (repeat === 'once' && t.year === null)
    return { error: 'Sự kiện một lần cần đủ ngày/tháng/năm, ví dụ: 20/12/2026 một lần' };
  const err = validateDate(t.cal, t.day, repeat === 'monthly' ? null : t.month, t.year);
  if (err) return { error: err };
  const ev = { cal: t.cal, repeat, day: t.day };
  if (t.rest) ev.name = t.rest.slice(0, 200);
  if (repeat !== 'monthly') ev.month = t.month;
  if (repeat !== 'monthly' && t.year !== null) ev.year = t.year;
  if (t.offsets) ev.offsets = t.offsets;
  if (t.note !== undefined) ev.note = t.note;
  if (repeat === 'once' && t.cal === 'lunar' && jdFromLunar(ev.day, ev.month, ev.year) === null)
    return { error: 'Ngày âm lịch này không hợp lệ.' };
  return { event: ev };
}

/** "/doi 15/3[/2027] [âm]" hoặc "/doi rằm tháng 8" -> { cal, day, month, year|null } */
export function parseConvert(input) {
  const t = parseSpec(input);
  if (t.error || t.rest || t.month === null) return { error: 'Cú pháp: /doi 15/3/2027 âm  hoặc  /doi 20/10/2026' };
  const err = validateDate(t.cal, t.day, t.month, t.year);
  if (err) return { error: err };
  return { cal: t.cal, day: t.day, month: t.month, year: t.year };
}

/** Kiểm tra dữ liệu nhập từ file sao lưu. Trả mảng sự kiện sạch (id đánh lại từ 1) hoặc null. */
export function sanitizeEvents(list) {
  if (!Array.isArray(list) || list.length > 1000) return null;
  const out = [];
  for (const e of list) {
    if (!e || typeof e.name !== 'string' || !e.name.trim()) return null;
    if (!['lunar', 'solar'].includes(e.cal) || !['yearly', 'monthly', 'once'].includes(e.repeat)) return null;
    const month = e.repeat === 'monthly' ? null : e.month;
    const year = e.year ?? null;
    if (e.repeat !== 'monthly' && month == null) return null;
    if (e.repeat === 'once' && year === null) return null;
    if (validateDate(e.cal, e.day, month, year)) return null;
    const ev = { id: out.length + 1, name: e.name.trim().slice(0, 200), cal: e.cal, repeat: e.repeat, day: e.day };
    if (month !== null) ev.month = month;
    if (month !== null && year !== null) ev.year = year;
    if (e.offsets != null) {
      const offs = Array.isArray(e.offsets) ? parseOffsets(e.offsets.join(',')) : null;
      if (!offs) return null;
      ev.offsets = offs;
    }
    if (typeof e.note === 'string' && e.note.trim()) ev.note = e.note.trim().slice(0, 300);
    if (e.slot === 'noon' || e.slot === 'pm') ev.slot = e.slot;
    if (e.repeat === 'once' && e.cal === 'lunar' && jdFromLunar(e.day, month, year) === null) return null;
    if (Array.isArray(e.tasks)) {
      const tasks = e.tasks
        .filter((t) => t && typeof t.t === 'string' && t.t.trim())
        .slice(0, 30)
        .map((t) => {
          const task = { t: t.t.trim().slice(0, 100) };
          if (typeof t.w === 'string' && t.w.trim()) task.w = t.w.trim().slice(0, 40);
          if (Number.isInteger(t.done)) task.done = t.done;
          return task;
        });
      if (tasks.length) ev.tasks = tasks;
    }
    if (Array.isArray(e.log)) {
      const log = e.log
        .filter((x) => x && Number.isInteger(x.y) && x.y >= 1900 && x.y <= 2200 && typeof x.t === 'string' && x.t.trim())
        .slice(0, 30)
        .map((x) => ({ y: x.y, t: x.t.trim().slice(0, 500) }));
      if (log.length) ev.log = log;
    }
    out.push(ev);
  }
  return out;
}

// ---------- Định dạng ----------

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const weekday = (jd) => WEEKDAYS[(jd + 1) % 7];
const fmtSolar = (s) => `${s.d}/${s.m}/${s.y}`;
const fmtLunar = (l) => `${l.d}/${l.m}${l.leap ? ' nhuận' : ''} âm`;

export function fmtDay(info) {
  return `${weekday(info.jd)} ${fmtSolar(info.s)} (${fmtLunar(info.l)})`;
}

export function fmtToday(jd) {
  const i = dayInfo(jd);
  return `${weekday(jd)} ${fmtSolar(i.s)} · ${fmtLunar(i.l)} lịch, năm ${canChi(i.l.y)}`;
}

export function describeEvent(ev) {
  const cal = ev.cal === 'lunar' ? 'âm lịch' : 'dương lịch';
  let s;
  if (ev.repeat === 'monthly') s = `ngày ${ev.day} ${cal} · hằng tháng`;
  else if (ev.repeat === 'once') s = `${ev.day}/${ev.month}/${ev.year} ${cal} · một lần`;
  else s = `${ev.day}/${ev.month}${ev.year ? '/' + ev.year : ''} ${cal} · hằng năm`;
  const at = ev.slot === 'noon' ? ' lúc 12:00' : ev.slot === 'pm' ? ' lúc 20:00' : '';
  return `${s} · nhắc trước ${(ev.offsets ?? DEFAULT_OFFSETS).join(', ')} ngày${at}`;
}

function anniversaryYears(ev, occ) {
  if (ev.repeat !== 'yearly' || !ev.year) return 0;
  return Math.max(0, (ev.cal === 'lunar' ? occ.l.y : occ.s.y) - ev.year);
}
const anniversary = (ev, occ) => (anniversaryYears(ev, occ) ? ` (tròn ${anniversaryYears(ev, occ)} năm)` : '');
const label = (ev) => (ev.holiday ? `🏮 ${esc(ev.name)}` : esc(ev.name));
const noteLine = (ev, indent = '     ') => (ev.note ? `\n${indent}📝 ${esc(ev.note)}` : '');

// Ghi chú, việc chưa xong cho lần này, và ghi chép của năm gần nhất.
function extras(ev, occ) {
  let s = noteLine(ev);
  if (occ.diff >= 0) {
    for (const t of (ev.tasks ?? []).filter((t) => t.done !== occ.jd).slice(0, 8)) s += `\n     ☐ ${esc(t.t)}${t.w ? ` (${esc(t.w)})` : ''}`;
  }
  const last = [...(ev.log ?? [])].sort((a, b) => b.y - a.y)[0];
  if (last) s += `\n     📖 ${last.y}: ${esc(last.t.slice(0, 200))}`;
  return s;
}

/** "Còn 3 ngày · Thứ Tư 18/11/2026 (10/10 âm) (tròn 60 năm)" */
export const whenText = (ev, occ) => `${countdown(occ.diff)} · ${fmtDay(occ)}${anniversary(ev, occ)}`;

function countdown(diff) {
  if (diff === 0) return 'HÔM NAY';
  if (diff === 1) return 'Ngày mai';
  if (diff === -1) return 'Đã qua hôm qua';
  if (diff < 0) return `Đã qua ${-diff} ngày`;
  return `Còn ${diff} ngày`;
}

/** Danh sách sự kiện kèm lần kế tiếp, sắp theo ngày gần nhất. */
export function upcoming(events, todayJd) {
  const days = buildDays(todayJd, YEAR_WINDOW);
  return events
    .map((ev) => ({ ev, occ: nextOccurrence(ev, days) }))
    .sort((a, b) => (a.occ?.diff ?? Infinity) - (b.occ?.diff ?? Infinity));
}

/** within = null: mọi sự kiện của người dùng. within = N: mọi thứ (kể cả ngày lễ) trong N ngày tới. */
export function listMessage(events, todayJd, within = null) {
  let items = upcoming(events, todayJd);
  if (within !== null) items = dedupeHolidays(items.filter((x) => x.occ && x.occ.diff <= within));
  else items = items.filter((x) => !x.ev.holiday);
  if (!items.length)
    return within !== null ? `Không có ngày nào trong ${within} ngày tới.` : 'Chưa có ngày nào. Thêm bằng lệnh, ví dụ:\n/them Giỗ ông nội 15/3 âm';
  const head = within !== null ? `📅 <b>Trong ${within} ngày tới</b>` : `📋 <b>Các ngày cần nhớ</b> (${items.length})`;
  const lines = items.map(({ ev, occ }) => {
    const when = occ ? `⏳ ${countdown(occ.diff)} · ${fmtDay(occ)}${anniversary(ev, occ)}` : '⌛ đã qua';
    if (ev.holiday || within !== null) return `<b>${label(ev)}</b>\n   ${when}`;
    return `<b>#${ev.id} ${esc(ev.name)}</b>\n   ${describeEvent(ev)}${noteLine(ev, '   ')}\n   ${when}`;
  });
  return `${head}\n\n${lines.join('\n\n')}`;
}

const DOT = (diff) => (diff < 0 ? '⚪' : diff === 0 ? '🔴' : diff === 1 ? '🟠' : '🟡');

/**
 * Tin nhắc buổi sáng. lastRunJd là ngày chạy thành công gần nhất: nếu bot lỡ vài ngày thì gửi bù.
 * slot: 'am' (7:00) | 'noon' (12:00) | 'pm' (20:00) — hôm nay chỉ nhắc sự kiện thuộc khung giờ này; ngày bị lỡ thì gửi bù tất cả.
 * Trả null nếu không có gì, hoặc { text, ackable, monthStart }.
 */
export function buildDaily(events, todayJd, lastRunJd = null, slot = 'am') {
  const from = lastRunJd == null ? todayJd : Math.min(todayJd, Math.max(lastRunJd + 1, todayJd - MAX_CATCHUP_DAYS));
  const found = new Map();
  for (let d = from; d <= todayJd; d++) {
    const days = buildDays(d, MAX_OFFSET + 1);
    for (const ev of events) {
      if (d === todayJd && (ev.slot ?? 'am') !== slot) continue;
      const occ = nextOccurrence(ev, days);
      if (!occ || !(ev.offsets ?? DEFAULT_OFFSETS).includes(occ.diff)) continue;
      found.set(`${ev.id}:${occ.jd}`, { ev, occ: { ...occ, diff: occ.jd - todayJd } });
    }
  }
  const hits = dedupeHolidays([...found.values()]).sort((a, b) => a.occ.diff - b.occ.diff);

  const parts = [];
  if (hits.length) {
    const lines = hits.map(({ ev, occ }) => {
      const when = occ.diff === 0 ? '' : `\n     ${fmtDay(occ)}`;
      return `${DOT(occ.diff)} <b>${countdown(occ.diff)}</b> — ${label(ev)}${anniversary(ev, occ)}${when}${extras(ev, occ)}`;
    });
    const late = from < todayJd ? `\n⚠️ Bot đã lỡ ${todayJd - from} ngày, đây là tin gửi bù.` : '';
    parts.push(`🔔 <b>Nhắc ngày quan trọng</b>\n${fmtToday(todayJd)}${late}\n\n${lines.join('\n')}`);
  }

  // Ngày 1 dương lịch (kể cả khi gửi bù): tổng kết tháng, cũng là tín hiệu bot còn chạy.
  const today = jdToDate(todayJd);
  const monthStart = slot === 'am' && today.d - 1 <= todayJd - from;
  if (monthStart) {
    const days = buildDays(todayJd, 31);
    const inMonth = dedupeHolidays(
      events.flatMap((ev) => occurrences(ev, days).filter((o) => o.s.m === today.m && o.s.y === today.y).map((occ) => ({ ev, occ }))),
    ).sort((a, b) => a.occ.diff - b.occ.diff);
    const body = inMonth.length
      ? inMonth.map(({ ev, occ }) => `• ${fmtDay(occ)} — ${label(ev)}${anniversary(ev, occ)}`).join('\n')
      : 'Chưa có ngày nào cần nhớ trong tháng này.';
    parts.push(`🗓 <b>Tháng ${today.m}/${today.y}</b>\n${body}\n\n✅ Bot vẫn đang chạy tốt.`);
  }
  if (!parts.length) return null;
  return { text: parts.join('\n\n'), ackable: hits.some((h) => h.occ.diff === 0 && !h.ev.holiday), monthStart };
}

/** Tin nhắc lại buổi tối cho các sự kiện (của người dùng) diễn ra hôm nay mà chưa bấm "Đã biết". */
export function eveningMessage(events, todayJd) {
  const days = buildDays(todayJd, 1);
  const todays = events.filter((ev) => {
    if (ev.holiday || ev.slot === 'pm' || !(ev.offsets ?? DEFAULT_OFFSETS).includes(0)) return false;
    return nextOccurrence(ev, days)?.diff === 0;
  });
  if (!todays.length) return null;
  const lines = todays.map((ev) => `🔴 ${esc(ev.name)}${anniversary(ev, days[0])}${extras(ev, { ...days[0], diff: 0 })}`);
  return `🔁 <b>Nhắc lại — hôm nay</b>\n${lines.join('\n')}`;
}

export function convertMessage(q, todayJd) {
  const year = q.year ?? jdToDate(todayJd).y;
  if (q.cal === 'lunar') {
    const jd = jdFromLunar(q.day, q.month, year);
    if (jd === null) return 'Ngày âm lịch này không hợp lệ.';
    return `${q.day}/${q.month}/${year} âm lịch (năm ${canChi(year)})\n→ <b>${weekday(jd)} ${fmtSolar(jdToDate(jd))}</b> dương lịch`;
  }
  const jd = jdFromDate(q.day, q.month, year);
  const back = jdToDate(jd);
  if (back.d !== q.day || back.m !== q.month) return 'Ngày dương lịch này không hợp lệ.';
  const l = lunarFromJd(jd);
  return `${weekday(jd)} ${q.day}/${q.month}/${year} dương lịch\n→ <b>${l.d}/${l.m}${l.leap ? ' nhuận' : ''}/${l.y}</b> âm lịch (năm ${canChi(l.y)})`;
}

/** Bỏ các sự kiện một lần đã qua. */
export function pruneExpired(events, todayJd) {
  const days = buildDays(todayJd, 1);
  return events.filter((ev) => ev.repeat !== 'once' || nextOccurrence(ev, days) !== null);
}

// ---------- Lịch .ics (đăng ký trong Google Calendar / Apple Calendar) ----------

const ICS_PAST = 7;
const ICS_AHEAD = 400;
const pad = (n) => String(n).padStart(2, '0');
const icsDate = (jd) => {
  const s = jdToDate(jd);
  return `${s.y}${pad(s.m)}${pad(s.d)}`;
};
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');

// Mỗi dòng tối đa 75 byte, dòng nối tiếp bắt đầu bằng dấu cách.
function icsFold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > 73) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function icsCalendar(events, todayJd) {
  const days = buildDays(todayJd - ICS_PAST, ICS_PAST + ICS_AHEAD);
  const last = todayJd + ICS_AHEAD;
  const items = dedupeHolidays(events.flatMap((ev) => occurrences(ev, days).filter((o) => o.jd <= last).map((occ) => ({ ev, occ }))));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nho-hi//VI', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Nhớ Hỉ', 'X-PUBLISHED-TTL:PT12H'];
  for (const { ev, occ } of items) {
    const desc = [`${occ.l.d}/${occ.l.m}${occ.l.leap ? ' nhuận' : ''}/${occ.l.y} âm lịch`, ev.note].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}-${occ.jd}@nho-hi`,
      `DTSTAMP:${icsDate(todayJd)}T000000Z`,
      `DTSTART;VALUE=DATE:${icsDate(occ.jd)}`,
      `DTEND;VALUE=DATE:${icsDate(occ.jd + 1)}`,
      `SUMMARY:${icsText(ev.name + anniversary(ev, occ))}`,
      `DESCRIPTION:${icsText(desc)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ---------- Lịch vạn niên (nút Hôm nay) ----------

export function almanac(jd) {
  const { s, l } = dayInfo(jd);
  return {
    title: `${weekday(jd)} ${fmtSolar(s)}`,
    lunar: `${l.d}/${l.m}${l.leap ? ' nhuận' : ''} âm lịch`,
    canChi: `Ngày ${dayCanChi(jd)}, tháng ${monthCanChi(l.m, l.y)}, năm ${canChi(l.y)}`,
    term: solarTerm(jd),
    good: isHoangDao(l.m, jd),
    hours: gioHoangDao(jd).join(', '),
  };
}

export function almanacText(jd) {
  const a = almanac(jd);
  return (
    `📆 <b>${a.title}</b>\n${a.lunar}\n${a.canChi}\n\n` +
    `${a.good ? '🟢 Ngày hoàng đạo' : '⚫ Ngày hắc đạo'} · Tiết ${a.term.name}\nGiờ hoàng đạo: ${a.hours}`
  );
}
