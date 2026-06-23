import { _decorator, Button, Color, Component, Label, Node, Prefab, warn } from 'cc';
import { PlayerData } from './PlayerData';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

/** 各炮塔中文名（用于日志） */
const TURRET_NAME: string[] = [
    '初级炮塔', '双管炮塔', '重型炮塔', '机枪炮塔',
    '迷彩双枪', '迷彩火焰', '伪装镭射', '镭射炮塔',
    '机械机枪', '机械重炮', '未来机甲', '未来重炮',
];

/**
 * 炮塔建造面板 UI（数组驱动，支持 12 种炮塔）。
 */
@ccclass('NewTurretPanelUI')
export class NewTurretPanelUI extends Component {
    @property(Node)
    turretPanel: Node | null = null;

    @property(Node)
    btnClosePanelNode: Node | null = null;

    // ── LV 层级节点（等级解锁用） ──
    @property({ type: Node, tooltip: 'LV1 节点，基地等级>=1时显示' })
    lv1Node: Node | null = null;
    @property({ type: Node, tooltip: 'LV2 节点，基地等级>=2时显示' })
    lv2Node: Node | null = null;
    @property({ type: Node, tooltip: 'LV3 节点，基地等级>=3时显示' })
    lv3Node: Node | null = null;
    @property({ type: Node, tooltip: 'LV4 节点，基地等级>=4时显示' })
    lv4Node: Node | null = null;
    @property({ type: Node, tooltip: 'LV5 节点，基地等级>=5时显示' })
    lv5Node: Node | null = null;

    // ── 12 个炮塔的按钮 / 预制体 / 消耗标签 ──
    @property({
        type: [Node],
        tooltip: '炮塔按钮节点数组 [0]初级 [1]双管 [2]重型 [3]机枪 [4]迷彩双枪 [5]迷彩火焰 [6]伪装镭射 [7]镭射 [8]机械机枪 [9]机械重炮 [10]未来机甲 [11]未来重炮',
    })
    turretBtnNodes: Node[] = [];

    @property({
        type: [Prefab],
        tooltip: '炮塔预制体数组（与按钮索引一一对应）',
    })
    turretPanelPrefabs: Prefab[] = [];

    @property({
        type: [Label],
        tooltip: '炮塔消耗文本数组（与按钮索引一一对应）',
    })
    turretCostLabels: Label[] = [];

    // ── 生命周期 ──

    onLoad() {
        this.bindCloseButton();
        for (let i = 0; i < this.turretBtnNodes.length; i++) {
            this.bindTurretButton(i);
        }
        this.registerBaseUpgradeCallback();
    }

    onEnable() {
        this.refreshAllLevelVisibility();
    }

    start() {
        this.refreshAllLevelVisibility();
        this.updateAllCostDisplays();
    }

    // ── 等级回调 ──

    private registerBaseUpgradeCallback() {
        const base = BaseSystem.instance;
        if (!base) return;
        base.onUpgradeCallbacks.push(() => this.refreshAllLevelVisibility());
    }

    refreshAllLevelVisibility() {
        const level = BaseSystem.instance?.currentLevel ?? 1;
        const levelNodes: (Node | null)[] = [this.lv1Node, this.lv2Node, this.lv3Node, this.lv4Node, this.lv5Node];
        for (let i = 0; i < levelNodes.length; i++) {
            const node = levelNodes[i];
            if (!node) continue;
            node.active = (i + 1) <= level;
        }
    }

    // ── 面板开关 ──

    showPanel() {
        if (this.turretPanel) {
            this.turretPanel.active = true;
        }
        this.refreshAllLevelVisibility();
        this.updateAllCostDisplays();
    }

    hidePanel() {
        if (this.turretPanel) {
            this.turretPanel.active = false;
        }
    }

    // ── 关闭按钮 ──

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

    // ── 炮塔按钮绑定 ──

    private bindTurretButton(index: number) {
        const node = this.turretBtnNodes[index];
        if (!node) {
            warn(`[NewTurretPanelUI] turretBtnNodes[${index}] 未绑定`);
            return;
        }
        const btn = node.getComponent(Button);
        if (!btn) {
            warn(`[NewTurretPanelUI] turretBtnNodes[${index}] 上无 Button 组件`);
            return;
        }
        btn.clickEvents = [];
        btn.interactable = true;
        node.on(Button.EventType.CLICK, () => this.onBuildClick(index), this);
    }

    // ── 消耗读取 ──

    private getCosts(index: number): TurretPlacementCost {
        const manager = TurretPlacementManager.instance;
        if (manager) {
            return manager.getCostsFromPrefab(this.turretPanelPrefabs[index]);
        }
        return { wood: 0, copper: 0, iron: 0, money: 0 };
    }

    // ── 资源检测 ──

    private checkResources(index: number): boolean {
        const data = PlayerData.instance;
        if (!data) {
            warn('[NewTurretPanelUI] PlayerData 未初始化');
            return false;
        }
        const cost = this.getCosts(index);
        return data.woodCount >= cost.wood
            && data.copperCount >= cost.copper
            && data.ironCount >= cost.iron
            && data.money >= cost.money;
    }

    // ── 消耗显示 ──

    private updateCostDisplay(index: number) {
        const label = this.turretCostLabels[index];
        if (!label) return;

        const data = PlayerData.instance;
        const cost = this.getCosts(index);

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

        label.string = parts.join('  |  ') || '免费建造';
        label.color = canAfford
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);
    }

    private updateAllCostDisplays() {
        for (let i = 0; i < Math.max(this.turretBtnNodes.length, this.turretCostLabels.length); i++) {
            this.updateCostDisplay(i);
        }
    }

    // ── 建造点击 ──

    onBuildClick(index: number) {
        const prefab = this.turretPanelPrefabs[index];
        if (!prefab) {
            warn(`[NewTurretPanelUI] turretPanelPrefabs[${index}]（${TURRET_NAME[index] || '?'}）未绑定预制体`);
            return;
        }

        if (!this.checkResources(index)) {
            const cost = this.getCosts(index);
            warn(`[NewTurretPanelUI] ${TURRET_NAME[index] || '?'} 资源不足 | 木头:${cost.wood} 铜矿:${cost.copper} 铁矿:${cost.iron} 金币:${cost.money}`);
            this.updateCostDisplay(index);
            return;
        }

        const manager = TurretPlacementManager.instance;
        if (!manager) {
            warn('[NewTurretPanelUI] TurretPlacementManager 未初始化');
            return;
        }

        const cost = this.getCosts(index);
        manager.startPlacementWithPrefab(prefab, cost, this);
        this.hidePanel();
    }
}