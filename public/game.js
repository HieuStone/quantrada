// Quán trà đá vỉa hè: khách (người xem live) đi vào, ngồi, gọi món, rồi ra về khi hết tương tác.
(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get('overlay') === '1') document.body.classList.add('overlay');
  const SOLID_BG = params.get('bg') !== '0';       // ?bg=0 => nền trong suốt (chỉ vẽ nhân vật/bàn ghế)
  const SHOW_LEGEND = params.get('legend') !== '0';

  const cfg = await (await fetch('/config.json')).json();
  const canvas = document.getElementById('c');
  let ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // ---------- Bố cục ----------
  // Khung dọc 720x1280 (9:16) như màn hình điện thoại. Quầy ở trên, vỉa hè ở dưới.
  // Lưu ý giao diện TikTok che phần trên (~100px) và phần dưới (khung chat) nên khách chỉ ngồi ở giữa.
  const ENTRANCE = { x: W + 60, y: 450 };          // khách vào/ra ở mép phải
  const OWNER_HOME = { x: 370, y: 370 };           // đứng sau quầy
  const DOOR_OUT = [{ x: 594, y: 370 }, { x: 594, y: 435 }];   // lối đi ra khỏi quầy (cửa bên phải)
  const STOOL_COLORS = ['#f2c230', '#2e9b4f', '#3a73c9', '#a3a9ae'];
  // Không có bàn: ghế nhựa rải lộn xộn thành từng cụm (vị trí cố định nhờ random có seed)
  const seats = [];
  (() => {
    let s = 20260;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    [[190, 540], [520, 550], [190, 670], [520, 680], [190, 800], [520, 810], [190, 930], [520, 940]].forEach(([cx, cy]) => {
      for (let i = 0; i < 3; i++) {
        const ang = r() * Math.PI * 2, rad = 25 + r() * 65;
        seats.push({
          x: Math.max(55, Math.min(665, cx + Math.cos(ang) * rad * 1.4)),
          y: Math.max(500, Math.min(1000, cy + Math.sin(ang) * rad * .8)),
          tilt: (r() - .5) * .35, guest: null, color: STOOL_COLORS[Math.floor(r() * 4)],
        });
      }
    });
  })();
  const QUEUE_SPOTS = Array.from({ length: 8 }, (_, i) => ({ x: W - 60 - i * 48, y: 455 + (i % 2) * 14, guest: null }));

  // ---------- Trạng thái ----------
  const guests = new Map();       // id -> guest
  const orders = [];              // {gid, emoji, vip}
  const owner = { x: OWNER_HOME.x, y: OWNER_HOME.y, state: 'idle', carry: null, order: null, say: null, wp: [] };
  const bikes = [];
  let nextBike = 4;

  const now = () => performance.now() / 1000;
  const rand = (a, b) => a + Math.random() * (b - a);
  const imgCache = new Map();
  function avatarOf(url) {
    if (!url) return null;
    if (!imgCache.has(url)) { const im = new Image(); im.src = url; imgCache.set(url, im); }
    const im = imgCache.get(url);
    return im.complete && im.naturalWidth ? im : null;
  }
  const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f'];

  // ---------- Sự kiện ----------
  function ensureGuest(user) {
    let g = guests.get(user.id);
    if (g) {
      if (user.avatar && !g.avatarUrl) g.avatarUrl = user.avatar;
      return g;
    }
    g = {
      id: user.id, name: (user.name || 'Khách').slice(0, 16), avatarUrl: user.avatar || '',
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      x: ENTRANCE.x, y: ENTRANCE.y + rand(-15, 15), state: 'walkin', target: null,
      seat: null, spot: null, lastActive: now(), waitSince: now(),
      bubble: null, item: null, vip: false, phase: Math.random() * 6,
    };
    guests.set(g.id, g);
    assignPlace(g);
    return g;
  }

  function assignPlace(g) {
    const free = seats.filter(s => !s.guest);
    if (free.length) {
      const s = free[Math.floor(Math.random() * free.length)];
      s.guest = g; g.seat = s; g.target = s; g.state = 'walkin';
      return;
    }
    const spot = QUEUE_SPOTS.find(p => !p.guest);
    if (spot) { spot.guest = g; g.spot = spot; g.target = spot; g.state = 'waiting'; g.waitSince = now(); return; }
    // Hết cả chỗ chờ: khách bỏ qua
    guests.delete(g.id);
  }

  function parseCommand(text) {
    const m = /^\s*!(\S+)/.exec(text || '');
    if (!m) return null;
    const cmd = m[1].toLowerCase();
    return Object.keys(cfg.menu).find(k => k === cmd || (cfg.menu[k].commands || []).includes(cmd)) || null;
  }

  function itemForGift(name, diamonds) {
    if (cfg.giftMap[name]) return cfg.giftMap[name];
    let pick = null;
    for (const t of cfg.giftTiers) if (diamonds >= t.minDiamonds) pick = t.item;
    return pick || Object.keys(cfg.menu)[0];
  }

  function order(g, itemKey, vip) {
    const it = cfg.menu[itemKey];
    if (!it) return;
    const keys = vip ? Object.keys(cfg.menu).slice(0, 4) : [itemKey];   // VIP: mang cả bàn nhiều món
    const secs = vip ? 25 : it.drinkSeconds;
    orders.push({ gid: g.id, keys, secs });
  }

  function handleEvent(ev) {
    if (ev.type === 'status') { document.getElementById('status').textContent = ev.text; return; }
    if (!ev.user) return;
    const g = ensureGuest(ev.user);
    if (!g) return;
    if (ev.type !== 'join') g.lastActive = now();
    if (ev.type === 'chat') {
      g.bubble = { text: (ev.text || '').slice(0, 40), until: now() + 6 };
      const key = parseCommand(ev.text);
      if (key) order(g, key, false);
    } else if (ev.type === 'like') {
      g.sip = now() + 1.2;
    } else if (ev.type === 'gift') {
      const total = (ev.diamonds || 1) * (ev.count || 1);
      const vip = total >= cfg.vipDiamonds;
      if (vip) g.vip = true;
      order(g, itemForGift(ev.giftName, ev.diamonds || 1), vip);
    }
  }

  // ---------- WebSocket tới server ----------
  function connectWS() {
    const ws = new WebSocket(`ws://${location.host}`);
    ws.onmessage = (m) => { try { handleEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };
    ws.onclose = () => setTimeout(connectWS, 2000);
  }
  connectWS();

  // ---------- Cập nhật ----------
  function moveToward(o, tx, ty, speed, dt) {
    const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const step = Math.min(d, speed * dt);
    o.x += dx / d * step; o.y += dy / d * step;
    o.facing = dx >= 0 ? 1 : -1;
    return d - step < 2;
  }

  function leave(g) {
    if (g.seat) { g.seat.guest = null; g.seat = null; }
    if (g.spot) { g.spot.guest = null; g.spot = null; }
    g.state = 'walkout'; g.target = ENTRANCE; g.item = null;
    g.bubble = { text: 'Tính tiền! Đi nhé 👋', until: now() + 3 };
    // Có ghế trống thì người đang chờ vào ngồi
    const nextG = [...guests.values()].filter(x => x.state === 'waiting' || x.state === 'queued').sort((a, b) => a.waitSince - b.waitSince)[0];
    if (nextG) {
      const free = seats.filter(s => !s.guest);
      if (free.length) {
        const s = free[Math.floor(Math.random() * free.length)];
        nextG.spot.guest = null; nextG.spot = null;
        s.guest = nextG; nextG.seat = s; nextG.target = s; nextG.state = 'walkin';
      }
    }
  }

  function update(dt) {
    const t = now();
    for (const g of [...guests.values()]) {
      g.phase += dt * 6;
      if (g.bubble && g.bubble.until < t) g.bubble = null;
      if (g.item && g.item.until < t) g.item = null;
      if (g.state === 'walkin' || g.state === 'waiting') {
        if (moveToward(g, g.target.x, g.target.y, 95, dt)) g.state = g.seat ? 'seated' : 'queued';
      } else if (g.state === 'seated' || g.state === 'queued') {
        const limit = g.state === 'queued' ? cfg.waitSeconds : cfg.idleSeconds;
        const since = g.state === 'queued' ? Math.max(g.lastActive, g.waitSince) : g.lastActive;
        if (t - since > limit && !g.item) leave(g);
      } else if (g.state === 'walkout') {
        if (moveToward(g, ENTRANCE.x, ENTRANCE.y, 110, dt)) guests.delete(g.id);
      }
    }

    // Chủ quán xử lý từng đơn
    if (owner.state === 'idle') {
      while (orders.length) {
        const o = orders[0];
        const g = guests.get(o.gid);
        if (!g || g.state === 'walkout') { orders.shift(); continue; }
        if (g.state !== 'seated') break;   // chưa ngồi: chờ
        owner.order = orders.shift(); owner.carry = owner.order.keys; owner.state = 'deliver';
        owner.wp = DOOR_OUT.slice();
        break;
      }
    } else if (owner.state === 'deliver') {
      const g = guests.get(owner.order.gid);
      if (!g || !g.seat) { owner.carry = null; owner.state = 'return'; owner.wp = [...DOOR_OUT].reverse(); }
      else if (owner.wp.length) { if (moveToward(owner, owner.wp[0].x, owner.wp[0].y, 170, dt)) owner.wp.shift(); }
      else if (moveToward(owner, g.seat.x + 34, g.seat.y + 6, 170, dt)) {
        g.item = { keys: owner.order.keys, until: t + owner.order.secs };
        g.lastActive = t;
        owner.say = { text: 'Của em đây!', until: t + 2 };
        owner.carry = null; owner.state = 'return'; owner.wp = [...DOOR_OUT].reverse();
      }
    } else if (owner.state === 'return') {
      if (owner.wp.length) { if (moveToward(owner, owner.wp[0].x, owner.wp[0].y, 170, dt)) owner.wp.shift(); }
      else if (moveToward(owner, OWNER_HOME.x, OWNER_HOME.y, 170, dt)) owner.state = 'idle';
    }
    if (owner.say && owner.say.until < t) owner.say = null;

    // Xe máy chạy ngang
    nextBike -= dt;
    if (nextBike <= 0) { const dir = Math.random() < .5 ? 1 : -1; bikes.push({ x: dir > 0 ? -60 : W + 60, y: rand(1225, 1245), dir, speed: rand(160, 260) }); nextBike = rand(7, 18); }
    for (const b of bikes) b.x += b.dir * b.speed * dt;
    for (let i = bikes.length - 1; i >= 0; i--) if (bikes[i].x < -120 || bikes[i].x > W + 120) bikes.splice(i, 1);
  }

  // ---------- Vẽ ----------
  function emoji(ch, x, y, size, flip) {
    ctx.save();
    ctx.globalAlpha = 1; ctx.fillStyle = '#000';   // emoji màu bị ảnh hưởng bởi độ trong suốt của màu tô cũ => luôn đặt lại cho rõ nét
    ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  // Hình món ăn (ảnh thật, cắt tròn). keys: 1 món hoặc nhiều món (VIP) xếp thành hàng nhỏ.
  const foodImgs = {};
  function foodImage(key) {
    const m = cfg.menu[key];
    if (!m || !m.image) return null;
    if (!foodImgs[key]) { const im = new Image(); im.src = m.image; foodImgs[key] = im; }
    const im = foodImgs[key];
    return im.complete && im.naturalWidth ? im : null;
  }
  function drawFood(keys, x, y, size) {
    const d = keys.length === 1 ? size : size * .62, step = d * .85;
    keys.forEach((k, i) => {
      const cx = x + (i - (keys.length - 1) / 2) * step, r = d / 2, im = foodImage(k);
      if (im) {
        ctx.save(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(cx, y, r, 0, 7); ctx.clip(); ctx.drawImage(im, cx - r, y - r, d, d); ctx.restore();
        ctx.beginPath(); ctx.arc(cx, y, r, 0, 7); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      } else emoji(cfg.menu[k]?.emoji || '🍵', cx, y, d * .9);
    });
  }
  function bubble(text, x, y) {
    ctx.save();
    ctx.font = '15px "Segoe UI", sans-serif';
    const w = Math.min(ctx.measureText(text).width + 18, 260), h = 26;
    x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));   // không để bong bóng tràn mép khung
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y + 8); ctx.lineTo(x + 6, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - h / 2, 250);
    ctx.restore();
  }
  function label(text, x, y, vip) {
    ctx.save();
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = vip ? 'rgba(180,130,0,.9)' : 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 9, w, 18, 9); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  function drawHead(g, x, y, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#f5d0a9'; ctx.fill();
    ctx.clip();
    const im = avatarOf(g.avatarUrl);
    if (im) ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
    else emoji('🙂', x, y + 1, r * 1.6);
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = g.vip ? 4 : 2.5; ctx.strokeStyle = g.vip ? '#ffc107' : '#fff'; ctx.stroke();
  }

  function drawGuest(g) {
    const sitting = g.state === 'seated';
    const walking = !sitting && g.state !== 'queued';
    const bob = walking ? Math.abs(Math.sin(g.phase)) * 4 : 0;
    const x = g.x, y = g.y - bob;
    const lift = sitting ? 14 : 0;
    // thân + chân
    ctx.fillStyle = g.color;
    ctx.beginPath(); ctx.roundRect(x - 14, y - 36 + lift, 28, 28, 8); ctx.fill();
    if (!sitting) { ctx.fillStyle = '#37474f'; ctx.fillRect(x - 10, y - 10, 8, 12 + (walking ? Math.sin(g.phase) * 3 : 0)); ctx.fillRect(x + 2, y - 10, 8, 12 - (walking ? Math.sin(g.phase) * 3 : 0)); }
    // đầu (ảnh đại diện)
    const sip = (g.item || (g.sip && g.sip > now())) && sitting ? Math.sin(now() * 5) * 2 : 0;
    drawHead(g, x, y - 58 + lift + sip, 22);
    if (g.vip) emoji('👑', x, y - 86 + lift, 22);
    // món đang dùng
    if (sitting && g.item) drawFood(g.item.keys, x + (g.item.keys.length > 1 ? 40 : 34), y - 4 + lift * .4, 46);
    else if (sitting && g.sip && g.sip > now()) drawFood(['trada'], x + 32, y - 6 + lift * .4, 38);
    label(g.name, x, y + 18, g.vip);
    if (g.bubble) bubble(g.bubble.text, x, y - 92 + lift - (g.vip ? 14 : 0));
  }

  function drawOwner() {
    const o = owner;
    const walking = o.state !== 'idle';
    const bob = walking ? Math.abs(Math.sin(now() * 12)) * 4 : 0;
    emoji('👩', o.x, o.y - 38 - bob, 52);
    if (o.carry) drawFood(o.carry, o.x + (o.carry.length > 1 ? 44 : 36), o.y - 48 - bob, 46);
    if (o.y > 400) label('Chủ quán', o.x, o.y + 18, false);
    if (o.say) bubble(o.say.text, o.x, o.y - 84);
  }

  // ---- Bàn gỗ thấp + ghế nhựa thấp (kiểu quán vỉa hè Hà Nội) ----
  function drawTable(tb) {
    const { x, y } = tb;
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x, y + 30, 82, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#3d1f0f'; ctx.fillRect(x - 60, y + 6, 7, 24); ctx.fillRect(x + 53, y + 6, 7, 24);
    ctx.fillStyle = '#5a2f18'; ctx.fillRect(x - 66, y, 132, 9);
    ctx.fillStyle = '#7b4527'; ctx.beginPath(); ctx.moveTo(x - 56, y - 24); ctx.lineTo(x + 56, y - 24); ctx.lineTo(x + 66, y); ctx.lineTo(x - 66, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 56, y - 24); ctx.lineTo(x + 56, y - 24); ctx.stroke();
  }
  function drawStool(s) {
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(s.x, s.y + 16, 18, 5, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(s.x, s.y + 15); ctx.rotate(s.tilt || 0); ctx.translate(-s.x, -(s.y + 15));   // ghế hơi nghiêng cho tự nhiên
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.moveTo(s.x - 15, s.y - 2); ctx.lineTo(s.x + 15, s.y - 2); ctx.lineTo(s.x + 12, s.y + 15); ctx.lineTo(s.x - 12, s.y + 15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(s.x - 9, s.y + 5, 5, 6); ctx.fillRect(s.x + 4, s.y + 5, 5, 6);
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.ellipse(s.x, s.y - 3, 16, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.ellipse(s.x, s.y - 4, 11, 3.5, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  // ---- Nền: tường vàng, quầy trà đá, vỉa hè, tán cây (vẽ 1 lần rồi lưu lại) ----
  function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function sign(x, y, w, h, bg, lines) {
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach(([t, size, color, dy]) => { ctx.font = `bold ${size}px "Segoe UI", sans-serif`; ctx.fillStyle = color; ctx.fillText(t, x + w / 2, y + dy, w - 8); });
  }
  function paintBackground() {
    const r = rng(11);
    const W = 1300;                                   // bề rộng "tường" trong hệ tọa độ đã thu nhỏ (che kín khung dọc)
    const CW = canvas.width, CH = canvas.height;
    ctx.fillStyle = '#e6c04a'; ctx.fillRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(0, 50); ctx.scale(.88, .88);   // phần quầy/tường/cây vẽ theo khổ ngang cũ rồi thu nhỏ vào khung dọc
    // tường vàng cũ
    ctx.fillStyle = '#e6c04a'; ctx.fillRect(0, 0, W, 400);
    for (let i = 0; i < 150; i++) { ctx.fillStyle = r() < .5 ? `rgba(150,110,20,${.05 + r() * .08})` : `rgba(255,236,150,${.05 + r() * .08})`; ctx.beginPath(); ctx.ellipse(r() * W, r() * 400, 20 + r() * 60, 10 + r() * 30, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#d4a93a'; ctx.fillRect(0, 0, W, 26); ctx.fillStyle = '#c79a2c'; ctx.fillRect(0, 26, W, 5);
    ctx.fillStyle = '#c9a23a'; ctx.fillRect(0, 372, W, 28); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, 396, W, 4);
    // cửa sổ vòm có cánh xanh
    for (const wx of [820, 1090]) {
      ctx.fillStyle = '#5c4a1e'; ctx.beginPath(); ctx.roundRect(wx, 225, 130, 155, [65, 65, 0, 0]); ctx.fill();
      ctx.fillStyle = '#2f6f4f'; ctx.fillRect(wx + 8, 262, 54, 112); ctx.fillRect(wx + 68, 262, 54, 112);
      ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 2;
      for (let k = 0; k < 7; k++) { const yy = 270 + k * 15; ctx.beginPath(); ctx.moveTo(wx + 8, yy); ctx.lineTo(wx + 62, yy); ctx.moveTo(wx + 68, yy); ctx.lineTo(wx + 122, yy); ctx.stroke(); }
    }
    // ống nước + biển đỏ + biển menu
    ctx.fillStyle = '#7d5b3b'; ctx.fillRect(802, 90, 9, 310);
    sign(160, 255, 52, 145, '#c8102e', [['SỬA CHỮA', 11, '#fff', 26], ['BẢO DƯỠNG', 11, '#fff', 46], ['XE MÁY', 14, '#ffe082', 72], ['24/24', 16, '#fff', 100]]);
    sign(716, 238, 78, 162, '#f6f3e8', [['TRÀ', 15, '#2e7d32', 18], ['CHANH', 15, '#2e7d32', 36], ['MƠ MUỐI', 12, '#c62828', 58], ['Cafe', 26, '#3e2723', 88], ['SẤU ĐÁ', 13, '#c62828', 118], ['ME ĐÁ', 13, '#c62828', 136], ['NƯỚC ÉP', 11, '#2e7d32', 153]]);

    // quầy trà đá: mái tôn xanh + biển vải + ô cửa bán hàng
    ctx.fillStyle = '#2a1d14'; ctx.fillRect(262, 240, 438, 112);              // ô cửa
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(262, 240, 438, 20);
    ctx.fillStyle = '#2a1d14'; ctx.fillRect(650, 240, 50, 160);               // cửa ra vào bên phải
    for (let x = 276; x < 640; x += 15) { ctx.fillStyle = (x / 15) % 2 ? '#ff7ad9' : '#6aa8ff'; ctx.beginPath(); ctx.arc(x, 252, 2.6, 0, 7); ctx.fill(); }
    for (let k = 0; k < 6; k++) { ctx.fillStyle = '#e8c14a'; ctx.fillRect(292 + k * 15, 258, 12, 34); ctx.fillStyle = '#c62828'; ctx.fillRect(292 + k * 15, 268, 12, 5); }
    ctx.fillStyle = 'rgba(190,225,205,.35)'; ctx.fillRect(560, 282, 82, 54);   // tủ kính
    for (let k = 0; k < 9; k++) { ctx.fillStyle = ['#e53935', '#43a047', '#fdd835', '#1e88e5'][k % 4]; ctx.fillRect(566 + (k % 5) * 15, 288 + Math.floor(k / 5) * 22, 11, 18); }
    ctx.fillStyle = '#7fb59a'; ctx.fillRect(255, 336, 400, 18); ctx.fillStyle = '#bfe0cf'; ctx.fillRect(255, 336, 400, 4); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(255, 352, 400, 3);
    for (const jx of [300, 330, 360]) { ctx.fillStyle = '#a5651a'; ctx.fillRect(jx, 306, 20, 30); ctx.fillStyle = '#3e2723'; ctx.fillRect(jx - 1, 302, 22, 5); }
    ctx.fillStyle = '#4a9a73'; ctx.beginPath(); ctx.moveTo(205, 180); ctx.lineTo(715, 180); ctx.lineTo(668, 96); ctx.lineTo(252, 96); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,50,30,.3)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 34; i++) { const t = i / 34; ctx.beginPath(); ctx.moveTo(252 + t * 416, 96); ctx.lineTo(205 + t * 510, 180); ctx.stroke(); }
    ctx.fillStyle = '#2d6a4f'; ctx.fillRect(205, 180, 510, 6);
    ctx.fillStyle = '#f3ecd9'; ctx.fillRect(235, 186, 450, 38);
    for (let x = 244; x < 685; x += 18) { ctx.beginPath(); ctx.arc(x, 224, 9, 0, Math.PI); ctx.fill(); }
    ctx.fillStyle = '#4a2c1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 32px Georgia, "Times New Roman", serif'; ctx.fillText('TRÀ ĐÁ PHỐ CỔ', 462, 205, 380);
    ctx.font = 'bold 11px "Segoe UI", sans-serif'; ctx.fillStyle = '#6b4a33'; ctx.fillText('NƯỚC CHÈ • HƯỚNG DƯƠNG • KẸO LẠC • NHÂN TRẦN', 462, 222, 380);

    // gốc cây + cành
    ctx.fillStyle = '#5b4636';
    ctx.beginPath(); ctx.moveTo(12, 436); ctx.lineTo(108, 436); ctx.lineTo(90, 300); ctx.lineTo(82, 150); ctx.lineTo(46, 150); ctx.lineTo(38, 300); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5b4636'; ctx.lineCap = 'round'; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(80, 190); ctx.lineTo(240, 100); ctx.stroke();
    ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(70, 250); ctx.lineTo(190, 160); ctx.stroke(); ctx.lineCap = 'butt';

    ctx.restore();

    // vỉa hè + lề đường + đường (tọa độ thật của khung dọc)
    const top = 402, curb = CH - 110;
    ctx.fillStyle = '#cfc8b8'; ctx.fillRect(0, top, CW, curb - top);
    ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.lineWidth = 2;
    for (let x = 0; x < CW; x += 90) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, curb); ctx.stroke(); }
    for (let y = top + 55; y < curb; y += 110) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }
    for (let i = 0; i < 90; i++) { ctx.fillStyle = r() < .6 ? 'rgba(60,50,20,.10)' : 'rgba(255,255,225,.12)'; ctx.beginPath(); ctx.ellipse(r() * CW, top + 5 + r() * (curb - top - 10), 14 + r() * 40, 6 + r() * 14, r(), 0, 7); ctx.fill(); }
    ctx.fillStyle = '#a8a398'; ctx.fillRect(0, curb, CW, 12); ctx.fillStyle = '#c2bdb2'; ctx.fillRect(0, curb, CW, 3);
    ctx.fillStyle = '#4a5055'; ctx.fillRect(0, curb + 12, CW, CH - curb - 12);

    // tán lá che phía trên bên trái
    ctx.save(); ctx.translate(0, 50); ctx.scale(.88, .88);
    const greens = ['#3f7d3a', '#4c8f43', '#2f6b32', '#5da04c', '#2a5e2e'];
    for (let i = 0; i < 150; i++) {
      const x = r() * 790, deep = x < 210;
      const y = r() * (deep ? 235 : 100), rad = 26 + r() * 30;
      ctx.globalAlpha = .93; ctx.fillStyle = greens[Math.floor(r() * greens.length)];
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 70; i++) { ctx.globalAlpha = .45; ctx.fillStyle = '#d6ec8f'; ctx.beginPath(); ctx.arc(r() * 790, r() * 120, 3 + r() * 7, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  let bgCache = null;
  function drawBackground() {
    if (!SOLID_BG) return;
    if (!bgCache) {
      bgCache = document.createElement('canvas'); bgCache.width = W; bgCache.height = H;
      const main = ctx; ctx = bgCache.getContext('2d'); paintBackground(); ctx = main;
    }
    ctx.drawImage(bgCache, 0, 0);
    // Ảnh món đặt trên quầy và logo biển hiệu: vẽ riêng mỗi khung để chắc chắn ảnh đã tải (cùng phép thu nhỏ với phần quầy)
    ctx.save(); ctx.translate(0, 50); ctx.scale(.88, .88);
    drawFood(['trada'], 262, 205, 30);
    drawFood(['nhantran'], 425, 318, 38); drawFood(['trada'], 475, 318, 38); drawFood(['che'], 525, 318, 38);
    ctx.restore();
  }

  function drawLegend() {
    if (!SHOW_LEGEND) return;
    const items = Object.values(cfg.menu);
    const sitting = [...guests.values()].filter(g => g.state === 'seated').length;
    const waiting = [...guests.values()].filter(g => g.state === 'queued' || g.state === 'waiting').length;
    // Bảng gọn nằm ngay dưới khu ghế (khung dọc), thực đơn chia 2 cột
    const rows = Math.ceil(items.length / 2);
    const w = W - 28, x0 = 14, y0 = 1030, lh = 24, h = 20 + (rows + 3) * lh;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const font = (b) => `${b ? 'bold ' : ''}17px "Segoe UI Emoji","Segoe UI", sans-serif`;
    ctx.font = font(true); ctx.fillText('Gọi món: gõ lệnh vào chat', x0 + 16, y0 + 10 + lh / 2);
    ctx.font = font(false);
    Object.keys(cfg.menu).forEach((k, i) => {
      const m = cfg.menu[k], ix = x0 + 16 + (i % 2) * (w / 2), iy = y0 + 10 + lh * (1 + Math.floor(i / 2)) + lh / 2;
      drawFood([k], ix + 13, iy, 26);
      ctx.fillStyle = '#fff'; ctx.font = font(false); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${m.label}: !${m.commands[0]}`, ix + 34, iy, w / 2 - 54);
    });
    ctx.fillText('Tặng quà = món đặc biệt • Quà lớn = VIP 👑', x0 + 16, y0 + 10 + lh * (rows + 1) + lh / 2, w - 30);
    ctx.font = font(true);
    ctx.fillText(`Đang ngồi: ${sitting}/${seats.length}${waiting ? `  • Chờ: ${waiting}` : ''}`, x0 + 16, y0 + 10 + lh * (rows + 2) + lh / 2);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    for (const b of bikes) emoji('🛵', b.x, b.y, 54, b.dir > 0);
    const items = [];
    seats.forEach(s => items.push({ y: s.y - 1, draw: () => drawStool(s) }));
    for (const g of guests.values()) items.push({ y: g.state === 'seated' ? g.y : g.y + 1, draw: () => drawGuest(g) });
    items.push({ y: owner.y, draw: drawOwner });
    items.sort((a, b) => a.y - b.y).forEach(i => i.draw());
    drawLegend();
  }

  Object.keys(cfg.menu).forEach(foodImage);   // tải sẵn ảnh món ăn
  let last = now();
  function frame() {
    const t = now(); const dt = Math.min(t - last, 0.1); last = t;
    update(dt); render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Bảng giả lập ----------
  const NAMES = ['Minh', 'Lan', 'Tuấn', 'Hoa', 'Bác Ba', 'Cô Mai', 'Chú Tư', 'Nam', 'Thảo', 'Hùng', 'Linh', 'Đạt'];
  let simCount = 0;
  const simUser = () => { const i = simCount++; return { id: `sim${i}`, name: `${NAMES[i % NAMES.length]} ${i}`, avatar: '' }; };
  const randomGuest = () => { const arr = [...guests.values()].filter(g => g.state === 'seated'); return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; };
  const asUser = (g) => ({ id: g.id, name: g.name, avatar: g.avatarUrl });
  const el = (id) => document.getElementById(id);

  el('bJoin').onclick = () => handleEvent({ type: 'join', user: simUser() });
  el('bJoin10').onclick = () => { for (let i = 0; i < 10; i++) setTimeout(() => handleEvent({ type: 'join', user: simUser() }), i * 400); };
  el('bChat').onclick = () => { const g = randomGuest(); if (g) handleEvent({ type: 'chat', user: asUser(g), text: el('chatText').value }); };
  el('bLike').onclick = () => { const g = randomGuest(); if (g) handleEvent({ type: 'like', user: asUser(g) }); };
  el('bGift').onclick = () => { const g = randomGuest(); if (g) handleEvent({ type: 'gift', user: asUser(g), giftName: 'Test', diamonds: +el('gDia').value, count: 1 }); };
  if (params.get('demo') === '1') {   // tự động cho vài khách vào và gọi món
    const keys = Object.keys(cfg.menu);
    for (let i = 0; i < 7; i++) setTimeout(() => {
      const u = simUser(); handleEvent({ type: 'join', user: u });
      setTimeout(() => handleEvent({ type: 'chat', user: u, text: `!${cfg.menu[keys[i % keys.length]].commands[0]} cho em ly nhé` }), 3000);
    }, i * 500);
    setTimeout(() => handleEvent({ type: 'gift', user: simUser(), giftName: 'Lion', diamonds: 100, count: 1 }), 1500);
    const ff = +params.get('ff') || 0;   // ?ff=giây: tua nhanh để kiểm tra
    if (ff) setTimeout(() => { for (let i = 0; i < ff * 20; i++) update(0.05); }, 6000);
  }
  for (const [k, m] of Object.entries(cfg.menu)) {
    const b = document.createElement('button'); b.textContent = `${m.emoji} !${m.commands[0]}`;
    b.onclick = () => { const g = randomGuest(); if (g) handleEvent({ type: 'chat', user: asUser(g), text: `!${m.commands[0]}` }); };
    el('menuBtns').appendChild(b);
  }
})();
