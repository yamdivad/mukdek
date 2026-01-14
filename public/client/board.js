(() => {
const M = window.Mukdek;

M.getPosStyle = function getPosStyle(col, row) {
    let mapData = gameLogic.MAPS[M.currentGameMode || '4p'];
    let cols = mapData ? mapData.gridCols : 17;
    let rows = mapData ? mapData.gridRows : 17;

    let cellPctX = 100/cols;
    let cellPctY = 100/rows;

    let centerX = (col * cellPctX) + (cellPctX/2);
    let centerY = (row * cellPctY) + (cellPctY/2);

    return {
        left: `calc(${centerX}% - 2.25%)`,
        top: `calc(${centerY}% - 2.25%)`
    };
};

M.showGhost = function showGhost(mid) {
    let movesPair = M.currentGameState.possibleMoves.find(pm => pm[0] === mid);
    if (!movesPair) return;

    let moves = movesPair[1];
    moves.forEach(move => {
        let ghost = document.createElement('div');
        ghost.className = `ghost-marble ghost-${mid}`;
        let posStyle = M.getPosStyle(move.dest.col, move.dest.row);
        ghost.style.left = posStyle.left;
        ghost.style.top = posStyle.top;

        let pColor = M.gameColors[M.myPlayerId] || '#999';
        ghost.style.backgroundColor = pColor;

        M.dom.container.appendChild(ghost);
    });
};

M.hideGhost = function hideGhost(mid) {
    let ghosts = document.querySelectorAll(`.ghost-${mid}`);
    ghosts.forEach(g => g.remove());
};

M.clearAllGhosts = function clearAllGhosts() {
    let ghosts = document.querySelectorAll('.ghost-marble');
    ghosts.forEach(g => g.remove());
};

M.initBoard = function initBoard(mode) {
    M.dom.board.innerHTML = '';
    let mapData = gameLogic.MAPS[mode || '4p'];

    let cols = mapData.gridCols;
    let rows = mapData.gridRows;

    M.dom.container.style.setProperty('--grid-cols', cols);
    M.dom.container.style.setProperty('--grid-rows', rows);

    let targetRatio = cols / rows;
    let baseSize = 'var(--board-size)';

    if (cols >= rows) {
        M.dom.container.style.width = baseSize;
        M.dom.container.style.height = `calc(${baseSize} / ${targetRatio})`;
    } else {
        M.dom.container.style.height = baseSize;
        M.dom.container.style.width = `calc(${baseSize} * ${targetRatio})`;
    }

    M.dom.board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    M.dom.board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    const trackSet = new Set(mapData.trackStr);
    let shortcuts = new Set();
    if (mapData.shortcutStr && mode !== '6p') shortcuts.add(mapData.shortcutStr);
    mapData.players.forEach(p => {
        if (p.targetShortcutStr) shortcuts.add(p.targetShortcutStr);
    });

    let workSets = [], homeSets = [];
    mapData.players.forEach(p => {
        workSets[p.id] = new Set(p.workStr);
        homeSets[p.id] = new Set(p.homeStr);
    });

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = document.createElement('div');
            cell.className = 'cell';
            let key = gameLogic.colMap[c] + (r + 1);

            if (trackSet.has(key)) cell.classList.add('track');
            if (shortcuts.has(key)) cell.classList.add('shortcut');

            mapData.players.forEach(p => {
                if (workSets[p.id].has(key)) {
                    cell.classList.add('work');
                }
                else if (homeSets[p.id].has(key)) cell.classList.add('home');
            });

            M.dom.board.appendChild(cell);
        }
    }
};

