import { _decorator, CCFloat, CCInteger, Component, Node, randomRange, Sprite, SpriteFrame, Vec3, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';
import { PlantGenerator } from './PlantGenerator';
import { Container } from './Container';
import { Turret } from './Turret';

const { ccclass, property } = _decorator;

/** 拉扯距离：玩家超出此范围会放弃追击 */
const LEASH_RADIUS = 350;
/** 玩家记忆：失去视线后继续追击的时长（秒） */
const MEMORY_DURATION = 3.0;
/** 记忆期内移动速度倍率 */
const MEMORY_SPEED_FACTOR = 0.8;
/** 脱困判定：连续卡住多少秒触发随机脱困 */
const STUCK_TIMEOUT = 1.5;
/** 脱困随机移动距离 */
const STUCK_ESCAPE_DIST = 30;

/** 白天游荡：巡逻点刷新间隔（秒） */
const WANDER_REPICK_INTERVAL = 4;
/** 白天游荡：巡逻点半径范围（相对圆心） */
const WANDER_PATROL_RADIUS_MIN = 700;
const WANDER_PATROL_RADIUS_MAX = 1000;
/** 白天游荡：到达巡逻点判定距离 */
const WANDER_ARRIVE_DIST = 30;

/** 动画帧配置 */
const WALK_FRAME_DURATION = 0.15;
const DEATH_FRAME_DURATION = 0.15;

/** AI 状态枚举 */
type AIState =
    | 'WANDER'           // 白天游荡巡逻
    | 'CHASE_BASE'       // 夜间僵尸初始：追击基地
    | 'ATTACK_BASE'      // 攻击基地
    | 'CHASE_PLAYER'     // 追击玩家（死磕模式，LEASH_RADIUS 退出）
    | 'ATTACK_PLAYER'    // 攻击玩家
    | 'CHASE_BUILDING'   // 白天游荡索敌：追击建筑
    | 'ATTACK_BUILDING'  // 攻击建筑
    | 'CHASE_TURRET'     // 被炮塔攻击→追击炮塔
    | 'ATTACK_TURRET'    // 攻击炮塔
    | 'MEMORY_TRACK'     // 夜间僵尸：失去玩家视线后记忆追踪
    | 'DEAD';            // 死亡

/**
 * 僵尸动态 AI：完整状态机 + 侧向寻路 + 玩家记忆 + 受击嘲讽。
 * 集成序列帧动画：行走、攻击、死亡，自动镜像。
 */
@ccclass('ZombieMove')
export class ZombieMove extends Component {
    @property({ type: CCInteger, tooltip: '僵尸初始最大血量' })
    maxHp = 100;

    @property({ type: CCInteger, tooltip: '僵尸初始攻击力' })
    damage = 10;

    @property({ type: CCFloat, tooltip: '僵尸移动速度（像素/秒）' })
    moveSpeed = 120;

    @property({ type: CCFloat, tooltip: '攻击距离（像素）' })
    attackRange = 40;

    @property({ type: CCFloat, tooltip: '感知玩家距离（像素）', min: 100, max: 500 })
    alertRadius = 300;

    /** 白天外围游荡僵尸：不冲基地，仅巡逻 */
    isDayWanderer = false;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 15;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 15;

    hp = 100;
    isDead = false;

    @property({ type: Node, tooltip: '基地节点，不填则查找名为 Base 的节点' })
    baseNode: Node | null = null;

    @property({ tooltip: '基地节点名（自动查找）' })
    baseNodeName = 'Base';

    @property({ type: Node, tooltip: '白天游荡圆心，不填则用基地位置' })
    wanderOrigin: Node | null = null;

    @property({ type: Sprite, tooltip: '僵尸身体 Sprite 组件，用于帧动画显示' })
    bodySprite: Sprite | null = null;

    // 动画帧序列（在编辑器中绑定）
    @property({ type: [SpriteFrame], tooltip: '行走动画帧序列' })
    walkFrames: SpriteFrame[] = [];

    @property({ type: [SpriteFrame], tooltip: '攻击动画帧序列' })
    attackFrames: SpriteFrame[] = [];

    @property({ type: CCFloat, tooltip: '攻击动画每帧持续时间（秒），越小越快' })
    attackFrameDuration = 0.1;

    @property({ type: [SpriteFrame], tooltip: '死亡动画帧序列' })
    deathFrames: SpriteFrame[] = [];

    // ========== 私有变量 ==========

    /** 当前 AI 状态 */
    private _aiState: AIState = 'CHASE_BASE';

    private _baseNode: Node | null = null;
    private _wanderTimer = 0;
    private readonly _wanderTarget = new Vec3();
    private _hasWanderTarget = false;
    private readonly _tempDir = new Vec3();
    private readonly _tempPos = new Vec3();

    // 玩家记忆系统
    private readonly _lastKnownPlayerPos = new Vec3();
    private _memoryTimer = 0;

    // 卡住检测系统
    private _stuckTimer = 0;
    private _lastX = 0;
    private _lastY = 0;

    // 攻击冷却
    private _attackCooldown = 0;

    // 建筑/炮塔目标
    private _buildingTarget: Node | null = null;

    /** 首次攻击僵尸的炮塔（锁定后忽略其他炮塔攻击，防止多炮塔来回折返） */
    private _hatedTurret: Node | null = null;

    // 白天游荡索敌计时器
    private _wanderScanTimer = 0;

    // 动画状态
    private _animFrameIndex = 0;
    private _animFrameTimer = 0;
    private _attackAnimFinished = false;
    private _deathAnimFinished = false;
    private _walkMirror = 1; // 当前行走镜像：1=原方向（左），-1=镜像（右）
    private _isAttackAnimPlaying = false; // 防止每帧重置攻击动画
    private _collider: Collider2D | null = null;

    // ========== 生命周期 ==========

    onLoad() {
        this.resolveBaseNode();
        this.syncHpFromMaxHp();
        this._aiState = this.isDayWanderer ? 'WANDER' : 'CHASE_BASE';
    }

    start() {
        this.syncHpFromMaxHp();
        // 注册碰撞体
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x,
            y: wp.y,
            halfW: this.colliderHalfW,
            halfH: this.colliderHalfH,
            group: ColliderGroup.Zombie,
        };
        CollisionWorld.instance?.register(this._collider);

        if (this.isDayWanderer) {
            this.pickNewWanderTarget();
        }
        // 记录初始位置用于卡住检测
        this._lastX = wp.x;
        this._lastY = wp.y;
        // 默认播放行走动画
        this.playWalkAnimation(0);
    }

    onDestroy() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
    }

    /**
     * @param asDayWanderer 白天外围游荡模式（不拆家）
     */
    init(targetBase: Node, speed?: number, asDayWanderer = false) {
        this.baseNode = targetBase;
        this._baseNode = targetBase;
        if (speed !== undefined) {
            this.moveSpeed = speed;
        }
        this.isDayWanderer = asDayWanderer;
        this.syncHpFromMaxHp();
        this._buildingTarget = null;
        this._hatedTurret = null;
        this._wanderScanTimer = 0;
        this._memoryTimer = 0;
        this._hasWanderTarget = false;
        this._aiState = asDayWanderer ? 'WANDER' : 'CHASE_BASE';

        if (asDayWanderer) {
            this.pickNewWanderTarget();
        }
    }

    private syncHpFromMaxHp() {
        this.hp = this.maxHp;
    }

    update(dt: number) {
        if (this.isDead) {
            this.updateDeathAnimation(dt);
            return;
        }

        // 帧动画更新
        this.updateWalkAnimation(dt);
        this.updateAttackAnimation(dt);

        if (!this._baseNode) {
            this.resolveBaseNode();
        }

        // 递减攻击冷却
        if (this._attackCooldown > 0) {
            this._attackCooldown -= dt;
        }

        // 更新记忆计时器
        if (this._memoryTimer > 0) {
            this._memoryTimer -= dt;
        }

        // 卡住检测
        this.updateStuckDetection(dt);

        // 白天游荡者：仅在 WANDER 状态下巡逻 + 索敌
        if (this.isDayWanderer) {
            if (this._aiState === 'WANDER') {
                this._wanderScanTimer -= dt;
                if (this._wanderScanTimer <= 0) {
                    this._wanderScanTimer = 1.0 + Math.random() * 1.0; // 1~2 秒扫描一次
                    this.scanForBuildings();
                }
                this.tickDayWander(dt);
                return;
            }
            // 其他状态（追击玩家/建筑/炮塔）：走通用状态机
            this.updateAIState();
            this.tickMoveByState(dt);
            return;
        }

        // 夜间僵尸：通用状态机
        this.updateAIState();
        this.tickMoveByState(dt);
    }

    // ========== 受击系统 ==========

    /** 回到预定目标：游荡僵尸→WANDER（会自动扫建筑），夜间僵尸→CHASE_BASE */
    private returnToDefaultTarget() {
        this._hatedTurret = null;
        this._buildingTarget = null;
        this._memoryTimer = 0;
        if (this.isDayWanderer) {
            this._aiState = 'WANDER';
            this.pickNewWanderTarget();
        } else {
            this._aiState = 'CHASE_BASE';
        }
    }

    takeDamage(amount: number, attackerNode?: Node) {
        if (this.isDead || this.hp <= 0 || amount <= 0) {
            return;
        }

        this.hp = Math.max(0, this.hp - amount);
        this._hasWanderTarget = false;

        // 检查攻击来源是否为炮塔
        const turretNode = this.getTurretOwner(attackerNode);

        if (turretNode) {
            // 玩家嘲讽霸体：处于追击/攻击玩家状态时，绝对无视炮塔攻击
            if (this._aiState === 'CHASE_PLAYER' || this._aiState === 'ATTACK_PLAYER') {
                // 无视炮塔
            }
            // 已锁定某座炮塔 → 忽略其他炮塔的攻击，防止多炮塔来回折返
            else if (this._hatedTurret && this._hatedTurret.isValid && turretNode !== this._hatedTurret) {
                // 忽略其他炮塔，死磕当前目标
            }
            // 首次被炮塔攻击，或之前锁定的炮塔已销毁 → 锁定新炮塔
            else {
                this._hatedTurret = turretNode;
                this._buildingTarget = turretNode;
                this._aiState = 'CHASE_TURRET';
                this._memoryTimer = 0;
            }
        } else {
            // 玩家攻击（最高优先级）：立即清空炮塔仇恨，死磕玩家
            const playerNode = this.getPlayerNode();
            if (playerNode && this.isPlayerAlive()) {
                this._hatedTurret = null;
                this._lastKnownPlayerPos.set(playerNode.worldPosition);
                this._memoryTimer = MEMORY_DURATION;
                this._aiState = 'CHASE_PLAYER';
                this._buildingTarget = null;
            }
        }

        if (this.hp <= 0 && !this.isDead) {
            this.enterDeathState();
        }
    }

    /** 检查节点是否为炮塔（或其子弹的发射者），返回炮塔 node */
    private getTurretOwner(node?: Node): Node | null {
        if (!node || !node.isValid) return null;
        if (node.getComponent('Turret')) return node;
        let parent = node.parent;
        while (parent) {
            if (parent.getComponent('Turret')) return parent;
            parent = parent.parent;
        }
        return null;
    }

    // ========== 白天游荡索敌 ==========

    /** 白天游荡者：扫描范围内最近的非防御性建筑（发电机/集装箱），锁定并追击 */
    private scanForBuildings() {
        const selfPos = this.node.worldPosition;
        let nearest: Node | null = null;
        let nearestDist = this.alertRadius;

        this.findNonDefensiveBuildings(this.node.scene ?? this.node, (node) => {
            const d = Vec3.distance(selfPos, node.worldPosition);
            if (d < nearestDist) {
                const lineClear = CollisionWorld.instance?.isLineOfSightClear(
                    selfPos, node.worldPosition, [ColliderGroup.Wall],
                );
                if (lineClear) {
                    nearestDist = d;
                    nearest = node;
                }
            }
        });

        if (nearest) {
            this._buildingTarget = nearest;
            this._aiState = 'CHASE_BUILDING';
            this._memoryTimer = 0;
        }
    }

    /** 递归查找场景中已建成的非防御性建筑：发电机、集装箱（游荡僵尸预定目标） */
    private findNonDefensiveBuildings(root: Node, callback: (node: Node) => void) {
        const plant = root.getComponent(PlantGenerator);
        if (plant && plant.isPlaced) {
            callback(root);
        }
        const container = root.getComponent(Container);
        if (container && container.enabled) {
            callback(root);
        }
        for (const child of root.children) {
            this.findNonDefensiveBuildings(child, callback);
        }
    }

    /** 递归查找场景中所有已建成的可攻击建筑：炮塔、发电机、集装箱、基地 */
    private findTargetableBuildings(root: Node, callback: (node: Node) => void) {
        // 只扫描已建成的建筑
        const turret = root.getComponent(Turret);
        if (turret && turret.enabled) {
            callback(root);
        }
        const plant = root.getComponent(PlantGenerator);
        if (plant && plant.isPlaced) {
            callback(root);
        }
        const container = root.getComponent(Container);
        if (container && container.enabled) {
            callback(root);
        }
        // 基地节点
        if (this._baseNode && root === this._baseNode) {
            callback(root);
        }
        for (const child of root.children) {
            this.findTargetableBuildings(child, callback);
        }
    }

    // ========== AI 状态更新 ==========

    /** 根据当前环境更新 AI 状态 */
    private updateAIState() {
        const playerNode = this.getPlayerNode();
        const playerAlive = this.isPlayerAlive();
        const selfPos = this.node.worldPosition;

        // ===== 玩家不存在/死亡 =====
        if (!playerNode || !playerAlive) {
            if (this._aiState !== 'CHASE_BASE' && this._aiState !== 'ATTACK_BASE'
                && this._aiState !== 'WANDER' && this._aiState !== 'CHASE_BUILDING'
                && this._aiState !== 'ATTACK_BUILDING') {
                this.returnToDefaultTarget();
            }
            return;
        }

        const distToPlayer = Vec3.distance(selfPos, playerNode.worldPosition);
        const lineClear = CollisionWorld.instance?.isLineOfSightClear(
            selfPos, playerNode.worldPosition, [ColliderGroup.Wall],
        );

        // ===== 死磕玩家状态：LEASH_RADIUS 退出 =====
        if (this._aiState === 'CHASE_PLAYER' || this._aiState === 'ATTACK_PLAYER') {
            // 玩家超出拉扯范围 → 放弃追击，回到预定目标
            if (distToPlayer > LEASH_RADIUS) {
                this.returnToDefaultTarget();
                return;
            }

            if (this._aiState === 'ATTACK_PLAYER') {
                if (!lineClear || distToPlayer > this.attackRange + 5) {
                    this._aiState = this._memoryTimer > 0 ? 'MEMORY_TRACK' : 'CHASE_PLAYER';
                    return;
                }
                if (this._attackCooldown > 0) return;
                return;
            }

            // CHASE_PLAYER：进入攻击范围
            if (lineClear && distToPlayer <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_PLAYER';
                this._attackCooldown = 0.3;
                return;
            }

            // 玩家可见时持续刷新记忆计时器，防止计时器归零后隔墙追击
            if (lineClear) {
                this._memoryTimer = MEMORY_DURATION;
            }

            // 失去视线 → 记忆追踪
            if (!lineClear && this._memoryTimer > 0) {
                this._aiState = 'MEMORY_TRACK';
                return;
            }
            return;
        }

        // ===== MEMORY_TRACK =====
        if (this._aiState === 'MEMORY_TRACK') {
            if (distToPlayer > LEASH_RADIUS || this._memoryTimer <= 0) {
                this.returnToDefaultTarget();
                return;
            }
            if (lineClear && distToPlayer <= this.alertRadius) {
                this._lastKnownPlayerPos.set(playerNode.worldPosition);
                this._memoryTimer = MEMORY_DURATION;
                this._aiState = 'CHASE_PLAYER';
            }
            return;
        }

        // ===== 炮塔仇恨状态 =====
        if (this._aiState === 'ATTACK_TURRET') {
            if (!this._buildingTarget || !this._buildingTarget.isValid) {
                this.returnToDefaultTarget();
                return;
            }
            const turretDist = Vec3.distance(selfPos, this.getEffectiveTargetPos(this._tempPos));
            if (turretDist > this.attackRange + 5) {
                this._aiState = 'CHASE_TURRET';
                return;
            }
            if (this._attackCooldown > 0) return;
            return;
        }
        if (this._aiState === 'CHASE_TURRET') {
            if (!this._buildingTarget || !this._buildingTarget.isValid) {
                this.returnToDefaultTarget();
                return;
            }
            const turretDist = Vec3.distance(selfPos, this.getEffectiveTargetPos(this._tempPos));
            if (turretDist <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_TURRET';
                this._attackCooldown = 0.3;
                return;
            }
            return;
        }

        // ===== 建筑攻击状态（白天游荡索敌） =====
        if (this._aiState === 'ATTACK_BUILDING') {
            if (!this._buildingTarget || !this._buildingTarget.isValid) {
                this.returnToDefaultTarget();
                return;
            }
            const bDist = Vec3.distance(selfPos, this.getEffectiveTargetPos(this._tempPos));
            if (bDist > this.attackRange + 5) {
                this._aiState = 'CHASE_BUILDING';
                return;
            }
            if (this._attackCooldown > 0) return;
            return;
        }
        if (this._aiState === 'CHASE_BUILDING') {
            if (!this._buildingTarget || !this._buildingTarget.isValid) {
                this.returnToDefaultTarget();
                return;
            }
            const bDist = Vec3.distance(selfPos, this.getEffectiveTargetPos(this._tempPos));
            if (bDist <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_BUILDING';
                this._attackCooldown = 0.3;
                return;
            }
            return;
        }

        // ===== ATTACK_BASE =====
        if (this._aiState === 'ATTACK_BASE') {
            const bp = this.getEffectiveTargetPos(this._tempPos);
            if (Vec3.distance(selfPos, bp) > this.attackRange + 5) {
                this._aiState = 'CHASE_BASE';
                return;
            }
            if (this._attackCooldown > 0) return;
            return;
        }

        // ===== 夜间僵尸：看到玩家就追击 =====
        if (lineClear && distToPlayer <= this.alertRadius) {
            this._lastKnownPlayerPos.set(playerNode.worldPosition);
            this._memoryTimer = MEMORY_DURATION;
            this._buildingTarget = null;
            this._hatedTurret = null;

            if (distToPlayer <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_PLAYER';
                this._attackCooldown = 0.3;
            } else {
                this._aiState = 'CHASE_PLAYER';
            }
            return;
        }

        // ===== CHASE_BASE → 进入攻击范围 =====
        if (this._aiState === 'CHASE_BASE') {
            const targetPos = this.getEffectiveTargetPos(this._tempPos);
            if (Vec3.distance(selfPos, targetPos) <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_BASE';
                this._attackCooldown = 0.3;
            }
        }
    }

    /** 根据当前状态移动和攻击 */
    private tickMoveByState(dt: number) {
        if (this._aiState === 'DEAD') return;

        if (this._aiState === 'ATTACK_BASE' || this._aiState === 'ATTACK_PLAYER'
            || this._aiState === 'ATTACK_TURRET' || this._aiState === 'ATTACK_BUILDING') {
            // 攻击状态：停止移动，仅播放攻击动画
            const target = this.getTargetNode();
            if (target) {
                this.playAttackAnimation(target);
            }
            return;
        }

        // 追击状态：计算目标位置 + 侧向寻路移动
        const selfPos = this.node.worldPosition;
        const targetPos = this.getEffectiveTargetPos(this._tempPos);
        const dist = Vec3.distance(selfPos, targetPos);

        // 接近目标进入攻击
        if (dist <= this.attackRange && this._attackCooldown <= 0) {
            if (this._aiState === 'CHASE_BASE') {
                this._aiState = 'ATTACK_BASE';
                this._attackCooldown = 0.3;
            } else if (this._aiState === 'CHASE_PLAYER' || this._aiState === 'MEMORY_TRACK') {
                this._aiState = 'ATTACK_PLAYER';
                this._attackCooldown = 0.3;
            } else if (this._aiState === 'CHASE_TURRET') {
                this._aiState = 'ATTACK_TURRET';
                this._attackCooldown = 0.3;
            } else if (this._aiState === 'CHASE_BUILDING') {
                this._aiState = 'ATTACK_BUILDING';
                this._attackCooldown = 0.3;
            }
            return;
        }

        const speedMult = this._aiState === 'MEMORY_TRACK' ? MEMORY_SPEED_FACTOR : 1.0;
        const step = this.moveSpeed * speedMult * dt;

        Vec3.subtract(this._tempDir, targetPos, selfPos);
        this._tempDir.z = 0;
        const len = this._tempDir.length();
        if (len < 1e-4) return;

        this._tempDir.normalize();
        this.playWalkAnimation(this._tempDir.x);

        let toX = selfPos.x + this._tempDir.x * step;
        let toY = selfPos.y + this._tempDir.y * step;

        if (step >= len) {
            toX = targetPos.x;
            toY = targetPos.y;
        }

        // 侧向寻路：正前方不通尝试左右前方绕行
        if (this._collider) {
            const hw = this.colliderHalfW;
            const hh = this.colliderHalfH;
            const blockGroups = [ColliderGroup.Zombie, ColliderGroup.Wall, ColliderGroup.Turret, ColliderGroup.Resource];
            const cw = CollisionWorld.instance;

            let needSideCheck = false;
            if (cw && cw.checkHit(toX, toY, hw, hh, blockGroups, this._collider)) {
                needSideCheck = true;
            }

            if (needSideCheck) {
                const sideResult = this.trySideDirection(this._tempDir.x, this._tempDir.y, step, selfPos, hw, hh, blockGroups, cw!);
                if (sideResult) {
                    toX = sideResult.x;
                    toY = sideResult.y;
                } else {
                    toX = selfPos.x;
                    toY = selfPos.y;
                }
            }

            const resolved = CollisionWorld.instance?.resolveMove(
                this._collider,
                selfPos.x, selfPos.y,
                toX, toY,
            );
            if (resolved) {
                toX = resolved.x;
                toY = resolved.y;
            }

            this._collider.x = toX;
            this._collider.y = toY;
        }

        this._tempPos.set(toX, toY, selfPos.z);
        this.node.setWorldPosition(this._tempPos);
    }

    // ========== 侧向寻路 ==========

    private trySideDirection(
        dirX: number, dirY: number, step: number, selfPos: Vec3,
        hw: number, hh: number, blockGroups: ColliderGroup[], cw: CollisionWorld,
    ): { x: number; y: number } | null {
        const cos45 = Math.cos(Math.PI / 4);
        const sin45 = Math.sin(Math.PI / 4);
        const rx1 = dirX * cos45 - dirY * sin45;
        const ry1 = dirX * sin45 + dirY * cos45;
        const nx1 = selfPos.x + rx1 * step;
        const ny1 = selfPos.y + ry1 * step;
        if (!cw.checkHit(nx1, ny1, hw, hh, blockGroups, this._collider)) {
            return { x: nx1, y: ny1 };
        }

        const rx2 = dirX * cos45 + dirY * sin45;
        const ry2 = -dirX * sin45 + dirY * cos45;
        const nx2 = selfPos.x + rx2 * step;
        const ny2 = selfPos.y + ry2 * step;
        if (!cw.checkHit(nx2, ny2, hw, hh, blockGroups, this._collider)) {
            return { x: nx2, y: ny2 };
        }

        const cos60 = 0.5;
        const sin60 = Math.sqrt(3) / 2;
        const rx3 = dirX * cos60 - dirY * sin60;
        const ry3 = dirX * sin60 + dirY * cos60;
        const nx3 = selfPos.x + rx3 * step;
        const ny3 = selfPos.y + ry3 * step;
        if (!cw.checkHit(nx3, ny3, hw, hh, blockGroups, this._collider)) {
            return { x: nx3, y: ny3 };
        }

        const rx4 = dirX * cos60 + dirY * sin60;
        const ry4 = -dirX * sin60 + dirY * cos60;
        const nx4 = selfPos.x + rx4 * step;
        const ny4 = selfPos.y + ry4 * step;
        if (!cw.checkHit(nx4, ny4, hw, hh, blockGroups, this._collider)) {
            return { x: nx4, y: ny4 };
        }

        return null;
    }

    private updateStuckDetection(dt: number) {
        if (this.isDead || this._aiState.startsWith('ATTACK_')) {
            this._stuckTimer = 0;
            return;
        }

        const wp = this.node.worldPosition;
        const dx = wp.x - this._lastX;
        const dy = wp.y - this._lastY;
        const distMoved = Math.sqrt(dx * dx + dy * dy);

        if (distMoved < 0.5) {
            this._stuckTimer += dt;
            if (this._stuckTimer >= STUCK_TIMEOUT) {
                this.forceEscapeStuck();
                this._stuckTimer = 0;
            }
        } else {
            this._stuckTimer = Math.max(0, this._stuckTimer - dt);
        }

        this._lastX = wp.x;
        this._lastY = wp.y;
    }

    private forceEscapeStuck() {
        const wp = this.node.worldPosition;
        const angle = Math.random() * Math.PI * 2;
        const dx = Math.cos(angle) * STUCK_ESCAPE_DIST;
        const dy = Math.sin(angle) * STUCK_ESCAPE_DIST;
        const newX = wp.x + dx;
        const newY = wp.y + dy;

        if (this._collider) {
            const hw = this.colliderHalfW;
            const hh = this.colliderHalfH;
            const blockGroups = [ColliderGroup.Zombie, ColliderGroup.Wall, ColliderGroup.Turret, ColliderGroup.Resource];
            const cw = CollisionWorld.instance;
            if (cw && !cw.checkHit(newX, newY, hw, hh, blockGroups, this._collider)) {
                this._tempPos.set(newX, newY, wp.z);
                this.node.setWorldPosition(this._tempPos);
                if (this._collider) {
                    this._collider.x = newX;
                    this._collider.y = newY;
                }
                this._lastX = newX;
                this._lastY = newY;
            }
        }
    }

    // ========== 辅助方法 ==========

    private getTargetNode(): Node | null {
        if (this._aiState === 'CHASE_BASE' || this._aiState === 'ATTACK_BASE') {
            return this._baseNode;
        }
        if (this._aiState === 'CHASE_TURRET' || this._aiState === 'ATTACK_TURRET'
            || this._aiState === 'CHASE_BUILDING' || this._aiState === 'ATTACK_BUILDING') {
            return this._buildingTarget;
        }
        return this.getPlayerNode();
    }

    /** 计算建筑节点 rect 最近点（用于绕过碰撞体判断攻击距离） */
    private getClosestPointOnBuildingRect(node: Node, out: Vec3): Vec3 {
        const selfPos = this.node.worldPosition;
        const targetPos = node.worldPosition;
        const uiTransform = node.getComponent('UITransform') as any;
        const halfW = uiTransform ? uiTransform.width * 0.5 : 20;
        const halfH = uiTransform ? uiTransform.height * 0.5 : 20;

        const left = targetPos.x - halfW;
        const right = targetPos.x + halfW;
        const bottom = targetPos.y - halfH;
        const top = targetPos.y + halfH;

        const closestX = Math.max(left, Math.min(selfPos.x, right));
        const closestY = Math.max(bottom, Math.min(selfPos.y, top));

        out.set(closestX, closestY, 0);
        return out;
    }

    private getEffectiveTargetPos(out: Vec3): Vec3 {
        if (this._aiState === 'CHASE_BASE' || this._aiState === 'ATTACK_BASE') {
            return this.getClosestPointOnBaseRect(out);
        }
        if (this._aiState === 'CHASE_TURRET' || this._aiState === 'ATTACK_TURRET'
            || this._aiState === 'CHASE_BUILDING' || this._aiState === 'ATTACK_BUILDING') {
            if (this._buildingTarget && this._buildingTarget.isValid) {
                return this.getClosestPointOnBuildingRect(this._buildingTarget, out);
            }
            if (this._baseNode) {
                out.set(this._baseNode.worldPosition);
            }
            return out;
        }
        if (this._aiState === 'MEMORY_TRACK') {
            out.set(this._lastKnownPlayerPos);
            return out;
        }
        const player = this.getPlayerNode();
        if (player) {
            out.set(player.worldPosition);
        } else if (this._baseNode) {
            out.set(this._lastKnownPlayerPos);
        }
        return out;
    }

    private getClosestPointOnBaseRect(out: Vec3): Vec3 {
        const basePos = this._baseNode!.worldPosition;
        const selfPos = this.node.worldPosition;
        const bs = BaseSystem.instance;

        const halfW = bs?.baseHalfW ?? 220;
        const halfH = bs?.baseHalfH ?? 150;

        const left = basePos.x - halfW;
        const right = basePos.x + halfW;
        const bottom = basePos.y - halfH;
        const top = basePos.y + halfH;

        const closestX = Math.max(left, Math.min(selfPos.x, right));
        const closestY = Math.max(bottom, Math.min(selfPos.y, top));

        out.set(closestX, closestY, 0);
        return out;
    }

    private performAttack(target: Node) {
        if (this.isDead) return;

        if (this.isPlayerNode(target)) {
            PlayerState.instance?.takeDamage(this.damage);
            return;
        }

        if (this.isBaseNode(target)) {
            BaseSystem.instance?.damageBase(this.damage);
            return;
        }

        // 攻击炮塔
        const turret = target.getComponent('Turret') as any;
        if (turret && typeof turret.takeDamage === 'function') {
            turret.takeDamage(this.damage);
            return;
        }

        // 攻击发电机
        const generator = target.getComponent('PlantGenerator') as any;
        if (generator && typeof generator.takeDamage === 'function') {
            generator.takeDamage(this.damage);
            return;
        }

        // 攻击集装箱
        const container = target.getComponent('Container') as any;
        if (container && typeof container.takeDamage === 'function') {
            container.takeDamage(this.damage);
        }
    }

    private enterDeathState() {
        this.isDead = true;
        this._aiState = 'DEAD';
        this.hp = 0;
        this._memoryTimer = 0;
        this._hasWanderTarget = false;
        this._buildingTarget = null;
        this._hatedTurret = null;

        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }

        this.playDeathAnimation();
        this.scheduleDrop();

        this.scheduleOnce(() => {
            if (this.node?.isValid) {
                this.node.destroy();
            }
        }, 3.0);
    }

    private scheduleDrop() {
        const drop = this.getComponent('ZombieDrop') as any;
        if (drop && typeof drop.drop === 'function') {
            drop.drop();
        }
    }

    /** 白天游荡 */
    private tickDayWander(dt: number) {
        this._wanderTimer += dt;
        if (!this._hasWanderTarget || this._wanderTimer >= WANDER_REPICK_INTERVAL) {
            this._wanderTimer = 0;
            this.pickNewWanderTarget();
        }

        const selfPos = this.node.worldPosition;
        const dist = Vec3.distance(selfPos, this._wanderTarget);
        if (dist <= WANDER_ARRIVE_DIST) {
            this.pickNewWanderTarget();
            return;
        }

        Vec3.subtract(this._tempDir, this._wanderTarget, selfPos);
        this._tempDir.z = 0;
        const len = this._tempDir.length();
        if (len < 1e-4) return;

        this._tempDir.normalize();
        this.playWalkAnimation(this._tempDir.x);

        const step = this.moveSpeed * dt * 0.65;
        let toX = selfPos.x + this._tempDir.x * step;
        let toY = selfPos.y + this._tempDir.y * step;

        if (this._collider) {
            const hw = this.colliderHalfW;
            const hh = this.colliderHalfH;
            const blockGroups = [ColliderGroup.Zombie, ColliderGroup.Wall, ColliderGroup.Turret, ColliderGroup.Resource];
            const cw = CollisionWorld.instance;

            let needSideCheck = false;
            if (cw && cw.checkHit(toX, toY, hw, hh, blockGroups, this._collider)) {
                needSideCheck = true;
            }

            if (needSideCheck) {
                const sideResult = this.trySideDirection(this._tempDir.x, this._tempDir.y, step, selfPos, hw, hh, blockGroups, cw!);
                if (sideResult) {
                    toX = sideResult.x;
                    toY = sideResult.y;
                } else {
                    toX = selfPos.x;
                    toY = selfPos.y;
                }
            }

            const resolved = CollisionWorld.instance?.resolveMove(
                this._collider,
                selfPos.x, selfPos.y,
                toX, toY,
            );
            if (resolved) {
                toX = resolved.x;
                toY = resolved.y;
            }
            this._collider.x = toX;
            this._collider.y = toY;
        }

        this._tempPos.set(toX, toY, selfPos.z);
        this.node.setWorldPosition(this._tempPos);
    }

    private pickNewWanderTarget() {
        const origin = this.getWanderOriginWorld();
        const angle = Math.random() * Math.PI * 2;
        const radius = randomRange(WANDER_PATROL_RADIUS_MIN, WANDER_PATROL_RADIUS_MAX);
        this._wanderTarget.set(
            origin.x + Math.cos(angle) * radius,
            origin.y + Math.sin(angle) * radius,
            0,
        );
        this._hasWanderTarget = true;
    }

    private getWanderOriginWorld(): Vec3 {
        if (this.wanderOrigin) {
            return this.wanderOrigin.worldPosition;
        }
        if (this._baseNode) {
            return this._baseNode.worldPosition;
        }
        return Vec3.ZERO;
    }

    // ========== 动画系统 ==========

    private updateWalkAnimation(dt: number) {
        const isWalking = this._aiState !== 'ATTACK_BASE' && this._aiState !== 'ATTACK_PLAYER'
            && this._aiState !== 'ATTACK_TURRET' && this._aiState !== 'ATTACK_BUILDING'
            && this._aiState !== 'DEAD';
        if (!isWalking || !this.bodySprite || this.walkFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= WALK_FRAME_DURATION) {
            this._animFrameTimer = 0;
            this._animFrameIndex = (this._animFrameIndex + 1) % this.walkFrames.length;
            this.bodySprite.spriteFrame = this.walkFrames[this._animFrameIndex];
        }
    }

    private updateAttackAnimation(dt: number) {
        const isAttacking = this._aiState === 'ATTACK_BASE' || this._aiState === 'ATTACK_PLAYER'
            || this._aiState === 'ATTACK_TURRET' || this._aiState === 'ATTACK_BUILDING';
        if (!isAttacking || !this.bodySprite || this.attackFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= this.attackFrameDuration) {
            this._animFrameTimer = 0;
            this._animFrameIndex++;
            if (this._animFrameIndex >= this.attackFrames.length) {
                this._animFrameIndex = 0;
                this.tryAttackCurrentTarget();
            }
            this.bodySprite.spriteFrame = this.attackFrames[this._animFrameIndex];
        }
    }

    private tryAttackCurrentTarget() {
        const target = this.getTargetNode();
        if (target) {
            this.performAttack(target);
        }
    }

    private updateDeathAnimation(dt: number) {
        if (this._aiState !== 'DEAD' || !this.bodySprite || this.deathFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= DEATH_FRAME_DURATION) {
            this._animFrameTimer = 0;
            this._animFrameIndex++;
            if (this._animFrameIndex >= this.deathFrames.length) {
                this._deathAnimFinished = true;
                this._animFrameIndex = this.deathFrames.length - 1;
                this.node.active = false;
            }
            this.bodySprite.spriteFrame = this.deathFrames[this._animFrameIndex];
        }
    }

    private playWalkAnimation(directionX = 0) {
        if (this._aiState === 'DEAD') return;
        if (!this.bodySprite || this.walkFrames.length === 0) return;

        const newMirror = directionX > 0 ? -1 : 1;

        if (this._aiState !== 'WANDER' && this._aiState !== 'CHASE_BASE' && this._aiState !== 'CHASE_PLAYER'
            && this._aiState !== 'MEMORY_TRACK' && this._aiState !== 'CHASE_TURRET'
            && this._aiState !== 'CHASE_BUILDING') {
            return;
        }

        if (this._walkMirror === newMirror) return;

        this._walkMirror = newMirror;
        this._animFrameIndex = 0;
        this._animFrameTimer = 0;
        this._attackAnimFinished = false;
        this._isAttackAnimPlaying = false;

        this.applyMirror(this._walkMirror);
        this.bodySprite.spriteFrame = this.walkFrames[0];
    }

    private playAttackAnimation(target: Node) {
        if (this._aiState === 'DEAD') return;
        if (!this.bodySprite || this.attackFrames.length === 0) return;

        if (this._isAttackAnimPlaying) return;

        this._isAttackAnimPlaying = true;
        this._animFrameIndex = 0;
        this._animFrameTimer = 0;
        this._attackAnimFinished = false;

        const targetIsRight = target.worldPosition.x > this.node.worldPosition.x;
        const scaleX = targetIsRight ? -1 : 1;
        this.applyMirror(scaleX);

        this.bodySprite.spriteFrame = this.attackFrames[0];
    }

    private playDeathAnimation() {
        if (this._aiState !== 'DEAD') return;
        if (!this.bodySprite || this.deathFrames.length === 0) return;

        this._animFrameIndex = 0;
        this._animFrameTimer = 0;
        this._deathAnimFinished = false;
        this.bodySprite.spriteFrame = this.deathFrames[0];
    }

    private applyMirror(scaleX: number) {
        if (!this.bodySprite || !this.bodySprite.node) return;
        const spriteNode = this.bodySprite.node;
        const absScaleX = Math.abs(spriteNode.scale.x);
        spriteNode.setScale(scaleX * absScaleX, spriteNode.scale.y, spriteNode.scale.z);
    }

    // ========== 工具方法 ==========

    private getPlayerNode(): Node | null {
        return PlayerState.instance?.node ?? null;
    }

    private isPlayerAlive(): boolean {
        return PlayerState.instance?.isAlive ?? false;
    }

    private isPlayerNode(node: Node): boolean {
        const player = PlayerState.instance?.node;
        return player != null && node === player;
    }

    private isBaseNode(node: Node): boolean {
        return this._baseNode != null && node === this._baseNode;
    }

    private resolveBaseNode() {
        if (this.baseNode) {
            this._baseNode = this.baseNode;
            return;
        }

        const scene = this.node.scene;
        if (!scene) {
            return;
        }

        this._baseNode = this.findNodeByName(scene, this.baseNodeName);
        if (!this._baseNode) {
            warn(`[ZombieMove] 未找到基地节点 "${this.baseNodeName}"`);
        }
    }

    private findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) {
            return root;
        }
        for (const child of root.children) {
            const found = this.findNodeByName(child, name);
            if (found) {
                return found;
            }
        }
        return null;
    }
}