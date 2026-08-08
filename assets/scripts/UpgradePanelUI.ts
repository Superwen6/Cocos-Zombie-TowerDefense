import { _decorator, Button, Component, Node, Prefab, warn } from 'cc';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { BaseSystem } from './BaseSystem';
import { BuildPanelUI } from './BuildPanelUI';
import { GlobalContainerStorage } from './GlobalContainerStorage';

const { ccclass, property } = _decorator;

/**
 * 升级面板 UI（UpgradePanel）。
 * 挂载在 Canvas/UpgradePanel 节点上，处理集装箱按钮的点击建造逻辑。
 * 炮塔和发电机的按钮由各自的 PanelUI 脚本处理。
 */
@ccclass('UpgradePanelUI')
export class UpgradePanelUI extends Component {
    @property({ type: Prefab, tooltip: '集装箱预制体（container.prefab）' })
    containerPrefab: Prefab | null = null;

    onLoad() {
        this.bindContainerButton();
    }

    /** 通过节点名称查找集装箱按钮并绑定点击事件 */
    private bindContainerButton() {
        const btnNode = this.node.getChildByName('container');
        if (!btnNode) {
            warn('[UpgradePanelUI] 未找到名为 "container" 的子节点，集装箱按钮绑定跳过');
            return;
        }

        const btn = btnNode.getComponent(Button);
        if (!btn) {
            warn('[UpgradePanelUI] "container" 节点上无 Button 组件');
            return;
        }

        btn.clickEvents = [];
        btn.interactable = true;
        btnNode.on(Button.EventType.CLICK, this.onContainerClick, this);
    }

    /** 集装箱按钮点击：读取预制体消耗 → 检查资源 → 扣资源 → 进入放置模式 */
    private onContainerClick() {
        const manager = TurretPlacementManager.instance;
        if (!manager) {
            warn('[UpgradePanelUI] TurretPlacementManager 未初始化');
            return;
        }

        if (!this.containerPrefab) {
            warn('[UpgradePanelUI] 集装箱预制体 containerPrefab 未绑定');
            return;
        }

        // 检查电力
        if (BaseSystem.instance?.isPowerOutage) {
            warn('[UpgradePanelUI] 电力不足，无法建造集装箱');
            const buildPanel = this.getComponent(BuildPanelUI);
            if (buildPanel) {
                buildPanel.showWarning('电力不足，无法建造集装箱');
            }
            return;
        }

        const cost: TurretPlacementCost = manager.getCostsFromPrefab(this.containerPrefab);

        // 应用省材料率
        const ps = PlayerState.instance;
        const saveRate = ps ? ps.materialSaveRate : 0;
        const actualCost: TurretPlacementCost = {
            wood: Math.round(cost.wood * (1 - saveRate)),
            copper: Math.round(cost.copper * (1 - saveRate)),
            iron: Math.round(cost.iron * (1 - saveRate)),
            money: cost.money,
        };

        // 检查资源（RemoteMaterial 感知）
        if (!PlayerData.canAffordWithWarehouse(actualCost.wood, actualCost.copper, actualCost.iron, actualCost.money)) {
            warn(`[UpgradePanelUI] 资源不足 | 木${actualCost.wood} 铜${actualCost.copper} 铁${actualCost.iron} 金${actualCost.money}`);
            return;
        }

        // 关闭面板
        this.hidePanel();

        // 进入集装箱放置模式（资源在确认放置时扣除，取消时无需退还）
        manager.startContainerPlacement(this.containerPrefab, actualCost);
    }

    /** 关闭 UpgradePanel（通过 BuildPanelUI.hidePanel 避免直接 deactivate 宿主节点） */
    hidePanel() {
        const buildPanel = this.getComponent(BuildPanelUI);
        if (buildPanel) {
            buildPanel.hidePanel();
        }
    }
}