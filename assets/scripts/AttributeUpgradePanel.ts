import { _decorator, Button, Camera, Color, Component, EventTouch, find, Input, input, Label, Node, Sprite, UITransform, Vec2, Vec3, warn } from 'cc';
import { PlayerState } from './PlayerState';
import { PlayerData } from './PlayerData';

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
    // 工程
    RemoteRepair: ['RemoteRepair', 'RemoteMaterial', 'MaterialSave'],
    RemoteMaterial: ['RemoteMaterial', 'TurretReinforcement'],
    TurretReinforcement: ['TurretReinforcement'],
    MaterialSave: ['MaterialSave', 'PowerSaving'],
    PowerSaving: ['PowerSaving', 'Blast'],
    Blast: ['Blast'],
};

/** 炮塔强化消耗 */
const REINFORCE_COST = { wood: 6, copper: 3, iron: 1 };

/** 动作按钮尺寸 */
const ACTION_BTN_SIZE = { w: 120, h: 40 };

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

    // ---- Demolition 旁按钮 ----
    @property({ type: Node, tooltip: '炮塔强化操作按钮（Demolition 旁）' })
    reinforceActionBtn: Node | null = null;

    @property({ type: Node, tooltip: '爆破操作按钮（Demolition 上方）' })
    blastActionBtn: Node | null = null;

    // ---- Camera ----
    @property({ type: Camera, tooltip: '世界相机（用于坐标转换）' })
    worldCamera: Camera | null = null;

    @property({ type: Label, tooltip: '警告提示标签（用于显示点数不足等）' })
    warningLabel: Label | null = null;

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
    /** 动态创建的动作按钮 */
    private _dynamicReinforceBtn: Node | null = null;
    private _dynamicBlastBtn: Node | null = null;

    start() {
        this.bindCloseButton();
        this.initSurvivalUpgrades();
        this.initEngineeringUpgrades();

        // 所有分类同时显示（不再使用 Tab 切换）
        this.showAllContent();

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
        this.unbindAllButtons();
        this.exitAllModes();
        if (this._dynamicReinforceBtn?.isValid) this._dynamicReinforceBtn.destroy();
        if (this._dynamicBlastBtn?.isValid) this._dynamicBlastBtn.destroy();
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

    private registerUpgrade(name: string, node: Node | null, maxLevel: number) {
        if (!node) return;
        const state: UpgradeState = { node, level: 0, maxLevel };
        this._upgradeStates.set(name, state);
        this.saveOriginalColors(node);

        const btn = node.getComponent(Button);
        if (btn) {
            btn.node.on(Button.EventType.CLICK, () => this.onUpgradeClick(name), this);
        }
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

        // 特殊处理：炮塔强化和爆破需要进入模式，不消耗点数
        if (name === 'TurretReinforcement') {
            if (this.getLevel('TurretReinforcement') >= 1) return;
            this.enterReinforceMode();
            return;
        }
        if (name === 'Blast') {
            if (this.getLevel('Blast') >= 1) return;
            this.enterBlastMode();
            return;
        }

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
            this.showWarning(`材料不足！需要 ${REINFORCE_COST.wood}木 ${REINFORCE_COST.copper}铜 ${REINFORCE_COST.iron}铁`);
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
        }
    }

    // ==================== 炮塔强化模式 ====================

    private enterReinforceMode() {
        // 消耗材料
        if (!this.consumeReinforceMaterials()) return;

        this.exitAllModes();
        this._reinforceMode = true;
        this.setupModeInput();

        // 使用已绑定的按钮或动态创建
        if (this.reinforceActionBtn) {
            this.reinforceActionBtn.active = true;
            const btn = this.reinforceActionBtn.getComponent(Button);
            if (btn) btn.interactable = true;
        } else {
            this._dynamicReinforceBtn = this.createActionBtn('强化炮塔', new Color(200, 100, 255, 255), 0, 50);
        }
        warn('[AttributeUpgradePanel] 进入炮塔强化模式，点击游戏中的炮塔进行强化，右键或ESC取消');
    }

    private exitReinforceMode() {
        this._reinforceMode = false;
        if (this.reinforceActionBtn) {
            this.reinforceActionBtn.active = false;
        }
        if (this._dynamicReinforceBtn) {
            this._dynamicReinforceBtn.destroy();
            this._dynamicReinforceBtn = null;
        }
    }

    // ==================== 爆破模式 ====================

    private enterBlastMode() {
        this.exitAllModes();
        this._blastMode = true;
        this.setupModeInput();

        if (this.blastActionBtn) {
            this.blastActionBtn.active = true;
            const btn = this.blastActionBtn.getComponent(Button);
            if (btn) btn.interactable = true;
        } else {
            this._dynamicBlastBtn = this.createActionBtn('爆破', new Color(255, 80, 80, 255), 0, 100);
        }
        warn('[AttributeUpgradePanel] 进入爆破模式，点击 SchoolBus 进行拆除，右键或ESC取消');
    }

    private exitBlastMode() {
        this._blastMode = false;
        if (this.blastActionBtn) {
            this.blastActionBtn.active = false;
        }
        if (this._dynamicBlastBtn) {
            this._dynamicBlastBtn.destroy();
            this._dynamicBlastBtn = null;
        }
    }

    private exitAllModes() {
        this.exitReinforceMode();
        this.exitBlastMode();
    }

    /** 动态创建动作按钮（在 Demolition 节点旁） */
    private createActionBtn(label: string, color: Color, offsetX: number, offsetY: number): Node | null {
        const canvas = this.node.parent;
        if (!canvas) return null;

        // 查找 Demolition 节点作为定位参考
        const demolition = canvas.getChildByName('Demolition');
        const refPos = demolition ? demolition.position.clone() : new Vec3(0, 0, 0);

        const btnNode = new Node('ActionBtn_' + label);
        btnNode.setParent(canvas);
        btnNode.setPosition(refPos.x + offsetX, refPos.y + offsetY, 0);
        btnNode.layer = this.node.layer;

        const uiTransform = btnNode.addComponent(UITransform);
        uiTransform.setContentSize(ACTION_BTN_SIZE.w, ACTION_BTN_SIZE.h);

        const sprite = btnNode.addComponent(Sprite);
        sprite.color = color;
        sprite.type = Sprite.Type.SLICED;

        const button = btnNode.addComponent(Button);
        button.interactable = true;

        // 添加文字标签
        const labelNode = new Node('Label');
        labelNode.setParent(btnNode);
        labelNode.layer = btnNode.layer;
        const labelComp = labelNode.addComponent(Label);
        labelComp.string = label;
        labelComp.fontSize = 16;
        labelComp.color = Color.WHITE;
        labelComp.horizontalAlign = Label.HorizontalAlign.CENTER;
        labelComp.verticalAlign = Label.VerticalAlign.CENTER;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(ACTION_BTN_SIZE.w, ACTION_BTN_SIZE.h);

        return btnNode;
    }

    private setupModeInput() {
        if (this._modeInputSetup) return;
        this._modeInputSetup = true;

        // 监听全局触摸/点击事件
        input.on(Input.EventType.TOUCH_END, this.onModeTouchEnd, this);
        // 监听鼠标右键取消
        input.on(Input.EventType.MOUSE_DOWN, this.onModeMouseDown, this);
        // 监听 ESC 取消
        input.on(Input.EventType.KEY_DOWN, this.onModeKeyDown, this);
    }

    private onModeTouchEnd(event: EventTouch) {
        if (!this._reinforceMode && !this._blastMode) return;

        const touchPos = event.getUILocation();
        const worldPos = this.screenToWorld(touchPos);

        if (this._reinforceMode) {
            this.tryReinforceTurret(worldPos);
        } else if (this._blastMode) {
            this.tryBlastTarget(worldPos);
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

    /** 屏幕坐标 → 世界坐标 */
    private screenToWorld(screenPos: Vec2): Vec3 {
        if (this.worldCamera) {
            return this.worldCamera.screenToWorld(new Vec3(screenPos.x, screenPos.y, 0), new Vec3());
        }
        return new Vec3(screenPos.x, screenPos.y, 0);
    }

    /** 尝试强化炮塔 */
    private tryReinforceTurret(worldPos: Vec3) {
        const turret = this.findTurretAt(worldPos);
        if (!turret) {
            warn('[AttributeUpgradePanel] 未找到炮塔，请点击炮塔');
            return;
        }

        // 强化效果：范围/攻速/攻击 ×1.5
        const t = turret as any;
        t.attackRange = (t.attackRange ?? 1200) * 1.5;
        t.attackInterval = (t.attackInterval ?? 0.5) * (1 / 1.5);
        t.damage = (t.damage ?? 10) * 1.5;

        // 变为紫色
        const sprite = turret.node.getComponent(Sprite);
        if (sprite) {
            sprite.color = new Color(200, 100, 255, 255);
        }

        // 标记升级完成
        const state = this._upgradeStates.get('TurretReinforcement');
        if (state) {
            state.level = 1;
        }
        this.refreshAffectedButtons('TurretReinforcement');

        this.exitReinforceMode();
        warn('[AttributeUpgradePanel] 炮塔强化完成！范围/攻速/攻击 ×1.5');
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
        const target = this.findSchoolBusAt(worldPos);
        if (!target) {
            warn('[AttributeUpgradePanel] 未找到 SchoolBus，请点击 SchoolBus');
            return;
        }

        target.node.destroy();

        const state = this._upgradeStates.get('Blast');
        if (state) {
            state.level = 1;
        }
        this.refreshAffectedButtons('Blast');

        this.exitBlastMode();
        warn('[AttributeUpgradePanel] SchoolBus 已拆除！');
    }

    /** 查找点击位置的 SchoolBus */
    private findSchoolBusAt(worldPos: Vec3): Component | null {
        const scene = this.node.scene;
        if (!scene) return null;
        return this.findSchoolBusRecursive(scene, worldPos, 80);
    }

    private findSchoolBusRecursive(root: Node, worldPos: Vec3, threshold: number): Component | null {
        if (root.name.includes('Bus') || root.name.toLowerCase().includes('schoolbus')) {
            const dist = Vec3.distance(root.worldPosition, worldPos);
            if (dist <= threshold) {
                return root.getComponent(Component) || ({} as Component);
            }
        }
        for (const child of root.children) {
            const found = this.findSchoolBusRecursive(child, worldPos, threshold);
            if (found) return found;
        }
        return null;
    }

    // ==================== 刷新 ====================

    private refreshPointDisplay() {
        if (!this.pointNumberLabel) return;
        const ps = PlayerState.instance;
        const points = ps ? ps.upgradePoints : 0;
        this.pointNumberLabel.string = `${points}`;
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