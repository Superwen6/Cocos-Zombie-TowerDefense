import { _decorator, Component, Node, Sprite, director } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('MainMenuUI')
export class MainMenuUI extends Component {
    @property({ type: Node, tooltip: '开始游戏按钮' })
    startGameBtn: Node | null = null;

    @property({ type: Node, tooltip: '载入游戏按钮' })
    loadGameBtn: Node | null = null;

    @property({ type: Node, tooltip: '退出游戏按钮' })
    exitGameBtn: Node | null = null;

    @property({ type: Node, tooltip: '加载面板节点' })
    loadingPanel: Node | null = null;

    @property({ type: Sprite, tooltip: '进度条填充' })
    progressBarFill: Sprite | null = null;

    private _loading = false;
    private _intervalId: ReturnType<typeof setInterval> | null = null;

    onLoad() {
        if (this.startGameBtn) {
            this.startGameBtn.on(Node.EventType.TOUCH_END, this.onStartGame, this);
        }
        if (this.loadGameBtn) {
            this.loadGameBtn.on(Node.EventType.TOUCH_END, this.onLoadGame, this);
        }
        if (this.exitGameBtn) {
            this.exitGameBtn.on(Node.EventType.TOUCH_END, this.onExitGame, this);
        }
    }

    /** 开始游戏 */
    onStartGame() {
        if (this._loading) return;
        this._loading = true;

        if (this.startGameBtn) this.startGameBtn.active = false;
        if (this.loadGameBtn) this.loadGameBtn.active = false;
        if (this.exitGameBtn) this.exitGameBtn.active = false;

        if (this.loadingPanel) {
            this.loadingPanel.active = true;
        }

        this.startLoading();
    }

    /** 启动加载流程：进度条 + 场景预加载 */
    private startLoading() {
        let progress = 0;
        let targetProgress = 0;
        let preloadCompleted = false;
        const startTime = Date.now();

        const doLoadScene = () => {
            if (this._intervalId) {
                clearInterval(this._intervalId);
                this._intervalId = null;
            }
            // 确保进度条视觉上到 100%
            if (this.progressBarFill && this.progressBarFill.isValid) {
                this.progressBarFill.fillRange = 1;
            }
            this.scheduleOnce(() => {
                director.loadScene('1');
            }, 0.3);
        };

        this._intervalId = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;

            // 回退：无进度回调时持续自动推进
            if (!preloadCompleted && elapsed > 0.5 && targetProgress < 0.9) {
                targetProgress = Math.min(0.9, elapsed / 3);
            }

            // 平滑追赶目标进度
            if (progress < targetProgress) {
                progress += 0.03;
                if (progress > targetProgress) progress = targetProgress;
            }

            if (this.progressBarFill && this.progressBarFill.isValid) {
                this.progressBarFill.fillRange = progress;
            }

            // 进度完成 → 切换场景
            if (progress >= 1 && targetProgress >= 1) {
                doLoadScene();
                return;
            }

            // 超时保护：8 秒后强制完成加载
            if (elapsed > 8) {
                targetProgress = 1;
                preloadCompleted = true;
            }
        }, 50);

        // 真实预加载场景资源
        director.preloadScene(
            '1',
            (completed: number, total: number) => {
                if (total > 0) {
                    targetProgress = (completed / total) * 0.8;
                }
            },
            (err: Error | null) => {
                preloadCompleted = true;
                if (err) {
                    console.warn('[MainMenuUI] 预加载回调异常:', err.message);
                }
                targetProgress = 1;
            },
        );
    }

    /** 载入游戏 */
    onLoadGame() {
        console.log('[MainMenuUI] 载入游戏');
    }

    /** 退出游戏 */
    onExitGame() {
        console.log('[MainMenuUI] 退出游戏');
        if (typeof window !== 'undefined') {
            window.close();
        }
    }

    onDestroy() {
        // 检查节点是否仍然有效再调用 off
        if (this.startGameBtn && this.startGameBtn.isValid) {
            this.startGameBtn.off(Node.EventType.TOUCH_END, this.onStartGame, this);
        }
        if (this.loadGameBtn && this.loadGameBtn.isValid) {
            this.loadGameBtn.off(Node.EventType.TOUCH_END, this.onLoadGame, this);
        }
        if (this.exitGameBtn && this.exitGameBtn.isValid) {
            this.exitGameBtn.off(Node.EventType.TOUCH_END, this.onExitGame, this);
        }
        // 清理定时器
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
}
