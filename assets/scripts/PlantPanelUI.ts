import { _decorator, Button, Component, Node, Prefab, warn } from 'cc';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { PlayerData } from './PlayerData';
import { PlantGenerator } from './PlantGenerator';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

/**
 * 发电机建造面板 UI。
 * 挂载在 Canvas/UpgradePanel 下，处理 4 个发电机按钮的点击建造逻辑。
 * 等级锁定：Lv.1 解锁 Firstplant，Lv.2 解锁 Secondplant，以此类推。
 * 按钮点击后直接扣除资源，在场景预置节点上生成虚影，再次点击确认建造。
 */
@ccclass('PlantPanelUI')
export class PlantPanelUI extends Component {
    @property({ type: Node, tooltip: 'UpgradePanel 面板根节点，点击按钮后关闭' })
    panelRoot: Node | null = null;

    @property({
        type: [Node],
        tooltip: '发电机按钮节点数组 [0]光伏板 [1]光伏矩阵 [2]燃料电机 [3]能源核心',
    })
    plantBtnNodes: Node[] = [];

    @property({
        type: [Prefab],
        tooltip: '发电机预制体数组（用于读取消耗和生成虚影，与按钮索引一一对应）',
    })
    plantPrefabs: Prefab[] = [];

    @property({
        type: [Node],
        tooltip: '场景中预置的发电机目标节点（Background 下，初始 active=false）[0]光伏板 [1]光伏矩阵 [2]燃料电机 [3]能源核心',
    })
    plantTargetNodes: Node[] = [];

    onLoad() {
        for (let i = 0; i < this.plantBtnNodes.length; i++) {
            this.bindPlantButton(i);
        }
        PlantGenerator.onPlacedCallbacks.push(this.refreshButtonStates.bind(this));
        BaseSystem.instance?.onUpgradeCallbacks.push(this.refreshButtonStates.bind(this));
    }

    start() {
        this.refreshButtonStates();
        // 兜底：确保 BaseSystem 升级回调已注册（onLoad 时 BaseSystem 可能尚未初始化）
        const baseSystem = BaseSystem.instance;
        if (baseSystem) {
            baseSystem.onUpgradeCallbacks.push(this.refreshButtonStates.bind(this));
        }
    }

    /** 刷新按钮状态：
     * - 显示条件：基地等级 >= plantId（已解锁的发电机按钮都显示）
     * - 可交互条件：基地等级 === plantId 且该发电机未放置
     */
    refreshButtonStates() {
        const baseSystem = BaseSystem.instance;
        const currentLevel = baseSystem ? baseSystem.currentLevel : 1;
        for (let i = 0; i < this.plantBtnNodes.length; i++) {
            const node = this.plantBtnNodes[i];
            if (!node) continue;
            const plantId = i + 1;
            const btn = node.getComponent(Button);
            
            // 按钮显示：基地等级 >= plantId
            const shouldShow = currentLevel >= plantId;
            node.active = shouldShow;
            
            if (btn) {
                // 按钮可交互：基地等级 === plantId 且未放置
                const canInteract = currentLevel === plantId && !PlantGenerator.isPlantPlaced(plantId);
                btn.interactable = canInteract;
            }
        }
    }

    private bindPlantButton(index: number) {
        const node = this.plantBtnNodes[index];
        if (!node) {
            warn(`[PlantPanelUI] plantBtnNodes[${index}] 未绑定`);
            return;
        }
        const btn = node.getComponent(Button);
        if (!btn) {
            warn(`[PlantPanelUI] plantBtnNodes[${index}] 上无 Button 组件`);
            return;
        }
        btn.clickEvents = [];
        btn.interactable = true;
        node.on(Button.EventType.CLICK, () => this.onPlantClick(index), this);
    }

    private onPlantClick(index: number) {
        const prefab = this.plantPrefabs[index];
        const targetNode = this.plantTargetNodes[index];
        if (!prefab || !targetNode) {
            warn(`[PlantPanelUI] plantPrefabs[${index}] 或 plantTargetNodes[${index}] 未绑定`);
            return;
        }

        const manager = TurretPlacementManager.instance;
        if (!manager) {
            warn('[PlantPanelUI] TurretPlacementManager 未初始化');
            return;
        }

        const cost: TurretPlacementCost = manager.getCostsFromPrefab(prefab);
        const plantId = index + 1;

        // 等级锁定：只有基地等级等于 plantId 时才能建造
        const baseSystem = BaseSystem.instance;
        if (!baseSystem || baseSystem.currentLevel !== plantId) {
            warn(`[PlantPanelUI] 当前基地等级不足，无法建造发电机 ID=${plantId}`);
            return;
        }

        // 检查资源
        const data = PlayerData.instance;
        if (!data || !data.canAfford(cost.wood, cost.copper, cost.iron, cost.money)) {
            warn(`[PlantPanelUI] 资源不足，无法建造发电机 ID=${plantId}`);
            return;
        }

        // 扣除资源
        data.spendUpgradeCost(cost.wood, cost.copper, cost.iron, cost.money);

        // 关闭面板
        this.hidePanel();

        // 进入固定节点放置模式：在 targetNode 位置生成虚影，等待确认
        manager.startPlantPlacementByNode(targetNode, prefab, cost, plantId);
    }

    /** 关闭 UpgradePanel */
    hidePanel() {
        if (this.panelRoot) {
            this.panelRoot.active = false;
        }
    }
}