(() => {
const M = window.Mukdek;

document.body.classList.add('lobby-open');
if (typeof M.setMainMenuOpen === 'function') {
    M.setMainMenuOpen(false);
}

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
if (M.dom.installToggle && M.dom.installPanel) {
    M.dom.installToggle.addEventListener('click', () => {
        const isOpen = M.dom.installPanel.classList.contains('active');
        M.setInstallPanelOpen(!isOpen);
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

const tutorialSteps = [
    {
        title: 'Play Over Time',
        text: 'Mukdek is designed for quick turns throughout the day. Come back anytime.'
    },
    {
        title: 'Join a Room',
        text: 'Use Play Now or Rooms to join friends and share the room link.'
    },
    {
        title: 'Ready & Alerts',
        text: 'Tap Ready when you are set, and enable Turn Alerts in the menu.'
    }
];

let tutorialIndex = 0;
const setTutorialStep = (index) => {
    if (!M.dom.tutorialOverlay) return;
    tutorialIndex = Math.max(0, Math.min(tutorialSteps.length - 1, index));
    const step = tutorialSteps[tutorialIndex];
    if (M.dom.tutorialTitle) M.dom.tutorialTitle.textContent = step.title;
    if (M.dom.tutorialText) M.dom.tutorialText.textContent = step.text;
    if (M.dom.tutorialStepNumber) M.dom.tutorialStepNumber.textContent = String(tutorialIndex + 1);
    if (M.dom.tutorialBack) M.dom.tutorialBack.style.visibility = tutorialIndex === 0 ? 'hidden' : 'visible';
    if (M.dom.tutorialNext) {
        M.dom.tutorialNext.textContent = tutorialIndex === tutorialSteps.length - 1 ? 'DONE' : 'NEXT';
    }
};

const closeTutorial = () => {
    if (M.dom.tutorialOverlay) {
        M.dom.tutorialOverlay.classList.remove('is-active');
        M.dom.tutorialOverlay.setAttribute('aria-hidden', 'true');
    }
    try {
        localStorage.setItem('mukdek_tutorial_done', '1');
    } catch (err) {
        // Ignore storage failures.
    }
};

const maybeShowTutorial = () => {
    if (!M.dom.tutorialOverlay) return;
    if (document.body.classList.contains('lobby-open') === false) return;
    try {
        if (localStorage.getItem('mukdek_tutorial_done') === '1') return;
    } catch (err) {
        // Ignore storage failures.
    }
    setTutorialStep(0);
    M.dom.tutorialOverlay.classList.add('is-active');
    M.dom.tutorialOverlay.setAttribute('aria-hidden', 'false');
};

if (M.dom.tutorialBack) {
    M.dom.tutorialBack.addEventListener('click', () => setTutorialStep(tutorialIndex - 1));
}
if (M.dom.tutorialNext) {
    M.dom.tutorialNext.addEventListener('click', () => {
        if (tutorialIndex >= tutorialSteps.length - 1) {
            closeTutorial();
        } else {
            setTutorialStep(tutorialIndex + 1);
        }
    });
}
if (M.dom.tutorialSkip) {
    M.dom.tutorialSkip.addEventListener('click', closeTutorial);
}
if (M.dom.tutorialOverlay) {
    M.dom.tutorialOverlay.addEventListener('click', (event) => {
        if (event.target === M.dom.tutorialOverlay) closeTutorial();
    });
}

const claimHostBtn = document.getElementById('claim-host-btn');
if (claimHostBtn) claimHostBtn.addEventListener('click', () => M.claimHostManual());

const readyBtn = document.getElementById('ready-btn');
if (readyBtn) readyBtn.addEventListener('click', () => M.clickReady(true));

const startBtn = document.getElementById('start-btn');
if (startBtn) startBtn.addEventListener('click', () => M.requestStart());

const lobbyHistoryBtn = document.getElementById('lobby-history-btn');
if (lobbyHistoryBtn) {
    lobbyHistoryBtn.addEventListener('click', () => {
        if (typeof M.setHistoryOpen === 'function') {
            M.setHistoryOpen(true);
        }
        if (typeof M.fetchGameHistory === 'function') {
            M.fetchGameHistory();
        }
    });
}

if (M.dom.historyToggle && M.dom.historyPanel) {
    M.dom.historyToggle.addEventListener('click', () => {
        const isOpen = M.dom.historyPanel.classList.contains('active');
        const next = !isOpen;
        M.dom.historyPanel.classList.toggle('active', next);
        M.dom.historyToggle.classList.toggle('is-open', next);
        M.dom.historyToggle.setAttribute('aria-expanded', String(next));
        M.dom.historyPanel.setAttribute('aria-hidden', String(!next));
    });
}

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

if (M.dom.menuHistory) {
    M.dom.menuHistory.addEventListener('click', () => {
        M.setMainMenuOpen(false);
        M.toggleHistory();
    });
}

if (M.dom.menuLightning) {
    M.dom.menuLightning.addEventListener('click', () => {
        M.setMainMenuOpen(false);
        M.toggleLightning();
    });
}

const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

const updateNotificationMenuLabel = async () => {
    if (!M.dom.menuNotifications) return;
    if (!('Notification' in window)) {
        M.dom.menuNotifications.textContent = 'NOTIFICATIONS UNAVAILABLE';
        M.dom.menuNotifications.disabled = true;
        return;
    }
    if (Notification.permission === 'denied') {
        M.dom.menuNotifications.textContent = 'NOTIFICATIONS BLOCKED';
        M.dom.menuNotifications.disabled = true;
        return;
    }
    let enabled = false;
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = reg ? await reg.pushManager.getSubscription() : null;
            enabled = !!sub;
            M.pushSubscription = sub;
            M.pushEnabled = enabled;
        } catch (err) {
            enabled = false;
        }
    }
    M.dom.menuNotifications.textContent = enabled ? 'DISABLE TURN ALERTS' : 'ENABLE TURN ALERTS';
    M.dom.menuNotifications.disabled = false;
};

const updateNotificationBanner = async () => {
    if (!M.dom.turnAlertBanner) return;
    if (document.body.classList.contains('lobby-open')) {
        M.dom.turnAlertBanner.classList.remove('is-visible');
        return;
    }
    let dismissed = false;
    try {
        dismissed = localStorage.getItem('mukdek_turn_alert_dismissed') === '1';
    } catch (err) {
        dismissed = false;
    }
    if (dismissed) {
        M.dom.turnAlertBanner.classList.remove('is-visible');
        return;
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        M.dom.turnAlertBanner.classList.remove('is-visible');
        return;
    }
    await updateNotificationMenuLabel();
    if (M.pushEnabled) {
        M.dom.turnAlertBanner.classList.remove('is-visible');
        return;
    }
    M.dom.turnAlertBanner.classList.add('is-visible');
};

M.updateNotificationBanner = updateNotificationBanner;

const subscribeToNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || !M.socket) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const reg = await navigator.serviceWorker.register('/sw.js');
    const keyRes = await fetch('/push/vapid-public-key');
    if (!keyRes.ok) return;
    const keyData = await keyRes.json();
    const publicKey = keyData.publicKey;
    if (!publicKey) return;

    const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roomId: M.roomId,
            sessionId: M.mySessionId,
            subscription
        })
    });

    M.pushSubscription = subscription;
    M.pushEnabled = true;
    await updateNotificationMenuLabel();
    await updateNotificationBanner();
};

