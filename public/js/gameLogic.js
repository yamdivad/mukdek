"use strict";

(function(exports) {
    // Extended for 4P (Q=17), fits 6P (O=15)
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
    const TRACK_2P_P1 = ['G2','G3','G4','G5','G6','G7','F7','E7','D7','C7','B7','B8','B9','B10','B11','C11','D11','E11','F11','G11','G12','G13','G14','G15','G16','H16','I16'];
    const TRACK_2P_P2 = ['G16','G15','G14','G13','G12','G11','F11','E11','D11','C11','B11','B10','B9','B8','B7','C7','D7','E7','F7','G7','G6','G5','G4','G3','G2','H2','I2'];

    // 6 Player Track (Cross with double bars) - 15 Columns (A-O), 19 Rows
    const TRACK_6P = [
        'F1', 'G1', 'H1', 'I1', 'J1', 'J2', 'J3', 'J4', 'J5', // Top Leg Right
        'K5', 'L5', 'M5', 'N5', // Right Arm Top
        'N6', 'N7', 'N8', 'N9', // Right Arm Right
        'M9', 'L9', 'K9', // Right Arm Bottom (upper)
        'J10', // Center Right (Regular track tile)
        'K11', 'L11', 'M11', 'N11', // Right Arm Bottom (lower)
        'N12', 'N13', 'N14', 'N15', // Right Arm Right (lower)
        'M15', 'L15', 'K15', 'J15', // Bottom Leg Right
        'J16', 'J17', 'J18', 'J19', 'I19', 'H19', 'G19', 'F19', // Bottom Leg Bottom & Left
        'F18', 'F17', 'F16', 'F15', // Bottom Leg Left
        'E15', 'D15', 'C15', 'B15', // Left Arm Bottom
        'B14', 'B13', 'B12', 'B11', // Left Arm Left
        'C11', 'D11', 'E11', // Left Arm Top (lower)
        'F10', // Center Left
        'E9', 'D9', 'C9', 'B9', // Left Arm Top (upper)
        'B8', 'B7', 'B6', 'B5', // Left Arm Left
        'C5', 'D5', 'E5', 'F5', // Left Arm Top
        'F4', 'F3', 'F2' // Top Leg Left
    ];

    const MAPS = {
        '4p': {
            gridCols: 17, gridRows: 17,
            trackStr: TRACK_4P,
            shortcutStr: 'I9',
            players: [
                { id: 1, workStr: ['A1','B2','C3','D4','E5'], branchStr: 'I2', homeStr: ['I3','I4','I5','I6','I7'], entry1Str: 'K2', entry6Str: 'K7', shortcutEntryStr: 'K7', shortcutExitStr: 'G7' },
                { id: 2, workStr: ['Q1','P2','O3','N4','M5'], branchStr: 'P9', homeStr: ['O9','N9','M9','L9','K9'], entry1Str: 'P11', entry6Str: 'K11', shortcutEntryStr: 'K11', shortcutExitStr: 'K7' },
                { id: 3, workStr: ['Q17','P16','O15','N14','M13'], branchStr: 'I16', homeStr: ['I15','I14','I13','I12','I11'], entry1Str: 'G16', entry6Str: 'G11', shortcutEntryStr: 'G11', shortcutExitStr: 'K11' },
                { id: 4, workStr: ['A17','B16','C15','D14','E13'], branchStr: 'B9', homeStr: ['C9','D9','E9','F9','G9'], entry1Str: 'B7', entry6Str: 'G7', shortcutEntryStr: 'G7', shortcutExitStr: 'G11' }
            ]
        },
        '2p': {
            gridCols: 17, gridRows: 17,
            trackStr: [...new Set([...TRACK_2P_P1, ...TRACK_2P_P2])],
            shortcutStr: 'E9',
            players: [
                { id: 1, workStr: ['A1','B1','A2','B2','A3'], branchStr: 'I16', homeStr: ['I15','I14','I13','I12','I11'], entry1Str: 'G2', entry6Str: 'G7', shortcutEntryStr: 'G7', shortcutExitStr: 'G11', path: TRACK_2P_P1 },
                { id: 2, workStr: ['A15','A16','B16','A17','B17'], branchStr: 'I2', homeStr: ['I3','I4','I5','I6','I7'], entry1Str: 'G16', entry6Str: 'G11', shortcutEntryStr: 'G11', shortcutExitStr: 'G7', path: TRACK_2P_P2 }
            ]
        },
        '6p': {
            gridCols: 15, gridRows: 19, // 15 columns (A-O), 19 Rows
            trackStr: TRACK_6P,
            shortcutStr: 'J10', // Fallback, distinct shortcuts defined per player below
            players: [
                { 
                    id: 1, workStr: ['C2','D2','C3','D3'], branchStr: 'H1', homeStr: ['H2','H3','H4','H5'], 
                    entry1Str: 'J1', entry6Str: 'J5', shortcutEntryStr: 'J5', shortcutExitStr: 'F5', targetShortcutStr: 'H9' 
                },
                { 
                    id: 2, workStr: ['L2','M2','L3','M3'], branchStr: 'N7', homeStr: ['M7','L7','K7','J7'], 
                    entry1Str: 'N9', entry6Str: 'J10', shortcutEntryStr: 'J10', shortcutExitStr: 'J5', targetShortcutStr: 'H9'
                },
                { 
                    id: 3, workStr: ['O11','O12','O13','O14'], branchStr: 'N13', homeStr: ['M13','L13','K13','J13'], 
                    entry1Str: 'N15', entry6Str: 'J15', shortcutEntryStr: 'J15', shortcutExitStr: 'J10', targetShortcutStr: 'H11'
                },
                { 
                    id: 4, workStr: ['L17','M17','L18','M18'], branchStr: 'H19', homeStr: ['H18','H17','H16','H15'], 
                    entry1Str: 'F19', entry6Str: 'F15', shortcutEntryStr: 'F15', shortcutExitStr: 'J15', targetShortcutStr: 'H11'
                },
                { 
                    id: 5, workStr: ['C17','D17','C18','D18'], branchStr: 'B13', homeStr: ['C13','D13','E13','F13'], 
                    entry1Str: 'B11', entry6Str: 'F10', shortcutEntryStr: 'F10', shortcutExitStr: 'F15', targetShortcutStr: 'H11'
                },
                { 
                    id: 6, workStr: ['A6','A7','A8','A9'], branchStr: 'B7', homeStr: ['C7','D7','E7','F7'], 
                    entry1Str: 'B5', entry6Str: 'F5', shortcutEntryStr: 'F5', shortcutExitStr: 'F10', targetShortcutStr: 'H9'
                }
            ]
        }
    };

    // Pre-process Data
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
            if (p.targetShortcutStr) p.targetShortcut = posToCoord(p.targetShortcutStr);
            if(p.path) p.pathCoords = p.path.map(posToCoord);
            return p;
        });
        if (mode === '6p') {
            let keys = [];
            m.players.forEach(p => {
                if (p.targetShortcutStr) keys.push(p.targetShortcutStr);
            });
            let uniq = [...new Set(keys)];
            m.shortcutCoords = uniq.map(posToCoord);
        }
        
        if (mode === '4p' || mode === '6p') {
            m.trackNext = new Map();
            for (let i = 0; i < m.trackStr.length; i++) {
                let key = m.trackStr[i];
                let nextIdx = (i + 1) % m.trackStr.length;
                m.trackNext.set(key, m.trackStr[nextIdx]);
            }
        }
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
        let maxP = (mode === '2p') ? 2 : (mode === '6p' ? 6 : 4);
        for (let pid = 1; pid <= maxP; pid++) {
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
                nextKey = coordToKey(pData.home[0]);
            } else {
                let hidx = pData.home.findIndex(h => samePos(h, currP));
                if (hidx !== -1) {
                    if (hidx + 1 >= pData.home.length) return null; // Overshoot
                    nextKey = coordToKey(pData.home[hidx + 1]);
                } else {
                    if (mode === '2p') {
                        nextKey = pData.trackNext.get(currentKey);
                    } else {
                        nextKey = mapData.trackNext.get(currentKey);
                    }
                    if (!nextKey) return null;
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

        // Spawn
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
        // Use specific target shortcut if defined (6p), else default (4p/2p)
        let shortcutCoord = pData.targetShortcut || mapData.shortcutCoord;
        let shortcutCoords = (mode === '6p' && mapData.shortcutCoords) ? mapData.shortcutCoords : [shortcutCoord];
        let isOnShortcut = (mode === '6p') ? shortcutCoords.some(c => samePos(startPos, c)) : samePos(startPos, shortcutCoord);
        
        // Enter Shortcut (Roll 1)
        if (roll === 1 && samePos(startPos, pData.shortcutEntry)) {
            if (mode === '6p') {
                let occupied = shortcutCoords.map(c => marbles.find(m => samePos(m.pos, c)) ? c : null).filter(Boolean);
                let empty = shortcutCoords.filter(c => !marbles.some(m => samePos(m.pos, c)));

                if (empty.length === 1) {
                    let dest = empty[0];
                    if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                        moves.push({ dest: dest, type: 'shortcut' });
                    }
                } else if (empty.length === 2) {
                    let dest = shortcutCoord;
                    if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                        moves.push({ dest: dest, type: 'shortcut' });
                    }
                } else if (occupied.length === 2) {
                    shortcutCoords.forEach(dest => {
                        if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                            moves.push({ dest: dest, type: 'shortcut' });
                        }
                    });
                }
            } else {
                let dest = shortcutCoord;
                if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                    moves.push({ dest: dest, type: 'shortcut' });
                }
            }
        }

        // Exit Shortcut (Roll 1)
        if (roll === 1 && isOnShortcut) {
            let dest = pData.shortcutExit;
            if (!hasOwnAt(marbles, playerId, dest) && !isProtectedPos(mode, marbles, dest, playerId)) {
                moves.push({ dest: dest, type: 'exit' });
            }
        }

        // Normal Movement
        if (!isOnShortcut) {
            let advancePath = computeAdvancePath(mode, startPos, roll, pData);
            if (advancePath) {
                let dest = advancePath[advancePath.length - 1];
                let intermediates = advancePath.slice(0, -1);
                
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
        let playerCount = (mode === '2p') ? 2 : (mode === '6p' ? 6 : 4);

        for (let pi = 0; pi < playerCount; pi++) {
            let pData = mapData.processedPlayers[pi];
            let marbleCount = pData.work.length; 
            for (let mi = 0; mi < marbleCount; mi++) {
                marbles.push({ id: marbles.length, player: pData.id, pos: { ...pData.work[mi] } });
            }
        }
        
        let statsObj = {
            murders: {},
            deaths: {},
            noMoveRolls: {},
            hotStreakCurrent: {},
            hotStreakBest: {},
            marbleRolls: {},
            finishedMarbles: {},
            speedrunnerBest: null,
            gameResultsLogged: false,
            startTime: Date.now()
        };
        for(let i=1; i<=playerCount; i++) {
            statsObj.murders[i] = 0;
            statsObj.deaths[i] = 0;
            statsObj.noMoveRolls[i] = 0;
            statsObj.hotStreakCurrent[i] = 0;
            statsObj.hotStreakBest[i] = 0;
        }
        marbles.forEach(m => { statsObj.marbleRolls[m.id] = 0; });

        return {
            mode: mode,
            phase: 'init',
            activePlayer: 1,
            playerColors: assignedColors,
            finishedPlayers: [], 
            currentRoll: 0,
            turnCounter: 0,
            dice: { values: [], pending: [] },
            selectedRoll: null,
            doubleStreak: { playerId: null, value: null, count: 0 },
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
