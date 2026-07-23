import { _decorator, Button, Camera, Color, Component, EventMouse, EventTouch, find, Input, input, Label, Node, RichText, Sprite, tween, Vec3, warn } from 'cc';
import { PlayerState } from './PlayerState';
import { PlayerData } from './PlayerData';
import { TurretPlacementManager } from './TurretPlacementManager';
import { ReinforcementNotice } from './ReinforcementNotice';

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
/** 炮塔强化悬停颜色：#D99AFD 半透明 */
const REINFORCE_HOVER_COLOR = new Color(217, 154, 253, 150);
/** 炮塔强化永久颜色：#D99AFD 不透明 */
const REINFORCE_PERMANENT_COLOR = new Color(217, 154, 253, 255);
/** 悬停检测距离阈值 */
const REINFORCE_HOVER_RADIUS = 80;

/** 升级依赖链：点击某个按钮后，哪些按钮的视觉状态需要刷新 */
const AFFECTED_BUTTONS: Record<string, string[]> = {
    Walkspeed: ['Walkspeed', 'FatigueReduce', 'WoodCollect'],
    FatigueReduce: ['FatigueReduce', 'HPIncrease'],
    WoodCollect: ['WoodCollect', 'CopperCollect'],
    CopperCollect: ['CopperCollect', 'IronCollect'],
    IronCollect: ['IronCollect', 'Stealth'],
    HPIncrease: ['HPIncrease'],
    Stealth: ['Stealth'],
    // 工程
    RemoteRepair: ['RemoteRepair', 'RemoteMaterial', 'MaterialSave'],
    RemoteMaterial: ['RemoteMaterial', 'TurretReinforcement'],
    TurretReinforcement: ['TurretReinforcement'],
    MaterialSave: ['MaterialSave', 'PowerSaving'],
    PowerSaving: ['PowerSaving', 'Blast'],
    Blast: ['Blast'],
    // 武器
    AttackIncrease: ['AttackIncrease', 'Pistol'],
    Pistol: ['Pistol', 'Micromsg', 'Rifle', 'Machinegun'],
    Micromsg: ['Micromsg'],
    Rifle: ['Rifle'],
    Machinegun: ['Machinegun'],
};

/** 炮塔强化消耗 */
const REINFORCE_COST = { wood: 6, copper: 3, iron: 1 };

/** 爆破最大次数 */
const BLAST_MAX_COUNT = 10;

/** 爆破冷却时间（毫秒） */
const BLAST_COOLDOWN_MS = 120000;

/** 爆破悬停颜色：红色 */
const BLAST_HOVER_COLOR = new Color(255, 0, 0, 200);

/** 按钮悬停描述映射 */
const BUTTON_DESCRIPTIONS: Record<string, string> = {
    Walkspeed: 'LV2，移动速度加快',
    FatigueReduce: 'LV2，疲劳增长减缓',
    HPIncrease: 'LV3，生命值提升',
    WoodCollect: 'LV3，木材采集效率提升',
    CopperCollect: 'LV3，铜矿采集效率提升',
    IronCollect: 'LV3，铁矿采集效率提升',
    Stealth: 'LV1，降低僵尸感知范围',
    RemoteRepair: 'LV1，远程维修建筑',
    RemoteMaterial: 'LV1，远程用材料维修',
    TurretReinforcement: 'LV1，强化炮塔属性 (消耗：6木 3铜 1铁)',
    MaterialSave: 'LV3，全局节省材料',
    PowerSaving: 'LV3，全局节省电力',
    Blast: 'LV1，爆破拆除地图元素（最多10次）',
    AttackIncrease: 'LV3，提升攻击力',
    Pistol: 'LV1，切换手枪模式',
    Micromsg: 'LV1，切换微型冲锋枪',
    Rifle: 'LV1，切换步枪模式',
    Machinegun: 'LV1，切换机关枪模式',
};

/**
 * 属性升级面板 UI。
 * 挂载在 Canvas/AttributeUpgradePanel 节点上。
 */
@ccclass('AttributeUpgradePanel')
export class AttributeUpgradePanel extends Component {
    // ---- 面板通用 ----
    @property({ type: Button, tooltip: '面板右上角：关闭按钮' })
    closeButton: Button | null = null;

    @property({ type: Node, tooltip: '生存内容区' })
    survivalContent: Node | null = null;

    @property({ type: Node, tooltip: '工程内容区' })
    engineeringContent: Node | null = null;

    @property({ type: Node, tooltip: '武器内容区' })
    weaponContent: Node | null = null;

    @property({ type: Label, tooltip: '升级点数显示文本' })
    pointNumberLabel: Label | null = null;

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

    // ---- 工程选项卡按钮 ----
    @property({ type: Node, tooltip: '远程维修按钮（共用）' })
    remoteRepairButton: Node | null = null;

    @property({ type: Node, tooltip: '远程用材料按钮（分支一）' })
    remoteMaterialButton: Node | null = null;

    @property({ type: Node, tooltip: '炮塔强化按钮（分支一）' })
    turretReinforcementButton: Node | null = null;

    @property({ type: Node, tooltip: '省材料按钮（分支二）' })
    materialSaveButton: Node | null = null;

    @property({ type: Node, tooltip: '省电按钮（分支二）' })
    powerSavingButton: Node | null = null;

    @property({ type: Node, tooltip: '爆破按钮（分支二）' })
    blastButton: Node | null = null;

    // ---- 武器选项卡按钮 ----
    @property({ type: Node, tooltip: '攻击力提升按钮' })
    attackIncreaseButton: Node | null = null;

    @property({ type: Node, tooltip: '手枪按钮' })
    pistolButton: Node | null = null;

    @property({ type: Node, tooltip: '微型冲锋枪按钮' })
    micromsgButton: Node | null = null;

    @property({ type: Node, tooltip: '步枪按钮' })
    rifleButton: Node | null = null;

