(function(exports) {
    const colMap = 'ABCDEFGHIJKLMNOPQ';
    
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

    // --- MAP DATA ---
    
    // 4 Player Classic Track (Ring)
    const TRACK_4P = ['G2','H2','I2','J2','K2','K3','K4','K5','K6','K7','L7','M7','N7','O7','P7','P8','P9','P10','P11','O11','N11','M11','L11','K11','K12','K13','K14','K15','K16','J16','I16','H16','G16','G15','G14','G13','G12','G11','F11','E11','D11','C11','B11','B10','B9','B8','B7','C7','D7','E7','F7','G7','G6','G5','G4','G3'];

    // 2 Player Duel Tracks (Linear/U-Shape)
    // P1: Counter-Clockwise from G2 -> I16
    const TRACK_2P_P1 = ['G2','G3','G4','G5','G6','G7','F7','E7','D7','C7','B7','B8','B9','B10','B11','C11','D11','E11','F11','G11','G12','G13','G14','G15','G16','H16','I16'];
    // P2: Clockwise from G16 -> I2
    const TRACK_2P_P2 = ['G16','G15','G14','G13','G12','G11','F11','E11','D11','C11','B11','B10','B9','B8','B7','C7','D7','E7','F7','G7','G6','G5','G4','G3','G2','H2','I2'];

    const MAPS = {
        '4p': {
            trackStr: TRACK_4P,
            shortcutStr: 'I9', //
            players: [
                { id: 1, workStr: ['A1','B2','C3','D4','E5'], branchStr: 'I2', homeStr: ['I3','I4','I5','I6','I7'], entry1Str: 'K2', entry6Str: 'K7', shortcutEntryStr: 'K7', shortcutExitStr: 'G7' },
                { id: 2, workStr: ['Q1','P2','O3','N4','M5'], branchStr: 'P9', homeStr: ['O9','N9','M9','L9','K9'], entry1Str: 'P11', entry6Str: 'K11', shortcutEntryStr: 'K11', shortcutExitStr: 'K7' },
                { id: 3, workStr: ['Q17','P16','O15','N14','M13'], branchStr: 'I16', homeStr: ['I15','I14','I13','I12','I11'], entry1Str: 'G16', entry6Str: 'G11', shortcutEntryStr: 'G11', shortcutExitStr: 'K11' },
                { id: 4, workStr: ['A17','B16','C15','D14','E13'], branchStr: 'B9', homeStr: ['C9','D9','E9','F9','G9'], entry1Str: 'B7', entry6Str: 'G7', shortcutEntryStr: 'G7', shortcutExitStr: 'G11' }
            ]
        },
        '2p': {
            // Combined track for visual rendering
            trackStr: [...new Set([...TRACK_2P_P1, ...TRACK_2P_P2])],
            shortcutStr: 'E9', //
            players: [
                { 
                    id: 1, 
                    workStr: ['A1','B1','A2','B2','A3'], //
                    branchStr: 'I16', //
                    homeStr: ['I11','I12','I13','I14','I15'], //
                    entry1Str: 'G2', entry6Str: 'G7', shortcutEntryStr: 'G7', shortcutExitStr: 'G11', //
                    path: TRACK_2P_P1 
                },
                { 
                    id: 2, 
                    workStr: ['A15','A16','B16','A17','B17'], //
                    branchStr: 'I2', //
                    homeStr: ['I3','I4','I5','I6','I7'], //
                    entry1Str: 'G16', entry6Str: 'G11', shortcutEntryStr: 'G11', shortcutExitStr: 'G7', //
                    path: TRACK_2P_P2
                }
            ]
        }
    };

    // Pre-process Data (Convert strings to coords)
    Object.keys(MAPS).forEach(mode => {
        let m = MAPS[mode];
        m.shortcutCoord = posToCoord(m.shortcutStr);
        m.processedPlayers = m.players.map(pd => {
            let p = { ...pd };
            p.work = p.workStr.map(posToCoord);
            p.branch = posToCoord(p.branchStr);
            p.home = p.homeStr.map(posToCoord);
            p.entry1 = posToCoord(p.entry1Str);
            p.entry6 = posToCoord(p.entry6Str);
            p.shortcutEntry = posToCoord(p.shortcutEntryStr);
            p.shortcutExit = posToCoord(p.shortcutExitStr);
            if(p.path) p.pathCoords = p.path.map(posToCoord);
            return p;
        });
        
        // Next Map for 4P (Ring)
        if (mode === '4p') {
            m.trackNext = new Map();
            for (let i = 0; i < m.trackStr.length; i++) {
                let key = m.trackStr[i];
                let nextIdx = (i + 1) % m.trackStr.length;
                m.trackNext.set(key, m.trackStr[nextIdx]);
            }
        }
        // Next Map for 2P (Linear Paths)
        if (mode === '2p') {
            m.processedPlayers.forEach(p => {
                p.trackNext = new Map();
                for(let i=0; i < p.path.length; i++) {
                    if (i < p.path.length - 1) {
                         p.trackNext.set(p.path[i], p.path[i+1]);
                    }
                }
            });
        }
    });

    // --- Core Logic ---

    function hasOwnAt(marbles, playerId, pos) {
        return marbles.some(m => m.player === playerId && samePos(m.pos, pos));
    }

    function isWorkPos(mode, playerId, pos) {
        return MAPS[mode].processedPlayers[playerId - 1].work.some(w => samePos(w, pos));
    }

    function isHomePos(mode, playerId, pos) {
        return MAPS[mode].processedPlayers[playerId - 1].home.some(h => samePos(h, pos));
    }

    function isProtectedPos(mode, marbles, pos, excludePlayerId) {
        let limit = (mode === '2p') ? 2 : 4;
        for (let pid = 1; pid <= limit; pid++) {
            if (pid === excludePlayerId) continue;
            if (isWorkPos(mode, pid, pos) || isHomePos(mode, pid, pos)) return true;
        }
        return false;
    }

    function computeAdvancePath(mode, startPos, roll, pData) {
        let mapData = MAPS[mode];
        let path = [];
        let currentKey = coordToKey(startPos);
        
        for (let s = 0; s < roll; s++) {
            let currP = posToCoord(currentKey);
            let nextKey;

            // Check if entering Home
            if (samePos(currP, pData.branch)) {
                // If branch reached, next step is Home[0]
                // logic implies you can enter home partially
                nextKey = coordToKey(pData.home[0]);
            } else {
                let hidx = pData.home.findIndex(h => samePos(h, currP));
                if (hidx !== -1) {
                    if (hidx + 1 >= 5) return null; // Overshoot home end
                    nextKey = coordToKey(pData.home[hidx + 1]);
                } else {
                    // Get next track position
                    if (mode === '4p') {
                        nextKey = mapData.trackNext.get(currentKey);
                    } else {
                        nextKey = pData.trackNext.get(currentKey);
                    }
                    if (!nextKey) return null; // End of line (Overshoot in 2P without hitting branch)
                }
            }
            path.push(posToCoord(nextKey));
            currentKey = nextKey;
        }
        return path;
    }

    function computePossibleMoves(mode, marbles, marbleId, roll) {
        let marble = marbles.find(m => m.id === marbleId);
        if (!marble) return [];
        
        let moves = [];
        let playerId = marble.player;
        let mapData = MAPS[mode];
        let pData = mapData.processedPlayers[playerId - 1];
        let startPos = marble.pos;

        // Spawn Logic
        if (isWorkPos(mode, playerId, startPos)) {
            if (roll === 1 || roll === 6) {
                let dest = roll === 1 ? pData.entry1 : pData.entry6;
                if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'spawn' });
                }
            }
            return moves;
        }

        // Shortcut Logic
        let shortcutCoord = mapData.shortcutCoord;
        
        // Enter Shortcut (Roll 1)
        if (roll === 1 && samePos(startPos, pData.shortcutEntry)) {
            let dest = shortcutCoord;
            if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                moves.push({ dest: dest, type: 'shortcut' });
            }
        }

        // Exit Shortcut (Roll 1)
        if (roll === 1 && samePos(startPos, shortcutCoord)) {
            let dest = pData.shortcutExit;
            if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                moves.push({ dest: dest, type: 'exit' });
            }
        }

        // Normal Movement
        if (!samePos(startPos, shortcutCoord)) {
            let advancePath = computeAdvancePath(mode, startPos, roll, pData);
            if (advancePath) {
                let dest = advancePath[advancePath.length - 1];
                let intermediates = advancePath.slice(0, -1);
                
                // Rule: Cannot jump own marbles
                if (intermediates.every(p => !hasOwnAt(marbles, playerId, p)) && 
                    !hasOwnAt(marbles, playerId, dest) && 
                    !isProtectedPos(mode, marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'normal' });
                }
            }
        }

        return moves;
    }

    function initServerState(mode, assignedColors) {
        let marbles = [];
        let mapData = MAPS[mode];
        let playerCount = (mode === '2p') ? 2 : 4;

        for (let pi = 0; pi < playerCount; pi++) {
            let pData = mapData.processedPlayers[pi];
            for (let mi = 0; mi < 5; mi++) {
                marbles.push({ id: marbles.length, player: pData.id, pos: { ...pData.work[mi] } });
            }
        }
        
        let statsObj = { murders: {}, deaths: {} };
        for(let i=1; i<=playerCount; i++) { statsObj.murders[i] = 0; statsObj.deaths[i] = 0; }

        return {
            mode: mode,
            phase: 'init',
            activePlayer: 1,
            playerColors: assignedColors,
            finishedPlayers: [], 
            currentRoll: 0,
            movableMarbles: [],
            possibleMoves: [],
            initRolls: new Array(playerCount).fill(0),
            message: 'Roll for first player!',
            marbles: marbles,
            stats: statsObj
        };
    }

    exports.colMap = colMap;
    exports.MAPS = MAPS;
    exports.posToCoord = posToCoord;
    exports.coordToKey = coordToKey;
    exports.computePossibleMoves = computePossibleMoves;
    exports.initServerState = initServerState;
    exports.samePos = samePos;
    exports.isHomePos = isHomePos;

})(typeof exports === 'undefined' ? this.gameLogic = {} : exports);