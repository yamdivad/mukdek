const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const path = require('path');
const GameManager = require('./managers/GameManager');

const app = express();
const server = http.createServer(app);

function normalizeOrigin(value) {
    if (!value) return null;
    try {
        return new URL(String(value).trim()).origin;
    } catch (err) {
        return null;
    }
}

const allowedOrigins = new Set(
    [
        process.env.PUBLIC_ORIGIN,
        process.env.RENDER_EXTERNAL_URL,
        ...(process.env.ALLOWED_ORIGINS || '').split(',')
    ]
        .map(normalizeOrigin)
        .filter(Boolean)
);

const isSameOrigin = (origin, req) => {
    if (!origin || !req) return false;
    try {
        const originHost = new URL(origin).host.toLowerCase();
        const reqHost = String(
            req.headers['x-forwarded-host'] || req.headers.host || ''
        ).toLowerCase();
        return originHost === reqHost;
    } catch (err) {
        return false;
    }
};

const isOriginAllowed = (origin, req) => {
    if (!origin) return true;
    try {
        const normalized = new URL(origin).origin;
        if (allowedOrigins.has(normalized)) return true;
    } catch (err) {
        return false;
    }
    if (allowedOrigins.size === 0 && isSameOrigin(origin, req)) return true;
    return false;
};

