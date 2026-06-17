import { _decorator, Button, Color, Component, Label, log, Node, UITransform, warn } from 'cc';
import { PlayerData } from './PlayerData';
import { TurretPlacementManager } from './TurretPlacementManager';

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

    @property({ type: Label, tooltip: '物资消耗文本，在面板上创建任意位置的 Label 拖入即可' })
    costLabel: Label | null = null;

    /** 内部物资 Label 引用（兼容动态创建场景） */
    private _costLabel: Label | null = null;

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
        this.buildCostLabel();
        this.bindOpenButton();
        this.bindCloseButton();
        this.bindBuildButton();
    }

    start() {
        // 延迟到 start 确保 TurretPlacementManager 和 PlayerData 已就绪
        this.updateCostDisplay();
    }

    /** 获取实际使用的 _costLabel */
    private get activeCostLabel(): Label | null {
        if (this._costLabel?.isValid) return this._costLabel;
        if (this.costLabel?.isValid) return this.costLabel;
        return null;
    }

    private set activeCostLabel(value: Label | null) {
        this._costLabel = value;
    }

    // ---------- 自动构建 CostLabel 节点（回退方案） ----------

    private buildCostLabel() {
        if (this.costLabel?.isValid) {
            log('[TurretBuildPanelUI] 已绑定 CostLabel，跳过动态创建');
            return;
        }

        // CostLabel 应显示在炮塔面板上，而非 GameManagers
        const parent = this.turretPanel ?? this.node;
        log('[TurretBuildPanelUI] buildCostLabel | this.node=', this.node.name, '| turretPanel=', this.turretPanel?.name ?? 'null', '| 搜索父节点=', parent.name);

        let costNode = parent.getChildByName('CostLabel');
        log('[TurretBuildPanelUI] buildCostLabel | 在', parent.name, '下搜索 CostLabel，结果=', costNode ? '找到' : '未找到');

        if (costNode) {
            this._costLabel = costNode.getComponent(Label);
            log('[TurretBuildPanelUI] buildCostLabel | Label组件=', this._costLabel ? '获取成功' : '获取失败(null)');
            return;
        }

        // 动态创建节点
        log('[TurretBuildPanelUI] buildCostLabel | 开始动态创建 CostLabel 在', parent.name);
        costNode = new Node('CostLabel');
        costNode.setParent(parent);
        costNode.addComponent(UITransform).setContentSize(200, 40);
        this._costLabel = costNode.addComponent(Label);
        this._costLabel.fontSize = 18;
        costNode.setPosition(0, -55, 0);

        log('[TurretBuildPanelUI] CostLabel 已动态创建于', parent.name);
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

    // ---------- 更新物资显示 ----------

    private updateCostDisplay() {
        const label = this.activeCostLabel;
        if (!label) {
            warn('[TurretBuildPanelUI] updateCostDisplay | _costLabel 为 null，跳过更新');
            return;
        }

        const data = PlayerData.instance;
        const cost = this.getCosts();

        log('[TurretBuildPanelUI] updateCostDisplay | cost=', JSON.stringify(cost), '| PlayerData=', data ? '就绪' : 'null');

        // 即使 PlayerData 未就绪，也先显示消耗量
        const ironNow = data?.ironCount ?? 0;
        const woodNow = data?.woodCount ?? 0;
        const copperNow = data?.copperCount ?? 0;
        const moneyNow = data?.money ?? 0;

        const canAfford = ironNow >= cost.iron
            && woodNow >= cost.wood
            && copperNow >= cost.copper
            && moneyNow >= cost.money;

        // 格式：当前拥有 / 需要消耗
        const parts: string[] = [];
        if (cost.iron > 0) parts.push(`铁矿: ${ironNow}/${cost.iron}`);
        if (cost.wood > 0) parts.push(`木头: ${woodNow}/${cost.wood}`);
        if (cost.copper > 0) parts.push(`铜矿: ${copperNow}/${cost.copper}`);
        if (cost.money > 0) parts.push(`金币: ${moneyNow}/${cost.money}`);

        label.string = parts.join('  |  ') || '免费建造';
        label.color = canAfford
            ? new Color(255, 255, 255, 255)
            : new Color(255, 0, 0, 255);

        log('[TurretBuildPanelUI] updateCostDisplay | 最终显示文本=', label.string);
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
            // 打开面板时刷新物资显示
            this.updateCostDisplay();
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
    }

    hidePanel() {
        if (this.turretPanel) {
            this.turretPanel.active = false;
        }
    }

    onBuildButtonClick() {
        // 防御性校验：资源不足直接拦截
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