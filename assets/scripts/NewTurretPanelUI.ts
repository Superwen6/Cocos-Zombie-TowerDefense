import { _decorator, Button, Color, Component, Label, Node, Prefab, warn } from 'cc';
import { PlayerData } from './PlayerData';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

/**
 * 2turret 建造面板 UI。
 * 完全参照 TurretBuildPanelUI 的按钮绑定和建造逻辑。
 */
@ccclass('NewTurretPanelUI')
export class NewTurretPanelUI extends Component {
    @property(Node)
    turretPanel: Node | null = null;

    @property(Node)
    btnBuildTurretNode: Node | null = null;

    @property(Node)
    btnClosePanelNode: Node | null = null;

    @property({ type: Label, tooltip: '物资消耗文本 costlabel2' })
    costLabel: Label | null = null;

    @property({ type: Node, tooltip: 'LV2 节点，基地等级>=2时显示' })
    lv2Node: Node | null = null;

    @property({ type: Prefab, tooltip: '2turret 预制体' })
    turret2Prefab: Prefab | null = null;

    // === 新增的 3 个高级炮塔 ===
    @property({ type: Node, tooltip: '双管炮塔按钮节点' })
    btnTurret3Node: Node | null = null;
    @property({ type: Label, tooltip: '双管炮塔消耗文本' })
    costLabel3: Label | null = null;
    @property({ type: Prefab, tooltip: '双管炮塔预制体' })
    turret3Prefab: Prefab | null = null;

    @property({ type: Node, tooltip: '重装炮塔按钮节点' })
    btnTurret4Node: Node | null = null;
    @property({ type: Label, tooltip: '重装炮塔消耗文本' })
    costLabel4: Label | null = null;
    @property({ type: Prefab, tooltip: '重装炮塔预制体' })
    turret4Prefab: Prefab | null = null;

    @property({ type: Node, tooltip: '镭射炮塔按钮节点' })
    btnTurret5Node: Node | null = null;
    @property({ type: Label, tooltip: '镭射炮塔消耗文本' })
    costLabel5: Label | null = null;
    @property({ type: Prefab, tooltip: '镭射炮塔预制体' })
    turret5Prefab: Prefab | null = null;

    onLoad() {
        this.bindCloseButton();
        this.bindBuildButton();
        this.bindBuildTurret3Button();
        this.bindBuildTurret4Button();
        this.bindBuildTurret5Button();
    }

    onEnable() {
        this.refreshLv2Visibility();
    }

    start() {
        this.refreshLv2Visibility();
        this.updateCostDisplay();
        this.updateCostDisplay3();
        this.updateCostDisplay4();
        this.updateCostDisplay5();
    }

    /** 根据基地等级刷新 LV2 节点可见性 */
    private refreshLv2Visibility() {
        if (!this.lv2Node) return;
        const level = BaseSystem.instance?.currentLevel ?? 1;
        this.lv2Node.active = level >= 2;
    }

    /** 从 turret2Prefab 读取建造消耗 */
    private getCosts(): TurretPlacementCost {
        const manager = TurretPlacementManager.instance;
        if (manager) {
            return manager.getCostsFromPrefab(this.turret2Prefab);
        }
        return { wood: 0, copper: 0, iron: 0, money: 0 };
    }

    private getCosts3(): TurretPlacementCost {
        const manager = TurretPlacementManager.instance;
        if (manager) return manager.getCostsFromPrefab(this.turret3Prefab);
        return { wood: 0, copper: 0, iron: 0, money: 0 };
    }

    private getCosts4(): TurretPlacementCost {
        const manager = TurretPlacementManager.instance;
        if (manager) return manager.getCostsFromPrefab(this.turret4Prefab);
        return { wood: 0, copper: 0, iron: 0, money: 0 };
    }

