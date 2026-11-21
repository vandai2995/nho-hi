# Nhớ Hỉ — bot Telegram nhắc ngày quan trọng (âm lịch & dương lịch)

Nhắn cho bot tên và ngày một lần, năm nào bot cũng tự tính lại ngày (kể cả ngày âm) và nhắc qua Telegram.
Mỗi người có lịch riêng; ngày nào muốn cả nhà cùng nhớ thì chia sẻ sang lịch chung của gia đình.

## Chạy ở đâu, có mất tiền không?

**Cloudflare Workers, gói Free** — không cần thẻ, không cần máy chủ, không bị tắt khi lâu không dùng.

| Thứ dùng | Bot này dùng | Giới hạn gói Free |
|---|---|---|
| Lượt gọi Worker | 90 lần cron/ngày + mỗi tin nhắn đến | 100.000/ngày |
| Cron (hẹn giờ) | 3 | 5 |
| KV đọc | khoảng 3 lượt/lịch/ngày + vài lượt mỗi tin nhắn | 100.000/ngày |
| KV ghi | 1–2 lượt mỗi lần thêm/sửa | 1.000/ngày |

Một nhà hay vài chục người dùng thì không bao giờ chạm giới hạn. Thứ chạm trước là **1.000 lượt ghi/ngày**
(tương đương vài trăm lần thêm/sửa mỗi ngày); khi tới mức đó cần chuyển dữ liệu sang D1.

## Cài đặt (một lần, ~5 phút)

