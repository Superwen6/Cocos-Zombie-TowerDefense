import { _decorator, Button, Color, Component, instantiate, Label, log, Node, warn } from 'cc';
import { PlayerData } from './PlayerData';
import { TurretPlacementManager } from './TurretPlacementManager';
import { BaseSystem } from './BaseSystem';
import { Turret } from './Turret';

const { ccclass, property } = _decorator;

@ccclass('TurretBuildPanelUI')
export class TurretBuildPanelUI extends Component {

    @property(Node)
    turretPanel: Node | null = null;

    @property(Node)
    btnOpenTurretNode: Node | null = null;

    @property(Node)
    btnClosePanelNode: Node | null = null;

    @property(Node)
    btnBuildTurretNode: Node | null = null;

    @property({ type: Label, tooltip: '物资消耗文本' })
    costLabel: Label | null = null;

    /** 各炮塔按钮下的 CostDisplay 节点（按顺序对应 TurretPlacementManager.turretPrefabs） */
    @property({ type: [Node], tooltip: '各炮塔的 CostDisplay 节点（按顺序拖入 LV1~LV5 下的 CostDisplay）' })
    turretCostDisplays: Node[] = [];

    /** 各炮塔按钮下的 PowerCost 节点（按顺序对应 TurretPlacementManager.turretPrefabs） */
    @property({ type: [Node], tooltip: '各炮塔的 CostPower 节点（按顺序拖入 LV1~LV5 下的 CostPower）' })
    turretPowerCosts: Node[] = [];

    /** 从 TurretPlacementManager 读取实时消耗 */
    private getCosts() {
        const manager = TurretPlacementManager.instance;
        if (manager) {
            const c = manager.getTurretCosts();
            return { wood: c.wood, iron: c.iron, copper: c.copper, money: c.money };
        }
        return { wood: 0, iron: 2, copper: 0, money: 5 };
    }

    onLoad() {
        this.bindOpenButton();
        this.bindCloseButton();
        this.bindBuildButton();
    }

    start() {
        this.updateCostDisplay();
        this.refreshTurretCostDisplays();
    }

    // ---------- 资源检测 ----------

    private checkResources(): boolean {
        const data = PlayerData.instance;
        if (!data) {
            warn('[TurretBuildPanelUI] PlayerData 未初始化');
            return false;
        }
        const cost = this.getCosts();
        return data.ironCount >= cost.iron
            && data.woodCount >= cost.wood
            && data.copperCount >= cost.copper
            && data.money >= cost.money;
    }

    // ---------- 更新物资显示（旧版单行） ----------

