import { _decorator, Button, Component, Node, Prefab, warn } from 'cc';
import { TurretPlacementManager, TurretPlacementCost } from './TurretPlacementManager';
import { PlayerData } from './PlayerData';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

/**
 * 升级面板 UI（UpgradePanel）。
 * 挂载在 Canvas/UpgradePanel 节点上，处理集装箱按钮的点击建造逻辑。
 * 炮塔和发电机的按钮由各自的 PanelUI 脚本处理。
 */
@ccclass('UpgradePanelUI')
export class UpgradePanelUI extends Component {
    @property({ type: Node, tooltip: 'UpgradePanel 面板根节点，点击按钮后关闭' })
    panelRoot: Node | null = null;

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
            return;
        }

        const cost: TurretPlacementCost = manager.getCostsFromPrefab(this.containerPrefab);

        // 检查资源
        const data = PlayerData.instance;
        if (!data || !data.canAfford(cost.wood, cost.copper, cost.iron, cost.money)) {
            warn(`[UpgradePanelUI] 资源不足 | 木${cost.wood} 铜${cost.copper} 铁${cost.iron} 金${cost.money}`);
            return;
        }

        // 扣除资源
        data.spendUpgradeCost(cost.wood, cost.copper, cost.iron, cost.money);

        // 关闭面板
        this.hidePanel();

        // 进入集装箱放置模式
        manager.startContainerPlacement(this.containerPrefab, cost);
    }

    /** 关闭 UpgradePanel */
    hidePanel() {
        if (this.panelRoot) {
            this.panelRoot.active = false;
        }
    }
}