const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const playerId = localStorage.getItem("rollTwoPlayerId") || crypto.randomUUID();
localStorage.setItem("rollTwoPlayerId", playerId);
let onlineRoom = null;
let onlinePoll = null;
let onlineRollInFlight = false;
let onlineHistory = [];
let onlineLastRollAt = 0;

const game = {
  players: 2,
  rounds: 5,
  currentPlayer: 0,
  currentRound: 1,
  rolling: false,
  finished: false,
  over: false,
  list: [],
  history: [],
  startingTokens: 500,
  bet: 25,
  pot: 0,
  roundScores: [],
};

function createPlayers() {
  const fields = $("#nameFields");
  fields.innerHTML = Array.from({ length: game.players }, (_, index) => `
    <label class="name-field"><span>Player ${String(index + 1).padStart(2, "0")}</span>
      <input maxlength="16" value="Player ${index + 1}" data-player-name="${index}" />
    </label>`).join("");
}

function setupChoiceEvents() {
  $$("[data-players]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-players]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    game.players = Number(button.dataset.players);
    createPlayers();
  }));
  $$("[data-rounds]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-rounds]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    game.rounds = Number(button.dataset.rounds);
  }));
}

function dieMarkup(value) {
  const positions = { 1: ["c"], 2: ["tl", "br"], 3: ["tl", "c", "br"], 4: ["tl", "tr", "bl", "br"], 5: ["tl", "tr", "c", "bl", "br"], 6: ["tl", "tr", "ml", "mr", "bl", "br"] };
  return positions[value].map((position) => `<i class="pip ${position}"></i>`).join("");
}

function setDie(element, value) {
  element.innerHTML = dieMarkup(value);
  element.dataset.value = value;
}

function renderScoreboard() {
  $("#scoreboard").innerHTML = game.list.map((player, index) => `
    <div class="score-row ${index === game.currentPlayer && !game.finished ? "current" : ""}">
      <span class="rank">${String(index + 1).padStart(2, "0")}</span><span class="player-name">${player.name}<small>${player.tokens} tokens</small></span><strong>${player.score}</strong>
    </div>`).join("");
}

function updatePot() {
  $("#potLabel").textContent = game.pot;
  $("#adminTotalTokens").textContent = game.list.reduce((total, player) => total + player.tokens, 0);
}

async function refreshBalance() {
  try {
    const response = await fetch(`/api/balance/${encodeURIComponent(playerId)}`);
    const data = await response.json();
    $("#tokenBalance").textContent = data.tokens.toLocaleString("id-ID");
  } catch (_error) {
    $("#tokenBalance").textContent = "offline";
  }
}

function renderHistory() {
  $("#history").innerHTML = game.history.length ? game.history.slice(0, 6).map((roll) => `
    <div class="history-row"><span>${roll.player}</span><b>${roll.first} + ${roll.second}</b><strong>${roll.total}</strong></div>`).join("") : '<p class="empty-state">Belum ada lemparan.</p>';
}

