import { _decorator, Button, Component, Node, Prefab, warn } from 'cc';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { PlantGenerator } from './PlantGenerator';

const { ccclass, property } = _decorator;

/**
 * 发电机建造面板 UI。
 * 挂载在 Canvas/UpgradePanel 下，处理 4 个发电机按钮的点击建造逻辑。
 * 实现顺序解锁：放置 ID=N 后，ID=N+1 的按钮才激活。
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
        tooltip: '发电机预制体数组（与按钮索引一一对应）',
    })
    plantPrefabs: Prefab[] = [];

    onLoad() {
        for (let i = 0; i < this.plantBtnNodes.length; i++) {
            this.bindPlantButton(i);
        }
        // 注册发电机放置回调，用于刷新按钮解锁状态
        PlantGenerator.onPlacedCallbacks.push(() => this.refreshButtonStates());
    }

    start() {
        this.refreshButtonStates();
    }

    /** 刷新按钮状态：只有前置发电机已放置，当前按钮才可交互 */
    refreshButtonStates() {
        // plantId = index + 1
        for (let i = 0; i < this.plantBtnNodes.length; i++) {
            const node = this.plantBtnNodes[i];
            if (!node) continue;
            const plantId = i + 1;
            if (plantId === 1) {
                // ID=1 始终可用
                node.active = true;
            } else {
                // ID=N 需要 ID=N-1 已放置
                const prevPlaced = PlantGenerator.isPlantPlaced(plantId - 1);
                node.active = prevPlaced;
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
        if (!prefab) {
            warn(`[PlantPanelUI] plantPrefabs[${index}] 未绑定预制体`);
            return;
        }

        const manager = TurretPlacementManager.instance;
        if (!manager) {
            warn('[PlantPanelUI] TurretPlacementManager 未初始化');
            return;
        }

        const cost: TurretPlacementCost = manager.getCostsFromPrefab(prefab);
        manager.startPlantPlacement(prefab, cost);

        // 关闭 UpgradePanel 面板，让玩家看到地图去放置虚影
        this.hidePanel();
    }

    /** 关闭 UpgradePanel */
    hidePanel() {
        if (this.panelRoot) {
            this.panelRoot.active = false;
        }
    }
}