    private updateCostDisplay() {
        if (!this.costLabel) return;

        const data = PlayerData.instance;
        const cost = this.getCosts();

        const ironNow = data?.ironCount ?? 0;
        const woodNow = data?.woodCount ?? 0;
        const copperNow = data?.copperCount ?? 0;
        const moneyNow = data?.money ?? 0;

        const canAfford = ironNow >= cost.iron
            && woodNow >= cost.wood
            && copperNow >= cost.copper
            && moneyNow >= cost.money;

        const parts: string[] = [];
        if (cost.iron > 0) parts.push(`铁矿: ${ironNow}/${cost.iron}`);
        if (cost.wood > 0) parts.push(`木头: ${woodNow}/${cost.wood}`);
        if (cost.copper > 0) parts.push(`铜矿: ${copperNow}/${cost.copper}`);
        if (cost.money > 0) parts.push(`金币: ${moneyNow}/${cost.money}`);

        this.costLabel.string = parts.join('  |  ') || '免费建造';
        this.costLabel.color = canAfford
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);
    }

    // ---------- 设置 CostDisplay 下某个 CostChild 的 Value Label ----------

    private setCostChildValue(costDisplay: Node, childName: string, text: string, sufficient: boolean) {
        const child = costDisplay.getChildByName(childName);
        if (!child) return;
        const valueNode = child.getChildByName('Value');
        if (!valueNode) return;
        const label = valueNode.getComponent(Label);
        if (!label) return;
        label.string = text;
        label.color = sufficient ? Color.WHITE : Color.RED;
    }

    /** 刷新所有炮塔按钮的资源消耗和电力显示 */
    private refreshTurretCostDisplays() {
        const manager = TurretPlacementManager.instance;
        if (!manager) return;

        const data = PlayerData.instance;
        const base = BaseSystem.instance;
        const gen = base ? base.totalPowerGen : 0;

        const prefabCount = manager.turretPrefabs.length;
        const displayCount = Math.min(this.turretCostDisplays.length, prefabCount);

        for (let i = 0; i < displayCount; i++) {
            const prefab = manager.turretPrefabs[i];
            const costDisplay = this.turretCostDisplays[i];
            const powerCost = this.turretPowerCosts[i];

            if (!costDisplay || !prefab) continue;

            // 从预制体读取消耗
            const tempNode = instantiate(prefab);
            const turret = tempNode.getComponent(Turret);
            const wood = turret ? (turret.costWood ?? 0) : 0;
            const iron = turret ? (turret.costIron ?? 0) : 0;
            const copper = turret ? (turret.costCopper ?? 0) : 0;
            const power = turret ? (turret.powerCost ?? 0) : 0;
            tempNode.destroy();

            // 更新资源消耗
            const woodNow = data?.woodCount ?? 0;
            const ironNow = data?.ironCount ?? 0;
            const copperNow = data?.copperCount ?? 0;

            this.setCostChildValue(costDisplay, 'CostWood', `${wood}`, woodNow >= wood);
            this.setCostChildValue(costDisplay, 'CostIron', `${iron}`, ironNow >= iron);
            this.setCostChildValue(costDisplay, 'CostCopper', `${copper}`, copperNow >= copper);

            // 更新电力消耗
            if (powerCost) {
                const valueNode = powerCost.getChildByName('Value');
                if (valueNode) {
                    const label = valueNode.getComponent(Label);
                    if (label) {
                        label.string = `${power}`;
                        label.color = gen >= power ? Color.WHITE : Color.RED;
                    }
                }
            }
        }
    }

    // ---------- 按钮绑定 ----------

    private bindOpenButton() {
        if (!this.btnOpenTurretNode) {
            warn('[TurretBuildPanelUI] btnOpenTurretNode 未绑定');
            return;
        }
        const btn = this.btnOpenTurretNode.getComponent(Button);
        if (!btn) {
            warn('[TurretBuildPanelUI] btnOpenTurretNode 上无 Button 组件');
            return;
        }
        btn.clickEvents = [];
        this.btnOpenTurretNode.on(Button.EventType.CLICK, () => {
            if (this.turretPanel) {
                this.turretPanel.active = true;
            }
            this.updateCostDisplay();
            this.refreshTurretCostDisplays();
        }, this);
    }

    private bindCloseButton() {
        if (!this.btnClosePanelNode) {
            warn('[TurretBuildPanelUI] btnClosePanelNode 未绑定');
            return;
        }
        const btn = this.btnClosePanelNode.getComponent(Button);
        if (!btn) {
            warn('[TurretBuildPanelUI] btnClosePanelNode 上无 Button 组件');
            return;
        }
        btn.clickEvents = [];
        this.btnClosePanelNode.on(Button.EventType.CLICK, () => {
            if (this.turretPanel) {
                this.turretPanel.active = false;
            }
        }, this);
    }

    private bindBuildButton() {
        if (!this.btnBuildTurretNode) {
            warn('[TurretBuildPanelUI] btnBuildTurretNode 未绑定');
            return;
        }
        const btn = this.btnBuildTurretNode.getComponent(Button);
        if (!btn) {
            warn('[TurretBuildPanelUI] btnBuildTurretNode 上无 Button 组件');
            return;
        }
        btn.clickEvents = [];
        this.btnBuildTurretNode.on(Button.EventType.CLICK, this.onBuildButtonClick, this);
    }

    // ---------- 公开方法 ----------

    buildBaseTurret() {
        this.updateCostDisplay();
        this.beginPlacement();
    }

    showPanel() {
        if (this.turretPanel) {
            this.turretPanel.active = true;
        }
        this.updateCostDisplay();
        this.refreshTurretCostDisplays();
    }

    hidePanel() {
        if (this.turretPanel) {
            this.turretPanel.active = false;
        }
    }

    onBuildButtonClick() {
        if (!this.checkResources()) {
            const cost = this.getCosts();
            warn(`[TurretBuildPanelUI] 资源不足 | 铁矿:${cost.iron} 木头:${cost.wood} 铜矿:${cost.copper} 金币:${cost.money}`);
            this.updateCostDisplay();
            return;
        }

        this.updateCostDisplay();
        this.beginPlacement();
    }

    private beginPlacement() {
        const manager = TurretPlacementManager.instance;
        if (!manager) {
            warn('[TurretBuildPanelUI] TurretPlacementManager 未初始化');
            return;
        }

        const cost = manager.getTurretCosts();
        if (!cost) {
            warn('[TurretBuildPanelUI] 无法读取炮塔消耗');
            return;
        }

        const data = PlayerData.instance;
        if (!data) {
            warn('[TurretBuildPanelUI] PlayerData 未初始化');
            return;
        }
        if (!data.canAfford(cost.wood, cost.copper, cost.iron, cost.money)) {
            warn(`[TurretBuildPanelUI] 资源不足 | 木${cost.wood} 铜${cost.copper} 铁${cost.iron} 金${cost.money}`);
            return;
        }

        log('[TurretBuildPanelUI] 资源校验通过，进入放置模式');
        manager.startPlacement(cost, this);
        this.hidePanel();
    }

    showPanelAfterCancel() {
        this.showPanel();
    }
}