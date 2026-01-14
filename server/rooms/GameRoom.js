const fs = require('fs');
const path = require('path');
const gameLogic = require(path.join(__dirname, '..', '..', 'public', 'js', 'gameLogic.js'));

const RATE_LIMIT_MS = 200;
const SIMILARITY_THRESHOLD = 10;

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
        this.botTimeout = null;

        this.persistTimeout = null;
        this.persistInFlight = false;
        this.persistQueued = false;

        this.loadPersistedState();
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

    buildPersistedState() {
        return {
            players: this.normalizePlayers(this.players),
            gameState: this.gameState,
            gameMode: this.gameMode,
            lightningMode: this.lightningMode,
            totalPlayersAtStart: this.totalPlayersAtStart
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
            this.hostSocketId = null;
            this.connectedSockets = new Set();
            console.log(`Restored game state for room ${this.roomId}.`);
        } catch (err) {
            console.error(`Failed to load state for room ${this.roomId}:`, err);
        }
    }

    emitLobbyUpdate() {
        this.io.to(this.roomId).emit('lobbyUpdate', this.getLobbyState());
        this.schedulePersist();
    }

    emitGameModeUpdate() {
        this.io.to(this.roomId).emit('gameModeUpdate', this.gameMode);
        this.schedulePersist();
    }

    emitLightningStatus() {
        this.io.to(this.roomId).emit('lightningStatus', this.lightningMode);
        this.schedulePersist();
    }

    broadcastGameState() {
        this.io.to(this.roomId).emit('gameState', this.gameState);
        this.schedulePersist();
    }

    isRateLimited(playerObj) {
        const now = Date.now();
        if (playerObj.lastAction && (now - playerObj.lastAction < RATE_LIMIT_MS)) {
            return true;
        }
        playerObj.lastAction = now;
        return false;
    }

    addSocket(socket) {
        socket.join(this.roomId);
        this.connectedSockets.add(socket.id);

        if (this.gameDestructionTimeout) {
            clearTimeout(this.gameDestructionTimeout);
            this.gameDestructionTimeout = null;
        }

        if (this.hostSocketId === null) {
            this.hostSocketId = socket.id;
        }

        socket.emit('lobbyUpdate', this.getLobbyState());
        socket.emit('gameModeUpdate', this.gameMode);

        if (this.gameState) {
            socket.emit('gameStart', this.gameMode);
            socket.emit('gameState', this.gameState);
        }
        socket.emit('lightningStatus', this.lightningMode);

        socket.on('register', (sessionId) => this.onRegister(socket, sessionId));
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
        socket.on('makeMove', (data) => this.onMakeMove(socket, data));
        socket.on('disconnect', () => this.onDisconnect(socket));
    }

    onRegister(socket, sessionId) {
        if (typeof sessionId !== 'string') return;

        let returningPlayerEntry = Object.entries(this.players).find(([k, v]) => v && v.session === sessionId && !v.isBot);
        if (returningPlayerEntry) {
            let pid = returningPlayerEntry[0];
            this.players[pid].id = socket.id;

            if (pid === '1') {
                this.hostSocketId = socket.id;
            } else if (this.hostSocketId === null) {
                this.hostSocketId = socket.id;
            }

            socket.emit('lobbyUpdate', this.getLobbyState());
            if (this.gameState) {
                socket.emit('gameStart', this.gameMode);
                socket.emit('gameState', this.gameState);
            }
            socket.emit('lightningStatus', this.lightningMode);
        } else {
            socket.emit('lobbyUpdate', this.getLobbyState());
        }
    }

    onJoinGame(socket, sessionId) {
        if (this.gameState) return;
        if (typeof sessionId !== 'string') return;
        if (Object.values(this.players).some(p => p && p.session === sessionId)) return;

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

        if (['2p', '4p', '6p'].includes(mode)) {
            this.gameMode = mode;
            this.emitGameModeUpdate();
        }
    }

    onAddBot(socket, seatIndex) {
        if (this.gameState) return;
        if (socket.id !== this.hostSocketId) return;

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
            for(let i=1; i<=maxP; i++) {
                if(this.players[i] === null) this.gameState.finishedPlayers.push(i);
            }

            this.io.to(this.roomId).emit('gameStart', this.gameMode);
            this.broadcastGameState();

            this.triggerBotTurn();
        }
    }

    onResetGame(socket) {
        if (!this.gameState) return;
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;

        console.log(`Game reset requested in room ${this.roomId}.`);
        this.gameState = null;
        this.lightningMode = false;
        if(this.botTimeout) clearTimeout(this.botTimeout);

        let seatedCount = Object.values(this.players).filter(p => p !== null).length;
        if (seatedCount > 4) this.gameMode = '6p';
        else this.gameMode = '4p';

        for(let i=1; i<=6; i++) {
            if(this.players[i]) {
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

        this.lightningMode = !this.lightningMode;
        this.emitLightningStatus();

        if (this.players[this.gameState.activePlayer].isBot) {
             this.triggerBotTurn();
        } else {
             if (this.lightningMode) this.triggerLightningTurn();
        }
    }

    onRollDice(socket) {
        if (!this.gameState) return;
        let pData = this.players[this.gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return;

        if (this.isRateLimited(pData)) return;
        this.performRollDice(this.gameState.activePlayer);
    }

    onMakeMove(socket, data) {
        if (!this.gameState) return;
        let pData = this.players[this.gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return;

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
        let pEntry = Object.entries(this.players).find(([k, v]) => v && v.id === socket.id);
        if (pEntry) {
            let pid = pEntry[0];
            if (!this.gameState && !this.players[pid].isBot) {
                this.players[pid] = null;
            }
        }

        if (socket.id === this.hostSocketId) {
            this.hostSocketId = this.connectedSockets.size > 0 ? this.connectedSockets.values().next().value : null;
            if (!this.gameState && this.hostSocketId) {
                let newHostEntry = Object.entries(this.players).find(([k, v]) => v && v.id === this.hostSocketId);
                if(newHostEntry) this.players[newHostEntry[0]].ready = true;
            }
        }

        let seatedCount = Object.values(this.players).filter(p => p !== null).length;
        if (this.gameMode === '2p' && seatedCount > 2) {
             this.gameMode = '4p';
             if (seatedCount > 4) this.gameMode = '6p';
             this.emitGameModeUpdate();
        }

        if (this.connectedSockets.size === 0) {
            this.gameDestructionTimeout = setTimeout(() => {
                this.gameState = null;
                this.players = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
                this.schedulePersist();
            }, 60000);
        }
        this.emitLobbyUpdate();
    }

    triggerBotTurn() {
        if (!this.gameState || this.gameState.phase === 'gameover') return;

        let activeP = this.players[this.gameState.activePlayer];
        if (!activeP || !activeP.isBot) {
            if (this.lightningMode) this.triggerLightningTurn();
            return;
        }

        if (this.botTimeout) clearTimeout(this.botTimeout);

        let delay = this.lightningMode ? 50 : 2000;

        this.botTimeout = setTimeout(() => {
            if (!this.gameState || this.gameState.phase === 'gameover') return;
            if (this.gameState.activePlayer !== parseInt(activeP.name.replace('BOT ','').replace('P',''))) return;

            if (this.gameState.currentRoll === 0) {
                this.performRollDice(this.gameState.activePlayer);
                return;
            }

            if (this.gameState.currentRoll > 0 && this.gameState.movableMarbles.length > 0) {
                let bestMove = this.decideBotMove(this.gameState.activePlayer);
                if (bestMove) {
                    this.performMakeMove(this.gameState.activePlayer, bestMove.marbleId, bestMove.type);
                }
            }
        }, delay);
    }

    decideBotMove(pid) {
        let movesMap = this.gameState.possibleMoves;
        if (movesMap.length === 0) return null;

        let bestScore = -9999;
        let bestAction = null;

        movesMap.forEach(([mId, moves]) => {
            let marble = this.gameState.marbles.find(m => m.id === mId);

            moves.forEach(move => {
                let score = 0;

                let victim = this.gameState.marbles.find(m => m.id !== mId && gameLogic.samePos(m.pos, move.dest));
                if (victim && victim.player !== pid) {
                    score += 1000;
                }

                if (move.type === 'shortcut') score += 500;
                if (move.type === 'spawn') score += 200;

                let currentProg = this.calculateProgress(pid, marble.pos);
                let nextProg = this.calculateProgress(pid, move.dest);
                score += (nextProg - currentProg);

                if (score > bestScore) {
                    bestScore = score;
                    bestAction = { marbleId: mId, type: move.type };
                }
            });
        });

        return bestAction;
    }

    calculateProgress(pid, pos) {
        let mode = this.gameState.mode;
        let pData = gameLogic.MAPS[mode].processedPlayers[pid - 1];

        let homeIdx = pData.home.findIndex(h => gameLogic.samePos(h, pos));
        if (homeIdx !== -1) return 200 + homeIdx;

        let workIdx = pData.work.findIndex(w => gameLogic.samePos(w, pos));
        if (workIdx !== -1) return 0;

        let key = gameLogic.coordToKey(pos);

        if (mode === '2p') {
            let trackIdx = pData.path.indexOf(key);
            if (trackIdx !== -1) return 10 + trackIdx;
            if (key === 'E9') return 100;
        } else if (mode === '6p') {
            let trackIdx = gameLogic.MAPS['6p'].trackStr.indexOf(key);
            if (trackIdx !== -1) {
                let startKey = gameLogic.coordToKey(pData.entry1);
                let startIdx = gameLogic.MAPS['6p'].trackStr.indexOf(startKey);
                let dist = (trackIdx - startIdx + gameLogic.MAPS['6p'].trackStr.length) % gameLogic.MAPS['6p'].trackStr.length;
                return 10 + dist;
            }
            if (key === 'H9' || key === 'H11') return 100;
        } else {
            let trackIdx = gameLogic.MAPS['4p'].trackStr.indexOf(key);
            if (trackIdx !== -1) {
                let startKey = gameLogic.coordToKey(pData.entry1);
                let startIdx = gameLogic.MAPS['4p'].trackStr.indexOf(startKey);
                let dist = (trackIdx - startIdx + gameLogic.MAPS['4p'].trackStr.length) % gameLogic.MAPS['4p'].trackStr.length;
                return 10 + dist;
            }
            if (key === 'I9') return 100;
        }

        return 0;
    }

    performRollDice(playerId) {
        if (!this.gameState || this.gameState.currentRoll > 0) return;
        if (this.gameState.activePlayer !== playerId) return;
        if (this.gameState.finishedPlayers.includes(this.gameState.activePlayer)) return;

        const roll = Math.floor(Math.random() * 6) + 1;
        this.gameState.currentRoll = roll;

        const pName = this.gameState.playerNames[playerId] || `P${playerId}`;

        if (this.gameState.phase === 'init') {
            let pIndex = this.gameState.activePlayer - 1;
            this.gameState.initRolls[pIndex] = roll;
            this.gameState.message = `${pName} rolled ${roll}.`;

            let maxP = (this.gameState.mode === '2p') ? 2 : (this.gameState.mode === '6p' ? 6 : 4);
            let realPlayerIds = Object.keys(this.players).filter(k => this.players[k] !== null && k <= maxP).map(Number);
            let allRolled = realPlayerIds.every(pid => this.gameState.initRolls[pid-1] > 0);

            if (allRolled) {
                let maxRoll = 0;
                realPlayerIds.forEach(pid => {
                    if (this.gameState.initRolls[pid-1] > maxRoll) maxRoll = this.gameState.initRolls[pid-1];
                });
                let winners = [];
                realPlayerIds.forEach(pid => {
                    if (this.gameState.initRolls[pid-1] === maxRoll) winners.push(pid);
                });
                this.gameState.activePlayer = winners[0];
                const winnerName = this.gameState.playerNames[winners[0]] || `P${winners[0]}`;
                this.gameState.phase = 'play';
                this.gameState.message = `${winnerName} starts!`;
                this.gameState.currentRoll = 0;

                this.triggerBotTurn();
            } else {
                this.nextPlayer();
                const nextName = this.gameState.playerNames[this.gameState.activePlayer] || `P${this.gameState.activePlayer}`;
                this.gameState.message = `${nextName}, roll for order.`;
                this.gameState.currentRoll = 0;

                this.triggerBotTurn();
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

            if (this.gameState.movableMarbles.length === 0) {
                if (roll === 6 || roll === 1) {
                    this.gameState.message = `Rolled ${roll}. No moves, but Roll Again!`;
                    this.gameState.currentRoll = 0;
                    this.triggerBotTurn();
                } else {
                    this.gameState.message = `Rolled ${roll}. No moves.`;
                    setTimeout(() => {
                        this.nextPlayer();
                        this.broadcastGameState();
                        this.triggerBotTurn();
                    }, 1500);
                }
            } else {
                this.gameState.message = `Rolled ${roll}! Move a marble.`;
                this.triggerBotTurn();
            }
        }
        this.broadcastGameState();
    }

    performMakeMove(playerId, marbleId, moveType, moveDestKey) {
        if (this.gameState.activePlayer !== playerId) return;

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
                if(emptyWork) victim.pos = { ...emptyWork };
            }

            marble.pos = { ...chosenMove.dest };

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
                } else {
                    this.gameState.message = `${pName} takes ${this.getOrdinal(myRank)} Place!`;
                    this.broadcastGameState();
                    setTimeout(() => {
                         this.nextPlayer();
                         this.broadcastGameState();
                         this.triggerBotTurn();
                    }, 2500);
                    return;
                }
            } else {
                if (this.gameState.currentRoll === 6 || this.gameState.currentRoll === 1) {
                    this.gameState.message = `Bonus roll! ${pName} goes again.`;
                    this.gameState.currentRoll = 0;
                    this.gameState.movableMarbles = [];
                    this.gameState.possibleMoves = [];
                    this.triggerBotTurn();
                } else {
                    this.nextPlayer();
                    this.triggerBotTurn();
                }
            }
            this.broadcastGameState();
        }
    }

    triggerLightningTurn() {
        if (!this.lightningMode || !this.gameState || this.gameState.phase === 'gameover') return;
        if (this.players[this.gameState.activePlayer].isBot) return;

        setTimeout(() => {
            if (!this.lightningMode || !this.gameState || this.gameState.phase === 'gameover') return;
            if (this.gameState.currentRoll === 0) {
                this.performRollDice(this.gameState.activePlayer);
                return;
            }
            if (this.gameState.currentRoll > 0 && this.gameState.movableMarbles.length > 0) {
                if (this.gameState.possibleMoves.length === 1) {
                    let movesForMarble = this.gameState.possibleMoves[0][1];
                    if (movesForMarble.length === 1) {
                        let mId = this.gameState.possibleMoves[0][0];
                        let mType = movesForMarble[0].type;
                        this.performMakeMove(this.gameState.activePlayer, mId, mType);
                        return;
                    }
                }
            }
        }, 50);
    }

    getLobbyState() {
        return {
            players: this.players,
            seatedCount: Object.values(this.players).filter(p => p !== null).length,
            hostId: this.hostSocketId
        };
    }

    nextPlayer() {
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
        let nextName = (this.gameState.playerNames && this.gameState.playerNames[this.gameState.activePlayer]) || `P${this.gameState.activePlayer}`;
        this.gameState.message = `${nextName}'s turn.`;
    }

    getOrdinal(n) {
        var s = ["th", "st", "nd", "rd"];
        var v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
}

module.exports = GameRoom;
