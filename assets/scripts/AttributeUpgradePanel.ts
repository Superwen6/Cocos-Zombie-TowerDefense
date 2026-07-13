import { _decorator, Button, Color, Component, find, Label, Node, Sprite, warn } from 'cc';
import { PlayerState } from './PlayerState';

const { ccclass, property } = _decorator;

/** 按钮升级状态 */
interface UpgradeState {
    node: Node;
    level: number;
    maxLevel: number;
}

/** 锁定颜色：灰色 */
const LOCKED_COLOR = new Color(128, 128, 128, 255);
/** 完成颜色：金色 */
const COMPLETED_COLOR = new Color(255, 215, 0, 255);

/** 升级依赖链：点击某个按钮后，哪些按钮的视觉状态需要刷新 */
const AFFECTED_BUTTONS: Record<string, string[]> = {
    Walkspeed: ['Walkspeed', 'FatigueReduce', 'WoodCollect'],
    FatigueReduce: ['FatigueReduce', 'HPIncrease'],
    WoodCollect: ['WoodCollect', 'CopperCollect'],
    CopperCollect: ['CopperCollect', 'IronCollect'],
    IronCollect: ['IronCollect', 'Stealth'],
    HPIncrease: ['HPIncrease'],
    Stealth: ['Stealth'],
};

/**
 * 属性升级面板 UI。
 * 挂载在 Canvas/AttributeUpgradePanel 节点上。
 * 处理面板打开/关闭、选项卡切换、属性升级逻辑。
 */
@ccclass('AttributeUpgradePanel')
export class AttributeUpgradePanel extends Component {
    // ---- 面板通用 ----
    @property({ type: Button, tooltip: '面板右上角：关闭按钮' })
    closeButton: Button | null = null;

    @property({ type: Node, tooltip: '生存选项卡按钮' })
    tabSurvival: Node | null = null;

    @property({ type: Node, tooltip: '工程选项卡按钮' })
    tabEngineering: Node | null = null;

    @property({ type: Node, tooltip: '武器选项卡按钮' })
    tabWeapon: Node | null = null;

    @property({ type: Node, tooltip: '生存内容区' })
    survivalContent: Node | null = null;

    @property({ type: Node, tooltip: '工程内容区' })
    engineeringContent: Node | null = null;

    @property({ type: Node, tooltip: '武器内容区' })
    weaponContent: Node | null = null;

    // ---- 生存选项卡按钮 ----
    @property({ type: Node, tooltip: '行走速度升级按钮' })
    walkspeedButton: Node | null = null;

    @property({ type: Node, tooltip: '疲劳减缓升级按钮' })
    fatigueReduceButton: Node | null = null;

    @property({ type: Node, tooltip: '血量提升升级按钮' })
    hpIncreaseButton: Node | null = null;

    @property({ type: Node, tooltip: '木材采集升级按钮' })
    woodCollectButton: Node | null = null;

    @property({ type: Node, tooltip: '铜矿采集升级按钮' })
    copperCollectButton: Node | null = null;

    @property({ type: Node, tooltip: '铁矿采集升级按钮' })
    ironCollectButton: Node | null = null;

    @property({ type: Node, tooltip: '潜行升级按钮' })
    stealthButton: Node | null = null;

    @property({ type: Label, tooltip: '升级点数显示文本' })
    pointNumberLabel: Label | null = null;

    private _panelVisible = false;
    private static _openPanelBound = false;
    private static _pendingOpen = false;

    /** 生存按钮状态 Map */
    private _upgradeStates: Map<string, UpgradeState> = new Map();
    /** 每个按钮子树中所有 Sprite 的原始颜色（用于解锁时恢复） */
    private _originalColors: Map<Node, Color> = new Map();

    start() {
        this.bindCloseButton();
        this.initSurvivalUpgrades();

        if (AttributeUpgradePanel._pendingOpen) {
            AttributeUpgradePanel._pendingOpen = false;
            this.showPanel();
        } else {
            this.hidePanel();
        }
    }

    onDestroy() {
        if (this.closeButton?.node.isValid) {
            this.closeButton.node.off(Button.EventType.CLICK, this.hidePanel, this);
        }
        this.unbindSurvivalButtons();
    }

    // ==================== 面板显示/隐藏 ====================

    /** 显示属性升级面板 */
    showPanel() {
        this._panelVisible = true;
        this.setHostPanelVisible(true);
        this.refreshPointDisplay();
        this.refreshSurvivalButtons();
    }

    /** 隐藏属性升级面板 */
    hidePanel() {
        this._panelVisible = false;
        this.setHostPanelVisible(false);
    }

    /** 查询面板是否可见 */
    public isPanelVisible(): boolean {
        return this._panelVisible;
    }