    private getCosts5(): TurretPlacementCost {
        const manager = TurretPlacementManager.instance;
        if (manager) return manager.getCostsFromPrefab(this.turret5Prefab);
        return { wood: 0, copper: 0, iron: 0, money: 0 };
    }

    // ---------- 资源检测 ----------

    private checkResources(): boolean {
        const data = PlayerData.instance;
        if (!data) {
            warn('[NewTurretPanelUI] PlayerData 未初始化');
            return false;
        }
        const cost = this.getCosts();
        return data.woodCount >= cost.wood
            && data.copperCount >= cost.copper
            && data.ironCount >= cost.iron
            && data.money >= cost.money;
    }

    private checkResources3(): boolean {
        const data = PlayerData.instance;
        if (!data) return false;
        const cost = this.getCosts3();
        return data.woodCount >= cost.wood && data.copperCount >= cost.copper
            && data.ironCount >= cost.iron && data.money >= cost.money;
    }

    private checkResources4(): boolean {
        const data = PlayerData.instance;
        if (!data) return false;
        const cost = this.getCosts4();
        return data.woodCount >= cost.wood && data.copperCount >= cost.copper
            && data.ironCount >= cost.iron && data.money >= cost.money;
    }

    private checkResources5(): boolean {
        const data = PlayerData.instance;
        if (!data) return false;
        const cost = this.getCosts5();
        return data.woodCount >= cost.wood && data.copperCount >= cost.copper
            && data.ironCount >= cost.iron && data.money >= cost.money;
    }

    // ---------- 物资显示 ----------

