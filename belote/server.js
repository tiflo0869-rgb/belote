'use strict';
/**
 * Serveur de belote multijoueur — AUCUNE dépendance (Node.js 18+).
 * Temps réel via Server-Sent Events (GET /events) + actions via POST /api/*.
 * Lancer :  node server.js   puis ouvrir http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Game, botAct } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TARGETS = [301, 501, 701, 1000];
const BOT_NAMES = ['Robot Léa', 'Robot Max', 'Robot Zoé', 'Robot Hugo'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const rooms = new Map();

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const newId = () => crypto.randomBytes(12).toString('hex');
const cleanName = (n) => String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Joueur';

function genCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += L[crypto.randomInt(L.length)];
  } while (rooms.has(c));
  return c;
}

const seatOf = (room, id) => room.seats.findIndex((s) => s && s.id === id);
const humans = (room) => room.seats.filter((s) => s && !s.bot);

function newHuman(name) { return { id: newId(), name, bot: false, clients: new Set() }; }
function newBot(room) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || 'Robot ' + crypto.randomInt(100);
  return { id: newId(), name, bot: true, clients: new Set() };
}

function uniqueName(room, name) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  if (!used.has(name)) return name;
  for (let i = 2; i < 10; i++) if (!used.has(`${name} ${i}`)) return `${name} ${i}`.slice(0, 18);
  return name;
}

/* ------------------------------ Vues & diffusion ------------------------------ */

function viewFor(room, seat) {
  const v = {
    code: room.code,
    you: seat,
    host: room.seats.findIndex((s) => s && s.id === room.hostId),
    target: room.target,
    started: !!room.game,
    seats: room.seats.map((s) => (s ? { name: s.name, bot: s.bot, online: s.bot || s.clients.size > 0 } : null)),
  };
  if (room.game) v.g = room.game.publicState(seat);
  return v;
}

function send(res, obj) {
  try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch { /* connexion fermée */ }
}

function broadcast(room) {
  room.seats.forEach((s, i) => {
    if (!s || s.bot) return;
    for (const res of s.clients) send(res, viewFor(room, i));
  });
}

function closeClients(s) {
  for (const res of s.clients) { try { res.end(); } catch { /* ignore */ } }
  s.clients.clear();
}

function destroyRoom(room) {
  clearTimeout(room.timer);
  for (const s of room.seats) if (s) closeClients(s);
  rooms.delete(room.code);
}

/* ------------------------------ Robots & minuteries ------------------------------ */

function schedule(room) {
  clearTimeout(room.timer);
  room.timer = null;
  const g = room.game;
  if (!g) return;
  if (g.phase === 'play' && g.trick.length === 4) {
    room.timer = setTimeout(() => { g.resolveTrick(); afterChange(room); }, 1500);
    return;
  }
  const inPlay = g.phase === 'bid1' || g.phase === 'bid2' || g.phase === 'play';
  if (inPlay && room.seats[g.turn] && room.seats[g.turn].bot) {
    room.timer = setTimeout(() => {
      try {
        const seat = g.turn;
        const a = botAct(g, seat);
        if (a.type === 'play') g.play(seat, a.card); else g.bid(seat, a);
      } catch (e) { console.error('Erreur robot :', e.message); }
      afterChange(room);
    }, 800 + Math.random() * 600);
  }
}

function afterChange(room) {
  if (!rooms.has(room.code)) return;
  room.last = Date.now();
  broadcast(room);
  schedule(room);
}

/* ------------------------------ API ------------------------------ */

function apiCreate(body) {
  const code = genCode();
  const me = newHuman(cleanName(body.name));
  const room = {
    code, seats: [me, null, null, null], hostId: me.id, target: 501, game: null, timer: null, last: Date.now(),
  };
  rooms.set(code, room);
  return { room, out: { room: code, id: me.id } };
}

function apiJoin(body) {
  const room = rooms.get(String(body.room || '').toUpperCase().trim());
  if (!room) throw new HttpError(404, 'Code de table inconnu.');
  if (room.game) throw new HttpError(400, 'La partie a déjà commencé.');
  const idx = room.seats.findIndex((s) => !s);
  if (idx < 0) throw new HttpError(400, 'La table est pleine.');
  const me = newHuman(uniqueName(room, cleanName(body.name)));
  room.seats[idx] = me;
  return { room, out: { room: room.code, id: me.id } };
}

function removeSeat(room, i) {
  const s = room.seats[i];
  closeClients(s);
  room.seats[i] = null;
}

function leave(room, seat) {
  const s = room.seats[seat];
  const wasHost = room.hostId === s.id;
  closeClients(s);
  if (!room.game) {
    room.seats[seat] = null;
  } else {
    s.bot = true;           // un robot prend la place pour que la partie continue
    s.name = s.name + ' (robot)';
    s.id = newId();
  }
  if (!humans(room).length) { destroyRoom(room); return false; }
  if (wasHost) room.hostId = humans(room)[0].id;
  return true;
}

