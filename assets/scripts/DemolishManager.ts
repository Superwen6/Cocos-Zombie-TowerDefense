import {
    _decorator, Color, Component, Node, Vec3, input, Input, EventMouse,
    EventKeyboard, KeyCode, tween, Sprite, director, Camera, warn,
} from 'cc';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { Turret } from './Turret';
import { PlantGenerator } from './PlantGenerator';
import { Container } from './Container';
import { PlayerData } from './PlayerData';
import { BaseSystem } from './BaseSystem';
import { GameHUDUI } from './GameHUDUI';
import { TurretPlacementManager } from './TurretPlacementManager';

const { ccclass, property } = _decorator;

const DEMOLISH_HIGHLIGHT_COLOR = new Color(255, 80, 80, 200);
const DEMOLISH_ANIM_DURATION = 0.3;
const PLANT_CLICK_RADIUS = 80;

@ccclass('DemolishManager')
export class DemolishManager extends Component {
    @property({ type: Camera, tooltip: '世界相机（用于屏幕坐标转世界坐标）' })
    worldCamera: Camera | null = null;

    private _isDemolishMode = false;
    private _highlightedNode: Node | null = null;
    private _originalColors: Map<Node, Color> = new Map();
    private readonly _screenVec = new Vec3();
    private readonly _worldVec = new Vec3();

