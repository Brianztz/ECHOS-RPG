import {audioEvent,audioResponse} from './audio-server.mjs';
import { publishClues } from './miro-clues.mjs';
const MAX_SHEET_CHARS = 6_000_000;
const CHUNK_CHARS = 350_000;
const MAX_PENDING_EVENTS = 30;
const MAX_EVENT_CHARS = 700_000;

function normalizeTableCode(value) {
  const normalized = String(value || 'PADRAO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || 'PADRAO';
}

function safeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

function safeText(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function jsonClone(value, fallback = {}) {
  try { return JSON.parse(JSON.stringify(value ?? fallback)); }
  catch { return fallback; }
}

function compactSummary(summary = {}, sheet = {}) {
  const fields = sheet?.fields || {};
  return {
    playerName: safeText(summary.playerName ?? fields.player, 80),
    characterName: safeText(summary.characterName ?? fields.name, 80) || 'Agente',
    nex: safeNumber(summary.nex ?? fields.nex),
    className: safeText(summary.className ?? fields.class, 80),
    origin: safeText(summary.origin ?? fields.origin, 80),
    trail: safeText(summary.trail ?? fields.trail, 80),
    level: safeNumber(summary.level ?? fields.level),
    defense: safeNumber(summary.defense),
    pv: safeNumber(summary.pv ?? fields.pvCur),
    pvMax: safeNumber(summary.pvMax),
    san: safeNumber(summary.san ?? fields.sanCur),
    sanMax: safeNumber(summary.sanMax),
    pe: safeNumber(summary.pe ?? fields.peCur),
    peMax: safeNumber(summary.peMax),
    radiation: Math.max(0, Math.min(7, safeNumber(summary.radiation ?? fields.radiation))),
    conditions: Array.isArray(summary.conditions) ? summary.conditions.map(x => safeText(x, 60)).filter(Boolean).slice(0, 40) : [],
    inventoryCount: safeNumber(summary.inventoryCount),
    ritualCount: safeNumber(summary.ritualCount),
    powerCount: safeNumber(summary.powerCount),
    updatedAt: new Date().toISOString()
  };
}

function pickSheetPreview(sheet = {}, summary = {}) {
  const fields = sheet?.fields || {};
  return {
    fields: {
      player: safeText(fields.player ?? summary.playerName, 80),
      name: safeText(fields.name ?? summary.characterName, 80),
      nex: fields.nex ?? summary.nex ?? 0,
      class: fields.class ?? summary.className ?? '',
      origin: fields.origin ?? summary.origin ?? '',
      trail: fields.trail ?? summary.trail ?? '',
      level: fields.level ?? summary.level ?? 0,
      pvCur: fields.pvCur ?? summary.pv ?? 0,
      sanCur: fields.sanCur ?? summary.san ?? 0,
      peCur: fields.peCur ?? summary.pe ?? 0,
      radiation: fields.radiation ?? summary.radiation ?? 0,
      portraitData: summary.portrait || ''
    }
  };
}

function makeEvent(event, data) {
  return JSON.stringify({ t: 'event', event, data });
}

function makeAck(id, data) {
  return JSON.stringify({ t: 'ack', id, data });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'echos-rpg', runtime: 'cloudflare-workers' }, {
        headers: { 'cache-control': 'no-store' }
      });
    }

    if(url.pathname==='/api/audio')return env.ROOMS.getByName(normalizeTableCode(url.searchParams.get('mesa'))).fetch(request);
    if (url.pathname === '/ws') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const table = normalizeTableCode(url.searchParams.get('mesa'));
      const room = env.ROOMS.getByName(table);
      return room.fetch(request);
    }

    if (url.pathname === '/jogador') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/jogador/index.html';
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    if (url.pathname === '/mestre') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/mestre/index.html';
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if(new URL(request.url).pathname==='/api/audio')return audioResponse(request,this.ctx.storage);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('WebSocket only', { status: 426 });
    }

    const url = new URL(request.url);
    const table = normalizeTableCode(url.searchParams.get('mesa'));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      sessionId: crypto.randomUUID(),
      role: 'guest',
      table,
      playerCode: null,
      playerId: null,
      connectedAt: Date.now()
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let packet;
    try {
      packet = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return this.sendAck(ws, null, { ok: false, error: 'Mensagem inválida.' });
    }

    if (!packet || packet.t !== 'event' || typeof packet.event !== 'string') return;

    try {
      const result = await this.handleEvent(ws, packet.event, packet.data ?? {});
      if (packet.ackId) this.sendAck(ws, packet.ackId, result ?? { ok: true });
    } catch (error) {
      if (packet.ackId) this.sendAck(ws, packet.ackId, { ok: false, error: error?.message || 'Erro interno.' });
      else this.sendEvent(ws, 'server:error', { error: error?.message || 'Erro interno.' });
    }
  }

  async webSocketClose(ws, code, reason) {
    const meta = ws.deserializeAttachment?.() || {};
    if (meta.role === 'player' && meta.playerCode) {
      await this.onPlayerSocketClosed(meta.playerCode, meta.playerId);
    }
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError(ws) {
    const meta = ws.deserializeAttachment?.() || {};
    if (meta.role === 'player' && meta.playerCode) {
      await this.onPlayerSocketClosed(meta.playerCode, meta.playerId);
    }
  }

  sendAck(ws, id, data) {
    if (!id) return;
    try { ws.send(makeAck(id, data)); } catch {}
  }

  sendEvent(ws, event, data) {
    try { ws.send(makeEvent(event, data)); } catch {}
  }

  sockets(predicate = () => true) {
    return this.ctx.getWebSockets().filter(ws => {
      try { return predicate(ws.deserializeAttachment?.() || {}); }
      catch { return false; }
    });
  }

  broadcast(event, data, predicate) {
    for (const ws of this.sockets(predicate)) this.sendEvent(ws, event, data);
  }

  async getIndex() {
    return (await this.ctx.storage.get('players:index')) || {};
  }

  async putIndex(index) {
    await this.ctx.storage.put('players:index', index);
  }

  async nextPlayerId() {
    const current = safeNumber(await this.ctx.storage.get('players:nextId'), 1);
    await this.ctx.storage.put('players:nextId', current + 1);
    return current;
  }

  async ensurePlayer(code, payload = {}) {
    const index = await this.getIndex();
    let record = index[code];
    const sheet = payload.fullData || payload.sheet || {};
    const summary = compactSummary(payload.summary || {
      playerName: payload.playerName,
      characterName: payload.nome || payload.characterName,
      nex: payload.nex,
      defense: payload.defesa,
      pv: payload.vida_atual,
      pvMax: payload.vida_max,
      san: payload.sani_atual,
      sanMax: payload.sani_max,
      pe: payload.pe_atual,
      peMax: payload.pe_max,
      radiation: payload.radiacao,
      conditions: payload.status
    }, sheet);

    if (!record) {
      record = { id: await this.nextPlayerId(), code, createdAt: new Date().toISOString() };
    }

    record.playerName = summary.playerName;
    record.characterName = summary.characterName;
    record.summary = summary;
    record.updatedAt = new Date().toISOString();
    index[code] = record;
    await this.putIndex(index);
    return record;
  }

  async findPlayerById(playerId) {
    const id = Number(playerId);
    const index = await this.getIndex();
    for (const [code, record] of Object.entries(index)) {
      if (Number(record.id) === id) return { code, record };
    }
    return null;
  }

  async saveSheet(code, sheet) {
    const text = JSON.stringify(sheet || {});
    if (text.length > MAX_SHEET_CHARS) throw new Error('A ficha excedeu o limite de sincronização online.');

    const oldMeta = (await this.ctx.storage.get(`sheet:${code}:meta`)) || { chunks: 0 };
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));
    if (!chunks.length) chunks.push('{}');

    for (let i = 0; i < chunks.length; i++) {
      await this.ctx.storage.put(`sheet:${code}:${i}`, chunks[i]);
    }
    for (let i = chunks.length; i < safeNumber(oldMeta.chunks); i++) {
      await this.ctx.storage.delete(`sheet:${code}:${i}`);
    }
    await this.ctx.storage.put(`sheet:${code}:meta`, { chunks: chunks.length, updatedAt: new Date().toISOString() });
  }

  async loadSheet(code) {
    const meta = await this.ctx.storage.get(`sheet:${code}:meta`);
    if (!meta?.chunks) return {};

    let text = '';
    for (let i = 0; i < meta.chunks; i++) {
      text += (await this.ctx.storage.get(`sheet:${code}:${i}`)) || '';
    }
    try { return JSON.parse(text || '{}'); }
    catch { return {}; }
  }

  isPlayerOnline(code) {
    return this.sockets(meta => meta.role === 'player' && meta.playerCode === code).length > 0;
  }

  async savePortrait(code, sheet = {}, payload = {}) {
    const portrait = typeof payload.foto === 'string' ? payload.foto : (typeof sheet?.fields?.portraitData === 'string' ? sheet.fields.portraitData : '');
    if (!portrait) {
      await this.ctx.storage.delete(`portrait:${code}`);
      return;
    }
    // A foto fica separada do índice dos jogadores para o índice nunca crescer demais.
    await this.ctx.storage.put(`portrait:${code}`, portrait.slice(0, 1_500_000));
  }

  async loadPortrait(code) {
    return (await this.ctx.storage.get(`portrait:${code}`)) || '';
  }

  async publicPlayer(code, record, options = {}) {
    const sheet = options.full ? await this.loadSheet(code) : null;
    const summary = record.summary || {};
    const portrait = await this.loadPortrait(code);
    const result = {
      id: record.id,
      dbId: record.id,
      codigo: code,
      mesa: options.table || 'PADRAO',
      nome: summary.characterName || record.characterName || 'Agente',
      playerName: summary.playerName || record.playerName || '',
      characterName: summary.characterName || record.characterName || 'Agente',
      nex: safeNumber(summary.nex),
      defesa: safeNumber(summary.defense),
      vida_atual: safeNumber(summary.pv),
      vida_max: safeNumber(summary.pvMax),
      sani_atual: safeNumber(summary.san),
      sani_max: safeNumber(summary.sanMax),
      pe_atual: safeNumber(summary.pe),
      pe_max: safeNumber(summary.peMax),
      radiacao: safeNumber(summary.radiation),
      status: Array.isArray(summary.conditions) ? summary.conditions : [],
      initiative: record.initiative || null,
      summary: { ...summary, portrait },
      sheet: pickSheetPreview(sheet || {}, { ...summary, portrait }),
      online: this.isPlayerOnline(code),
      updatedAt: record.updatedAt || null
    };
    if (options.full) result.fullData = sheet;
    return result;
  }

  async onlinePlayers(table) {
    const index = await this.getIndex();
    const result = [];
    for (const [code, record] of Object.entries(index)) {
      if (!this.isPlayerOnline(code)) continue;
      result.push(await this.publicPlayer(code, record, { table }));
    }
    result.sort((a, b) => Number(a.id) - Number(b.id));
    return result;
  }

  async broadcastSnapshot(table) {
    const players = await this.onlinePlayers(table);
    this.broadcast('gm:players', players, meta => meta.role === 'gm');
  }

  async queueEvent(code, event) {
    const serialized = JSON.stringify(event);
    if (serialized.length > MAX_EVENT_CHARS) throw new Error('Evento grande demais para fila offline.');
    const key = `pending:${code}`;
    const pending = (await this.ctx.storage.get(key)) || [];
    pending.push(event);
    while (pending.length > MAX_PENDING_EVENTS) pending.shift();
    await this.ctx.storage.put(key, pending);
  }

  async flushPending(code) {
    const key = `pending:${code}`;
    const pending = (await this.ctx.storage.get(key)) || [];
    if (!pending.length) return;
    const targets = this.sockets(meta => meta.role === 'player' && meta.playerCode === code);
    if (!targets.length) return;

    for (const event of pending) {
      for (const ws of targets) this.sendEvent(ws, 'player:gm_event', event);
    }
    await this.ctx.storage.delete(key);
  }

  async onPlayerSocketClosed(code, playerId) {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (this.isPlayerOnline(code)) return;
    const table = this.sockets(meta => meta.role === 'gm')[0]?.deserializeAttachment?.()?.table || 'PADRAO';
    this.broadcast('player_disconnected', { codigo: code, mesa: table }, meta => meta.role === 'gm');
    await this.broadcastSnapshot(table);
  }

  async handleEvent(ws, event, payload) {
    const meta = ws.deserializeAttachment?.() || { role: 'guest', table: 'PADRAO' };
    const table = normalizeTableCode(payload?.mesa || meta.table || 'PADRAO');

    if(['gm:audio_start','gm:audio_chunk','gm:audio_finish'].includes(event))return audioEvent(this,ws,event,payload);
    switch (event) {
      case 'master_ready': {
        if (meta.role === 'player') return { ok: false, error: 'Esta conexão já pertence a um jogador.' };
        ws.serializeAttachment({ ...meta, role: 'gm', table });
        const players = await this.onlinePlayers(table);
        this.sendEvent(ws, 'players_snapshot', players);
        return { ok: true, mesa: table, players };
      }

      case 'status_change': {
        const code = safeCode(payload.codigo || payload.id);
        if (!code) return { ok: false, error: 'Código da ficha ausente.' };

        const record = await this.ensurePlayer(code, payload);
        const sheet = payload.fullData || payload.sheet || {};
        await this.saveSheet(code, sheet);
        await this.savePortrait(code, sheet, payload);
        ws.serializeAttachment({ ...meta, role: 'player', table, playerCode: code, playerId: record.id });

        const player = await this.publicPlayer(code, record, { table });
        this.broadcast('update_mestre', player, x => x.role === 'gm');
        this.broadcast('gm:player_sheet', player, x => x.role === 'gm');
        await this.broadcastSnapshot(table);
        await this.flushPending(code);
        return { ok: true, codigo: code, mesa: table, playerId: record.id };
      }

      case 'master_request_sync':
      case 'gm:request_sync': {
        if (meta.role !== 'gm') return { ok: false, error: 'Ação exclusiva do mestre.' };
        const players = await this.onlinePlayers(table);
        for (const player of players) {
          this.broadcast('sync_requested', { mesa: table, codigo: player.codigo }, x => x.role === 'player' && x.playerCode === player.codigo);
          this.broadcast('player:sync_request', {}, x => x.role === 'player' && x.playerCode === player.codigo);
        }
        return { ok: true, players };
      }

      case 'request_player': {
        const code = safeCode(payload.codigo);
        const index = await this.getIndex();
        const record = index[code];
        if (!record) return { ok: false, error: 'Ficha não encontrada.' };
        const player = await this.publicPlayer(code, record, { table, full: true });
        this.sendEvent(ws, 'update_mestre', player);
        return { ok: true, player };
      }

      case 'master_update_player': {
        if (meta.role !== 'gm') return { ok: false, error: 'Ação exclusiva do mestre.' };
        const code = safeCode(payload.codigo || payload.id);
        const index = await this.getIndex();
        const record = index[code];
        if (!record) return { ok: false, error: 'Ficha não encontrada.' };

        const currentSheet = await this.loadSheet(code);
        const sheet = payload.fullData || payload.sheet || currentSheet;
        const summary = compactSummary(payload.summary || record.summary || {}, sheet);
        record.summary = summary;
        record.playerName = summary.playerName;
        record.characterName = summary.characterName;
        record.updatedAt = new Date().toISOString();
        index[code] = record;
        await this.putIndex(index);
        await this.saveSheet(code, sheet);
        await this.savePortrait(code, sheet, payload);

        const fullPlayer = await this.publicPlayer(code, record, { table, full: true });
        this.broadcast('player_data_updated', fullPlayer, x => x.role === 'player' && x.playerCode === code);
        const compact = await this.publicPlayer(code, record, { table });
        this.broadcast('update_mestre', compact, x => x.role === 'gm');
        return { ok: true, player: compact };
      }

      case 'gm:patch_player': {
        if (meta.role !== 'gm') return { ok: false, error: 'Ação exclusiva do mestre.' };
        const found = await this.findPlayerById(payload.playerId);
        if (!found) return { ok: false, error: 'Jogador não encontrado.' };
        const { code, record } = found;
        const patch = jsonClone(payload.patch || {}, {});
        const sheet = await this.loadSheet(code);
        sheet.fields = sheet.fields || {};
        Object.assign(sheet.fields, patch.fields || {});

        const summary = { ...(record.summary || {}) };
        const fieldMap = {
          pvCur: 'pv', sanCur: 'san', peCur: 'pe', radiation: 'radiation',
          name: 'characterName', player: 'playerName', nex: 'nex', class: 'className', origin: 'origin', trail: 'trail', level: 'level'
        };
        for (const [field, value] of Object.entries(patch.fields || {})) {
          if (fieldMap[field]) summary[fieldMap[field]] = value;
        }
        if (Array.isArray(patch.conditions)) summary.conditions = patch.conditions;
        record.summary = compactSummary(summary, sheet);
        record.playerName = record.summary.playerName;
        record.characterName = record.summary.characterName;
        record.updatedAt = new Date().toISOString();

        const index = await this.getIndex();
        index[code] = record;
        await this.putIndex(index);
        await this.saveSheet(code, sheet);

        this.broadcast('player:gm_patch', patch, x => x.role === 'player' && x.playerCode === code);
        const player = await this.publicPlayer(code, record, { table });
        this.broadcast('update_mestre', player, x => x.role === 'gm');
        this.broadcast('gm:player_sheet', player, x => x.role === 'gm');
        return { ok: true, player };
      }

      case 'player:initiative': {
        if(meta.role!=='player'||!meta.playerCode)return {ok:false,error:'Conecte a ficha antes de rolar iniciativa.'};
        const total=payload.total;
        if(!Number.isFinite(total)||!Number.isInteger(total)||Math.abs(total)>10000)return {ok:false,error:'Iniciativa inválida.'};
        const index=await this.getIndex(),record=index[meta.playerCode];
        if(!record)return {ok:false,error:'Ficha não encontrada.'};
        const roll={id:safeText(payload.rollId,80)||crypto.randomUUID(),total,at:Date.now()};
        if(record.initiative?.id===roll.id)return {ok:true};
        record.initiative=roll;index[meta.playerCode]=record;await this.putIndex(index);
        const player=await this.publicPlayer(meta.playerCode,record,{table:meta.table});
        this.broadcast('gm:initiative',{player,roll},x=>x.role==='gm'&&x.table===meta.table);
        return {ok:true};
      }

      case 'gm:publish_clues': {
        if(meta.role!=='gm')return {ok:false,error:'Ação exclusiva do mestre.'};
        if(this.miroBusy)return {ok:false,error:'Já existe um envio em andamento.'};
        this.miroBusy=true;
        try{return await publishClues(this.env,this.ctx.storage,payload.nodes);}
        finally{this.miroBusy=false;}
      }

      case 'gm:send_event': {
        if (meta.role !== 'gm') return { ok: false, error: 'Ação exclusiva do mestre.' };
        const found = await this.findPlayerById(payload.playerId);
        if (!found) return { ok: false, error: 'Jogador não encontrado.' };
        const type = safeText(payload.type, 40);
        if (!type) return { ok: false, error: 'Tipo de evento ausente.' };
        const eventPayload = { type, data: jsonClone(payload.data, {}), sentAt: new Date().toISOString() };
        const targets = this.sockets(x => x.role === 'player' && x.playerCode === found.code);
        if (targets.length) {
          for (const target of targets) this.sendEvent(target, 'player:gm_event', eventPayload);
          return { ok: true, delivered: true };
        }
        await this.queueEvent(found.code, eventPayload);
        return { ok: true, delivered: false, queued: true };
      }

      case 'player:leave': {
        const current = ws.deserializeAttachment?.() || {};
        if (current.role === 'player' && current.playerCode) {
          ws.serializeAttachment({ ...current, role: 'guest', playerCode: null, playerId: null });
          await this.onPlayerSocketClosed(current.playerCode, current.playerId);
        }
        return { ok: true };
      }

      default:
        return { ok: false, error: `Evento não suportado: ${event}` };
    }
  }
}




