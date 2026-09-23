require("dotenv").config();

const crypto = require("node:crypto");
const express = require("express");

const app = express();
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (!adminPassword) console.warn("WARNING: ADMIN_PASSWORD belum diatur. Top up admin akan ditolak.");

// Replace these Maps with a database before deploying multiple server instances.
const balances = new Map();
const orders = new Map();
const rooms = new Map();

app.use(express.json());
app.use(express.static(__dirname));

function roomView(room) {
  return { code: room.code, rounds: room.rounds, currentRound: room.currentRound, currentPlayer: room.currentPlayer, started: room.started, finished: room.finished, players: room.players.map(({ id, name, score }) => ({ id, name, score })) , lastRoll: room.lastRoll };
}

app.post("/api/rooms", (request, response) => {
  const { playerId, name, rounds = 5 } = request.body || {};
  if (!playerId || !name) return response.status(400).json({ error: "Nama pemain wajib diisi." });
  let code;
  do code = crypto.randomBytes(3).toString("hex").toUpperCase(); while (rooms.has(code));
  const room = { code, rounds: [3, 5, 7].includes(Number(rounds)) ? Number(rounds) : 5, currentRound: 1, currentPlayer: 0, started: false, finished: false, players: [{ id: String(playerId), name: String(name).slice(0, 16), score: 0 }], lastRoll: null };
  rooms.set(code, room);
  response.json({ room: roomView(room), playerId: String(playerId) });
});

app.post("/api/rooms/:code/join", (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  const { playerId, name } = request.body || {};
  if (!room) return response.status(404).json({ error: "Room tidak ditemukan." });
  if (room.started) return response.status(409).json({ error: "Permainan sudah dimulai." });
  if (room.players.length >= 6) return response.status(409).json({ error: "Room sudah penuh." });
  if (!playerId || !name) return response.status(400).json({ error: "Nama pemain wajib diisi." });
  room.players.push({ id: String(playerId), name: String(name).slice(0, 16), score: 0 });
  response.json({ room: roomView(room), playerId: String(playerId) });
});

app.get("/api/rooms/:code", (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  if (!room) return response.status(404).json({ error: "Room tidak ditemukan." });
  response.json(roomView(room));
});

app.post("/api/rooms/:code/start", (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  if (!room || room.players.length < 2) return response.status(400).json({ error: "Minimal 2 pemain diperlukan." });
  room.started = true;
  response.json(roomView(room));
});

app.post("/api/rooms/:code/roll", (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  const { playerId } = request.body || {};
  if (!room) return response.status(404).json({ error: "Room tidak ditemukan." });
  if (!room.started || room.finished) return response.status(400).json({ error: "Permainan belum dimulai atau sudah selesai." });
  const player = room.players[room.currentPlayer];
  if (!player || player.id !== playerId) return response.status(403).json({ error: "Belum giliran kamu." });
  const first = Math.floor(Math.random() * 6) + 1;
  const second = Math.floor(Math.random() * 6) + 1;
  const total = first + second + (first === second ? 2 : 0);
  player.score += total;
  room.lastRoll = { playerId, player: player.name, first, second, total, at: Date.now() };
  room.currentPlayer += 1;
  if (room.currentPlayer >= room.players.length) { room.currentPlayer = 0; room.currentRound += 1; }
  if (room.currentRound > room.rounds) room.finished = true;
  response.json(roomView(room));
});

app.get("/api/balance/:playerId", (request, response) => {
  response.json({ tokens: balances.get(request.params.playerId) || 0 });
});

app.post("/api/admin/topup", (request, response) => {
  const { password, playerId, tokens } = request.body || {};
  const amount = Number(tokens);
  if (!adminPassword) return response.status(503).json({ error: "ADMIN_PASSWORD belum diatur di file .env server." });
  if (password !== adminPassword) return response.status(403).json({ error: "Password admin salah." });
  if (!playerId || !Number.isInteger(amount) || amount < 1 || amount > 1000000) return response.status(400).json({ error: "ID pemain atau jumlah token tidak valid." });
  const id = String(playerId).slice(0, 80);
  const balance = (balances.get(id) || 0) + amount;
  balances.set(id, balance);
  orders.set(`MANUAL-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, { playerId: id, tokens: amount, status: "manual-topup", createdAt: new Date().toISOString() });
  response.json({ playerId: id, tokens: balance });
});

app.listen(port, () => console.log(`ROLL/TWO online server running at http://localhost:${port}`));
