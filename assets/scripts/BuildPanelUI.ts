import { _decorator, Button, Component, Label, Node, Sprite, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';

const { ccclass, property } = _decorator;

const UI_REFRESH_INTERVAL = 0.2;

/**
 * 基地建造/升级面板 UI（支持打开/关闭弹窗）。
 * 挂载在负责控制 UpgradePanel 的节点上。
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
            this.updateResourceLabels();
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

        // 先清零，防止残留固化数据闪现
        this.resetResourceLabels();
        // 立即从数据层拉取最新值刷新
        this.updateResourceLabels();
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
        if (!BaseSystem.instance) {
            warn('[BuildPanelUI] BaseSystem 未初始化');
            return;
        }

        BaseSystem.instance.upgradeBase();
        this.updateResourceLabels();
    }

    /** 清零文本，防止短暂显示残留数据 */
    private resetResourceLabels() {
        if (this.resourceCostText) {
            this.resourceCostText.string =
                '升级需要:\n木: 0 / 0\n铜: 0 / 0\n铁: 0 / 0\n美金: 0 / 0';
        }
        if (this.levelText) {
            this.levelText.string = '基地 Lv.?';
        }
    }

    /** 从 PlayerData / BaseSystem 动态拉取最新数据刷新 UI */
    updateResourceLabels() {
        const base = BaseSystem.instance;
        const data = PlayerData.instance;

        if (this.levelText) {
            if (!base) {
                this.levelText.string = '基地 Lv.?';
            } else if (base.isMaxLevel) {
                this.levelText.string = `基地 Lv.${base.currentLevel} (MAX)`;
            } else {
                this.levelText.string = `基地 Lv.${base.currentLevel}`;
            }
        }

        if (this.resourceCostText) {
            this.resourceCostText.string = this.buildCostText(base, data);
        }

        if (this.upgradeButton) {
            const canUpgrade =
                base != null && !base.isMaxLevel && base.checkUpgradeAvailable();
            this.upgradeButton.interactable = canUpgrade;
        }
    }

    /** 拼装升级消耗与玩家拥有量对比字符串（完全动态，无硬编码） */
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
