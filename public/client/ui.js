(() => {
const M = window.Mukdek;

M.clickReady = function clickReady(status) {
    M.socket.emit('playerReady', status);
};

M.claimHostManual = function claimHostManual() {
    M.socket.emit('claimHost');
};

M.kickPlayer = function kickPlayer(pid) {
    M.openConfirmModal({
        title: 'Remove Player',
        message: `Remove Player ${pid} from the lobby?`,
        confirmText: 'REMOVE',
        cancelText: 'CANCEL',
        onConfirm: () => {
            M.socket.emit('removeBot', pid - 1);
            M.socket.emit('kickPlayer', pid);
        }
    });
};

M.addBot = function addBot(pid) {
    M.socket.emit('addBot', pid - 1);
};


M.setStatsOpen = function setStatsOpen(isOpen) {
    if (!M.dom.statsOverlay) return;
    const next = Boolean(isOpen);
    M.uiState.statsOpen = next;
    M.dom.statsOverlay.classList.toggle('is-open', next);
    M.dom.statsOverlay.setAttribute('aria-hidden', String(!next));
    if (next && M.dom.statsCloseBtn) {
        M.dom.statsCloseBtn.focus();
    }
};

M.setMainMenuOpen = function setMainMenuOpen(isOpen) {
    if (!M.dom.mainMenu || !M.dom.menuBtn) return;
    const next = Boolean(isOpen);
    M.uiState.mainMenuOpen = next;
    M.dom.mainMenu.classList.toggle('is-open', next);
    M.dom.mainMenu.setAttribute('aria-hidden', String(!next));
    M.dom.menuBtn.setAttribute('aria-expanded', String(next));
};


M.toggleMainMenu = function toggleMainMenu() {
    if (!M.dom.menuBtn) return;
    const next = !M.uiState.mainMenuOpen;
    M.setMainMenuOpen(next);
    if (next) {
        M.setStatsOpen(false);
    }
};

M.toggleStats = function toggleStats() {
    const next = !M.uiState.statsOpen;
    M.setStatsOpen(next);
    if (next) {
        M.setMainMenuOpen(false);
    }
};

M.triggerReset = function triggerReset() {
    M.openConfirmModal({
        title: 'Restart Game',
        message: 'Are you sure you want to restart the game?',
        confirmText: 'RESTART',
        cancelText: 'CANCEL',
        onConfirm: () => {
            M.socket.emit('resetGame');
            M.setMainMenuOpen(false);
        }
    });
};

M.toggleLightning = function toggleLightning() {
    M.socket.emit('toggleLightning');
    M.setMainMenuOpen(false);
};

M.updateFavicon = function updateFavicon(isTurn) {
    if (isTurn) {
        M.faviconLink.href = M.goFavicon;
    } else {
        M.faviconLink.href = M.originalFavicon;
    }
};

M.selectMode = function selectMode(mode) {
    M.socket.emit('setGameMode', mode);
};

M.initLobbyUI = function initLobbyUI() {
    M.dom.colorContainer.innerHTML = '';
    M.colorPalette.forEach((c, idx) => {
        let btn = document.createElement('button');
        btn.className = 'color-btn';
        btn.style.backgroundColor = c.hex;
        btn.title = c.name;
        btn.id = `col-btn-${idx}`;
        btn.onclick = () => M.selectColor(idx);
        M.dom.colorContainer.appendChild(btn);
    });
};

M.joinGame = function joinGame() {
    if (!M.socket) return;
    if (M.allRoomsInProgress) {
        M.createRoom();
        return;
    }
    M.socket.emit('joinGame', M.mySessionId);
};
M.selectColor = function selectColor(index) {
    if (!M.socket) return;
    M.socket.emit('selectColor', M.colorPalette[index].hex);
};
M.requestStart = function requestStart() {
    if (!M.socket) return;
    M.socket.emit('requestStartGame');
};

M.getContrastColor = function getContrastColor(hex) {
    hex = hex.replace('#', '');
    let r = parseInt(hex.substr(0, 2), 16);
    let g = parseInt(hex.substr(2, 2), 16);
    let b = parseInt(hex.substr(4, 2), 16);
    let yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
};

M.updateIdentity = function updateIdentity(pid, colorHex, pName) {
    if(!pid) return;
    M.dom.bannerText.textContent = `MUKDEK: ${pName || 'PLAYER ' + pid}`;
    M.dom.banner.style.backgroundColor = colorHex;
    M.dom.banner.style.color = M.getContrastColor(colorHex);

    M.syncBoardOrientation(pid);
};

M.syncBoardOrientation = function syncBoardOrientation(pid) {
    const activePid = pid || M.myPlayerId;
    let rotation = 0;
    if (M.currentGameMode === '4p' && activePid) {
        switch(activePid) {
            case 1: rotation = 180; break;
            case 2: rotation = 90; break;
            case 3: rotation = 0; break;
            case 4: rotation = 270; break;
        }
    }
    if (M.dom.container) {
        M.dom.container.style.transform = `rotate(${rotation}deg)`;
    }
    if (M.dom.shortcutModal) {
        M.dom.shortcutModal.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg) scale(0)`;
    }
    if (M.dom.shortcutTargetModal && !M.dom.shortcutTargetModal.classList.contains('active')) {
        M.dom.shortcutTargetModal.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg) scale(0)`;
    }
};

M.checkForLeader = function checkForLeader(marbles) {
    let maxP = (M.currentGameMode === '2p') ? 2 : (M.currentGameMode === '6p' ? 6 : 4);
    let counts = new Array(maxP).fill(0);

    marbles.forEach(m => {
        if (gameLogic.isHomePos(M.currentGameState.mode, m.player, m.pos)) {
            if (m.player <= maxP) counts[m.player - 1]++;
        }
    });

    let max = Math.max(...counts);
    if (max === 0) return;

    let leaders = [];
    counts.forEach((c, i) => { if(c === max) leaders.push(i + 1); });

    if (leaders.length === 1) {
        let newLeader = leaders[0];
        if (newLeader !== M.lastLeaderId) {
            M.lastLeaderId = newLeader;
            M.triggerTargetPopup(newLeader);
        }
    } else {
        M.lastLeaderId = null;
    }
};

M.triggerTargetPopup = function triggerTargetPopup(pid) {
    M.triggerPopup(pid, "IS LEADING!");
};

M.triggerPopup = function triggerPopup(pid, suffix, isWinner = false) {
    let pColor = M.gameColors[pid] || '#999';
    let pName = (M.currentGameState.playerNames && M.currentGameState.playerNames[pid]) || `PLAYER ${pid}`;

    if (isWinner) {
        M.dom.targetPop.innerHTML = `<span style="font-size:1.5em; display:block; margin-top:10px;">${pName}</span>WINS!`;
    } else {
        M.dom.targetPop.innerHTML = `TARGET!<br>TARGET!<br>TARGET!<span id="target-name">${pName} ${suffix}</span>`;
    }

    M.dom.targetPop.style.backgroundColor = pColor;
    M.dom.targetPop.style.color = M.getContrastColor(pColor);

    M.dom.targetPop.classList.remove('active');
    void M.dom.targetPop.offsetWidth;
    M.dom.targetPop.classList.add('active');

    setTimeout(() => { M.dom.targetPop.classList.remove('active'); }, 3000);
};

M.renderStats = function renderStats(stats, names) {
    if (!stats) return;
    let html = '<table class="stats-table"><tr><th>Player</th><th>Taken Others</th><th>Been Taken</th></tr>';

    let maxKills = -1; let killer = null;
    let maxDeaths = -1; let victim = null;

    let maxP = (M.currentGameMode === '2p') ? 2 : (M.currentGameMode === '6p' ? 6 : 4);

    for(let i=1; i<=maxP; i++) {
        if(!names[i]) continue;
        let kills = stats.murders[i] || 0;
        let deaths = stats.deaths[i] || 0;

        let suffix = '';
        if (M.currentGameState && M.currentGameState.finishedPlayers) {
            let finishIdx = M.currentGameState.finishedPlayers.indexOf(i);
            if (finishIdx !== -1) {
                if (finishIdx === 0) suffix = ' 🥇';
                else if (finishIdx === 1) suffix = ' 🥈';
                else if (finishIdx === 2) suffix = ' 🥉';
            }
        }

        html += `<tr><td>${names[i]}${suffix}</td><td>${kills}</td><td>${deaths}</td></tr>`;

        if (kills > maxKills) { maxKills = kills; killer = names[i]; }
        if (deaths > maxDeaths) { maxDeaths = deaths; victim = names[i]; }
    }
    html += '</table>';

    if (maxKills > 0) html += `<div class="highlight-stat">Most Ruthless: ${killer} (${maxKills})</div>`;
    if (maxDeaths > 0) html += `<div class="highlight-stat">Most Targeted: ${victim} (${maxDeaths})</div>`;

    if (M.dom.statsBody) {
        M.dom.statsBody.innerHTML = html;
    }
};
})();
