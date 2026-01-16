(() => {
const M = window.Mukdek;

document.body.classList.add('lobby-open');

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

if (M.dom.roomJoinBtn) {
    M.dom.roomJoinBtn.addEventListener('click', () => M.joinRoomFromInput());
}
if (M.dom.roomCreateBtn) {
    M.dom.roomCreateBtn.addEventListener('click', () => M.createRoom());
}
if (M.dom.roomCopyBtn) {
    M.dom.roomCopyBtn.addEventListener('click', () => M.copyRoomLink());
}
if (M.dom.roomsToggle && M.dom.roomsPanel) {
    M.dom.roomsToggle.addEventListener('click', () => {
        const isOpen = M.dom.roomsPanel.classList.contains('active');
        M.setRoomsPanelOpen(!isOpen, { refresh: true });
    });
}
if (M.dom.roomRefreshBtn) {
    M.dom.roomRefreshBtn.addEventListener('click', () => M.refreshRooms());
}
if (M.dom.roomInput) {
    M.dom.roomInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            M.joinRoomFromInput();
        }
    });
}
if (M.dom.roomNameConfirm) {
    M.dom.roomNameConfirm.addEventListener('click', () => M.confirmRoomName());
}
if (M.dom.roomNameCancel) {
    M.dom.roomNameCancel.addEventListener('click', () => M.closeRoomNameModal());
}
if (M.dom.roomNameModal) {
    M.dom.roomNameModal.addEventListener('click', (event) => {
        if (event.target === M.dom.roomNameModal) M.closeRoomNameModal();
    });
}
if (M.dom.roomNameInput) {
    M.dom.roomNameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            M.confirmRoomName();
        }
    });
}
if (M.dom.confirmYes) {
    M.dom.confirmYes.addEventListener('click', () => M.confirmModalYes());
}
if (M.dom.confirmNo) {
    M.dom.confirmNo.addEventListener('click', () => M.closeConfirmModal());
}
if (M.dom.confirmModal) {
    M.dom.confirmModal.addEventListener('click', (event) => {
        if (event.target === M.dom.confirmModal) M.closeConfirmModal();
    });
}
if (M.dom.noticeOk) {
    M.dom.noticeOk.addEventListener('click', () => M.closeNoticeModal());
}
if (M.dom.noticeModal) {
    M.dom.noticeModal.addEventListener('click', (event) => {
        if (event.target === M.dom.noticeModal) M.closeNoticeModal();
    });
}

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

const emojiLayoutQuery = window.matchMedia('(min-aspect-ratio: 1.2/1)');
const syncEmojiSlot = () => {
    if (!M.dom.emojiBar) return;
    const target = emojiLayoutQuery.matches ? M.dom.emojiSlotSidebar : M.dom.emojiSlotBoard;
    if (!target || M.dom.emojiBar.parentElement === target) return;
    target.appendChild(M.dom.emojiBar);
};

syncEmojiSlot();
if (emojiLayoutQuery.addEventListener) {
    emojiLayoutQuery.addEventListener('change', syncEmojiSlot);
} else if (emojiLayoutQuery.addListener) {
    emojiLayoutQuery.addListener(syncEmojiSlot);
}

if (M.dom.emojiBar) {
    M.dom.emojiBar.querySelectorAll('.emoji-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const emoji = btn.getAttribute('data-emoji');
            if (emoji) M.sendEmojiReaction(emoji);
        });
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
    if (M.dom.roomNameModal && M.dom.roomNameModal.classList.contains('active')) {
        M.closeRoomNameModal();
    }
    if (M.dom.confirmModal && M.dom.confirmModal.classList.contains('active')) {
        M.closeConfirmModal();
    }
    if (M.dom.noticeModal && M.dom.noticeModal.classList.contains('active')) {
        M.closeNoticeModal();
    }
    if (M.dom.shortcutTargetModal && M.dom.shortcutTargetModal.classList.contains('active')) {
        M.hideShortcutTargetModal();
    }
});

M.initLobbyUI();
M.refreshRooms();
if (M.dom.roomListBody) {
    M.roomRefreshInterval = setInterval(() => {
        if (!document.hidden) M.refreshRooms();
    }, 15000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) M.refreshRooms();
    });
}
M.initBoard('4p'); // Default render 4p map in background
})();