    private updateCostDisplay() {
        if (!this.costLabel) {
            warn('[NewTurretPanelUI] updateCostDisplay | costLabel 为 null');
            return;
        }

        const data = PlayerData.instance;
        const cost = this.getCosts();

        const woodNow = data?.woodCount ?? 0;
        const copperNow = data?.copperCount ?? 0;
        const ironNow = data?.ironCount ?? 0;
        const moneyNow = data?.money ?? 0;

        const canAfford = woodNow >= cost.wood
            && copperNow >= cost.copper
            && ironNow >= cost.iron
            && moneyNow >= cost.money;

        const parts: string[] = [];
        if (cost.wood > 0) parts.push(`木头: ${woodNow}/${cost.wood}`);
        if (cost.copper > 0) parts.push(`铜矿: ${copperNow}/${cost.copper}`);
        if (cost.iron > 0) parts.push(`铁矿: ${ironNow}/${cost.iron}`);
        if (cost.money > 0) parts.push(`金币: ${moneyNow}/${cost.money}`);

        this.costLabel.string = parts.join('  |  ') || '免费建造';
        this.costLabel.color = canAfford
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);
    }

    private updateCostDisplay3() {
        if (!this.costLabel3) return;
        const data = PlayerData.instance;
        const cost = this.getCosts3();
        const woodNow = data?.woodCount ?? 0;
        const copperNow = data?.copperCount ?? 0;
        const ironNow = data?.ironCount ?? 0;
        const moneyNow = data?.money ?? 0;
        const canAfford = woodNow >= cost.wood && copperNow >= cost.copper
            && ironNow >= cost.iron && moneyNow >= cost.money;
        const parts: string[] = [];
        if (cost.wood > 0) parts.push(`木头: ${woodNow}/${cost.wood}`);
        if (cost.copper > 0) parts.push(`铜矿: ${copperNow}/${cost.copper}`);
        if (cost.iron > 0) parts.push(`铁矿: ${ironNow}/${cost.iron}`);
        if (cost.money > 0) parts.push(`金币: ${moneyNow}/${cost.money}`);
        this.costLabel3.string = parts.join('  |  ') || '免费建造';
        this.costLabel3.color = canAfford ? new Color(255, 255, 255, 255) : new Color(255, 0, 0, 255);
    }

    private updateCostDisplay4() {
        if (!this.costLabel4) return;
        const data = PlayerData.instance;
        const cost = this.getCosts4();
        const woodNow = data?.woodCount ?? 0;
        const copperNow = data?.copperCount ?? 0;
        const ironNow = data?.ironCount ?? 0;
        const moneyNow = data?.money ?? 0;
        const canAfford = woodNow >= cost.wood && copperNow >= cost.copper
            && ironNow >= cost.iron && moneyNow >= cost.money;
        const parts: string[] = [];
        if (cost.wood > 0) parts.push(`木头: ${woodNow}/${cost.wood}`);
        if (cost.copper > 0) parts.push(`铜矿: ${copperNow}/${cost.copper}`);
        if (cost.iron > 0) parts.push(`铁矿: ${ironNow}/${cost.iron}`);
        if (cost.money > 0) parts.push(`金币: ${moneyNow}/${cost.money}`);
        this.costLabel4.string = parts.join('  |  ') || '免费建造';
        this.costLabel4.color = canAfford ? new Color(255, 255, 255, 255) : new Color(255, 0, 0, 255);
    }

    private updateCostDisplay5() {
        if (!this.costLabel5) return;
        const data = PlayerData.instance;
        const cost = this.getCosts5();
        const woodNow = data?.woodCount ?? 0;
        const copperNow = data?.copperCount ?? 0;
        const ironNow = data?.ironCount ?? 0;
        const moneyNow = data?.money ?? 0;
        const canAfford = woodNow >= cost.wood && copperNow >= cost.copper
            && ironNow >= cost.iron && moneyNow >= cost.money;
        const parts: string[] = [];
        if (cost.wood > 0) parts.push(`木头: ${woodNow}/${cost.wood}`);
        if (cost.copper > 0) parts.push(`铜矿: ${copperNow}/${cost.copper}`);
        if (cost.iron > 0) parts.push(`铁矿: ${ironNow}/${cost.iron}`);
        if (cost.money > 0) parts.push(`金币: ${moneyNow}/${cost.money}`);
        this.costLabel5.string = parts.join('  |  ') || '免费建造';
        this.costLabel5.color = canAfford ? new Color(255, 255, 255, 255) : new Color(255, 0, 0, 255);
    }

    // ---------- 按钮绑定（参照 TurretBuildPanelUI） ----------

    private bindCloseButton() {
        if (!this.btnClosePanelNode) {
            warn('[NewTurretPanelUI] btnClosePanelNode 未绑定');
            return;
        }
        const btn = this.btnClosePanelNode.getComponent(Button);
        if (!btn) {
            warn('[NewTurretPanelUI] btnClosePanelNode 上无 Button 组件');
            return;
        }
        btn.clickEvents = [];
        this.btnClosePanelNode.on(Button.EventType.CLICK, () => {
            this.hidePanel();
        }, this);
    }

    private bindBuildButton() {
        if (!this.btnBuildTurretNode) {
            warn('[NewTurretPanelUI] btnBuildTurretNode 未绑定');
            return;
        }
        const btn = this.btnBuildTurretNode.getComponent(Button);
        if (!btn) {
            warn('[NewTurretPanelUI] btnBuildTurretNode 上无 Button 组件');
            return;
        }
        btn.clickEvents = [];
        btn.interactable = true;
        this.btnBuildTurretNode.on(Button.EventType.CLICK, this.onBuildClick, this);
    }

    private bindBuildTurret3Button() {
        if (!this.btnTurret3Node) return;
        const btn = this.btnTurret3Node.getComponent(Button);
        if (!btn) return;
        btn.clickEvents = [];
        btn.interactable = true;
        this.btnTurret3Node.on(Button.EventType.CLICK, this.onBuildTurret3Click, this);
    }

    private bindBuildTurret4Button() {
        if (!this.btnTurret4Node) return;
        const btn = this.btnTurret4Node.getComponent(Button);
        if (!btn) return;
        btn.clickEvents = [];
        btn.interactable = true;
        this.btnTurret4Node.on(Button.EventType.CLICK, this.onBuildTurret4Click, this);
    }

    private bindBuildTurret5Button() {
        if (!this.btnTurret5Node) return;
        const btn = this.btnTurret5Node.getComponent(Button);
        if (!btn) return;
        btn.clickEvents = [];
        btn.interactable = true;
        this.btnTurret5Node.on(Button.EventType.CLICK, this.onBuildTurret5Click, this);
    }

    // ---------- 公开方法 ----------

    showPanel() {
        if (this.turretPanel) {
            this.turretPanel.active = true;
        }
        this.refreshLv2Visibility();
        this.updateCostDisplay();
        this.updateCostDisplay3();
        this.updateCostDisplay4();
        this.updateCostDisplay5();
    }

    hidePanel() {
        if (this.turretPanel) {
            this.turretPanel.active = false;
        }
    }

    /** 建造按钮点击（参照 TurretBuildPanelUI.onBuildButtonClick） */
    onBuildClick() {
        if (!this.turret2Prefab) {
            warn('[NewTurretPanelUI] turret2Prefab 未绑定');
            return;
        }

        if (!this.checkResources()) {
            const cost = this.getCosts();
            warn(`[NewTurretPanelUI] 资源不足 | 木头:${cost.wood} 铜矿:${cost.copper} 铁矿:${cost.iron} 金币:${cost.money}`);
            this.updateCostDisplay();
            return;
        }

        const manager = TurretPlacementManager.instance;
        if (!manager) {
            warn('[NewTurretPanelUI] TurretPlacementManager 未初始化');
            return;
        }

        const cost = this.getCosts();
        manager.startPlacementWithPrefab(this.turret2Prefab, cost, this);
        this.hidePanel();
    }

    onBuildTurret3Click() {
        if (!this.turret3Prefab) { warn('[NewTurretPanelUI] turret3Prefab 未绑定'); return; }
        if (!this.checkResources3()) {
            const cost = this.getCosts3();
            warn(`[NewTurretPanelUI] 双管炮塔 资源不足 | 木头:${cost.wood} 铜矿:${cost.copper} 铁矿:${cost.iron} 金币:${cost.money}`);
            this.updateCostDisplay3();
            return;
        }
        const manager = TurretPlacementManager.instance;
        if (!manager) return;
        const cost = this.getCosts3();
        manager.startPlacementWithPrefab(this.turret3Prefab, cost, this);
        this.hidePanel();
    }

    onBuildTurret4Click() {
        if (!this.turret4Prefab) { warn('[NewTurretPanelUI] turret4Prefab 未绑定'); return; }
        if (!this.checkResources4()) {
            const cost = this.getCosts4();
            warn(`[NewTurretPanelUI] 重装炮塔 资源不足 | 木头:${cost.wood} 铜矿:${cost.copper} 铁矿:${cost.iron} 金币:${cost.money}`);
            this.updateCostDisplay4();
            return;
        }
        const manager = TurretPlacementManager.instance;
        if (!manager) return;
        const cost = this.getCosts4();
        manager.startPlacementWithPrefab(this.turret4Prefab, cost, this);
        this.hidePanel();
    }

    onBuildTurret5Click() {
        if (!this.turret5Prefab) { warn('[NewTurretPanelUI] turret5Prefab 未绑定'); return; }
        if (!this.checkResources5()) {
            const cost = this.getCosts5();
            warn(`[NewTurretPanelUI] 镭射炮塔 资源不足 | 木头:${cost.wood} 铜矿:${cost.copper} 铁矿:${cost.iron} 金币:${cost.money}`);
            this.updateCostDisplay5();
            return;
        }
        const manager = TurretPlacementManager.instance;
        if (!manager) return;
        const cost = this.getCosts5();
        manager.startPlacementWithPrefab(this.turret5Prefab, cost, this);
        this.hidePanel();
    }
}