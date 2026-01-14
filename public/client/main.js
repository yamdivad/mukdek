(() => {
const M = window.Mukdek;

if (M.socket) {
    M.dom.nameInput.addEventListener('input', (e) => {
        M.socket.emit('setName', e.target.value);
    });
} else {
    const lobbyMsg = document.getElementById('lobby-msg');
    if (lobbyMsg) lobbyMsg.textContent = 'Socket connection unavailable.';
}

const joinBtn = document.getElementById('join-btn');
if (joinBtn) joinBtn.addEventListener('click', () => M.joinGame());

const claimHostBtn = document.getElementById('claim-host-btn');
if (claimHostBtn) claimHostBtn.addEventListener('click', () => M.claimHostManual());

const readyBtn = document.getElementById('ready-btn');
if (readyBtn) readyBtn.addEventListener('click', () => M.clickReady(true));

const startBtn = document.getElementById('start-btn');
if (startBtn) startBtn.addEventListener('click', () => M.requestStart());

const mode2pBtn = document.getElementById('btn-mode-2p');
if (mode2pBtn) mode2pBtn.addEventListener('click', () => M.selectMode('2p'));

const mode4pBtn = document.getElementById('btn-mode-4p');
if (mode4pBtn) mode4pBtn.addEventListener('click', () => M.selectMode('4p'));

const mode6pBtn = document.getElementById('btn-mode-6p');
if (mode6pBtn) mode6pBtn.addEventListener('click', () => M.selectMode('6p'));

if (M.dom.menuBtn) {
    M.dom.menuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        M.toggleMainMenu();
    });
}

if (M.dom.menuStats) {
    M.dom.menuStats.addEventListener('click', () => {
        M.setMainMenuOpen(false);
        M.setStatsOpen(true);
    });
}

if (M.dom.menuLightning) {
    M.dom.menuLightning.addEventListener('click', () => {
        M.setMainMenuOpen(false);
        M.toggleLightning();
    });
}

if (M.dom.menuRestart) {
    M.dom.menuRestart.addEventListener('click', () => {
        M.setMainMenuOpen(false);
        M.triggerReset();
    });
}


if (M.dom.statsOverlay) {
    M.dom.statsOverlay.addEventListener('click', (event) => {
        if (event.target === M.dom.statsOverlay) M.setStatsOpen(false);
    });
}

if (M.dom.statsCloseBtn) {
    M.dom.statsCloseBtn.addEventListener('click', () => {
        M.setStatsOpen(false);
    });
}

if (M.dom.shortcutTargetCancel) {
    M.dom.shortcutTargetCancel.addEventListener('click', () => {
        M.hideShortcutTargetModal();
    });
}

document.addEventListener('click', (event) => {
    if (!M.dom.mainMenu || !M.dom.menuBtn) return;
    if (!M.uiState.mainMenuOpen) return;
    const clickedMenu = M.dom.mainMenu.contains(event.target);
    const clickedButton = M.dom.menuBtn.contains(event.target);
    if (!clickedMenu && !clickedButton) M.setMainMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (M.uiState.statsOpen) M.setStatsOpen(false);
    if (M.uiState.mainMenuOpen) M.setMainMenuOpen(false);
    if (M.dom.shortcutTargetModal && M.dom.shortcutTargetModal.classList.contains('active')) {
        M.hideShortcutTargetModal();
    }
});

M.initLobbyUI();
M.initBoard('4p'); // Default render 4p map in background
})();
