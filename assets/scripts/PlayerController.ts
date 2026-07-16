import {
    _decorator,
    Animation,
    Camera,
    Canvas,
    CCFloat,
    Component,
    EventKeyboard,
    EventTouch,
    find,
    input,
    Input,
    instantiate,
    KeyCode,
    Node,
    Prefab,
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

const { ccclass, property } = _decorator;

/**
 * 主角键盘移动、攻击频率节流与采集/战斗。
 * 集成四方向行走动画：按下 WASD 循环播放，松开停止并显示第一帧。
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({ type: PlayerState, tooltip: '主角状态组件，不填则从本节点获取' })
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

    // 武器模式射击计时
    private _weaponFireTimer = 0;

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

        // 武器模式：攻击间隔计时
        if (this.playerState.weaponMode) {
            this._weaponFireTimer += dt;
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

        // 边界限制（以 CoordinateReference 为基准，考虑 GameWorld 偏移）
        const coordRef = this.coordinateReference ?? find('GameWorld/CoordinateReference');
        const refWorldPos = coordRef?.worldPosition ?? Vec3.ZERO;
        toX = Math.max(refWorldPos.x + this.mapMinX, Math.min(refWorldPos.x + this.mapMaxX, toX));
        toY = Math.max(refWorldPos.y + this.mapMinY, Math.min(refWorldPos.y + this.mapMaxY, toY));

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
        this.tryAttack(new Vec3(screenPos.x, screenPos.y, 0), isRight);
    }

    private onTouchStart(event: EventTouch) {
        const screenPos = event.getLocation();
        const worldPos = this.screenToWorldPos(screenPos);
        const isRight = worldPos ? worldPos.x > this.node.worldPosition.x : false;
        this.tryAttack(new Vec3(screenPos.x, screenPos.y, 0), isRight);
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

        console.log('[PlayerController] tryAttack, weaponMode:', state.weaponMode, 'isAttacking:', this.isAttacking);

        // 正在攻击动画中，忽略
        if (this.isAttacking) {
            return;
        }

        // 武器模式：发射子弹，禁止采矿
        if (state.weaponMode) {
            console.log('[PlayerController] 武器模式 tryAttack, clickPos:', _clickCanvasPos, 'fireTimer:', this._weaponFireTimer, 'interval:', state.weaponAttackInterval);
            if (!_clickCanvasPos) {
                console.log('[PlayerController] 武器模式：无点击位置，跳过');
                return;
            }
            if (this._weaponFireTimer < state.weaponAttackInterval) {
                console.log('[PlayerController] 武器模式：攻击间隔冷却中');
                return;
            }
            this._weaponFireTimer = 0;
            console.log('[PlayerController] 武器模式：触发 fireWeaponBullet');
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
    }

    /** 武器模式：向点击位置发射子弹 */
    private fireWeaponBullet(clickScreenPos: Vec3) {
        const state = this.playerState ?? PlayerState.instance;
        console.log('[PlayerController] fireWeaponBullet, state:', !!state, 'prefab:', !!this.weaponBulletPrefab, 'camera:', !!this.worldCamera);
        if (!state || !this.weaponBulletPrefab || !this.worldCamera) {
            console.log('[PlayerController] fireWeaponBullet: 缺少依赖，跳过');
            return;
        }

        const playerPos = this.node.worldPosition;

        // 屏幕坐标 → 世界坐标
        const worldTarget = this.worldCamera.screenToWorld(
            new Vec3(clickScreenPos.x, clickScreenPos.y, 0), new Vec3());
        worldTarget.z = 0;

        console.log('[PlayerController] fireWeaponBullet, playerPos:', playerPos, 'worldTarget:', worldTarget);

        // 方向：玩家 → 点击位置
        const dir = new Vec3();
        Vec3.subtract(dir, worldTarget, playerPos);
        if (dir.lengthSqr() < 0.01) {
            console.log('[PlayerController] fireWeaponBullet: 方向太短，跳过');
            return;
        }
        dir.normalize();

        const bulletNode = instantiate(this.weaponBulletPrefab);
        console.log('[PlayerController] fireWeaponBullet, bulletNode:', !!bulletNode);
        bulletNode.setScale(0, 0, 1);
        Bullet.attachToWorld(bulletNode, playerPos.clone());

        const bullet = bulletNode.getComponent(Bullet);
        console.log('[PlayerController] fireWeaponBullet, bullet component:', !!bullet);
        if (bullet) {
            bullet.setDirection(dir);
            bullet.init(null, state.attackDamage * state.attackDamageMultiplier, this.node, false);
            console.log('[PlayerController] fireWeaponBullet: 子弹已发射, damage:', state.attackDamage * state.attackDamageMultiplier);
        }
    }

    /** 检测玩家是否在基地碰撞矩形内，若是则维修基地 */
    private tryRepairBaseInRange(playerPos: Vec3): boolean {
        const base = BaseSystem.instance;
        if (!base || base.baseHp >= base.maxBaseHp) return false;

        const baseNode = find('GameWorld/Base');
        if (!baseNode) return false;

        const basePos = baseNode.worldPosition;
        const dx = Math.abs(playerPos.x - basePos.x);
        const dy = Math.abs(playerPos.y - basePos.y);
        if (dx <= base.baseHalfW && dy <= base.baseHalfH) {
            const state = this.playerState ?? PlayerState.instance;
            if (!state) return false;
            base.repairBase(state.repairPerHit);
            this.showBuildingHealthBar(baseNode);
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
            if (turret.hp >= turret.maxHp) return;
            turret.hp = Math.min(turret.maxHp, turret.hp + repairAmount);
            this.showBuildingHealthBar(buildingNode);
            return;
        }

        // 尝试维修发电机
        const plant = buildingNode.getComponent('PlantGenerator') as any;
        if (plant && typeof plant.hp === 'number' && typeof plant.maxHp === 'number') {
            if (plant.hp >= plant.maxHp) return;
            plant.hp = Math.min(plant.maxHp, plant.hp + repairAmount);
            this.showBuildingHealthBar(buildingNode);
            return;
        }

        // 尝试维修集装箱
        const container = buildingNode.getComponent(Container);
        if (container && container.hp < container.maxHp) {
            container.repair(repairAmount);
            this.showBuildingHealthBar(buildingNode);
            return;
        }

        // 尝试维修基地（包括基地自身及其任意子节点）
        const base = BaseSystem.instance;
        if (base && this.isBaseOrDescendant(buildingNode) && base.baseHp < base.maxBaseHp) {
            base.repairBase(repairAmount);
            // 查找 Base 节点以显示其血条
            const baseNode = this.findBaseAncestor(buildingNode);
            if (baseNode) {
                this.showBuildingHealthBar(baseNode);
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