const io = socketIo(server, {
    cors: {
        origin: allowedOrigins.size === 0
            ? true
            : (origin, callback) => {
                if (!origin || isOriginAllowed(origin)) return callback(null, true);
                return callback(new Error('Origin not allowed'));
            },
        credentials: true
    },
    allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        callback(null, isOriginAllowed(origin, req));
    }
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data');
const gameManager = new GameManager(io, DATA_DIR);
const restartToken = process.env.RESTART_TOKEN;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const adminToken = process.env.ADMIN_TOKEN;

const isLocalRequest = (req) => {
    const raw = String(req.ip || '').toLowerCase();
    return raw === '::1' || raw === '127.0.0.1' || raw.endsWith('::ffff:127.0.0.1');
};

const isRestartAllowed = (req) => {
    if (isLocalRequest(req)) return true;
    if (!restartToken) return false;
    const token = String(req.query.token || req.headers['x-restart-token'] || '');
    return token && token === restartToken;
};

const isAdminAllowed = (req) => {
    if (isLocalRequest(req)) return true;
    if (!adminToken) return false;
    const token = String(req.query.token || req.headers['x-admin-token'] || '');
    return token && token === adminToken;
};

app.get('/restart', (req, res) => {
    if (!isRestartAllowed(req)) {
        res.status(403).send('Forbidden');
        return;
    }
    const roomId = req.query.room || 'lobby';
    gameManager.restartRoom(roomId);
    res.redirect(`/?room=${encodeURIComponent(roomId)}`);
});

app.get('/rooms', (req, res) => {
    res.json({ rooms: gameManager.getRoomsSummary() });
});

app.get('/push/vapid-public-key', (req, res) => {
    if (!vapidPublicKey) {
        res.status(503).json({ error: 'Push not configured' });
        return;
    }
    res.json({ publicKey: vapidPublicKey });
});

app.post('/push/subscribe', (req, res) => {
    const { roomId, sessionId, subscription } = req.body || {};
    if (!roomId || !sessionId || !subscription) {
        res.status(400).json({ error: 'Missing payload' });
        return;
    }
    const room = gameManager.getRoom(roomId);
    room.setPushSubscription(sessionId, subscription);
    res.json({ ok: true });
});

app.post('/push/unsubscribe', (req, res) => {
    const { roomId, sessionId } = req.body || {};
    if (!roomId || !sessionId) {
        res.status(400).json({ error: 'Missing payload' });
        return;
    }
    const room = gameManager.getRoom(roomId);
    room.removePushSubscription(sessionId);
    res.json({ ok: true });
});

app.get('/admin', (req, res) => {
    if (!isAdminAllowed(req)) {
        res.status(403).send('Forbidden');
        return;
    }
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mukdek Admin</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: "Trebuchet MS", Arial, sans-serif; margin: 24px; background: #f6efe8; color: #3e2723; }
    h1 { font-size: 20px; text-transform: uppercase; letter-spacing: 2px; }
    .card { background: #fff; border: 1px solid #d7ccc8; border-radius: 12px; padding: 16px; margin-top: 16px; }
    label { font-weight: bold; display: block; margin-bottom: 6px; }
    input { padding: 8px 10px; border-radius: 8px; border: 1px solid #c7b8ad; width: 220px; }
    button { padding: 8px 12px; border: none; border-radius: 8px; background: #5d4037; color: #fff; cursor: pointer; }
    button.danger { background: #c62828; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .rooms { margin-top: 12px; display: grid; gap: 8px; }
    .room { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #f1e5dc; border-radius: 10px; }
    .muted { color: #6d4c41; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Mukdek Admin</h1>
  <div class="card">
    <div class="row">
      <div>
        <label for="room-id-input">Delete room by ID</label>
        <input id="room-id-input" type="text" placeholder="room-id" />
      </div>
      <button id="delete-room-btn" class="danger" type="button">Delete Room</button>
    </div>
    <p class="muted">This deletes the room state immediately.</p>
  </div>

  <div class="card">
    <div class="row">
      <h2 style="margin:0; font-size: 16px;">Active Rooms</h2>
      <button id="refresh-btn" type="button">Refresh</button>
    </div>
    <div id="rooms-list" class="rooms"></div>
  </div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    const roomsList = document.getElementById('rooms-list');
    const refreshBtn = document.getElementById('refresh-btn');
    const deleteBtn = document.getElementById('delete-room-btn');
    const roomInput = document.getElementById('room-id-input');

    async function fetchRooms() {
      roomsList.textContent = 'Loading...';
      try {
        const res = await fetch('/rooms');
        const data = await res.json();
        const rooms = Array.isArray(data.rooms) ? data.rooms : [];
        if (!rooms.length) {
          roomsList.textContent = 'No active rooms.';
          return;
        }
        roomsList.innerHTML = '';
        rooms.forEach((room) => {
          const row = document.createElement('div');
          row.className = 'room';
          const label = document.createElement('div');
          label.textContent = room.roomId + ' · ' + (room.hasGame ? 'in-game' : 'lobby') + ' · ' + room.seatedCount + ' seated';
          const btn = document.createElement('button');
          btn.className = 'danger';
          btn.textContent = 'Delete';
          btn.addEventListener('click', () => deleteRoom(room.roomId));
          row.appendChild(label);
          row.appendChild(btn);
          roomsList.appendChild(row);
        });
      } catch (err) {
        roomsList.textContent = 'Failed to load rooms.';
      }
    }

    async function deleteRoom(roomId) {
      if (!roomId) return;
      const ok = window.confirm('Delete room ' + roomId + '?');
      if (!ok) return;
      const res = await fetch('/admin/rooms/' + encodeURIComponent(roomId) + '/delete?token=' + encodeURIComponent(token), {
        method: 'POST'
      });
      if (res.ok) {
        await fetchRooms();
      } else {
        alert('Delete failed.');
      }
    }

    refreshBtn.addEventListener('click', fetchRooms);
    deleteBtn.addEventListener('click', () => {
      deleteRoom(roomInput.value.trim());
    });

    fetchRooms();
  </script>
</body>
</html>`);
});

app.post('/admin/rooms/:roomId/delete', (req, res) => {
    if (!isAdminAllowed(req)) {
        res.status(403).send('Forbidden');
        return;
    }
    const roomId = req.params.roomId || 'lobby';
    gameManager.restartRoom(roomId);
    res.json({ ok: true, roomId });
});

io.on('connection', (socket) => {
    const roomId = socket.handshake.query.roomId || 'lobby';
    const room = gameManager.getRoom(roomId);
    room.addSocket(socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
