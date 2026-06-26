import { _decorator, Button, Color, Component, Label, Node, Sprite, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';

const { ccclass, property } = _decorator;

const UI_REFRESH_INTERVAL = 0.2;

/**
 * 基地建造/升级面板 UI（支持打开/关闭弹窗）。
 * 挂载在负责控制 UpgradePanel 的节点上。
 * 颜色反馈：资源不足时文本变红，充足时白色（与炮塔建造面板同款逻辑）。
 */
@ccclass('BuildPanelUI')
export class BuildPanelUI extends Component {
    @property({ type: Button, tooltip: '基地升级按钮' })
    upgradeButton: Button | null = null;

    @property({ type: Label, tooltip: '当前基地等级文本' })
    levelText: Label | null = null;

    @property({ type: Label, tooltip: '升级消耗与拥有量对比文本' })
    resourceCostText: Label | null = null;

    @property({ type: Button, tooltip: '屏幕下方：打开升级面板' })
    openPanelButton: Button | null = null;

    @property({ type: Button, tooltip: '面板右上角：关闭 X' })
    closePanelButton: Button | null = null;

    @property({ type: Node, tooltip: '面板视觉主体，控制整块面板的显示/隐藏' })
    panelRootNode: Node | null = null;

    private _refreshTimer = 0;

    start() {
        this.bindButton(this.upgradeButton, this.onUpgradeClick, 'upgradeButton');
        this.bindButton(this.openPanelButton, this.showPanel, 'openPanelButton');
        this.bindButton(this.closePanelButton, this.hidePanel, 'closePanelButton');

        this.hidePanel();
    }

    onDestroy() {
        this.unbindButton(this.upgradeButton, this.onUpgradeClick);
        this.unbindButton(this.openPanelButton, this.showPanel);
        this.unbindButton(this.closePanelButton, this.hidePanel);
    }

    update(dt: number) {
        if (!this.panelRootNode?.active) {
            return;
        }

        this._refreshTimer += dt;
        if (this._refreshTimer >= UI_REFRESH_INTERVAL) {
            this._refreshTimer = 0;
            this.refreshUpgradeUI();
        }
    }

    /** 显示升级面板 */
    showPanel() {
        if (!this.panelRootNode) {
            warn('[BuildPanelUI] 未绑定 panelRootNode，无法显示面板');
            return;
        }

        if (this.panelRootNode === this.node) {
            this.setHostPanelVisible(true);
        } else {
            this.panelRootNode.active = true;
        }

        this._refreshTimer = 0;
        this.refreshUpgradeUI();
    }

    /** 隐藏升级面板 */
    hidePanel() {
        if (!this.panelRootNode) {
            warn('[BuildPanelUI] 未绑定 panelRootNode，无法隐藏面板');
            return;
        }

        if (this.panelRootNode === this.node) {
            this.setHostPanelVisible(false);
        } else {
            this.panelRootNode.active = false;
        }
    }

    /**
     * panelRootNode 指向 UpgradePanel 自身时：只隐藏子节点与背景，不 deactivate 宿主。
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

    private onUpgradeClick() {
        const base = BaseSystem.instance;
        if (!base) {
            warn('[BuildPanelUI] BaseSystem 未初始化');
            return;
        }

        if (base.isMaxLevel || base.isUpgrading) {
            return;
        }

        const success = base.startUpgrade();
        if (success) {
            // 升级建造开始：关闭面板
            this.hidePanel();
        }
        this.refreshUpgradeUI();
    }

    /** 公共刷新方法：更新等级文本 + 资源颜色反馈 */
    refreshUpgradeUI() {
        const base = BaseSystem.instance;
        const data = PlayerData.instance;

        // 等级文本
        if (this.levelText) {
            if (!base) {
                this.levelText.string = '基地 Lv.?';
            } else if (base.isMaxLevel) {
                this.levelText.string = `基地 Lv.${base.currentLevel} (MAX)`;
            } else {
                this.levelText.string = `基地 Lv.${base.currentLevel}`;
            }
        }

        // 资源文本 + 颜色反馈
        if (this.resourceCostText) {
            this.resourceCostText.string = this.buildCostText(base, data);
            this.resourceCostText.color = this.getCostColor(base, data);
        }

        // 按钮交互状态
        if (this.upgradeButton) {
            const canUpgrade =
                base != null && !base.isMaxLevel && !base.isUpgrading && base.checkUpgradeAvailable();
            this.upgradeButton.interactable = canUpgrade;
        }
    }

    /** 拼装升级消耗与玩家拥有量对比字符串 */
    private buildCostText(base: BaseSystem | null, data: PlayerData | null): string {
        if (!base) {
            return '升级需要:\n(基地系统未就绪)';
        }

        if (!data) {
            return '升级需要:\n(资源数据未就绪)';
        }

        if (base.isMaxLevel) {
            return '升级需要:\n已满级 MAX';
        }

        const tier = base.getNextUpgradeTier();
        if (!tier) {
            return '升级需要:\n无下一级配置';
        }

        return (
            '升级需要:\n' +
            `木: ${data.woodCount}/${tier.wood}\n` +
            `铜: ${data.copperCount}/${tier.copper}\n` +
            `铁: ${data.ironCount}/${tier.iron}\n` +
            `美金: ${data.money}/${tier.money}`
        );
    }

    /** 根据资源是否充足返回颜色：全部充足 → 白色，任一不足 → 红色 */
    private getCostColor(base: BaseSystem | null, data: PlayerData | null): Color {
        if (!base || !data || base.isMaxLevel) {
            return new Color(255, 255, 255, 255);
        }

        const tier = base.getNextUpgradeTier();
        if (!tier) {
            return new Color(255, 255, 255, 255);
        }

        const canAfford =
            data.woodCount >= tier.wood &&
            data.copperCount >= tier.copper &&
            data.ironCount >= tier.iron &&
            data.money >= tier.money;

        return canAfford
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);
    }

    private bindButton(
        button: Button | null,
        handler: () => void,
        debugName: string,
    ) {
        if (!button) {
            warn(`[BuildPanelUI] 未绑定 ${debugName}`);
            return;
        }
        button.node.on(Button.EventType.CLICK, handler, this);
    }

    private unbindButton(button: Button | null, handler: () => void) {
        if (button?.node.isValid) {
            button.node.off(Button.EventType.CLICK, handler, this);
        }
    }
}