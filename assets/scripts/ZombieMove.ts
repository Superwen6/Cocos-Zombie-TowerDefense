import { _decorator, CCFloat, CCInteger, Component, Node, randomRange, Sprite, SpriteFrame, Vec3, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

/** 感知范围：玩家触发追击的最大距离 */
const ALERT_RADIUS = 300;
/** 拉扯距离：玩家超出此范围会放弃追击 */
const LEASH_RADIUS = 350;
const ATTACK_COOLDOWN = 1.5;
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
type AIState = 'CHASE_BASE' | 'CHASE_PLAYER' | 'ATTACK_BASE' | 'ATTACK_PLAYER' | 'MEMORY_TRACK' | 'DEAD';

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
        // 初始状态：追击基地
        this._aiState = this.isDayWanderer ? 'CHASE_BASE' : 'CHASE_BASE';
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

        if (asDayWanderer) {
            this._aiState = 'CHASE_BASE';
            this._hasWanderTarget = false;
            this._memoryTimer = 0;
            this.pickNewWanderTarget();
        } else {
            this._aiState = 'CHASE_BASE';
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

        if (this.isDayWanderer && this._aiState === 'CHASE_BASE' && !this._aiState.endsWith('_PLAYER')) {
            this.tickDayWander(dt);
            return;
        }

        this.updateAIState();
        this.tickMoveByState(dt);
    }

    takeDamage(amount: number) {
        if (this.isDead || this.hp <= 0 || amount <= 0) {
            return;
        }

        this.hp = Math.max(0, this.hp - amount);
        this.isDayWanderer = false;
        this._hasWanderTarget = false;

        // 受击嘲讽：如果玩家造成伤害，立即切换为追击玩家（如果玩家在范围内）
        const playerNode = this.getPlayerNode();
        if (playerNode && this.isPlayerAlive()) {
            const dist = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
            if (dist <= this.alertRadius) {
                // 直接看到玩家就追击并更新记忆
                const lineClear = CollisionWorld.instance?.isLineOfSightClear(
                    this.node.worldPosition, playerNode.worldPosition, [ColliderGroup.Wall],
                );
                if (lineClear) {
                    this._lastKnownPlayerPos.set(playerNode.worldPosition);
                    this._memoryTimer = MEMORY_DURATION;
                    this._aiState = 'CHASE_PLAYER';
                } else if (this._memoryTimer <= 0) {
                    // 第一次被打且没看见，也记忆位置开始追踪
                    this._lastKnownPlayerPos.set(playerNode.worldPosition);
                    this._memoryTimer = MEMORY_DURATION;
                    this._aiState = 'MEMORY_TRACK';
                }
            }
        }

        if (this.hp <= 0 && !this.isDead) {
            this.enterDeathState();
        }
    }

    // ========== AI 状态更新 ==========

    /** 根据当前环境更新 AI 状态 */
    private updateAIState() {
        const playerNode = this.getPlayerNode();
        const playerAlive = this.isPlayerAlive();

        // 如果玩家不存在或已死亡，回到追击基地
        if (!playerNode || !playerAlive) {
            if (this._aiState !== 'CHASE_BASE' && this._aiState !== 'ATTACK_BASE') {
                this._aiState = 'CHASE_BASE';
                this._memoryTimer = 0;
            }
            return;
        }

        const distToPlayer = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
        const lineClear = CollisionWorld.instance?.isLineOfSightClear(
            this.node.worldPosition, playerNode.worldPosition, [ColliderGroup.Wall],
        );

        // 攻击状态由 updateAIState 统一管理切换，不交给 tickMoveByState
        if (this._aiState === 'ATTACK_PLAYER') {
            // 先判距离：玩家跑远/丢失视线，立刻退出攻击去追
            if (!lineClear || distToPlayer > this.attackRange + 5) {
                this._aiState = this._memoryTimer > 0 ? 'MEMORY_TRACK' : 'CHASE_BASE';
                return;
            }
            // 玩家在范围内，冷却期内保持攻击动画
            if (this._attackCooldown > 0) return;
            // 冷却结束且玩家在范围内，继续攻击
            return;
        }
        if (this._aiState === 'ATTACK_BASE') {
            const bp = this.getEffectiveTargetPos(this._tempPos);
            if (Vec3.distance(this.node.worldPosition, bp) > this.attackRange + 5) {
                this._aiState = 'CHASE_BASE';
                return;
            }
            if (this._attackCooldown > 0) return;
            return;
        }

        // 如果看见玩家且在感知范围内 → 立刻追击玩家（优先级最高）
        if (lineClear && distToPlayer <= this.alertRadius) {
            this._lastKnownPlayerPos.set(playerNode.worldPosition);
            this._memoryTimer = MEMORY_DURATION;

            const distToPlayerNow = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
            if (distToPlayerNow <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_PLAYER';
                this._attackCooldown = 0.3;
            } else {
                this._aiState = 'CHASE_PLAYER';
            }
            return;
        }

        // 当前正在追击玩家但失去视线 → 进入记忆追踪
        if (this._aiState === 'CHASE_PLAYER' && !lineClear && this._memoryTimer > 0) {
            this._aiState = 'MEMORY_TRACK';
            return;
        }

        // 当前在记忆追踪 → 计时器过期回到基地
        if (this._aiState === 'MEMORY_TRACK') {
            if (this._memoryTimer <= 0) {
                this._aiState = 'CHASE_BASE';
                this._memoryTimer = 0;
                return;
            }
            // 检查是否又能看见了
            if (lineClear && distToPlayer <= this.alertRadius) {
                this._lastKnownPlayerPos.set(playerNode.worldPosition);
                this._memoryTimer = MEMORY_DURATION;
                this._aiState = 'CHASE_PLAYER';
            }
            return;
        }

        // 在基地状态，检查是否有可见玩家进入感知范围
        if (this._aiState === 'CHASE_BASE' || this._aiState === 'ATTACK_BASE') {
            if (lineClear && distToPlayer <= this.alertRadius) {
                this._lastKnownPlayerPos.set(playerNode.worldPosition);
                this._memoryTimer = MEMORY_DURATION;
                this._aiState = 'CHASE_PLAYER';
                return;
            }
        }

        // 检查距离攻击范围
        if (this._aiState === 'CHASE_BASE') {
            const targetPos = this.getEffectiveTargetPos(this._tempPos);
            const dist = Vec3.distance(this.node.worldPosition, targetPos);
            if (dist <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_BASE';
                this._attackCooldown = 0.3;
            }
        } else if (this._aiState === 'CHASE_PLAYER') {
            const targetPos = this.getEffectiveTargetPos(this._tempPos);
            const dist = Vec3.distance(this.node.worldPosition, targetPos);
            if (dist <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_PLAYER';
                this._attackCooldown = 0.3;
            }
        }
    }

    /** 根据当前状态移动和攻击 */
    private tickMoveByState(dt: number) {
        if (this._aiState === 'DEAD') return;

        if (this._aiState === 'ATTACK_BASE' || this._aiState === 'ATTACK_PLAYER') {
            // 攻击状态：停止移动，仅播放攻击动画（实际攻击由动画周期触发）
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
            // 检测正前方是否被阻挡
            const hw = this.colliderHalfW;
            const hh = this.colliderHalfH;
            const blockGroups = [ColliderGroup.Zombie, ColliderGroup.Wall, ColliderGroup.Turret, ColliderGroup.Resource];
            const cw = CollisionWorld.instance;

            let needSideCheck = false;
            if (cw && cw.checkHit(toX, toY, hw, hh, blockGroups, this._collider)) {
                needSideCheck = true;
            }

            if (needSideCheck) {
                // 尝试左右前方旋转 ±45°
                const sideResult = this.trySideDirection(this._tempDir.x, this._tempDir.y, step, selfPos, hw, hh, blockGroups, cw!);
                if (sideResult) {
                    toX = sideResult.x;
                    toY = sideResult.y;
                } else {
                    // 两侧都不通：不移动，增加卡住计时
                    toX = selfPos.x;
                    toY = selfPos.y;
                }
            }

            // 碰撞结算
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

    /**
     * 正前方被阻挡时，尝试旋转 ±45° 找可通行方向。
     * @returns 找到可通行位置返回坐标，否则返回 null
     */
    private trySideDirection(
        dirX: number, dirY: number, step: number, selfPos: Vec3,
        hw: number, hh: number, blockGroups: ColliderGroup[], cw: CollisionWorld,
    ): { x: number; y: number } | null {
        // 顺时针旋转 45° (右前方)
        const cos45 = Math.cos(Math.PI / 4);
        const sin45 = Math.sin(Math.PI / 4);
        const rx1 = dirX * cos45 - dirY * sin45;
        const ry1 = dirX * sin45 + dirY * cos45;
        const nx1 = selfPos.x + rx1 * step;
        const ny1 = selfPos.y + ry1 * step;
        if (!cw.checkHit(nx1, ny1, hw, hh, blockGroups, this._collider)) {
            return { x: nx1, y: ny1 };
        }

        // 逆时针旋转 45° (左前方)
        const rx2 = dirX * cos45 + dirY * sin45;
        const ry2 = -dirX * sin45 + dirY * cos45;
        const nx2 = selfPos.x + rx2 * step;
        const ny2 = selfPos.y + ry2 * step;
        if (!cw.checkHit(nx2, ny2, hw, hh, blockGroups, this._collider)) {
            return { x: nx2, y: ny2 };
        }

        // 尝试 ±60° 更大角度
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

    /** 更新卡住检测，超时触发随机脱困 */
    private updateStuckDetection(dt: number) {
        if (this.isDead || this._aiState.startsWith('ATTACK_')) {
            this._stuckTimer = 0;
            return;
        }

        const wp = this.node.worldPosition;
        const dx = wp.x - this._lastX;
        const dy = wp.y - this._lastY;
        const distMoved = Math.sqrt(dx * dx + dy * dy);

        // 如果几乎没动，累计卡住时间
        if (distMoved < 0.5) {
            this._stuckTimer += dt;
            // 卡住超时：随机侧向一步强行脱困
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

    /** 卡住超时：给一个随机侧向位移强行脱困 */
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

    /** 获取当前状态的目标节点 */
    private getTargetNode(): Node | null {
        if (this._aiState.endsWith('_BASE')) {
            return this._baseNode;
        }
        return this.getPlayerNode();
    }

    /** 获取当前状态的有效目标位置（用于移动） */
    private getEffectiveTargetPos(out: Vec3): Vec3 {
        if (this._aiState === 'CHASE_BASE' || this._aiState === 'ATTACK_BASE') {
            return this.getClosestPointOnBaseRect(out);
        }
        if (this._aiState === 'MEMORY_TRACK') {
            out.set(this._lastKnownPlayerPos);
            return out;
        }
        const player = this.getPlayerNode();
        if (player) {
            out.set(player.worldPosition);
        } else {
            if (this._baseNode) {
                out.set(this._lastKnownPlayerPos);
            }
        }
        return out;
    }

    /** 计算僵尸到基地矩形边框的最近点 */
    private getClosestPointOnBaseRect(out: Vec3): Vec3 {
        const basePos = this._baseNode!.worldPosition;
        const selfPos = this.node.worldPosition;
        const bs = BaseSystem.instance;

        // 增大矩形尺寸以覆盖所有墙体节点
        // Wall_Left 在 x=434，Wall_Right 在 x=851，Wall_Bottom 在 y=214
        // 需要 halfW≥211, halfH≥146 才能覆盖
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
        }
    }

    private enterDeathState() {
        this.isDead = true;
        this._aiState = 'DEAD';
        this.hp = 0;
        this._memoryTimer = 0;
        this._hasWanderTarget = false;

        // 死亡后立即注销碰撞体
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }

        this.playDeathAnimation();
        this.scheduleDrop();

        // 死亡动画播放完后销毁节点
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
        const isWalking = this._aiState !== 'ATTACK_BASE' && this._aiState !== 'ATTACK_PLAYER' && this._aiState !== 'DEAD';
        if (!isWalking || !this.bodySprite || this.walkFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= WALK_FRAME_DURATION) {
            this._animFrameTimer = 0;
            this._animFrameIndex = (this._animFrameIndex + 1) % this.walkFrames.length;
            this.bodySprite.spriteFrame = this.walkFrames[this._animFrameIndex];
        }
    }

    private updateAttackAnimation(dt: number) {
        const isAttacking = this._aiState === 'ATTACK_BASE' || this._aiState === 'ATTACK_PLAYER';
        if (!isAttacking || !this.bodySprite || this.attackFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= this.attackFrameDuration) {
            this._animFrameTimer = 0;
            this._animFrameIndex++;
            if (this._animFrameIndex >= this.attackFrames.length) {
                this._animFrameIndex = 0;
                // 动画循环一圈，执行一次攻击
                this.tryAttackCurrentTarget();
            }
            this.bodySprite.spriteFrame = this.attackFrames[this._animFrameIndex];
        }
    }

    /** 对当前目标执行一次攻击（由动画循环触发） */
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

        if (this._aiState !== 'CHASE_BASE' && this._aiState !== 'CHASE_PLAYER' && this._aiState !== 'MEMORY_TRACK') {
            // 不是行走状态不播放
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

        if (this._isAttackAnimPlaying) return; // 已在播放中，不重置

        this._isAttackAnimPlaying = true;
        this._animFrameIndex = 0;
        this._animFrameTimer = 0;
        this._attackAnimFinished = false;

        // 根据目标位置设置镜像
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
