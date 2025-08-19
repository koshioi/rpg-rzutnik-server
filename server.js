// 1) importy
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

// 2) konfiguracja
const PORT = process.env.PORT || 3001;
// Podaj domeny frontu rozdzielone przecinkami, np.
// ALLOWED_ORIGIN="https://koshioi.github.io,http://localhost:5173"
const ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 3) express
const app = express();
app.use(cors({ origin: ALLOWED.length ? ALLOWED : '*' }));
app.use(express.json());

app.get('/', (_req, res) => res.send('rpg-rzutnik-server OK'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// 4) http + socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED.length ? ALLOWED : '*',
    methods: ['GET', 'POST'],
  },
});

// --- logika rzutów (spójna z frontem) ---
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const d10 = () => Math.floor(Math.random() * 10) + 1;
const rollDiceSet = (n) => Array.from({ length: n }, d10);

function computeRollSafe(p) {
  const damageMode    = !!p.damageMode;
  const difficulty    = damageMode ? 6 : clamp(p.difficulty, 1, 20);
  const rerollExplode = damageMode ? true : !!p.rerollExplode;
  const diceCount     = clamp(p.diceCount, 1, 20);
  const autoSucc      = clamp(p.autoSucc, 0, 5);
  const mitigateOnes  = damageMode ? 100000 : clamp(p.mitigateOnes, 0, 100000);
  const playerName    = String(p.playerName || '').slice(0, 64);
  const hidden        = !!p.hidden;

  const base = rollDiceSet(diceCount);
  const tens = base.filter(v => v === 10).length;
  const ones = base.filter(v => v === 1).length;
  const succBase = base.filter(v => v >= difficulty).length;

  const mitigated = Math.min(mitigateOnes, ones);
  let onesEff = Math.max(0, ones - mitigated);

  let cancelled = 0, todo = 0, rerolls = [], succR = 0;
  if (rerollExplode) {
    // 1 najpierw kasują przerzuty (10), potem sukcesy
    cancelled = Math.min(tens, onesEff);
    todo = tens - cancelled;
    onesEff -= cancelled;

    // eksplozje łańcuchowo
    let q = todo;
    while (q > 0) {
      let next = 0;
      for (let i = 0; i < q; i++) {
        const r = d10();
        rerolls.push(r);
        if (r >= difficulty) succR++;
        if (r === 10) next++;
        // 1 w przerzucie NIE generuje pecha
      }
      q = next;
    }
  }

  const naturalSuccesses = succBase + succR;
  const successesBeforeOnes = naturalSuccesses + autoSucc;
  const finalSuccesses = Math.max(0, successesBeforeOnes - onesEff);
  let leftoverBadLuck = Math.max(0, onesEff - successesBeforeOnes);
  if (damageMode) leftoverBadLuck = 0;

  let resultType = 'PORAŻKA';
  if (!damageMode && leftoverBadLuck > 0) resultType = 'PECH';
  else if (finalSuccesses > 0) resultType = 'SUKCES';

  return {
    playerName,
    hidden,
    timestamp: new Date().toISOString(),
    diceCount,
    difficulty,
    autoSucc,
    baseResults: base,
    rerollResults: rerolls,
    onesEffective: onesEff,
    naturalSuccesses,
    finalSuccesses,
    leftoverBadLuck,
    resultType,
    damageMode,
  };
}

// prosta historia w RAM
let history = [];
const HISTORY_LIMIT = 500;

// 5) socket.io wydarzenia
io.on('connection', (socket) => {
  // wyślij historię po wejściu
  socket.emit('history', history);

  // rzut (ukryty wraca tylko do autora)
  socket.on('roll:request', (payload) => {
    try {
      const safe = {
        diceCount: clamp(payload?.diceCount, 1, 20),
        difficulty: clamp(payload?.difficulty, 1, 20),
        autoSucc: clamp(payload?.autoSucc, 0, 5),
        rerollExplode: !!payload?.rerollExplode,
        mitigateOnes: clamp(payload?.mitigateOnes, 0, 100000),
        playerName: String(payload?.playerName || '').slice(0, 64),
        hidden: !!payload?.hidden,
        damageMode: !!payload?.damageMode,
      };

      const item = computeRollSafe(safe);

      if (safe.hidden) {
        socket.emit('roll:new', { ...item, redacted: true });
        return;
      }

      history.unshift(item);
      if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
      io.emit('roll:new', item);
    } catch (e) {
      console.error('roll:request error', e);
    }
  });

  // nowa sesja – czyści wspólną historię
  socket.on('session:new', () => {
    history = [];
    io.emit('history', history);
  });

  // rysowanie współdzielone
  socket.on('draw:stroke', (stroke) => socket.broadcast.emit('draw:stroke', stroke));
  socket.on('draw:remove', (id) => socket.broadcast.emit('draw:remove', id));
  socket.on('draw:clear', () => socket.broadcast.emit('draw:clear'));
  socket.on('draw:bg', (dataUrl) => socket.broadcast.emit('draw:bg', dataUrl));
});

// 6) start
server.listen(PORT, () => {
  console.log(`rpg-rzutnik-server listening on :${PORT}`);
  console.log('CORS allowed origins:', ALLOWED.length ? ALLOWED.join(', ') : '*');
});
