import { _decorator, Button, Color, Component, find, Label, Prefab, Sprite, SpriteFrame, instantiate, log, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { PlantPanelUI } from './PlantPanelUI';
import { UpgradePanelUI } from './UpgradePanelUI';
import { PlantGenerator } from './PlantGenerator';
import { Container } from './Container';
import { GlobalContainerStorage } from './GlobalContainerStorage';

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
    private static _pendingOpen = false;

    onLoad() {
        // 面板节点在编辑器中 inactive，onLoad 仅在面板被激活时执行
        // 打开按钮的绑定由 ensureOpenPanelBinding（GameHUDUI.start() 调用）统一处理
        // 不在 onLoad 中绑定按钮，避免 double-binding
    }

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
        BuildPanelUI._pendingOpen = false;
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
     * 确保打开面板按钮的点击事件已绑定（从 GameHUDUI.start() 调用）。
     * 面板节点在编辑器中 inactive，onLoad 不执行，因此统一在此绑定。
     * 每次场景加载只调用一次，不会 double-binding。
     */
    public static ensureOpenPanelBinding() {
        const upgradePanel = find('Canvas/UpgradePanel');
        if (!upgradePanel) {
            warn('[BuildPanelUI] 找不到 Canvas/UpgradePanel');
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

    /** 使用独立 Label 更新基地升级资源消耗（仓库资源） */
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

        // 应用省材料率
        const ps = PlayerState.instance;
        const saveRate = ps ? ps.materialSaveRate : 0;
        const actualWood = Math.round(tier.wood * (1 - saveRate));
        const actualCopper = Math.round(tier.copper * (1 - saveRate));
        const actualIron = Math.round(tier.iron * (1 - saveRate));
        const actualMoney = Math.round(tier.money * (1 - saveRate));

        // 基地升级使用仓库资源
        const storage = GlobalContainerStorage.instance;
        const whWood = storage?.storedWood ?? 0;
        const whCopper = storage?.storedCopper ?? 0;
        const whIron = storage?.storedIron ?? 0;

        this.setCostLabel(this.costWoodLabel, `${whWood}/${actualWood}`, whWood >= actualWood);
        this.setCostLabel(this.costCopperLabel, `${whCopper}/${actualCopper}`, whCopper >= actualCopper);
        this.setCostLabel(this.costIronLabel, `${whIron}/${actualIron}`, whIron >= actualIron);
        this.setCostLabel(this.costMoneyLabel, `${data.money}/${actualMoney}`, data.money >= actualMoney);

        // 电力消耗：从 levelPowerCosts 读取，应用省电率，显示单数字，不足时变红
        const powerCost = base.getNextLevelPowerCost();
        const powerSave = ps ? ps.powerSaveRate : 0;
        const actualPower = powerCost - Math.round(powerCost * powerSave);
        const gen = base.totalPowerGen;
        this.setCostLabel(this.costPowerLabel, `${actualPower}`, gen >= actualPower);
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
        if (!plantPanel) {
            log('[BuildPanelUI] refreshPlantCostDisplays: PlantPanelUI 组件未找到');
            return;
        }

        const plantNames = ['Firstplant', 'Secondplant', 'Thirdplant', 'Fourthplant'];
        for (let i = 0; i < plantNames.length; i++) {
            const plantNode = this.node.getChildByName(plantNames[i]);
            if (!plantNode) {
                log(`[BuildPanelUI] refreshPlantCostDisplays: 未找到节点 ${plantNames[i]}`);
                continue;
            }
            const costDisplay = plantNode.getChildByName('CostDisplay');
            if (!costDisplay) {
                log(`[BuildPanelUI] refreshPlantCostDisplays: ${plantNames[i]} 下未找到 CostDisplay`);
                continue;
            }

            const prefab = plantPanel.plantPrefabs?.[i];
            log(`[BuildPanelUI] refreshPlantCostDisplays: ${plantNames[i]}, prefab=${prefab?.name ?? 'null'}, plantPrefabs长度=${plantPanel.plantPrefabs?.length ?? 0}`);
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
        if (!containerNode) {
            log('[BuildPanelUI] refreshContainerCostDisplay: 未找到 container 节点');
            return;
        }
        const costDisplay = containerNode.getChildByName('CostDisplay');
        if (!costDisplay) {
            log('[BuildPanelUI] refreshContainerCostDisplay: container 下未找到 CostDisplay');
            return;
        }

        const upgradePanel = this.getComponent(UpgradePanelUI);
        if (!upgradePanel) {
            log('[BuildPanelUI] refreshContainerCostDisplay: UpgradePanelUI 组件未找到');
            return;
        }

        const prefab = upgradePanel.containerPrefab;
        log(`[BuildPanelUI] refreshContainerCostDisplay: containerPrefab=${prefab?.name ?? 'null'}`);
        if (prefab) {
            const manager = TurretPlacementManager.instance;
            const cost = manager ? manager.getCostsFromPrefab(prefab) : null;
            const powerCost = this.getPowerCostFromPrefab(prefab);
            this.updateCostDisplayChildren(costDisplay, cost, data, powerCost, false);
        }
    }

    /** 从发电机预制体读取发电量 */
    private getPowerGenFromPrefab(prefab: Prefab | null): number {
        if (!prefab) {
            log(`[BuildPanelUI] getPowerGenFromPrefab: prefab 为 null`);
            return 0;
        }
        const tempNode = instantiate(prefab);
        const plant = tempNode.getComponent(PlantGenerator);
        const powerGen = plant ? plant.powerGenerate : 0;
        log(`[BuildPanelUI] getPowerGenFromPrefab: prefab=${prefab.name}, 找到PlantGenerator=${!!plant}, powerGenerate=${powerGen}`);
        tempNode.destroy();
        return powerGen;
    }

    /** 从预制体读取耗电量（集装箱等） */
    private getPowerCostFromPrefab(prefab: Prefab | null): number {
        if (!prefab) {
            log(`[BuildPanelUI] getPowerCostFromPrefab: prefab 为 null`);
            return 0;
        }
        const tempNode = instantiate(prefab);
        const container = tempNode.getComponent(Container);
        const powerCost = container ? container.powerCost : 0;
        log(`[BuildPanelUI] getPowerCostFromPrefab: prefab=${prefab.name}, 找到Container=${!!container}, powerCost=${powerCost}`);
        tempNode.destroy();
        return powerCost;
    }

    /** 更新 CostDisplay 下各个 CostWood/CostIron/CostCopper/CostPower 的 Value Label。
     * CostPower 与 CostDisplay 是兄弟节点，其他三个是 CostDisplay 的子节点。 */
    private updateCostDisplayChildren(costDisplay: Node, cost: TurretPlacementCost | null, data: PlayerData | null, powerValue: number = 0, isGenerator: boolean = false) {
        // CostPower 是 CostDisplay 的兄弟节点，需要用父节点来查找
        const powerParent = costDisplay.parent ?? costDisplay;

        if (!cost || !data) {
            this.setCostChildValue(costDisplay, 'CostWood', '?/?', false);
            this.setCostChildValue(costDisplay, 'CostIron', '?/?', false);
            this.setCostChildValue(costDisplay, 'CostCopper', '?/?', false);
            this.setCostChildValue(powerParent, 'CostPower', '?/?', false);
            return;
        }

        // 应用省材料率
        const ps = PlayerState.instance;
        const saveRate = ps ? ps.materialSaveRate : 0;
        const actualWood = Math.round(cost.wood * (1 - saveRate));
        const actualIron = Math.round(cost.iron * (1 - saveRate));
        const actualCopper = Math.round(cost.copper * (1 - saveRate));

        // RemoteMaterial 激活时显示仓库+背包，否则仅背包
        const remoteMaterial = ps?.remoteMaterialEnabled ?? false;
        const woodNow = remoteMaterial ? PlayerData.getTotalWood() : (data?.woodCount ?? 0);
        const ironNow = remoteMaterial ? PlayerData.getTotalIron() : (data?.ironCount ?? 0);
        const copperNow = remoteMaterial ? PlayerData.getTotalCopper() : (data?.copperCount ?? 0);

        this.setCostChildValue(costDisplay, 'CostWood', `${woodNow}/${actualWood}`, woodNow >= actualWood);
        this.setCostChildValue(costDisplay, 'CostIron', `${ironNow}/${actualIron}`, ironNow >= actualIron);
        this.setCostChildValue(costDisplay, 'CostCopper', `${copperNow}/${actualCopper}`, copperNow >= actualCopper);

        if (isGenerator) {
            // 发电机：显示发电量，始终白色
            this.setCostChildValue(powerParent, 'CostPower', `${powerValue}`, true);
        } else {
            // 集装箱：应用省电率，显示单数字耗电量，不足时变红
            const powerSave = ps ? ps.powerSaveRate : 0;
            const actualPower = powerValue - Math.round(powerValue * powerSave);
            const gen = BaseSystem.instance ? BaseSystem.instance.totalPowerGen : 0;
            this.setCostChildValue(powerParent, 'CostPower', `${actualPower}`, gen >= actualPower);
        }
    }

    /** 设置 CostDisplay 下某个子节点的 Value Label，含颜色反馈 */
    private setCostChildValue(costDisplay: Node, childName: string, text: string, affordable: boolean = true) {
        const costNode = costDisplay.getChildByName(childName);
        if (!costNode) {
            const childrenNames = costDisplay.children.map(c => c.name).join(', ');
            log(`[BuildPanelUI] setCostChildValue: CostDisplay 下未找到 ${childName}，父节点=${costDisplay.name}，子节点列表=[${childrenNames}]`);
            return;
        }
        const valueNode = costNode.getChildByName('Value');
        if (!valueNode) {
            log(`[BuildPanelUI] setCostChildValue: ${costNode.name} 下未找到 Value 子节点`);
            return;
        }
        const label = valueNode.getComponent(Label);
        if (!label) {
            log(`[BuildPanelUI] setCostChildValue: Value 节点上无 Label 组件`);
            return;
        }
        label.string = text;
        label.color = affordable
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);
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
        if (button?.node?.isValid) {
            button.node.off(Button.EventType.CLICK, handler, this);
        }
    }
}