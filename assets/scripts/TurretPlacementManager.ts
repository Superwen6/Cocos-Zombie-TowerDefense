import {
    _decorator, Color, Component, Camera, Collider2D, EventKeyboard, EventMouse,
    instantiate, input, Input, KeyCode, Layers, Node, Prefab, Sprite,
    RenderRoot2D, UIOpacity, Vec3, director, log, warn,
} from 'cc';
import { GameHUDUI } from './GameHUDUI';
import { PlayerData } from './PlayerData';
import { Turret } from './Turret';
import { TurretBuildPanelUI } from './TurretBuildPanelUI';
import { NewTurretPanelUI } from './NewTurretPanelUI';
import { PlantGenerator } from './PlantGenerator';
import { MapObstacle } from './MapObstacle';
import { BaseSystem } from './BaseSystem';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { YSortManager } from './YSortManager';

const { ccclass, property } = _decorator;

export interface TurretPlacementCost {
    money: number;
    wood: number;
    copper: number;
    iron: number;
}

export type BuildType = 'turret' | 'plant';

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
    /** plant 模式缓存的 placeCenter（避免每帧实例化预制体） */
    private _plantCenter: Vec3 = new Vec3(0, 0, 0);
    /** plant 模式缓存的 placeRadius */
    private _plantRadius = 100;
    /** plant 模式缓存的 plantId */
    private _plantId = 0;
    /** 是否当前虚影位置有效（可放置） */
    private _placementValid = false;
    /** 诊断日志帧计数器（每30帧打印一次距离） */
    private _diagnoseFrameCounter = 0;

    private readonly _screenVec = new Vec3();
    private readonly _worldVec = new Vec3();

    onLoad() {
        TurretPlacementManager.instance = this;
    }

    start() {
        this.ensureRenderRoot();
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
        // 先尝试 Turret 组件，再尝试 PlantGenerator 组件
        const turret = tempNode.getComponent(Turret);
        const plant = tempNode.getComponent(PlantGenerator);
        let cost: TurretPlacementCost;
        if (turret) {
            cost = { wood: turret.costWood, copper: turret.costCopper, iron: turret.costIron, money: turret.costMoney };
        } else if (plant) {
            cost = { wood: plant.costWood, copper: plant.costCopper, iron: plant.costIron, money: plant.costMoney };
        } else {
            cost = { money: 0, wood: 0, copper: 0, iron: 0 };
        }
        tempNode.destroy();
        return cost;
    }

    public isCurrentlyPlacing(): boolean {
        return this._isPlacing;
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

    // ── 进入放置模式（发电机） ──

    /**
     * 开始放置发电机。
     * @param prefab 发电机预制体
     * @param cost 建造消耗（从 PlantGenerator 读取）
     */
    public startPlantPlacement(prefab: Prefab, cost: TurretPlacementCost) {
        if (!prefab) {
            warn('[TurretPlacementManager] 发电机预制体未配置');
            return;
        }
        // 读取该发电机预制体上的 PlantGenerator 属性，并缓存
        const tempNode = instantiate(prefab);
        const plantComp = tempNode.getComponent(PlantGenerator);
        const plantId = plantComp?.plantId ?? 0;
        if (plantComp) {
            this._plantCenter.set(plantComp.placeCenter);
            this._plantRadius = plantComp.placeRadius;
        }
        this._plantId = plantId;
        tempNode.destroy();

        log(`[PlantDiagnose] startPlantPlacement | plantId=${plantId} | 预制体placeCenter=(${this._plantCenter.x.toFixed(1)}, ${this._plantCenter.y.toFixed(1)}) | radius=${this._plantRadius}`);

        if (PlantGenerator.isPlantPlaced(plantId)) {
            warn(`[TurretPlacementManager] 发电机 ID=${plantId} 已放置，不能重复建造`);
            return;
        }

        this.buildType = 'plant';
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

        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
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
            return this.checkPlantPlacementValidity(worldPos);
        }
        return this.checkTurretPlacementValidity(worldPos);
    }

    /** 炮塔：检查与玩家的距离 */
    private checkTurretPlacementValidity(worldPos: Vec3): boolean {
        const data = PlayerData.instance;
        if (!data) return true; // 无 PlayerData 时默认允许
        const playerNode = data.node;
        if (!playerNode) return true;
        const playerPos = playerNode.worldPosition;
        const dist = Vec3.distance(worldPos, playerPos);
        return dist <= data.buildRadius;
    }

    /** 发电机：检查与 placeCenter 的距离，以及是否已放置（使用缓存值，避免每帧实例化） */
    private checkPlantPlacementValidity(worldPos: Vec3): boolean {
        // 已放置则无效
        if (PlantGenerator.isPlantPlaced(this._plantId)) return false;

        // 距离检测（使用缓存的 placeCenter 和 placeRadius）
        const dist = Vec3.distance(worldPos, this._plantCenter);
        const valid = dist <= this._plantRadius;

        // 每30帧打印一次诊断日志（避免刷屏）
        this._diagnoseFrameCounter++;
        if (this._diagnoseFrameCounter % 30 === 0) {
            log(`[PlantDiagnose] checkPlant | ghostPos=(${worldPos.x.toFixed(1)}, ${worldPos.y.toFixed(1)}) | placeCenter=(${this._plantCenter.x.toFixed(1)}, ${this._plantCenter.y.toFixed(1)}) | dist=${dist.toFixed(1)} | radius=${this._plantRadius} | valid=${valid}`);
        }
        return valid;
    }

    /** 更新虚影颜色：有效→白色，无效→红色 */
    private updateGhostTint(valid: boolean) {
        if (!this.ghostNode) return;
        const color = valid ? GHOST_VALID_COLOR : GHOST_INVALID_COLOR;
        this.setNodeTint(this.ghostNode, color);
    }

    // ── 鼠标点击 ──

    private onMouseDown(event: EventMouse) {
        if (!this._isPlacing || this._justActivatedFrame || event.getButton() !== 0) return;
        if (!this._placementValid) return; // 无效位置不允许放置

        const data = PlayerData.instance;
        if (!data) return;
        if (data.canAfford(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money)) {
            data.spendUpgradeCost(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money);
            this.finalizePlacement();
        }
    }

    private finalizePlacement() {
        if (!this.ghostNode) return;

        const placedPos = this.ghostNode.worldPosition.clone();
        placedPos.z = 0;

        let finalX = placedPos.x;
        let finalY = placedPos.y;
        if (CollisionWorld.instance) {
            const group = this.buildType === 'plant' ? ColliderGroup.Turret : ColliderGroup.Turret;
            const resolved = CollisionWorld.instance.resolvePlacement(
                20, 20, group, finalX, finalY, 200, 8,
            );
            finalX = resolved.x;
            finalY = resolved.y;
        }

        this.ghostNode.active = true;
        this.setNodeOpacity(this.ghostNode, PLACED_OPACITY);
        this.setNodeTint(this.ghostNode, GHOST_VALID_COLOR);
        // 恢复碰撞组件，让实体可以阻挡僵尸
        this.restoreCollisionComponents(this.ghostNode);

        this.ghostNode.setWorldPosition(new Vec3(finalX, finalY, 0));

        // 根据类型处理组件
        if (this.buildType === 'plant') {
            const plant = this.ghostNode.getComponent(PlantGenerator);
            if (plant) {
                plant.markPlaced();
                // 建造完成后通知 BaseSystem 更新电力
                BaseSystem.instance?.updatePowerStatus();
            }
        } else {
            const turret = this.ghostNode.getComponent(Turret);
            if (turret) {
                turret.enabled = true;
                // 建造完成后通知 BaseSystem 更新电力
                BaseSystem.instance?.updatePowerStatus();
            }
        }

        this.ghostNode = null;
        this._isPlacing = false;
        this.unregisterInput();
        this.refreshHud();
    }

    // ── 虚影可视化 ──

    private applyGhostVisual(node: Node) {
        const turret = node.getComponent(Turret);
        if (turret) turret.enabled = false;
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
        if (e.keyCode === KeyCode.ESCAPE) this.cancelPlacement();
    }

    private cancelPlacement() {
        this.ghostNode?.destroy();
        this.ghostNode = null;
        this._isPlacing = false;
        this.unregisterInput();
    }
}