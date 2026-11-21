#!/usr/bin/env node
// Cài đặt một lần: tạo KV, deploy Worker, lưu secret, nối webhook Telegram.
// Chạy: npm run setup
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tomlPath = `${root}wrangler.toml`;
const rl = createInterface({ input: process.stdin, output: process.stdout });

function run(args, { input, quiet } = {}) {
  return new Promise((resolve) => {
    const p = spawn('npx', ['wrangler', ...args], { cwd: root, stdio: [input ? 'pipe' : 'inherit', 'pipe', 'pipe'] });
    let out = '';
    const onData = (stream) => (d) => {
      out += d;
      if (!quiet) stream.write(d);
    };
    p.stdout.on('data', onData(process.stdout));
    p.stderr.on('data', onData(process.stderr));
    if (input) p.stdin.end(input);
    p.on('close', (code) => resolve({ code, out }));
  });
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function telegram(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

console.log('== 1/5 Đăng nhập Cloudflare ==');
if ((await run(['whoami'], { quiet: true })).out.includes('not authenticated')) {
  const login = await run(['login']);
  if (login.code !== 0) fail('Đăng nhập Cloudflare không thành công.');
}

console.log('\n== 2/5 Tạo kho lưu trữ KV ==');
let toml = readFileSync(tomlPath, 'utf8');
if (toml.includes('REPLACE_WITH_KV_ID')) {
  const idRe = /id["']?\s*[=:]\s*"([0-9a-f]{32})"/;
  let id = (await run(['kv', 'namespace', 'create', 'REMINDERS'], { quiet: true })).out.match(idRe)?.[1];
  if (!id) {
    // Đã tạo từ lần chạy trước: tìm lại trong danh sách.
    const list = (await run(['kv', 'namespace', 'list'], { quiet: true })).out;
    try {
      const all = JSON.parse(list.slice(list.indexOf('['), list.lastIndexOf(']') + 1));
      id = all.find((n) => /REMINDERS/.test(n.title))?.id;
    } catch {}
  }
  if (!id) fail('Không tạo được KV namespace. Thử chạy: npx wrangler kv namespace create REMINDERS');
  toml = toml.replace('REPLACE_WITH_KV_ID', id);
  writeFileSync(tomlPath, toml);
  console.log(`Đã tạo KV: ${id}`);
} else {
  console.log('KV đã được cấu hình, bỏ qua.');
}

console.log('\n== 3/5 Bot Telegram ==');
console.log('Mở Telegram, chat với @BotFather, gửi /newbot, làm theo hướng dẫn rồi dán token vào đây.');
const token = (await rl.question('Token của bot: ')).trim();
const me = await telegram(token, 'getMe');
if (!me.ok) fail('Token không hợp lệ.');
console.log(`Bot: @${me.result.username}`);

console.log('\n== 4/5 Deploy lên Cloudflare ==');
const deploy = await run(['deploy']);
if (deploy.code !== 0) fail('Deploy thất bại, xem lỗi phía trên.');
let url = deploy.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (!url) url = (await rl.question('Dán địa chỉ Worker (https://....workers.dev): ')).trim().replace(/\/$/, '');

const secret = randomBytes(24).toString('hex');
for (const [name, value] of [
  ['TELEGRAM_BOT_TOKEN', token],
  ['WEBHOOK_SECRET', secret],
]) {
  const r = await run(['secret', 'put', name], { input: value, quiet: true });
  if (r.code !== 0) fail(`Không lưu được secret ${name}:\n${r.out}`);
}
console.log('Đã lưu secret.');

console.log('\n== 5/5 Nối webhook Telegram ==');
const hook = await telegram(token, 'setWebhook', {
  url: `${url}/webhook`,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});
if (!hook.ok) fail(`setWebhook lỗi: ${hook.description}`);
await telegram(token, 'setMyCommands', {
  commands: [
    { command: 'start', description: 'Hiện 4 nút chính' },
    { command: 'them', description: 'Thêm ngày: /them Giỗ ông 15/3 âm' },
    { command: 'ds', description: 'Danh sách các ngày' },
    { command: 'homnay', description: 'Hôm nay ngày mấy âm, giờ hoàng đạo' },
    { command: 'caidat', description: 'Ngày lễ, gia đình, lịch, sao lưu' },
    { command: 'help', description: 'Hướng dẫn' },
  ],
});

rl.close();
console.log(`\n✅ Xong! Mở Telegram, vào @${me.result.username} và gửi /start. Ai nhắn bot cũng có một sổ riêng của mình.`);
