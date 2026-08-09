const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let isFullscreenFromUs = false;
let suppressUnmaximize = false;
let windowedTimer = null;

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 720;

// ===== 诊断日志 =====
const LOG_FILE = path.join(app.getPath('userData'), 'window-debug.log');
const ENABLE_LOG = true;
const log = (...args) => {
    if (!ENABLE_LOG) return;
    const line = `[${new Date().toISOString()}] ${args.join(' | ')}`;
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* ignore */ }
    console.log(line);
};
const alive = () => mainWindow && !mainWindow.isDestroyed();
const state = (tag) => {
    if (!alive()) return `${tag} window=destroyed`;
    const b = mainWindow.getBounds();
    return `${tag} full=${mainWindow.isFullScreen()} max=${mainWindow.isMaximized()} size=${mainWindow.getSize().join('x')} bounds=${Math.round(b.x)},${Math.round(b.y)} ${b.width}x${b.height} visible=${mainWindow.isVisible()}`;
};
const debugState = (tag) => log(state(tag));
// ====================

function centerWindow() {
    if (!alive()) return;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const { x, y, width, height } = display.workArea;
    mainWindow.setPosition(
        Math.round(x + (width - WINDOW_WIDTH) / 2),
        Math.round(y + (height - WINDOW_HEIGHT) / 2)
    );
    debugState('centerWindow done');
}

// 兜底：强制回到 1280x720 普通窗口（幂等 —— 已处于正确状态则跳过，避免重复设置造成晃动）
function ensureWindowed() {
    if (!alive()) return;
    debugState('ensureWindowed BEGIN');
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
    debugState('ensureWindowed END');
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
    log('enterFullscreen called');
    isFullscreenFromUs = true;
    if (mainWindow.isMaximized()) {
        suppressUnmaximize = true;
        mainWindow.unmaximize();
    }
    mainWindow.setFullScreen(true);
    debugState('after setFullScreen(true)');
}

function exitFullscreen() {
    if (!alive()) return;
    log('exitFullscreen called');
    isFullscreenFromUs = false;
    if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
    }
    scheduleWindowed();
}

function toggleFullscreen() {
    if (!alive()) return;
    log('toggleFullscreen: inside');
    if (mainWindow.isFullScreen()) {
        exitFullscreen();
    } else {
        enterFullscreen();
    }
}

function createWindow() {
    log('=== createWindow start ===');
    log('platform:', process.platform, 'electron:', process.versions.electron);
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
    debugState('after new BrowserWindow');

    mainWindow.show();
    centerWindow();
    debugState('after show');

    // 最大化按钮 -> 先解除最大化，再进全屏（避免残留最大化态与退出回路）
    mainWindow.on('maximize', () => {
        debugState('EVENT maximize');
        if (alive() && !mainWindow.isFullScreen()) {
            isFullscreenFromUs = true;
            if (mainWindow.isMaximized()) {
                suppressUnmaximize = true;
                mainWindow.unmaximize();
            }
            mainWindow.setFullScreen(true);
            debugState('EVENT maximize -> setFullScreen');
        }
    });

    mainWindow.on('unmaximize', () => {
        debugState('EVENT unmaximize (suppressed=' + suppressUnmaximize + ')');
        if (suppressUnmaximize) { suppressUnmaximize = false; return; }
        if (!alive()) return;
        if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
        isFullscreenFromUs = false;
        scheduleWindowed();
    });

    mainWindow.on('enter-full-screen', () => {
        log('EVENT enter-full-screen');
        isFullscreenFromUs = true;
        debugState('after enter-full-screen');
    });
    mainWindow.on('leave-full-screen', () => {
        log('EVENT leave-full-screen');
        isFullscreenFromUs = false;
        scheduleWindowed();
    });

    mainWindow.on('resize', () => {
        debugState('EVENT resize');
        if (!alive()) return;
        if (mainWindow.isFullScreen() || mainWindow.isMaximized()) return;
        const [w, h] = mainWindow.getSize();
        if (w !== WINDOW_WIDTH || h !== WINDOW_HEIGHT) {
            mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT, true);
        }
    });

    mainWindow.on('focus', () => debugState('EVENT focus'));
    mainWindow.on('blur', () => debugState('EVENT blur'));

    mainWindow.webContents.on('before-input-event', (event, input) => {
        debugState('KEY type=' + input.type + ' key=' + input.key);
        if (input.type === 'keyDown' && (input.key === 'F11' || input.key === 'Escape')) {
            log('KEY capture Esc/F11');
            event.preventDefault();
            toggleFullscreen();
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

    mainWindow.on('closed', () => {
        debugState('EVENT closed');
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    log('=== app.whenReady ===');
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    app.quit();
});