import {
    _decorator,
    Animation,
    AudioClip,
    AudioSource,
    Camera,
    Canvas,
    CCFloat,
    Component,
    EventKeyboard,
    EventMouse,
    EventTouch,
    find,
    input,
    Input,
    instantiate,
    KeyCode,
    Node,
    Prefab,
    screen,
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
import { BaseSystem } from './BaseSystem';
import { Container } from './Container';
import { HealthBar } from './HealthBar';
import { Bullet } from './Bullet';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';
import { CameraFollow } from './CameraFollow';

const { ccclass, property } = _decorator;

/**
 * 主角键盘移动、攻击频率节流与采集/战斗。
 * 集成四方向行走动画：按下 WASD 循环播放，松开停止并显示第一帧。
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({ tooltip: '主角状态组件，不填则从本节点获取' })
    playerState: PlayerState | null = null;

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

    // 死亡动画帧（在编辑器中将 playerfalldown 图集的12张图片拖入）
    @property({ type: [SpriteFrame], tooltip: '死亡动画帧序列，按顺序拖入12张倒地图片' })
    deathFrames: SpriteFrame[] = [];

    @property({ tooltip: '死亡动画每帧持续时间（秒）' })
    deathFrameDuration = 0.1;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 15;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 15;

    @property({ type: Node, tooltip: '坐标系参考节点（与ResourceSpawner一致）' })
    coordinateReference: Node | null = null;

    @property({ type: CCFloat, tooltip: '地图最小 X 坐标（相对于 CoordinateReference）' })
    mapMinX = -2310;

    @property({ type: CCFloat, tooltip: '地图最大 X 坐标（相对于 CoordinateReference）' })
    mapMaxX = 3760;

    @property({ type: CCFloat, tooltip: '地图最小 Y 坐标（相对于 CoordinateReference）' })
    mapMinY = -2710;

    @property({ type: CCFloat, tooltip: '地图最大 Y 坐标（相对于 CoordinateReference）' })
    mapMaxY = 3350;

    @property({ type: Prefab, tooltip: '武器模式子弹预制体（TurretBullet）' })
    weaponBulletPrefab: Prefab | null = null;

    @property({ tooltip: '死亡后自由视角移动速度（像素/秒）' })
    cameraFreeMoveSpeed = 300;

    @property({ type: AudioClip, tooltip: '玩家行走音效' })
    walkSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '空挥攻击音效（未命中任何目标）' })
    waveSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '攻击命中僵尸音效' })
    attackHitSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '玩家受伤音效' })
    hurtSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '玩家死亡音效' })
    deathSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '维修建筑/基地/发电机/集装箱音效' })
    repairSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '武器模式发射子弹音效' })
    weaponFireSound: AudioClip | null = null;

    /** 从 PlayerState 读取攻击/维修范围（可在属性检查器中调整） */
    private get hitRange(): number {
        return this.playerState?.repairRange ?? 50;
    }

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

    // 死亡动画播放状态
    private _isDying = false;
    private _deathFrameIndex = 0;
    private _deathFrameTimer = 0;
    private _deadBodyShown = false;

    // CameraFollow 组件引用，用于死亡时禁用/复活时启用
    private _cameraFollow: CameraFollow | null = null;

    // 自由视角：滚轮缩放
    private _freeCamTargetOrthoHeight = 0;
    private _freeCamOrthoInitialized = false;

    // 玩家音效
    private _audioSource: AudioSource | null = null;
    private _walkSoundPlaying = false;

    // 武器模式射击计时
    private _weaponFireTimer = 0;
    // 持续发射：按住鼠标/触屏时持续射击
    private _isFiring = false;
    private _lastFirePos = new Vec3();

    /** 是否正在播放死亡动画 */
    get isDying(): boolean {
        return this._isDying;
    }

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
            const cameraNode = this.node.getChildByName('WorldCamera')
                ?? this.node.parent?.getChildByName('WorldCamera')
                ?? this.node.scene?.getChildByName('GameWorld')?.getChildByName('WorldCamera');
            if (cameraNode) {
                this.worldCamera = cameraNode.getComponent(Camera);
                this._cameraFollow = cameraNode.getComponent(CameraFollow);
            }
        } else {
            this._cameraFollow = this.worldCamera.node.getComponent(CameraFollow);
        }

        // 初始化音效
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;

        if (this.canvasNode) {
            this._canvasWidget = this.canvasNode.getComponent(Widget);
            this._canvasComponent = this.canvasNode.getComponent(Canvas);
        }

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
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
            offsetY: 0,
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
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
        this.keyPressedMap = {};
    }

    update(dt: number) {
        // 死亡动画播放中（优先级最高，HP为0时也需播放）
        if (this._isDying) {
            this._deathFrameTimer += dt;
            if (this._deathFrameTimer >= this.deathFrameDuration) {
                this._deathFrameTimer = 0;
                this._deathFrameIndex++;
                if (this._deathFrameIndex >= this.deathFrames.length) {
                    this.finishDeathAnimation();
                } else {
                    this.showDeathFrame();
                }
            }
            return; // 死亡时停止所有操作
        }

        if (!this.playerState?.isAlive) {
            if (!this._deadBodyShown) {
                this._deadBodyShown = true;
                this.showDeadBody();
            }
            this.updateCameraFreeMove(dt);
            return;
        }

        // 武器模式：攻击间隔计时 + 持续发射
        if (this.playerState.weaponMode) {
            this._weaponFireTimer += dt;
            if (this._isFiring && this._weaponFireTimer >= this.playerState.weaponAttackInterval) {
                this._weaponFireTimer = 0;
                this.fireWeaponBullet(this._lastFirePos);
            }
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

        // 死亡后不跟随玩家，允许自由视角
        if (!this.playerState?.isAlive) {
            return;
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
            this.stopWalkSound();
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

        // 边界限制（以 CoordinateReference 为基准，考虑 GameWorld 偏移）
        const coordRef = this.coordinateReference ?? find('GameWorld/CoordinateReference');
        const refWorldPos = coordRef?.worldPosition ?? Vec3.ZERO;
        toX = Math.max(refWorldPos.x + this.mapMinX, Math.min(refWorldPos.x + this.mapMaxX, toX));
        toY = Math.max(refWorldPos.y + this.mapMinY, Math.min(refWorldPos.y + this.mapMaxY, toY));

        this._tempPos.set(toX, toY, pos.z);
        this.node.setWorldPosition(this._tempPos);

        this.playWalkAnimation(this._moveDir.x, this._moveDir.y);
        this.playWalkSound();
    }

    /** 死亡后自由视角移动（WASD移动摄像机 + 滚轮缩放） */
    private updateCameraFreeMove(dt: number) {
        if (!this.worldCamera) return;

        const cam = this.worldCamera;
        const camNode = cam.node;

        // 平滑缩放
        const zoomSmooth = 8;
        const factor = 1 - Math.exp(-zoomSmooth * dt);
        cam.orthoHeight += (this._freeCamTargetOrthoHeight - cam.orthoHeight) * factor;

        const moveDir = new Vec3(0, 0, 0);
        if (this.keyPressedMap[KeyCode.KEY_W] || this.keyPressedMap[KeyCode.ARROW_UP]) {
            moveDir.y += 1;
        }
        if (this.keyPressedMap[KeyCode.KEY_S] || this.keyPressedMap[KeyCode.ARROW_DOWN]) {
            moveDir.y -= 1;
        }
        if (this.keyPressedMap[KeyCode.KEY_A] || this.keyPressedMap[KeyCode.ARROW_LEFT]) {
            moveDir.x -= 1;
        }
        if (this.keyPressedMap[KeyCode.KEY_D] || this.keyPressedMap[KeyCode.ARROW_RIGHT]) {
            moveDir.x += 1;
        }

        if (moveDir.x !== 0 || moveDir.y !== 0) {
            moveDir.normalize();
            moveDir.multiplyScalar(this.cameraFreeMoveSpeed * dt);

            const curWorldPos = camNode.worldPosition.clone();
            const newWorldX = curWorldPos.x + moveDir.x;
            const newWorldY = curWorldPos.y + moveDir.y;

            camNode.setWorldPosition(newWorldX, newWorldY, curWorldPos.z);
        }

        // 限制视角在地图边界内（与 CameraFollow._clampCameraToMap 一致）
        this.clampCameraToMap();
    }

    /** 将自由视角相机 clamp 到地图边界内 */
    private clampCameraToMap() {
        if (!this.worldCamera) return;

        const cam = this.worldCamera;
        const coordRef = this.coordinateReference ?? find('GameWorld/CoordinateReference');
        const refPos = coordRef?.worldPosition ?? Vec3.ZERO;
        const minWorldX = refPos.x + this.mapMinX;
        const maxWorldX = refPos.x + this.mapMaxX;
        const minWorldY = refPos.y + this.mapMinY;
        const maxWorldY = refPos.y + this.mapMaxY;

        const orthoHeight = cam.orthoHeight;
        const windowSize = screen.windowSize;
        const aspectRatio = windowSize.width / windowSize.height;
        const halfViewW = orthoHeight * aspectRatio;
        const halfViewH = orthoHeight;

        const mapW = maxWorldX - minWorldX;
        const mapH = maxWorldY - minWorldY;

        const camWorldPos = cam.node.worldPosition.clone();
        let clampedX = camWorldPos.x;
        let clampedY = camWorldPos.y;

        if (halfViewW * 2 >= mapW) {
            clampedX = (minWorldX + maxWorldX) / 2;
        } else {
            clampedX = Math.max(minWorldX + halfViewW, Math.min(maxWorldX - halfViewW, camWorldPos.x));
        }

        if (halfViewH * 2 >= mapH) {
            clampedY = (minWorldY + maxWorldY) / 2;
        } else {
            clampedY = Math.max(minWorldY + halfViewH, Math.min(maxWorldY - halfViewH, camWorldPos.y));
        }

        if (clampedX !== camWorldPos.x || clampedY !== camWorldPos.y) {
            cam.node.setWorldPosition(clampedX, clampedY, camWorldPos.z);
        }
    }

    /** 滚轮缩放（仅在自由视角模式下生效） */
    private onMouseWheel(event: EventMouse) {
        if (this.playerState?.isAlive) return; // 存活时由 CameraFollow 处理

        const scrollY = event.getScrollY();
        const zoomStep = this._cameraFollow?.zoomStep ?? 1.0;
        const minOrtho = this._cameraFollow?.minOrthoHeight ?? 5;
        const maxOrtho = this._cameraFollow?.maxOrthoHeight ?? 50;
        this._freeCamTargetOrthoHeight -= scrollY * 0.001 * zoomStep;
        this._freeCamTargetOrthoHeight = Math.max(minOrtho, Math.min(maxOrtho, this._freeCamTargetOrthoHeight));
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
        this._lastFirePos.set(screenPos.x, screenPos.y, 0);
        this._isFiring = true;
        const worldPos = this.screenToWorldPos(screenPos);
        const isRight = worldPos ? worldPos.x > this.node.worldPosition.x : false;
        this.tryAttack(new Vec3(screenPos.x, screenPos.y, 0), isRight);
    }

    private onMouseUp(_event: { getButton: () => number }) {
        if (_event.getButton() !== 0) return;
        this._isFiring = false;
    }

    private onTouchStart(event: EventTouch) {
        const screenPos = event.getLocation();
        this._lastFirePos.set(screenPos.x, screenPos.y, 0);
        this._isFiring = true;
        const worldPos = this.screenToWorldPos(screenPos);
        const isRight = worldPos ? worldPos.x > this.node.worldPosition.x : false;
        this.tryAttack(new Vec3(screenPos.x, screenPos.y, 0), isRight);
    }

    private onTouchEnd(_event: EventTouch) {
        this._isFiring = false;
    }

    /** 鼠标移动：持续发射时实时更新瞄准方向 */
    private onMouseMove(event: EventMouse) {
        if (!this._isFiring) return;
        this._lastFirePos.set(event.getLocationX(), event.getLocationY(), 0);
    }

    /** 触屏移动：持续发射时实时更新瞄准方向 */
    private onTouchMove(event: EventTouch) {
        if (!this._isFiring) return;
        const loc = event.getLocation();
        this._lastFirePos.set(loc.x, loc.y, 0);
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

        // 武器模式：发射子弹，禁止采矿
        if (state.weaponMode) {
            if (!_clickCanvasPos) return;
            if (this._weaponFireTimer < state.weaponAttackInterval) return;
            this._weaponFireTimer = 0;
            this.fireWeaponBullet(_clickCanvasPos);
            return;
        }

        const playerPos = this.node.worldPosition;

        const zombie = this.findClosestZombieInRange(playerPos);
        if (zombie) {
            zombie.takeDamage(state.attackDamage * state.attackDamageMultiplier);
            // 有目标时：根据目标与玩家的相对位置决定方向
            const targetIsRight = zombie.node.worldPosition.x > playerPos.x;
            this.playAttackAnimation(targetIsRight);
            this.playAttackHitSound();
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

        const building = this.findClosestBuildingInRange(playerPos);
        if (building) {
            this.repairBuilding(building);
            const targetIsRight = building.worldPosition.x > playerPos.x;
            this.playAttackAnimation(targetIsRight);
            return;
        }

        // Fallback: 玩家在基地碰撞矩形内则维修基地
        if (this.tryRepairBaseInRange(playerPos)) {
            return;
        }

        // 没有目标也播放攻击动画（空挥）：使用鼠标点击方向
        this.playAttackAnimation(isRight);
        this.playWaveSound();
    }

    /** 武器模式：向点击位置发射子弹 */
    private fireWeaponBullet(clickScreenPos: Vec3) {
        const state = this.playerState ?? PlayerState.instance;
        if (!state || !this.weaponBulletPrefab || !this.worldCamera) return;

        // 播放武器发射音效
        if (this._audioSource && this.weaponFireSound) {
            this._audioSource.playOneShot(this.weaponFireSound, 1);
        }

        const playerPos = this.node.worldPosition;

        // 屏幕坐标 → 世界坐标
        const worldTarget = this.worldCamera.screenToWorld(
            new Vec3(clickScreenPos.x, clickScreenPos.y, 0), new Vec3());
        worldTarget.z = 0;

        // 方向：玩家 → 点击位置
        const dir = new Vec3();
        Vec3.subtract(dir, worldTarget, playerPos);
        if (dir.lengthSqr() < 0.01) return;
        dir.normalize();

        const bulletNode = instantiate(this.weaponBulletPrefab);
        Bullet.attachToWorld(bulletNode, playerPos.clone());

        const bullet = bulletNode.getComponent(Bullet);
        if (bullet) {
            bullet.setDirection(dir);
            bullet.init(null, state.weaponDamage, this.node, false);
        }
    }

    /** 检测玩家是否在基地碰撞矩形内，若是则维修基地 */
    private tryRepairBaseInRange(playerPos: Vec3): boolean {
        const base = BaseSystem.instance;
        if (!base) return false;

        const baseNode = find('GameWorld/Base');
        if (!baseNode) return false;

        const basePos = baseNode.worldPosition;
        const dx = Math.abs(playerPos.x - basePos.x);
        const dy = Math.abs(playerPos.y - basePos.y);
        if (dx <= base.baseHalfW && dy <= base.baseHalfH) {
            const state = this.playerState ?? PlayerState.instance;
            if (!state) return false;
            this.playRepairSound();
            if (base.baseHp < base.maxBaseHp) {
                base.repairBase(state.repairPerHit);
                this.showBuildingHealthBar(baseNode);
            }
            return true;
        }
        return false;
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

    // ── 死亡动画 ──

    /** 播放死亡帧动画 */
    playDeathAnimation() {
        // 禁用 CameraFollow，允许死亡后自由视角移动
        if (this._cameraFollow) {
            this._cameraFollow.enabled = false;
        }

        // 初始化自由视角 orthoHeight 为死亡时刻的当前值
        if (this.worldCamera) {
            this._freeCamTargetOrthoHeight = this.worldCamera.orthoHeight;
            this._freeCamOrthoInitialized = true;
        }

        // 播放死亡音效
        this.playDeathSound();

        if (!this.bodySprite || this.deathFrames.length === 0) {
            if (this.bodySprite) this.bodySprite.node.active = false;
            return;
        }

        this._isDying = true;
        this.isAttacking = false;

        // 停止行走动画
        if (this.bodyAnim) {
            this.bodyAnim.stop();
            this._currentClip = '';
        }
        // 停止行走音效（修复：行走途中死亡音效持续播放的bug）
        this.stopWalkSound();

        this._deathFrameIndex = 0;
        this._deathFrameTimer = 0;
        this.showDeathFrame();
    }

    private showDeathFrame() {
        if (this._deathFrameIndex < this.deathFrames.length) {
            this.bodySprite.spriteFrame = this.deathFrames[this._deathFrameIndex];
        }
    }

    private finishDeathAnimation() {
        this._isDying = false;
        // 保持最后一帧显示，不隐藏
    }

    /** 读档/死亡旁观时显示尸体最后一帧（不重播音效与相机初始化） */
    showDeadBody() {
        this._isDying = false;
        // 恢复旁观自由视角缩放目标，避免读档后相机缩到 orthoHeight=0
        if (this.worldCamera && this._freeCamTargetOrthoHeight === 0) {
            this._freeCamTargetOrthoHeight = this.worldCamera.orthoHeight;
        }
        // 读档恢复死亡时未走 playDeathAnimation，需禁用 CameraFollow 才能自由移动视角
        if (this._cameraFollow) {
            this._cameraFollow.enabled = false;
        }
        if (!this.bodySprite) return;
        if (this.deathFrames.length > 0) {
            this._deathFrameIndex = this.deathFrames.length - 1;
            this.bodySprite.spriteFrame = this.deathFrames[this._deathFrameIndex];
        } else {
            this.bodySprite.node.active = false;
        }
    }

    /** 复活时恢复玩家显示 */
    respawn() {
        this._isDying = false;
        this._deathFrameIndex = 0;
        this._deathFrameTimer = 0;
        this._deadBodyShown = false;
        this._freeCamOrthoInitialized = false;
        this.showIdleFrame();

        // 重新启用 CameraFollow，恢复相机跟随玩家
        if (this._cameraFollow) {
            this._cameraFollow.enabled = true;
        }
    }

    private showIdleFrame() {
        this._currentClip = '';
        if (this.idleSpriteFrame && this.bodySprite) {
            this.bodySprite.spriteFrame = this.idleSpriteFrame;
        }
    }

    // ── 音效辅助 ──

    private playWalkSound() {
        if (!this._audioSource || !this.walkSound || this._walkSoundPlaying) return;
        this._audioSource.clip = this.walkSound;
        this._audioSource.loop = true;
        this._audioSource.play();
        this._walkSoundPlaying = true;
    }

    private stopWalkSound() {
        if (!this._audioSource || !this._walkSoundPlaying) return;
        this._audioSource.stop();
        this._walkSoundPlaying = false;
    }

    private playWaveSound() {
        if (!this._audioSource || !this.waveSound) return;
        this._audioSource.playOneShot(this.waveSound, 1);
    }

    private playAttackHitSound() {
        if (!this._audioSource || !this.attackHitSound) return;
        this._audioSource.playOneShot(this.attackHitSound, 1);
    }

    /** 由 PlayerState 调用，播放玩家受伤音效 */
    playHurtSound() {
        if (!this._audioSource || !this.hurtSound) return;
        this._audioSource.playOneShot(this.hurtSound, 1);
    }

    private playDeathSound() {
        if (!this._audioSource || !this.deathSound) return;
        this._audioSource.playOneShot(this.deathSound, 1);
    }

    private playRepairSound() {
        if (!this._audioSource || !this.repairSound) return;
        this._audioSource.playOneShot(this.repairSound, 1);
    }

    // ── 搜索辅助 ──

    private findClosestZombieInRange(playerPos: Vec3): ZombieMove | null {
        const zombies = this.collectZombies();
        let closest: ZombieMove | null = null;
        let minDist = Number.MAX_VALUE;

        for (const zombie of zombies) {
            if (!zombie.node.isValid || zombie.isDead || zombie.hp <= 0) {
                continue;
            }
            const dist = Vec3.distance(playerPos, zombie.getHitWorldPosition());
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

    /** 查找玩家攻击范围内最近的建筑（炮塔、发电机、集装箱、基地） */
    private findClosestBuildingInRange(playerPos: Vec3): Node | null {
        const buildings = this.collectBuildings();
        let closest: Node | null = null;
        let minDist = Number.MAX_VALUE;

        for (const node of buildings) {
            if (!node.isValid || !node.active) continue;
            if (!this.isNodeInAttackRange(playerPos, node)) continue;
            const dist = Vec3.distance(playerPos, node.worldPosition);
            if (dist < minDist) {
                minDist = dist;
                closest = node;
            }
        }

        return closest;
    }

    /** 判断建筑节点的碰撞框是否与玩家攻击圆重叠（圆心=玩家位置，半径=hitRange） */
    private isNodeInAttackRange(playerPos: Vec3, node: Node): boolean {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return Vec3.distance(playerPos, node.worldPosition) <= this.hitRange;
        }
        const nodePos = node.worldPosition;
        const scale = node.scale;
        const halfW = transform.width * 0.5 * Math.abs(scale.x);
        const halfH = transform.height * 0.5 * Math.abs(scale.y);

        // 矩形上离玩家最近的点
        const closestX = Math.max(nodePos.x - halfW, Math.min(playerPos.x, nodePos.x + halfW));
        const closestY = Math.max(nodePos.y - halfH, Math.min(playerPos.y, nodePos.y + halfH));

        const dx = playerPos.x - closestX;
        const dy = playerPos.y - closestY;
        return (dx * dx + dy * dy) <= (this.hitRange * this.hitRange);
    }

    /** 维修建筑：回复血量，不消耗资源，显示血条 */
    private repairBuilding(buildingNode: Node) {
        const state = this.playerState ?? PlayerState.instance;
        if (!state) return;

        const repairAmount = state.repairPerHit;

        // 尝试维修炮塔
        const turret = buildingNode.getComponent('Turret') as any;
        if (turret && typeof turret.hp === 'number' && typeof turret.maxHp === 'number') {
            this.playRepairSound();
            if (turret.hp < turret.maxHp) {
                turret.hp = Math.min(turret.maxHp, turret.hp + repairAmount);
                this.showBuildingHealthBar(buildingNode);
            }
            return;
        }

        // 尝试维修发电机
        const plant = buildingNode.getComponent('PlantGenerator') as any;
        if (plant && typeof plant.hp === 'number' && typeof plant.maxHp === 'number') {
            this.playRepairSound();
            if (plant.hp < plant.maxHp) {
                plant.hp = Math.min(plant.maxHp, plant.hp + repairAmount);
                this.showBuildingHealthBar(buildingNode);
            }
            return;
        }

        // 尝试维修集装箱
        const container = buildingNode.getComponent(Container);
        if (container) {
            this.playRepairSound();
            if (container.hp < container.maxHp) {
                container.repair(repairAmount);
                this.showBuildingHealthBar(buildingNode);
            }
            return;
        }

        // 尝试维修基地（包括基地自身及其任意子节点）
        const base = BaseSystem.instance;
        if (base && this.isBaseOrDescendant(buildingNode)) {
            this.playRepairSound();
            if (base.baseHp < base.maxBaseHp) {
                base.repairBase(repairAmount);
                // 查找 Base 节点以显示其血条
                const baseNode = this.findBaseAncestor(buildingNode);
                if (baseNode) {
                    this.showBuildingHealthBar(baseNode);
                }
            }
            return;
        }
    }

    /** 显示建筑的血条 */
    private showBuildingHealthBar(buildingNode: Node) {
        const bar = buildingNode.getComponentInChildren(HealthBar);
        if (bar) {
            bar.show();
        }
    }

    /** 判断节点是否为 Base 或其子孙节点 */
    private isBaseOrDescendant(node: Node): boolean {
        if (node.name === 'Base') return true;
        if (node.parent) return this.isBaseOrDescendant(node.parent);
        return false;
    }

    /** 向上查找 Base 祖先节点 */
    private findBaseAncestor(node: Node): Node | null {
        if (node.name === 'Base') return node;
        if (node.parent) return this.findBaseAncestor(node.parent);
        return null;
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

    private collectBuildings(): Node[] {
        const result: Node[] = [];
        const root = this.resourceSearchRoot ?? this.node.scene;
        if (!root) return result;
        this.walkNodesForBuilding(root, result);
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

    private walkNodesForBuilding(node: Node, out: Node[]) {
        const turret = node.getComponent('Turret');
        const plant = node.getComponent('PlantGenerator');
        const container = node.getComponent(Container);
        const isBase = node.name === 'Base';
        if (turret || plant || container || isBase) {
            out.push(node);
        }
        // Base 的直接子节点（墙体等）也作为可维修建筑收集
        if (node.parent?.name === 'Base' && !turret && !plant && !container && !isBase) {
            out.push(node);
        }
        for (const child of node.children) {
            this.walkNodesForBuilding(child, out);
        }
    }
}