const unsubscribeFromNotifications = async () => {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
        await sub.unsubscribe();
    }
    await fetch('/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roomId: M.roomId,
            sessionId: M.mySessionId
        })
    });
    M.pushSubscription = null;
    M.pushEnabled = false;
    await updateNotificationMenuLabel();
    await updateNotificationBanner();
};

if (M.dom.menuNotifications) {
    M.dom.menuNotifications.addEventListener('click', async () => {
        M.setMainMenuOpen(false);
        await updateNotificationMenuLabel();
        if (M.pushEnabled) {
            await unsubscribeFromNotifications();
        } else {
            await subscribeToNotifications();
        }
    });
    updateNotificationMenuLabel();
    updateNotificationBanner();
}

if (M.dom.turnAlertDismiss) {
    M.dom.turnAlertDismiss.addEventListener('click', () => {
        try {
            localStorage.setItem('mukdek_turn_alert_dismissed', '1');
        } catch (err) {
            // Ignore storage failures.
        }
        if (M.dom.turnAlertBanner) {
            M.dom.turnAlertBanner.classList.remove('is-visible');
        }
    });
}

if (M.dom.menuRestart) {
    M.dom.menuRestart.addEventListener('click', () => {
        M.setMainMenuOpen(false);
        M.triggerReset();
    });
}

const diceEl = document.getElementById('dice');
if (diceEl) {
    diceEl.addEventListener('click', (event) => {
        if (!M.socket) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.classList.contains('die-btn')) {
            if (target.classList.contains('is-used')) return;
            const slot = target.getAttribute('data-slot');
            if (slot !== null) M.socket.emit('selectRoll', { type: 'die', slot: Number(slot) });
        } else if (target.classList.contains('sum-btn')) {
            M.socket.emit('selectRoll', { type: 'sum' });
        }
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

if (M.dom.historyOverlay) {
    M.dom.historyOverlay.addEventListener('click', (event) => {
        if (event.target === M.dom.historyOverlay) M.setHistoryOpen(false);
    });
}

if (M.dom.historyCloseBtn) {
    M.dom.historyCloseBtn.addEventListener('click', () => {
        M.setHistoryOpen(false);
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
    if (M.uiState.historyOpen) M.setHistoryOpen(false);
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

const requestStateRefresh = () => {
    if (!M.socket) return;
    if (M.socket.connected) {
        M.socket.emit('requestState');
    } else if (typeof M.socket.connect === 'function') {
        M.socket.connect();
    }
};

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestStateRefresh();
});
window.addEventListener('focus', requestStateRefresh);
window.addEventListener('focus', updateNotificationBanner);

M.initLobbyUI();
M.refreshRooms();
maybeShowTutorial();
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