function renderOnlineRoom(room) {
  onlineRoom = room;
  game.list = room.players.map((player) => ({ ...player }));
  game.currentPlayer = room.currentPlayer;
  game.currentRound = room.currentRound;
  game.rounds = room.rounds;
  game.finished = room.finished;
  $("#roomCode").value = room.code;
  $("#setupPanel").classList.toggle("hidden", room.started);
  $("#startOnlineGame").disabled = room.started;
  $("#roomStatus").textContent = room.started ? `Room ${room.code} aktif. Giliran: ${room.players[room.currentPlayer]?.name || "selesai"}.` : `Room ${room.code} menunggu pemain (${room.players.length}/6).`;
  $("#adminTotalTokens").textContent = room.players.reduce((total, player) => total + player.score, 0);
  if (room.lastRoll && room.lastRoll.at !== onlineLastRollAt) {
    onlineLastRollAt = room.lastRoll.at;
    setDie($("#dieOne"), room.lastRoll.first);
    setDie($("#dieTwo"), room.lastRoll.second);
    $("#totalLabel").textContent = room.lastRoll.total;
    $("#statusLabel").textContent = `${room.lastRoll.player} mendapat ${room.lastRoll.total}`;
    onlineHistory.unshift({ player: room.lastRoll.player, first: room.lastRoll.first, second: room.lastRoll.second, total: room.lastRoll.total });
    onlineHistory = onlineHistory.slice(0, 6);
    game.history = onlineHistory;
    renderHistory();
  }
  $("#roundLabel").textContent = String(room.currentRound).padStart(2, "0");
  $("#totalRoundsLabel").textContent = String(room.rounds).padStart(2, "0");
  $("#turnLabel").textContent = room.finished ? "Permainan selesai" : `${room.players[room.currentPlayer]?.name || "Player"}'s turn`;
  if (!onlineRollInFlight) {
    const yourTurn = room.players[room.currentPlayer]?.id === playerId;
    if (room.finished) {
      $("#rollButton").innerHTML = 'Selesai <span>✓</span>';
      $("#rollButton").disabled = true;
    } else {
      $("#rollButton").innerHTML = yourTurn ? 'Roll the dice <span>↗</span>' : 'Menunggu pemain lain…';
      $("#rollButton").disabled = !room.started || !yourTurn;
    }
  }
  renderScoreboard();
}

async function requestRoom(url, body) {
  if (roomRequestInFlight) return;
  roomRequestInFlight = true;
  try {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  onlineHistory = [];
  onlineLastRollAt = 0;
  game.history = [];
  renderOnlineRoom(data.room);
  $("#setupPanel").classList.add("hidden");
  $("#gameView").classList.remove("hidden");
  $("#setupPanel").classList.remove("hidden");
  if (onlinePoll) clearInterval(onlinePoll);
  onlinePoll = setInterval(syncOnlineRoom, 1000);
  } finally {
    roomRequestInFlight = false;
  }
}

function leaveOnlineRoom() {
  if (onlinePoll) clearInterval(onlinePoll);
  onlinePoll = null;
  onlineRoom = null;
  onlineHistory = [];
  onlineLastRollAt = 0;
  onlineRollInFlight = false;
}

async function syncOnlineRoom() {
  if (!onlineRoom) return;
  try {
    const response = await fetch(`/api/rooms/${onlineRoom.code}`);
    if (response.ok) renderOnlineRoom(await response.json());
  } catch (_error) {
    $("#roomStatus").textContent = "Koneksi terputus. Mencoba menyambung kembali...";
  }
}