Cần: Node.js 20+, tài khoản [Cloudflare](https://dash.cloudflare.com/sign-up) (miễn phí), Telegram.

1. Trong Telegram, chat với **@BotFather** → `/newbot` → đặt tên (ví dụ Nhớ Hỉ) → nhận **token**.
2. Trong thư mục này chạy:

   ```bash
   npm install
   ```

   ```bash
   npm run setup
   ```

   Script sẽ mở trình duyệt để đăng nhập Cloudflare, hỏi token bot, rồi tự tạo KV, deploy, lưu secret và nối webhook.
3. Mở bot trong Telegram và gửi `/start`.

## Cách dùng

**Thêm ngày:** nhắn cho bot như nói chuyện.

```
giỗ ông nội rằm tháng ba
sinh nhật mẹ 20/10
ngày cưới 2/9/2015            có năm → báo "tròn N năm"
giỗ bà 8/1 âm                 ngày âm thì thêm chữ "âm"
cúng rằm hàng tháng
họp lớp 20/12/2026 một lần    tự xoá sau khi qua
```

**Mọi thứ khác nằm ở 4 nút dưới ô nhập tin:**

| Nút | Làm gì |
|---|---|
| ➕ Thêm ngày | Nhắc lại cách nhắn để thêm |
| 📋 Danh sách | Các ngày sắp tới, chia theo 7 ngày / 30 ngày / xa hơn. Bấm số để mở thẻ của ngày đó |
| 📅 Hôm nay | Ngày âm, can chi, tiết khí, hoàng đạo/hắc đạo, giờ hoàng đạo, và các ngày trong 7 ngày tới |
| ⚙️ Cài đặt | Ngày lễ có sẵn · Dùng chung với gia đình · Lịch trên điện thoại · Sao lưu · Hướng dẫn |

**Thẻ của mỗi ngày** có 4 nút (thêm nút chia sẻ nếu bạn có lịch chung):

- **Sửa** — tên, ngày, nhắc trước mấy ngày, giờ nhắc (7:00 / 12:00 / 20:00), ghi chú.
- **Việc cần làm** — danh sách việc, ghi được ai lo (`Mua hoa - Lan`). Bấm vào việc để đánh dấu xong; sang lần sau tự trở lại "chưa xong". Việc chưa xong hiện trong tin nhắc.
- **Ghi chép** — mỗi năm một ghi chép (làm mấy mâm, mời ai...). Ghi chép năm gần nhất hiện trong tin nhắc.
- **Xoá** — có bước xác nhận.

## Bot nhắc khi nào

- **7:00 sáng** (mặc định): đúng ngày, trước 1 ngày và trước 3 ngày. Tin nhắc đúng ngày có nút **Đã biết**.
- **20:00**: nếu chưa ai bấm **Đã biết** thì nhắc lại (ngày lễ có sẵn không nhắc lại).
- **Gửi bù**: lần chạy lỗi sẽ được chạy lại sau 2 phút; nếu lỡ hẳn một ngày thì hôm sau gửi bù (tối đa 3 ngày).
- **Ngày 1 hằng tháng**: tổng kết tháng kèm file sao lưu tự động.

## Lịch riêng và lịch chung

Mỗi người luôn có **lịch riêng**. Ngày bạn thêm trong chat riêng với bot mặc định là của riêng bạn, chỉ nhắc cho bạn.

Muốn cả nhà cùng được nhắc thì dùng **lịch chung**:

1. ⚙️ Cài đặt → Dùng chung với gia đình → **Tạo lịch chung và lấy link mời**.
2. **Mời một người:** gửi họ link mời, họ bấm vào và xác nhận. Ngày riêng của họ vẫn là của riêng họ.
3. **Nhóm chat:** thêm bot vào nhóm rồi gõ `/thamgia <mã>` trong nhóm. Ngày thêm trong nhóm luôn là ngày chung.
4. **Chia sẻ một ngày:** mở ngày đó trong 📋 Danh sách và bấm **Chia sẻ với gia đình**. Đổi ý thì bấm **Chuyển về lịch riêng**.

Danh sách hiện cả ngày riêng lẫn ngày chung, ngày chung có ký hiệu 👨‍👩‍👧, chia thành ba đoạn: trong 7 ngày tới, trong 30 ngày tới, xa hơn.
Tin nhắc của lịch chung có dòng tiêu đề "Lịch chung của gia đình" và gửi cho mọi thành viên; mỗi người thuộc một lịch chung.
Ngày lễ có sẵn là cài đặt riêng của từng người (trong nhóm chat thì là của nhóm). Link lịch `.ics` của bạn gồm cả ngày riêng lẫn ngày chung.
Rời lịch chung bằng nút trong cùng màn hình; lịch riêng giữ nguyên.

## Ghi chú

- Ngày 30 âm rơi vào tháng thiếu được nhắc vào ngày 29; 29/2 vào năm không nhuận nhắc 28/2.
- Ngày âm hằng năm tính theo tháng thường (không lặp ở tháng nhuận); ngày hằng tháng thì có.
- Âm lịch tính theo múi giờ Việt Nam (thuật toán Hồ Ngọc Đức).
- Ngày hoàng đạo/hắc đạo tính theo tháng âm lịch và chi của ngày, như các lịch vạn niên phổ thông.
- Ngày lễ Huế: cúng âm hồn 23/5 âm, giải phóng Huế 26/3, hội vật làng Sình 10/1 âm, cầu ngư Thai Dương Hạ 12/1 âm, lễ hội Quán Thế Âm 19/6 âm.
- Link lịch `.ics` chứa mã bí mật; ai có link đều xem được. Đổi link trong ⚙️ Cài đặt → Lịch trên điện thoại.

## Lệnh gõ tay (không bắt buộc)

`/them Giỗ bà 8/1 âm nhắc 0,1,7 | mua hoa` · `/ds` · `/sapden 30` · `/sua 3 16/3 âm` · `/xoa 3` · `/nhac 3 0,1,7` ·
`/homnay` · `/doi 15/3/2027 âm` · `/thu` · `/caidat` · `/xuat` · `/thamgia <mã>` · `/roi`

Số trong `/sua`, `/xoa`, `/nhac` là số đứng trước tên ngày trong 📋 Danh sách.

## Bảo trì

- Đổi giờ nhắc: sửa `crons` trong `wrangler.toml` và `PHASES` trong `src/index.js` rồi `npm run deploy`.
- Xem log: `npm run logs`.
- Chạy test: `npm test`.
