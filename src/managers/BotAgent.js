class BotAgent {
    constructor(room, gameLogic) {
        this.room = room;
        this.gameLogic = gameLogic;
        this.actionTimeout = null;
    }

    clearTimers() {
        if (this.actionTimeout) {
            clearTimeout(this.actionTimeout);
            this.actionTimeout = null;
        }
    }

    scheduleNextAction() {
        this.clearTimers();
        const state = this.room.gameState;
        if (!state || state.phase === 'gameover') return;

        const activePlayer = this.room.players[state.activePlayer];
        if (!activePlayer) return;

        if (activePlayer.isBot) {
            const delay = this.room.lightningMode ? 50 : 2000;
            this.actionTimeout = setTimeout(() => this.takeBotTurn(), delay);
            return;
        }

        if (this.room.lightningMode) {
            this.actionTimeout = setTimeout(() => this.takeLightningTurn(), 50);
        }
    }

    takeBotTurn() {
        const state = this.room.gameState;
        if (!state || state.phase === 'gameover') return;

        const activePlayerId = state.activePlayer;
        const activePlayer = this.room.players[activePlayerId];
        if (!activePlayer || !activePlayer.isBot) return;

        if (state.currentRoll === 0) {
            this.room.performRollDice(activePlayerId);
            return;
        }

        if (state.currentRoll > 0 && state.movableMarbles.length > 0) {
            const bestMove = this.decideBotMove(activePlayerId);
            if (bestMove) {
                this.room.performMakeMove(activePlayerId, bestMove.marbleId, bestMove.type);
            }
        }
    }

    takeLightningTurn() {
        if (!this.room.lightningMode) return;
        const state = this.room.gameState;
        if (!state || state.phase === 'gameover') return;

        const activePlayer = this.room.players[state.activePlayer];
        if (!activePlayer || activePlayer.isBot) return;

        if (state.currentRoll === 0) {
            this.room.performRollDice(state.activePlayer);
            return;
        }

        if (state.currentRoll > 0 && state.movableMarbles.length > 0) {
            if (state.possibleMoves.length === 1) {
                const movesForMarble = state.possibleMoves[0][1];
                if (movesForMarble.length === 1) {
                    const marbleId = state.possibleMoves[0][0];
                    const moveType = movesForMarble[0].type;
                    this.room.performMakeMove(state.activePlayer, marbleId, moveType);
                }
            }
        }
    }

    decideBotMove(pid) {
        const movesMap = this.room.gameState.possibleMoves;
        if (movesMap.length === 0) return null;

        let bestScore = -9999;
        let bestAction = null;

        movesMap.forEach(([mId, moves]) => {
            const marble = this.room.gameState.marbles.find(m => m.id === mId);

            moves.forEach(move => {
                let score = 0;

                const victim = this.room.gameState.marbles.find(
                    m => m.id !== mId && this.gameLogic.samePos(m.pos, move.dest)
                );
                if (victim && victim.player !== pid) {
                    score += 1000;
                }

                if (move.type === 'shortcut') score += 500;
                if (move.type === 'spawn') score += 200;

                const currentProg = this.calculateProgress(pid, marble.pos);
                const nextProg = this.calculateProgress(pid, move.dest);
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
        const mode = this.room.gameState.mode;
        const pData = this.gameLogic.MAPS[mode].processedPlayers[pid - 1];

        const homeIdx = pData.home.findIndex(h => this.gameLogic.samePos(h, pos));
        if (homeIdx !== -1) return 200 + homeIdx;

        const workIdx = pData.work.findIndex(w => this.gameLogic.samePos(w, pos));
        if (workIdx !== -1) return 0;

        const key = this.gameLogic.coordToKey(pos);

        if (mode === '2p') {
            const trackIdx = pData.path.indexOf(key);
            if (trackIdx !== -1) return 10 + trackIdx;
            if (key === 'E9') return 100;
        } else if (mode === '6p') {
            const trackIdx = this.gameLogic.MAPS['6p'].trackStr.indexOf(key);
            if (trackIdx !== -1) {
                const startKey = this.gameLogic.coordToKey(pData.entry1);
                const startIdx = this.gameLogic.MAPS['6p'].trackStr.indexOf(startKey);
                const dist = (trackIdx - startIdx + this.gameLogic.MAPS['6p'].trackStr.length) % this.gameLogic.MAPS['6p'].trackStr.length;
                return 10 + dist;
            }
            if (key === 'H9' || key === 'H11') return 100;
        } else {
            const trackIdx = this.gameLogic.MAPS['4p'].trackStr.indexOf(key);
            if (trackIdx !== -1) {
                const startKey = this.gameLogic.coordToKey(pData.entry1);
                const startIdx = this.gameLogic.MAPS['4p'].trackStr.indexOf(startKey);
                const dist = (trackIdx - startIdx + this.gameLogic.MAPS['4p'].trackStr.length) % this.gameLogic.MAPS['4p'].trackStr.length;
                return 10 + dist;
            }
            if (key === 'I9') return 100;
        }

        return 0;
    }
}

module.exports = BotAgent;
