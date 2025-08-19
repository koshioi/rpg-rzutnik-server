const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

// ---- Helpers ----
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const d10 = () => Math.floor(Math.random() * 10) + 1;

function rollDiceSet(count) {
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(d10());
  return arr;
}

function computeRoll({ diceCount, difficulty, autoSucc, rerollExplode, mitigateOnes, playerName, hidden, damageMode }) {
  const effDifficulty = damageMode ? 6 : difficulty;
  const effReroll = damageMode ? true : rerollExplode;

  const base = rollDiceSet(diceCount);
  const sumBase = base.reduce((a, b) => a + b, 0);
  const tensBase = base.filter((v) => v === 10).length;
  const onesBase = base.filter((v) => v === 1).length;
  const succBase = base.filter((v) => v >= effDifficulty).length;

  const mitigated = Math.min(mitigateOnes, onesBase);
  let onesEffective = Math.max(0, onesBase - mitigated);

  let cancelledRerolls = 0;
  let rerollsToDo = 0;
  let rerollResults = [];
  let succRerolls = 0;

  if (effReroll) {
    cancelledRerolls = Math.min(tensBase, onesEffective);
    rerollsToDo = tensBase - cancelledRerolls;
    onesEffective -= cancelledRerolls;

    let queue = rerollsToDo;
    while (queue > 0) {
      let next = 0;
      for (let i = 0; i < queue; i++) {
        const r = d10();
        rerollResults.push(r);
        if (r >= effDifficulty) succRerolls++;
        if (r === 10) next++;
      }
      queue = next;
    }
  }

  const naturalSuccesses = succBase + succRerolls;
  const sumAll = sumBase + rerollResults.reduce((a, b) => a + b, 0);

  const successesBeforeOnes = naturalSuccesses + autoSucc;
  const finalSuccesses = Math.max(0, successesBeforeOnes - onesEffective);
  let leftoverBadLuck = Math.max(0, onesEffective - successesBeforeOnes);
  if (damageMode) leftoverBadLuck = 0;

  let resultType = "PORAŻKA";
  if (!damageMode && leftoverBadLuck > 0) resultType = "PECH";
  else if (finalSuccesses > 0) resultType = "SUKCES";

  return {
    playerName,
    hidden,
    timestamp: new Date().toISOString(),
    diceCount,
    difficulty: effDifficulty,
    autoSucc,
    baseResults: base,
    rerollResults,
    sumBase,
    sumAll,
    tensBase,
    onesBase,
    mitigated,
    onesEffective,
    cancelledRerolls,
    succBase,
    succRerolls,
    naturalSuccesses,
    successesBeforeOnes,
    finalSuccesses,
    leftoverBadLuck,
    resultType,
    damageMode,
  };
}

// ---- App/IO ----
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"], methods: ["GET", "POST"] },
});

const MAX_HISTORY = 200;
let history = []; // newest first

io.on("connection", (socket) => {
  socket.emit("history", history);

  socket.on("roll:request", (payload) => {
    const clean = {
      playerName: String(payload.playerName || "").slice(0, 64),
      diceCount: clamp(payload.diceCount, 1, 20),
      difficulty: clamp(payload.difficulty, 1, 20),
      autoSucc: clamp(payload.autoSucc, 0, 5),
      rerollExplode: !!payload.rerollExplode,
      mitigateOnes: clamp(payload.mitigateOnes, 0, 5),
      hidden: !!payload.hidden,
      damageMode: !!payload.damageMode,
    };

    const full = computeRoll(clean);

    if (clean.hidden) {
      socket.emit("roll:new", full);
      const publicItem = {
        playerName: full.playerName,
        timestamp: full.timestamp,
        redacted: true,
      };
      history.unshift(publicItem);
      history = history.slice(0, MAX_HISTORY);
      socket.broadcast.emit("roll:new", publicItem);
    } else {
      history.unshift(full);
      history = history.slice(0, MAX_HISTORY);
      io.emit("roll:new", full);
    }
  });

  socket.on("session:new", () => {
    history = [];
    io.emit("history", history);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on :${PORT}`);
});
