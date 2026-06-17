import { _decorator, CCFloat, CCInteger, Component, Node, randomRange, Sprite, SpriteFrame, Vec3, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

const AGGRO_UPDATE_INTERVAL = 0.3;
const ALERT_RADIUS = 250;
const LEASH_RADIUS = 350;
const ATTACK_RANGE = 40;

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

type ZombieState = 'idle' | 'walk' | 'attack' | 'dead';

/**
 * 僵尸动态 AI：仇恨判定、追击、周期攻击、白天外围游荡。
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

    /** 白天外围游荡僵尸：不冲基地，仅巡逻 */
    isDayWanderer = false;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 15;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 15;

    hp = 100;

    /** 血量归零后的死亡标记，3 秒后再销毁节点 */
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

    currentTarget: Node | null = null;
    isAngryAtPlayer = false;

    private _baseNode: Node | null = null;
    private _aggroTimer = 0;
    private _wanderTimer = 0;
    private readonly _wanderTarget = new Vec3();
    private _hasWanderTarget = false;
    private readonly _tempDir = new Vec3();
    private readonly _tempPos = new Vec3();

    // 动画状态
    private _zombieState: ZombieState = 'idle';
    private _animFrameIndex = 0;
    private _animFrameTimer = 0;
    private _attackAnimFinished = false;
    private _deathAnimFinished = false;
    private _walkMirror = 1; // 当前行走镜像：1=原方向（左），-1=镜像（右）
    private _collider: Collider2D | null = null;

    onLoad() {
        this.resolveBaseNode();
        this.syncHpFromMaxHp();
        if (!this.isDayWanderer) {
            this.currentTarget = this._baseNode;
        }
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

        if (this.isDayWanderer && !this.isAngryAtPlayer) {
            this.pickNewWanderTarget();
        }
        // 默认播放行走动画
        this.playWalkAnimation();
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
            this.isAngryAtPlayer = false;
            this.currentTarget = null;
            this.pickNewWanderTarget();
        } else {
            this.currentTarget = targetBase;
        }
    }

    private syncHpFromMaxHp() {
        this.hp = this.maxHp;
    }

    update(dt: number) {
        // 帧动画更新
        this.updateWalkAnimation(dt);
        this.updateAttackAnimation(dt);

        if (this.hp <= 0) {
            // 死亡状态只播放动画
            if (!this.isDead) {
                this.enterDeathState();
            }
            this.updateDeathAnimation(dt);
            return;
        }

        if (!this._baseNode) {
            this.resolveBaseNode();
        }

        this._aggroTimer += dt;
        if (this._aggroTimer >= AGGRO_UPDATE_INTERVAL) {
            this._aggroTimer = 0;
            this.updateAggroTarget();
        }

        if (this.isDayWanderer && !this.isAngryAtPlayer) {
            this.tickDayWander(dt);
            return;
        }

        this.tickMoveAndAttack(dt);
    }

    takeDamage(amount: number) {
        if (this.isDead || this.hp <= 0 || amount <= 0) {
            return;
        }

        this.hp = Math.max(0, this.hp - amount);
        this.isDayWanderer = false;
        this.isAngryAtPlayer = true;
        this._hasWanderTarget = false;
        this.updateAggroTarget();

        if (this.hp <= 0 && !this.isDead) {
            this.enterDeathState();
        }
    }

    private updateAggroTarget() {
        if (this.isDayWanderer && !this.isAngryAtPlayer) {
            this.currentTarget = null;
            return;
        }

        const base = this._baseNode;
        if (!base) {
            this.currentTarget = null;
            return;
        }

        const playerNode = this.getPlayerNode();
        const playerAlive = this.isPlayerAlive();
        const distToPlayer = playerNode
            ? Vec3.distance(this.node.worldPosition, playerNode.worldPosition)
            : Number.MAX_VALUE;
        const distToBase = Vec3.distance(this.node.worldPosition, base.worldPosition);

        if (this.isAngryAtPlayer) {
            if (!playerNode || !playerAlive || distToPlayer >= LEASH_RADIUS) {
                this.isAngryAtPlayer = false;
            } else {
                this.currentTarget = playerNode;
                return;
            }
        }

        if (
            playerNode &&
            playerAlive &&
            distToPlayer < ALERT_RADIUS &&
            distToPlayer < distToBase &&
            // 视线检测：僵尸与玩家之间是否有墙体阻挡
            CollisionWorld.instance?.isLineOfSightClear(
                this.node.worldPosition, playerNode.worldPosition, [ColliderGroup.Wall],
            )
        ) {
            this.currentTarget = playerNode;
            return;
        }

        this.currentTarget = base;
    }

    /** 白天游荡：朝随机巡逻点移动，不攻击基地 */
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
        if (len < 1e-4) {
            return;
        }

        this._tempDir.normalize();

        const step = this.moveSpeed * dt * 0.65;
        if (step >= len) {
            this.node.setWorldPosition(this._wanderTarget);
            if (this._collider) {
                this._collider.x = this._wanderTarget.x;
                this._collider.y = this._wanderTarget.y;
            }
            this.pickNewWanderTarget();
            return;
        }

        let toX = selfPos.x + this._tempDir.x * step;
        let toY = selfPos.y + this._tempDir.y * step;

        // 碰撞阻挡检测
        if (this._collider) {
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

        this.playWalkAnimation(this._tempDir.x);
    }

    private pickNewWanderTarget() {
        const origin = this.getWanderOriginWorld();
        const angle = Math.random() * Math.PI * 2;
        const radius = randomRange(WANDER_PATROL_RADIUS_MIN, WANDER_PATROL_RADIUS_MAX);
        this._wanderTarget.set(
            origin.x + Math.cos(angle) * radius,
            origin.y + Math.sin(angle) * radius,
            0,  // 纯 2D，Z 轴固定为 0
        );
        this._hasWanderTarget = true;
    }

    /**
     * 获取游荡圆心的世界坐标（纯 2D）。
     * 逐级回退：wanderOrigin → 基地 → 场景原点 (0,0,0)。
     * 不再回退到 this.node.worldPosition，避免被父节点位移污染。
     */
    private getWanderOriginWorld(): Vec3 {
        if (this.wanderOrigin) {
            return this.wanderOrigin.worldPosition;
        }
        if (this._baseNode) {
            return this._baseNode.worldPosition;
        }
        // 最后回退：纯 2D 世界原点
        return Vec3.ZERO;
    }

    private tickMoveAndAttack(dt: number) {
        if (this.isDead) {
            return;
        }

        const target = this.currentTarget;
        if (!target?.isValid) {
            return;
        }

        const selfPos = this.node.worldPosition;
        const targetPos = target.worldPosition;
        const dist = Vec3.distance(selfPos, targetPos);

        if (dist <= ATTACK_RANGE) {
            // 在攻击范围内：停止移动
            if (this._zombieState !== 'attack') {
                this.playAttackAnimation(target);
            }
            // 攻击动画完成后造成伤害并重新播放
            if (this._attackAnimFinished) {
                this.performAttack(target);
                this.playAttackAnimation(target);
            }
            return;
        }

        // 远离目标时播放行走动画并移动
        Vec3.subtract(this._tempDir, targetPos, selfPos);
        this._tempDir.z = 0;
        const len = this._tempDir.length();
        if (len < 1e-4) {
            return;
        }

        this._tempDir.normalize();
        this.playWalkAnimation(this._tempDir.x);

        const step = this.moveSpeed * dt;
        let toX = selfPos.x + this._tempDir.x * step;
        let toY = selfPos.y + this._tempDir.y * step;

        if (step >= len) {
            toX = targetPos.x;
            toY = targetPos.y;
        }

        // 碰撞阻挡检测
        if (this._collider) {
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

    private performAttack(target: Node) {
        if (this.isDead) {
            return;
        }

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
        this.hp = 0;
        this.moveSpeed = 0;
        this.currentTarget = null;
        this.isAngryAtPlayer = false;
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

    // ========== 动画系统 ==========

    /** 更新行走动画 */
    private updateWalkAnimation(dt: number) {
        if (this._zombieState !== 'walk') return;
        if (this.walkFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= WALK_FRAME_DURATION) {
            this._animFrameTimer = 0;
            this._animFrameIndex = (this._animFrameIndex + 1) % this.walkFrames.length;
            this.bodySprite.spriteFrame = this.walkFrames[this._animFrameIndex];
        }
    }

    /** 更新攻击动画 */
    private updateAttackAnimation(dt: number) {
        if (this._zombieState !== 'attack') return;
        if (this.attackFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= this.attackFrameDuration) {
            this._animFrameTimer = 0;
            this._animFrameIndex++;
            if (this._animFrameIndex >= this.attackFrames.length) {
                this._attackAnimFinished = true;
                this._animFrameIndex = this.attackFrames.length - 1; // 停在最后一帧
            }
            this.bodySprite.spriteFrame = this.attackFrames[this._animFrameIndex];
        }
    }

    /** 更新死亡动画 */
    private updateDeathAnimation(dt: number) {
        if (this._zombieState !== 'dead') return;
        if (this.deathFrames.length === 0) return;

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= DEATH_FRAME_DURATION) {
            this._animFrameTimer = 0;
            this._animFrameIndex++;
            if (this._animFrameIndex >= this.deathFrames.length) {
                this._deathAnimFinished = true;
                this._animFrameIndex = this.deathFrames.length - 1; // 停在最后一帧
                this.node.active = false; // 隐藏节点
            }
            this.bodySprite.spriteFrame = this.deathFrames[this._animFrameIndex];
        }
    }

    private playWalkAnimation(directionX = 0) {
        if (this._zombieState === 'dead') return;
        if (!this.bodySprite || this.walkFrames.length === 0) return;

        const newMirror = directionX > 0 ? -1 : 1;

        // 状态和镜像都未变化，不重复设置
        if (this._zombieState === 'walk' && newMirror === this._walkMirror) return;

        this._walkMirror = newMirror;
        this._zombieState = 'walk';
        this._animFrameIndex = 0;
        this._animFrameTimer = 0;
        this._attackAnimFinished = false;

        this.applyMirror(this._walkMirror);

        this.bodySprite.spriteFrame = this.walkFrames[0];
    }

    private playAttackAnimation(target: Node) {
        if (this._zombieState === 'dead') return;
        if (!this.bodySprite || this.attackFrames.length === 0) return;

        this._zombieState = 'attack';
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
        if (this._zombieState === 'dead') return;
        if (!this.bodySprite || this.deathFrames.length === 0) return;

        this._zombieState = 'dead';
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

    // ========== 辅助方法 ==========

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