    start() {
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy() {
        this.exitDemolishMode();
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    public get isDemolishMode(): boolean {
        return this._isDemolishMode;
    }

    /** 进入/退出拆除模式（按钮 onClick 绑定此方法） */
    public toggleDemolishMode() {
        if (this._isDemolishMode) {
            this.exitDemolishMode();
        } else {
            this.enterDemolishMode();
        }
    }

    /** 进入拆除模式 */
    public enterDemolishMode() {
        // 取消当前放置模式，防止两个模式冲突
        TurretPlacementManager.instance?.cancelPlacementPublic();
        this._isDemolishMode = true;
    }

    /** 退出拆除模式 */
    public exitDemolishMode() {
        this._isDemolishMode = false;
        this.clearHighlight();
    }

    private onMouseMove(event: EventMouse) {
        if (!this._isDemolishMode) return;
        const worldPos = this.screenToWorld(event.getLocationX(), event.getLocationY());
        if (!worldPos) {
            this.clearHighlight();
            return;
        }

        const hit = this.findBuildingAt(worldPos);
        if (hit && hit !== this._highlightedNode) {
            this.clearHighlight();
            this._highlightedNode = hit;
            this.highlightBuilding(hit, true);
        } else if (!hit) {
            this.clearHighlight();
        }
    }

    private onMouseDown(event: EventMouse) {
        if (!this._isDemolishMode) return;
        // 右键取消拆除模式
        if (event.getButton() === 2) {
            this.exitDemolishMode();
            return;
        }
        if (event.getButton() !== 0) return;

        if (this._highlightedNode) {
            this.demolishBuilding(this._highlightedNode);
            this.clearHighlight();
            this.exitDemolishMode();
        }
    }

    private onKeyDown(e: EventKeyboard) {
        if (e.keyCode === KeyCode.ESCAPE && this._isDemolishMode) {
            this.exitDemolishMode();
        }
    }

    /** 查找鼠标位置下的建筑（炮塔、发电机或集装箱） */
    private findBuildingAt(worldPos: Vec3): Node | null {
        // 1. 检测炮塔（通过 CollisionWorld）
        const hit = CollisionWorld.instance?.checkHit(
            worldPos.x, worldPos.y, 5, 5, [ColliderGroup.Turret],
        );
        if (hit && hit.node.isValid && hit.node.active) {
            return hit.node;
        }

        // 2. 检测发电机（通过 PlantGenerator.placedMap）
        for (const plant of PlantGenerator.placedMap.values()) {
            if (!plant || !plant.isValid || !plant.isPlaced || !plant.node.active) continue;
            const plantPos = plant.node.worldPosition;
            const dist = Vec3.distance(worldPos, plantPos);
            if (dist < PLANT_CLICK_RADIUS) {
                return plant.node;
            }
        }

        // 3. 检测集装箱（遍历场景中所有 Container 组件）
        const scene = director.getScene();
        if (scene) {
            const containers = scene.getComponentsInChildren(Container);
            for (const container of containers) {
                if (!container || !container.isValid || !container.isPlaced || container.hp <= 0) continue;
                const cPos = container.node.worldPosition;
                const dist = Vec3.distance(worldPos, cPos);
                if (dist < PLANT_CLICK_RADIUS) {
                    return container.node;
                }
            }
        }

        return null;
    }

    /** 拆除建筑 */
    private demolishBuilding(node: Node) {
        const turret = node.getComponent(Turret);
        const plant = node.getComponent(PlantGenerator);
        const container = node.getComponent(Container);

        let costWood = 0;
        let costCopper = 0;
        let costIron = 0;
        let costMoney = 0;

        if (turret) {
            costWood = turret.costWood;
            costCopper = turret.costCopper;
            costIron = turret.costIron;
            costMoney = turret.costMoney;
            // 注销碰撞体，防止动画期间残留碰撞
            turret.unregisterCollider();
        } else if (plant) {
            costWood = plant.costWood;
            costCopper = plant.costCopper;
            costIron = plant.costIron;
            costMoney = plant.costMoney;
            // 从映射表移除
            plant.onDemolish();
        } else if (container) {
            costWood = container.costWood;
            costCopper = container.costCopper;
            costIron = container.costIron;
            costMoney = container.costMoney;
        } else {
            warn('[DemolishManager] 节点上无 Turret、PlantGenerator 或 Container 组件');
            return;
        }

        // 返还资源（按 demolishRefundRate 比例）
        const data = PlayerData.instance;
        const rate = data?.demolishRefundRate ?? 0.5;
        if (data) {
            data.addWood(Math.round(costWood * rate));
            data.addCopper(Math.round(costCopper * rate));
            data.addIron(Math.round(costIron * rate));
            data.addMoney(Math.round(costMoney * rate));
        }

        // 缩放消失动画
        const originalScale = node.scale.clone();
        tween(node)
            .to(DEMOLISH_ANIM_DURATION, { scale: new Vec3(0, 0, 1) })
            .call(() => {
                if (turret) {
                    // 先禁用 Turret 组件，再销毁节点。
                    // 因为 node.destroy() 是异步的，同一帧内 getComponentsInChildren
                    // 仍能找到该节点，导致 updatePowerStatus 计数不更新。
                    turret.enabled = false;
                    node.destroy();
                } else if (plant) {
                    // 发电机是场景预置节点，不能销毁，只能停用并恢复缩放
                    node.active = false;
                    node.setScale(originalScale);
                } else if (container) {
                    // 先禁用 Container 组件，再销毁节点，确保 updatePowerStatus 正确统计
                    container.enabled = false;
                    node.destroy();
                }
                // 更新电力状态
                BaseSystem.instance?.updatePowerStatus();
                // 刷新 HUD
                const hud = director.getScene()?.getComponentInChildren(GameHUDUI);
                hud?.updatePowerUI();
            })
            .start();
    }

    /** 高亮/取消高亮建筑 */
    private highlightBuilding(node: Node, highlight: boolean) {
        if (highlight) {
            this._originalColors.clear();
            this.collectAndSetSpriteColor(node, DEMOLISH_HIGHLIGHT_COLOR);
        } else {
            this.restoreSpriteColors();
        }
    }

    /** 递归收集并设置 Sprite 颜色 */
    private collectAndSetSpriteColor(node: Node, color: Color) {
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            this._originalColors.set(node, sprite.color.clone());
            sprite.color = color;
        }
        for (const child of node.children) {
            this.collectAndSetSpriteColor(child, color);
        }
    }

    /** 恢复所有 Sprite 原有颜色 */
    private restoreSpriteColors() {
        for (const [node, color] of this._originalColors) {
            if (node && node.isValid) {
                const sprite = node.getComponent(Sprite);
                if (sprite) {
                    sprite.color = color;
                }
            }
        }
        this._originalColors.clear();
    }

    /** 清除高亮 */
    private clearHighlight() {
        if (this._highlightedNode) {
            this.restoreSpriteColors();
            this._highlightedNode = null;
        }
    }

    /** 屏幕坐标转世界坐标 */
    private screenToWorld(x: number, y: number): Vec3 | null {
        const cam = this.worldCamera ?? TurretPlacementManager.instance?.worldCamera;
        if (!cam) return null;
        this._screenVec.set(x, y, 0);
        cam.screenToWorld(this._screenVec, this._worldVec);
        this._worldVec.z = 0;
        return this._worldVec;
    }
}