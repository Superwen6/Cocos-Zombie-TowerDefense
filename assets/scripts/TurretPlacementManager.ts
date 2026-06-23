import {
    _decorator, Component, Camera, Collider2D, EventKeyboard, EventMouse,
    instantiate, input, Input, KeyCode, Layers, Node, Prefab,
    RenderRoot2D, UIOpacity, Vec3, director, warn,
} from 'cc';
import { GameHUDUI } from './GameHUDUI';
import { PlayerData } from './PlayerData';
import { Turret } from './Turret';
import { TurretBuildPanelUI } from './TurretBuildPanelUI';
import { NewTurretPanelUI } from './NewTurretPanelUI';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { YSortManager } from './YSortManager';

const { ccclass, property } = _decorator;

export interface TurretPlacementCost {
    money: number;
    wood: number;
    copper: number;
    iron: number;
}

const GHOST_OPACITY = 128;
const PLACED_OPACITY = 255;

@ccclass('TurretPlacementManager')
export class TurretPlacementManager extends Component {
    public static instance: TurretPlacementManager = null as any;

    @property({ type: [Prefab], tooltip: '炮塔预制体数组 [0]初级 [1]双管 [2]重型 [3]机枪 [4]迷彩双枪 [5]迷彩火焰 [6]伪装镭射 [7]镭射 [8]机械机枪 [9]机械重炮 [10]未来机甲 [11]未来重炮' })
    turretPrefabs: Prefab[] = [];
    @property({ type: Camera }) worldCamera: Camera | null = null;
    @property({ type: Node, tooltip: '炮塔挂载父节点，默认 GameWorld' })
    placementRoot: Node | null = null;

    private ghostNode: Node | null = null;
    private _isPlacing = false;
    private activePanel: TurretBuildPanelUI | null = null;
    private _justActivatedFrame = false;
    private currentTurretIndex = 0;
    private currentCost: TurretPlacementCost = { money: 0, wood: 0, copper: 0, iron: 0 };

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

    /** 获取当前选中炮塔的预制体 */
    public getCurrentPrefab(): Prefab | null {
        return this.turretPrefabs[this.currentTurretIndex] || null;
    }

    /** 获取指定索引炮塔的预制体 */
    public getTurretPrefab(index: number): Prefab | null {
        return this.turretPrefabs[index] || null;
    }

    /** 获取当前选中炮塔的建造消耗 */
    public getTurretCosts(): TurretPlacementCost {
        return this.getCostsFromPrefab(this.turretPrefabs[this.currentTurretIndex]);
    }

    /** 获取指定索引炮塔的建造消耗 */
    public getTurretCostsByIndex(index: number): TurretPlacementCost {
        return this.getCostsFromPrefab(this.turretPrefabs[index]);
    }

    /** 从任意预制体的 Turret 组件读取建造消耗 */
    public getCostsFromPrefab(prefab: Prefab | null): TurretPlacementCost {
        if (!prefab) return { money: 0, wood: 0, copper: 0, iron: 0 };
        // Prefab 需要先实例化为 Node 才能获取组件
        const tempNode = instantiate(prefab);
        const turret = tempNode.getComponent(Turret);
        const cost = turret
            ? { wood: turret.costWood, copper: turret.costCopper, iron: turret.costIron, money: turret.costMoney }
            : { money: 0, wood: 0, copper: 0, iron: 0 };
        tempNode.destroy(); // 销毁临时节点
        return cost;
    }

    public isCurrentlyPlacing(): boolean {
        return this._isPlacing;
    }

    /** 切换当前选择的炮塔类型 */
    public selectTurret(index: number) {
        if (index < 0 || index >= this.turretPrefabs.length) {
            warn(`[TurretPlacementManager] 无效的炮塔索引: ${index}`);
            return;
        }
        this.currentTurretIndex = index;
        // 如果正在放置中，重置虚影为新的炮塔预制体
        if (this._isPlacing && this.ghostNode) {
            this.ghostNode.destroy();
            this.ghostNode = null;
            this.createGhostNode();
        }
    }

