const Mukdek = window.Mukdek = window.Mukdek || {};
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
const spectateParam = urlParams.get('spectate');
Mukdek.roomId = (roomParam || 'lobby').trim();
if (!Mukdek.roomId) Mukdek.roomId = 'lobby';
Mukdek.isSpectating = spectateParam === '1';
Mukdek.isExplicitRoom = roomParam !== null;
Mukdek.allRoomsInProgress = false;

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
        setTimeout(() => {
            if (typeof Mukdek.refreshRooms === 'function') {
                Mukdek.refreshRooms();
            }
        }, 500);
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
    statsCloseBtn: document.getElementById('stats-close-btn'),
    roomInput: document.getElementById('room-input'),
    roomJoinBtn: document.getElementById('room-join-btn'),
    roomCreateBtn: document.getElementById('room-create-btn'),
    roomCopyBtn: document.getElementById('room-copy-btn'),
    roomRefreshBtn: document.getElementById('room-refresh-btn'),
    roomListBody: document.getElementById('room-list-body'),
    roomRefreshHint: document.getElementById('room-refresh-hint'),
    roomNameModal: document.getElementById('room-name-modal'),
    roomNameInput: document.getElementById('room-name-input'),
    roomNameConfirm: document.getElementById('room-name-confirm'),
    roomNameCancel: document.getElementById('room-name-cancel'),
    confirmModal: document.getElementById('confirm-modal'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmYes: document.getElementById('confirm-yes'),
    confirmNo: document.getElementById('confirm-no'),
    noticeModal: document.getElementById('notice-modal'),
    noticeTitle: document.getElementById('notice-title'),
    noticeMessage: document.getElementById('notice-message'),
    noticeOk: document.getElementById('notice-ok'),
    roomsToggle: document.getElementById('rooms-toggle'),
    roomsPanel: document.getElementById('rooms-panel')
};

Mukdek.pendingShortcutMarbleId = null;
Mukdek.pendingShortcutMoves = null;
Mukdek.isFirstStatusLoad = true;
Mukdek.pendingRoomSuggestion = null;
Mukdek.pendingConfirmAction = null;

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

Mukdek.cleanRoomId = function cleanRoomId(value) {
    if (!value) return '';
    const cleaned = String(value).trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    return cleaned;
};

Mukdek.joinRoomFromInput = function joinRoomFromInput() {
    const raw = Mukdek.dom.roomInput ? Mukdek.dom.roomInput.value : '';
    const cleaned = Mukdek.cleanRoomId(raw);
    if (!cleaned) return;
    window.location.href = `/?room=${encodeURIComponent(cleaned)}`;
};

Mukdek.createRoom = function createRoom() {
    Mukdek.openRoomNameModal();
};

Mukdek.copyRoomLink = function copyRoomLink() {
    const roomId = Mukdek.roomId || 'lobby';
    const link = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).catch(() => {
            window.prompt('Copy room link:', link);
        });
    } else {
        window.prompt('Copy room link:', link);
    }
};

Mukdek.renderRoomList = function renderRoomList(rooms) {
    if (!Mukdek.dom.roomListBody) return;
    if (!rooms || rooms.length === 0) {
        Mukdek.dom.roomListBody.textContent = 'No active rooms yet.';
        return;
    }
    Mukdek.dom.roomListBody.innerHTML = '';
    rooms.forEach((room) => {
        const item = document.createElement('div');
        item.className = 'room-list-item';

        const label = document.createElement('span');
        const status = room.hasGame ? 'in-game' : 'lobby';
        label.textContent = `${room.roomId} • ${room.seatedCount} players • ${status}`;

        const joinBtn = document.createElement('button');
        joinBtn.textContent = room.hasGame ? 'SPECTATE' : 'JOIN';
        joinBtn.addEventListener('click', () => {
            const spectate = room.hasGame ? '&spectate=1' : '';
            window.location.href = `/?room=${encodeURIComponent(room.roomId)}${spectate}`;
        });

        item.appendChild(label);
        item.appendChild(joinBtn);
        Mukdek.dom.roomListBody.appendChild(item);
    });
};

Mukdek.refreshRooms = function refreshRooms() {
    if (!Mukdek.dom.roomListBody) return;
    Mukdek.dom.roomListBody.textContent = 'Loading...';
    fetch('/rooms')
        .then((res) => res.json())
        .then((data) => {
            const rooms = Array.isArray(data.rooms) ? data.rooms : [];
            Mukdek.renderRoomList(rooms);
            Mukdek.updateRoomRefreshHint();
            Mukdek.allRoomsInProgress = rooms.length > 0 && rooms.every((room) => room.hasGame);
            Mukdek.updateJoinButtonForRooms();
            if (Mukdek.allRoomsInProgress || (Mukdek.roomsHasLobby && Mukdek.roomsHasGame)) {
                Mukdek.setRoomsPanelOpen(true, { refresh: false });
            }
        })
        .catch(() => {
            Mukdek.dom.roomListBody.textContent = 'Unable to load rooms.';
            Mukdek.updateRoomRefreshHint(true);
        });
};

if (Mukdek.dom.roomInput) {
    Mukdek.dom.roomInput.value = Mukdek.roomId;
}

