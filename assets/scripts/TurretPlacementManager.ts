import {
    _decorator, Color, Component, Camera, Collider2D, EventKeyboard, EventMouse,
    instantiate, input, Input, KeyCode, Layers, Node, Prefab, Sprite,
    RenderRoot2D, UIOpacity, Vec3, director, warn,
} from 'cc';
import { GameHUDUI } from './GameHUDUI';
import { PlayerData } from './PlayerData';
import { Turret } from './Turret';
import { BaseSystem } from './BaseSystem';
import { TurretBuildPanelUI } from './TurretBuildPanelUI';
import { NewTurretPanelUI } from './NewTurretPanelUI';
import { PlantGenerator } from './PlantGenerator';
import { Container } from './Container';
import { MapObstacle } from './MapObstacle';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { YSortManager } from './YSortManager';
import { HealthBar } from './HealthBar';

const { ccclass, property } = _decorator;

export interface TurretPlacementCost {
    money: number;
    wood: number;
    copper: number;
    iron: number;
}

export type BuildType = 'turret' | 'plant' | 'container';

const GHOST_OPACITY = 128;
const PLACED_OPACITY = 255;
const GHOST_INVALID_COLOR = new Color(255, 80, 80, 255);  // 红色：不可放置
const GHOST_VALID_COLOR = new Color(255, 255, 255, 255);   // 白色：可放置

@ccclass('TurretPlacementManager')
export class TurretPlacementManager extends Component {
    public static instance: TurretPlacementManager = null as any;

    @property({ type: [Prefab], tooltip: '炮塔预制体数组 [0]初级 [1]双管 [2]重型 [3]机枪 [4]迷彩双枪 [5]迷彩火焰 [6]伪装镭射 [7]镭射 [8]机械机枪 [9]机械重炮 [10]未来机甲 [11]未来重炮' })
    turretPrefabs: Prefab[] = [];

    @property({ type: [Prefab], tooltip: '发电机预制体数组 [0]光伏板 [1]光伏矩阵 [2]燃料电机 [3]能源核心。每个预制体的 PlantGenerator.placeCenter 需填写 GameWorld 世界坐标' })
    plantPrefabs: Prefab[] = [];

    @property({ type: Prefab, tooltip: '集装箱预制体' })
    containerPrefab: Prefab | null = null;

    @property({ type: Camera }) worldCamera: Camera | null = null;
    @property({ type: Node, tooltip: '炮塔/发电机挂载父节点，默认 GameWorld' })
    placementRoot: Node | null = null;

    private ghostNode: Node | null = null;
    private _isPlacing = false;
    private activePanel: TurretBuildPanelUI | null = null;
    private _justActivatedFrame = false;
    private currentTurretIndex = 0;
    private currentCost: TurretPlacementCost = { money: 0, wood: 0, copper: 0, iron: 0 };

    /** 当前放置模式 */
    private buildType: BuildType = 'turret';
    /** plant 模式：场景中预置的目标节点（初始 active=false），放置成功时激活 */
    private _plantTargetNode: Node | null = null;
    /** plant 模式缓存的 plantId */
    private _plantId = 0;
    /** 是否当前虚影位置有效（可放置） */
    private _placementValid = false;

    /** 建造进度状态 */
    private _isBuilding = false;
    private _buildTimer = 0;
    /** 建造中的 HealthBar 引用，用于读取其 buildTime 属性 */
    private _buildHealthBar: HealthBar | null = null;
    /** 建造位置（GameWorld 本地坐标，不随 Canvas 移动而漂移） */
    private readonly _buildLocalPos = new Vec3();
    /** 建造过程中的半透明虚影（炮塔模式） */
    private _buildGhostNode: Node | null = null;

    private readonly _screenVec = new Vec3();
    private readonly _worldVec = new Vec3();

    onLoad() {
        TurretPlacementManager.instance = this;
    }

    start() {
        this.ensureRenderRoot();
    }

    update(dt: number) {
        if (!this._isBuilding) return;
        this._buildTimer += dt;
        if (this._buildHealthBar && this._buildTimer >= this._buildHealthBar.buildTime) {
            this.finishBuild();
        }
    }

