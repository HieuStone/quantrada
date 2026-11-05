// Server: nhận sự kiện TikTok LIVE -> gửi qua WebSocket cho trang hoạt hình (public/).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');
const config = require('./config');

const username = (process.argv[2] || config.tiktokUsername || '').replace(/^@/, '');
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/config.json') {
    const { menu, giftMap, giftTiers, idleSeconds, waitSeconds, vipDiamonds } = config;
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ menu, giftMap, giftTiers, idleSeconds, waitSeconds, vipDiamonds }));
  }
  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
let lastStatus = { type: 'status', text: username ? `Đang kết nối @${username}...` : 'Chưa cấu hình username TikTok (chế độ giả lập)' };
function broadcast(msg) {
  const s = JSON.stringify(msg);
  if (msg.type === 'status') lastStatus = msg;
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
wss.on('connection', (ws) => ws.send(JSON.stringify(lastStatus)));

function userOf(data) {
  const u = data.user || {};
  return {
    id: String(u.uniqueId || u.userId || u.nickname || 'unknown'),
    name: u.nickname || u.uniqueId || 'Khách',
    avatar: u.profilePicture?.url || u.profilePicture?.urls?.[0] || u.profilePictureUrl || '',
  };
}

function startTikTok() {
  const conn = new TikTokLiveConnection(username);
  conn.on(WebcastEvent.MEMBER, (d) => broadcast({ type: 'join', user: userOf(d) }));
  conn.on(WebcastEvent.CHAT, (d) => broadcast({ type: 'chat', user: userOf(d), text: d.comment || '' }));
  conn.on(WebcastEvent.LIKE, (d) => broadcast({ type: 'like', user: userOf(d) }));
  conn.on(WebcastEvent.GIFT, (d) => {
    // Quà dạng chuỗi (giftType 1): chỉ xử lý khi chuỗi kết thúc, tránh đếm trùng
    if (d.giftDetails?.giftType === 1 && !d.repeatEnd) return;
    broadcast({
      type: 'gift',
      user: userOf(d),
      giftName: d.giftDetails?.giftName || d.giftName || '',
      diamonds: d.giftDetails?.diamondCount ?? d.diamondCount ?? 1,
      count: d.repeatCount || 1,
    });
  });

  let retry = null;
  const reconnect = (why) => {
    broadcast({ type: 'status', text: `Mất kết nối (${why}), thử lại sau 15s...` });
    clearTimeout(retry);
    retry = setTimeout(connect, 15000);
  };
  const connect = () => {
    conn.connect()
      .then(() => broadcast({ type: 'status', text: `Đã kết nối live @${username}` }))
      .catch((e) => { console.error('Lỗi kết nối:', e.message || e); reconnect(e.message || 'lỗi'); });
  };
  conn.on(WebcastEvent.DISCONNECTED, () => reconnect('ngắt'));
  conn.on(WebcastEvent.STREAM_END, () => broadcast({ type: 'status', text: 'Live đã kết thúc' }));
  conn.on(WebcastEvent.ERROR, (e) => console.error('TikTok error:', e?.message || e));
  connect();
}

server.listen(config.port, () => {
  console.log(`Quán trà đá chạy tại http://localhost:${config.port}`);
  console.log(`  OBS/TikTok LIVE Studio Browser Source: http://localhost:${config.port}/?overlay=1`);
  if (username) startTikTok();
  else console.log('  Chưa có username TikTok: dùng bảng giả lập trên trang. Chạy: node server.js <username>');
});