M.handleMarbleClick = function handleMarbleClick(mid) {
    M.clearAllGhosts();

    let movesPair = M.currentGameState.possibleMoves.find(pm => pm[0] === mid);
    if (!movesPair) return;
    let moves = movesPair[1];
    let shortcutMoves = moves.filter(m => m.type === 'shortcut');
    let otherMoves = moves.filter(m => m.type !== 'shortcut');

    if (M.currentGameMode === '6p' && shortcutMoves.length > 1 && otherMoves.length === 0) {
        M.pendingShortcutMarbleId = mid;
        M.pendingShortcutMoves = shortcutMoves;
        M.showShortcutTargetModal();
        return;
    }

    if (shortcutMoves.length > 0 && moves.length > 1) {
        M.pendingShortcutMarbleId = mid;
        M.pendingShortcutMoves = shortcutMoves;
        let rotation = 0;
        if (M.currentGameMode === '4p') {
            if (M.myPlayerId === 1) rotation = 180;
            else if (M.myPlayerId === 2) rotation = 90;
            else if (M.myPlayerId === 4) rotation = 270;
        }
        M.dom.shortcutModal.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg) scale(1)`;
        M.dom.shortcutModal.classList.add('active');
    } else {
        let type = moves.length === 1 ? moves[0].type : 'normal';
        M.socket.emit('makeMove', { marbleId: mid, moveType: type });
    }
};

M.showShortcutTargetModal = function showShortcutTargetModal() {
    if (!M.dom.shortcutTargetModal || !M.dom.shortcutTargetOptions) return;
    if (!M.pendingShortcutMoves || M.pendingShortcutMoves.length === 0) return;

    M.dom.shortcutTargetOptions.innerHTML = '';
    M.pendingShortcutMoves.forEach(move => {
        let victim = M.currentGameState.marbles.find(m => gameLogic.samePos(m.pos, move.dest));
        let pid = victim ? victim.player : null;
        let name = pid ? (M.currentGameState.playerNames[pid] || `P${pid}`) : 'EMPTY';
        let btn = document.createElement('button');
        btn.className = 'modal-btn btn-yes';
        btn.textContent = pid ? `TAKE ${name}` : 'MOVE HERE';
        if (pid && M.gameColors[pid]) {
            btn.style.background = M.gameColors[pid];
            btn.style.color = M.getContrastColor(M.gameColors[pid]);
        }
        btn.addEventListener('click', () => {
            if (M.pendingShortcutMarbleId !== null) {
                let destKey = gameLogic.coordToKey(move.dest);
                M.socket.emit('makeMove', { marbleId: M.pendingShortcutMarbleId, moveType: 'shortcut', moveDestKey: destKey });
            }
            M.hideShortcutTargetModal();
        });
        M.dom.shortcutTargetOptions.appendChild(btn);
    });

    let rotation = 0;
    if (M.currentGameMode === '4p') {
        if (M.myPlayerId === 1) rotation = 180;
        else if (M.myPlayerId === 2) rotation = 90;
        else if (M.myPlayerId === 4) rotation = 270;
    }
    M.dom.shortcutTargetModal.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg) scale(1)`;
    M.dom.shortcutTargetModal.classList.add('active');
};

M.hideShortcutTargetModal = function hideShortcutTargetModal() {
    if (!M.dom.shortcutTargetModal) return;
    M.dom.shortcutTargetModal.classList.remove('active');
    setTimeout(() => {
        let rotation = 0;
        if (M.currentGameMode === '4p') {
            if (M.myPlayerId === 1) rotation = 180;
            else if (M.myPlayerId === 2) rotation = 90;
            else if (M.myPlayerId === 4) rotation = 270;
        }
        M.dom.shortcutTargetModal.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg) scale(0)`;
    }, 300);
    M.pendingShortcutMarbleId = null;
    M.pendingShortcutMoves = null;
};

M.confirmShortcut = function confirmShortcut(takeIt) {
    M.dom.shortcutModal.classList.remove('active');
    setTimeout(() => {
        let rotation = 0;
        if (M.currentGameMode === '4p') {
             if (M.myPlayerId === 1) rotation = 180;
             else if (M.myPlayerId === 2) rotation = 90;
             else if (M.myPlayerId === 4) rotation = 270;
        }
        M.dom.shortcutModal.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg) scale(0)`;
    }, 300);

    if (M.pendingShortcutMarbleId !== null) {
        if (takeIt) {
            if (M.pendingShortcutMoves && M.pendingShortcutMoves.length > 1) {
                M.showShortcutTargetModal();
                return;
            }
            M.socket.emit('makeMove', { marbleId: M.pendingShortcutMarbleId, moveType: 'shortcut' });
        } else {
            M.socket.emit('makeMove', { marbleId: M.pendingShortcutMarbleId, moveType: 'normal' });
        }
        M.pendingShortcutMarbleId = null;
        M.pendingShortcutMoves = null;
    }
};
})();