Mukdek.updateRoomRefreshHint = function updateRoomRefreshHint(isError = false) {
    if (!Mukdek.dom.roomRefreshHint) return;
    if (isError) {
        Mukdek.dom.roomRefreshHint.textContent = 'Update failed. Retrying soon...';
        return;
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    Mukdek.dom.roomRefreshHint.textContent = `Updated at ${hh}:${mm}:${ss}`;
};

Mukdek.setRoomsPanelOpen = function setRoomsPanelOpen(isOpen, options = {}) {
    if (!Mukdek.dom.roomsPanel || !Mukdek.dom.roomsToggle) return;
    const next = Boolean(isOpen);
    Mukdek.dom.roomsPanel.classList.toggle('active', next);
    Mukdek.dom.roomsToggle.classList.toggle('is-open', next);
    Mukdek.dom.roomsToggle.setAttribute('aria-expanded', String(next));
    Mukdek.dom.roomsPanel.setAttribute('aria-hidden', String(!next));
    const shouldRefresh = options.refresh !== false;
    if (next && shouldRefresh) Mukdek.refreshRooms();
};

Mukdek.updateJoinButtonForRooms = function updateJoinButtonForRooms() {
    if (!Mukdek.dom.lobbyJoinUI || !Mukdek.dom.lobbyJoinUI.style) return;
    const joinBtn = document.getElementById('join-btn');
    if (!joinBtn) return;
    if (Mukdek.myPlayerId === null && Mukdek.allRoomsInProgress) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'NEW GAME';
        return;
    }
    if (joinBtn.textContent === 'NEW GAME') {
        joinBtn.textContent = 'JOIN GAME';
    }
};

Mukdek.openRoomNameModal = function openRoomNameModal() {
    if (!Mukdek.dom.roomNameModal || !Mukdek.dom.roomNameInput) return;
    Mukdek.pendingRoomSuggestion = `${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-2)}`;
    Mukdek.dom.roomNameInput.value = Mukdek.pendingRoomSuggestion;
    Mukdek.dom.roomNameModal.classList.add('active');
    Mukdek.dom.roomNameModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => Mukdek.dom.roomNameInput.focus(), 0);
};

Mukdek.closeRoomNameModal = function closeRoomNameModal() {
    if (!Mukdek.dom.roomNameModal) return;
    Mukdek.dom.roomNameModal.classList.remove('active');
    Mukdek.dom.roomNameModal.setAttribute('aria-hidden', 'true');
    Mukdek.pendingRoomSuggestion = null;
};

Mukdek.confirmRoomName = function confirmRoomName() {
    if (!Mukdek.dom.roomNameInput) return;
    const input = Mukdek.dom.roomNameInput.value;
    let roomId = Mukdek.cleanRoomId(input);
    if (!roomId) {
        roomId = Mukdek.cleanRoomId(Mukdek.pendingRoomSuggestion || 'room');
    }
    Mukdek.closeRoomNameModal();
    window.location.href = `/?room=${encodeURIComponent(roomId)}`;
};

Mukdek.openConfirmModal = function openConfirmModal(options) {
    if (!Mukdek.dom.confirmModal) return;
    const title = options && options.title ? options.title : 'Confirm';
    const message = options && options.message ? options.message : 'Are you sure?';
    const confirmText = options && options.confirmText ? options.confirmText : 'YES';
    const cancelText = options && options.cancelText ? options.cancelText : 'NO';

    if (Mukdek.dom.confirmTitle) Mukdek.dom.confirmTitle.textContent = title;
    if (Mukdek.dom.confirmMessage) Mukdek.dom.confirmMessage.textContent = message;
    if (Mukdek.dom.confirmYes) Mukdek.dom.confirmYes.textContent = confirmText;
    if (Mukdek.dom.confirmNo) Mukdek.dom.confirmNo.textContent = cancelText;

    Mukdek.pendingConfirmAction = options && options.onConfirm ? options.onConfirm : null;
    Mukdek.dom.confirmModal.classList.add('active');
    Mukdek.dom.confirmModal.setAttribute('aria-hidden', 'false');
};

Mukdek.closeConfirmModal = function closeConfirmModal() {
    if (!Mukdek.dom.confirmModal) return;
    Mukdek.dom.confirmModal.classList.remove('active');
    Mukdek.dom.confirmModal.setAttribute('aria-hidden', 'true');
    Mukdek.pendingConfirmAction = null;
};

Mukdek.confirmModalYes = function confirmModalYes() {
    if (typeof Mukdek.pendingConfirmAction === 'function') {
        Mukdek.pendingConfirmAction();
    }
    Mukdek.closeConfirmModal();
};

Mukdek.openNoticeModal = function openNoticeModal(options) {
    if (!Mukdek.dom.noticeModal) return;
    const title = options && options.title ? options.title : 'Notice';
    const message = options && options.message ? options.message : '';

    if (Mukdek.dom.noticeTitle) Mukdek.dom.noticeTitle.textContent = title;
    if (Mukdek.dom.noticeMessage) Mukdek.dom.noticeMessage.textContent = message;

    Mukdek.dom.noticeModal.classList.add('active');
    Mukdek.dom.noticeModal.setAttribute('aria-hidden', 'false');
};

Mukdek.closeNoticeModal = function closeNoticeModal() {
    if (!Mukdek.dom.noticeModal) return;
    Mukdek.dom.noticeModal.classList.remove('active');
    Mukdek.dom.noticeModal.setAttribute('aria-hidden', 'true');
};
