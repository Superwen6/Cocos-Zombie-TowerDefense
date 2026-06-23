import {
    _decorator, Color, Component, Camera, Collider2D, EventKeyboard, EventMouse,
    instantiate, input, Input, KeyCode, Layers, Node, Prefab, Sprite,
    RenderRoot2D, UIOpacity, Vec3, director, warn,
} from 'cc';
import { GameHUDUI } from './GameHUDUI';
import { PlayerData } from './PlayerData';
import { Turret } from './Turret';
import { TurretBuildPanelUI } from './TurretBuildPanelUI';
import { NewTurretPanelUI } from './NewTurretPanelUI';
import { PlantGenerator } from './PlantGenerator';
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

    @property({ type: [Prefab], tooltip: '发电机预制体数组 [0]光伏板 [1]光伏矩阵 [2]燃料电机 [3]能源核心' })
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
    /** plant 模式下使用的预制体 */
    private currentPlantPrefab: Prefab | null = null;
    /** 是否当前虚影位置有效（可放置） */
    private _placementValid = false;

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
        // 检查该发电机是否已放置
        const tempNode = instantiate(prefab);
        const plantComp = tempNode.getComponent(PlantGenerator);
        const plantId = plantComp?.plantId ?? 0;
        tempNode.destroy();

        if (PlantGenerator.isPlantPlaced(plantId)) {
            warn(`[TurretPlacementManager] 发电机 ID=${plantId} 已放置，不能重复建造`);
            return;
        }

        this.buildType = 'plant';
        this.currentPlantPrefab = prefab;
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
        this.scheduleOnce(() => this._justActivatedFrame = false, 0.1);

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

        this.applyGhostVisual(this.ghostNode);
    }

    // ── 鼠标移动 ──

    private onMouseMove(event: EventMouse) {
        if (!this._isPlacing || !this.ghostNode) return;
        const worldPos = this.screenToWorld(event.getLocationX(), event.getLocationY());
        if (!worldPos) return;

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

    /** 发电机：检查与 placeCenter 的距离，以及是否已放置 */
    private checkPlantPlacementValidity(worldPos: Vec3): boolean {
        if (!this.currentPlantPrefab) return false;
        // 读取发电机预制体上的 PlantGenerator 组件
        const temp = instantiate(this.currentPlantPrefab);
        const plant = temp.getComponent(PlantGenerator);
        if (!plant) {
            temp.destroy();
            return false;
        }
        const center = plant.placeCenter;
        const radius = plant.placeRadius;
        const plantId = plant.plantId;
        temp.destroy();

        // 已放置则无效
        if (PlantGenerator.isPlantPlaced(plantId)) return false;

        // 距离检测
        const dist = Vec3.distance(worldPos, center);
        return dist <= radius;
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
        if (data?.canAfford(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money)) {
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
        this.setCollidersEnabled(this.ghostNode, true);

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
        const plant = node.getComponent(PlantGenerator);
        if (plant) {
            // 发电机初始不标记为已放置
        }
        this.setNodeOpacity(node, GHOST_OPACITY);
        this.setCollidersEnabled(node, false);
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