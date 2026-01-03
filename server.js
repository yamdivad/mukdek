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
// Player map: { 1: { id: socketId, session: "abc-123", color: hex }, 2: null, ... }
let players = { 1: null, 2: null, 3: null, 4: null };

let connectedSockets = new Set();
let hostSocketId = null;
let gameState = null;
let totalPlayersAtStart = 0;

// Timeout to clear game if everyone disconnects
let gameDestructionTimeout = null;

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    connectedSockets.add(socket.id);

    // Cancel game destruction if someone connects
    if (gameDestructionTimeout) {
        clearTimeout(gameDestructionTimeout);
        gameDestructionTimeout = null;
    }

    // Assign Host if none exists (or if host reconnects, we handle that in 'register')
    if (hostSocketId === null) {
        hostSocketId = socket.id;
    }

    // 1. Send initial lobby status (just to show UI, logic happens in register)
    socket.emit('lobbyUpdate', getLobbyState());

    // --- RECONNECTION HANDSHAKE ---
    socket.on('register', (sessionId) => {
        // Check if this session belongs to an existing player
        let returningPlayerEntry = Object.entries(players).find(([k, v]) => v && v.session === sessionId);
        
        if (returningPlayerEntry) {
            // RECONNECTION DETECTED
            let pid = returningPlayerEntry[0];
            console.log(`Player ${pid} reconnected (Session: ${sessionId})`);
            
            // Update socket ID to the new one
            players[pid].id = socket.id;
            
            // If I was the host, update host ID
            if (hostSocketId === null) hostSocketId = socket.id;

            // Send them their identity immediately
            socket.emit('lobbyUpdate', getLobbyState());
            
            if (gameState) {
                socket.emit('gameStart');
                socket.emit('gameState', gameState);
            }
        } else {
            // NEW PLAYER
            // Just send lobby update, they are a spectator/unassigned until they join
            socket.emit('lobbyUpdate', getLobbyState());
        }
    });

    // --- LOBBY ACTIONS ---

    socket.on('joinGame', (sessionId) => {
        if (gameState) return;
        
        // Check if already seated
        if (Object.values(players).some(p => p && p.session === sessionId)) return;

        // Find first empty slot
        for (let i = 1; i <= 4; i++) {
            if (players[i] === null) {
                // bind socket AND session
                players[i] = { id: socket.id, session: sessionId, color: null }; 
                console.log(`Player ${i} assigned to session ${sessionId}`);
                break;
            }
        }
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('selectColor', (hex) => {
        if (gameState) return;

        // Find player by socket ID
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;

        let pid = pEntry[0];
        
        // Ensure color isn't taken by someone else
        let isTaken = Object.values(players).some(p => p && p.id !== socket.id && p.color === hex);
        if (isTaken) return;

        players[pid].color = hex;
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('requestStartGame', () => {
        if (socket.id !== hostSocketId) return;

        let seatedPlayers = Object.entries(players).filter(([k, v]) => v !== null);
        let activeCount = seatedPlayers.length;
        let allReady = seatedPlayers.every(([k, v]) => v.color !== null);

        if (activeCount >= 2 && allReady && !gameState) {
            console.log(`Starting game with ${activeCount} players.`);
            totalPlayersAtStart = activeCount;
            
            let colorMap = {};
            seatedPlayers.forEach(([k, v]) => {
                colorMap[k] = v.color;
            });

            gameState = gameLogic.initServerState(colorMap);
            
            let firstActive = parseInt(seatedPlayers[0][0]);
            gameState.activePlayer = firstActive;

            for(let i=1; i<=4; i++) {
                if(players[i] === null) {
                    gameState.finishedPlayers.push(i); 
                }
            }

            io.emit('gameStart');
            broadcastGameState();
        }
    });
    
    // --- GAME ACTIONS ---

    socket.on('rollDice', () => {
        // Identity check: Must match active player's socket
        let pData = players[gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;

        if (!gameState || gameState.currentRoll > 0) return;

        if (gameState.finishedPlayers.includes(gameState.activePlayer)) {
            nextPlayer();
            broadcastGameState();
            return;
        }

        const roll = Math.floor(Math.random() * 6) + 1;
        gameState.currentRoll = roll;

        // INIT PHASE
        if (gameState.phase === 'init') {
            let pIndex = gameState.activePlayer - 1;
            gameState.initRolls[pIndex] = roll;
            gameState.message = `Player ${gameState.activePlayer} rolled ${roll}.`;

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
                gameState.phase = 'play';
                gameState.message = `Player ${gameState.activePlayer} starts!`;
                gameState.currentRoll = 0;
            } else {
                nextPlayer(); 
                gameState.message = `Player ${gameState.activePlayer}, roll for order.`;
                gameState.currentRoll = 0;
            }
        } 
        // PLAY PHASE
        else {
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
                    }, 1500);
                }
            } else {
                gameState.message = `Rolled ${roll}! Move a marble.`;
            }
        }
        broadcastGameState();
    });

    socket.on('makeMove', (data) => {
        let pData = players[gameState.activePlayer];
        if (!pData || pData.id !== socket.id) return;

        const { marbleId, moveType } = data;
        let movesArray = gameState.possibleMoves.find(pm => pm[0] === marbleId);
        if (!movesArray) return;
        
        let validMoves = movesArray[1];
        let chosenMove = validMoves.find(m => m.type === moveType) || validMoves[0];

        if (chosenMove) {
            let marble = gameState.marbles.find(m => m.id === marbleId);
            
            let victim = gameState.marbles.find(m => 
                m.id !== marbleId && 
                gameLogic.samePos(m.pos, chosenMove.dest)
            );
            if (victim) {
                io.emit('murder', { ...victim.pos }); 
                let pData = gameLogic.players[victim.player - 1];
                let emptyWork = pData.work.find(w => !gameState.marbles.some(m => gameLogic.samePos(m.pos, w)));
                if(emptyWork) victim.pos = { ...emptyWork };
            }

            marble.pos = { ...chosenMove.dest };

            let pId = marble.player;
            let inHome = gameState.marbles.filter(m => m.player === pId && gameLogic.isHomePos(pId, m.pos)).length;
            
            if (inHome === 5) {
                if (!gameState.finishedPlayers.includes(pId)) {
                    gameState.finishedPlayers.push(pId);
                }
                
                let emptySlots = 4 - totalPlayersAtStart;
                let myRank = gameState.finishedPlayers.length - emptySlots;
                let finishedRealPlayers = gameState.finishedPlayers.length - emptySlots;

                if (finishedRealPlayers >= totalPlayersAtStart - 1) {
                    gameState.message = `GAME OVER! Player ${pId} takes ${getOrdinal(myRank)} Place!`;
                    gameState.phase = 'gameover';
                } else {
                    gameState.message = `Player ${pId} takes ${getOrdinal(myRank)} Place!`;
                    setTimeout(() => {
                         nextPlayer();
                         broadcastGameState();
                    }, 2500); 
                    return; 
                }
            } else {
                if (gameState.currentRoll === 6 || gameState.currentRoll === 1) {
                    gameState.message = `Bonus roll! Player ${pId} goes again.`;
                    gameState.currentRoll = 0;
                    gameState.movableMarbles = [];
                    gameState.possibleMoves = [];
                } else {
                    nextPlayer();
                }
            }
            broadcastGameState();
        }
    });

    socket.on('disconnect', () => {
        console.log(`Socket ${socket.id} disconnected`);
        connectedSockets.delete(socket.id);
        
        // Find who disconnected
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        
        if (pEntry) {
            let pid = pEntry[0];
            
            // CRITICAL: If game is running, DO NOT remove player from slot. 
            // Only remove if we are in Lobby mode.
            if (!gameState) {
                players[pid] = null;
                console.log(`Player ${pid} left lobby.`);
            } else {
                console.log(`Player ${pid} disconnected during game (Slot reserved).`);
            }
        }

        // Host Migration (if host leaves, assign to next available socket)
        if (socket.id === hostSocketId) {
            if (connectedSockets.size > 0) {
                hostSocketId = connectedSockets.values().next().value;
            } else {
                hostSocketId = null;
            }
        }
        
        // If everyone leaves, start a timer to kill the game
        if (connectedSockets.size === 0) {
            console.log("All players disconnected. Setting destruction timer.");
            gameDestructionTimeout = setTimeout(() => {
                console.log("Game destroyed due to inactivity.");
                gameState = null;
                players = { 1: null, 2: null, 3: null, 4: null };
            }, 60000); // 1 minute to reconnect before hard reset
        }
        
        io.emit('lobbyUpdate', getLobbyState()); 
    });
});

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
    gameState.message = `Player ${gameState.activePlayer}'s turn.`;
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