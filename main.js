const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let suppressUnmaximize = false;
let windowedTimer = null;

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 720;

const alive = () => mainWindow && !mainWindow.isDestroyed();

function centerWindow() {
    if (!alive()) return;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const { x, y, width, height } = display.workArea;
    mainWindow.setPosition(
        Math.round(x + (width - WINDOW_WIDTH) / 2),
        Math.round(y + (height - WINDOW_HEIGHT) / 2)
    );
}

// 兜底：强制回到 1280x720 普通窗口（幂等 —— 已处于正确状态则跳过，避免重复设置造成晃动）
function ensureWindowed() {
    if (!alive()) return;
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    if (mainWindow.isMaximized()) {
        suppressUnmaximize = true;
        mainWindow.unmaximize();
    }
    const [w, h] = mainWindow.getSize();
    if (w !== WINDOW_WIDTH || h !== WINDOW_HEIGHT) {
        mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT, false);
    }
    const b = mainWindow.getBounds();
    const display = screen.getDisplayMatching(b);
    const tx = Math.round(display.workArea.x + (display.workArea.width - WINDOW_WIDTH) / 2);
    const ty = Math.round(display.workArea.y + (display.workArea.height - WINDOW_HEIGHT) / 2);
    if (Math.round(b.x) !== tx || Math.round(b.y) !== ty) {
        mainWindow.setPosition(tx, ty);
    }
}

// 合并调度：退出全屏只执行一次兜底（多事件源共用定时器，消抖防画面跳变）
function scheduleWindowed() {
    if (windowedTimer) { clearTimeout(windowedTimer); windowedTimer = null; }
    windowedTimer = setTimeout(() => {
        windowedTimer = null;
        ensureWindowed();
    }, 60);
}

function enterFullscreen() {
    if (!alive() || mainWindow.isFullScreen()) return;
    if (mainWindow.isMaximized()) {
        suppressUnmaximize = true;
        mainWindow.unmaximize();
    }
    mainWindow.setFullScreen(true);
}

function exitFullscreen() {
    if (!alive()) return;
    if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
    }
    scheduleWindowed();
}

function toggleFullscreen() {
    if (!alive()) return;
    if (mainWindow.isFullScreen()) {
        exitFullscreen();
    } else {
        enterFullscreen();
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        center: true,
        show: false,
        useContentSize: true,
        autoHideMenuBar: true,
        resizable: true,
        maximizable: true,
        fullscreenable: true,
        backgroundColor: '#000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.show();
    centerWindow();

    // 最大化按钮 -> 先解除最大化，再进全屏（避免残留最大化态与退出回路）
    mainWindow.on('maximize', () => {
        if (!alive() || mainWindow.isFullScreen()) return;
        if (mainWindow.isMaximized()) {
            suppressUnmaximize = true;
            mainWindow.unmaximize();
        }
        mainWindow.setFullScreen(true);
    });

    mainWindow.on('unmaximize', () => {
        if (suppressUnmaximize) { suppressUnmaximize = false; return; }
        if (!alive()) return;
        if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
        scheduleWindowed();
    });

    mainWindow.on('enter-full-screen', () => {});
    mainWindow.on('leave-full-screen', () => {
        scheduleWindowed();
    });

    mainWindow.on('resize', () => {
        if (!alive()) return;
        if (mainWindow.isFullScreen() || mainWindow.isMaximized()) return;
        const [w, h] = mainWindow.getSize();
        if (w !== WINDOW_WIDTH || h !== WINDOW_HEIGHT) {
            mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT, true);
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && (input.key === 'F11' || input.key === 'Escape')) {
            event.preventDefault();
            toggleFullscreen();
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    app.quit();
});