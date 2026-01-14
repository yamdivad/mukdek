const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const path = require('path');
const RoomManager = require('./rooms/RoomManager');

const app = express();
const server = http.createServer(app);

const allowedOrigins = new Set(
    [
        process.env.PUBLIC_ORIGIN,
        process.env.RENDER_EXTERNAL_URL,
        ...(process.env.ALLOWED_ORIGINS || '').split(',')
    ]
        .map((origin) => (origin || '').trim())
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

const DATA_DIR = path.join(__dirname, 'data');
const roomManager = new RoomManager(io, DATA_DIR);

app.get('/restart', (req, res) => {
    const roomId = req.query.room || 'lobby';
    roomManager.restartRoom(roomId);
    res.redirect(`/?room=${encodeURIComponent(roomId)}`);
});

io.on('connection', (socket) => {
    const roomId = socket.handshake.query.roomId || 'lobby';
    const room = roomManager.getRoom(roomId);
    room.addSocket(socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
