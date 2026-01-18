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
    document.body.classList.toggle('modal-open', next);
    if (next && M.dom.statsCloseBtn) {
        M.dom.statsCloseBtn.focus();
    }
};

M.setHistoryOpen = function setHistoryOpen(isOpen) {
    if (!M.dom.historyOverlay) return;
    const next = Boolean(isOpen);
    M.uiState.historyOpen = next;
    M.dom.historyOverlay.classList.toggle('is-open', next);
    M.dom.historyOverlay.setAttribute('aria-hidden', String(!next));
    document.body.classList.toggle('modal-open', next);
    if (next && M.dom.historyCloseBtn) {
        M.dom.historyCloseBtn.focus();
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

M.toggleHistory = function toggleHistory() {
    const next = !M.uiState.historyOpen;
    M.setHistoryOpen(next);
    if (next) {
        M.setMainMenuOpen(false);
        if (typeof M.fetchGameHistory === 'function') {
            M.fetchGameHistory();
        }
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
    let isGameOver = M.currentGameState && M.currentGameState.phase === 'gameover';

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

    if (isGameOver) {
        if (stats.speedrunnerBest && stats.speedrunnerBest.rolls > 0) {
            let sPid = stats.speedrunnerBest.playerId;
            let sName = names[sPid] || `P${sPid}`;
            html += `<div class="highlight-stat">Speedrunner: ${sName} (${stats.speedrunnerBest.rolls} rolls)</div>`;
        }

        let maxStreak = -1;
        let maxUnlucky = -1;
        let streakLeaders = [];
        let unluckyLeaders = [];

        for(let i=1; i<=maxP; i++) {
            if(!names[i]) continue;
            let streak = (stats.hotStreakBest && stats.hotStreakBest[i]) || 0;
            let unlucky = (stats.noMoveRolls && stats.noMoveRolls[i]) || 0;

            if (streak > maxStreak) { maxStreak = streak; streakLeaders = [i]; }
            else if (streak === maxStreak && streak > 0) { streakLeaders.push(i); }

            if (unlucky > maxUnlucky) { maxUnlucky = unlucky; unluckyLeaders = [i]; }
            else if (unlucky === maxUnlucky && unlucky > 0) { unluckyLeaders.push(i); }
        }

        if (maxStreak > 0) {
            let leaderNames = streakLeaders.map(id => names[id] || `P${id}`).join(', ');
            html += `<div class="highlight-stat">Hot Streak: ${leaderNames} (${maxStreak})</div>`;
        }
        if (maxUnlucky > 0) {
            let leaderNames = unluckyLeaders.map(id => names[id] || `P${id}`).join(', ');
            html += `<div class="highlight-stat">Unlucky: ${leaderNames} (${maxUnlucky})</div>`;
        }
    }

    if (M.dom.statsBody) {
        M.dom.statsBody.innerHTML = html;
    }
};

M.renderHistory = function renderHistory(results) {
    if (!M.dom.historyBody) return;
    if (!Array.isArray(results) || results.length === 0) {
        M.dom.historyBody.textContent = 'No completed games yet.';
        return;
    }
    let html = '<table class="stats-table"><tr><th>Date</th><th>Time</th><th>Name</th><th>Players</th><th>Place</th></tr>';
    results.forEach((row) => {
        html += `<tr><td>${row.date}</td><td>${row.time}</td><td>${row.name}</td><td>${row.totalPlayers}</td><td>${row.place}</td></tr>`;
    });
    html += '</table>';
    M.dom.historyBody.innerHTML = html;
};

M.fetchGameHistory = async function fetchGameHistory() {
    if (!M.dom.historyBody) return;
    M.dom.historyBody.textContent = 'Loading...';
    try {
        const res = await fetch('/results');
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        M.renderHistory(data.results || []);
    } catch (err) {
        M.dom.historyBody.textContent = 'Unable to load history.';
    }
};

M.allowedEmojiReactions = ['😀', '🤣', '😎', '😡', '😱', '😳', '💩', '🫠', '☠️', '🎻'];

M.sendEmojiReaction = function sendEmojiReaction(emoji) {
    if (!M.socket) return;
    if (!M.allowedEmojiReactions.includes(emoji)) return;
    if (!M.currentGameState || M.currentGameState.phase === 'init') return;
    if (M.myPlayerId === null) return;
    M.socket.emit('emoji', emoji);
};

M.showEmojiReaction = function showEmojiReaction(emoji) {
    if (!M.dom.emojiStream) return;
    if (!M.allowedEmojiReactions.includes(emoji)) return;

    const boardRect = M.dom.container ? M.dom.container.getBoundingClientRect() : null;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const baseX = boardRect ? boardRect.left + boardRect.width * 0.5 : viewportWidth * 0.5;
    const baseY = boardRect ? boardRect.bottom - 10 : viewportHeight * 0.8;
    const jitter = (boardRect ? boardRect.width : viewportWidth) * 0.35;

    let x = baseX + (Math.random() - 0.5) * jitter;
    x = Math.max(16, Math.min(viewportWidth - 16, x));

    const emojiEl = document.createElement('div');
    emojiEl.className = 'emoji-float';
    emojiEl.textContent = emoji;
    emojiEl.style.left = `${x}px`;
    emojiEl.style.top = `${baseY}px`;

    const drift = (Math.random() - 0.5) * 90;
    const rise = 140 + Math.random() * 80;
    const duration = 1600 + Math.random() * 800;

    emojiEl.style.setProperty('--emoji-drift', `${drift}px`);
    emojiEl.style.setProperty('--emoji-rise', `${rise}px`);
    emojiEl.style.setProperty('--emoji-duration', `${duration}ms`);

    M.dom.emojiStream.appendChild(emojiEl);
    emojiEl.addEventListener('animationend', () => emojiEl.remove());
};
})();
