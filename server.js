const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const gameLogic = require('./gameLogic.js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname)));

// --- GLOBAL STATE ---
let players = { 1: null, 2: null, 3: null, 4: null };
let connectedSockets = new Set();
let hostSocketId = null;
let gameState = null;
let totalPlayersAtStart = 0;
let gameDestructionTimeout = null;
let gameMode = '4p'; // '4p' or '2p'

let lightningMode = false;
let botTimeout = null; 

// --- SECURITY HELPERS ---
function sanitizeString(str) {
    if (!str) return "";
    return String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
}

function isValidHex(hex) {
    return /^#[0-9A-F]{6}$/i.test(hex);
}

const RATE_LIMIT_MS = 200; 
function isRateLimited(playerObj) {
    const now = Date.now();
    if (playerObj.lastAction && (now - playerObj.lastAction < RATE_LIMIT_MS)) {
        return true; 
    }
    playerObj.lastAction = now;
    return false;
}

// --- BOT COLORS ---
const BOT_COLORS = {
    1: '#e74c3c', // Red
    2: '#2ecc71', // Green
    3: '#f1c40f', // Yellow
    4: '#3498db'  // Blue
};

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    connectedSockets.add(socket.id);

    if (gameDestructionTimeout) {
        clearTimeout(gameDestructionTimeout);
        gameDestructionTimeout = null;
    }

    if (hostSocketId === null) {
        hostSocketId = socket.id;
    }

    socket.emit('lobbyUpdate', getLobbyState());
    socket.emit('gameModeUpdate', gameMode); // Send current mode on connect

    if (gameState) {
        socket.emit('gameStart', gameMode); 
        socket.emit('gameState', gameState);
    }
    socket.emit('lightningStatus', lightningMode);

    socket.on('register', (sessionId) => {
        if (typeof sessionId !== 'string') return;

        let returningPlayerEntry = Object.entries(players).find(([k, v]) => v && v.session === sessionId && !v.isBot);
        if (returningPlayerEntry) {
            let pid = returningPlayerEntry[0];
            players[pid].id = socket.id;
            
            if (pid === '1') {
                hostSocketId = socket.id;
            } else if (hostSocketId === null) {
                hostSocketId = socket.id;
            }

            socket.emit('lobbyUpdate', getLobbyState());
            if (gameState) {
                socket.emit('gameStart', gameMode);
                socket.emit('gameState', gameState);
            }
            socket.emit('lightningStatus', lightningMode);
        } else {
            socket.emit('lobbyUpdate', getLobbyState());
        }
    });

    socket.on('joinGame', (sessionId) => {
        if (gameState) return;
        if (typeof sessionId !== 'string') return;
        if (Object.values(players).some(p => p && p.session === sessionId)) return;

        for (let i = 1; i <= 4; i++) {
            if (players[i] === null) {
                players[i] = { 
                    id: socket.id, 
                    session: sessionId, 
                    color: null, 
                    name: `P${i}`,
                    ready: false,
                    lastAction: 0,
                    isBot: false
                }; 
                if (i === 1) {
                    players[i].ready = true;
                    hostSocketId = socket.id;
                }
                break;
            }
        }
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('setGameMode', (mode) => {
        if (socket.id !== hostSocketId) return;
        if (gameState) return;
        
        let seatedCount = Object.values(players).filter(p => p !== null).length;
        
        // Cannot switch to 2p if > 2 players are seated
        if (mode === '2p' && seatedCount > 2) return;
        
        if (mode === '2p' || mode === '4p') {
            gameMode = mode;
            io.emit('gameModeUpdate', gameMode);
        }
    });

    // --- BOT MANAGEMENT ---
    socket.on('addBot', (seatIndex) => {
        if (gameState) return;
        if (socket.id !== hostSocketId) return; 
        
        // Block adding bot to seat 3 or 4 if in 2P mode
        if (gameMode === '2p' && seatIndex >= 2) return;

        let pid = seatIndex + 1;
        if (players[pid] === null) {
            players[pid] = {
                id: 'BOT-' + pid,
                session: 'BOT-' + pid,
                color: BOT_COLORS[pid],
                name: `BOT ${pid}`,
                ready: true,
                isBot: true
            };
            io.emit('lobbyUpdate', getLobbyState());
        }
    });

    socket.on('removeBot', (seatIndex) => {
        if (gameState) return;
        if (socket.id !== hostSocketId) return;

        let pid = seatIndex + 1;
        if (players[pid] && players[pid].isBot) {
            players[pid] = null;
            io.emit('lobbyUpdate', getLobbyState());
        }
    });

    socket.on('setName', (nameInput) => {
        if (gameState) return; 
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        let pid = pEntry[0];
        let pData = players[pid];

        if (pData.isBot) return; 
        if (isRateLimited(pData)) return; 

        let cleanName = sanitizeString(nameInput);
        let safeName = [...(cleanName || "")].slice(0, 3).join('');
        if (safeName.length === 0) safeName = `P${pid}`; 

        players[pid].name = safeName;
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('selectColor', (hex) => {
        if (gameState) return; 
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        let pid = pEntry[0];
        let pData = players[pid];

        if (pData.isBot) return;
        if (isRateLimited(pData)) return; 
        if (!isValidHex(hex)) return;

        let isTaken = Object.values(players).some(p => p && p.id !== socket.id && p.color === hex);
        if (isTaken) return;

        players[pid].color = hex;
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('playerReady', (status) => {
        if (gameState) return;
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        
        let pid = pEntry[0];
        if (players[pid].isBot) return; 
        if (isRateLimited(players[pid])) return;

        players[pid].ready = !!status; 
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('kickPlayer', (targetPid) => {
        if (socket.id !== hostSocketId) return;
        if (targetPid === 1) return;

        if (players[targetPid]) {
            let isBot = players[targetPid].isBot;
            let socketId = players[targetPid].id;
            players[targetPid] = null;
            
            if (!isBot) {
                io.to(socketId).emit('kicked');
            }
            io.emit('lobbyUpdate', getLobbyState());
        }
    });

    socket.on('claimHost', () => {
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (pEntry && pEntry[0] === '1') {
            hostSocketId = socket.id;
            console.log("Player 1 manually claimed host.");
            io.emit('lobbyUpdate', getLobbyState());
        }
    });

    socket.on('requestStartGame', () => {
        if (socket.id !== hostSocketId) return;
        
        let seatedPlayers = Object.entries(players).filter(([k, v]) => v !== null);
        let activeCount = seatedPlayers.length;
        let allColors = seatedPlayers.every(([k, v]) => v.color !== null);

        // Mode Validation
        if (gameMode === '2p' && activeCount !== 2) return; // Must have exactly 2
        if (gameMode === '4p' && activeCount < 2) return; // Must have 2+

        if (allColors && !gameState) {
            console.log(`Starting ${gameMode} game with ${activeCount} players.`);
            totalPlayersAtStart = activeCount;
            
            let colorMap = {};
            let nameMap = {};
            seatedPlayers.forEach(([k, v]) => { 
                colorMap[k] = v.color; 
                nameMap[k] = v.name;
            });

            // Initialize state with mode
            gameState = gameLogic.initServerState(gameMode, colorMap);
            gameState.playerNames = nameMap;
            
            let firstActive = parseInt(seatedPlayers[0][0]);
            gameState.activePlayer = firstActive;

            // Mark empty seats as finished
            let maxP = (gameMode === '2p') ? 2 : 4;
            for(let i=1; i<=maxP; i++) {
                if(players[i] === null) gameState.finishedPlayers.push(i); 
            }

            io.emit('gameStart', gameMode);
            broadcastGameState();
            
            triggerBotTurn();
        }
    });

    socket.on('resetGame', () => {
        if (!gameState) return;
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;

        console.log("Game Reset requested.");
        gameState = null;
        lightningMode = false;
        if(botTimeout) clearTimeout(botTimeout);
        
        // Auto-switch mode if invalid count for 2P
        let seatedCount = Object.values(players).filter(p => p !== null).length;
        if (gameMode === '2p' && seatedCount > 2) {
            gameMode = '4p';
        }

        for(let i=1; i<=4; i++) {
            if(players[i]) {
                // Keep bots ready, reset humans
                players[i].ready = players[i].isBot || (i === 1);
                players[i].lastAction = 0;
            }
        }

        io.emit('lightningStatus', lightningMode);
        io.emit('gameModeUpdate', gameMode);
        io.emit('gameReset');
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('toggleLightning', () => {
        if (!gameState) return;
        if (socket.id !== hostSocketId) return;

        lightningMode = !lightningMode;
        io.emit('lightningStatus', lightningMode);
        
        if (players[gameState.activePlayer].isBot) {
             triggerBotTurn();
        } else {
             if (lightningMode) triggerLightningTurn();
        }
    });
    
    socket.on('rollDice', () => {
        if (!gameState) return;
        let pData = players[gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return; 

        if (isRateLimited(pData)) return; 
        performRollDice(gameState.activePlayer);
    });

    socket.on('makeMove', (data) => {
        if (!gameState) return;
        let pData = players[gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        if (pData.isBot) return;

        if (isRateLimited(pData)) return; 
        if (typeof data.marbleId !== 'number') return;
        if (typeof data.moveType !== 'string') return;

        performMakeMove(gameState.activePlayer, data.marbleId, data.moveType);
    });

    socket.on('disconnect', () => {
        connectedSockets.delete(socket.id);
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (pEntry) {
            let pid = pEntry[0];
            if (!gameState && !players[pid].isBot) {
                players[pid] = null;
            }
        }
        
        if (socket.id === hostSocketId) {
            hostSocketId = connectedSockets.size > 0 ? connectedSockets.values().next().value : null;
            if (!gameState && hostSocketId) {
                let newHostEntry = Object.entries(players).find(([k, v]) => v && v.id === hostSocketId);
                if(newHostEntry) players[newHostEntry[0]].ready = true;
            }
        }
        
        // Mode safety check on disconnect
        let seatedCount = Object.values(players).filter(p => p !== null).length;
        if (gameMode === '2p' && seatedCount > 2) {
             gameMode = '4p';
             io.emit('gameModeUpdate', gameMode);
        }

        if (connectedSockets.size === 0) {
            gameDestructionTimeout = setTimeout(() => {
                gameState = null;
                players = { 1: null, 2: null, 3: null, 4: null };
            }, 60000); 
        }
        io.emit('lobbyUpdate', getLobbyState()); 
    });
});

// --- AI & GAME LOGIC ---

function triggerBotTurn() {
    if (!gameState || gameState.phase === 'gameover') return;
    
    let activeP = players[gameState.activePlayer];
    if (!activeP || !activeP.isBot) {
        if (lightningMode) triggerLightningTurn();
        return; 
    }

    if (botTimeout) clearTimeout(botTimeout);

    let delay = lightningMode ? 50 : 2000;

    botTimeout = setTimeout(() => {
        if (!gameState || gameState.phase === 'gameover') return;
        if (gameState.activePlayer !== parseInt(activeP.name.replace('BOT ','').replace('P',''))) return;

        if (gameState.currentRoll === 0) {
            performRollDice(gameState.activePlayer);
            return;
        }

        if (gameState.currentRoll > 0 && gameState.movableMarbles.length > 0) {
            let bestMove = decideBotMove(gameState.activePlayer);
            if (bestMove) {
                performMakeMove(gameState.activePlayer, bestMove.marbleId, bestMove.type);
            }
        }
    }, delay);
}

function decideBotMove(pid) {
    let movesMap = gameState.possibleMoves;
    if (movesMap.length === 0) return null;

    let bestScore = -9999;
    let bestAction = null;

    movesMap.forEach(([mId, moves]) => {
        let marble = gameState.marbles.find(m => m.id === mId);
        
        moves.forEach(move => {
            let score = 0;

            // 1. Murder Priority
            let victim = gameState.marbles.find(m => m.id !== mId && gameLogic.samePos(m.pos, move.dest));
            if (victim && victim.player !== pid) {
                score += 1000; 
            }

            // 2. Shortcut Priority
            if (move.type === 'shortcut') score += 500;
            
            // 3. Spawn Priority
            if (move.type === 'spawn') score += 200;

            // 4. Furthest Along (Progress)
            let currentProg = calculateProgress(pid, marble.pos);
            let nextProg = calculateProgress(pid, move.dest);
            score += (nextProg - currentProg);

            if (score > bestScore) {
                bestScore = score;
                bestAction = { marbleId: mId, type: move.type };
            }
        });
    });

    return bestAction;
}

function calculateProgress(pid, pos) {
    let mode = gameState.mode;
    let pData = gameLogic.MAPS[mode].processedPlayers[pid - 1];
    
    // Home
    let homeIdx = pData.home.findIndex(h => gameLogic.samePos(h, pos));
    if (homeIdx !== -1) return 200 + homeIdx;

    // Work
    let workIdx = pData.work.findIndex(w => gameLogic.samePos(w, pos));
    if (workIdx !== -1) return 0;

    // Track
    let key = gameLogic.coordToKey(pos);
    
    if (mode === '2p') {
        let trackIdx = pData.path.indexOf(key);
        if (trackIdx !== -1) return 10 + trackIdx;
        if (key === 'E9') return 100; // 2P Shortcut
    } else {
        let trackIdx = gameLogic.MAPS['4p'].trackStr.indexOf(key);
        if (trackIdx !== -1) {
            let startKey = gameLogic.coordToKey(pData.entry1);
            let startIdx = gameLogic.MAPS['4p'].trackStr.indexOf(startKey);
            let dist = (trackIdx - startIdx + gameLogic.MAPS['4p'].trackStr.length) % gameLogic.MAPS['4p'].trackStr.length;
            return 10 + dist;
        }
        if (key === 'I9') return 100; // 4P Shortcut
    }

    return 0; 
}

// --- CORE GAME ACTIONS ---

function performRollDice(playerId) {
    if (!gameState || gameState.currentRoll > 0) return;
    if (gameState.activePlayer !== playerId) return;
    if (gameState.finishedPlayers.includes(gameState.activePlayer)) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    gameState.currentRoll = roll;
    
    const pName = gameState.playerNames[playerId] || `P${playerId}`;

    if (gameState.phase === 'init') {
        let pIndex = gameState.activePlayer - 1;
        gameState.initRolls[pIndex] = roll;
        gameState.message = `${pName} rolled ${roll}.`;

        let maxP = (gameState.mode === '2p') ? 2 : 4;
        let realPlayerIds = Object.keys(players).filter(k => players[k] !== null && k <= maxP).map(Number);
        let allRolled = realPlayerIds.every(pid => gameState.initRolls[pid-1] > 0);

        if (allRolled) {
            let maxRoll = 0;
            realPlayerIds.forEach(pid => {
                if (gameState.initRolls[pid-1] > maxRoll) maxRoll = gameState.initRolls[pid-1];
            });
            let winners = [];
            realPlayerIds.forEach(pid => {
                if (gameState.initRolls[pid-1] === maxRoll) winners.push(pid);
            });
            gameState.activePlayer = winners[0];
            const winnerName = gameState.playerNames[winners[0]] || `P${winners[0]}`;
            gameState.phase = 'play';
            gameState.message = `${winnerName} starts!`;
            gameState.currentRoll = 0;
            
            triggerBotTurn();
        } else {
            nextPlayer(); 
            const nextName = gameState.playerNames[gameState.activePlayer] || `P${gameState.activePlayer}`;
            gameState.message = `${nextName}, roll for order.`;
            gameState.currentRoll = 0;
            
            triggerBotTurn();
        }
    } else {
        let movesMap = [];
        gameState.movableMarbles = [];
        let playerMarbles = gameState.marbles.filter(m => m.player === gameState.activePlayer);
        
        playerMarbles.forEach(m => {
            let moves = gameLogic.computePossibleMoves(gameState.mode, gameState.marbles, m.id, roll);
            if (moves.length > 0) {
                gameState.movableMarbles.push(m.id);
                movesMap.push([m.id, moves]);
            }
        });
        gameState.possibleMoves = movesMap;

        if (gameState.movableMarbles.length === 0) {
            if (roll === 6 || roll === 1) {
                gameState.message = `Rolled ${roll}. No moves, but Roll Again!`;
                gameState.currentRoll = 0; 
                triggerBotTurn();
            } else {
                gameState.message = `Rolled ${roll}. No moves.`;
                setTimeout(() => {
                    nextPlayer();
                    broadcastGameState();
                    triggerBotTurn(); 
                }, 1500);
            }
        } else {
            gameState.message = `Rolled ${roll}! Move a marble.`;
            triggerBotTurn();
        }
    }
    broadcastGameState();
}

function performMakeMove(playerId, marbleId, moveType) {
    if (gameState.activePlayer !== playerId) return;
    
    let movesArray = gameState.possibleMoves.find(pm => pm[0] === marbleId);
    if (!movesArray) return;
    
    let validMoves = movesArray[1];
    let chosenMove = validMoves.find(m => m.type === moveType) || validMoves[0];

    if (chosenMove) {
        let marble = gameState.marbles.find(m => m.id === marbleId);
        
        let victim = gameState.marbles.find(m => m.id !== marbleId && gameLogic.samePos(m.pos, chosenMove.dest));
        if (victim) {
            if (gameState.stats) {
                gameState.stats.murders[playerId] = (gameState.stats.murders[playerId] || 0) + 1;
                gameState.stats.deaths[victim.player] = (gameState.stats.deaths[victim.player] || 0) + 1;
            }
            io.emit('murder', { pos: victim.pos, victimId: victim.player }); 
            
            let pData = gameLogic.MAPS[gameState.mode].processedPlayers[victim.player - 1];
            let emptyWork = pData.work.find(w => !gameState.marbles.some(m => gameLogic.samePos(m.pos, w)));
            if(emptyWork) victim.pos = { ...emptyWork };
        }

        marble.pos = { ...chosenMove.dest };

        let pId = marble.player;
        let pName = gameState.playerNames[pId] || `P${pId}`;
        let inHome = gameState.marbles.filter(m => m.player === pId && gameLogic.isHomePos(gameState.mode, pId, m.pos)).length;
        
        if (inHome === 5) {
            if (!gameState.finishedPlayers.includes(pId)) gameState.finishedPlayers.push(pId);
            
            let maxP = (gameState.mode === '2p') ? 2 : 4;
            let emptySlots = maxP - totalPlayersAtStart;
            let myRank = gameState.finishedPlayers.length - emptySlots;
            let finishedRealPlayers = gameState.finishedPlayers.length - emptySlots;

            if (finishedRealPlayers >= totalPlayersAtStart - 1) {
                gameState.message = `GAME OVER! ${pName} takes ${getOrdinal(myRank)} Place!`;
                gameState.phase = 'gameover';
            } else {
                gameState.message = `${pName} takes ${getOrdinal(myRank)} Place!`;
                broadcastGameState(); 
                setTimeout(() => {
                     nextPlayer();
                     broadcastGameState();
                     triggerBotTurn();
                }, 2500); 
                return; 
            }
        } else {
            if (gameState.currentRoll === 6 || gameState.currentRoll === 1) {
                gameState.message = `Bonus roll! ${pName} goes again.`;
                gameState.currentRoll = 0;
                gameState.movableMarbles = [];
                gameState.possibleMoves = [];
                triggerBotTurn(); 
            } else {
                nextPlayer();
                triggerBotTurn(); 
            }
        }
        broadcastGameState();
    }
}

function triggerLightningTurn() {
    if (!lightningMode || !gameState || gameState.phase === 'gameover') return;
    if (players[gameState.activePlayer].isBot) return; 

    setTimeout(() => {
        if (!lightningMode || !gameState || gameState.phase === 'gameover') return;
        if (gameState.currentRoll === 0) {
            performRollDice(gameState.activePlayer);
            return;
        }
        if (gameState.currentRoll > 0 && gameState.movableMarbles.length > 0) {
            if (gameState.possibleMoves.length === 1) {
                let movesForMarble = gameState.possibleMoves[0][1];
                if (movesForMarble.length === 1) {
                    let mId = gameState.possibleMoves[0][0];
                    let mType = movesForMarble[0].type;
                    performMakeMove(gameState.activePlayer, mId, mType);
                    return;
                }
            }
        }
    }, 50); 
}

function getLobbyState() {
    return {
        players: players, 
        seatedCount: Object.values(players).filter(p => p !== null).length,
        hostId: hostSocketId
    };
}

function nextPlayer() {
    let loopCount = 0;
    let maxP = (gameState.mode === '2p') ? 2 : 4;

    do {
        gameState.activePlayer = (gameState.activePlayer % maxP) + 1;
        loopCount++;
        if (loopCount > 10) { 
             gameState.phase = 'gameover'; 
             return;
        }
    } while (gameState.finishedPlayers.includes(gameState.activePlayer));

    gameState.currentRoll = 0;
    gameState.movableMarbles = [];
    gameState.possibleMoves = [];
    let nextName = (gameState.playerNames && gameState.playerNames[gameState.activePlayer]) || `P${gameState.activePlayer}`;
    gameState.message = `${nextName}'s turn.`;
}

function getOrdinal(n) {
    var s = ["th", "st", "nd", "rd"];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function broadcastGameState() {
    io.emit('gameState', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});