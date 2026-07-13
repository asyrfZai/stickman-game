import Peer from 'peerjs';

const ROOM_PREFIX = 'stickbrawl-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const MAX_CLIENTS = 5; // + host = 6 total

// STUN alone only helps two peers discover each other's public address —
// whether a *direct* connection then succeeds still depends on both sides'
// NAT/router type, so without a TURN relay some peer pairs simply can't
// connect (this looks like a join that "hangs" and times out, not an error).
// Open Relay Project's free TURN servers are a well-known no-signup fallback
// for exactly this — best-effort, but far more reliable than STUN-only.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];
const PEER_OPTIONS = { config: { iceServers: ICE_SERVERS } };

function generateRoomCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/**
 * Thin wrapper around PeerJS that gives us:
 *  - host: create a room with a short code, accept up to 5 client connections
 *  - client: join a room by code
 *  - a simple pub/sub `on('data', ...)` for game messages, plus a `broadcast`/`send`
 *
 * No custom signaling server is run by us — PeerJS uses its free public
 * broker only to help two browsers find each other; all game traffic then
 * flows directly peer-to-peer over WebRTC data channels.
 */
export class Network {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.localId = null;
    this.roomCode = null;
    /** @type {Map<string, import('peerjs').DataConnection>} */
    this.connections = new Map();
    this._listeners = {};
  }

  on(event, cb) {
    (this._listeners[event] ??= []).push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    const arr = this._listeners[event];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }

  _emit(event, ...args) {
    (this._listeners[event] || []).forEach((cb) => cb(...args));
  }

  hostRoom() {
    return new Promise((resolve, reject) => {
      const code = generateRoomCode();
      const peer = new Peer(ROOM_PREFIX + code, PEER_OPTIONS);
      this.peer = peer;
      this.isHost = true;
      this.roomCode = code;

      peer.on('open', (id) => {
        this.localId = id;
        resolve(code);
      });

      peer.on('connection', (conn) => {
        if (this.connections.size >= MAX_CLIENTS) {
          conn.on('open', () => {
            conn.send({ type: 'room-full' });
            conn.close();
          });
          return;
        }
        this._attachClientConnection(conn);
      });

      peer.on('error', (err) => {
        this._emit('error', err);
        reject(err);
      });
    });
  }

  _attachClientConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this._emit('client-connected', conn.peer);
    });
    conn.on('data', (data) => this._emit('data', conn.peer, data));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this._emit('client-disconnected', conn.peer);
    });
    conn.on('error', (err) => this._emit('error', err));
  }

  joinRoom(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_OPTIONS);
      this.peer = peer;
      this.isHost = false;
      this.roomCode = code.toUpperCase();

      peer.on('open', (id) => {
        this.localId = id;
        const conn = peer.connect(ROOM_PREFIX + this.roomCode, { reliable: true });

        const timeout = setTimeout(() => {
          reject(new Error('Could not reach a room with that code.'));
        }, 8000);

        conn.on('open', () => {
          clearTimeout(timeout);
          this.connections.set(conn.peer, conn);
          resolve();
        });
        conn.on('data', (data) => {
          if (data?.type === 'room-full') {
            reject(new Error('That room is full (6 players max).'));
            return;
          }
          this._emit('data', conn.peer, data);
        });
        conn.on('close', () => this._emit('host-disconnected'));
        conn.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      peer.on('error', (err) => {
        this._emit('error', err);
        reject(err);
      });
    });
  }

  /** Host -> all clients */
  broadcast(msg) {
    for (const conn of this.connections.values()) {
      if (conn.open) conn.send(msg);
    }
  }

  /** Host -> one client */
  send(peerId, msg) {
    const conn = this.connections.get(peerId);
    if (conn?.open) conn.send(msg);
  }

  /** Client -> host (its only connection) */
  sendToHost(msg) {
    const conn = this.connections.values().next().value;
    if (conn?.open) conn.send(msg);
  }

  destroy() {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.peer?.destroy();
  }
}