    @property({ type: Node, tooltip: '机关枪按钮' })
    machinegunButton: Node | null = null;

    // ---- 武器攻击间隔（属性检查器可调） ----
    @property({ tooltip: '手枪攻击间隔（秒）' })
    pistolAttackInterval = 0.5;

    @property({ tooltip: '微型冲锋枪攻击间隔（秒）' })
    micromsgAttackInterval = 0.3;

    @property({ tooltip: '步枪攻击间隔（秒）' })
    rifleAttackInterval = 0.8;

    @property({ tooltip: '机关枪攻击间隔（秒）' })
    machinegunAttackInterval = 0.15;

    // ---- 武器伤害值（属性检查器可调） ----
    @property({ tooltip: '手枪伤害值' })
    pistolDamage = 10;

    @property({ tooltip: '微型冲锋枪伤害值' })
    micromsgDamage = 8;

    @property({ tooltip: '步枪伤害值' })
    rifleDamage = 20;

    @property({ tooltip: '机关枪伤害值' })
    machinegunDamage = 5;

    // ---- Canvas 永久操作按钮（升级点亮后显示，独立于面板） ----
    @property({ type: Node, tooltip: '炮塔强化操作按钮（Canvas 下，点亮后永久显示）' })
    reinforceActionBtn: Node | null = null;

    @property({ type: Node, tooltip: '爆破操作按钮（Canvas 下，点亮后永久显示）' })
    blastActionBtn: Node | null = null;

    @property({ type: Node, tooltip: '武器模式切换按钮（Canvas 下，点亮后永久显示）' })
    weaponActionBtn: Node | null = null;

    // ---- Camera ----
    @property({ type: Camera, tooltip: '世界相机（用于坐标转换）' })
    worldCamera: Camera | null = null;

    @property({ type: Label, tooltip: '警告提示标签（用于显示点数不足等）' })
    warningLabel: Label | null = null;

    @property({ type: Label, tooltip: '属性描述文本（悬停按钮时显示）' })
    attributeDescribeLabel: Label | null = null;

    @property({ type: Node, tooltip: '重置按钮节点' })
    resetButton: Node | null = null;

    @property({ type: Node, tooltip: '确认重置面板节点' })
    confirmPanel: Node | null = null;

    @property({ type: RichText, tooltip: '确认面板提示文本（notice，使用 RichText 支持颜色标签）' })
    confirmNoticeLabel: RichText | null = null;

    @property({ type: Node, tooltip: '确认按钮' })
    confirmButton: Node | null = null;

    @property({ type: Node, tooltip: '取消按钮' })
    cancelResetButtonNode: Node | null = null;

    private _panelVisible = false;
    private static _openPanelBound = false;
    private static _pendingOpen = false;

    /** 按钮状态 Map（生存 + 工程） */
    private _upgradeStates: Map<string, UpgradeState> = new Map();
    /** 每个按钮子树中所有 Sprite 的原始颜色 */
    private _originalColors: Map<Node, Color> = new Map();
    /** 模式状态 */
    private _reinforceMode = false;
    private _blastMode = false;
    private _modeInputSetup = false;
    /** 强化模式悬停高亮 */
    private _highlightedTurret: Node | null = null;
    private _turretOriginalColors: Map<Node, Color> = new Map();

    /** 已强化过的炮塔 UUID 集合（每个炮塔只可强化一次） */
    private _reinforcedTurretIds: Set<string> = new Set();

    /** 已爆破次数 */
    private _blastCount = 0;

    /** 爆破冷却结束时间戳 */
    private _blastCooldownEndTime = 0;

    /** 爆破模式悬停高亮 */
    private _highlightedBlastTarget: Node | null = null;
    private _blastTargetOriginalColors: Map<Node, Color> = new Map();

    /** blastActionBtn 原始颜色（用于冷却恢复） */
    private _blastBtnOriginalColor: Color | null = null;

    /** onLoad 比 start 更早执行，确保第一帧前隐藏按钮 */
    onLoad() {
        if (this.reinforceActionBtn) this.reinforceActionBtn.active = false;
        if (this.blastActionBtn) this.blastActionBtn.active = false;
        if (this.weaponActionBtn) this.weaponActionBtn.active = false;
    }

    private _initialized = false;

    start() {
        // 仅在首次初始化时注册升级按钮，避免重复调用 start() 时覆盖已有升级状态
        if (!this._initialized) {
            this._initialized = true;
            this.bindCloseButton();
            this.initSurvivalUpgrades();
            this.initEngineeringUpgrades();
            this.initWeaponUpgrades();
            this.initCanvasActionButtons();
            this.bindResetButton();
            this.bindConfirmPanel();

            // 描述标签初始隐藏
            if (this.attributeDescribeLabel) {
                this.attributeDescribeLabel.node.active = false;
            }

            // 所有分类同时显示（不再使用 Tab 切换）
            this.showAllContent();
        }

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
        if (this.resetButton?.isValid) {
            const resetBtn = this.resetButton.getComponent(Button);
            if (resetBtn?.node.isValid) {
                resetBtn.node.off(Button.EventType.CLICK, this.onResetClick, this);
            }
        }
        this.unbindConfirmPanel();
        this.unbindAllButtons();
        this.exitAllModes();
        this.unschedule(this.updateBlastCooldownUI);
        this.unbindCanvasActionButtons();
    }

    // ==================== 面板显示/隐藏 ====================

    showPanel() {
        this._panelVisible = true;
        this.setHostPanelVisible(true);
        this.refreshPointDisplay();
        this.refreshAllButtons();
    }

    hidePanel() {
        this._panelVisible = false;
        this.setHostPanelVisible(false);
        this.exitAllModes();
    }

    public isPanelVisible(): boolean {
        return this._panelVisible;
    }

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

    private bindCloseButton() {
        if (!this.closeButton) {
            warn('[AttributeUpgradePanel] closeButton 未绑定');
            return;
        }
        this.closeButton.node.on(Button.EventType.CLICK, this.hidePanel, this);
    }

