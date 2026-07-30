import { _decorator, Button, Component, Label, Node, director, find, warn } from 'cc';
import { SaveSystem } from './SaveSystem';

const { ccclass, property } = _decorator;

/**
 * 设置面板 UI（挂在 settingpanel 节点上）。
 * 管理存档、关闭面板、退出游戏等功能。
 * 注意：settingpanel 默认 inactive，因此按钮事件通过 ensureOpenPanelBinding 静态方法绑定。
 */
@ccclass('SettingPanelUI')
export class SettingPanelUI extends Component {
    @property({ type: Node, tooltip: '设置按钮（点击打开面板）' })
    settingBtn: Node | null = null;

    @property({ type: Node, tooltip: '存储游戏按钮' })
    saveGameBtn: Node | null = null;

    @property({ type: Node, tooltip: '关闭面板按钮' })
    closeBtn: Node | null = null;

    @property({ type: Node, tooltip: '退出游戏按钮' })
    exitGameBtn: Node | null = null;

    @property({ type: Label, tooltip: '存档成功提示文本（Btn_SaveGame 下的 notice）' })
    saveNoticeLabel: Label | null = null;

    private static _openPanelBound = false;
    private static _pendingOpen = false;

    onLoad() {
        // 面板内按钮的绑定（面板激活后 onLoad 才会执行）
        this.bindButton(this.saveGameBtn, this.onSaveGame);
        this.bindButton(this.closeBtn, this.onClose);
        this.bindButton(this.exitGameBtn, this.onExitGame);

        // 存档提示初始隐藏
        if (this.saveNoticeLabel) {
            this.saveNoticeLabel.node.active = false;
        }
    }

    start() {
        // 如果是从外部触发的打开（ensureOpenPanelBinding 中设置的标记），显示面板
        if (SettingPanelUI._pendingOpen) {
            SettingPanelUI._pendingOpen = false;
            this.open();
        }
    }

    /**
     * 确保 setting 打开按钮的点击事件已绑定。
     * 从 GameHUDUI 等始终激活的组件的 start() 中调用。
     */
    public static ensureOpenPanelBinding() {
        if (SettingPanelUI._openPanelBound) return;
        SettingPanelUI._openPanelBound = true;

        const settingPanel = find('Canvas/settingpanel');
        if (!settingPanel) {
            warn('[SettingPanelUI] 找不到 Canvas/settingpanel');
            return;
        }
        const ui = settingPanel.getComponent(SettingPanelUI);
        if (!ui) {
            warn('[SettingPanelUI] settingpanel 上无 SettingPanelUI 组件');
            return;
        }
        const btn = ui.settingBtn;
        if (!btn) {
            warn('[SettingPanelUI] settingBtn 未绑定');
            return;
        }
        const button = btn.getComponent(Button);
        if (!button) {
            warn('[SettingPanelUI] setting 节点上无 Button 组件');
            return;
        }
        button.node.on(Button.EventType.CLICK, () => {
            if (!settingPanel.active) {
                SettingPanelUI._pendingOpen = true;
                settingPanel.active = true;
            } else {
                ui.open();
            }
        }, ui);
    }

    /** 绑定按钮点击事件 */
    private bindButton(btn: Node | null, handler: () => void) {
        if (!btn) return;
        const button = btn.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, handler, this);
        }
    }

    /** 解绑按钮点击事件 */
    private unbindButton(btn: Node | null, handler: () => void) {
        if (!btn || !btn.isValid) return;
        const button = btn.getComponent(Button);
        if (button && button.node && button.node.isValid) {
            button.node.off(Button.EventType.CLICK, handler, this);
        }
    }

    /** 外部调用：通过 setting 按钮打开面板 */
    public open() {
        if (this.node) {
            this.node.active = true;
        }
    }

    /** 关闭面板 */
    public close() {
        if (this.node) {
            this.node.active = false;
        }
    }

    /** 存储游戏进度 */
    private onSaveGame() {
        const success = SaveSystem.save();
        if (success) {
            console.log('[SettingPanelUI] 游戏已保存');
            this.showSaveNotice();
        } else {
            console.warn('[SettingPanelUI] 保存失败');
        }
    }

    /** 显示存档成功提示，2秒后自动隐藏 */
    private showSaveNotice() {
        if (!this.saveNoticeLabel) return;
        this.saveNoticeLabel.string = '成功';
        this.saveNoticeLabel.node.active = true;
        this.scheduleOnce(() => {
            if (this.saveNoticeLabel?.node?.isValid) {
                this.saveNoticeLabel.node.active = false;
            }
        }, 2);
    }

    /** 关闭面板 */
    private onClose() {
        this.close();
    }

    /** 退出游戏（返回主菜单） */
    private onExitGame() {
        director.loadScene('MainMenu');
    }

    onDestroy() {
        SettingPanelUI._openPanelBound = false;
        SettingPanelUI._pendingOpen = false;
        this.unbindButton(this.saveGameBtn, this.onSaveGame);
        this.unbindButton(this.closeBtn, this.onClose);
        this.unbindButton(this.exitGameBtn, this.onExitGame);
    }
}