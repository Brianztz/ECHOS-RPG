(() => {
  'use strict';

  if (window.io) return;

  function normalizeRoom(value) {
    const normalized = String(value || 'PADRAO')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return normalized || 'PADRAO';
  }

  function roomFromPage() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('mesa') || params.get('sala');
    if (fromUrl) return normalizeRoom(fromUrl);
    const master = location.pathname.includes('/mestre');
    return normalizeRoom(localStorage.getItem(master ? 'master_table_code' : 'player_table_code') || 'PADRAO');
  }

  class EchosSocket {
    constructor(options = {}) {
      this.options = options;
      this.ws = null;
      this.connected = false;
      this.manualClose = false;
      this.room = roomFromPage();
      this.queue = [];
      this.retryTimer = null;
      this.retryMs = 600;
      this.listeners = new Map();
      this.pendingAcks = new Map();
      this.ackSeq = 1;
      if (options.autoConnect !== false) this.connect();
    }

    on(event, handler) {
      if (typeof handler !== 'function') return this;
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(handler);
      return this;
    }

    off(event, handler) {
      if (!event) {
        this.listeners.clear();
        return this;
      }
      const set = this.listeners.get(event);
      if (!set) return this;
      if (handler) set.delete(handler); else set.clear();
      return this;
    }

    once(event, handler) {
      const wrapped = (...args) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }

    dispatch(event, ...args) {
      const set = this.listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(...args); } catch (err) { console.error('[ECHOS socket listener]', event, err); }
      }
    }

    desiredRoom(data) {
      if (data && typeof data === 'object' && data.mesa) return normalizeRoom(data.mesa);
      return this.room || roomFromPage();
    }

    emit(event, data, ack) {
      if (typeof data === 'function') {
        ack = data;
        data = {};
      }
      const packet = { t: 'event', event, data: data ?? {} };
      if (typeof ack === 'function') {
        const id = String(this.ackSeq++);
        packet.ackId = id;
        this.pendingAcks.set(id, { fn: ack, at: Date.now() });
        setTimeout(() => {
          const pending = this.pendingAcks.get(id);
          if (!pending) return;
          this.pendingAcks.delete(id);
          try { pending.fn({ ok: false, error: 'Tempo esgotado ao falar com o servidor.' }); } catch {}
        }, 15000);
      }

      const desired = this.desiredRoom(packet.data);
      if (desired !== this.room) {
        this.room = desired;
        this.queue.push(packet);
        this.reconnectForRoom();
        return this;
      }

      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.queue.push(packet);
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
        return this;
      }

      this.send(packet);
      return this;
    }

    send(packet) {
      try { this.ws.send(JSON.stringify(packet)); }
      catch {
        this.queue.unshift(packet);
        this.connected = false;
        this.scheduleReconnect();
      }
    }

    flush() {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const items = this.queue.splice(0);
      for (const packet of items) this.send(packet);
    }

    connect() {
      clearTimeout(this.retryTimer);
      this.manualClose = false;
      if (this.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.ws.readyState)) return this;

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${location.host}/ws?mesa=${encodeURIComponent(this.room || roomFromPage())}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.connected = true;
        this.retryMs = 600;
        this.dispatch('connect');
        this.flush();
      });

      ws.addEventListener('message', event => {
        if (this.ws !== ws) return;
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        if (packet?.t === 'ack') {
          const pending = this.pendingAcks.get(String(packet.id));
          if (!pending) return;
          this.pendingAcks.delete(String(packet.id));
          try { pending.fn(packet.data); } catch (err) { console.error('[ECHOS ack]', err); }
          return;
        }
        if (packet?.t === 'event' && packet.event) {
          this.dispatch(packet.event, packet.data);
        }
      });

      ws.addEventListener('close', () => {
        if (this.ws !== ws) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        if (wasConnected) this.dispatch('disconnect');
        if (!this.manualClose) this.scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        if (this.ws === ws && ws.readyState !== WebSocket.CLOSED) {
          try { ws.close(); } catch {}
        }
      });

      return this;
    }

    reconnectForRoom() {
      clearTimeout(this.retryTimer);
      this.manualClose = false;
      const old = this.ws;
      this.connected = false;
      this.ws = null;
      if (old && old.readyState <= WebSocket.OPEN) {
        try { old.close(1000, 'room-change'); } catch {}
      }
      setTimeout(() => this.connect(), 20);
    }

    scheduleReconnect() {
      if (this.manualClose || this.retryTimer) return;
      const wait = this.retryMs;
      this.retryMs = Math.min(7000, Math.round(this.retryMs * 1.65));
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, wait);
    }

    disconnect() {
      this.manualClose = true;
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      const ws = this.ws;
      this.ws = null;
      const wasConnected = this.connected;
      this.connected = false;
      if (ws) {
        try { ws.close(1000, 'client-disconnect'); } catch {}
      }
      if (wasConnected) this.dispatch('disconnect');
      return this;
    }
  }

  window.io = function io(options) {
    return new EchosSocket(options || {});
  };
})();
