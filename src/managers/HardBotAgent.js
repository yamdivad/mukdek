const BotAgent = require('./BotAgent');

class HardBotAgent extends BotAgent {
    decideBotMove(pid) {
        const state = this.room.gameState;
        const movesMap = state.possibleMoves;
        if (movesMap.length === 0) return null;

        let bestScore = -999999;
        let bestAction = null;

        movesMap.forEach(([mId, moves]) => {
            const marble = state.marbles.find(m => m.id === mId);
            if (!marble) return;

            moves.forEach(move => {
                let score = this.scoreMove(pid, marble, move);
                if (score > bestScore) {
                    bestScore = score;
                    bestAction = { marbleId: mId, type: move.type };
                }
            });
        });

        return bestAction;
    }

    scoreMove(pid, marble, move) {
        const state = this.room.gameState;
        let score = 0;

        const victim = state.marbles.find(
            m => m.id !== marble.id && this.gameLogic.samePos(m.pos, move.dest)
        );
        if (victim && victim.player !== pid) {
            score += 1400;
        }

        if (move.type === 'shortcut') score += 450;
        if (move.type === 'spawn') score += 180;

        const currentProg = this.calculateProgress(pid, marble.pos);
        const nextProg = this.calculateProgress(pid, move.dest);
        score += (nextProg - currentProg) * 2.5;

        const homeIdx = this.getHomeIndex(state.mode, pid, move.dest);
        if (homeIdx !== -1) {
            score += 900 + (homeIdx * 60);
        }

        if (this.isProtectedPosition(state.mode, move.dest)) {
            score += 120;
        }

        const threatNow = this.countCaptureThreat(pid, marble.pos);
        const threatNext = this.countCaptureThreat(pid, move.dest);
        if (threatNext > 0) {
            score -= threatNext * 120;
        }
        if (threatNow > threatNext) {
            score += (threatNow - threatNext) * 90;
        }

        return score;
    }

    getHomeIndex(mode, pid, pos) {
        const mapData = this.gameLogic.MAPS[mode];
        if (!mapData || !mapData.processedPlayers) return -1;
        const pData = mapData.processedPlayers[pid - 1];
        if (!pData || !pData.home) return -1;
        return pData.home.findIndex(h => this.gameLogic.samePos(h, pos));
    }

    isProtectedPosition(mode, pos) {
        const mapData = this.gameLogic.MAPS[mode];
        if (!mapData || !mapData.processedPlayers) return false;
        const maxP = (mode === '2p') ? 2 : (mode === '6p' ? 6 : 4);
        for (let pid = 1; pid <= maxP; pid++) {
            const pData = mapData.processedPlayers[pid - 1];
            if (!pData) continue;
            if (pData.work.some(w => this.gameLogic.samePos(w, pos))) return true;
            if (pData.home.some(h => this.gameLogic.samePos(h, pos))) return true;
        }
        return false;
    }

    countCaptureThreat(pid, pos) {
        const state = this.room.gameState;
        const mode = state.mode;
        if (mode !== '6p') return 0;
        if (this.isProtectedPosition(mode, pos)) return 0;

        const mapData = this.gameLogic.MAPS['6p'];
        const destKey = this.gameLogic.coordToKey(pos);
        const destIdx = mapData.trackStr.indexOf(destKey);
        if (destIdx === -1) return 0;

        let threat = 0;
        state.marbles.forEach((m) => {
            if (m.player === pid) return;
            const mKey = this.gameLogic.coordToKey(m.pos);
            const mIdx = mapData.trackStr.indexOf(mKey);
            if (mIdx === -1) return;

            const dist = (destIdx - mIdx + mapData.trackStr.length) % mapData.trackStr.length;
            if (dist >= 1 && dist <= 6) {
                threat += (7 - dist);
            }
        });

        return threat;
    }
}

module.exports = HardBotAgent;
