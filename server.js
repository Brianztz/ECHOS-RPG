const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'ordem.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Presença é reconstruída pelas conexões Socket.IO a cada inicialização.
try { db.exec('UPDATE players SET online=0;'); } catch {}


db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gm_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  player_name TEXT NOT NULL DEFAULT '',
  character_name TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  online INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_states (
  player_id INTEGER PRIMARY KEY,
  sheet_json TEXT,
  summary_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  player_id INTEGER,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_players_campaign ON players(campaign_id);
`)
try { db.exec('ALTER TABLE players ADD COLUMN sync_code TEXT;'); } catch {}
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_campaign_sync
ON players(campaign_id, sync_code)
WHERE sync_code IS NOT NULL AND sync_code <> '';

CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id, id DESC);
`);

const q = {
  campaignByCode: db.prepare('SELECT * FROM campaigns WHERE code = ?'),
  campaignById: db.prepare('SELECT * FROM campaigns WHERE id = ?'),
  campaignByCodeToken: db.prepare('SELECT * FROM campaigns WHERE code = ? AND gm_token = ?'),
  createCampaign: db.prepare('INSERT INTO campaigns(code, name, gm_token) VALUES(?,?,?)'),
  playerByToken: db.prepare('SELECT * FROM players WHERE token = ?'),
  playerById: db.prepare('SELECT * FROM players WHERE id = ?'),
  playerByCampaignSync: db.prepare('SELECT * FROM players WHERE campaign_id = ? AND sync_code = ?'),
  createRoomPlayer: db.prepare('INSERT INTO players(campaign_id, player_name, character_name, token, sync_code, online, last_seen) VALUES(?,?,?,?,?,1,CURRENT_TIMESTAMP)'),
  createPlayer: db.prepare('INSERT INTO players(campaign_id, player_name, character_name, token, online, last_seen) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)'),
  updatePlayerIdentity: db.prepare('UPDATE players SET player_name=?, character_name=?, online=1, last_seen=CURRENT_TIMESTAMP WHERE id=?'),
  setPlayerOnline: db.prepare('UPDATE players SET online=?, last_seen=CURRENT_TIMESTAMP WHERE id=?'),
  listPlayers: db.prepare(`
    SELECT p.*, ps.sheet_json, ps.summary_json, ps.updated_at
    FROM players p
    LEFT JOIN player_states ps ON ps.player_id=p.id
    WHERE p.campaign_id=?
    ORDER BY p.id ASC
  `),
  stateByPlayer: db.prepare('SELECT * FROM player_states WHERE player_id = ?'),
  upsertState: db.prepare(`
    INSERT INTO player_states(player_id, sheet_json, summary_json, updated_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(player_id) DO UPDATE SET
      sheet_json=excluded.sheet_json,
      summary_json=excluded.summary_json,
      updated_at=CURRENT_TIMESTAMP
  `),
  addEvent: db.prepare('INSERT INTO events(campaign_id, player_id, event_type, payload_json) VALUES(?,?,?,?)'),
  latestEvents: db.prepare('SELECT * FROM events WHERE campaign_id=? ORDER BY id DESC LIMIT ?')
};

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeTableCode(value) {
  const normalized = String(value || 'PADRAO')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || 'PADRAO';
}

function ensureCampaignForTable(table) {
  const code = normalizeTableCode(table);
  let campaign = q.campaignByCode.get(code);
  if (campaign) return campaign;
  try { q.createCampaign.run(code, `Mesa ${code}`, randomToken(32)); }
  catch (err) { if (!q.campaignByCode.get(code)) throw err; }
  return q.campaignByCode.get(code);
}

function roomPlayerObject(row) {
  if (!row) return null;
  const campaign = q.campaignById.get(row.campaign_id);
  const state = q.stateByPlayer.get(row.id);
  const sheet = parseJson(state?.sheet_json, {}) || {};
  const summary = parseJson(state?.summary_json, {}) || {};
  const fields = sheet?.fields || {};
  return {
    id: row.id,
    dbId: row.id,
    codigo: row.sync_code || String(row.id),
    mesa: campaign?.code || 'PADRAO',
    nome: summary.characterName || row.character_name || fields.name || 'Agente',
    playerName: summary.playerName || row.player_name || fields.player || '',
    characterName: summary.characterName || row.character_name || fields.name || 'Agente',
    foto: fields.portraitData || summary.portrait || '',
    nex: Number(summary.nex ?? fields.nex ?? 0),
    defesa: Number(summary.defense ?? 0),
    vida_atual: Number(summary.pv ?? fields.pvCur ?? 0),
    vida_max: Number(summary.pvMax ?? 0),
    sani_atual: Number(summary.san ?? fields.sanCur ?? 0),
    sani_max: Number(summary.sanMax ?? 0),
    pe_atual: Number(summary.pe ?? fields.peCur ?? 0),
    pe_max: Number(summary.peMax ?? 0),
    radiacao: Number(summary.radiation ?? fields.radiation ?? 0),
    status: Array.isArray(summary.conditions) ? summary.conditions : [],
    fullData: sheet,
    sheet,
    summary,
    online: !!row.online,
    lastSeen: row.last_seen,
    updatedAt: state?.updated_at || null
  };
}

