# Quán trà đá – overlay cho TikTok LIVE

Người xem vào live => nhân vật (ảnh đại diện + tên) đi vào quán trà đá vỉa hè, ngồi ghế.
Gõ lệnh chat hoặc tặng quà => chủ quán mang món ra. Không tương tác một lúc => đứng dậy ra về.

## Chạy thử (không cần live)
```
npm install
npm start
```
Mở http://localhost:3000 – dùng bảng "Giả lập" ở góc phải để cho khách vào, chat, like, tặng quà.
Xem nhanh cả cảnh: http://localhost:3000/?demo=1

## Chạy với live thật
```
node server.js ten_tiktok_cua_ban      (không có @)
```
(hoặc điền `tiktokUsername` trong `config.js`, hoặc biến môi trường `TIKTOK_USER`). Phải đang live.

## Đưa lên live
Thêm **Browser Source** (OBS hoặc TikTok LIVE Studio) với URL:
- `http://localhost:3000/?overlay=1` – ẩn bảng giả lập, có nền quán
- `http://localhost:3000/?overlay=1&bg=0` – nền trong suốt, chỉ có bàn ghế/nhân vật để chồng lên cảnh khác
- thêm `&legend=0` để ẩn bảng hướng dẫn gọi món
Kích thước Browser Source: 720 x 1280 (khung dọc 9:16 như màn hình điện thoại). Giao diện TikTok che phần trên và khung chat ở dưới, nên khách chỉ ngồi ở giữa.

## Tùy chỉnh – sửa `config.js`
- `menu`: thêm món = thêm 1 dòng (nhãn, emoji, thời gian dùng, lệnh chat).
- `giftMap` / `giftTiers`: quà TikTok nào => món nào (theo tên quà hoặc theo kim cương).
- `idleSeconds`: bao lâu không tương tác thì ra về (TikTok không báo người rời phòng nên dùng cách này).
- `vipDiamonds`: tổng kim cương từ mức này => khách VIP, được mang cả bàn.

## Lưu ý
- `tiktok-live-connector` là thư viện không chính thức, có thể hỏng khi TikTok đổi; hợp cho dự án cá nhân.
- Đã bỏ món "thuốc lào" vì TikTok hạn chế nội dung thuốc lá; thay bằng bim bim, chè, nhân trần.
- Hình hiện dùng emoji và hình vẽ code; muốn đẹp hơn thì thay bằng sprite trong `public/game.js`.
