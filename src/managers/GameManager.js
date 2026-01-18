const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const BotAgent = require('./BotAgent');
const HardBotAgent = require('./HardBotAgent');
const gameLogic = require(path.join(__dirname, '..', '..', 'public', 'js', 'gameLogic.js'));

const RATE_LIMIT_MS = 200;
const SIMILARITY_THRESHOLD = 10;
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS) || (1000 * 60 * 60 * 24 * 15);
const ROOM_CLEANUP_INTERVAL_MS = Number(process.env.ROOM_CLEANUP_INTERVAL_MS) || (1000 * 60 * 10);
const EMOJI_REACTIONS = new Set(['😀', '🤣', '😎', '😡', '😱', '😳', '💩', '🫠', '☠️', '🎻']);
const TURN_NOTIFICATION_DELAY_MS = Number(process.env.TURN_NOTIFICATION_DELAY_MS) || 60000;
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (PUSH_ENABLED) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const BOT_PREFERRED_COLORS = {
    1: '#e74c3c',
    2: '#2ecc71',
    3: '#f1c40f',
    4: '#3498db',
    5: '#ff9800',
    6: '#9c27b0'
};

const SERVER_PALETTE = [
    "#e74c3c", "#e91e63", "#1b5e20", "#2ecc71", "#1565c0",
    "#3498db", "#ffffff", "#212121", "#f1c40f", "#ff9800", "#9c27b0"
];

function sanitizeString(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .trim();
}

function isValidHex(hex) {
    return /^#[0-9A-F]{6}$/i.test(hex);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function rollDie() {
    return Math.floor(Math.random() * 6) + 1;
}

function getColorDistance(hex1, hex2) {
    const rgb1 = hexToRgb(hex1);
    const rgb2 = hexToRgb(hex2);
    if (!rgb1 || !rgb2) return 0;
    return Math.sqrt(
        Math.pow(rgb1.r - rgb2.r, 2) +
        Math.pow(rgb1.g - rgb2.g, 2) +
        Math.pow(rgb1.b - rgb2.b, 2)
    );
}

function isColorAvailable(targetHex, currentPlayers) {
    if (!isValidHex(targetHex)) return false;
    for (const p of Object.values(currentPlayers)) {
        if (p && p.color) {
            let dist = getColorDistance(targetHex, p.color);
            if (dist < SIMILARITY_THRESHOLD) return false;
        }
    }
    return true;
}

function getNextAvailableBotColor(pid, currentPlayers) {
    let preferred = BOT_PREFERRED_COLORS[pid];
    if (isColorAvailable(preferred, currentPlayers)) return preferred;

    for (let color of SERVER_PALETTE) {
        if (isColorAvailable(color, currentPlayers)) return color;
    }
    return '#999999';
}