    /** 确保 GameWorld 节点上有 RenderRoot2D，否则 2D Sprite 无法渲染 */
    private ensureRenderRoot() {
        const root = this.getPlacementRoot();
        if (!root.getComponent(RenderRoot2D)) {
            root.addComponent(RenderRoot2D);
        }
    }

    // ── 公开查询 ──

    public getCurrentPrefab(): Prefab | null {
        return this.turretPrefabs[this.currentTurretIndex] || null;
    }

    public getTurretPrefab(index: number): Prefab | null {
        return this.turretPrefabs[index] || null;
    }

    public getTurretCosts(): TurretPlacementCost {
        return this.getCostsFromPrefab(this.turretPrefabs[this.currentTurretIndex]);
    }

    public getTurretCostsByIndex(index: number): TurretPlacementCost {
        return this.getCostsFromPrefab(this.turretPrefabs[index]);
    }

    public getCostsFromPrefab(prefab: Prefab | null): TurretPlacementCost {
        if (!prefab) return { money: 0, wood: 0, copper: 0, iron: 0 };
        const tempNode = instantiate(prefab);
        // 先尝试 Turret 组件，再尝试 PlantGenerator 组件，最后 Container
        const turret = tempNode.getComponent(Turret);
        const plant = tempNode.getComponent(PlantGenerator);
        const container = tempNode.getComponent(Container);
        let cost: TurretPlacementCost;
        if (turret) {
            cost = { wood: turret.costWood, copper: turret.costCopper, iron: turret.costIron, money: turret.costMoney };
        } else if (plant) {
            cost = { wood: plant.costWood, copper: plant.costCopper, iron: plant.costIron, money: plant.costMoney };
        } else if (container) {
            cost = { wood: container.costWood, copper: container.costCopper, iron: container.costIron, money: container.costMoney };
        } else {
            cost = { money: 0, wood: 0, copper: 0, iron: 0 };
        }
        tempNode.destroy();
        return cost;
    }

    public isCurrentlyPlacing(): boolean {
        return this._isPlacing;
    }

    public get isBuilding(): boolean {
        return this._isBuilding;
    }

    public getBuildType(): BuildType {
        return this.buildType;
    }

    // ── 炮塔选择 ──

    public selectTurret(index: number) {
        if (index < 0 || index >= this.turretPrefabs.length) {
            warn(`[TurretPlacementManager] 无效的炮塔索引: ${index}`);
            return;
        }
        this.currentTurretIndex = index;
        if (this._isPlacing && this.ghostNode) {
            this.ghostNode.destroy();
            this.ghostNode = null;
            this.createGhostNode();
        }
    }

    // ── 进入放置模式（炮塔） ──

    public startPlacement(cost: TurretPlacementCost, panel: TurretBuildPanelUI | null = null) {
        if (this._isBuilding) {
            warn('[TurretPlacementManager] 正在建造中，无法开始新放置');
            return;
        }
        if (BaseSystem.instance?.isPowerOutage) {
            warn('[TurretPlacementManager] 电力不足，无法建造炮塔');
            return;
        }
        const prefab = this.turretPrefabs[this.currentTurretIndex];
        if (!prefab) {
            warn('[TurretPlacementManager] 当前选中炮塔的预制体未配置');
            return;
        }
        this.buildType = 'turret';
        this.currentCost = { ...cost };
        this.activePanel = panel;
        this.createGhostNode();
        this.enterPlacementMode();
    }

    /** 进入放置模式（使用指定预制体，供 NewTurretPanelUI 调用） */
    public startPlacementWithPrefab(prefab: Prefab, cost: TurretPlacementCost, panel: NewTurretPanelUI) {
        if (this._isBuilding) {
            warn('[TurretPlacementManager] 正在建造中，无法开始新放置');
            return;
        }
        if (BaseSystem.instance?.isPowerOutage) {
            warn('[TurretPlacementManager] 电力不足，无法建造炮塔');
            return;
        }
        if (!prefab) {
            warn('[TurretPlacementManager] 预制体未配置');
            return;
        }
        this.buildType = 'turret';
        this.currentCost = { ...cost };
        this.activePanel = panel as unknown as TurretBuildPanelUI;
        this.createGhostNodeWithPrefab(prefab);
        this.enterPlacementMode();
    }

    // ── 进入放置模式（发电机：固定节点激活） ──