function apiAction(body) {
  const room = rooms.get(String(body.room || '').toUpperCase());
  if (!room) throw new HttpError(404, 'Table introuvable.');
  const seat = seatOf(room, body.id);
  if (seat < 0) throw new HttpError(403, 'Vous ne faites pas partie de cette table.');
  const isHost = room.hostId === body.id;
  const g = room.game;
  const needLobby = () => { if (g) throw new HttpError(400, 'La partie a déjà commencé.'); };
  const needHost = () => { if (!isHost) throw new HttpError(403, 'Seul l’hôte peut faire ça.'); };
  const needGame = () => { if (!g) throw new HttpError(400, 'La partie n’a pas commencé.'); };
  const target = () => {
    const i = Number(body.seat);
    if (!Number.isInteger(i) || i < 0 || i > 3) throw new HttpError(400, 'Place invalide.');
    return i;
  };

  try {
    switch (body.type) {
      case 'sit': {
        needLobby();
        const to = target();
        if (room.seats[to]) throw new HttpError(400, 'Cette place est déjà prise.');
        room.seats[to] = room.seats[seat];
        room.seats[seat] = null;
        break;
      }
      case 'addBot': {
        needLobby(); needHost();
        const to = target();
        if (room.seats[to]) throw new HttpError(400, 'Cette place est déjà prise.');
        room.seats[to] = newBot(room);
        break;
      }
      case 'fillBots': {
        needLobby(); needHost();
        for (let i = 0; i < 4; i++) if (!room.seats[i]) room.seats[i] = newBot(room);
        break;
      }
      case 'kick': {
        needLobby(); needHost();
        const to = target();
        if (!room.seats[to] || to === seat) throw new HttpError(400, 'Impossible de retirer cette place.');
        removeSeat(room, to);
        break;
      }
      case 'target': {
        needLobby(); needHost();
        const v = Number(body.value);
        if (!TARGETS.includes(v)) throw new HttpError(400, 'Objectif invalide.');
        room.target = v;
        break;
      }
      case 'start': {
        needLobby(); needHost();
        if (room.seats.some((s) => !s)) throw new HttpError(400, 'Il faut 4 joueurs (ajoutez des robots si besoin).');
        room.game = new Game({ target: room.target });
        break;
      }
      case 'pass': needGame(); g.bid(seat, { type: 'pass' }); break;
      case 'take': needGame(); g.bid(seat, { type: 'take', suit: body.suit }); break;
      case 'play': needGame(); g.play(seat, String(body.card)); break;
      case 'next': needGame(); if (g.phase === 'handEnd') g.nextHand(); break;
      case 'rematch': {
        needGame(); needHost();
        if (g.phase !== 'gameEnd') throw new HttpError(400, 'La partie n’est pas terminée.');
        room.game = null;
        break;
      }
      case 'botify': {
        needGame(); needHost();
        const to = target();
        const s = room.seats[to];
        if (!s || s.bot || to === seat || s.clients.size) throw new HttpError(400, 'Seul un joueur déconnecté peut être remplacé.');
        s.bot = true; s.name = s.name + ' (robot)'; s.id = newId();
        break;
      }
      case 'leave': {
        const alive = leave(room, seat);
        if (!alive) return { ok: true };
        break;
      }
      default:
        throw new HttpError(400, 'Action inconnue.');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, e.message);
  }
  afterChange(room);
  return { ok: true };
}

/* ------------------------------ HTTP ------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20000) { reject(new HttpError(413, 'Requête trop grande.')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, 'JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function sse(req, res, url) {
  const room = rooms.get(String(url.searchParams.get('room') || '').toUpperCase());
  const id = url.searchParams.get('id') || '';
  const seat = room ? seatOf(room, id) : -1;
  if (seat < 0) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const s = room.seats[seat];
  s.clients.add(res);
  send(res, viewFor(room, seat));
  broadcast(room);
  req.on('close', () => {
    s.clients.delete(res);
    if (rooms.has(room.code)) broadcast(room);
  });
}

function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/events') return sse(req, res, url);
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
      if (url.pathname === '/api/create') {
        const { room, out } = apiCreate(body);
        afterChange(room);
        return json(res, 200, out);
      }
      if (url.pathname === '/api/join') {
        const { room, out } = apiJoin(body);
        afterChange(room);
        return json(res, 200, out);
      }
      if (url.pathname === '/api/action') return json(res, 200, apiAction(body));
      return json(res, 404, { error: 'Inconnu.' });
    }
    if (req.method === 'GET') return serveStatic(req, res, url);
    res.writeHead(405); res.end();
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    json(res, status, { error: status === 500 ? 'Erreur du serveur.' : e.message });
  }
});

// Battement de cœur SSE + nettoyage des tables abandonnées
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let connected = 0;
    for (const s of room.seats) {
      if (!s) continue;
      for (const res of s.clients) { try { res.write(': ping\n\n'); connected++; } catch { /* ignore */ } }
    }
    if (!connected && now - room.last > 3 * 3600 * 1000) destroyRoom(room);
  }
}, 25000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Belote en ligne — serveur démarré sur le port ${PORT}\n`);
    console.log(`  Sur cet ordinateur : http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) {
        if (i.family === 'IPv4' && !i.internal) console.log(`  Sur votre réseau   : http://${i.address}:${PORT}`);
      }
    }
    console.log('');
  });
}

module.exports = { server, rooms };