function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTimeLocal(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function csvEscape(value) {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

class GameRoom {
    constructor(io, roomId, dataDir) {
        this.io = io;
        this.roomId = roomId;
        this.dataDir = dataDir;

        this.players = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
        this.connectedSockets = new Set();
        this.hostSocketId = null;
        this.gameState = null;
        this.totalPlayersAtStart = 0;
        this.gameDestructionTimeout = null;
        this.gameMode = '4p';
        this.lightningMode = false;
        this.lastActive = Date.now();

        this.persistTimeout = null;
        this.persistInFlight = false;
        this.persistQueued = false;
        this.emojiCooldowns = new Map();
        this.pushSubscriptions = new Map();
        this.lastNotifiedTurn = 0;
        this.turnNotifyTimeout = null;
        this.pendingTurnCounter = null;

        this.botAgent = new BotAgent(this, gameLogic);
        this.hardBotAgent = new HardBotAgent(this, gameLogic);

        this.loadPersistedState();
    }

    getActiveBotAgent() {
        if (this.gameState && this.gameState.mode === '6p' && this.totalPlayersAtStart >= 5) {
            return this.hardBotAgent;
        }
        return this.botAgent;
    }

    clearBotTimers() {
        this.botAgent.clearTimers();
        this.hardBotAgent.clearTimers();
    }

    scheduleBotAction() {
        this.clearBotTimers();
        this.getActiveBotAgent().scheduleNextAction();
    }

    markActive() {
        this.lastActive = Date.now();
    }

    getStateFiles() {
        const fileBase = `room-${this.roomId}`;
        return {
            stateFile: path.join(this.dataDir, `${fileBase}.json`),
            tmpFile: path.join(this.dataDir, `${fileBase}.json.tmp`)
        };
    }

    normalizePlayers(data) {
        const base = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
        if (!data || typeof data !== 'object') return base;
        for (let i = 1; i <= 6; i++) {
            let p = data[i];
            if (!p) continue;
            base[i] = {
                id: p.isBot ? p.id : null,
                session: p.session || null,
                color: p.color || null,
                name: p.name || `P${i}`,
                ready: !!p.ready,
                lastAction: 0,
                isBot: !!p.isBot
            };
        }
        return base;
    }

    normalizePushSubscriptions(data) {
        if (!data || typeof data !== 'object') return new Map();
        const entries = Object.entries(data)
            .filter(([sessionId, sub]) => sessionId && sub && typeof sub.endpoint === 'string')
            .map(([sessionId, sub]) => [sessionId, sub]);
        return new Map(entries);
    }

    buildPersistedState() {
        return {
            players: this.normalizePlayers(this.players),
            gameState: this.gameState,
            gameMode: this.gameMode,
            lightningMode: this.lightningMode,
            totalPlayersAtStart: this.totalPlayersAtStart,
            pushSubscriptions: Object.fromEntries(this.pushSubscriptions),
            lastNotifiedTurn: this.lastNotifiedTurn
        };
    }

    async persistState() {
        if (this.persistInFlight) {
            this.persistQueued = true;
            return;
        }
        this.persistInFlight = true;
        const payload = JSON.stringify(this.buildPersistedState());
        const { stateFile, tmpFile } = this.getStateFiles();
        try {
            await fs.promises.writeFile(tmpFile, payload);
            await fs.promises.rename(tmpFile, stateFile);
        } catch (err) {
            console.error(`Failed to persist state for room ${this.roomId}:`, err);
        } finally {
            this.persistInFlight = false;
            if (this.persistQueued) {
                this.persistQueued = false;
                this.schedulePersist();
            }
        }
    }

    schedulePersist() {
        if (this.persistTimeout) return;
        this.persistTimeout = setTimeout(() => {
            this.persistTimeout = null;
            this.persistState();
        }, 300);
    }

    loadPersistedState() {
        fs.mkdirSync(this.dataDir, { recursive: true });
        const { stateFile } = this.getStateFiles();
        if (!fs.existsSync(stateFile)) return;
        try {
            const raw = fs.readFileSync(stateFile, 'utf8');
            if (!raw) return;
            const data = JSON.parse(raw);
            this.players = this.normalizePlayers(data.players);
            this.gameState = data.gameState || null;
            this.gameMode = ['2p', '4p', '6p'].includes(data.gameMode) ? data.gameMode : '4p';
            this.lightningMode = !!data.lightningMode;
            this.totalPlayersAtStart = Number.isFinite(data.totalPlayersAtStart) ? data.totalPlayersAtStart : 0;
            this.pushSubscriptions = this.normalizePushSubscriptions(data.pushSubscriptions);
            this.lastNotifiedTurn = Number.isFinite(data.lastNotifiedTurn) ? data.lastNotifiedTurn : 0;
            this.hostSocketId = null;
            this.connectedSockets = new Set();
            console.log(`Restored game state for room ${this.roomId}.`);
        } catch (err) {
            console.error(`Failed to load state for room ${this.roomId}:`, err);
        }
    }

    sendCurrentState(socket) {
        socket.emit('lobbyUpdate', this.getLobbyState());
        socket.emit('gameModeUpdate', this.gameMode);
        if (this.gameState) {
            socket.emit('gameStart', this.gameMode);
            socket.emit('gameState', this.gameState);
        }
        socket.emit('lightningStatus', this.lightningMode);
    }

    onRequestState(socket) {
        this.markActive();
        this.sendCurrentState(socket);
    }

    emitLobbyUpdate() {
        this.io.to(this.roomId).emit('lobbyUpdate', this.getLobbyState());
        this.markActive();
        this.schedulePersist();
    }

    emitGameModeUpdate() {
        this.io.to(this.roomId).emit('gameModeUpdate', this.gameMode);
        this.markActive();
        this.schedulePersist();
    }

    emitLightningStatus() {
        this.io.to(this.roomId).emit('lightningStatus', this.lightningMode);
        this.markActive();
        this.schedulePersist();
    }

    broadcastGameState() {
        this.io.to(this.roomId).emit('gameState', this.gameState);
        this.markActive();
        this.schedulePersist();
        this.scheduleBotAction();
        this.scheduleTurnNotification();
    }

    async logGameResultsIfNeeded() {
        if (!this.gameState || this.gameState.phase !== 'gameover') return;
        if (!this.gameState.stats || this.gameState.stats.gameResultsLogged) return;

        const hasBots = Object.values(this.players).some(p => p && p.isBot);
        if (hasBots) {
            this.gameState.stats.gameResultsLogged = true;
            this.schedulePersist();
            return;
        }

        const finishOrder = (this.gameState.finishedPlayers || []).filter((pid) => {
            let p = this.players[pid];
            return p && !p.isBot;
        });
        if (finishOrder.length === 0) return;

        const totalPlayers = this.totalPlayersAtStart || finishOrder.length;
        const now = new Date();
        const dateStr = formatDateLocal(now);
        const timeStr = formatTimeLocal(now);
        const nameMap = this.gameState.playerNames || {};

        const rows = finishOrder.map((pid, idx) => ([
            nameMap[pid] || `P${pid}`,
            dateStr,
            timeStr,
            totalPlayers,
            idx + 1
        ]));

        const filePath = path.join(this.dataDir, 'game-results.csv');
        try {
            await fs.promises.mkdir(this.dataDir, { recursive: true });
            const needsHeader = !fs.existsSync(filePath);
            let payload = '';
            if (needsHeader) payload += 'Name,Date,Time,Total Players,Place\n';
            payload += rows.map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
            await fs.promises.appendFile(filePath, payload);
            this.gameState.stats.gameResultsLogged = true;
            this.schedulePersist();
        } catch (err) {
            console.error(`Failed to write game results for room ${this.roomId}:`, err);
        }
    }

    isRateLimited(playerObj) {
        const now = Date.now();
        if (playerObj.lastAction && (now - playerObj.lastAction < RATE_LIMIT_MS)) {
            return true;
        }
        playerObj.lastAction = now;
        return false;
    }

    get6pRollOptions() {
        if (!this.gameState || this.gameState.mode !== '6p') return [];
        const dice = this.gameState.dice || { values: [], pending: [] };
        const pending = Array.isArray(dice.pending) ? dice.pending : [];
        const values = Array.isArray(dice.values) ? dice.values : [];
        const options = pending.map((slot) => ({
            type: 'die',
            slot,
            value: values[slot]
        }));
        if (pending.length === 2) {
            const sum = (values[pending[0]] || 0) + (values[pending[1]] || 0);
            options.push({ type: 'sum', value: sum });
        }
        return options;
    }

    computeMovesForRoll(rollValue, optionType) {
        let movesMap = [];
        let movable = [];
        let playerMarbles = this.gameState.marbles.filter(m => m.player === this.gameState.activePlayer);

        playerMarbles.forEach(m => {
            let moves = gameLogic.computePossibleMoves(this.gameState.mode, this.gameState.marbles, m.id, rollValue);
            if (optionType === 'sum' && rollValue === 6) {
                moves = moves.filter(move => move.type !== 'spawn');
            }
            if (moves.length > 0) {
                movable.push(m.id);
                movesMap.push([m.id, moves]);
            }
        });

        return { movesMap, movable };
    }

    setSelectedRoll(option) {
        if (!option) {
            this.gameState.selectedRoll = null;
            this.gameState.currentRoll = 0;
            this.gameState.movableMarbles = [];
            this.gameState.possibleMoves = [];
            return;
        }
        const { movesMap, movable } = this.computeMovesForRoll(option.value, option.type);
        this.gameState.selectedRoll = option;
        this.gameState.currentRoll = option.value;
        this.gameState.movableMarbles = movable;
        this.gameState.possibleMoves = movesMap;
    }

    evaluate6pRollOptions() {
        const options = this.get6pRollOptions();
        if (options.length === 0) {
            this.setSelectedRoll(null);
            return false;
        }
        for (const option of options) {
            const { movesMap, movable } = this.computeMovesForRoll(option.value, option.type);
            if (movable.length > 0) {
                this.gameState.selectedRoll = option;
                this.gameState.currentRoll = option.value;
                this.gameState.movableMarbles = movable;
                this.gameState.possibleMoves = movesMap;
                return true;
            }
        }
        this.setSelectedRoll(null);
        return false;
    }

    handle6pNoMoves() {
        const dice = this.gameState.dice || { values: [], pending: [] };
        const values = Array.isArray(dice.values) ? dice.values : [];
        let rerollSlots = values
            .map((value, slot) => ({ value, slot }))
            .filter(entry => entry.value === 1 || entry.value === 6)
            .map(entry => entry.slot);

        let attempts = 0;
        while (rerollSlots.length > 0 && attempts < 10) {
            rerollSlots.forEach(slot => {
                dice.values[slot] = rollDie();
            });
            dice.pending = [0, 1];
            dice.last = [...dice.values];
            this.gameState.dice = dice;
            if (this.evaluate6pRollOptions()) {
                return true;
            }
            rerollSlots = dice.values
                .map((value, slot) => ({ value, slot }))
                .filter(entry => entry.value === 1 || entry.value === 6)
                .map(entry => entry.slot);
            attempts += 1;
        }

        this.setSelectedRoll(null);
        return false;
    }

    updateRollStats(playerId, hasMoves) {
        if (!this.gameState.stats) return;
        const stats = this.gameState.stats;
        if (!hasMoves) {
            stats.noMoveRolls[playerId] = (stats.noMoveRolls[playerId] || 0) + 1;
            stats.hotStreakCurrent[playerId] = 0;
            return;
        }
        const nextStreak = (stats.hotStreakCurrent[playerId] || 0) + 1;
        stats.hotStreakCurrent[playerId] = nextStreak;
        if (nextStreak > (stats.hotStreakBest[playerId] || 0)) {
            stats.hotStreakBest[playerId] = nextStreak;
        }
    }

    isEmojiRateLimited(socketId) {
        const now = Date.now();
        const last = this.emojiCooldowns.get(socketId) || 0;
        if (now - last < 400) return true;
        this.emojiCooldowns.set(socketId, now);
        return false;
    }

    onEmoji(socket, emoji) {
        if (!this.gameState || this.gameState.phase === 'init') return;
        if (typeof emoji !== 'string' || !EMOJI_REACTIONS.has(emoji)) return;

        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;

        if (this.isEmojiRateLimited(socket.id)) return;

        this.io.to(this.roomId).emit('emojiReaction', { emoji });
        this.markActive();
    }

    setPushSubscription(sessionId, subscription) {
        if (!sessionId || !subscription || typeof subscription.endpoint !== 'string') return;
        this.pushSubscriptions.set(sessionId, subscription);
        this.schedulePersist();
    }

    removePushSubscription(sessionId) {
        if (!sessionId) return;
        if (this.pushSubscriptions.delete(sessionId)) {
            this.schedulePersist();
        }
    }

    buildRoomUrl() {
        const base = PUBLIC_ORIGIN ? PUBLIC_ORIGIN.replace(/\/$/, '') : '';
        const path = `/?room=${encodeURIComponent(this.roomId)}`;
        return base ? `${base}${path}` : path;
    }

    async sendTurnNotification() {
        if (!PUSH_ENABLED) return;
        if (!this.gameState || this.gameState.phase !== 'play') return;
        const turnCounter = this.gameState.turnCounter || 0;
        if (turnCounter === this.lastNotifiedTurn) return;

        const playerId = this.gameState.activePlayer;
        const player = this.players[playerId];
        if (!player || player.isBot) {
            this.lastNotifiedTurn = turnCounter;
            return;
        }

        if (player.id && this.connectedSockets.has(player.id)) {
            return;
        }

        const subscription = this.pushSubscriptions.get(player.session);
        if (!subscription) return;

        this.lastNotifiedTurn = turnCounter;
        const playerName = (this.gameState.playerNames && this.gameState.playerNames[playerId]) || `P${playerId}`;
        const roomId = this.roomId;
        const payload = JSON.stringify({
            title: 'Your turn',
            body: `${playerName}, it's your move.`,
            url: this.buildRoomUrl(),
            roomId,
            tag: `mukdek-${roomId}`
        });

        try {
            await webpush.sendNotification(subscription, payload);
        } catch (err) {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                this.removePushSubscription(player.session);
            } else {
                console.error(`Push send failed for room ${this.roomId}:`, err);
            }
        }
    }

    scheduleTurnNotification() {
        if (!PUSH_ENABLED) return;
        if (!this.gameState || this.gameState.phase !== 'play') return;
        const turnCounter = this.gameState.turnCounter || 0;
        if (turnCounter === this.pendingTurnCounter) return;

        if (this.turnNotifyTimeout) {
            clearTimeout(this.turnNotifyTimeout);
            this.turnNotifyTimeout = null;
        }

        this.pendingTurnCounter = turnCounter;
        this.turnNotifyTimeout = setTimeout(() => {
            this.turnNotifyTimeout = null;
            if (!this.gameState || this.gameState.phase !== 'play') return;
            if ((this.gameState.turnCounter || 0) !== turnCounter) return;
            void this.sendTurnNotification();
        }, TURN_NOTIFICATION_DELAY_MS);
    }

    addSocket(socket) {
        socket.join(this.roomId);
        this.connectedSockets.add(socket.id);
        this.markActive();

        if (this.gameDestructionTimeout) {
            clearTimeout(this.gameDestructionTimeout);
            this.gameDestructionTimeout = null;
        }

        if (this.hostSocketId === null) {
            this.hostSocketId = socket.id;
        }

        this.sendCurrentState(socket);

        socket.on('register', (sessionId) => this.onRegister(socket, sessionId));
        socket.on('requestState', () => this.onRequestState(socket));
        socket.on('joinGame', (sessionId) => this.onJoinGame(socket, sessionId));
        socket.on('setGameMode', (mode) => this.onSetGameMode(socket, mode));
        socket.on('addBot', (seatIndex) => this.onAddBot(socket, seatIndex));
        socket.on('removeBot', (seatIndex) => this.onRemoveBot(socket, seatIndex));
        socket.on('setName', (nameInput) => this.onSetName(socket, nameInput));
        socket.on('selectColor', (hex) => this.onSelectColor(socket, hex));
        socket.on('playerReady', (status) => this.onPlayerReady(socket, status));
        socket.on('kickPlayer', (targetPid) => this.onKickPlayer(socket, targetPid));
        socket.on('claimHost', () => this.onClaimHost(socket));
        socket.on('requestStartGame', () => this.onRequestStartGame(socket));
        socket.on('resetGame', () => this.onResetGame(socket));
        socket.on('toggleLightning', () => this.onToggleLightning(socket));
        socket.on('rollDice', () => this.onRollDice(socket));
        socket.on('selectRoll', (data) => this.onSelectRoll(socket, data));
        socket.on('makeMove', (data) => this.onMakeMove(socket, data));
        socket.on('emoji', (emoji) => this.onEmoji(socket, emoji));
        socket.on('disconnect', () => this.onDisconnect(socket));
    }

    onRegister(socket, sessionId) {
        if (typeof sessionId !== 'string') return;
        this.markActive();

        let returningPlayerEntry = Object.entries(this.players).find(([k, v]) => v && v.session === sessionId && !v.isBot);
        if (returningPlayerEntry) {
            let pid = returningPlayerEntry[0];
            this.players[pid].id = socket.id;

            if (pid === '1') {
                this.hostSocketId = socket.id;
            } else if (this.hostSocketId === null) {
                this.hostSocketId = socket.id;
            }

            this.sendCurrentState(socket);
        } else {
            socket.emit('lobbyUpdate', this.getLobbyState());
        }
    }

    onJoinGame(socket, sessionId) {
        if (this.gameState) return;
        if (typeof sessionId !== 'string') return;
        if (Object.values(this.players).some(p => p && p.session === sessionId)) return;
        this.markActive();

        for (let i = 1; i <= 6; i++) {
            if (this.players[i] === null) {
                this.players[i] = {
                    id: socket.id,
                    session: sessionId,
                    color: null,
                    name: `P${i}`,
                    ready: false,
                    lastAction: 0,
                    isBot: false
                };
                if (i === 1) {
                    this.players[i].ready = true;
                    this.hostSocketId = socket.id;
                }
                break;
            }
        }
        this.emitLobbyUpdate();
    }

    onSetGameMode(socket, mode) {
        if (socket.id !== this.hostSocketId) return;
        if (this.gameState) return;
        this.markActive();

        if (['2p', '4p', '6p'].includes(mode)) {
            this.gameMode = mode;
            this.emitGameModeUpdate();
        }
    }

    onAddBot(socket, seatIndex) {
        if (this.gameState) return;
        if (socket.id !== this.hostSocketId) return;
        this.markActive();

        if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex > 5) return;

        let pid = seatIndex + 1;
        if (this.players[pid] === null) {
            let assignedColor = getNextAvailableBotColor(pid, this.players);

            this.players[pid] = {
                id: 'BOT-' + pid,
                session: 'BOT-' + pid,
                color: assignedColor,
                name: `BOT ${pid}`,
                ready: true,
                isBot: true
            };
            this.emitLobbyUpdate();
        }
    }

    onRemoveBot(socket, seatIndex) {
        if (this.gameState) return;
        if (socket.id !== this.hostSocketId) return;
        if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex > 5) return;
        this.markActive();

        let pid = seatIndex + 1;
        if (this.players[pid] && this.players[pid].isBot) {
            this.players[pid] = null;
            this.emitLobbyUpdate();
        }
    }

    onSetName(socket, nameInput) {
        if (this.gameState) return;
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        this.markActive();
        let pid = pEntry[0];
        let pData = this.players[pid];

        if (pData.isBot) return;
        if (this.isRateLimited(pData)) return;

        let cleanName = sanitizeString(nameInput);
        let safeName = [...(cleanName || "")].slice(0, 3).join('');
        if (safeName.length === 0) safeName = `P${pid}`;

        this.players[pid].name = safeName;
        this.emitLobbyUpdate();
    }

    onSelectColor(socket, hex) {
        if (this.gameState) return;
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        this.markActive();
        let pid = pEntry[0];
        let pData = this.players[pid];

        if (pData.isBot) return;
        if (this.isRateLimited(pData)) return;
        if (!isValidHex(hex)) return;

        if (!isColorAvailable(hex, this.players)) return;

        let isTaken = Object.values(this.players).some(p => p && p.id !== socket.id && p.color === hex);
        if (isTaken) return;

        this.players[pid].color = hex;
        this.emitLobbyUpdate();
    }

    onPlayerReady(socket, status) {
        if (this.gameState) return;
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        this.markActive();

        let pid = pEntry[0];
        if (this.players[pid].isBot) return;
        if (this.isRateLimited(this.players[pid])) return;

        this.players[pid].ready = !!status;
        this.emitLobbyUpdate();
    }

    onKickPlayer(socket, targetPid) {
        if (socket.id !== this.hostSocketId) return;
        if (targetPid === 1) return;
        if (typeof targetPid !== 'number' || targetPid < 1 || targetPid > 6) return;
        this.markActive();

        if (this.players[targetPid]) {
            let isBot = this.players[targetPid].isBot;
            let socketId = this.players[targetPid].id;
            this.players[targetPid] = null;

            if (!isBot) {
                this.io.to(socketId).emit('kicked');
            }
            this.emitLobbyUpdate();
        }
    }

    onClaimHost(socket) {
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (pEntry && pEntry[0] === '1') {
            this.hostSocketId = socket.id;
            console.log(`Player 1 manually claimed host in room ${this.roomId}.`);
            this.emitLobbyUpdate();
        }
    }

    onRequestStartGame(socket) {
        if (socket.id !== this.hostSocketId) return;
        this.markActive();

        let seatedPlayers = Object.entries(this.players).filter(([k, v]) => v !== null);
        let activeCount = seatedPlayers.length;
        let allColors = seatedPlayers.every(([k, v]) => v.color !== null);

        if (this.gameMode === '2p' && activeCount !== 2) return;
        if (this.gameMode === '4p' && activeCount < 2) return;
        if (this.gameMode === '4p' && activeCount > 4) return;
        if (this.gameMode === '6p' && activeCount < 2) return;

        if (allColors && !this.gameState) {
            console.log(`Starting ${this.gameMode} game in room ${this.roomId} with ${activeCount} players.`);
            this.totalPlayersAtStart = activeCount;

            let colorMap = {};
            let nameMap = {};
            seatedPlayers.forEach(([k, v]) => {
                colorMap[k] = v.color;
                nameMap[k] = v.name;
            });

            this.gameState = gameLogic.initServerState(this.gameMode, colorMap);
            this.gameState.playerNames = nameMap;

            let firstActive = parseInt(seatedPlayers[0][0]);
            this.gameState.activePlayer = firstActive;

            let maxP = (this.gameMode === '2p') ? 2 : (this.gameMode === '6p' ? 6 : 4);
            for (let i = 1; i <= maxP; i++) {
                if (this.players[i] === null) this.gameState.finishedPlayers.push(i);
            }

            this.io.to(this.roomId).emit('gameStart', this.gameMode);
            this.broadcastGameState();
        }
    }

    onResetGame(socket) {
        if (!this.gameState) return;
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        this.markActive();

        console.log(`Game reset requested in room ${this.roomId}.`);
        this.gameState = null;
        this.lightningMode = false;
        this.clearBotTimers();

        let seatedCount = Object.values(this.players).filter(p => p !== null).length;
        if (seatedCount > 4) this.gameMode = '6p';
        else this.gameMode = '4p';

        for (let i = 1; i <= 6; i++) {
            if (this.players[i]) {
                this.players[i].ready = this.players[i].isBot || (i === 1);
                this.players[i].lastAction = 0;
            }
        }

        this.emitLightningStatus();
        this.emitGameModeUpdate();
        this.io.to(this.roomId).emit('gameReset');
        this.emitLobbyUpdate();
    }

    onToggleLightning(socket) {
        if (!this.gameState) return;
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry || this.players[pEntry[0]].isBot) return;
        this.markActive();

        this.lightningMode = !this.lightningMode;
        this.emitLightningStatus();
        this.scheduleBotAction();
    }

    onRollDice(socket) {
        if (!this.gameState) return;
        let pData = this.players[this.gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return;
        this.markActive();

        if (this.isRateLimited(pData)) return;
        this.performRollDice(this.gameState.activePlayer);
    }

    onSelectRoll(socket, data) {
        if (!this.gameState || this.gameState.mode !== '6p') return;
        let pData = this.players[this.gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return;
        this.markActive();

        const dice = this.gameState.dice || { values: [], pending: [] };
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'sum') {
            if (!Array.isArray(dice.pending) || dice.pending.length !== 2) return;
            const sum = (dice.values[dice.pending[0]] || 0) + (dice.values[dice.pending[1]] || 0);
            this.setSelectedRoll({ type: 'sum', value: sum });
        } else if (data.type === 'die') {
            const slot = Number(data.slot);
            if (!Number.isInteger(slot)) return;
            if (!Array.isArray(dice.pending) || !dice.pending.includes(slot)) return;
            const value = dice.values[slot];
            this.setSelectedRoll({ type: 'die', slot, value });
        } else {
            return;
        }

        this.broadcastGameState();
    }

    onMakeMove(socket, data) {
        if (!this.gameState) return;
        let pData = this.players[this.gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return;
        this.markActive();

        if (this.isRateLimited(pData)) return;
        if (typeof data.marbleId !== 'number') return;
        if (typeof data.moveType !== 'string') return;
        let moveDestKey = null;
        if (typeof data.moveDestKey === 'string') {
            moveDestKey = data.moveDestKey;
        }
        this.performMakeMove(this.gameState.activePlayer, data.marbleId, data.moveType, moveDestKey);
    }

    onDisconnect(socket) {
        this.connectedSockets.delete(socket.id);
        this.emojiCooldowns.delete(socket.id);
        this.markActive();
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (pEntry) {
            let pid = pEntry[0];
            if (!this.gameState && !this.players[pid].isBot) {
                this.players[pid].id = null;
                this.players[pid].ready = false;
            }
        }

        if (socket.id === this.hostSocketId) {
            this.hostSocketId = this.connectedSockets.size > 0 ? this.connectedSockets.values().next().value : null;
            if (!this.gameState && this.hostSocketId) {
                let newHostEntry = Object.entries(this.players).find(([k, v]) => v && v.id === this.hostSocketId);
                if (newHostEntry) this.players[newHostEntry[0]].ready = true;
            }
        }

        let seatedCount = Object.values(this.players).filter(p => p !== null).length;
        if (this.gameMode === '2p' && seatedCount > 2) {
            this.gameMode = '4p';
            if (seatedCount > 4) this.gameMode = '6p';
            this.emitGameModeUpdate();
        }

        if (this.connectedSockets.size === 0) {
            this.clearBotTimers();
        }
        this.emitLobbyUpdate();
    }

    performRollDice(playerId) {
        if (!this.gameState || this.gameState.currentRoll > 0) return;
        if (this.gameState.activePlayer !== playerId) return;
        if (this.gameState.finishedPlayers.includes(this.gameState.activePlayer)) return;

        const pName = this.gameState.playerNames[playerId] || `P${playerId}`;

        if (this.gameState.mode === '6p') {
            const diceState = this.gameState.dice || { values: [], pending: [] };

            if (this.gameState.phase === 'init') {
                const d1 = rollDie();
                const d2 = rollDie();
                const sum = d1 + d2;

                this.gameState.dice = { values: [d1, d2], pending: [], last: [d1, d2] };
                this.gameState.currentRoll = sum;

                let pIndex = this.gameState.activePlayer - 1;
                this.gameState.initRolls[pIndex] = sum;
                this.gameState.message = `${pName} rolled ${d1} + ${d2} = ${sum}.`;

                let maxP = (this.gameState.mode === '2p') ? 2 : (this.gameState.mode === '6p' ? 6 : 4);
                let realPlayerIds = Object.keys(this.players).filter(k => this.players[k] !== null && k <= maxP).map(Number);
                let allRolled = realPlayerIds.every(pid => this.gameState.initRolls[pid - 1] > 0);

                if (allRolled) {
                    let maxRoll = 0;
                    realPlayerIds.forEach(pid => {
                        if (this.gameState.initRolls[pid - 1] > maxRoll) maxRoll = this.gameState.initRolls[pid - 1];
                    });
                    let winners = [];
                    realPlayerIds.forEach(pid => {
                        if (this.gameState.initRolls[pid - 1] === maxRoll) winners.push(pid);
                    });
                    this.gameState.activePlayer = winners[0];
                    const winnerName = this.gameState.playerNames[winners[0]] || `P${winners[0]}`;
                    this.gameState.phase = 'play';
                    this.gameState.turnCounter = (this.gameState.turnCounter || 0) + 1;
                    this.gameState.message = `${winnerName} starts!`;
                    this.gameState.currentRoll = 0;
                } else {
                    this.nextPlayer();
                    const nextName = this.gameState.playerNames[this.gameState.activePlayer] || `P${this.gameState.activePlayer}`;
                    this.gameState.message = `${nextName}, roll for order.`;
                    this.gameState.currentRoll = 0;
                }
                this.broadcastGameState();
                return;
            }

            if (Array.isArray(diceState.pending) && diceState.pending.length > 0) return;

            const d1 = rollDie();
            const d2 = rollDie();
            this.gameState.dice = { values: [d1, d2], pending: [0, 1], last: [d1, d2] };
            this.gameState.selectedRoll = null;

            if (this.gameState.doubleStreak.playerId !== playerId || this.gameState.doubleStreak.value !== d1) {
                this.gameState.doubleStreak = { playerId, value: d1, count: 0 };
            }
            if (d1 === d2) {
                this.gameState.doubleStreak.count += 1;
                if (this.gameState.doubleStreak.count >= 3) {
                    if (!this.gameState.finishedPlayers.includes(playerId)) {
                        this.gameState.finishedPlayers.unshift(playerId);
                    }
                    this.gameState.phase = 'gameover';
                    this.gameState.message = `GAME OVER! ${pName} wins via Jorge's Rule!`;
                    this.broadcastGameState();
                    return;
                }
            } else {
                this.gameState.doubleStreak = { playerId, value: null, count: 0 };
            }

            let hasMoves = this.evaluate6pRollOptions();
            if (!hasMoves) {
                const handled = this.handle6pNoMoves();
                if (handled) hasMoves = true;
            }

            this.updateRollStats(playerId, hasMoves);

            if (!hasMoves) {
                const values = (this.gameState.dice && this.gameState.dice.values) || [d1, d2];
                this.gameState.message = `Rolled ${values[0]} and ${values[1]}. No moves.`;
                setTimeout(() => {
                    if (!this.gameState) return;
                    this.nextPlayer();
                    this.broadcastGameState();
                }, 1500);
                return;
            }

            const values = (this.gameState.dice && this.gameState.dice.values) || [d1, d2];
            this.gameState.message = `Rolled ${values[0]} and ${values[1]}! Move a marble.`;
            this.broadcastGameState();
            return;
        }

        const roll = rollDie();
        this.gameState.currentRoll = roll;

        if (this.gameState.phase === 'init') {
            let pIndex = this.gameState.activePlayer - 1;
            this.gameState.initRolls[pIndex] = roll;
            this.gameState.message = `${pName} rolled ${roll}.`;

            let maxP = (this.gameState.mode === '2p') ? 2 : (this.gameState.mode === '6p' ? 6 : 4);
            let realPlayerIds = Object.keys(this.players).filter(k => this.players[k] !== null && k <= maxP).map(Number);
            let allRolled = realPlayerIds.every(pid => this.gameState.initRolls[pid - 1] > 0);

            if (allRolled) {
                let maxRoll = 0;
                realPlayerIds.forEach(pid => {
                    if (this.gameState.initRolls[pid - 1] > maxRoll) maxRoll = this.gameState.initRolls[pid - 1];
                });
                let winners = [];
                realPlayerIds.forEach(pid => {
                    if (this.gameState.initRolls[pid - 1] === maxRoll) winners.push(pid);
                });
                this.gameState.activePlayer = winners[0];
                const winnerName = this.gameState.playerNames[winners[0]] || `P${winners[0]}`;
                this.gameState.phase = 'play';
                this.gameState.turnCounter = (this.gameState.turnCounter || 0) + 1;
                this.gameState.message = `${winnerName} starts!`;
                this.gameState.currentRoll = 0;
            } else {
                this.nextPlayer();
                const nextName = this.gameState.playerNames[this.gameState.activePlayer] || `P${this.gameState.activePlayer}`;
                this.gameState.message = `${nextName}, roll for order.`;
                this.gameState.currentRoll = 0;
            }
        } else {
            let movesMap = [];
            this.gameState.movableMarbles = [];
            let playerMarbles = this.gameState.marbles.filter(m => m.player === this.gameState.activePlayer);

            playerMarbles.forEach(m => {
                let moves = gameLogic.computePossibleMoves(this.gameState.mode, this.gameState.marbles, m.id, roll);
                if (moves.length > 0) {
                    this.gameState.movableMarbles.push(m.id);
                    movesMap.push([m.id, moves]);
                }
            });
            this.gameState.possibleMoves = movesMap;

            if (this.gameState.stats) {
                const stats = this.gameState.stats;
                if (this.gameState.movableMarbles.length === 0) {
                    stats.noMoveRolls[playerId] = (stats.noMoveRolls[playerId] || 0) + 1;
                    stats.hotStreakCurrent[playerId] = 0;
                } else {
                    const nextStreak = (stats.hotStreakCurrent[playerId] || 0) + 1;
                    stats.hotStreakCurrent[playerId] = nextStreak;
                    if (nextStreak > (stats.hotStreakBest[playerId] || 0)) {
                        stats.hotStreakBest[playerId] = nextStreak;
                    }
                }
            }

            if (this.gameState.movableMarbles.length === 0) {
                if (roll === 6 || roll === 1) {
                    this.gameState.message = `Rolled ${roll}. No moves, but Roll Again!`;
                    this.gameState.currentRoll = 0;
                } else {
                    this.gameState.message = `Rolled ${roll}. No moves.`;
                    setTimeout(() => {
                        if (!this.gameState) return;
                        this.nextPlayer();
                        this.broadcastGameState();
                    }, 1500);
                }
            } else {
                this.gameState.message = `Rolled ${roll}! Move a marble.`;
            }
        }
        this.broadcastGameState();
    }

    performMakeMove(playerId, marbleId, moveType, moveDestKey) {
        if (this.gameState.activePlayer !== playerId) return;
        const isSixPlayer = this.gameState.mode === '6p';
        if (isSixPlayer && !this.gameState.selectedRoll) return;

        let movesArray = this.gameState.possibleMoves.find(pm => pm[0] === marbleId);
        if (!movesArray) return;

        let validMoves = movesArray[1];
        let chosenMove = validMoves.find(m => m.type === moveType && (!moveDestKey || gameLogic.coordToKey(m.dest) === moveDestKey))
            || validMoves.find(m => m.type === moveType)
            || validMoves[0];

        if (chosenMove) {
            let marble = this.gameState.marbles.find(m => m.id === marbleId);

            let victim = this.gameState.marbles.find(m => m.id !== marbleId && gameLogic.samePos(m.pos, chosenMove.dest));
            if (victim) {
                if (this.gameState.stats) {
                    this.gameState.stats.murders[playerId] = (this.gameState.stats.murders[playerId] || 0) + 1;
                    this.gameState.stats.deaths[victim.player] = (this.gameState.stats.deaths[victim.player] || 0) + 1;
                }
                this.io.to(this.roomId).emit('murder', { pos: victim.pos, victimId: victim.player });

                let pData = gameLogic.MAPS[this.gameState.mode].processedPlayers[victim.player - 1];
                let emptyWork = pData.work.find(w => !this.gameState.marbles.some(m => gameLogic.samePos(m.pos, w)));
                if (emptyWork) victim.pos = { ...emptyWork };
            }

            marble.pos = { ...chosenMove.dest };

            if (this.gameState.stats) {
                const stats = this.gameState.stats;
                if (stats.marbleRolls) {
                    stats.marbleRolls[marble.id] = (stats.marbleRolls[marble.id] || 0) + 1;
                }
                if (stats.finishedMarbles && !stats.finishedMarbles[marble.id]
                    && gameLogic.isHomePos(this.gameState.mode, marble.player, marble.pos)) {
                    stats.finishedMarbles[marble.id] = true;
                    const rolls = stats.marbleRolls ? (stats.marbleRolls[marble.id] || 0) : 0;
                    const currentBest = stats.speedrunnerBest;
                    if (!currentBest || rolls < currentBest.rolls) {
                        stats.speedrunnerBest = { playerId: marble.player, rolls: rolls, marbleId: marble.id };
                    }
                }
            }

            let pId = marble.player;
            let pName = this.gameState.playerNames[pId] || `P${pId}`;
            let inHome = this.gameState.marbles.filter(m => m.player === pId && gameLogic.isHomePos(this.gameState.mode, pId, m.pos)).length;

            let needed = (this.gameState.mode === '6p') ? 4 : 5;

            if (inHome === needed) {
                if (!this.gameState.finishedPlayers.includes(pId)) this.gameState.finishedPlayers.push(pId);

                let maxP = (this.gameState.mode === '2p') ? 2 : (this.gameState.mode === '6p' ? 6 : 4);
                let emptySlots = maxP - this.totalPlayersAtStart;
                let myRank = this.gameState.finishedPlayers.length - emptySlots;
                let finishedRealPlayers = this.gameState.finishedPlayers.length - emptySlots;

                if (finishedRealPlayers >= this.totalPlayersAtStart - 1) {
                    this.gameState.message = `GAME OVER! ${pName} takes ${this.getOrdinal(myRank)} Place!`;
                    this.gameState.phase = 'gameover';
                    void this.logGameResultsIfNeeded();
                } else {
                    this.gameState.message = `${pName} takes ${this.getOrdinal(myRank)} Place!`;
                    this.broadcastGameState();
                    setTimeout(() => {
                        if (!this.gameState) return;
                        this.nextPlayer();
                        this.broadcastGameState();
                    }, 2500);
                    return;
                }
            } else {
                if (isSixPlayer) {
                    const dice = this.gameState.dice || { values: [], pending: [], last: [] };
                    const selectedRoll = this.gameState.selectedRoll;
                    const last = Array.isArray(dice.last) ? dice.last : dice.values;
                    const currentValues = Array.isArray(dice.values) ? dice.values : [];

                    let usedSlots = [];
                    if (selectedRoll.type === 'sum') {
                        usedSlots = [0, 1];
                    } else if (selectedRoll.type === 'die') {
                        usedSlots = [selectedRoll.slot];
                    }

                    const usedValues = usedSlots.map(slot => currentValues[slot]);
                    dice.pending = (dice.pending || []).filter(slot => !usedSlots.includes(slot));

                    const rerollSlots = usedSlots.filter((slot, idx) => {
                        const value = usedValues[idx];
                        return value === 1 || value === 6;
                    });

                    if (dice.pending.length === 0 && last[0] === last[1]) {
                        const d1 = rollDie();
                        const d2 = rollDie();
                        this.gameState.dice = { values: [d1, d2], pending: [0, 1], last: [d1, d2] };
                        this.gameState.selectedRoll = null;
                        this.gameState.currentRoll = 0;

                        if (this.gameState.doubleStreak.playerId !== playerId || this.gameState.doubleStreak.value !== d1) {
                            this.gameState.doubleStreak = { playerId, value: d1, count: 0 };
                        }
                        if (d1 === d2) {
                            this.gameState.doubleStreak.count += 1;
                            if (this.gameState.doubleStreak.count >= 3) {
                                if (!this.gameState.finishedPlayers.includes(playerId)) {
                                    this.gameState.finishedPlayers.unshift(playerId);
                                }
                                this.gameState.phase = 'gameover';
                                this.gameState.message = `GAME OVER! ${pName} wins via Jorge's Rule!`;
                                this.broadcastGameState();
                                return;
                            }
                        } else {
                            this.gameState.doubleStreak = { playerId, value: null, count: 0 };
                        }

                        let hasMoves = this.evaluate6pRollOptions();
                        if (!hasMoves) {
                            const handled = this.handle6pNoMoves();
                            if (handled) hasMoves = true;
                        }

                        this.updateRollStats(playerId, hasMoves);

                        if (!hasMoves) {
                            this.gameState.message = `Rolled ${d1} and ${d2}. No moves.`;
                            setTimeout(() => {
                                if (!this.gameState) return;
                                this.nextPlayer();
                                this.broadcastGameState();
                            }, 1500);
                            return;
                        }

                        this.gameState.message = `Bonus roll! ${pName} goes again.`;
                    } else {
                        rerollSlots.forEach(slot => {
                            dice.values[slot] = rollDie();
                            if (!dice.pending.includes(slot)) dice.pending.push(slot);
                        });
                        dice.pending.sort();
                        dice.last = last;
                        this.gameState.dice = dice;

                        if (dice.pending.length > 0) {
                            this.gameState.selectedRoll = null;
                            this.gameState.currentRoll = 0;
                            let hasMoves = this.evaluate6pRollOptions();
                            this.updateRollStats(playerId, hasMoves);
                            if (!hasMoves) {
                                if (dice.pending.length === 1) {
                                    const slot = dice.pending[0];
                                    const value = dice.values[slot];
                                    if (value === 1 || value === 6) {
                                        dice.values[slot] = rollDie();
                                        dice.pending = [slot];
                                        dice.last = [...dice.values];
                                        this.gameState.dice = dice;
                                        this.gameState.selectedRoll = null;
                                        this.gameState.currentRoll = 0;
                                        const rerollHasMoves = this.evaluate6pRollOptions();
                                        this.updateRollStats(playerId, rerollHasMoves);
                                        if (!rerollHasMoves) {
                                            this.gameState.message = `No moves.`;
                                            setTimeout(() => {
                                                if (!this.gameState) return;
                                                this.nextPlayer();
                                                this.broadcastGameState();
                                            }, 1500);
                                            return;
                                        }
                                        this.gameState.message = `Roll again, ${pName}.`;
                                        return;
                                    }
                                }
                                this.gameState.message = `No moves.`;
                                setTimeout(() => {
                                    if (!this.gameState) return;
                                    this.nextPlayer();
                                    this.broadcastGameState();
                                }, 1500);
                                return;
                            }
                            this.gameState.message = `Keep going, ${pName}.`;
                        } else {
                            this.nextPlayer();
                        }
                    }
                } else {
                    if (this.gameState.currentRoll === 6 || this.gameState.currentRoll === 1) {
                        this.gameState.message = `Bonus roll! ${pName} goes again.`;
                        this.gameState.currentRoll = 0;
                        this.gameState.movableMarbles = [];
                        this.gameState.possibleMoves = [];
                    } else {
                        this.nextPlayer();
                    }
                }
            }
            this.broadcastGameState();
        }
    }

    getLobbyState() {
        return {
            players: this.players,
            seatedCount: Object.values(this.players).filter(p => p !== null).length,
            hostId: this.hostSocketId
        };
    }

    nextPlayer() {
        if (!this.gameState) return;
        let loopCount = 0;
        let maxP = (this.gameState.mode === '2p') ? 2 : (this.gameState.mode === '6p' ? 6 : 4);

        do {
            this.gameState.activePlayer = (this.gameState.activePlayer % maxP) + 1;
            loopCount++;
            if (loopCount > 10) {
                this.gameState.phase = 'gameover';
                return;
            }
        } while (this.gameState.finishedPlayers.includes(this.gameState.activePlayer));

        this.gameState.currentRoll = 0;
        this.gameState.movableMarbles = [];
        this.gameState.possibleMoves = [];
        if (this.gameState.mode === '6p' && this.gameState.dice) {
            this.gameState.dice.pending = [];
            this.gameState.selectedRoll = null;
            this.gameState.doubleStreak = { playerId: null, value: null, count: 0 };
        }
        if (this.gameState.phase === 'play') {
            this.gameState.turnCounter = (this.gameState.turnCounter || 0) + 1;
        }
        let nextName = (this.gameState.playerNames && this.gameState.playerNames[this.gameState.activePlayer]) || `P${this.gameState.activePlayer}`;
        this.gameState.message = `${nextName}'s turn.`;
    }

    getOrdinal(n) {
        var s = ["th", "st", "nd", "rd"];
        var v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
}

class GameManager {
    constructor(io, dataDir) {
        this.io = io;
        this.dataDir = dataDir;
        this.rooms = new Map();
        this.cleanupInterval = setInterval(
            () => this.cleanupRooms(),
            ROOM_CLEANUP_INTERVAL_MS
        );
    }

    sanitizeRoomId(roomId) {
        if (typeof roomId !== 'string') return 'lobby';
        const cleaned = roomId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleaned) return 'lobby';
        return cleaned.slice(0, 32);
    }

    getRoom(roomId) {
        const safeId = this.sanitizeRoomId(roomId);
        let room = this.rooms.get(safeId);
        if (!room) {
            room = new GameRoom(this.io, safeId, this.dataDir);
            this.rooms.set(safeId, room);
        }
        return room;
    }

    restartRoom(roomId) {
        const safeId = this.sanitizeRoomId(roomId);
        this.rooms.delete(safeId);
        this.deletePersistedRoom(safeId);
    }

    getRoomsSummary() {
        return Array.from(this.rooms.entries()).map(([roomId, room]) => {
            const lobby = room.getLobbyState();
            return {
                roomId,
                seatedCount: lobby.seatedCount,
                hasGame: !!room.gameState,
                gameMode: room.gameMode
            };
        });
    }

    cleanupRooms() {
        const now = Date.now();
        for (const [roomId, room] of this.rooms.entries()) {
            if (room.connectedSockets.size > 0) continue;
            if (now - room.lastActive < ROOM_IDLE_TTL_MS) continue;
            this.rooms.delete(roomId);
        }
    }

    deletePersistedRoom(roomId) {
        const fileBase = `room-${roomId}`;
        const stateFile = path.join(this.dataDir, `${fileBase}.json`);
        const tmpFile = path.join(this.dataDir, `${fileBase}.json.tmp`);

        try { fs.unlinkSync(stateFile); } catch (err) {
            if (err.code !== 'ENOENT') console.error(err);
        }
        try { fs.unlinkSync(tmpFile); } catch (err) {
            if (err.code !== 'ENOENT') console.error(err);
        }
    }
}

module.exports = GameManager;