async function rollOnlineDice() {
  if (!onlineRoom || onlineRollInFlight) return;
  onlineRollInFlight = true;
  const button = $("#rollButton");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  button.disabled = true;
  $("#statusLabel").textContent = "Rolling...";
  $("#dieOne").classList.add("rolling");
  $("#dieTwo").classList.add("rolling");
  try {
    const response = await fetch(`/api/rooms/${onlineRoom.code}/roll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Roll gagal.");
    onlineRollInFlight = false;
    $("#dieOne").classList.remove("rolling");
    $("#dieTwo").classList.remove("rolling");
    renderOnlineRoom(data);
  } catch (error) {
    $("#statusLabel").textContent = error.name === "AbortError" ? "Server terlalu lama merespons." : error.message;
    button.disabled = false;
  } finally {
    clearTimeout(timeout);
    $("#dieOne").classList.remove("rolling");
    $("#dieTwo").classList.remove("rolling");
    onlineRollInFlight = false;
  }
}

function beginGame() {
  game.startingTokens = Math.max(10, Number($("#startingTokens").value) || 500);
  game.bet = Math.max(1, Number($("#betAmount").value) || 25);
  if (game.bet > game.startingTokens) {
    $("#betAmount").value = game.startingTokens;
    game.bet = game.startingTokens;
  }
  game.list = $$('[data-player-name]').map((input) => ({ name: input.value.trim() || `Player ${Number(input.dataset.playerName) + 1}`, score: 0 }));
  game.list.forEach((player) => { player.tokens = game.startingTokens; });
  game.currentPlayer = 0;
  game.currentRound = 1;
  game.history = [];
  game.pot = 0;
  game.roundScores = game.list.map(() => 0);
  game.finished = false;
  game.over = false;
  $("#setupPanel").classList.add("hidden");
  $("#gameView").classList.remove("hidden");
  $("#totalRoundsLabel").textContent = String(game.rounds).padStart(2, "0");
  setDie($("#dieOne"), 1);
  setDie($("#dieTwo"), 1);
  updateTurn();
  renderScoreboard();
  renderHistory();
  updatePot();
  $("#gameView").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateTurn() {
  const player = game.list[game.currentPlayer];
  $("#roundLabel").textContent = String(game.currentRound).padStart(2, "0");
  $("#turnLabel").textContent = `${player.name}'s turn`;
  $("#statusLabel").textContent = `Bet ${game.bet} tokens to roll`;
  $("#rollButton").disabled = false;
  renderScoreboard();
}

function rollDice() {
  if (game.rolling || game.finished) return;
  const player = game.list[game.currentPlayer];
  if (player.tokens < game.bet) {
    $("#statusLabel").textContent = `${player.name} kehabisan token`;
    return;
  }
  game.rolling = true;
  player.tokens -= game.bet;
  game.pot += game.bet;
  const button = $("#rollButton");
  button.disabled = true;
  $("#statusLabel").textContent = "Rolling...";
  $("#bonusLabel").textContent = "";
  $("#totalLabel").textContent = "—";
  $("#dieOne").classList.add("rolling");
  $("#dieTwo").classList.add("rolling");
  const first = Math.floor(Math.random() * 6) + 1;
  const second = Math.floor(Math.random() * 6) + 1;
  let ticks = 0;
  const interval = setInterval(() => {
    setDie($("#dieOne"), Math.floor(Math.random() * 6) + 1);
    setDie($("#dieTwo"), Math.floor(Math.random() * 6) + 1);
    ticks += 1;
    if (ticks >= 10) {
      clearInterval(interval);
      finishRoll(first, second);
    }
  }, 65);
}

function finishRoll(first, second) {
  setDie($("#dieOne"), first);
  setDie($("#dieTwo"), second);
  $("#dieOne").classList.remove("rolling");
  $("#dieTwo").classList.remove("rolling");
  const double = first === second;
  const total = first + second + (double ? 2 : 0);
  const player = game.list[game.currentPlayer];
  player.score += total;
  game.roundScores[game.currentPlayer] += total;
  game.history.unshift({ player: player.name, first, second, total });
  $("#totalLabel").textContent = total;
  $("#bonusLabel").textContent = double ? "DOUBLE +2" : "";
  $("#statusLabel").textContent = double ? "Double! Nice roll." : "Roll locked in";
  renderScoreboard();
  renderHistory();
  updatePot();
  setTimeout(nextTurn, 1050);
}

function nextTurn() {
  game.currentPlayer += 1;
  if (game.currentPlayer >= game.players) {
    const winnerScore = Math.max(...game.roundScores);
    const winnerIndex = game.roundScores.indexOf(winnerScore);
    if (winnerIndex >= 0) game.list[winnerIndex].tokens += game.pot;
    game.pot = 0;
    game.roundScores = game.list.map(() => 0);
    game.currentPlayer = 0;
    game.currentRound += 1;
  }
  if (game.currentRound > game.rounds) return finishGame();
  game.rolling = false;
  updateTurn();
  updatePot();
}

function finishGame() {
  game.finished = true;
  game.over = true;
  const topScore = Math.max(...game.list.map((player) => player.score));
  const winners = game.list.filter((player) => player.score === topScore).map((player) => player.name);
  $("#turnLabel").textContent = winners.length > 1 ? "It's a tie!" : `${winners[0]} wins!`;
  $("#statusLabel").textContent = `Final score: ${topScore} points`;
  $("#rollButton").innerHTML = 'Play again <span>↗</span>';
  $("#rollButton").disabled = false;
  renderScoreboard();
}

function resetToSetup() {
  game.finished = false;
  game.rolling = false;
  game.over = false;
  leaveOnlineRoom();
  $("#gameView").classList.add("hidden");
  $("#setupPanel").classList.remove("hidden");
  $("#roomError").textContent = "";
  $("#rollButton").innerHTML = 'Roll the dice <span>↗</span>';
  $("#rollButton").disabled = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAdmin() {
  $("#adminModal").classList.remove("hidden");
  $("#adminPassword").value = "";
  $("#adminError").textContent = "";
  $("#adminContent").classList.add("hidden");
  $("#loginAdmin").classList.remove("hidden");
  setTimeout(() => $("#adminPassword").focus(), 50);
}

function loginAdmin() {
  if (!$("#adminPassword").value) {
    $("#adminError").textContent = "Password wajib diisi.";
    return;
  }
  $("#adminError").textContent = "Password akan diverifikasi saat top up.";
  $("#adminContent").classList.remove("hidden");
  $("#loginAdmin").classList.add("hidden");
  updatePot();
}

function resetTokens() {
  if (!game.list.length) return;
  game.list.forEach((player) => { player.tokens = game.startingTokens; });
  game.pot = 0;
  renderScoreboard();
  updatePot();
  $("#adminError").textContent = "Token pemain sudah direset.";
}

createPlayers();
setupChoiceEvents();
$("#startButton").addEventListener("click", beginGame);
$("#resetButton").addEventListener("click", resetToSetup);
$("#adminButton").addEventListener("click", openAdmin);
$("#closeAdmin").addEventListener("click", () => $("#adminModal").classList.add("hidden"));
$("#closeAdminPanel").addEventListener("click", () => $("#adminModal").classList.add("hidden"));
$("#loginAdmin").addEventListener("click", loginAdmin);
$("#resetTokens").addEventListener("click", resetTokens);
$("#adminPassword").addEventListener("keydown", (event) => { if (event.key === "Enter") loginAdmin(); });
$("#createRoom").addEventListener("click", async () => {
  try { await requestRoom("/api/rooms", { playerId, name: $("#roomPlayerName").value.trim() || "Player", rounds: game.rounds }); } catch (error) { $("#roomError").textContent = error.message; }
});
$("#joinRoom").addEventListener("click", async () => {
  try { await requestRoom(`/api/rooms/${$("#roomCode").value.trim()}/join`, { playerId, name: $("#roomPlayerName").value.trim() || "Player" }); } catch (error) { $("#roomError").textContent = error.message; }
});
$("#startOnlineGame").addEventListener("click", async () => {
  if (!onlineRoom) { $("#roomError").textContent = "Buat atau gabung room dulu."; return; }
  const button = $("#startOnlineGame");
  button.disabled = true;
  try {
    const response = await fetch(`/api/rooms/${onlineRoom.code}/start`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Game tidak dapat dimulai.");
    renderOnlineRoom(data);
  } catch (error) {
    $("#roomError").textContent = error.message;
    button.disabled = false;
  }
});
$("#rollButton").addEventListener("click", () => {
  if (game.over) { resetToSetup(); return; }
  if (onlineRoom) rollOnlineDice();
  else rollDice();
});
$("#adminPlayerId").textContent = playerId;
$("#topupPlayerId").value = playerId;
$("#manualTopup").addEventListener("click", async () => {
  const button = $("#manualTopup");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#adminPassword").value, playerId: $("#topupPlayerId").value.trim(), tokens: Number($("#topupTokens").value) }) });
    const data = await response.json();
    $("#adminError").textContent = response.ok ? `Saldo berhasil menjadi ${data.tokens} token.` : data.error;
    if (response.ok) { $("#topupTokens").value = ""; await refreshBalance(); }
  } catch (_error) {
    $("#adminError").textContent = "Server tidak dapat dihubungi.";
  } finally {
    button.disabled = false;
  }
});
refreshBalance();