    /**
     * 确保打开面板按钮的点击事件已绑定。
     * 从 GameHUDUI 等始终激活的组件的 start() 中调用。
     */
    public static ensureOpenPanelBinding() {
        if (AttributeUpgradePanel._openPanelBound) return;
        AttributeUpgradePanel._openPanelBound = true;

        const panelNode = find('Canvas/AttributeUpgradePanel');
        if (!panelNode) {
            warn('[AttributeUpgradePanel] 找不到 Canvas/AttributeUpgradePanel');
            return;
        }
        const panel = panelNode.getComponent(AttributeUpgradePanel);
        if (!panel) {
            warn('[AttributeUpgradePanel] AttributeUpgradePanel 节点上无 AttributeUpgradePanel 组件');
            return;
        }

        const btnNode = find('Canvas/Btn_OpenAttribute');
        if (!btnNode) {
            warn('[AttributeUpgradePanel] 找不到 Canvas/Btn_OpenAttribute');
            return;
        }
        const btn = btnNode.getComponent(Button);
        if (!btn) {
            warn('[AttributeUpgradePanel] Btn_OpenAttribute 上无 Button 组件');
            return;
        }

        btn.node.on(Button.EventType.CLICK, () => {
            if (!panelNode.active) {
                AttributeUpgradePanel._pendingOpen = true;
                panelNode.active = true;
            } else {
                panel.showPanel();
            }
        }, panel);
    }

    /** 绑定关闭按钮 */
    private bindCloseButton() {
        if (!this.closeButton) {
            warn('[AttributeUpgradePanel] closeButton 未绑定');
            return;
        }
        this.closeButton.node.on(Button.EventType.CLICK, this.hidePanel, this);
    }

    /**
     * 隐藏/显示面板：隐藏子节点 + 禁用宿主节点 Sprite，不 deactivate 宿主节点。
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

    // ==================== 生存选项卡升级逻辑 ====================

    /** 初始化所有生存按钮的升级状态和点击事件 */
    private initSurvivalUpgrades() {
        this.registerUpgrade('Walkspeed', this.walkspeedButton || this.findButtonInSurvival('Walkspeed'), 2);
        this.registerUpgrade('FatigueReduce', this.fatigueReduceButton || this.findButtonInSurvival('FatigueReduce'), 2);
        this.registerUpgrade('HPIncrease', this.hpIncreaseButton || this.findButtonInSurvival('HPIncrease'), 3);
        this.registerUpgrade('WoodCollect', this.woodCollectButton || this.findButtonInSurvival('WoodCollect'), 3);
        this.registerUpgrade('CopperCollect', this.copperCollectButton || this.findButtonInSurvival('CopperCollect'), 3);
        this.registerUpgrade('IronCollect', this.ironCollectButton || this.findButtonInSurvival('IronCollect'), 3);
        this.registerUpgrade('Stealth', this.stealthButton || this.findButtonInSurvival('Stealth'), 1);
    }

    /** 递归在 survivalContent 子树中查找指定名称的节点 */
    private findButtonInSurvival(name: string): Node | null {
        if (!this.survivalContent) return null;
        return this.findNodeByName(this.survivalContent, name);
    }