function roomPlayers(campaignId, onlyOnline = true) {
  return q.listPlayers.all(campaignId)
    .filter(row => !onlyOnline || !!row.online)
    .map(roomPlayerObject);
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 7; i++) code += alphabet[crypto.randomInt(0, alphabet.length)];
    if (!q.campaignByCode.get(code)) return code;
  }
  throw new Error('Não foi possível gerar um código de campanha único.');
}

function safeString(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function safeJson(value, maxBytes = 9 * 1024 * 1024) {
  const text = JSON.stringify(value ?? null);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Payload grande demais.');
  return text;
}

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function publicPlayerRow(row) {
  return {
    id: row.id,
    playerName: row.player_name,
    characterName: row.character_name,
    online: !!row.online,
    lastSeen: row.last_seen,
    sheet: parseJson(row.sheet_json),
    summary: parseJson(row.summary_json),
    updatedAt: row.updated_at || null
  };
}

function campaignPlayers(campaignId) {
  return q.listPlayers.all(campaignId).map(publicPlayerRow);
}

function ackError(ack, message) {
  if (typeof ack === 'function') ack({ ok: false, error: message });
}

function ackOk(ack, data = {}) {
  if (typeof ack === 'function') ack({ ok: true, ...data });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ordem-online' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/jogador', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'jogador', 'index.html')));
app.get('/mestre', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mestre', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024,
  pingTimeout: 20000,
  pingInterval: 25000
});

function requireGM(socket, ack) {
  if (!socket.data.role || socket.data.role !== 'gm' || !socket.data.campaignId) {
    ackError(ack, 'Mestre não autenticado.');
    return false;
  }
  return true;
}

function requirePlayer(socket, ack) {
  if (!socket.data.role || socket.data.role !== 'player' || !socket.data.playerId || !socket.data.campaignId) {
    ackError(ack, 'Jogador não autenticado.');
    return false;
  }
  return true;
}

function sendGMPlayers(campaignId) {
  io.to(`gm:${campaignId}`).emit('gm:players', campaignPlayers(campaignId));
}

const activePlayerSockets = new Map();
function registerPlayerSocket(socket, playerId) {
  let set = activePlayerSockets.get(playerId);
  if (!set) { set = new Set(); activePlayerSockets.set(playerId, set); }
  set.add(socket.id);
}
function unregisterPlayerSocket(socket, playerId, campaignId, syncCode, tableCode) {
  if (!playerId) return;
  const set = activePlayerSockets.get(playerId);
  if (set) {
    set.delete(socket.id);
    if (!set.size) activePlayerSockets.delete(playerId);
  }
  if (!activePlayerSockets.has(playerId)) {
    q.setPlayerOnline.run(0, playerId);
    if (campaignId) {
      io.to(`gm:${campaignId}`).emit('player_disconnected', {
        codigo: syncCode || String(playerId),
        mesa: tableCode || q.campaignById.get(campaignId)?.code || 'PADRAO'
      });
      sendGMPlayers(campaignId);
    }
  }
}
function clearSocketRooms(socket) {
  if (socket.data.campaignId) {
    socket.leave(`campaign:${socket.data.campaignId}`);
    socket.leave(`gm:${socket.data.campaignId}`);
  }
  if (socket.data.playerId) socket.leave(`player:${socket.data.playerId}`);
}

