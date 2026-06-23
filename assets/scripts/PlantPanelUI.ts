import { _decorator, Button, Component, Node, Prefab, warn } from 'cc';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';

const { ccclass, property } = _decorator;

/**
 * 发电机建造面板 UI。
 * 挂载在 Canvas/UpgradePanel 下，处理 4 个发电机按钮的点击建造逻辑。
 */
@ccclass('PlantPanelUI')
export class PlantPanelUI extends Component {
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
    }
}