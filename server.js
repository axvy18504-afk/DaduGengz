require("dotenv").config();

const crypto = require("node:crypto");
const express = require("express");
const { createClient } = require("@vercel/kv");

const app = express();
app.disable("etag");
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (!adminPassword) console.warn("WARNING: ADMIN_PASSWORD belum diatur. Top up admin akan ditolak.");

// Vercel KV (Upstash Redis REST). Set KV_REST_API_URL and KV_REST_API_TOKEN.
// These are injected automatically when a KV/Redis store is linked in Vercel.
const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;
if (!kvUrl || !kvToken) console.warn("WARNING: KV_REST_API_URL / KV_REST_API_TOKEN belum diatur. Room dan saldo tidak akan tersimpan.");

const kv = kvUrl && kvToken ? createClient({ url: kvUrl, token: kvToken }) : null;
const ROOM_TTL_SECONDS = 60 * 60 * 6; // rooms and orders expire after 6 hours of inactivity

function requireKv() {
  if (!kv) {
    const error = new Error("Penyimpanan (Vercel KV) belum dikonfigurasi di server.");
    error.status = 503;
    throw error;
  }
  return kv;
}

app.use(express.json());
app.use("/api", (_request, response, next) => {
  response.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.set("Pragma", "no-cache");
  response.set("Expires", "0");
  next();
});
app.use(express.static(__dirname));

function roomView(room) {
  return {
    code: room.code,
    rounds: room.rounds,
    currentRound: room.currentRound,
    currentPlayer: room.currentPlayer,
    started: room.started,
    finished: room.finished,
    players: room.players.map(({ id, name, score }) => ({ id, name, score })),
    lastRoll: room.lastRoll,
  };
}

async function getRoom(code) {
  if (!code) return null;
  return requireKv().get(`room:${String(code).toUpperCase()}`);
}

async function saveRoom(room) {
  await requireKv().set(`room:${room.code}`, room, { ex: ROOM_TTL_SECONDS });
}

// Wrap async route handlers so thrown errors become clean JSON responses.
function route(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      response.status(status).json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  };
}

app.post("/api/rooms", route(async (request, response) => {
  const { playerId, name, rounds = 5 } = request.body || {};
  if (!playerId || !name) return response.status(400).json({ error: "Nama pemain wajib diisi." });
  const cleanName = String(name).trim().slice(0, 16);
  if (!cleanName) return response.status(400).json({ error: "Nama pemain wajib diisi." });
  const store = requireKv();
  let code;
  do code = crypto.randomBytes(3).toString("hex").toUpperCase(); while (await store.get(`room:${code}`));
  const room = {
    code,
    rounds: [3, 5, 7].includes(Number(rounds)) ? Number(rounds) : 5,
    currentRound: 1,
    currentPlayer: 0,
    started: false,
    finished: false,
    players: [{ id: String(playerId), name: cleanName, score: 0 }],
    lastRoll: null,
  };
  await saveRoom(room);
  response.json({ room: roomView(room), playerId: String(playerId) });
}));

app.post("/api/rooms/:code/join", route(async (request, response) => {
  const room = await getRoom(request.params.code);
  const { playerId, name } = request.body || {};
  const cleanName = String(name || "").trim().slice(0, 16);
  if (!room) return response.status(404).json({ error: "Room tidak ditemukan." });
  if (room.started) return response.status(409).json({ error: "Permainan sudah dimulai." });
  if (!playerId || !cleanName) return response.status(400).json({ error: "Nama pemain wajib diisi." });
  if (room.players.some((player) => player.id === String(playerId))) {
    return response.json({ room: roomView(room), playerId: String(playerId) });
  }
  const duplicateName = room.players.some((player) => player.name.toLocaleLowerCase("id-ID") === cleanName.toLocaleLowerCase("id-ID"));
  if (duplicateName) return response.status(409).json({ error: "Nama pemain sudah dipakai di room ini. Gunakan nama lain." });
  if (room.players.length >= 6) return response.status(409).json({ error: "Room sudah penuh." });
  room.players.push({ id: String(playerId), name: cleanName, score: 0 });
  await saveRoom(room);
  response.json({ room: roomView(room), playerId: String(playerId) });
}));

app.get("/api/rooms/:code", route(async (request, response) => {
  const room = await getRoom(request.params.code);
  if (!room) return response.status(404).json({ error: "Room tidak ditemukan." });
  response.json(roomView(room));
}));

app.post("/api/rooms/:code/start", route(async (request, response) => {
  const room = await getRoom(request.params.code);
  if (!room) return response.status(404).json({ error: "Room tidak ditemukan." });
  if (room.players.length < 2) return response.status(400).json({ error: "Minimal 2 pemain diperlukan." });
  room.started = true;
  await saveRoom(room);
  response.json(roomView(room));
}));

app.post("/api/rooms/:code/roll", route(async (request, response) => {
  const room = await getRoom(request.params.code);
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
  if (room.currentPlayer >= room.players.length) {
    room.currentPlayer = 0;
    room.currentRound += 1;
  }
  if (room.currentRound > room.rounds) room.finished = true;
  await saveRoom(room);
  response.json(roomView(room));
}));

app.get("/api/balance/:playerId", route(async (request, response) => {
  const tokens = Number((await requireKv().get(`balance:${request.params.playerId}`)) || 0);
  response.json({ tokens });
}));

app.post("/api/admin/topup", route(async (request, response) => {
  const { password, playerId, tokens } = request.body || {};
  const amount = Number(tokens);
  if (!adminPassword) return response.status(503).json({ error: "ADMIN_PASSWORD belum diatur di file .env server." });
  if (password !== adminPassword) return response.status(403).json({ error: "Password admin salah." });
  if (!playerId || !Number.isInteger(amount) || amount < 1 || amount > 1000000) return response.status(400).json({ error: "ID pemain atau jumlah token tidak valid." });
  const id = String(playerId).slice(0, 80);
  const balance = await requireKv().incrby(`balance:${id}`, amount);
  await requireKv().set(`order:MANUAL-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, { playerId: id, tokens: amount, status: "manual-topup", createdAt: new Date().toISOString() }, { ex: ROOM_TTL_SECONDS });
  response.json({ playerId: id, tokens: balance });
}));

if (require.main === module) {
  app.listen(port, () => console.log(`ROLL/TWO online server running at http://localhost:${port}`));
}

module.exports = app;
