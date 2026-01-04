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

// Lightning Mode Flag
let lightningMode = false;

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
    if (gameState) {
        socket.emit('gameStart'); 
        socket.emit('gameState', gameState);
    }
    socket.emit('lightningStatus', lightningMode);

    // --- RECONNECTION ---
    socket.on('register', (sessionId) => {
        let returningPlayerEntry = Object.entries(players).find(([k, v]) => v && v.session === sessionId);
        if (returningPlayerEntry) {
            let pid = returningPlayerEntry[0];
            players[pid].id = socket.id;
            if (hostSocketId === null) hostSocketId = socket.id;
            socket.emit('lobbyUpdate', getLobbyState());
            if (gameState) {
                socket.emit('gameStart');
                socket.emit('gameState', gameState);
            }
            socket.emit('lightningStatus', lightningMode);
        } else {
            socket.emit('lobbyUpdate', getLobbyState());
        }
    });

    // --- LOBBY ACTIONS ---
    socket.on('joinGame', (sessionId) => {
        if (gameState) return;
        if (Object.values(players).some(p => p && p.session === sessionId)) return;
        for (let i = 1; i <= 4; i++) {
            if (players[i] === null) {
                // Initialize with ready: false (unless P1, usually host is implicitly ready but we track it)
                players[i] = { 
                    id: socket.id, 
                    session: sessionId, 
                    color: null, 
                    name: `P${i}`,
                    ready: false 
                }; 
                // If this became Player 1, they are the host and effectively "ready" to start
                if (i === 1) players[i].ready = true;
                break;
            }
        }
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('setName', (nameInput) => {
        if (gameState) return;
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        let pid = pEntry[0];

        // If player is already "ready", don't allow changes (simple lock)
        // if (players[pid].ready && pid != 1) return; 

        let safeName = [...(nameInput || "")].slice(0, 3).join('');
        if (safeName.length === 0) safeName = `P${pid}`; 

        players[pid].name = safeName;
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('selectColor', (hex) => {
        if (gameState) return;
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        let pid = pEntry[0];
        
        // if (players[pid].ready && pid != 1) return;

        let isTaken = Object.values(players).some(p => p && p.id !== socket.id && p.color === hex);
        if (isTaken) return;
        players[pid].color = hex;
        io.emit('lobbyUpdate', getLobbyState());
    });

    // NEW: Player Ready Toggle
    socket.on('playerReady', () => {
        if (gameState) return;
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        
        let pid = pEntry[0];
        players[pid].ready = true;
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('requestStartGame', () => {
        if (socket.id !== hostSocketId) return;
        let seatedPlayers = Object.entries(players).filter(([k, v]) => v !== null);
        let activeCount = seatedPlayers.length;
        let allColors = seatedPlayers.every(([k, v]) => v.color !== null);

        // Optional: Enforce that all seated players must be ready? 
        // For now, we trust the host to check the visual indicators.
        
        if (activeCount >= 2 && allColors && !gameState) {
            console.log(`Starting game with ${activeCount} players.`);
            totalPlayersAtStart = activeCount;
            
            let colorMap = {};
            let nameMap = {};
            seatedPlayers.forEach(([k, v]) => { 
                colorMap[k] = v.color; 
                nameMap[k] = v.name;
            });

            gameState = gameLogic.initServerState(colorMap);
            gameState.playerNames = nameMap;

            let firstActive = parseInt(seatedPlayers[0][0]);
            gameState.activePlayer = firstActive;

            for(let i=1; i<=4; i++) {
                if(players[i] === null) gameState.finishedPlayers.push(i); 
            }

            io.emit('gameStart');
            broadcastGameState();
            triggerLightningTurn();
        }
    });

    socket.on('resetGame', () => {
        if (!gameState) return;
        console.log("Game Reset requested.");
        gameState = null;
        lightningMode = false; 
        
        // Reset readiness on new game (except Host P1)
        for(let i=1; i<=4; i++) {
            if(players[i]) players[i].ready = (i === 1);
        }

        io.emit('lightningStatus', lightningMode);
        io.emit('gameReset');
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('toggleLightning', () => {
        if (!gameState) return;
        lightningMode = !lightningMode;
        io.emit('lightningStatus', lightningMode);
        if (lightningMode) triggerLightningTurn();
    });
    
    socket.on('rollDice', () => {
        let pData = players[gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        performRollDice(gameState.activePlayer);
    });

    socket.on('makeMove', (data) => {
        let pData = players[gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;
        performMakeMove(gameState.activePlayer, data.marbleId, data.moveType);
    });

    socket.on('disconnect', () => {
        connectedSockets.delete(socket.id);
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (pEntry) {
            let pid = pEntry[0];
            if (!gameState) players[pid] = null;
        }
        if (socket.id === hostSocketId) {
            hostSocketId = connectedSockets.size > 0 ? connectedSockets.values().next().value : null;
            // New host becomes ready automatically
            let newHostEntry = Object.entries(players).find(([k, v]) => v && v.id === hostSocketId);
            if(newHostEntry) players[newHostEntry[0]].ready = true;
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

        let realPlayerIds = Object.keys(players).filter(k => players[k] !== null).map(Number);
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
        } else {
            nextPlayer(); 
            const nextName = gameState.playerNames[gameState.activePlayer] || `P${gameState.activePlayer}`;
            gameState.message = `${nextName}, roll for order.`;
            gameState.currentRoll = 0;
        }
    } else {
        let movesMap = [];
        gameState.movableMarbles = [];
        let playerMarbles = gameState.marbles.filter(m => m.player === gameState.activePlayer);
        
        playerMarbles.forEach(m => {
            let moves = gameLogic.computePossibleMoves(gameState.marbles, m.id, roll);
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
            } else {
                gameState.message = `Rolled ${roll}. No moves.`;
                setTimeout(() => {
                    nextPlayer();
                    broadcastGameState();
                    triggerLightningTurn(); 
                }, 1500);
            }
        } else {
            gameState.message = `Rolled ${roll}! Move a marble.`;
        }
    }
    broadcastGameState();
    triggerLightningTurn(); 
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
            io.emit('murder', { ...victim.pos }); 
            let pData = gameLogic.players[victim.player - 1];
            let emptyWork = pData.work.find(w => !gameState.marbles.some(m => gameLogic.samePos(m.pos, w)));
            if(emptyWork) victim.pos = { ...emptyWork };
        }

        marble.pos = { ...chosenMove.dest };

        let pId = marble.player;
        let pName = gameState.playerNames[pId] || `P${pId}`;
        let inHome = gameState.marbles.filter(m => m.player === pId && gameLogic.isHomePos(pId, m.pos)).length;
        
        if (inHome === 5) {
            if (!gameState.finishedPlayers.includes(pId)) gameState.finishedPlayers.push(pId);
            
            let emptySlots = 4 - totalPlayersAtStart;
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
                     triggerLightningTurn();
                }, 2500); 
                return; 
            }
        } else {
            if (gameState.currentRoll === 6 || gameState.currentRoll === 1) {
                gameState.message = `Bonus roll! ${pName} goes again.`;
                gameState.currentRoll = 0;
                gameState.movableMarbles = [];
                gameState.possibleMoves = [];
            } else {
                nextPlayer();
            }
        }
        broadcastGameState();
        triggerLightningTurn(); 
    }
}

function triggerLightningTurn() {
    if (!lightningMode || !gameState || gameState.phase === 'gameover') return;

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
    do {
        gameState.activePlayer = (gameState.activePlayer % 4) + 1;
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