    /** 进入放置模式（使用当前选中的炮塔） */
    public startPlacement(cost: TurretPlacementCost, panel: TurretBuildPanelUI | null = null) {
        const prefab = this.turretPrefabs[this.currentTurretIndex];
        if (!prefab) {
            warn('[TurretPlacementManager] 当前选中炮塔的预制体未配置');
            return;
        }
        this.currentCost = { ...cost };
        this.activePanel = panel;
        this.createGhostNode();
        this._isPlacing = true;
        this._justActivatedFrame = true;
        this.scheduleOnce(() => this._justActivatedFrame = false, 0.1);

        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    /** 进入放置模式（使用指定预制体，供 NewTurretPanelUI 调用） */
    public startPlacementWithPrefab(prefab: Prefab, cost: TurretPlacementCost, panel: NewTurretPanelUI) {
        if (!prefab) {
            warn('[TurretPlacementManager] 预制体未配置');
            return;
        }
        this.currentCost = { ...cost };
        this.activePanel = panel as unknown as TurretBuildPanelUI;
        this.createGhostNodeWithPrefab(prefab);
        this._isPlacing = true;
        this._justActivatedFrame = true;
        this.scheduleOnce(() => this._justActivatedFrame = false, 0.1);

        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    /** 创建当前选中炮塔的虚影节点 */
    private createGhostNode() {
        const prefab = this.turretPrefabs[this.currentTurretIndex];
        if (!prefab) return;

        const root = this.getPlacementRoot();
        this.ghostNode = instantiate(prefab);
        this.ghostNode.setParent(root);

        this.ghostNode.active = true;
        this.ghostNode.setScale(1, 1, 1);
        this.ghostNode.layer = Layers.Enum.DEFAULT;
        this.setLayerRecursive(this.ghostNode, Layers.Enum.DEFAULT);

        this.applyGhostVisual(this.ghostNode);
    }

    /** 使用指定预制体创建虚影节点 */
    private createGhostNodeWithPrefab(prefab: Prefab) {
        const root = this.getPlacementRoot();
        this.ghostNode = instantiate(prefab);
        this.ghostNode.setParent(root);

        this.ghostNode.active = true;
        this.ghostNode.setScale(1, 1, 1);
        this.ghostNode.layer = Layers.Enum.DEFAULT;
        this.setLayerRecursive(this.ghostNode, Layers.Enum.DEFAULT);

        this.applyGhostVisual(this.ghostNode);
    }

    private onMouseMove(event: EventMouse) {
        if (!this._isPlacing || !this.ghostNode) return;
        const worldPos = this.screenToWorld(event.getLocationX(), event.getLocationY());
        if (worldPos) this.ghostNode.setWorldPosition(worldPos);
    }

    private onMouseDown(event: EventMouse) {
        if (!this._isPlacing || this._justActivatedFrame || event.getButton() !== 0) return;
        const data = PlayerData.instance;
        if (data?.canAfford(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money)) {
            data.spendUpgradeCost(this.currentCost.wood, this.currentCost.copper, this.currentCost.iron, this.currentCost.money);
            this.finalizePlacement();
        }
    }

    private finalizePlacement() {
        if (!this.ghostNode) return;

        // 保持鼠标放置时的世界坐标
        const placedPos = this.ghostNode.worldPosition.clone();
        placedPos.z = 0;

        // 碰撞检测：避免炮塔建在其他物体上
        let finalX = placedPos.x;
        let finalY = placedPos.y;
        if (CollisionWorld.instance) {
            const resolved = CollisionWorld.instance.resolvePlacement(
                20, 20, ColliderGroup.Turret, finalX, finalY, 200, 8,
            );
            finalX = resolved.x;
            finalY = resolved.y;
        }

        this.ghostNode.active = true;
        this.setNodeOpacity(this.ghostNode, PLACED_OPACITY);
        this.setCollidersEnabled(this.ghostNode, true);

        // 设置最终位置
        this.ghostNode.setWorldPosition(new Vec3(finalX, finalY, 0));

        const turret = this.ghostNode.getComponent(Turret);
        if (turret) turret.enabled = true;

        this.ghostNode = null;
        this._isPlacing = false;
        this.unregisterInput();
        this.refreshHud();
    }

    private applyGhostVisual(node: Node) {
        const turret = node.getComponent(Turret);
        if (turret) turret.enabled = false;
        this.setNodeOpacity(node, GHOST_OPACITY);
        this.setCollidersEnabled(node, false);
    }

    private setNodeOpacity(node: Node, opacity: number) {
        let uiOpacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        uiOpacity.opacity = opacity;
        node.children.forEach(c => this.setNodeOpacity(c, opacity));
    }

    private setCollidersEnabled(node: Node, enabled: boolean) {
        node.getComponent(Collider2D) && (node.getComponent(Collider2D)!.enabled = enabled);
        node.children.forEach(c => this.setCollidersEnabled(c, enabled));
    }

    private setLayerRecursive(node: Node, layer: number) {
        node.layer = layer;
        node.children.forEach(c => this.setLayerRecursive(c, layer));
    }

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