    private findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this.findNodeByName(child, name);
            if (found) return found;
        }
        return null;
    }

    /** 注册单个升级按钮 */
    private registerUpgrade(name: string, node: Node | null, maxLevel: number) {
        if (!node) return;
        const state: UpgradeState = { node, level: 0, maxLevel };
        this._upgradeStates.set(name, state);

        // 保存按钮子树中所有 Sprite 的原始颜色
        this.saveOriginalColors(node);

        const btn = node.getComponent(Button);
        if (btn) {
            btn.node.on(Button.EventType.CLICK, () => this.onUpgradeClick(name), this);
        }
    }

    /** 递归保存节点子树中所有 Sprite 的原始颜色 */
    private saveOriginalColors(node: Node) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            this._originalColors.set(node, sprite.color.clone());
        }
        for (const child of node.children) {
            this.saveOriginalColors(child);
        }
    }

    /** 检查按钮是否已解锁 */
    private isUnlocked(name: string): boolean {
        const state = this._upgradeStates.get(name);
        if (!state) return false;
        if (state.level >= state.maxLevel) return false; // 已满级不可再点

        switch (name) {
            case 'Walkspeed':
                return true; // 初始即解锁
            case 'FatigueReduce':
            case 'WoodCollect':
                return this.getLevel('Walkspeed') >= 2;
            case 'HPIncrease':
                return this.getLevel('FatigueReduce') >= 2;
            case 'CopperCollect':
                return this.getLevel('WoodCollect') >= 3;
            case 'IronCollect':
                return this.getLevel('CopperCollect') >= 3;
            case 'Stealth':
                return this.getLevel('IronCollect') >= 3;
            default:
                return false;
        }
    }

    /** 获取按钮当前等级 */
    private getLevel(name: string): number {
        return this._upgradeStates.get(name)?.level ?? 0;
    }

    /** 升级按钮点击处理 */
    private onUpgradeClick(name: string) {
        const state = this._upgradeStates.get(name);
        if (!state) return;
        if (!this.isUnlocked(name)) return;
        if (state.level >= state.maxLevel) return;

        const ps = PlayerState.instance;
        if (!ps) {
            warn('[AttributeUpgradePanel] PlayerState 实例不存在');
            return;
        }
        if (ps.upgradePoints <= 0) {
            warn(`[AttributeUpgradePanel] 升级点数不足，无法升级 ${name}`);
            return;
        }

        ps.upgradePoints--;
        this.refreshPointDisplay();
        state.level++;
        this.applyUpgradeEffect(name, state.level);
        this.refreshAffectedButtons(name);
    }

    /** 应用升级效果（实际游戏数值修改） */
    private applyUpgradeEffect(name: string, level: number) {
        const ps = PlayerState.instance;
        if (!ps) return;

        switch (name) {
            case 'Walkspeed':
                // Lv1: +30%, Lv2: +50%
                ps.walkSpeedMultiplier = level === 1 ? 1.3 : 1.5;
                break;
            case 'FatigueReduce':
                // Lv1: -15%, Lv2: -30%（倍率越低疲劳越慢）
                ps.fatigueGainMultiplier = level === 1 ? 0.85 : 0.70;
                break;
            case 'HPIncrease':
                // Lv1: +50%, Lv2: +100%, Lv3: +200%
                ps.hpMultiplier = [1.5, 2.0, 3.0][level - 1];
                // 升级时回满血到新上限
                ps.hp = ps.getEffectiveMaxHp();
                break;
            case 'WoodCollect':
                // Lv1: 2x, Lv2: 3x, Lv3: 4x
                ps.woodCollectMultiplier = level + 1;
                break;
            case 'CopperCollect':
                ps.copperCollectMultiplier = level + 1;
                break;
            case 'IronCollect':
                ps.ironCollectMultiplier = level + 1;
                break;
            case 'Stealth':
                // 僵尸检测距离 → 1/5
                PlayerState.zombieAlertRadiusMultiplier = 0.2;
                break;
        }
    }

    /** 刷新升级点数显示 */
    private refreshPointDisplay() {
        if (!this.pointNumberLabel) return;
        const ps = PlayerState.instance;
        const points = ps ? ps.upgradePoints : 0;
        this.pointNumberLabel.string = `${points}`;
    }

    /** 刷新所有生存按钮的视觉状态（面板打开时全量刷新） */
    private refreshSurvivalButtons() {
        for (const [name, state] of this._upgradeStates) {
            this.updateButtonVisual(name, state);
        }
    }

    /** 只刷新受影响的按钮（点击升级时） */
    private refreshAffectedButtons(clickedName: string) {
        const affected = AFFECTED_BUTTONS[clickedName] || [clickedName];
        for (const name of affected) {
            const state = this._upgradeStates.get(name);
            if (state) {
                this.updateButtonVisual(name, state);
            }
        }
    }

    /** 更新单个按钮的视觉状态 */
    private updateButtonVisual(name: string, state: UpgradeState) {
        const btn = state.node.getComponent(Button);

        if (state.level >= state.maxLevel) {
            if (btn) btn.interactable = false;
            this.setSubtreeColor(state.node, COMPLETED_COLOR);
        } else if (this.isUnlocked(name)) {
            if (btn) btn.interactable = true;
            this.restoreOriginalColors(state.node);
        } else {
            if (btn) btn.interactable = false;
            this.setSubtreeColor(state.node, LOCKED_COLOR);
        }
    }

    /** 递归设置节点子树中所有 Sprite 为指定颜色 */
    private setSubtreeColor(node: Node, color: Color) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            sprite.color = color;
        }
        for (const child of node.children) {
            this.setSubtreeColor(child, color);
        }
    }

    /** 递归恢复节点子树中所有 Sprite 的原始颜色 */
    private restoreOriginalColors(node: Node) {
        const sprite = node.getComponent(Sprite);
        const original = this._originalColors.get(node);
        if (sprite && original) {
            sprite.color = original;
        }
        for (const child of node.children) {
            this.restoreOriginalColors(child);
        }
    }

    /** 解绑所有生存按钮事件 */
    private unbindSurvivalButtons() {
        for (const [name, state] of this._upgradeStates) {
            const btn = state.node.getComponent(Button);
            if (btn?.node.isValid) {
                btn.node.off(Button.EventType.CLICK, () => this.onUpgradeClick(name), this);
            }
        }
    }
}