    private setHostPanelVisible(visible: boolean) {
        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            sprite.enabled = visible;
        }
        for (const child of this.node.children) {
            // 跳过 confirmPanel，它由 Reset 按钮独立控制
            if (child === this.confirmPanel) continue;
            child.active = visible;
        }
    }

    // ==================== 内容区显示 ====================

    /** 同时显示所有分类内容（不再使用 Tab 互斥切换） */
    private showAllContent() {
        if (this.survivalContent) this.survivalContent.active = true;
        if (this.engineeringContent) this.engineeringContent.active = true;
        if (this.weaponContent) this.weaponContent.active = true;
    }

    // ==================== 初始化 ====================

    private initSurvivalUpgrades() {
        this.registerUpgrade('Walkspeed', this.walkspeedButton || this.findButtonIn('Walkspeed', this.survivalContent), 2);
        this.registerUpgrade('FatigueReduce', this.fatigueReduceButton || this.findButtonIn('FatigueReduce', this.survivalContent), 2);
        this.registerUpgrade('HPIncrease', this.hpIncreaseButton || this.findButtonIn('HPIncrease', this.survivalContent), 3);
        this.registerUpgrade('WoodCollect', this.woodCollectButton || this.findButtonIn('WoodCollect', this.survivalContent), 3);
        this.registerUpgrade('CopperCollect', this.copperCollectButton || this.findButtonIn('CopperCollect', this.survivalContent), 3);
        this.registerUpgrade('IronCollect', this.ironCollectButton || this.findButtonIn('IronCollect', this.survivalContent), 3);
        this.registerUpgrade('Stealth', this.stealthButton || this.findButtonIn('Stealth', this.survivalContent), 1);
    }

    private initEngineeringUpgrades() {
        this.registerUpgrade('RemoteRepair', this.remoteRepairButton || this.findButtonIn('RemoteRepair', this.engineeringContent), 1);
        this.registerUpgrade('RemoteMaterial', this.remoteMaterialButton || this.findButtonIn('RemoteMaterial', this.engineeringContent), 1);
        this.registerUpgrade('TurretReinforcement', this.turretReinforcementButton || this.findButtonIn('TurretReinforcement', this.engineeringContent), 1);
        this.registerUpgrade('MaterialSave', this.materialSaveButton || this.findButtonIn('MaterialSave', this.engineeringContent), 3);
        this.registerUpgrade('PowerSaving', this.powerSavingButton || this.findButtonIn('PowerSaving', this.engineeringContent), 3);
        this.registerUpgrade('Blast', this.blastButton || this.findButtonIn('Blast', this.engineeringContent), 1);
    }

    private initWeaponUpgrades() {
        this.registerUpgrade('AttackIncrease', this.attackIncreaseButton || this.findButtonIn('AttackIncrease', this.weaponContent), 3);
        this.registerUpgrade('Pistol', this.pistolButton || this.findButtonIn('Pistol', this.weaponContent), 1);
        this.registerUpgrade('Micromsg', this.micromsgButton || this.findButtonIn('Micromsg', this.weaponContent), 1);
        this.registerUpgrade('Rifle', this.rifleButton || this.findButtonIn('Rifle', this.weaponContent), 1);
        this.registerUpgrade('Machinegun', this.machinegunButton || this.findButtonIn('Machinegun', this.weaponContent), 1);
    }

    private registerUpgrade(name: string, node: Node | null, maxLevel: number) {
        if (!node) return;
        const state: UpgradeState = { node, level: 0, maxLevel };
        this._upgradeStates.set(name, state);
        this.saveOriginalColors(node);

        const btn = node.getComponent(Button);
        if (btn) {
            btn.node.on(Button.EventType.CLICK, () => this.onUpgradeClick(name), this);
        }

        // 悬停描述
        node.on(Node.EventType.MOUSE_ENTER, () => this.onButtonHover(name), this);
        node.on(Node.EventType.MOUSE_LEAVE, () => this.onButtonHoverEnd(), this);
    }

    private saveOriginalColors(node: Node) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            this._originalColors.set(node, sprite.color.clone());
        }
        for (const child of node.children) {
            this.saveOriginalColors(child);
        }
    }

    private findButtonIn(name: string, container: Node | null): Node | null {
        if (!container) return null;
        return this.findNodeByName(container, name);
    }

    private findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this.findNodeByName(child, name);
            if (found) return found;
        }
        return null;
    }

    private unbindAllButtons() {
        for (const [name, state] of this._upgradeStates) {
            const btn = state.node.getComponent(Button);
            if (btn?.node.isValid) {
                btn.node.off(Button.EventType.CLICK, () => this.onUpgradeClick(name), this);
            }
            if (state.node.isValid) {
                state.node.off(Node.EventType.MOUSE_ENTER, () => this.onButtonHover(name), this);
                state.node.off(Node.EventType.MOUSE_LEAVE, () => this.onButtonHoverEnd(), this);
            }
        }
    }

    // ==================== 解锁逻辑 ====================

    private isUnlocked(name: string): boolean {
        const state = this._upgradeStates.get(name);
        if (!state) return false;
        if (state.level >= state.maxLevel) return false;

        switch (name) {
            // 生存
            case 'Walkspeed': return true;
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
            // 工程
            case 'RemoteRepair': return true;
            case 'RemoteMaterial':
            case 'MaterialSave':
                return this.getLevel('RemoteRepair') >= 1;
            case 'TurretReinforcement':
                return this.getLevel('RemoteMaterial') >= 1;
            case 'PowerSaving':
                return this.getLevel('MaterialSave') >= 3;
            case 'Blast':
                return this.getLevel('PowerSaving') >= 3;
            // 武器
            case 'AttackIncrease': return true;
            case 'Pistol':
                return this.getLevel('AttackIncrease') >= 3;
            case 'Micromsg':
            case 'Rifle':
            case 'Machinegun':
                return this.getLevel('Pistol') >= 1;
            default:
                return false;
        }
    }

    private getLevel(name: string): number {
        return this._upgradeStates.get(name)?.level ?? 0;
    }

    // ==================== 升级点击 ====================

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
            this.showWarning('升级点数不足！');
            return;
        }

        ps.upgradePoints--;
        this.refreshPointDisplay();
        state.level++;
        this.applyUpgradeEffect(name, state.level);
        this.refreshAffectedButtons(name);
    }

    /** 消耗炮塔强化材料（6木3铜1铁） */
    private consumeReinforceMaterials(): boolean {
        const data = PlayerData.instance;
        if (!data) return false;
        if (data.woodCount < REINFORCE_COST.wood
            || data.copperCount < REINFORCE_COST.copper
            || data.ironCount < REINFORCE_COST.iron) {
            ReinforcementNotice.show(`材料不足！需要 ${REINFORCE_COST.wood}木 ${REINFORCE_COST.copper}铜 ${REINFORCE_COST.iron}铁`);
            return false;
        }
        data.addResource('wood', -REINFORCE_COST.wood);
        data.addResource('copper', -REINFORCE_COST.copper);
        data.addResource('iron', -REINFORCE_COST.iron);
        return true;
    }

    /** 应用升级效果 */
    private applyUpgradeEffect(name: string, level: number) {
        const ps = PlayerState.instance;
        if (!ps) return;

        switch (name) {
            case 'Walkspeed':
                ps.walkSpeedMultiplier = level === 1 ? 1.3 : 1.5;
                break;
            case 'FatigueReduce':
                ps.fatigueGainMultiplier = level === 1 ? 0.85 : 0.70;
                break;
            case 'HPIncrease':
                ps.hpMultiplier = [1.5, 2.0, 3.0][level - 1];
                ps.hp = ps.getEffectiveMaxHp();
                break;
            case 'WoodCollect':
                ps.woodCollectMultiplier = level + 1;
                break;
            case 'CopperCollect':
                ps.copperCollectMultiplier = level + 1;
                break;
            case 'IronCollect':
                ps.ironCollectMultiplier = level + 1;
                break;
            case 'Stealth':
                PlayerState.zombieAlertRadiusMultiplier = 0.2;
                break;
            case 'RemoteRepair':
                ps.remoteRepairLevel = 1;
                break;
            case 'RemoteMaterial':
                ps.remoteMaterialEnabled = true;
                break;
            case 'MaterialSave':
                ps.materialSaveRate = [0.1, 0.15, 0.2][level - 1];
                break;
            case 'PowerSaving':
                ps.powerSaveRate = [0.1, 0.15, 0.2][level - 1];
                break;
            case 'TurretReinforcement':
                // 点亮 Canvas 强化操作按钮
                this.showCanvasActionBtn(this.reinforceActionBtn, 'TurretReinforcement');
                break;
            case 'Blast':
                // 点亮 Canvas 爆破操作按钮
                this.showCanvasActionBtn(this.blastActionBtn, 'Blast');
                break;
            // 武器
            case 'AttackIncrease':
                ps.attackDamageMultiplier = [1.5, 3.0, 6.0][level - 1];
                break;
            case 'Pistol':
                ps.weaponAttackInterval = this.pistolAttackInterval;
                ps.weaponDamage = this.pistolDamage;
                this.showCanvasActionBtn(this.weaponActionBtn, 'Pistol');
                break;
            case 'Micromsg':
                ps.weaponAttackInterval = this.micromsgAttackInterval;
                ps.weaponDamage = this.micromsgDamage;
                break;
            case 'Rifle':
                ps.weaponAttackInterval = this.rifleAttackInterval;
                ps.weaponDamage = this.rifleDamage;
                break;
            case 'Machinegun':
                ps.weaponAttackInterval = this.machinegunAttackInterval;
                ps.weaponDamage = this.machinegunDamage;
                break;
        }
    }

    // ==================== 炮塔强化模式 ====================

    private enterReinforceMode() {
        if (this.getLevel('TurretReinforcement') < 1) return;

        this.exitAllModes();
        this._reinforceMode = true;
        this.setupModeInput();
        if (this.reinforceActionBtn) {
            const btn = this.reinforceActionBtn.getComponent(Button);
            if (btn) btn.interactable = false;
        }
        ReinforcementNotice.show('进入炮塔强化模式，点击炮塔强化，点击空地/右键/ESC取消');
    }

    private exitReinforceMode() {
        this._reinforceMode = false;
        this.clearTurretHighlight();
        if (this.reinforceActionBtn) {
            const btn = this.reinforceActionBtn.getComponent(Button);
            if (btn) btn.interactable = true;
        }
    }

    // ==================== 爆破模式 ====================

    private enterBlastMode() {
        if (this.getLevel('Blast') < 1) return;

        if (this._blastCount >= BLAST_MAX_COUNT) {
            if (this.blastActionBtn) this.blastActionBtn.active = false;
            ReinforcementNotice.show(`爆破次数已用完（${BLAST_MAX_COUNT}/${BLAST_MAX_COUNT}）`);
            return;
        }

        // 检查冷却
        const now = Date.now();
        if (now < this._blastCooldownEndTime) {
            const remainSec = Math.ceil((this._blastCooldownEndTime - now) / 1000);
            ReinforcementNotice.show(`爆破冷却中，还剩${remainSec}秒`);
            return;
        }

        this.exitAllModes();
        this._blastMode = true;
        this.setupModeInput();

        if (this.blastActionBtn) {
            const btn = this.blastActionBtn.getComponent(Button);
            if (btn) btn.interactable = false;
        }
        const remain = BLAST_MAX_COUNT - this._blastCount;
        ReinforcementNotice.show(`进入爆破模式，点击地图元素拆除（剩余${remain}次），点击空地/右键/ESC取消`);
    }

    private exitBlastMode() {
        this._blastMode = false;
        this.clearBlastHighlight();
        if (this.blastActionBtn) {
            const btn = this.blastActionBtn.getComponent(Button);
            if (btn) btn.interactable = true;
        }
    }

    private exitAllModes() {
        this.exitReinforceMode();
        this.exitBlastMode();
    }

    // ==================== Canvas 永久操作按钮 ====================

    /** 初始化 Canvas 操作按钮：隐藏并绑定点击事件 */
    private initCanvasActionButtons() {
        this.bindCanvasActionBtn(this.reinforceActionBtn, () => this.enterReinforceMode());
        this.bindCanvasActionBtn(this.blastActionBtn, () => this.enterBlastMode());
        this.bindCanvasActionBtn(this.weaponActionBtn, () => this.toggleWeaponMode());
    }

    private bindCanvasActionBtn(btnNode: Node | null, handler: () => void) {
        if (!btnNode) return;
        btnNode.active = false;
        const btn = btnNode.getComponent(Button);
        if (btn) {
            btn.node.on(Button.EventType.CLICK, handler, this);
        }
    }

    private unbindCanvasActionButtons() {
        if (this.reinforceActionBtn?.isValid) {
            const btn = this.reinforceActionBtn.getComponent(Button);
            if (btn) btn.node.targetOff(this);
        }
        if (this.blastActionBtn?.isValid) {
            const btn = this.blastActionBtn.getComponent(Button);
            if (btn) btn.node.targetOff(this);
        }
    }

    /** 点亮 Canvas 操作按钮（永久显示），仅在对应升级已完成时生效 */
    private showCanvasActionBtn(btnNode: Node | null, upgradeName: string) {
        if (!btnNode) return;
        if (this.getLevel(upgradeName) < 1) return;
        btnNode.active = true;

        // 如果是爆破按钮且有冷却，恢复冷却 UI
        if (upgradeName === 'Blast' && this._blastCooldownEndTime > Date.now()) {
            this.startBlastCooldownUI();
        }
    }

    /** 切换武器模式：采集 ↔ 攻击僵尸 */
    private toggleWeaponMode() {
        if (this.getLevel('Pistol') < 1) return;
        const ps = PlayerState.instance;
        if (!ps) return;
        ps.weaponMode = !ps.weaponMode;
        if (ps.weaponMode) {
            ReinforcementNotice.show('武器模式，可以远程攻击敌人');
        } else {
            ReinforcementNotice.show('采集模式，可以采集资源');
        }
    }

    // ==================== 模式输入 ====================

    private setupModeInput() {
        if (this._modeInputSetup) return;
        this._modeInputSetup = true;

        // 监听全局触摸/点击事件
        input.on(Input.EventType.TOUCH_END, this.onModeTouchEnd, this);
        // 监听鼠标移动（悬停高亮）
        input.on(Input.EventType.MOUSE_MOVE, this.onModeMouseMove, this);
        // 监听鼠标右键取消
        input.on(Input.EventType.MOUSE_DOWN, this.onModeMouseDown, this);
        // 监听 ESC 取消
        input.on(Input.EventType.KEY_DOWN, this.onModeKeyDown, this);
    }

    private onModeTouchEnd(event: EventTouch) {
        if (!this._reinforceMode && !this._blastMode) return;

        const touchLoc = event.getLocation();
        const worldPos = this.screenToWorldPos(touchLoc.x, touchLoc.y);
        if (!worldPos) return;

        if (this._reinforceMode) {
            this.tryReinforceTurret(worldPos);
        } else if (this._blastMode) {
            this.tryBlastTarget(worldPos);
        }
    }

    /** 鼠标移动：强化模式下悬停高亮炮塔，爆破模式下悬停高亮地图元素 */
    private onModeMouseMove(event: EventMouse) {
        if (!this._reinforceMode && !this._blastMode) return;

        const worldPos = this.screenToWorldPos(event.getLocationX(), event.getLocationY());
        if (!worldPos) {
            this.clearTurretHighlight();
            this.clearBlastHighlight();
            return;
        }

        if (this._reinforceMode) {
            const turretNode = this.findTurretNodeAt(worldPos);
            if (turretNode && turretNode !== this._highlightedTurret) {
                this.clearTurretHighlight();
                this._highlightedTurret = turretNode;
                this.highlightTurretChildren(turretNode, true);
            } else if (!turretNode) {
                this.clearTurretHighlight();
            }
        }

        if (this._blastMode) {
            const blastTarget = this.findMapElementAt(worldPos);
            if (blastTarget && blastTarget !== this._highlightedBlastTarget) {
                this.clearBlastHighlight();
                this._highlightedBlastTarget = blastTarget;
                this.highlightBlastTarget(blastTarget, true);
            } else if (!blastTarget) {
                this.clearBlastHighlight();
            }
        }
    }

    private onModeMouseDown(event: any) {
        if (event.getButton?.() === 2) {
            this.exitAllModes();
        }
    }

    private onModeKeyDown(event: any) {
        if (event.keyCode === 27) { // ESC
            this.exitAllModes();
        }
    }

    /** 屏幕坐标 → 世界坐标（x, y 参数版本，参照 DemolishManager） */
    private screenToWorldPos(x: number, y: number): Vec3 | null {
        const cam = this.worldCamera ?? TurretPlacementManager.instance?.worldCamera;
        if (!cam) return null;
        const v3 = cam.screenToWorld(new Vec3(x, y, 0), new Vec3());
        v3.z = 0;
        return v3;
    }

    /** 查找世界坐标处的炮塔节点 */
    private findTurretNodeAt(worldPos: Vec3): Node | null {
        const scene = this.node.scene;
        if (!scene) return null;
        return this.findTurretNodeRecursive(scene, worldPos, REINFORCE_HOVER_RADIUS);
    }

    private findTurretNodeRecursive(root: Node, worldPos: Vec3, threshold: number): Node | null {
        const turret = root.getComponent('Turret') as Component | null;
        if (turret && turret.node.active) {
            const dist = Vec3.distance(root.worldPosition, worldPos);
            if (dist <= threshold) return root;
        }
        for (const child of root.children) {
            const found = this.findTurretNodeRecursive(child, worldPos, threshold);
            if (found) return found;
        }
        return null;
    }

    /** 高亮/取消高亮炮塔的 Turnet 和 Turnet_foundation 子节点 */
    private highlightTurretChildren(turretNode: Node, highlight: boolean) {
        if (highlight) {
            this._turretOriginalColors.clear();
            this.collectTurretChildColors(turretNode, REINFORCE_HOVER_COLOR);
        } else {
            this.restoreTurretChildColors();
        }
    }

    /** 递归收集 Turnet/Turnet_foundation 子节点的 Sprite 颜色并设置 */
    private collectTurretChildColors(node: Node, color: Color) {
        // 只对名为 Turnet 或 Turnet_foundation 的子节点及其子树着色
        if (node.name === 'Turnet' || node.name === 'Turnet_foundation') {
            this.collectAndSetColorRecursive(node, color);
            return;
        }
        for (const child of node.children) {
            this.collectTurretChildColors(child, color);
        }
    }

    /** 递归设置节点及其子树的 Sprite 颜色 */
    private collectAndSetColorRecursive(node: Node, color: Color) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            this._turretOriginalColors.set(node, sprite.color.clone());
            sprite.color = color;
        }
        for (const child of node.children) {
            this.collectAndSetColorRecursive(child, color);
        }
    }

    /** 恢复 Turret/Turret_foundation 的原始颜色 */
    private restoreTurretChildColors() {
        for (const [node, color] of this._turretOriginalColors) {
            if (node && node.isValid) {
                const sprite = node.getComponent(Sprite);
                if (sprite) {
                    sprite.color = color;
                }
            }
        }
        this._turretOriginalColors.clear();
    }

    /** 清除炮塔悬停高亮 */
    private clearTurretHighlight() {
        if (this._highlightedTurret) {
            this.restoreTurretChildColors();
            this._highlightedTurret = null;
        }
    }

    /** 尝试强化炮塔 */
    private tryReinforceTurret(worldPos: Vec3) {
        const turret = this.findTurretAt(worldPos);
        if (!turret) {
            this.exitReinforceMode();
            ReinforcementNotice.show('无目标退出炮塔强化模式');
            return;
        }

        // 检查是否已强化过
        const nodeId = turret.node.uuid;
        if (this._reinforcedTurretIds.has(nodeId)) {
            ReinforcementNotice.show('该炮塔已强化过，请选择其他炮塔');
            return;
        }

        // 消耗材料（确认强化后才扣除）
        if (!this.consumeReinforceMaterials()) return;

        // 强化效果：范围/攻速/攻击 ×1.5
        const t = turret as any;
        t.attackRange = (t.attackRange ?? 1200) * 1.5;
        t.attackInterval = (t.attackInterval ?? 0.5) * (1 / 1.5);
        t.damage = (t.damage ?? 10) * 1.5;

        // 记录已强化
        this._reinforcedTurretIds.add(nodeId);

        // 永久着色：对 Turnet 和 Turnet_foundation 子节点应用 #D99AFD
        this.applyPermanentColorToTurretChildren(turret.node);

        this.exitReinforceMode();
        ReinforcementNotice.show('炮塔强化完成！范围/攻速/攻击 ×1.5');
    }

    /** 对炮塔的 Turnet/Turnet_foundation 子节点永久着色 */
    private applyPermanentColorToTurretChildren(turretNode: Node) {
        this.collectTurretChildColors(turretNode, REINFORCE_PERMANENT_COLOR);
        // 不保存原始颜色（永久着色，不需要恢复）
        this._turretOriginalColors.clear();
    }

    /** 查找点击位置的炮塔 */
    private findTurretAt(worldPos: Vec3): Component | null {
        const scene = this.node.scene;
        if (!scene) return null;
        return this.findTurretAtRecursive(scene, worldPos, 50);
    }

    private findTurretAtRecursive(root: Node, worldPos: Vec3, threshold: number): Component | null {
        for (const child of root.children) {
            const turret = child.getComponent('Turret') as Component | null;
            if (turret) {
                const dist = Vec3.distance(child.worldPosition, worldPos);
                if (dist <= threshold) return turret;
            }
            const found = this.findTurretAtRecursive(child, worldPos, threshold);
            if (found) return found;
        }
        return null;
    }

    /** 尝试爆破目标 */
    private tryBlastTarget(worldPos: Vec3) {
        const target = this.findMapElementAt(worldPos);
        if (!target) {
            this.exitBlastMode();
            ReinforcementNotice.show('无目标退出爆破模式');
            return;
        }

        // 播放缩放动画后销毁
        tween(target)
            .to(0.3, { scale: new Vec3(0, 0, 0) })
            .call(() => {
                if (target.isValid) {
                    target.destroy();
                }
            })
            .start();

        this._blastCount++;
        const remain = BLAST_MAX_COUNT - this._blastCount;

        // 自动退出爆破模式
        this.exitBlastMode();

        if (this._blastCount >= BLAST_MAX_COUNT) {
            if (this.blastActionBtn) {
                this.blastActionBtn.active = false;
            }
            ReinforcementNotice.show(`爆破次数已用完！共拆除${BLAST_MAX_COUNT}个地图元素`);
        } else {
            ReinforcementNotice.show(`已拆除${this._blastCount}个地图元素（剩余${remain}次）`);
        }

        // 启动冷却
        this._blastCooldownEndTime = Date.now() + BLAST_COOLDOWN_MS;
        this.startBlastCooldownUI();
    }

    /** 查找点击位置的 MapElement（含 MapObstacle 组件的节点） */
    private findMapElementAt(worldPos: Vec3): Node | null {
        const scene = this.node.scene;
        if (!scene) return null;
        return this.findMapElementRecursive(scene, worldPos, 80);
    }

    private findMapElementRecursive(root: Node, worldPos: Vec3, threshold: number): Node | null {
        const obstacle = root.getComponent('MapObstacle') as Component | null;
        if (obstacle && root.active) {
            const dist = Vec3.distance(root.worldPosition, worldPos);
            if (dist <= threshold) {
                return root;
            }
        }
        for (const child of root.children) {
            const found = this.findMapElementRecursive(child, worldPos, threshold);
            if (found) return found;
        }
        return null;
    }

    // ---- 爆破悬停高亮 ----

    /** 高亮/取消高亮爆破目标为红色 */
    private highlightBlastTarget(targetNode: Node, highlight: boolean) {
        if (highlight) {
            this._blastTargetOriginalColors.clear();
            this.collectBlastTargetColors(targetNode, BLAST_HOVER_COLOR);
        } else {
            this.restoreBlastTargetColors();
        }
    }

    private collectBlastTargetColors(node: Node, color: Color) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            this._blastTargetOriginalColors.set(node, sprite.color.clone());
            sprite.color = color;
        }
        for (const child of node.children) {
            this.collectBlastTargetColors(child, color);
        }
    }

    private restoreBlastTargetColors() {
        for (const [node, color] of this._blastTargetOriginalColors) {
            if (node && node.isValid) {
                const sprite = node.getComponent(Sprite);
                if (sprite) {
                    sprite.color = color;
                }
            }
        }
        this._blastTargetOriginalColors.clear();
    }

    /** 清除爆破悬停高亮 */
    private clearBlastHighlight() {
        if (this._highlightedBlastTarget) {
            this.restoreBlastTargetColors();
            this._highlightedBlastTarget = null;
        }
    }

    // ---- 爆破冷却 ----

    /** 启动冷却 UI 更新（每1秒检查一次） */
    private startBlastCooldownUI() {
        // 保存按钮原始颜色
        if (this.blastActionBtn && !this._blastBtnOriginalColor) {
            const sprite = this.blastActionBtn.getComponent(Sprite);
            if (sprite) {
                this._blastBtnOriginalColor = sprite.color.clone();
            }
        }
        this.updateBlastCooldownUI();
        this.schedule(this.updateBlastCooldownUI, 1);
    }

    /** 更新爆破按钮冷却状态 */
    private updateBlastCooldownUI() {
        if (!this.blastActionBtn) return;

        const now = Date.now();
        const remaining = this._blastCooldownEndTime - now;

        if (remaining <= 0) {
            // 冷却结束，恢复默认颜色
            this.restoreBlastBtnColor();
            this.unschedule(this.updateBlastCooldownUI);
            return;
        }

        // 冷却中，按钮变灰
        const sprite = this.blastActionBtn.getComponent(Sprite);
        if (sprite) {
            sprite.color = LOCKED_COLOR;
        }
    }

    /** 恢复 blastActionBtn 原始颜色 */
    private restoreBlastBtnColor() {
        if (!this.blastActionBtn || !this._blastBtnOriginalColor) return;
        const sprite = this.blastActionBtn.getComponent(Sprite);
        if (sprite) {
            sprite.color = this._blastBtnOriginalColor;
        }
    }

    // ==================== 刷新 ====================

    /** 绑定重置按钮 */
    private bindResetButton() {
        if (!this.resetButton) return;
        const btn = this.resetButton.getComponent(Button);
        if (btn) {
            btn.node.on(Button.EventType.CLICK, this.onResetClick, this);
        }
    }

    /** 按钮悬停：显示描述 */
    private onButtonHover(name: string) {
        if (!this.attributeDescribeLabel) return;
        let desc = BUTTON_DESCRIPTIONS[name];
        if (name === 'Blast') {
            const remain = BLAST_MAX_COUNT - this._blastCount;
            desc = `LV1，爆破拆除地图元素（剩余${remain}/${BLAST_MAX_COUNT}次）`;
        }
        if (desc) {
            this.attributeDescribeLabel.string = desc;
            this.attributeDescribeLabel.node.active = true;
        }
    }

    /** 按钮悬停结束：隐藏描述 */
    private onButtonHoverEnd() {
        if (!this.attributeDescribeLabel) return;
        this.attributeDescribeLabel.node.active = false;
    }

    /** 根据已升级点数动态计算重置花费。
     * 每点花费 = maxMoney / maxUpgradePoints，总花费 = 每点花费 × 已升级点数 */
    private getResetCost(): number {
        const ps = PlayerState.instance;
        const data = PlayerData.instance;
        if (!ps || !data) return 999999;
        let totalLevels = 0;
        for (const [, state] of this._upgradeStates) {
            totalLevels += state.level;
        }
        if (totalLevels <= 0) return 0;
        const costPerPoint = data.maxMoney / ps.maxUpgradePoints;
        return Math.round(costPerPoint * totalLevels);
    }

    /** 重置按钮点击 → 弹出确认面板 */
    private onResetClick() {
        // 检查是否有升级过的属性
        if (this.getResetCost() <= 0) return;

        // 确保 confirmPanel 是 Canvas 的子节点（不在 AttributeUpgradePanel 下）
        let panel = this.confirmPanel;
        if (!panel || !panel.isValid) {
            const canvasNode = find('Canvas');
            if (canvasNode) {
                panel = canvasNode.getChildByName('ConfirmPanel');
                if (panel && panel.isValid) {
                    this.confirmPanel = panel;
                }
            }
        }

        // 动态显示提示文本
        const data = PlayerData.instance;
        const cost = this.getResetCost();
        const canAfford = data ? data.money >= cost : false;
        const colorStr = canAfford ? '#FFFFFF' : '#FF3C3C';
        if (this.confirmNoticeLabel) {
            this.confirmNoticeLabel.string = `是否需要花费<color=${colorStr}>$${cost}</color>重置属性？`;
        }

        // 弹出确认面板，同时确保父节点 Sprite 处于启用状态以便渲染
        if (panel) {
            // 确保父节点 Sprite 启用（否则 confirmPanel 不可见）
            const parentSprite = panel.parent?.getComponent(Sprite);
            if (parentSprite) parentSprite.enabled = true;
            panel.active = true;
        } else {
            warn('[AttributeUpgradePanel] confirmPanel 未绑定，请在编辑器中将其拖到 Canvas 节点下并绑定属性');
        }
    }

    /** 绑定确认面板按钮 */
    private bindConfirmPanel() {
        if (this.confirmPanel) {
            this.confirmPanel.active = false;
        }
        if (this.confirmButton) {
            const btn = this.confirmButton.getComponent(Button);
            if (btn) {
                btn.node.on(Button.EventType.CLICK, this.onConfirmReset, this);
            }
        }
        if (this.cancelResetButtonNode) {
            const btn = this.cancelResetButtonNode.getComponent(Button);
            if (btn) {
                btn.node.on(Button.EventType.CLICK, this.onCancelReset, this);
            }
        }
    }

    /** 解绑确认面板按钮 */
    private unbindConfirmPanel() {
        if (this.confirmButton?.isValid) {
            const btn = this.confirmButton.getComponent(Button);
            if (btn) btn.node.targetOff(this);
        }
        if (this.cancelResetButtonNode?.isValid) {
            const btn = this.cancelResetButtonNode.getComponent(Button);
            if (btn) btn.node.targetOff(this);
        }
    }

    /** 关闭确认面板，并恢复父节点 Sprite 状态 */
    private closeConfirmPanel() {
        if (!this.confirmPanel) return;
        this.confirmPanel.active = false;
        // 恢复父节点 Sprite 状态（与面板可见性一致）
        const parentSprite = this.confirmPanel.parent?.getComponent(Sprite);
        if (parentSprite) {
            parentSprite.enabled = this._panelVisible;
        }
    }

    /** 确认重置 */
    private onConfirmReset() {
        const ps = PlayerState.instance;
        if (!ps) return;

        const data = PlayerData.instance;
        if (!data) return;

        const cost = this.getResetCost();

        // 金钱不足：无反应
        if (data.money < cost) return;

        // 扣除金钱
        data.money -= cost;

        // 计算总升级点数
        let totalLevels = 0;
        for (const [, state] of this._upgradeStates) {
            totalLevels += state.level;
        }

        // 重置所有升级状态
        for (const [, state] of this._upgradeStates) {
            state.level = 0;
        }

        // 归还属性点
        ps.upgradePoints += totalLevels;

        // 重置 PlayerState 属性
        ps.walkSpeedMultiplier = 1.0;
        ps.fatigueGainMultiplier = 1.0;
        ps.hpMultiplier = 1.0;
        ps.woodCollectMultiplier = 1.0;
        ps.copperCollectMultiplier = 1.0;
        ps.ironCollectMultiplier = 1.0;
        PlayerState.zombieAlertRadiusMultiplier = 1.0;
        ps.remoteRepairLevel = 0;
        ps.remoteMaterialEnabled = false;
        ps.materialSaveRate = 0;
        ps.powerSaveRate = 0;
        ps.attackDamageMultiplier = 1.0;
        ps.weaponAttackInterval = 0.5;
        ps.weaponDamage = 10;
        ps.weaponMode = false;

        // 隐藏 Canvas 操作按钮
        if (this.reinforceActionBtn) this.reinforceActionBtn.active = false;
        if (this.blastActionBtn) this.blastActionBtn.active = false;
        if (this.weaponActionBtn) this.weaponActionBtn.active = false;

        // 重置爆破计数和强化记录
        this._blastCount = 0;
        this._reinforcedTurretIds.clear();

        // 重置爆破冷却
        this._blastCooldownEndTime = 0;
        this.unschedule(this.updateBlastCooldownUI);
        this.restoreBlastBtnColor();

        // 关闭确认面板
        this.closeConfirmPanel();

        // 刷新 UI
        this.refreshPointDisplay();
        this.refreshAllButtons();
    }

    /** 取消重置 */
    private onCancelReset() {
        this.closeConfirmPanel();
    }

    private refreshPointDisplay() {
        if (!this.pointNumberLabel) return;
        const ps = PlayerState.instance;
        const points = ps ? ps.upgradePoints : 0;
        this.pointNumberLabel.string = `属性点：${points}`;
        // 仅当面板可见时才激活显示，避免关闭面板后仍被 scheduleOnce 回调激活
        if (this._panelVisible) {
            this.pointNumberLabel.node.active = true;
        }
    }

    /** 显示临时警告 */
    private showWarning(msg: string) {
        if (!this.warningLabel) {
            warn(`[AttributeUpgradePanel] 未绑定 WarningLabel，警告：${msg}`);
            return;
        }
        this.warningLabel.string = msg;
        this.warningLabel.node.active = true;
        this.scheduleOnce(() => {
            if (this.warningLabel?.node.isValid) {
                this.warningLabel.node.active = false;
            }
            // 若 warningLabel 与 pointNumberLabel 绑定同一节点，隐藏后恢复点数显示
            this.refreshPointDisplay();
        }, 2);
    }

    private refreshAllButtons() {
        for (const [name, state] of this._upgradeStates) {
            this.updateButtonVisual(name, state);
        }
    }

    private refreshAffectedButtons(clickedName: string) {
        const affected = AFFECTED_BUTTONS[clickedName] || [clickedName];
        for (const name of affected) {
            const state = this._upgradeStates.get(name);
            if (state) {
                this.updateButtonVisual(name, state);
            }
        }
    }

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

    private setSubtreeColor(node: Node, color: Color) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            sprite.color = color;
        }
        for (const child of node.children) {
            this.setSubtreeColor(child, color);
        }
    }

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
}