import { _decorator, Button, Color, Component, find, Label, Prefab, Sprite, SpriteFrame, instantiate, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { PlantPanelUI } from './PlantPanelUI';
import { UpgradePanelUI } from './UpgradePanelUI';
import { PlantGenerator } from './PlantGenerator';
import { Container } from './Container';

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

    // ---- 保留旧属性用于兼容（已废弃，改用独立 cost label） ----
    @property({ type: Label, tooltip: '升级消耗与拥有量对比文本（已废弃）' })
    resourceCostText: Label | null = null;

    // ---- 新的独立资源消耗 Label ----
    @property({ type: Label, tooltip: '木头消耗文本（ResourceCostText/CostWood/Value）' })
    costWoodLabel: Label | null = null;

    @property({ type: Label, tooltip: '铜矿消耗文本（ResourceCostText/CostCopper/Value）' })
    costCopperLabel: Label | null = null;

    @property({ type: Label, tooltip: '铁矿消耗文本（ResourceCostText/CostIron/Value）' })
    costIronLabel: Label | null = null;

    @property({ type: Label, tooltip: '美金消耗文本（ResourceCostText/CostMoney/Value）' })
    costMoneyLabel: Label | null = null;

    @property({ type: Label, tooltip: '电力消耗文本（ResourceCostText/CostPower/Value）' })
    costPowerLabel: Label | null = null;

    // ---- 图标 SpriteFrame ----
    @property({ type: SpriteFrame, tooltip: '木头图标' })
    woodIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '铜矿图标' })
    copperIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '铁矿图标' })
    ironIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '美金图标' })
    moneyIconSprite: SpriteFrame | null = null;

    @property({ type: Button, tooltip: '屏幕下方：打开升级面板' })
    openPanelButton: Button | null = null;

    @property({ type: Button, tooltip: '面板右上角：关闭 X' })
    closePanelButton: Button | null = null;

    @property({ type: Label, tooltip: '升级警告提示 Label（显示2秒后自动隐藏）' })
    warningLabel: Label | null = null;

    private _refreshTimer = 0;
    private _warningTimer = 0;
    private _panelVisible = false;
    private static _openPanelBound = false;
    private static _pendingOpen = false;

    start() {
        this.bindButton(this.upgradeButton, this.onUpgradeClick, 'upgradeButton');
        this.bindButton(this.closePanelButton, this.hidePanel, 'closePanelButton');

        if (BuildPanelUI._pendingOpen) {
            BuildPanelUI._pendingOpen = false;
            this.showPanel();
        } else {
            this.hidePanel();
        }
        if (this.warningLabel) {
            this.warningLabel.node.active = false;
        }
    }

    onDestroy() {
        this.unbindButton(this.upgradeButton, this.onUpgradeClick);
        this.unbindButton(this.closePanelButton, this.hidePanel);
    }

    update(dt: number) {
        // 警告计时器倒计时
        if (this._warningTimer > 0) {
            this._warningTimer -= dt;
            if (this._warningTimer <= 0) {
                this._warningTimer = 0;
                if (this.warningLabel) {
                    this.warningLabel.node.active = false;
                }
            }
        }

        if (!this._panelVisible) {
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
        this._panelVisible = true;
        this.setHostPanelVisible(true);

        this._refreshTimer = 0;
        this.refreshUpgradeUI();

        // 面板打开时刷新发电机按钮状态（active 与交互状态）
        const plantPanel = this.getComponent(PlantPanelUI);
        if (plantPanel) {
            plantPanel.refreshButtonStates();
        }
    }

    /** 隐藏升级面板 */
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
     * 支持 UpgradePanel 节点在编辑器中未勾选激活的场景。
     * 从 GameHUDUI 等始终激活的组件的 start() 中调用。
     */
    public static ensureOpenPanelBinding() {
        if (BuildPanelUI._openPanelBound) return;
        BuildPanelUI._openPanelBound = true;

        const upgradePanel = find('Canvas/UpgradePanel');
        if (!upgradePanel) {
            warn('[BuildPanelUI] 找不到 Canvas/UpgradePanel，打开面板按钮绑定失败');
            return;
        }
        const buildPanel = upgradePanel.getComponent(BuildPanelUI);
        if (!buildPanel) {
            warn('[BuildPanelUI] UpgradePanel 上无 BuildPanelUI 组件');
            return;
        }
        const btn = buildPanel.openPanelButton;
        if (!btn) {
            warn('[BuildPanelUI] openPanelButton 未绑定');
            return;
        }
        btn.node.on(Button.EventType.CLICK, () => {
            if (!upgradePanel.active) {
                // 节点未激活 → 先激活，start() 会通过 _pendingOpen 显示面板
                BuildPanelUI._pendingOpen = true;
                upgradePanel.active = true;
            } else {
                buildPanel.showPanel();
            }
        }, buildPanel);
    }

    /**
     * 隐藏/显示面板：只隐藏子节点与背景 Sprite，不 deactivate 宿主节点。
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
            this.hidePanel();
        } else if (base.upgradeWarning) {
            this.showWarning(base.upgradeWarning);
        }
        this.refreshUpgradeUI();
    }

    /** 公共方法：显示警告信息，2 秒后自动隐藏 */
    public showWarning(message: string) {
        if (!this.warningLabel) return;
        this.warningLabel.string = message;
        this.warningLabel.node.active = true;
        this._warningTimer = 2;
    }

    /** 公共刷新方法：更新等级文本 + 各资源消耗图标文本 + 颜色反馈 */
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

        // 更新独立的资源消耗标签
        this.refreshCostLabels(base, data);

        // 更新植物和集装箱的消耗显示
        this.refreshPlantCostDisplays(data);
        this.refreshContainerCostDisplay(data);

        // 按钮交互状态
        if (this.upgradeButton) {
            const canUpgrade =
                base != null && !base.isMaxLevel && !base.isUpgrading && base.checkUpgradeAvailable();
            this.upgradeButton.interactable = canUpgrade;
        }
    }

    /** 使用独立 Label 更新基地升级资源消耗 */
    private refreshCostLabels(base: BaseSystem | null, data: PlayerData | null) {
        if (!base || !data || base.isMaxLevel) {
            this.setCostLabel(this.costWoodLabel, '0/0', false);
            this.setCostLabel(this.costCopperLabel, '0/0', false);
            this.setCostLabel(this.costIronLabel, '0/0', false);
            this.setCostLabel(this.costMoneyLabel, '0/0', false);
            this.setCostLabel(this.costPowerLabel, '0', false);
            return;
        }

        const tier = base.getNextUpgradeTier();
        if (!tier) {
            this.setCostLabel(this.costWoodLabel, '0/0', false);
            this.setCostLabel(this.costCopperLabel, '0/0', false);
            this.setCostLabel(this.costIronLabel, '0/0', false);
            this.setCostLabel(this.costMoneyLabel, '0/0', false);
            this.setCostLabel(this.costPowerLabel, '0', false);
            return;
        }

        this.setCostLabel(this.costWoodLabel, `${data.woodCount}/${tier.wood}`, data.woodCount >= tier.wood);
        this.setCostLabel(this.costCopperLabel, `${data.copperCount}/${tier.copper}`, data.copperCount >= tier.copper);
        this.setCostLabel(this.costIronLabel, `${data.ironCount}/${tier.iron}`, data.ironCount >= tier.iron);
        this.setCostLabel(this.costMoneyLabel, `${data.money}/${tier.money}`, data.money >= tier.money);

        // 电力消耗：从 levelPowerCosts 读取，显示单数字，不足时变红
        const powerCost = base.getNextLevelPowerCost();
        const gen = base.totalPowerGen;
        this.setCostLabel(this.costPowerLabel, `${powerCost}`, gen >= powerCost);
    }

    private setCostLabel(label: Label | null, text: string, affordable: boolean) {
        if (!label) return;
        label.string = text;
        label.color = affordable
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);
    }

    // ==================== 植物 & 集装箱 CostDisplay 刷新 ====================

    /** 刷新所有植物的消耗显示 */
    private refreshPlantCostDisplays(data: PlayerData | null) {
        const plantPanel = this.getComponent(PlantPanelUI);
        if (!plantPanel) return;

        const plantNames = ['Firstplant', 'Secondplant', 'Thirdplant', 'Fourthplant'];
        for (let i = 0; i < plantNames.length; i++) {
            const plantNode = this.node.getChildByName(plantNames[i]);
            if (!plantNode) continue;
            const costDisplay = plantNode.getChildByName('CostDisplay');
            if (!costDisplay) continue;

            const prefab = plantPanel.plantPrefabs?.[i];
            if (prefab) {
                const manager = TurretPlacementManager.instance;
                const cost = manager ? manager.getCostsFromPrefab(prefab) : null;
                const powerGen = this.getPowerGenFromPrefab(prefab);
                this.updateCostDisplayChildren(costDisplay, cost, data, powerGen, true);
            }
        }
    }

    /** 刷新集装箱的消耗显示 */
    private refreshContainerCostDisplay(data: PlayerData | null) {
        const containerNode = this.node.getChildByName('container');
        if (!containerNode) return;
        const costDisplay = containerNode.getChildByName('CostDisplay');
        if (!costDisplay) return;

        const upgradePanel = this.getComponent(UpgradePanelUI);
        if (!upgradePanel) return;

        const prefab = upgradePanel.containerPrefab;
        if (prefab) {
            const manager = TurretPlacementManager.instance;
            const cost = manager ? manager.getCostsFromPrefab(prefab) : null;
            const powerCost = this.getPowerCostFromPrefab(prefab);
            this.updateCostDisplayChildren(costDisplay, cost, data, powerCost, false);
        }
    }

    /** 从发电机预制体读取发电量 */
    private getPowerGenFromPrefab(prefab: Prefab | null): number {
        if (!prefab) return 0;
        const tempNode = instantiate(prefab);
        const plant = tempNode.getComponent(PlantGenerator);
        const powerGen = plant ? plant.powerGenerate : 0;
        tempNode.destroy();
        return powerGen;
    }

    /** 从预制体读取耗电量（集装箱等） */
    private getPowerCostFromPrefab(prefab: Prefab | null): number {
        if (!prefab) return 0;
        const tempNode = instantiate(prefab);
        const container = tempNode.getComponent(Container);
        const powerCost = container ? container.powerCost : 0;
        tempNode.destroy();
        return powerCost;
    }

    /** 更新 CostDisplay 下各个 CostWood/CostIron/CostCopper/CostPower 的 Value Label */
    private updateCostDisplayChildren(costDisplay: Node, cost: TurretPlacementCost | null, data: PlayerData | null, powerValue: number = 0, isGenerator: boolean = false) {
        if (!cost || !data) {
            this.setCostChildValue(costDisplay, 'CostWood', '?/?', false);
            this.setCostChildValue(costDisplay, 'CostIron', '?/?', false);
            this.setCostChildValue(costDisplay, 'CostCopper', '?/?', false);
            this.setCostChildValue(costDisplay, 'CostPower', '?/?', false);
            return;
        }

        this.setCostChildValue(costDisplay, 'CostWood', `${data.woodCount}/${cost.wood}`, data.woodCount >= cost.wood);
        this.setCostChildValue(costDisplay, 'CostIron', `${data.ironCount}/${cost.iron}`, data.ironCount >= cost.iron);
        this.setCostChildValue(costDisplay, 'CostCopper', `${data.copperCount}/${cost.copper}`, data.copperCount >= cost.copper);

        if (isGenerator) {
            // 发电机：显示发电量，始终白色
            this.setCostChildValue(costDisplay, 'CostPower', `${powerValue}`, true);
        } else {
            // 集装箱：显示单数字耗电量，不足时变红
            const gen = BaseSystem.instance ? BaseSystem.instance.totalPowerGen : 0;
            this.setCostChildValue(costDisplay, 'CostPower', `${powerValue}`, gen >= powerValue);
        }
    }

    /** 设置 CostDisplay 下某个子节点的 Value Label，含颜色反馈 */
    private setCostChildValue(costDisplay: Node, childName: string, text: string, affordable: boolean = true) {
        const costNode = costDisplay.getChildByName(childName);
        if (!costNode) return;
        const valueNode = costNode.getChildByName('Value');
        if (!valueNode) return;
        const label = valueNode.getComponent(Label);
        if (label) {
            label.string = text;
            label.color = affordable
                ? new Color(255, 255, 255, 255)
                : new Color(255, 0, 0, 255);
        }
    }

    // ==================== 按钮绑定 ====================

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