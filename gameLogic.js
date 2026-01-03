(function(exports) {
    // --- constants ---
    const colMap = 'ABCDEFGHIJKLMNOPQ';
    const trackStr = ['G2','H2','I2','J2','K2','K3','K4','K5','K6','K7','L7','M7','N7','O7','P7','P8','P9','P10','P11','O11','N11','M11','L11','K11','K12','K13','K14','K15','K16','J16','I16','H16','G16','G15','G14','G13','G12','G11','F11','E11','D11','C11','B11','B10','B9','B8','B7','C7','D7','E7','F7','G7','G6','G5','G4','G3'];
    const shortcutStr = 'I9';
    
    // --- Helpers ---
    function posToCoord(key) {
        return { col: colMap.indexOf(key[0]), row: parseInt(key.slice(1)) - 1 };
    }
    function coordToKey(pos) {
        return colMap[pos.col] + (pos.row + 1);
    }
    function samePos(a, b) {
        return a.col === b.col && a.row === b.row;
    }

    // Player definitions (Positions only, colors are now dynamic)
    const playersData = [
        { id: 1, workStr: ['A1','B2','C3','D4','E5'], branchStr: 'I2', homeStr: ['I3','I4','I5','I6','I7'], entry1Str: 'K2', entry6Str: 'K7', shortcutEntryStr: 'K7', shortcutExitStr: 'G7' },
        { id: 2, workStr: ['Q1','P2','O3','N4','M5'], branchStr: 'P9', homeStr: ['O9','N9','M9','L9','K9'], entry1Str: 'P11', entry6Str: 'K11', shortcutEntryStr: 'K11', shortcutExitStr: 'K7' },
        { id: 3, workStr: ['Q17','P16','O15','N14','M13'], branchStr: 'I16', homeStr: ['I15','I14','I13','I12','I11'], entry1Str: 'G16', entry6Str: 'G11', shortcutEntryStr: 'G11', shortcutExitStr: 'K11' },
        { id: 4, workStr: ['A17','B16','C15','D14','E13'], branchStr: 'B9', homeStr: ['C9','D9','E9','F9','G9'], entry1Str: 'B7', entry6Str: 'G7', shortcutEntryStr: 'G7', shortcutExitStr: 'G11' }
    ];

    // Pre-process player data
    const players = playersData.map(pd => {
        let p = { ...pd };
        p.work = p.workStr.map(posToCoord);
        p.branch = posToCoord(p.branchStr);
        p.home = p.homeStr.map(posToCoord);
        p.entry1 = posToCoord(p.entry1Str);
        p.entry6 = posToCoord(p.entry6Str);
        p.shortcutEntry = posToCoord(p.shortcutEntryStr);
        p.shortcutExit = posToCoord(p.shortcutExitStr);
        return p;
    });

    const trackNext = new Map();
    for (let i = 0; i < trackStr.length; i++) {
        let key = trackStr[i];
        let nextIdx = (i + 1) % trackStr.length;
        let nextKey = trackStr[nextIdx];
        trackNext.set(key, nextKey);
    }
    const shortcutCoord = posToCoord(shortcutStr);

    // --- Core Logic Functions ---

    function hasOwnAt(marbles, playerId, pos) {
        return marbles.some(m => m.player === playerId && samePos(m.pos, pos));
    }

    function isWorkPos(playerId, pos) {
        return players[playerId - 1].work.some(w => samePos(w, pos));
    }

    function isHomePos(playerId, pos) {
        return players[playerId - 1].home.some(h => samePos(h, pos));
    }

    function isProtectedPos(marbles, pos, excludePlayerId) {
        for (let pid = 1; pid <= 4; pid++) {
            if (pid === excludePlayerId) continue;
            if (isWorkPos(pid, pos) || isHomePos(pid, pos)) return true;
        }
        return false;
    }

    function computeAdvancePath(startPos, roll, pData) {
        let path = [];
        let currentKey = coordToKey(startPos);
        for (let s = 0; s < roll; s++) {
            let currP = posToCoord(currentKey);
            let nextKey;
            if (samePos(currP, pData.branch)) {
                nextKey = coordToKey(pData.home[0]);
            } else {
                let hidx = pData.home.findIndex(h => samePos(h, currP));
                if (hidx !== -1) {
                    if (hidx + 1 >= 5) return null; // overshoot home
                    nextKey = coordToKey(pData.home[hidx + 1]);
                } else {
                    nextKey = trackNext.get(currentKey);
                    if (!nextKey) return null;
                }
            }
            path.push(posToCoord(nextKey));
            currentKey = nextKey;
        }
        return path;
    }

    function computePossibleMoves(marbles, marbleId, roll) {
        let marble = marbles.find(m => m.id === marbleId);
        if (!marble) return [];
        
        let moves = [];
        let playerId = marble.player;
        let pData = players[playerId - 1];
        let startPos = marble.pos;

        // Spawn
        if (isWorkPos(playerId, startPos)) {
            if (roll === 1 || roll === 6) {
                let dest = roll === 1 ? pData.entry1 : pData.entry6;
                if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'spawn' });
                }
            }
            return moves;
        }

        // Normal
        if (!samePos(startPos, shortcutCoord)) {
            let advancePath = computeAdvancePath(startPos, roll, pData);
            if (advancePath) {
                let dest = advancePath[advancePath.length - 1];
                let intermediates = advancePath.slice(0, -1);
                // Can't jump own marbles
                if (intermediates.every(p => !hasOwnAt(marbles, playerId, p)) && 
                    !hasOwnAt(marbles, playerId, dest) && 
                    !isProtectedPos(marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'normal' });
                }
            }
        }

        // Shortcut
        if (roll === 1) {
            if (samePos(startPos, pData.shortcutEntry)) {
                let dest = shortcutCoord;
                if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'shortcut' });
                }
            }
            if (samePos(startPos, shortcutCoord)) {
                let dest = pData.shortcutExit;
                if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'exit' });
                }
            }
        }
        return moves;
    }

    function initServerState(assignedColors) {
        let marbles = [];
        for (let pi = 0; pi < 4; pi++) {
            let pData = players[pi];
            for (let mi = 0; mi < 5; mi++) {
                marbles.push({ id: marbles.length, player: pData.id, pos: { ...pData.work[mi] } });
            }
        }
        return {
            phase: 'init',
            activePlayer: 1,
            playerColors: assignedColors, // Store colors in state for client rendering
            finishedPlayers: [], 
            currentRoll: 0,
            movableMarbles: [],
            possibleMoves: [],
            initRolls: [0,0,0,0],
            message: 'Roll for first player!',
            marbles: marbles
        };
    }

    exports.colMap = colMap;
    exports.trackStr = trackStr;
    exports.posToCoord = posToCoord;
    exports.coordToKey = coordToKey;
    exports.players = players;
    exports.computePossibleMoves = computePossibleMoves;
    exports.initServerState = initServerState;
    exports.samePos = samePos;
    exports.isHomePos = isHomePos;

})(typeof exports === 'undefined' ? this.gameLogic = {} : exports);