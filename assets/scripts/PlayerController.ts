import {
    _decorator,
    Animation,
    Camera,
    Canvas,
    Component,
    EventKeyboard,
    EventTouch,
    input,
    Input,
    KeyCode,
    Node,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
    warn,
    Widget,
} from 'cc';
import { ResourceItem } from './ResourceItem';
import { PlayerState } from './PlayerState';
import { TurretPlacementManager } from './TurretPlacementManager';
import { ZombieMove } from './ZombieMove';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

/** 攻击/采集检测范围（像素） */
const HIT_RANGE = 50;

/**
 * 主角键盘移动、攻击频率节流与采集/战斗。
 * 集成四方向行走动画：按下 WASD 循环播放，松开停止并显示第一帧。
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({ type: PlayerState, tooltip: '主角状态组件，不填则从本节点获取' })
    playerState: PlayerState | null = null;

    @property({ tooltip: '攻击/采集检测范围（像素）' })
    hitRange = HIT_RANGE;

    @property({ type: Node, tooltip: '搜索资源/僵尸的根节点，不填则搜索整个场景' })
    resourceSearchRoot: Node | null = null;

    @property({ type: Node, tooltip: '摄像机跟随的 Canvas 节点，不填则为 this.node.parent' })
    canvasNode: Node | null = null;

    @property({ type: Camera, tooltip: '世界摄像机，用于屏幕坐标转世界坐标' })
    worldCamera: Camera | null = null;

    @property({ type: Animation, tooltip: '玩家身体 Animation 组件，挂在 Body 节点上' })
    bodyAnim: Animation | null = null;

    @property({ type: Sprite, tooltip: '玩家身体 Sprite 组件，用于初始帧显示' })
    bodySprite: Sprite | null = null;

    @property({ type: SpriteFrame, tooltip: '玩家静止时显示的帧（朝下第一帧）' })
    idleSpriteFrame: SpriteFrame | null = null;

    // 攻击动画帧（在编辑器中将 attcak-ordinary 下的6张图片拖入）
    @property({ type: [SpriteFrame], tooltip: '攻击动画帧序列，按顺序拖入6张攻击图片' })
    attackFrames: SpriteFrame[] = [];

    @property({ tooltip: '攻击动画每帧持续时间（秒），越小越快' })
    attackFrameDuration = 0.083;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 15;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 15;

    private keyPressedMap: Record<number, boolean> = {};
    private _canvasWidget: Widget | null = null;
    private _canvasComponent: Canvas | null = null;
    private _widgetDisabled = false;

    private _moveDir = new Vec3();
    private _tempPos = new Vec3();
    private _currentClip = '';
    private _collider: Collider2D | null = null;

    private isAttacking = false;

    // 攻击动画播放状态
    private attackFrameIndex = 0;
    private attackFrameTimer = 0;

    onLoad() {
        if (!this.playerState) {
            this.playerState = this.getComponent(PlayerState);
        }
        if (!this.playerState) {
            warn('[PlayerController] 未找到 PlayerState 组件');
        }

        if (!this.canvasNode && this.node.parent) {
            this.canvasNode = this.node.parent;
        }

        // 自动查找 WorldCamera
        if (!this.worldCamera) {
            const cameraNode = this.node.getChildByName('WorldCamera');
            if (cameraNode) {
                this.worldCamera = cameraNode.getComponent(Camera);
            }
        }

        if (this.canvasNode) {
            this._canvasWidget = this.canvasNode.getComponent(Widget);
            this._canvasComponent = this.canvasNode.getComponent(Canvas);
        }

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    start() {
        // 游戏开始时显示 idle 帧
        this.showIdleFrame();
        // 注册碰撞体
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x,
            y: wp.y,
            halfW: this.colliderHalfW,
            halfH: this.colliderHalfH,
            group: ColliderGroup.Player,
        };
        CollisionWorld.instance?.register(this._collider);
    }

    onDestroy() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        this.keyPressedMap = {};
    }

    update(dt: number) {
        if (!this.playerState?.isAlive) {
            return;
        }

        // 攻击动画帧更新
        if (this.isAttacking && this.attackFrames.length > 0) {
            this.attackFrameTimer += dt;
            if (this.attackFrameTimer >= this.attackFrameDuration) {
                this.attackFrameTimer = 0;
                this.attackFrameIndex++;
                if (this.attackFrameIndex >= this.attackFrames.length) {
                    this.finishAttackAnimation();
                } else {
                    this.showAttackFrame();
                }
            }
            return; // 攻击时暂停移动
        }

        this.updateKeyboardMove(dt);
    }

    lateUpdate() {
        if (!this.canvasNode) {
            return;
        }

        if (!this._widgetDisabled) {
            if (this._canvasWidget && this._canvasWidget.enabled) {
                this._canvasWidget.enabled = false;
            }
            if (this._canvasComponent && this._canvasComponent.alignCanvasWithScreen) {
                this._canvasComponent.alignCanvasWithScreen = false;
            }
            this._widgetDisabled = true;
        }

        const canvasPos = this.canvasNode.position;
        const playerLocal = this.node.position;

        const uiTransform = this.canvasNode.getComponent(UITransform);
        const halfW = uiTransform ? uiTransform.width * 0.5 : 640;
        const halfH = uiTransform ? uiTransform.height * 0.5 : 360;

        this.canvasNode.setPosition(
            -playerLocal.x + halfW,
            -playerLocal.y + halfH,
            canvasPos.z,
        );
    }

    private onKeyDown(event: EventKeyboard) {
        this.keyPressedMap[event.keyCode] = true;
    }

    private onKeyUp(event: EventKeyboard) {
        this.keyPressedMap[event.keyCode] = false;
    }

    private updateMoveDirectionFromKeys() {
        const isW = this.keyPressedMap[KeyCode.KEY_W] || false;
        const isS = this.keyPressedMap[KeyCode.KEY_S] || false;
        const isA = this.keyPressedMap[KeyCode.KEY_A] || false;
        const isD = this.keyPressedMap[KeyCode.KEY_D] || false;

        let x = 0;
        let y = 0;

        if (isW) {
            y += 1;
        }
        if (isS) {
            y -= 1;
        }
        if (isA) {
            x -= 1;
        }
        if (isD) {
            x += 1;
        }

        this._moveDir.set(x, y, 0);
        if (this._moveDir.lengthSqr() > 0) {
            this._moveDir.normalize();
        }
    }

    private updateKeyboardMove(dt: number) {
        this.updateMoveDirectionFromKeys();

        if (!this.playerState || this._moveDir.lengthSqr() < 1e-6) {
            // 停止移动：停止动画，显示当前方向第一帧
            this.stopWalkAnimation();
            return;
        }

        const speed = this.playerState.getFinalMoveSpeed();
        const step = speed * dt;
        const pos = this.node.worldPosition;
        let toX = pos.x + this._moveDir.x * step;
        let toY = pos.y + this._moveDir.y * step;

        // 碰撞阻挡检测
        if (this._collider) {
            const resolved = CollisionWorld.instance?.resolveMove(
                this._collider,
                pos.x, pos.y,
                toX, toY,
            );
            if (resolved) {
                toX = resolved.x;
                toY = resolved.y;
            }
            this._collider.x = toX;
            this._collider.y = toY;
        }

        this._tempPos.set(toX, toY, pos.z);
        this.node.setWorldPosition(this._tempPos);

        this.playWalkAnimation(this._moveDir.x, this._moveDir.y);
    }

    private playWalkAnimation(dx: number, dy: number) {
        if (!this.bodyAnim) return;

        let clipName: string;
        if (Math.abs(dx) > Math.abs(dy)) {
            clipName = dx > 0 ? 'walk_right' : 'walk_left';
        } else {
            clipName = dy > 0 ? 'walk_up' : 'walk_down';
        }

        // 切换方向时从头播放
        if (this._currentClip !== clipName) {
            this.bodyAnim.play(clipName);
            this._currentClip = clipName;
        }
    }

    private stopWalkAnimation() {
        if (!this.bodyAnim) return;

        this.bodyAnim.stop();
        this._currentClip = '';
        // 停止后显示 idle 帧
        this.showIdleFrame();
    }

    private onMouseDown(event: { getButton: () => number; getLocation: () => Vec3 }) {
        if (event.getButton() !== 0) {
            return;
        }
        const screenPos = event.getLocation();
        const worldPos = this.screenToWorldPos(screenPos);
        const isRight = worldPos ? worldPos.x > this.node.worldPosition.x : false;
        this.tryAttack(null, isRight);
    }

    private onTouchStart(event: EventTouch) {
        const screenPos = event.getLocation();
        const worldPos = this.screenToWorldPos(screenPos);
        const isRight = worldPos ? worldPos.x > this.node.worldPosition.x : false;
        this.tryAttack(null, isRight);
    }

    private screenToWorldPos(screenPos: { x: number; y: number }): Vec3 | null {
        if (!this.worldCamera) return null;
        return this.worldCamera.screenToWorld(new Vec3(screenPos.x, screenPos.y, 0));
    }

    /**
     * 攻击频率节流 + 动画播放。
     * 优先攻击僵尸，其次采集资源。
     * isRight: 点击位置是否在玩家右侧（空挥时使用）
     */
    private tryAttack(_clickCanvasPos: Vec3 | null, isRight: boolean) {
        if (TurretPlacementManager.instance?.isCurrentlyPlacing()) {
            return;
        }

        const state = this.playerState ?? PlayerState.instance;
        if (!state?.isAlive) {
            return;
        }

        // 正在攻击动画中，忽略
        if (this.isAttacking) {
            return;
        }

        const playerPos = this.node.worldPosition;

        const zombie = this.findClosestZombieInRange(playerPos);
        if (zombie) {
            zombie.takeDamage(state.attackDamage);
            // 有目标时：根据目标与玩家的相对位置决定方向
            const targetIsRight = zombie.node.worldPosition.x > playerPos.x;
            this.playAttackAnimation(targetIsRight);
            return;
        }

        const resource = this.findClosestResourceInRange(playerPos);
        if (resource) {
            resource.hit();
            // 有目标时：根据目标与玩家的相对位置决定方向
            const targetIsRight = resource.node.worldPosition.x > playerPos.x;
            this.playAttackAnimation(targetIsRight);
            return;
        }

        // 没有目标也播放攻击动画（空挥）：使用鼠标点击方向
        this.playAttackAnimation(isRight);
    }

    /**
     * 播放攻击动画，根据点击位置自动镜像。
     * isRight: true=点击在右侧，翻转动画; false=点击在左侧，保持原图。
     * 使用代码帧动画方式，不依赖外部 .anim 文件。
     * 攻击帧在编辑器中通过 attackFrames 属性绑定。
     */
    private playAttackAnimation(isRight: boolean) {
        if (!this.bodySprite || !this.bodyAnim) return;

        if (this.attackFrames.length === 0) {
            warn('[PlayerController] 攻击帧未绑定！请在 PlayerController 属性中将 6 张攻击图片拖入 AttackFrames 数组');
            return;
        }

        const scaleX = isRight ? -1 : 1;

        this.isAttacking = true;

        // 停止行走动画
        this.bodyAnim.stop();
        this._currentClip = '';

        // 设置 scaleX 到 Sprite 节点上（保持原始 Y 缩放）
        const spriteNode = this.bodySprite.node;
        const absScaleX = Math.abs(spriteNode.scale.x);
        spriteNode.setScale(scaleX * absScaleX, spriteNode.scale.y, spriteNode.scale.z);

        // 开始帧动画
        this.attackFrameIndex = 0;
        this.attackFrameTimer = 0;
        this.showAttackFrame();
    }

    /**
     * 显示当前攻击帧
     */
    private showAttackFrame() {
        if (this.attackFrameIndex < this.attackFrames.length) {
            this.bodySprite.spriteFrame = this.attackFrames[this.attackFrameIndex];
        }
    }

    /**
     * 攻击动画结束后恢复行走动画
     */
    private finishAttackAnimation() {
        if (!this.bodySprite || !this.bodySprite.node) return;

        this.isAttacking = false;

        // 重置 scaleX 为正方向（保持原始缩放值）
        const spriteNode = this.bodySprite.node;
        const absScaleX = Math.abs(spriteNode.scale.x);
        spriteNode.setScale(absScaleX, spriteNode.scale.y, spriteNode.scale.z);

        // 根据当前是否有按键恢复行走动画
        this.updateMoveDirectionFromKeys();
        if (this._moveDir.lengthSqr() > 1e-6) {
            this.playWalkAnimation(this._moveDir.x, this._moveDir.y);
        } else {
            // 静止时显示 idle 帧（朝下第一帧）
            this.showIdleFrame();
        }
    }

    private showIdleFrame() {
        this._currentClip = '';
        if (this.idleSpriteFrame && this.bodySprite) {
            this.bodySprite.spriteFrame = this.idleSpriteFrame;
        }
    }

    private findClosestZombieInRange(playerPos: Vec3): ZombieMove | null {
        const zombies = this.collectZombies();
        let closest: ZombieMove | null = null;
        let minDist = Number.MAX_VALUE;

        for (const zombie of zombies) {
            if (!zombie.node.isValid || zombie.isDead || zombie.hp <= 0) {
                continue;
            }
            const dist = Vec3.distance(playerPos, zombie.node.worldPosition);
            if (dist <= this.hitRange && dist < minDist) {
                minDist = dist;
                closest = zombie;
            }
        }

        return closest;
    }

    private findClosestResourceInRange(playerPos: Vec3): ResourceItem | null {
        const items = this.collectResourceItems();
        let closest: ResourceItem | null = null;
        let minDist = Number.MAX_VALUE;

        for (const item of items) {
            if (!item.node.isValid || item.hp <= 0) {
                continue;
            }
            const dist = Vec3.distance(playerPos, item.node.worldPosition);
            if (dist <= this.hitRange && dist < minDist) {
                minDist = dist;
                closest = item;
            }
        }

        return closest;
    }

    private collectZombies(): ZombieMove[] {
        const result: ZombieMove[] = [];
        const root = this.resourceSearchRoot ?? this.node.scene;
        if (!root) {
            return result;
        }
        this.walkNodesForZombie(root, result);
        return result;
    }

    private collectResourceItems(): ResourceItem[] {
        const result: ResourceItem[] = [];
        const root = this.resourceSearchRoot ?? this.node.scene;
        if (!root) {
            return result;
        }
        this.walkNodesForResource(root, result);
        return result;
    }

    private walkNodesForZombie(node: Node, out: ZombieMove[]) {
        const zombie = node.getComponent(ZombieMove);
        if (zombie) {
            out.push(zombie);
        }
        for (const child of node.children) {
            this.walkNodesForZombie(child, out);
        }
    }

    private walkNodesForResource(node: Node, out: ResourceItem[]) {
        const item = node.getComponent(ResourceItem);
        if (item) {
            out.push(item);
        }
        for (const child of node.children) {
            this.walkNodesForResource(child, out);
        }
    }
}
