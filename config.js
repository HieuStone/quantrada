// Cấu hình quán trà đá. Thêm món mới: thêm 1 dòng vào `menu` (và gán quà ở `giftTiers`/`giftMap` nếu muốn).
module.exports = {
  // Username TikTok đang live (không có @). Có thể truyền khi chạy: node server.js ten_kenh
  tiktokUsername: process.env.TIKTOK_USER || '',
  port: 3000,

  // Không tương tác (chat/like/quà) quá số giây này thì đứng dậy ra về
  idleSeconds: 240,
  // Khách đứng chờ ghế quá số giây này thì bỏ đi
  waitSeconds: 60,
  // Tổng kim cương (đơn giá x số lượng) từ mức này trở lên => khách VIP, chủ quán mang cả bàn
  vipDiamonds: 100,

  // Món trong quán. image: ảnh trong public/img (thay file để đổi hình, emoji dùng khi chưa có ảnh). commands: lệnh chat gọi món (gõ !trada ...)
  menu: {
    trada:      { label: 'Trà đá',       image: 'img/trada.png', emoji: '🍵', drinkSeconds: 10, commands: ['trada', 'tra'] },
    huongduong: { label: 'Hướng dương',  image: 'img/huongduong.png', emoji: '🌻', drinkSeconds: 14, commands: ['huongduong', 'hd'] },
    keolac:     { label: 'Kẹo lạc',      image: 'img/keolac.png', emoji: '🍬', drinkSeconds: 12, commands: ['keolac', 'kl'] },
    nhantran:   { label: 'Nhân trần',    image: 'img/nhantran.png', emoji: '☕', drinkSeconds: 12, commands: ['nhantran', 'nt'] },
    che:        { label: 'Chè',          image: 'img/che.png', emoji: '🥣', drinkSeconds: 14, commands: ['che'] },
    bimbim:     { label: 'Bim bim',      image: 'img/bimbim.png', emoji: '🍿', drinkSeconds: 10, commands: ['bimbim', 'bb'] },
  },

  // Gán quà TikTok => món, theo TÊN quà (ưu tiên cao nhất). Tên theo tiếng Anh của TikTok.
  giftMap: {
    'Rose': 'trada',
    'Finger Heart': 'huongduong',
  },
  // Quà không có trong giftMap thì chọn món theo đơn giá kim cương (lấy mức cao nhất thỏa điều kiện)
  giftTiers: [
    { minDiamonds: 1,   item: 'trada' },
    { minDiamonds: 5,   item: 'huongduong' },
    { minDiamonds: 10,  item: 'keolac' },
    { minDiamonds: 30,  item: 'nhantran' },
    { minDiamonds: 50,  item: 'che' },
  ],
};