io.on('connection', (socket) => {
  socket.data.role = null;

  // Protocolo de mesa igual ao projeto de referência.
  socket.on('master_ready', (payload = {}, ack) => {
    try {
      const table = normalizeTableCode(payload.mesa);
      const campaign = ensureCampaignForTable(table);
      clearSocketRooms(socket);
      socket.data.role = 'gm';
      socket.data.campaignId = campaign.id;
      socket.data.tableCode = table;
      socket.data.playerId = null;
      socket.join(`gm:${campaign.id}`);
      socket.join(`campaign:${campaign.id}`);
      const players = roomPlayers(campaign.id, true);
      socket.emit('players_snapshot', players);
      ackOk(ack, { mesa: table, players });
    } catch (err) { ackError(ack, err.message || 'Falha ao conectar o mestre à mesa.'); }
  });

  socket.on('status_change', (payload = {}, ack) => {
    try {
      const table = normalizeTableCode(payload.mesa);
      const syncCode = safeString(payload.codigo || payload.id, 40).toUpperCase();
      if (!syncCode) return ackError(ack, 'Código da ficha ausente.');
      const campaign = ensureCampaignForTable(table);
      let player = q.playerByCampaignSync.get(campaign.id, syncCode);
      const sheet = payload.fullData || payload.sheet || {};
      const summary = payload.summary || {
        playerName: safeString(payload.playerName || sheet?.fields?.player || '', 80),
        characterName: safeString(payload.nome || payload.characterName || sheet?.fields?.name || 'Agente', 80) || 'Agente',
        nex: Number(payload.nex ?? sheet?.fields?.nex ?? 0),
        defense: Number(payload.defesa ?? 0),
        pv: Number(payload.vida_atual ?? sheet?.fields?.pvCur ?? 0),
        pvMax: Number(payload.vida_max ?? 0),
        san: Number(payload.sani_atual ?? sheet?.fields?.sanCur ?? 0),
        sanMax: Number(payload.sani_max ?? 0),
        pe: Number(payload.pe_atual ?? sheet?.fields?.peCur ?? 0),
        peMax: Number(payload.pe_max ?? 0),
        radiation: Number(payload.radiacao ?? sheet?.fields?.radiation ?? 0),
        conditions: Array.isArray(payload.status) ? payload.status : []
      };
      if (!player) {
        const info = q.createRoomPlayer.run(
          campaign.id,
          safeString(summary.playerName || '', 80),
          safeString(summary.characterName || 'Agente', 80) || 'Agente',
          randomToken(28),
          syncCode
        );
        player = q.playerById.get(Number(info.lastInsertRowid));
      } else {
        q.updatePlayerIdentity.run(
          safeString(summary.playerName || player.player_name || '', 80),
          safeString(summary.characterName || player.character_name || 'Agente', 80) || 'Agente',
          player.id
        );
        player = q.playerById.get(player.id);
      }
      if (socket.data.role === 'player' && socket.data.playerId && socket.data.playerId !== player.id) {
        unregisterPlayerSocket(socket, socket.data.playerId, socket.data.campaignId, socket.data.syncCode, socket.data.tableCode);
        clearSocketRooms(socket);
      }
      socket.data.role = 'player';
      socket.data.campaignId = campaign.id;
      socket.data.playerId = player.id;
      socket.data.syncCode = syncCode;
      socket.data.tableCode = table;
      socket.join(`player:${player.id}`);
      socket.join(`campaign:${campaign.id}`);
      registerPlayerSocket(socket, player.id);
      q.updatePlayerIdentity.run(
        safeString(summary.playerName || player.player_name || '', 80),
        safeString(summary.characterName || player.character_name || 'Agente', 80) || 'Agente',
        player.id
      );
      q.upsertState.run(player.id, safeJson(sheet, 9*1024*1024), safeJson(summary, 512*1024));
      const updated = roomPlayerObject(q.playerById.get(player.id));
      io.to(`gm:${campaign.id}`).emit('update_mestre', updated);
      io.to(`gm:${campaign.id}`).emit('gm:player_sheet', updated);
      sendGMPlayers(campaign.id);
      ackOk(ack, { codigo: syncCode, mesa: table, playerId: player.id });
    } catch (err) { ackError(ack, err.message || 'Falha ao sincronizar ficha.'); }
  });

  socket.on('request_player', (payload = {}, ack) => {
    try {
      const table = normalizeTableCode(payload.mesa);
      const campaign = q.campaignByCode.get(table);
      if (!campaign) return ackError(ack, 'Mesa não encontrada.');
      const syncCode = safeString(payload.codigo, 40).toUpperCase();
      const player = q.playerByCampaignSync.get(campaign.id, syncCode);
      if (!player) return ackError(ack, 'Ficha não encontrada.');
      const data = roomPlayerObject(player);
      socket.emit('update_mestre', data);
      ackOk(ack, { player: data });
    } catch (err) { ackError(ack, err.message || 'Falha ao buscar ficha.'); }
  });

  socket.on('master_update_player', (payload = {}, ack) => {
    try {
      const table = normalizeTableCode(payload.mesa || socket.data.tableCode);
      const campaign = q.campaignByCode.get(table);
      if (!campaign) return ackError(ack, 'Mesa não encontrada.');
      const syncCode = safeString(payload.codigo || payload.id, 40).toUpperCase();
      const player = q.playerByCampaignSync.get(campaign.id, syncCode);
      if (!player) return ackError(ack, 'Ficha não encontrada.');
      const previous = roomPlayerObject(player);
      const sheet = payload.fullData || payload.sheet || previous.fullData || {};
      const summary = payload.summary || previous.summary || {};
      q.upsertState.run(player.id, safeJson(sheet, 9*1024*1024), safeJson(summary, 512*1024));
      const updated = roomPlayerObject(q.playerById.get(player.id));
      io.to(`player:${player.id}`).emit('player_data_updated', updated);
      io.to(`gm:${campaign.id}`).emit('update_mestre', updated);
      ackOk(ack, { player: updated });
    } catch (err) { ackError(ack, err.message || 'Falha ao atualizar ficha.'); }
  });

  socket.on('master_request_sync', (payload = {}, ack) => {
    try {
      const table = normalizeTableCode(payload.mesa || socket.data.tableCode);
      const campaign = q.campaignByCode.get(table);
      if (!campaign) return ackError(ack, 'Mesa não encontrada.');
      const players = roomPlayers(campaign.id, true);
      players.forEach(player => io.to(`player:${player.id}`).emit('sync_requested', { mesa: table, codigo: player.codigo }));
      ackOk(ack, { players });
    } catch (err) { ackError(ack, err.message || 'Falha ao solicitar sincronização.'); }
  });


  socket.on('gm:create', (payload = {}, ack) => {
    try {
      const name = safeString(payload.name || 'Campanha', 100) || 'Campanha';
      const code = randomCode();
      const gmToken = randomToken(32);
      const info = q.createCampaign.run(code, name, gmToken);
      const campaignId = Number(info.lastInsertRowid);

      socket.data.role = 'gm';
      socket.data.campaignId = campaignId;
      socket.join(`gm:${campaignId}`);
      socket.join(`campaign:${campaignId}`);

      ackOk(ack, { campaign: { id: campaignId, code, name, gmToken }, players: [] });
    } catch (err) {
      ackError(ack, err.message || 'Falha ao criar campanha.');
    }
  });

  socket.on('gm:resume', (payload = {}, ack) => {
    try {
      const code = safeString(payload.code, 20).toUpperCase();
      const token = safeString(payload.gmToken, 200);
      const campaign = q.campaignByCodeToken.get(code, token);
      if (!campaign) return ackError(ack, 'Código ou token do mestre inválido.');

      socket.data.role = 'gm';
      socket.data.campaignId = campaign.id;
      socket.join(`gm:${campaign.id}`);
      socket.join(`campaign:${campaign.id}`);

      ackOk(ack, {
        campaign: { id: campaign.id, code: campaign.code, name: campaign.name, gmToken: campaign.gm_token },
        players: campaignPlayers(campaign.id)
      });
    } catch (err) {
      ackError(ack, err.message || 'Falha ao reconectar mestre.');
    }
  });

  socket.on('gm:list_players', (_payload = {}, ack) => {
    if (!requireGM(socket, ack)) return;
    ackOk(ack, { players: campaignPlayers(socket.data.campaignId) });
  });

  socket.on('player:join', (payload = {}, ack) => {
    try {
      const code = safeString(payload.code, 20).toUpperCase();
      const playerName = safeString(payload.playerName, 80);
      const characterName = safeString(payload.characterName, 80) || 'Agente';
      const campaign = q.campaignByCode.get(code);
      if (!campaign) return ackError(ack, 'Campanha não encontrada.');

      let player;
      const incomingToken = safeString(payload.playerToken, 200);
      if (incomingToken) {
        const existing = q.playerByToken.get(incomingToken);
        if (!existing || existing.campaign_id !== campaign.id) return ackError(ack, 'Token do jogador inválido para esta campanha.');
        q.updatePlayerIdentity.run(playerName || existing.player_name, characterName || existing.character_name, existing.id);
        player = q.playerById.get(existing.id);
      } else {
        const token = randomToken(28);
        const info = q.createPlayer.run(campaign.id, playerName, characterName, token);
        player = q.playerById.get(Number(info.lastInsertRowid));
      }

      socket.data.role = 'player';
      socket.data.campaignId = campaign.id;
      socket.data.playerId = player.id;
      socket.join(`player:${player.id}`);
      socket.join(`campaign:${campaign.id}`);

      const state = q.stateByPlayer.get(player.id);
      const response = {
        campaign: { id: campaign.id, code: campaign.code, name: campaign.name },
        player: {
          id: player.id,
          playerName: player.player_name,
          characterName: player.character_name,
          playerToken: player.token
        },
        sheet: parseJson(state?.sheet_json),
        summary: parseJson(state?.summary_json),
        updatedAt: state?.updated_at || null
      };
      ackOk(ack, response);
      sendGMPlayers(campaign.id);
    } catch (err) {
      ackError(ack, err.message || 'Falha ao entrar na campanha.');
    }
  });

  socket.on('sheet:update', (payload = {}, ack) => {
    if (!requirePlayer(socket, ack)) return;
    try {
      const sheetText = safeJson(payload.sheet || {}, 9 * 1024 * 1024);
      const summaryText = safeJson(payload.summary || {}, 512 * 1024);

      const currentPlayer = q.playerById.get(socket.data.playerId);
      const summary = payload.summary || {};
      q.updatePlayerIdentity.run(
        safeString(summary.playerName || currentPlayer?.player_name || '', 80),
        safeString(summary.characterName || currentPlayer?.character_name || 'Agente', 80) || 'Agente',
        socket.data.playerId
      );

      q.upsertState.run(socket.data.playerId, sheetText, summaryText);
      const player = q.playerById.get(socket.data.playerId);
      io.to(`gm:${socket.data.campaignId}`).emit('gm:player_sheet', {
        id: player.id,
        playerName: player.player_name,
        characterName: player.character_name,
        online: true,
        sheet: payload.sheet || {},
        summary: payload.summary || {},
        updatedAt: new Date().toISOString()
      });
      ackOk(ack);
    } catch (err) {
      ackError(ack, err.message || 'Falha ao sincronizar a ficha.');
    }
  });

  socket.on('gm:request_sync', (_payload = {}, ack) => {
    if (!requireGM(socket, ack)) return;
    const table = socket.data.tableCode || q.campaignById.get(socket.data.campaignId)?.code || 'PADRAO';
    io.to(`campaign:${socket.data.campaignId}`).emit('player:sync_request');
    roomPlayers(socket.data.campaignId, true).forEach(player => {
      io.to(`player:${player.id}`).emit('sync_requested', { mesa: table, codigo: player.codigo });
    });
    ackOk(ack, { players: roomPlayers(socket.data.campaignId, true) });
  });

  socket.on('player:leave', (_payload = {}, ack) => {
    if (!requirePlayer(socket, ack)) return;
    const playerId = socket.data.playerId;
    const campaignId = socket.data.campaignId;
    q.setPlayerOnline.run(0, playerId);
    socket.leave(`player:${playerId}`);
    socket.leave(`campaign:${campaignId}`);
    socket.data.role = null;
    socket.data.playerId = null;
    socket.data.campaignId = null;
    sendGMPlayers(campaignId);
    ackOk(ack);
  });

  socket.on('gm:patch_player', (payload = {}, ack) => {
    if (!requireGM(socket, ack)) return;
    const playerId = Number(payload.playerId);
    const player = q.playerById.get(playerId);
    if (!player || player.campaign_id !== socket.data.campaignId) return ackError(ack, 'Jogador não pertence a esta campanha.');
    try {
      const patch = payload.patch || {};
      q.addEvent.run(socket.data.campaignId, playerId, 'patch', safeJson(patch, 512 * 1024));
      io.to(`player:${playerId}`).emit('player:gm_patch', patch);
      ackOk(ack);
    } catch (err) {
      ackError(ack, err.message || 'Falha ao enviar alteração.');
    }
  });

  socket.on('gm:send_event', (payload = {}, ack) => {
    if (!requireGM(socket, ack)) return;
    const playerId = Number(payload.playerId);
    const player = q.playerById.get(playerId);
    if (!player || player.campaign_id !== socket.data.campaignId) return ackError(ack, 'Jogador não pertence a esta campanha.');
    const type = safeString(payload.type, 40);
    if (!['clue', 'equipment', 'ritual', 'power', 'notice'].includes(type)) return ackError(ack, 'Tipo de evento não permitido.');
    try {
      const data = payload.data || {};
      q.addEvent.run(socket.data.campaignId, playerId, type, safeJson(data, 2 * 1024 * 1024));
      io.to(`player:${playerId}`).emit('player:gm_event', { type, data });
      ackOk(ack);
    } catch (err) {
      ackError(ack, err.message || 'Falha ao enviar evento.');
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.role === 'player' && socket.data.playerId) {
      unregisterPlayerSocket(socket, socket.data.playerId, socket.data.campaignId, socket.data.syncCode, socket.data.tableCode);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\nORDEM ONLINE iniciado em http://localhost:${PORT}`);
  console.log(`Mestre:  http://localhost:${PORT}/mestre`);
  console.log(`Jogador: http://localhost:${PORT}/jogador\n`);
});
