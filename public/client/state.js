const Mukdek = window.Mukdek = window.Mukdek || {};
const roomParam = new URLSearchParams(window.location.search).get('room');
Mukdek.roomId = (roomParam || 'lobby').trim();
if (!Mukdek.roomId) Mukdek.roomId = 'lobby';

if (typeof io === 'function') {
    Mukdek.socket = io({ query: { roomId: Mukdek.roomId } });
} else {
    Mukdek.socket = null;
    console.error('Socket.IO client not available.');
}
Mukdek.myPlayerId = null;
Mukdek.myColor = null;
Mukdek.currentGameState = null;
Mukdek.lastLeaderId = null;

Mukdek.lastActivePlayer = null;
Mukdek.turnAudio = document.getElementById('turn-audio');
Mukdek.turnSoundTimeout = null;
Mukdek.isLightningMode = false;
Mukdek.celebratedPlayers = new Set();
Mukdek.isFirstRender = true;
Mukdek.currentGameMode = '4p';
Mukdek.uiState = { statsOpen: false, mainMenuOpen: false };

Mukdek.faviconLink = document.getElementById("dynamic-favicon");
Mukdek.originalFavicon = "favicon.svg";
Mukdek.goFavicon = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 512 512%22><rect width=%22512%22 height=%22512%22 rx=%22100%22 fill=%22%232ecc71%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-family=%22sans-serif%22 font-weight=%22900%22 font-size=%22300%22 fill=%22white%22>GO</text></svg>";

document.body.addEventListener('click', () => {
    Mukdek.turnAudio.play().then(() => {
        Mukdek.turnAudio.pause();
        Mukdek.turnAudio.currentTime = 0;
    }).catch(() => {});
}, { once: true });

function getSessionId() {
    try {
        let sid = localStorage.getItem('mukdek_session');
        if (!sid) {
            sid = 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
            localStorage.setItem('mukdek_session', sid);
        }
        return sid;
    } catch (err) {
        return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }
}
Mukdek.mySessionId = getSessionId();

if (Mukdek.socket) {
    Mukdek.socket.on('connect', () => {
        console.log("Connected with session:", Mukdek.mySessionId);
        Mukdek.socket.emit('register', Mukdek.mySessionId);
    });

    Mukdek.socket.on('connect_error', () => {
        const lobbyMsg = document.getElementById('lobby-msg');
        if (lobbyMsg) lobbyMsg.textContent = 'Connection failed. Is the server running?';
    });
}

Mukdek.dom = {
    board: document.getElementById('board'),
    container: document.getElementById('board-container'),
    rollBtn: document.getElementById('roll-btn'),
    lobbyOverlay: document.getElementById('lobby-overlay'),
    lobbyJoinUI: document.getElementById('lobby-ui-join'),
    lobbySelectUI: document.getElementById('lobby-ui-select'),
    colorContainer: document.getElementById('color-container'),
    lobbyPidSpan: document.getElementById('lobby-pid'),
    startBtn: document.getElementById('start-btn'),
    readyBtn: document.getElementById('ready-btn'),
    claimHostBtn: document.getElementById('claim-host-btn'),
    bannerText: document.getElementById('identity-text'),
    banner: document.getElementById('game-header'),
    targetPop: document.getElementById('target-pop'),
    targetName: document.getElementById('target-name'),
    shortcutModal: document.getElementById('shortcut-modal'),
    shortcutTargetModal: document.getElementById('shortcut-target-modal'),
    shortcutTargetOptions: document.getElementById('shortcut-target-options'),
    shortcutTargetCancel: document.getElementById('shortcut-target-cancel'),
    statsBtn: document.getElementById('stats-btn'),
    menuBtn: document.getElementById('menu-btn'),
    mainMenu: document.getElementById('main-menu'),
    menuStats: document.getElementById('menu-stats'),
    menuLightning: document.getElementById('menu-lightning'),
    menuRestart: document.getElementById('menu-restart'),
    nameInput: document.getElementById('name-input'),
    lightningPop: document.getElementById('lightning-pop'),
    statsOverlay: document.getElementById('stats-overlay'),
    statsBody: document.getElementById('stats-body'),
    statsCloseBtn: document.getElementById('stats-close-btn')
};

Mukdek.pendingShortcutMarbleId = null;
Mukdek.pendingShortcutMoves = null;
Mukdek.isFirstStatusLoad = true;

Mukdek.colorPalette = [
    { name: "Red", hex: "#e74c3c" },
    { name: "Pink", hex: "#e91e63" },
    { name: "Dark Green", hex: "#1b5e20" },
    { name: "Light Green", hex: "#2ecc71" },
    { name: "Dark Blue", hex: "#1565c0" },
    { name: "Light Blue", hex: "#3498db" },
    { name: "White", hex: "#ffffff" },
    { name: "Black", hex: "#212121" },
    { name: "Yellow", hex: "#f1c40f" },
    { name: "Orange", hex: "#ff9800" },
    { name: "Purple", hex: "#9c27b0" }
];

Mukdek.gameColors = {};
