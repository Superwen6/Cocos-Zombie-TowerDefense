import { _decorator, Component, Node, Sprite, Label, director, AudioClip, AudioSource } from 'cc';
import { SaveSystem } from './SaveSystem';
import { SaveSlotPanelUI } from './SaveSlotPanelUI';

const { ccclass, property } = _decorator;

@ccclass('MainMenuUI')
export class MainMenuUI extends Component {
    @property({ type: AudioClip, tooltip: '主菜单背景音乐' })
    bgMusic: AudioClip | null = null;

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

    @property({ type: Label, tooltip: '进度百分比文字' })
    progressLabel: Label | null = null;

    private _loading = false;
    private _intervalId: ReturnType<typeof setInterval> | null = null;
    private _bgAudioSource: AudioSource | null = null;

    onLoad() {
        // 播放背景音乐
        if (this.bgMusic) {
            this._bgAudioSource = this.node.addComponent(AudioSource);
            this._bgAudioSource.clip = this.bgMusic;
            this._bgAudioSource.loop = true;
            this._bgAudioSource.volume = 0.5;
            this._bgAudioSource.play();
        }

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

    /** 更新进度条和百分比文字 */
    private updateProgress(value: number) {
        const pct = Math.round(value * 100);
        if (this.progressBarFill && this.progressBarFill.isValid) {
            this.progressBarFill.fillRange = value;
        }
        if (this.progressLabel && this.progressLabel.isValid) {
            this.progressLabel.string = `加载中... ${pct}%`;
        }
    }

    /** 启动加载流程：预加载场景资源 + 进度条 */
    private startLoading() {
        let targetProgress = 0;
        let displayProgress = 0;
        let preloadCompleted = false;
        const startTime = Date.now();

        const doLoadScene = () => {
            if (this._intervalId) {
                clearInterval(this._intervalId);
                this._intervalId = null;
            }
            this.updateProgress(1);
            this.scheduleOnce(() => {
                director.loadScene('1');
            }, 0.3);
        };

        // 每 50ms 更新一次显示进度（平滑追赶目标进度）
        this._intervalId = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;

            // 编辑器预览模式下 preloadScene 回调可能不触发，用时间模拟回退
            if (!preloadCompleted && elapsed > 0.5 && targetProgress < 0.9) {
                targetProgress = Math.min(0.9, elapsed / 3);
            }

            // 平滑追赶
            if (displayProgress < targetProgress) {
                displayProgress += 0.02;
                if (displayProgress > targetProgress) displayProgress = targetProgress;
            }

            this.updateProgress(displayProgress);

            // 加载完成
            if (displayProgress >= 1 && targetProgress >= 1) {
                doLoadScene();
                return;
            }

            // 超时保护：8 秒后强制完成
            if (elapsed > 8) {
                targetProgress = 1;
                preloadCompleted = true;
            }
        }, 50);

        // 后台预加载 1.scene 所有资源
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

    /** 隐藏主菜单三个按钮 */
    private hideButtons() {
        if (this.startGameBtn) this.startGameBtn.active = false;
        if (this.loadGameBtn) this.loadGameBtn.active = false;
        if (this.exitGameBtn) this.exitGameBtn.active = false;
    }

    /** 恢复主菜单三个按钮 */
    private restoreButtons() {
        if (this.startGameBtn) this.startGameBtn.active = true;
        if (this.loadGameBtn) this.loadGameBtn.active = true;
        if (this.exitGameBtn) this.exitGameBtn.active = true;
    }

    /** 载入存档：打开多槽位读档面板，选择槽位后进入游戏场景 */
    onLoadGame() {
        if (this._loading) return;

        const inst = SaveSlotPanelUI.openLoadPanel(
            (slot: number) => {
                if (this._loading) return;
                this._loading = true;
                this.hideButtons();
                // 标记为加载指定槽位存档，1.scene 启动后会应用该存档
                SaveSystem.markPendingLoad(slot);
                if (this.loadingPanel) {
                    this.loadingPanel.active = true;
                }
                this.startLoading();
            },
            () => {
                // 关闭面板后恢复主菜单按钮
                this.restoreButtons();
            },
        );

        if (inst) {
            this.hideButtons();
        } else {
            console.warn('[MainMenuUI] 未找到读档面板');
        }
    }

    /** 退出游戏 */
    onExitGame() {
        console.log('[MainMenuUI] 退出游戏');
        if (typeof window !== 'undefined') {
            window.close();
        }
    }

    onDestroy() {
        if (this.startGameBtn && this.startGameBtn.isValid) {
            this.startGameBtn.off(Node.EventType.TOUCH_END, this.onStartGame, this);
        }
        if (this.loadGameBtn && this.loadGameBtn.isValid) {
            this.loadGameBtn.off(Node.EventType.TOUCH_END, this.onLoadGame, this);
        }
        if (this.exitGameBtn && this.exitGameBtn.isValid) {
            this.exitGameBtn.off(Node.EventType.TOUCH_END, this.onExitGame, this);
        }
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
}