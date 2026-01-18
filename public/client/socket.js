(() => {
const M = window.Mukdek;

if (!M.socket) {
    console.error('Socket.IO not initialized; skipping socket handlers.');
    return;
} else {

M.socket.on('gameModeUpdate', (mode) => {
    M.currentGameMode = mode;
    document.body.classList.toggle('mode-6p', mode === '6p');
    if (typeof M.syncBoardOrientation === 'function') {
        M.syncBoardOrientation();
    }
    let btn2 = document.getElementById('btn-mode-2p');
    let btn4 = document.getElementById('btn-mode-4p');
    let btn6 = document.getElementById('btn-mode-6p');

    btn2.style.background = (mode === '2p') ? '#2e7d32' : '#a1887f';
    btn4.style.background = (mode === '4p') ? '#2e7d32' : '#a1887f';
    btn6.style.background = (mode === '6p') ? '#2e7d32' : '#a1887f';

    if (M.myPlayerId !== 1) {
        document.getElementById('mode-selector').style.pointerEvents = 'none';
        document.getElementById('mode-selector').style.opacity = '0.7';
    } else {
        document.getElementById('mode-selector').style.pointerEvents = 'all';
        document.getElementById('mode-selector').style.opacity = '1';
    }

    document.getElementById('p3').style.display = (mode === '2p') ? 'none' : 'block';
    document.getElementById('p4').style.display = (mode === '2p') ? 'none' : 'block';
    document.getElementById('p5').style.display = (mode === '6p') ? 'block' : 'none';
    document.getElementById('p6').style.display = (mode === '6p') ? 'block' : 'none';
});

M.socket.on('lightningStatus', (isOn) => {
    M.isLightningMode = isOn;
    const prevStatus = M.lastLightningStatus;
    M.lastLightningStatus = isOn;

    if (isOn) {
        if (M.dom.menuLightning) {
            M.dom.menuLightning.textContent = "DISABLE LIGHTNING";
        }
    } else {
        if (M.dom.menuLightning) {
            M.dom.menuLightning.textContent = "ENABLE LIGHTNING";
        }
    }
    if (prevStatus === null || prevStatus === isOn) {
        M.isFirstStatusLoad = false;
        return;
    }

    if (isOn) {
        M.dom.lightningPop.innerHTML = "LIGHTNING MODE<br>ACTIVATED!";
        M.dom.lightningPop.style.background = "rgba(255, 179, 0, 0.95)";
        M.dom.lightningPop.style.color = "#3e2723";
        if (M.turnSoundTimeout) clearTimeout(M.turnSoundTimeout);
    } else {
        M.dom.lightningPop.innerHTML = "LIGHTNING MODE<br>DISABLED";
        M.dom.lightningPop.style.background = "rgba(66, 66, 66, 0.95)";
        M.dom.lightningPop.style.color = "#ffffff";
    }

    M.dom.lightningPop.classList.remove('active');
    void M.dom.lightningPop.offsetWidth;
    M.dom.lightningPop.classList.add('active');
    setTimeout(() => { M.dom.lightningPop.classList.remove('active'); }, 2000);
    M.isFirstStatusLoad = false;
});

M.socket.on('emojiReaction', (data) => {
    if (!data || typeof data.emoji !== 'string') return;
    M.showEmojiReaction(data.emoji);
});

M.socket.on('lobbyUpdate', (state) => {
    const isLightColor = (hex) => {
        if (!hex || typeof hex !== 'string') return false;
        const match = hex.trim().match(/^#([0-9a-f]{6})$/i);
        if (!match) return false;
        const value = match[1];
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        return luminance > 200;
    };

    if (M.dom.menuLightning) M.dom.menuLightning.disabled = true;
    if (M.dom.menuRestart) M.dom.menuRestart.disabled = true;
    if (M.myPlayerId === 1) {
        document.getElementById('mode-selector').style.pointerEvents = 'all';
        document.getElementById('mode-selector').style.opacity = '1';

        let btn2 = document.getElementById('btn-mode-2p');
        let btn4 = document.getElementById('btn-mode-4p');
        let btn6 = document.getElementById('btn-mode-6p');

        if (state.seatedCount <= 2) {
            btn2.className = "mode-btn visible";
            btn2.disabled = false;
            btn4.className = "mode-btn visible";
            btn4.disabled = false;
            btn6.className = "mode-btn";

            if (M.currentGameMode === '6p') M.selectMode('4p');
        } else if (state.seatedCount <= 4) {
            btn2.className = "mode-btn";
            btn2.disabled = true;
            btn4.className = "mode-btn visible";
            btn4.disabled = false;
            btn6.className = "mode-btn";

            if (M.currentGameMode === '2p' || M.currentGameMode === '6p') M.selectMode('4p');
        } else {
            btn2.className = "mode-btn";
            btn2.disabled = true;
            btn4.className = "mode-btn";
            btn4.disabled = true;
            btn6.className = "mode-btn visible";
            btn6.disabled = false;

            if (M.currentGameMode !== '6p') M.selectMode('6p');
        }
    }

    for(let i=1; i<=6; i++) {
        let tk = document.getElementById(`tk-${i}`);
        if (!tk) continue;

        let pData = state.players[i];

        tk.className = 'tracker-slot';
        tk.style.backgroundColor = 'transparent';
        tk.innerHTML = '';
        while(tk.firstChild) tk.removeChild(tk.firstChild);

        if (!pData) {
            if (M.myPlayerId === 1) {
                 let botBtn = document.createElement('button');
                 botBtn.className = 'add-bot-btn';
                 botBtn.textContent = "+ BOT";
                 botBtn.onclick = () => M.addBot(i);
                 tk.appendChild(botBtn);
            }
        } else {
            tk.className = 'tracker-slot joined';
            let c = pData.color || '#9e9e9e';
            tk.style.backgroundColor = c;
            if (isLightColor(c)) tk.classList.add('light-bg');

            let statusSymbol = '';
            if (pData.isBot) statusSymbol = '🤖';
            else if (pData.ready) statusSymbol = (i === 1) ? '👑' : '✓';

            let symbolSpan = document.createElement('span');
            symbolSpan.textContent = statusSymbol;
            tk.appendChild(symbolSpan);

            if (pData.ready) tk.classList.add('ready');

            if (M.myPlayerId === 1 && i !== 1) {
                let kickBtn = document.createElement('div');
                kickBtn.className = 'kick-btn';
                kickBtn.textContent = 'X';
                kickBtn.onclick = (e) => {
                    e.stopPropagation();
                    M.kickPlayer(i);
                };
                tk.appendChild(kickBtn);
            }
        }
    }

    let mySlot = Object.entries(state.players).find(([k, v]) => v && v.session === M.mySessionId);

    if (mySlot) {
        M.myPlayerId = parseInt(mySlot[0]);
        M.isSpectating = false;
        let pData = mySlot[1];
        M.myColor = pData.color;
        let isMeReady = pData.ready;

        M.dom.lobbyJoinUI.style.display = 'none';
        M.dom.lobbySelectUI.style.display = 'block';
        M.dom.lobbyPidSpan.textContent = M.myPlayerId;

        if (document.activeElement !== M.dom.nameInput) {
            M.dom.nameInput.value = pData.name.replace(/^P\d$/, '');
        }

        if (isMeReady && M.myPlayerId !== 1) {
            M.dom.nameInput.disabled = true;
            M.dom.readyBtn.style.display = 'block';
            M.dom.readyBtn.textContent = "CHANGE";
            M.dom.readyBtn.style.background = "#757575";
            M.dom.readyBtn.onclick = () => M.clickReady(false);
            document.getElementById('lobby-msg').textContent = "Ready! Waiting for host...";
        } else {
            M.dom.nameInput.disabled = false;
            if (M.myPlayerId !== 1) {
                M.dom.readyBtn.style.display = 'block';
                M.dom.readyBtn.textContent = "I'M READY";
                M.dom.readyBtn.style.background = "#0277bd";
                M.dom.readyBtn.onclick = () => M.clickReady(true);
                document.getElementById('lobby-msg').textContent = "Pick color/initials, then click Ready.";
            }
        }

        M.colorPalette.forEach((c, idx) => {
            let btn = document.getElementById(`col-btn-${idx}`);
            let takenBy = Object.values(state.players).find(p => p && p.color === c.hex);

            if (isMeReady && M.myPlayerId !== 1) {
                btn.disabled = true;
                if (M.myColor === c.hex) btn.classList.add('selected');
                else btn.classList.remove('selected');
                return;
            }

            if (M.myColor === c.hex) {
                btn.classList.add('selected');
                btn.disabled = false;
            } else if (takenBy) {
                btn.classList.remove('selected');
                btn.disabled = true;
            } else {
                btn.classList.remove('selected');
                btn.disabled = false;
            }
        });

        let pName = pData.name || `P${M.myPlayerId}`;
        M.updateIdentity(M.myPlayerId, M.myColor || '#9e9e9e', pName);

    } else {
        M.dom.lobbyJoinUI.style.display = 'block';
        M.dom.lobbySelectUI.style.display = 'none';

        if (state.seatedCount >= 6) {
            document.getElementById('join-btn').disabled = true;
            document.getElementById('join-btn').textContent = "FULL";
        } else {
            document.getElementById('join-btn').disabled = false;
            document.getElementById('join-btn').textContent = "JOIN GAME";
        }
    }

    if (typeof M.updateJoinButtonForRooms === 'function') {
        M.updateJoinButtonForRooms();
    }

    if (M.socket.id === state.hostId) {
        let seated = Object.values(state.players).filter(p => p !== null);
        let allReady = seated.length >= 2 && seated.every(p => p.color !== null);

        M.dom.readyBtn.style.display = 'none';
        M.dom.startBtn.style.display = 'block';
        M.dom.claimHostBtn.style.display = 'none';

        let validMode = true;
        if (M.currentGameMode === '2p' && seated.length !== 2) validMode = false;
        if (M.currentGameMode === '6p' && seated.length < 2) validMode = false;
        if (M.currentGameMode === '4p' && seated.length > 4) validMode = false;

        if (allReady && validMode) {
            M.dom.startBtn.classList.add('ready');
            M.dom.startBtn.disabled = false;
            document.getElementById('lobby-msg').textContent = "You are the Host. Start when everyone is ready.";
        } else {
            M.dom.startBtn.classList.remove('ready');
            M.dom.startBtn.disabled = true;
            if (M.currentGameMode === '2p' && seated.length !== 2) {
                document.getElementById('lobby-msg').textContent = "Duel Mode requires exactly 2 players.";
            } else if (M.currentGameMode === '4p' && seated.length > 4) {
                document.getElementById('lobby-msg').textContent = "Classic Mode supports max 4 players.";
            } else {
                document.getElementById('lobby-msg').textContent = "Waiting for players...";
            }
        }
    } else {
        M.dom.startBtn.style.display = 'none';
        if (M.myPlayerId === 1) {
            M.dom.claimHostBtn.style.display = 'block';
        } else {
            M.dom.claimHostBtn.style.display = 'none';
        }
    }
});

M.socket.on('kicked', () => {
    M.openNoticeModal({
        title: 'Removed',
        message: 'You have been removed from the lobby by the Host.'
    });
    setTimeout(() => {
        location.reload();
    }, 1200);
});

M.socket.on('murder', (data) => {
    let splat = document.createElement('div');
    splat.className = 'splat';
    let victimColor = M.gameColors[data.victimId] || '#b71c1c';
    splat.style.background = `radial-gradient(circle, ${victimColor} 40%, transparent 70%)`;

    let posStyle = M.getCenteredPos(data.pos.col, data.pos.row, '--splat-scale', '0.85');
    splat.style.left = posStyle.left;
    splat.style.top = posStyle.top;
    M.dom.container.appendChild(splat);
    setTimeout(() => { splat.remove(); }, 2000);
});

M.renderState = function renderState(state) {
    M.clearAllGhosts();

    M.currentGameState = state;
    M.gameColors = state.playerColors || {};

    M.renderStats(state.stats, state.playerNames);

    state.finishedPlayers.forEach((pid, index) => {
        if (M.gameColors[pid]) {
            if (!M.celebratedPlayers.has(pid)) {
                M.celebratedPlayers.add(pid);

                if (!M.isFirstRender) {
                    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                    if (index === 0) M.triggerPopup(pid, "", true);
                }
            }
        }
    });
    M.isFirstRender = false;

    if (state.phase === 'play') {
        if (state.activePlayer === M.myPlayerId) {
            if (M.turnSoundTimeout) clearTimeout(M.turnSoundTimeout);

            let duration = (M.lastActivePlayer !== M.myPlayerId) ? 5000 : 15000;

            if (!M.isLightningMode && M.canPlaySounds()) {
                M.turnSoundTimeout = setTimeout(() => {
                    if (!M.canPlaySounds()) return;
                    M.turnAudio.currentTime = 0;
                    M.turnAudio.play().catch(e => console.log("Audio blocked"));
                }, duration);
            }
            M.updateFavicon(true);
        } else {
            if (M.turnSoundTimeout) clearTimeout(M.turnSoundTimeout);
            M.updateFavicon(false);
        }
        M.lastActivePlayer = state.activePlayer;
    }

    if (state.activePlayer !== M.myPlayerId) {
        if (M.turnSoundTimeout) {
            clearTimeout(M.turnSoundTimeout);
            M.turnSoundTimeout = null;
        }
        M.updateFavicon(false);
    }

    const canEnableMenu = (state.phase !== 'gameover');
    const isSpectator = M.myPlayerId === null;
    if (M.dom.menuLightning) M.dom.menuLightning.disabled = !canEnableMenu || isSpectator;
    if (M.dom.menuRestart) M.dom.menuRestart.disabled = !canEnableMenu || isSpectator;

    document.getElementById('message').textContent = state.message;
    const diceChars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const diceEl = document.getElementById('dice');
    if (state.mode === '6p') {
        const diceState = state.dice || { values: [], pending: [] };
        const values = Array.isArray(diceState.values) ? diceState.values : [];
        const pending = new Set(Array.isArray(diceState.pending) ? diceState.pending : []);
        const selected = state.selectedRoll;
        diceEl.innerHTML = '';

        if (values.length === 2) {
            values.forEach((value, slot) => {
                const btn = document.createElement('button');
                btn.className = 'die-btn';
                btn.type = 'button';
                btn.dataset.slot = slot;
                btn.textContent = diceChars[value - 1] || '🎲';
                if (!pending.has(slot)) btn.classList.add('is-used');
                if (selected && selected.type === 'die' && selected.slot === slot) {
                    btn.classList.add('is-selected');
                }
                diceEl.appendChild(btn);
            });
            if (pending.size === 2) {
                const sumVal = (values[0] || 0) + (values[1] || 0);
                const sumBtn = document.createElement('button');
                sumBtn.className = 'sum-btn';
                sumBtn.type = 'button';
                sumBtn.dataset.type = 'sum';
                sumBtn.textContent = `SUM ${sumVal}`;
                if (selected && selected.type === 'sum') sumBtn.classList.add('is-selected');
                diceEl.appendChild(sumBtn);
            }
        } else {
            diceEl.textContent = '🎲';
        }
    } else {
        diceEl.textContent = state.currentRoll > 0 ? diceChars[state.currentRoll - 1] : '🎲';
    }

    let maxP = (M.currentGameMode === '2p') ? 2 : (M.currentGameMode === '6p' ? 6 : 4);
    let needed = (M.currentGameMode === '6p') ? 4 : 5;

    for(let i=1; i<=maxP; i++) {
        let el = document.getElementById(`p${i}`);
        if (!el) continue;

        let pColor = M.gameColors[i];
        let pName = (state.playerNames && state.playerNames[i]) || `P${i}`;

        let isRealPlayer = !!pColor;

        if (!isRealPlayer) {
            el.classList.add('empty-slot');
            el.querySelector('strong').textContent = pName;
            el.style.backgroundColor = 'rgba(255,255,255,0.2)';
            el.style.color = '#5d4037';
            el.style.border = '1px dashed rgba(93, 64, 55, 0.3)';
            el.style.opacity = '0.7';
        } else {
            el.classList.remove('empty-slot');

            let realFinishers = state.finishedPlayers.filter(pid => M.gameColors[pid]);
            let rankIdx = realFinishers.indexOf(i);

            let suffix = '';
            if (rankIdx === 0) suffix = ' 🥇';
            else if (rankIdx === 1) suffix = ' 🥈';
            else if (rankIdx === 2) suffix = ' 🥉';

            el.querySelector('strong').textContent = pName + suffix;

            if (pColor) {
                el.style.backgroundColor = pColor;
                el.style.color = M.getContrastColor(pColor);
                el.style.border = '2px solid rgba(0,0,0,0.2)';
                el.style.opacity = '1';
            }

            if (state.finishedPlayers.includes(i)) {
                el.classList.add('finished');
            } else {
                el.classList.remove('finished');
            }
        }

        if(i === state.activePlayer) el.classList.add('active');
        else el.classList.remove('active');

        let inHome = state.marbles.filter(m => m.player === i && gameLogic.isHomePos(M.currentGameState.mode, i, m.pos)).length;
        document.getElementById(`h${i}`).textContent = inHome;
        el.querySelector('.home-count').innerHTML = `<span id="h${i}">${inHome}</span>/${needed}`;
    }

    M.checkForLeader(state.marbles);
    if (typeof M.maybePlayConstipation === 'function') {
        M.maybePlayConstipation(state);
    }

    const isMyTurn = (state.activePlayer === M.myPlayerId);
    const isGameOver = state.phase === 'gameover';

    const hasPendingDice = state.mode === '6p'
        && state.dice
        && Array.isArray(state.dice.pending)
        && state.dice.pending.length > 0;

    if (isGameOver) {
        M.dom.rollBtn.textContent = "GAME OVER / NEW GAME";
        M.dom.rollBtn.disabled = false;
        M.dom.rollBtn.className = 'btn-base game-over';
        M.dom.rollBtn.onclick = () => {
            if (typeof M.openConfirmModal === 'function') {
                M.openConfirmModal({
                    title: 'New Game',
                    message: 'Start a new game with the same players?',
                    confirmText: 'START',
                    cancelText: 'CANCEL',
                    onConfirm: () => {
                        M.socket.emit('resetGame');
                    }
                });
            } else {
                M.socket.emit('resetGame');
            }
        };
        document.getElementById('dice').classList.remove('rolling');
    } else if (isMyTurn) {
        const canRoll = state.mode === '6p'
            ? (!hasPendingDice || state.phase === 'init')
            : (state.currentRoll === 0 || state.phase === 'init');
        if (canRoll) {
            M.dom.rollBtn.textContent = state.phase === 'init' ? "ROLL FOR ORDER" : "ROLL DICE";
            M.dom.rollBtn.disabled = false;
            M.dom.rollBtn.className = 'btn-base my-turn';
            M.dom.rollBtn.onclick = () => {
                document.getElementById('dice').classList.add('rolling');
                M.socket.emit('rollDice');
            };
        } else {
            M.dom.rollBtn.textContent = "MOVE A MARBLE";
            M.dom.rollBtn.disabled = true;
            M.dom.rollBtn.className = 'btn-base';
            document.getElementById('dice').classList.remove('rolling');
        }
    } else {
        let activeName = (state.playerNames && state.playerNames[state.activePlayer]) || `P${state.activePlayer}`;
        M.dom.rollBtn.textContent = `WAITING FOR ${activeName}`;
        M.dom.rollBtn.disabled = true;
        M.dom.rollBtn.className = 'btn-base';
    }

    let posGroups = {};
    state.marbles.forEach(m => {
        let key = m.pos.col + "_" + m.pos.row;
        if (!posGroups[key]) posGroups[key] = [];
        posGroups[key].push(m);
    });
    let existingMs = document.querySelectorAll('.marble');
    existingMs.forEach(em => {
        let id = parseInt(em.id.split('-')[1]);
        if(!state.marbles.find(m => m.id === id)) em.remove();
    });
    state.marbles.forEach(m => {
        let el = document.getElementById(`m-${m.id}`);
        if (!el) {
            el = document.createElement('div');
            el.id = `m-${m.id}`;
            el.className = `marble`;
            M.dom.container.appendChild(el);
        }
        let mColor = M.gameColors[m.player] || '#999';
        el.style.background = `radial-gradient(circle at 30% 30%, white -20%, ${mColor} 30%, black 140%)`;

        let isMovable = state.movableMarbles.includes(m.id) && m.player === M.myPlayerId;
        if (isMovable) {
            el.classList.add('movable');
            el.onclick = () => M.handleMarbleClick(m.id);

            el.onmouseenter = () => M.showGhost(m.id);
            el.onmouseleave = () => M.hideGhost(m.id);
        } else {
            el.classList.remove('movable');
            el.onclick = null;
            el.onmouseenter = null;
            el.onmouseleave = null;
        }

        let group = posGroups[m.pos.col + "_" + m.pos.row];
        let indexInGroup = group.findIndex(gm => gm.id === m.id);

        let offX = 0, offY = 0;
        if (group.length > 1) {
             offX = (indexInGroup % 2 === 0 ? 1 : -1) * 0.8 * (Math.floor(indexInGroup/2) + 1);
             offY = (indexInGroup % 2 !== 0 ? 1 : -1) * 0.8 * (Math.floor(indexInGroup/2) + 1);
        }
        let posStyle = M.getCenteredPos(m.pos.col, m.pos.row, '--piece-scale', '0.75', offX, offY);
        el.style.left = posStyle.left;
        el.style.top = posStyle.top;
    });
};

M.socket.on('gameStart', (mode) => {
    M.currentGameMode = mode;
    document.body.classList.toggle('mode-6p', mode === '6p');
    document.body.classList.remove('lobby-open');
    if (typeof M.setMainMenuOpen === 'function') {
        M.setMainMenuOpen(false);
    }
    if (M.dom.tutorialOverlay) {
        M.dom.tutorialOverlay.classList.remove('is-active');
        M.dom.tutorialOverlay.setAttribute('aria-hidden', 'true');
    }
    if (typeof M.updateNotificationBanner === 'function') {
        M.updateNotificationBanner();
    }
    if (typeof M.syncBoardOrientation === 'function') {
        M.syncBoardOrientation();
    }
    if (M.myPlayerId !== null || M.isSpectating || M.isExplicitRoom) {
        M.dom.lobbyOverlay.style.display = 'none';
    }
    M.celebratedPlayers.clear();
    if (M.constipationPlayedBy) M.constipationPlayedBy.clear();
    M.initBoard(mode);
});

M.socket.on('gameReset', () => {
     M.dom.lobbyOverlay.style.display = 'flex';
     document.body.classList.add('lobby-open');
     if (typeof M.setMainMenuOpen === 'function') {
         M.setMainMenuOpen(false);
     }
     M.dom.board.innerHTML = '';
     M.initBoard(M.currentGameMode);
     M.celebratedPlayers.clear();
     if (M.constipationPlayedBy) M.constipationPlayedBy.clear();
});

M.socket.on('gameState', M.renderState);
}
})();
