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

// NEW: Lightning Mode Flag
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

    // Send initial state including lightning status
    socket.emit('lobbyUpdate', getLobbyState());
    if (gameState) {
        socket.emit('gameStart'); 
        socket.emit('gameState', gameState);
    }
    // Broadcast lightning status on connect
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
                players[i] = { id: socket.id, session: sessionId, color: null }; 
                break;
            }
        }
        io.emit('lobbyUpdate', getLobbyState());
    });

    socket.on('selectColor', (hex) => {
        if (gameState) return;
        let pEntry = Object.entries(players).find(([k, v]) => v && v.id === socket.id);
        if (!pEntry) return;
        let pid = pEntry[0];
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
            seatedPlayers.forEach(([k, v]) => { colorMap[k] = v.color; });

            gameState = gameLogic.initServerState(colorMap);
            let firstActive = parseInt(seatedPlayers[0][0]);
            gameState.activePlayer = firstActive;

            for(let i=1; i<=4; i++) {
                if(players[i] === null) gameState.finishedPlayers.push(i); 
            }

            io.emit('gameStart');
            broadcastGameState();
            // Start the lightning loop if it was somehow left on, or just for consistency
            triggerLightningTurn();
        }
    });

    socket.on('resetGame', () => {
        if (!gameState) return;
        console.log("Game Reset requested.");
        gameState = null;
        lightningMode = false; // Reset lightning mode
        io.emit('lightningStatus', lightningMode);
        io.emit('gameReset');
        io.emit('lobbyUpdate', getLobbyState());
    });

    // --- SETTINGS: LIGHTNING MODE ---
    socket.on('toggleLightning', () => {
        // Only allow if game is running
        if (!gameState) return;
        lightningMode = !lightningMode;
        console.log(`Lightning Mode set to: ${lightningMode}`);
        io.emit('lightningStatus', lightningMode);
        
        // If turned ON, try to trigger an action immediately
        if (lightningMode) triggerLightningTurn();
    });
    
    // --- GAME ACTIONS ---
    socket.on('rollDice', () => {
        // Validation: Must be active player's socket
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

// --- CORE LOGIC FUNCTIONS (Decoupled from Socket) ---

function performRollDice(playerId) {
    if (!gameState || gameState.currentRoll > 0) return;
    if (gameState.activePlayer !== playerId) return;
    
    // Prevent actions if player has finished
    if (gameState.finishedPlayers.includes(gameState.activePlayer)) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    gameState.currentRoll = roll;

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
    } else {
        // PLAY PHASE
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
                    triggerLightningTurn(); // Trigger after turn pass
                }, 1500);
            }
        } else {
            gameState.message = `Rolled ${roll}! Move a marble.`;
        }
    }
    broadcastGameState();
    triggerLightningTurn(); // Check if we can auto-move
}

function performMakeMove(playerId, marbleId, moveType) {
    if (gameState.activePlayer !== playerId) return;
    
    let movesArray = gameState.possibleMoves.find(pm => pm[0] === marbleId);
    if (!movesArray) return;
    
    let validMoves = movesArray[1];
    let chosenMove = validMoves.find(m => m.type === moveType) || validMoves[0];

    if (chosenMove) {
        let marble = gameState.marbles.find(m => m.id === marbleId);
        
        // Capture Logic
        let victim = gameState.marbles.find(m => m.id !== marbleId && gameLogic.samePos(m.pos, chosenMove.dest));
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
            if (!gameState.finishedPlayers.includes(pId)) gameState.finishedPlayers.push(pId);
            
            let emptySlots = 4 - totalPlayersAtStart;
            let myRank = gameState.finishedPlayers.length - emptySlots;
            let finishedRealPlayers = gameState.finishedPlayers.length - emptySlots;

            if (finishedRealPlayers >= totalPlayersAtStart - 1) {
                gameState.message = `GAME OVER! Player ${pId} takes ${getOrdinal(myRank)} Place!`;
                gameState.phase = 'gameover';
            } else {
                gameState.message = `Player ${pId} takes ${getOrdinal(myRank)} Place!`;
                broadcastGameState(); // Show immediate result
                setTimeout(() => {
                     nextPlayer();
                     broadcastGameState();
                     triggerLightningTurn();
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
        triggerLightningTurn(); // Check if next state is auto-rollable
    }
}

// --- LIGHTNING ROUND LOGIC ---
function triggerLightningTurn() {
    if (!lightningMode || !gameState || gameState.phase === 'gameover') return;

    // Use a delay to allow UI updates and make it followable
    setTimeout(() => {
        // Re-check state after delay (in case it changed or game ended)
        if (!lightningMode || !gameState || gameState.phase === 'gameover') return;

        // 1. Auto Roll
        if (gameState.currentRoll === 0) {
            console.log(`Lightning: Auto-rolling for P${gameState.activePlayer}`);
            performRollDice(gameState.activePlayer);
            return;
        }

        // 2. Auto Move (If exactly one choice)
        if (gameState.currentRoll > 0 && gameState.movableMarbles.length > 0) {
            // Check total number of distinct move options
            // If only 1 marble can move, AND that marble has only 1 destination (e.g. no shortcut option)
            if (gameState.possibleMoves.length === 1) {
                let movesForMarble = gameState.possibleMoves[0][1];
                if (movesForMarble.length === 1) {
                    let mId = gameState.possibleMoves[0][0];
                    let mType = movesForMarble[0].type;
                    console.log(`Lightning: Auto-moving marble ${mId}`);
                    performMakeMove(gameState.activePlayer, mId, mType);
                    return;
                }
            }
            // If we get here, there is a choice. We wait for the user.
            console.log("Lightning: Waiting for user choice.");
        }
    }, 1000); // 1 second delay between actions
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