    /**
     * 固定节点放置发电机（新方案）。
     * 在场景预置节点位置生成虚影，左键确认激活实体，右键/ESC 取消并退款。
     * @param targetNode 场景中预置的发电机节点（初始 active=false）
     * @param ghostPrefab 用于生成虚影的预制体
     * @param cost 建造消耗（已在 UI 层扣除）
     * @param plantId 发电机 ID
     */
    public startPlantPlacementByNode(targetNode: Node, ghostPrefab: Prefab, cost: TurretPlacementCost, plantId: number) {
        if (this._isBuilding) {
            warn('[TurretPlacementManager] 正在建造中，无法开始新放置');
            return;
        }
        if (!targetNode) {
            warn('[TurretPlacementManager] startPlantPlacementByNode: targetNode 为空');
            return;
        }
        if (PlantGenerator.isPlantPlaced(plantId)) {
            warn(`[TurretPlacementManager] 发电机 ID=${plantId} 已放置，不能重复建造`);
            return;
        }

        this._plantTargetNode = targetNode;
        this._plantId = plantId;
        this.buildType = 'plant';
        this.currentCost = { ...cost };
        this.activePanel = null;

        // 在目标节点位置创建虚影
        this.createGhostNodeWithPrefab(ghostPrefab);
        if (this.ghostNode) {
            this.ghostNode.setWorldPosition(targetNode.worldPosition);
            // 应用发电机预制体上配置的虚影透明度
            const plantComp = this.ghostNode.getComponent(PlantGenerator);
            if (plantComp) {
                const opacity = Math.round(plantComp.ghostOpacity * 255);
                this.setNodeOpacity(this.ghostNode, opacity);
            }
        }

        this.enterPlacementMode();
    }

    // ── 进入放置模式（集装箱：自由放置，类似炮塔） ──

    /**
     * 进入集装箱放置模式。
     * @param prefab 集装箱预制体
     * @param cost 建造消耗
     */
    public startContainerPlacement(prefab: Prefab, cost: TurretPlacementCost) {
        if (this._isBuilding) {
            warn('[TurretPlacementManager] 正在建造中，无法开始新放置');
            return;
        }
        if (BaseSystem.instance?.isPowerOutage) {
            warn('[TurretPlacementManager] 电力不足，无法建造集装箱');
            return;
        }
        if (!prefab) {
            warn('[TurretPlacementManager] 集装箱预制体未配置');
            return;
        }
        this.buildType = 'container';
        this.currentCost = { ...cost };
        this.activePanel = null;
        this.createGhostNodeWithPrefab(prefab);
        this.enterPlacementMode();
    }

    // ── 放置模式公共入口 ──

