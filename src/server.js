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
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_DIR = path.join(__dirname, '..', 'server', 'data');
const gameManager = new GameManager(io, DATA_DIR);
const restartToken = process.env.RESTART_TOKEN;

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

io.on('connection', (socket) => {
    const roomId = socket.handshake.query.roomId || 'lobby';
    const room = gameManager.getRoom(roomId);
    room.addSocket(socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
