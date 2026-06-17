import {
    _decorator, Component, Camera, Collider2D, EventKeyboard, EventMouse,
    instantiate, input, Input, KeyCode, Layers, Node, Prefab,
    RenderRoot2D, UIOpacity, Vec3, director
} from 'cc';
import { GameHUDUI } from './GameHUDUI';
import { PlayerData } from './PlayerData';
import { Turret } from './Turret';
import { TurretBuildPanelUI } from './TurretBuildPanelUI';
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

    @property({ type: Prefab }) turretPrefab: Prefab | null = null;
    @property({ type: Camera }) worldCamera: Camera | null = null;
    @property({ type: Node, tooltip: '炮塔挂载父节点，默认 GameWorld' })
    placementRoot: Node | null = null;

    @property({ tooltip: '建造消耗-木头' })
    costWood: number = 0;

    @property({ tooltip: '建造消耗-铁矿' })
    costIron: number = 2;

    @property({ tooltip: '建造消耗-铜矿' })
    costCopper: number = 0;

    @property({ tooltip: '建造消耗-金币' })
    costMoney: number = 5;

    private ghostNode: Node | null = null;
    private _isPlacing = false;
    private activePanel: TurretBuildPanelUI | null = null;
    private _justActivatedFrame = false;
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

    public getTurretCosts(): TurretPlacementCost {
        return {
            money: this.costMoney,
            wood: this.costWood,
            copper: this.costCopper,
            iron: this.costIron,
        };
    }

    public isCurrentlyPlacing(): boolean {
        return this._isPlacing;
    }

    public startPlacement(cost: TurretPlacementCost, panel: TurretBuildPanelUI | null = null) {
        if (!this.turretPrefab) return;
        this.currentCost = { ...cost };
        this.activePanel = panel;

        const root = this.getPlacementRoot();
        this.ghostNode = instantiate(this.turretPrefab);
        this.ghostNode.setParent(root);

        this.ghostNode.active = true;
        this.ghostNode.setScale(1, 1, 1);
        this.ghostNode.layer = Layers.Enum.DEFAULT;
        this.setLayerRecursive(this.ghostNode, Layers.Enum.DEFAULT);

        this.applyGhostVisual(this.ghostNode);
        this._isPlacing = true;
        this._justActivatedFrame = true;
        this.scheduleOnce(() => this._justActivatedFrame = false, 0.1);

        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
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