    private enterPlacementMode() {
        this._placementValid = false;
        this._isPlacing = true;
        this._justActivatedFrame = true;

        if (this.buildType === 'plant') {
            // 固定点放置模式：虚影直接出现在目标节点位置，不跟随鼠标
            this._placementValid = true;
            if (this.ghostNode) {
                this.ghostNode.active = true;
                this.updateGhostTint(true);
            }
            // 延迟清除保护标志，防止按钮双击意外触发放置
            this.scheduleOnce(() => this._justActivatedFrame = false, 0.15);
        } else {
            input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        }

        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    // ── 虚影创建 ──

    private createGhostNode() {
        const prefab = this.turretPrefabs[this.currentTurretIndex];
        if (!prefab) return;
        this.setupGhostNode(prefab);
    }

    private createGhostNodeWithPrefab(prefab: Prefab) {
        this.setupGhostNode(prefab);
    }

    private setupGhostNode(prefab: Prefab) {
        const root = this.getPlacementRoot();
        this.ghostNode = instantiate(prefab);
        this.ghostNode.setParent(root);

        this.ghostNode.active = false;
        this.ghostNode.setScale(1, 1, 1);
        this.ghostNode.layer = Layers.Enum.DEFAULT;
        this.setLayerRecursive(this.ghostNode, Layers.Enum.DEFAULT);

        // 移除虚影上的所有碰撞相关组件，防止推动僵尸
        this.removeCollisionComponents(this.ghostNode);

        this.applyGhostVisual(this.ghostNode);
    }

    /** 递归移除节点及其子节点上的 MapObstacle 和 Collider2D 组件（禁用而非销毁，放置时恢复） */
    private removeCollisionComponents(node: Node) {
        const mapObs = node.getComponent(MapObstacle);
        if (mapObs) mapObs.enabled = false;
        const collider = node.getComponent(Collider2D);
        if (collider) collider.enabled = false;
        node.children.forEach(c => this.removeCollisionComponents(c));
    }

    /** 递归恢复节点及其子节点上的 MapObstacle 和 Collider2D 组件 */
    private restoreCollisionComponents(node: Node) {
        const mapObs = node.getComponent(MapObstacle);
        if (mapObs) mapObs.enabled = true;
        const collider = node.getComponent(Collider2D);
        if (collider) collider.enabled = true;
        node.children.forEach(c => this.restoreCollisionComponents(c));
    }

    // ── 鼠标移动 ──

    private onMouseMove(event: EventMouse) {
        if (!this._isPlacing || !this.ghostNode) return;
        const worldPos = this.screenToWorld(event.getLocationX(), event.getLocationY());
        if (!worldPos) return;

        // 首次鼠标移动时解除放置保护，不再依赖 scheduleOnce
        if (this._justActivatedFrame) {
            this._justActivatedFrame = false;
        }

        if (!this.ghostNode.active) {
            this.ghostNode.active = true;
        }
        this.ghostNode.setWorldPosition(worldPos);

        // 检查放置有效性
        this._placementValid = this.checkPlacementValidity(worldPos);
        this.updateGhostTint(this._placementValid);
    }

    /** 根据当前 buildType 检查虚影位置是否有效 */
    private checkPlacementValidity(worldPos: Vec3): boolean {
        if (this.buildType === 'plant') {
            // 固定点放置：虚影已在目标位置，始终有效
            return !PlantGenerator.isPlantPlaced(this._plantId);
        }
        return this.checkTurretPlacementValidity(worldPos);
    }

    /** 炮塔：检查与玩家的距离，以及墙体视线阻挡 */
    private checkTurretPlacementValidity(worldPos: Vec3): boolean {
        const data = PlayerData.instance;
        if (!data) return true;
        const playerNode = data.node;
        if (!playerNode) return true;
        const playerPos = playerNode.worldPosition;
        const dist = Vec3.distance(worldPos, playerPos);
        if (dist > data.buildRadius) return false;

        // 墙体阻挡判定：检查玩家到虚影之间的视线是否被墙体遮挡
        if (CollisionWorld.instance) {
            if (!CollisionWorld.instance.isLineOfSightClear(playerPos, worldPos, [ColliderGroup.Wall])) {
                return false;
            }
        }

        return true;
    }

    /** 更新虚影颜色：有效→白色，无效→红色 */
    private updateGhostTint(valid: boolean) {
        if (!this.ghostNode) return;
        const color = valid ? GHOST_VALID_COLOR : GHOST_INVALID_COLOR;
        this.setNodeTint(this.ghostNode, color);
    }

    // ── 鼠标点击 ──

    private onMouseDown(event: EventMouse) {
        // 建造进度中：右键取消建造
        if (this._isBuilding) {
            if (event.getButton() === 2) {
                this.cancelBuildProgress();
            }
            return;
        }

        if (!this._isPlacing) return;

        // 右键取消放置
        if (event.getButton() === 2) {
            this.cancelPlacement();
            return;
        }

        if (this._justActivatedFrame || event.getButton() !== 0) return;
        if (!this._placementValid) return;

        const data = PlayerData.instance;
        if (!data) return;
        if (data.canAfford(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money)) {
            data.spendUpgradeCost(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money);
            this.finalizePlacement();
        }
    }

    private finalizePlacement() {
        if (this.buildType === 'plant') {
            // 固定节点放置：保存目标节点在父节点下的本地坐标
            if (this._plantTargetNode) {
                this._buildLocalPos.set(this._plantTargetNode.position);
            }
        } else {
            // 炮塔/集装箱放置：保存虚影在父节点下的本地坐标（不随 Canvas 移动而漂移）
            if (this.ghostNode) {
                this._buildLocalPos.set(this.ghostNode.position);
            }
        }
        this._isPlacing = false;
        this.unregisterInput();
        this.startBuildProgress();
    }

    // ── 虚影可视化 ──

    private applyGhostVisual(node: Node) {
        const turret = node.getComponent(Turret);
        if (turret) turret.enabled = false;
        const container = node.getComponent(Container);
        if (container) container.enabled = false;
        this.setNodeOpacity(node, GHOST_OPACITY);
    }

    private setNodeOpacity(node: Node, opacity: number) {
        let uiOpacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        uiOpacity.opacity = opacity;
        node.children.forEach(c => this.setNodeOpacity(c, opacity));
    }

    /** 递归设置节点 Sprite 颜色 */
    private setNodeTint(node: Node, color: Color) {
        const sprite = node.getComponent(Sprite);
        if (sprite) sprite.color = color;
        node.children.forEach(c => this.setNodeTint(c, color));
    }

    private setCollidersEnabled(node: Node, enabled: boolean) {
        node.getComponent(Collider2D) && (node.getComponent(Collider2D)!.enabled = enabled);
        node.children.forEach(c => this.setCollidersEnabled(c, enabled));
    }

    private setLayerRecursive(node: Node, layer: number) {
        node.layer = layer;
        node.children.forEach(c => this.setLayerRecursive(c, layer));
    }

    // ── 工具方法 ──

    private screenToWorld(x: number, y: number): Vec3 | null {
        if (!this.worldCamera) return null;
        this._screenVec.set(x, y, 0);
        this.worldCamera.screenToWorld(this._screenVec, this._worldVec);
        this._worldVec.z = 0;
        return this._worldVec;
    }

    private getPlacementRoot(): Node {
        const sortLayer = YSortManager.getSortLayer();
        if (sortLayer) {
            return sortLayer;
        }
        const gameWorld = director.getScene()?.getChildByName('GameWorld');
        const mapElements = gameWorld?.getChildByName('MapElements');
        return this.placementRoot ?? mapElements ?? gameWorld ?? this.node;
    }

    private unregisterInput() {
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    private refreshHud() {
        const hud = director.getScene()?.getComponentInChildren(GameHUDUI);
        hud?.refreshHUD();
    }

    private onKeyDown(e: EventKeyboard) {
        if (e.keyCode === KeyCode.ESCAPE) {
            if (this._isBuilding) {
                this.cancelBuildProgress();
            } else {
                this.cancelPlacement();
            }
        }
    }

    private cancelPlacement() {
        // plant 模式：退还已扣除的资源
        if (this.buildType === 'plant') {
            const data = PlayerData.instance;
            if (data) {
                data.refundUpgradeCost(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money);
            }
        }
        this.ghostNode?.destroy();
        this.ghostNode = null;
        this._isPlacing = false;
        this._plantTargetNode = null;
        this.unregisterInput();
    }

    // ── 建造进度 ──

    /** 在节点及其子节点中递归查找 HealthBar 组件 */
    private findHealthBar(node: Node): HealthBar | null {
        const bar = node.getComponent(HealthBar);
        if (bar) return bar;
        for (const child of node.children) {
            const found = this.findHealthBar(child);
            if (found) return found;
        }
        return null;
    }

    /** 启动建造进度条 */
    private startBuildProgress() {
        // 炮塔/集装箱模式：保留虚影作为建造预览
        if ((this.buildType === 'turret' || this.buildType === 'container') && this.ghostNode) {
            this.ghostNode.active = true;
            // 使用本地坐标定位（以 GameWorld/YSortLayer 为基准，不随 Canvas 移动漂移）
            this.ghostNode.setPosition(this._buildLocalPos);
            this.setNodeOpacity(this.ghostNode, 100);
            this._buildGhostNode = this.ghostNode;
            this.ghostNode = null;
        }

        // 发电机模式：保留虚影作为建造预览（targetNode 此时 inactive，需从 ghost 查找 HealthBar）
        if (this.buildType === 'plant' && this.ghostNode) {
            this.ghostNode.active = true;
            this.ghostNode.setPosition(this._buildLocalPos);
            this.setNodeOpacity(this.ghostNode, 100);
            this._buildGhostNode = this.ghostNode;
            this.ghostNode = null;
        }

        // 从虚影/目标节点上查找 HealthBar 组件
        const targetNode = this._buildGhostNode || this._plantTargetNode;
        const bar = targetNode ? this.findHealthBar(targetNode) : null;
        if (bar) {
            // 只对血条自身的 Sprite 子节点恢复完全可见，避免 bar.node 是炮塔根节点时覆盖整个炮塔的透明度
            if (bar.backgroundSprite) {
                this.setNodeOpacity(bar.backgroundSprite.node, 255);
            }
            if (bar.fillSprite) {
                this.setNodeOpacity(bar.fillSprite.node, 255);
            }
            this._buildHealthBar = bar;
            bar.startBuild();
        } else {
            // 没有 HealthBar，跳过进度直接完成建造
            this.finishBuild();
            return;
        }

        this._buildTimer = 0;
        this._isBuilding = true;

        // 建造期间监听取消输入
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    }

    /** 建造完成：将虚影转为真实建筑 */
    private finishBuild() {
        this._isBuilding = false;

        let buildingNode: Node | null = null;

        if (this.buildType === 'plant') {
            if (this._plantTargetNode) {
                this._plantTargetNode.active = true;
                // 使用本地坐标定位（以 GameWorld 为基准）
                this._plantTargetNode.setPosition(this._buildLocalPos);
                const plant = this._plantTargetNode.getComponent(PlantGenerator);
                if (plant) {
                    plant.markPlaced();
                    BaseSystem.instance?.updatePowerStatus();
                }
                buildingNode = this._plantTargetNode;
            }
            this._plantTargetNode = null;

            // 销毁建造期间的虚影（ghost 由 plantPrefab 实例化，与 targetNode 是不同节点）
            if (this._buildGhostNode) {
                this._buildGhostNode.destroy();
                this._buildGhostNode = null;
            }
        } else {
            // 炮塔/集装箱：将虚影转为实体
            if (this._buildGhostNode) {
                const ghost = this._buildGhostNode;
                // 使用虚影当前世界坐标（虚影已随 Canvas/GameWorld 正确移动，此处坐标是准确的）
                const ghostWorldPos = ghost.worldPosition;
                let finalX = ghostWorldPos.x;
                let finalY = ghostWorldPos.y;
                if (CollisionWorld.instance) {
                    const resolved = CollisionWorld.instance.resolvePlacement(
                        20, 20, ColliderGroup.Turret, finalX, finalY, 200, 8,
                    );
                    finalX = resolved.x;
                    finalY = resolved.y;
                }

                ghost.setWorldPosition(new Vec3(finalX, finalY, 0));
                this.setNodeOpacity(ghost, PLACED_OPACITY);
                this.setNodeTint(ghost, GHOST_VALID_COLOR);
                this.restoreCollisionComponents(ghost);

                if (this.buildType === 'container') {
                    const container = ghost.getComponent(Container);
                    if (container) {
                        container.enabled = true;
                        container.onPlaced(); // 立即注册，避免 start() 延迟一帧导致电力统计滞后
                        BaseSystem.instance?.updatePowerStatus();
                    }
                } else {
                    const turret = ghost.getComponent(Turret);
                    if (turret) {
                        turret.enabled = true;
                        BaseSystem.instance?.updatePowerStatus();
                    }
                }
                buildingNode = ghost;
            }
            this._buildGhostNode = null;
        }

        // 从建筑节点上查找 HealthBar，绑定并切换战斗模式
        if (buildingNode) {
            const bar = this.findHealthBar(buildingNode);
            if (bar) {
                bar.bindParent(buildingNode);
                bar.finishBuild();
            }
        }

        this.unregisterInput();
        this.refreshHud();
    }

    /** 取消建造进度：退还资源，销毁虚影 */
    private cancelBuildProgress() {
        this._isBuilding = false;

        this._buildGhostNode?.destroy();
        this._buildGhostNode = null;
        this._plantTargetNode = null;
        this.unregisterInput();

        const data = PlayerData.instance;
        if (data) {
            data.refundUpgradeCost(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money);
        }

        this.refreshHud();
    }

    /** 公开取消放置方法（供 DemolishManager 等外部调用） */
    public cancelPlacementPublic() {
        if (this._isBuilding) {
            this.cancelBuildProgress();
        } else if (this._isPlacing) {
            this.cancelPlacement();
        }
    }
}