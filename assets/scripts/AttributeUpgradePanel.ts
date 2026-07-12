import { _decorator, Button, Component, find, Node, Sprite, warn } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 属性升级面板 UI。
 * 挂载在 Canvas/AttributeUpgradePanel 节点上。
 * 处理面板打开/关闭、选项卡切换、属性升级逻辑。
 */
@ccclass('AttributeUpgradePanel')
export class AttributeUpgradePanel extends Component {
    @property({ type: Button, tooltip: '面板右上角：关闭按钮' })
    closeButton: Button | null = null;

    @property({ type: Node, tooltip: '生存选项卡按钮' })
    tabSurvival: Node | null = null;

    @property({ type: Node, tooltip: '工程选项卡按钮' })
    tabEngineering: Node | null = null;

    @property({ type: Node, tooltip: '武器选项卡按钮' })
    tabWeapon: Node | null = null;

    @property({ type: Node, tooltip: '生存内容区' })
    survivalContent: Node | null = null;

    @property({ type: Node, tooltip: '工程内容区' })
    engineeringContent: Node | null = null;

    @property({ type: Node, tooltip: '武器内容区' })
    weaponContent: Node | null = null;

    private _panelVisible = false;
    private static _openPanelBound = false;
    private static _pendingOpen = false;

    start() {
        this.bindCloseButton();

        if (AttributeUpgradePanel._pendingOpen) {
            AttributeUpgradePanel._pendingOpen = false;
            this.showPanel();
        } else {
            this.hidePanel();
        }
    }

    onDestroy() {
        if (this.closeButton?.node.isValid) {
            this.closeButton.node.off(Button.EventType.CLICK, this.hidePanel, this);
        }
    }

    /** 显示属性升级面板 */
    showPanel() {
        this._panelVisible = true;
        this.setHostPanelVisible(true);
    }

    /** 隐藏属性升级面板 */
    hidePanel() {
        this._panelVisible = false;
        this.setHostPanelVisible(false);
    }

    /** 查询面板是否可见 */
    public isPanelVisible(): boolean {
        return this._panelVisible;
    }

    /**
     * 确保打开面板按钮的点击事件已绑定。
     * 从 GameHUDUI 等始终激活的组件的 start() 中调用。
     */
    public static ensureOpenPanelBinding() {
        if (AttributeUpgradePanel._openPanelBound) return;
        AttributeUpgradePanel._openPanelBound = true;

        const panelNode = find('Canvas/AttributeUpgradePanel');
        if (!panelNode) {
            warn('[AttributeUpgradePanel] 找不到 Canvas/AttributeUpgradePanel');
            return;
        }
        const panel = panelNode.getComponent(AttributeUpgradePanel);
        if (!panel) {
            warn('[AttributeUpgradePanel] AttributeUpgradePanel 节点上无 AttributeUpgradePanel 组件');
            return;
        }

        const btnNode = find('Canvas/Btn_OpenAttribute');
        if (!btnNode) {
            warn('[AttributeUpgradePanel] 找不到 Canvas/Btn_OpenAttribute');
            return;
        }
        const btn = btnNode.getComponent(Button);
        if (!btn) {
            warn('[AttributeUpgradePanel] Btn_OpenAttribute 上无 Button 组件');
            return;
        }

        btn.node.on(Button.EventType.CLICK, () => {
            if (!panelNode.active) {
                AttributeUpgradePanel._pendingOpen = true;
                panelNode.active = true;
            } else {
                panel.showPanel();
            }
        }, panel);
    }

    /** 绑定关闭按钮 */
    private bindCloseButton() {
        if (!this.closeButton) {
            warn('[AttributeUpgradePanel] closeButton 未绑定');
            return;
        }
        this.closeButton.node.on(Button.EventType.CLICK, this.hidePanel, this);
    }

    /**
     * 隐藏/显示面板：隐藏子节点 + 禁用宿主节点 Sprite，不 deactivate 宿主节点。
     */
    private setHostPanelVisible(visible: boolean) {
        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            sprite.enabled = visible;
        }
        for (const child of this.node.children) {
            child.active = visible;
        }
    }
}