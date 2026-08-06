import { _decorator, AudioClip, AudioSource, CCFloat, CCInteger, Component, director, find, instantiate, Mat4, Node, Prefab, randomRange, Sprite, SpriteFrame, Vec3, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';
import { PlantGenerator } from './PlantGenerator';
import { Container } from './Container';
import { Turret } from './Turret';
import { DayNightEvents, DayNightPhase, DayNightSystem } from './DayNightSystem';
import { EnemyManager } from './EnemyManager';
import { Bullet } from './Bullet';

const { ccclass, property } = _decorator;

/** 玩家记忆：失去视线/超出视野范围后继续追击的时长（秒） */
const MEMORY_DURATION = 3.0;
/** 记忆期内移动速度倍率 */
const MEMORY_SPEED_FACTOR = 0.8;
/** 脱困判定：连续卡住多少秒触发随机脱困 */
const STUCK_TIMEOUT = 1.5;
/** 脱困随机移动距离 */
const STUCK_ESCAPE_DIST = 30;
/** Boss2 弹幕发射数量（顺序发射一圈） */
const SHOT_BULLET_COUNT = 12;
/** Boss2 弹幕角度步进（360° / 12，顺时针） */
const SHOT_ANGLE_STEP = (Math.PI * 2) / SHOT_BULLET_COUNT;
/** Boss2 呼吸效果：Y 缩放振荡频率（Hz，0.5 = 2 秒一呼一吸） */
const BREATH_FREQ = 0.5;
/** Boss2 呼吸效果：Y 缩放振幅（相对基础 Y 缩放的倍率，轻微起伏） */
const BREATH_AMPLITUDE = 0.02;
/** Boss2 待机游走：相对出生点的游走半径（像素） */
const IDLE_WALK_RADIUS = 180;
/** Boss2 待机游走：每次走动时长（秒） */
const IDLE_WALK_DURATION = 3.5;
/** Boss2 待机游走：两次走动之间的静止间隔范围（秒） */
const IDLE_WALK_PAUSE_MIN = 2.0;
const IDLE_WALK_PAUSE_MAX = 4.0;
/** Boss2 待机游走：完全卡死多少秒后强制随机脱困 */
const IDLE_WALK_STUCK_ESCAPE = 0.8;
/** Boss2 待机游走：移动速度倍率（相对 moveSpeed，慢速踱步） */
const IDLE_WALK_SPEED_FACTOR = 0.55;

/** 白天游荡：巡逻点刷新间隔（秒） */
const WANDER_REPICK_INTERVAL = 4;
/** 白天游荡：到达巡逻点判定距离 */
const WANDER_ARRIVE_DIST = 30;

/** 动画帧配置 */
const WALK_FRAME_DURATION = 0.15;
const DEATH_FRAME_DURATION = 0.15;

/** AI 状态枚举 */
type AIState =
    | 'WANDER'           // 白天游荡巡逻
    | 'BOSS2_IDLE'       // 最终Boss静止待机（25天夜晚前原地不动，被攻击时反击）
    | 'SHOT_ATTACK'      // 最终Boss射击攻击（发射360°弹幕打玩家）
    | 'CHASE_BASE'       // 夜间僵尸初始：追击基地
    | 'ATTACK_BASE'      // 攻击基地
    | 'CHASE_PLAYER'     // 追击玩家（死磕模式，脱离视野/距离且记忆耗尽退出）
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

    @property({ type: CCFloat, tooltip: '游荡僵尸扫描建筑半径（像素），通常比alertRadius大', min: 200, max: 3000 })
    buildingScanRadius = 1200;

    @property({ type: CCFloat, tooltip: '扫描附近地标（Wall 碰撞体）的半径，0=不扫描，找到后作为永久巡逻中心', min: 0, max: 3000 })
    wanderLandmarkScanRadius = 500;

    @property({ type: CCFloat, tooltip: '巡逻半径（像素），围绕地标/基地在此半径内随机巡逻', min: 100, max: 5000 })
    wanderPatrolRadius = 800;

    /** 白天外围游荡僵尸：不冲基地，仅巡逻 */
    isDayWanderer = false;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 15;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 15;

    @property({ tooltip: '碰撞体/命中点中心相对节点位置的 Y 偏移。贴图锚点设在脚部(anchorY=0)时需上移此值到贴图中心，避免炮塔/子弹/近战都打在脚底' })
    colliderOffsetY = 0;

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

    @property({ type: AudioClip, tooltip: '死亡音效' })
    deathSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '死亡音效最大可听距离（像素），超出此距离不播放' })
    deathSoundMaxDistance = 800;

    @property({ type: AudioClip, tooltip: '普通攻击音效（近战命中时播放，BOSS2 使用）' })
    attackSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '普通攻击音效最大可听距离（像素），超出此距离不播放' })
    attackSoundMaxDistance = 500;

    @property({ type: AudioClip, tooltip: '射击音效（弹幕开始发射时播放，BOSS2 使用）' })
    shotSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '射击音效最大可听距离（像素），超出此距离不播放' })
    shotSoundMaxDistance = 900;

    // ========== 最终Boss（BOSS2）专属属性 ==========

    @property({ tooltip: '是否为最终Boss（BOSS2）：25天夜晚前原地静止待机+受击反击，之后等同夜间僵尸；攻击玩家时距离超过射击距离并持续一段时间会发射360°弹幕' })
    isBoss2 = false;

    @property({ type: CCFloat, tooltip: 'Boss2 觉醒夜晚：当前天数达到该值的夜晚时，从静止待机转为夜间僵尸攻击逻辑' })
    boss2AwakenDay = 25;

    @property({ tooltip: 'Boss2 素材默认朝向：true=默认朝右，false=默认朝左（BOSS1）。用于镜像翻转' })
    boss2FacingRight = true;

    @property({ type: [SpriteFrame], tooltip: 'Boss2 射击动画帧序列（BOSS2SHOT）' })
    shotFrames: SpriteFrame[] = [];

    @property({ type: CCFloat, tooltip: 'Boss2 射击动画每帧持续时间（秒）' })
    shotFrameDuration = 0.1;

    @property({ type: Prefab, tooltip: 'Boss2 弹幕子弹预制体（顺序发射12颗，伤害=近身攻击力）' })
    shotBulletPrefab: Prefab | null = null;

    @property({ type: CCFloat, tooltip: 'Boss2 触发射击的玩家距离阈值（像素），玩家在此距离之外且冷却结束即发射' })
    shotRange = 200;

    @property({ tooltip: 'Boss2 射击冷却时间（秒），一次射击结束后开始冷却' })
    shotCooldown = 4.0;

    @property({ type: CCFloat, tooltip: 'Boss2 弹幕顺序发射间隔（秒）：一次只发一颗，第一颗对准玩家后顺时针扫过一圈' })
    shotStaggerInterval = 0.06;

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
    /** 壁面循迹：沿墙滑动的持久方向（0 表示未在滑动），保证持续往同一方向滑到绕过障碍 */
    private readonly _wallSlideDir = new Vec3();

    // 攻击冷却
    private _attackCooldown = 0;

    // 建筑/炮塔目标
    private _buildingTarget: Node | null = null;

    /** 首次攻击僵尸的炮塔（锁定后忽略其他炮塔攻击，防止多炮塔来回折返） */
    private _hatedTurret: Node | null = null;

    /** 是否被玩家主动攻击过（true=玩家嘲讽霸体，无视炮塔；false=仅视觉发现，可被炮塔打断） */
    private _playerTaunted = false;

    // 白天游荡索敌计时器
    private _wanderScanTimer = 0;

    /** 扫描到的地标节点（Wall 碰撞体所属节点，与僵尸同在 YSortLayer 下，相对位置不变） */
    private _wanderLandmarkNode: Node | null = null;
    /** 是否已尝试过地标扫描（延迟到第一帧，等 MapObstacle.start() 注册碰撞体） */
    private _landmarkScanned = false;
    /** 巡逻目标偏移量（相对 origin），每帧重算 target 以抵消 YSortLayer 移动 */
    private readonly _wanderTargetOffset = new Vec3();

    /** 是否处于夜间（游荡僵尸改为扫描玩家而非建筑） */
    private _isNight = false;

    // 动画状态
    private _animFrameIndex = 0;
    private _animFrameTimer = 0;
    private _attackAnimFinished = false;
    private _deathAnimFinished = false;
    private _walkMirror = 1; // 当前行走镜像：1=原方向（左），-1=镜像（右）
    private _isAttackAnimPlaying = false; // 防止每帧重置攻击动画
    private _collider: Collider2D | null = null;
    private _audioSource: AudioSource | null = null;

    // ===== 最终Boss（BOSS2）状态 =====
    /** Boss2 是否已觉醒（达到 boss2AwakenDay 的夜晚） */
    private _boss2Awakened = false;
    /** Boss2 射击冷却计时器 */
    private _shotCooldownTimer = 0;
    /** Boss2 是否正在播放射击动画（防止每帧重置） */
    private _isShotAnimPlaying = false;
    /** Boss2 进入射击前的 AI 状态（射击动画播完后恢复，避免打断对炮塔/基地的追击） */
    private _shotPrevState: AIState | '' = '';
    /** Boss2 弹幕缓存：觉醒后预生成子弹，发射时复用，避免每轮新建 12 个粒子发射器导致卡顿 */
    private readonly _boss2BulletPool: Bullet[] = [];
    /** Boss2 弹幕缓存根节点（隐藏容器） */
    private _boss2BulletPoolRoot: Node | null = null;
    /** 弹幕预热剩余数量（觉醒后每帧预热 4 颗，分散创建开销） */
    private _boss2WarmupRemaining = 0;
    /** 本轮射击剩余待发射弹幕数（顺序发射） */
    private _shotBulletsToFire = 0;
    /** 弹幕顺序发射计时器 */
    private _shotFireTimer = 0;
    /** 本轮射击基准角度（第一颗对准玩家） */
    private _shotBaseAngle = 0;
    /** 呼吸效果：相位计时器 */
    private _breathTime = 0;
    /** 呼吸效果：Sprite 节点基础 Y 缩放（进入待机时缓存） */
    private _breathBaseScaleY = 0;
    /** 呼吸效果：当前是否已应用呼吸缩放 */
    private _breathActive = false;
    /** 待机游走：是否正在踱步 */
    private _idleWalkActive = false;
    /** 待机游走：当前阶段剩余时间（走动时长 / 静止间隔） */
    private _idleWalkTimer = 0;
    /** 待机游走：当前踱步目标点（出生点 + 随机偏移） */
    private readonly _idleWalkTarget = new Vec3();
    /** 待机游走：完全卡死累计时间（超阈值触发随机脱困） */
    private _idleWalkStuckTime = 0;
    /** 待机游走：踱步目标（本地坐标，相对父节点，不受 GameWorld 移动影响） */
    private readonly _idleWalkTargetLocal = new Vec3();
    /** 待机游走：出生点（本地坐标，相对父节点） */
    private readonly _boss2SpawnLocal = new Vec3();
    /** 临时矩阵：本地坐标转世界坐标用 */
    private readonly _tempMat = new Mat4();

    /** 同类型僵尸死亡音效互斥标志（同一时间每种僵尸最多播放1个死亡音效） */
    private static _deathSoundPlaying: Record<string, boolean> = {};

    // ========== 生命周期 ==========

    onLoad() {
        this.resolveBaseNode();
        this.syncHpFromMaxHp();
        if (this.isBoss2) {
            // Boss2：25天夜晚前原地静止待机（出生点）
            this._aiState = 'BOSS2_IDLE';
            // 待机踱步：初始先静止一段时间再开始缓慢游走
            this._idleWalkTimer = randomRange(IDLE_WALK_PAUSE_MIN, IDLE_WALK_PAUSE_MAX);
        } else {
            this._aiState = this.isDayWanderer ? 'WANDER' : 'CHASE_BASE';
        }
        DayNightSystem.eventTarget.on(DayNightEvents.PHASE_CHANGED, this.onPhaseChanged, this);
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
    }

    start() {
        this.syncHpFromMaxHp();
        // 注册碰撞体
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x,
            y: wp.y + this.colliderOffsetY,
            halfW: this.colliderHalfW,
            halfH: this.colliderHalfH,
            group: ColliderGroup.Zombie,
            offsetY: this.colliderOffsetY,
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
        DayNightSystem.eventTarget.off(DayNightEvents.PHASE_CHANGED, this.onPhaseChanged, this);
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
    }

    /** 昼夜切换时，游荡僵尸调整行为 */
    private onPhaseChanged(detail: { phase: DayNightPhase; currentDay?: number }) {
        if (this.isDead) return;

        // ===== 最终Boss（BOSS2）：达到觉醒夜晚后从静止待机转为夜间僵尸攻击逻辑 =====
        if (this.isBoss2) {
            if (!this._boss2Awakened) {
                const day = detail.currentDay ?? DayNightSystem.instance?.currentDay ?? 1;
                if (detail.phase === DayNightPhase.NIGHT && day >= this.boss2AwakenDay) {
                    this._boss2Awakened = true;
                    this._boss2WarmupRemaining = 12;
                    this._buildingTarget = null;
                    this._hatedTurret = null;
                    this._playerTaunted = false;
                    this._aiState = 'CHASE_BASE';
                }
            }
            return;
        }

        if (!this.isDayWanderer) return;

        if (detail.phase === DayNightPhase.NIGHT) {
            // 进入夜间：游荡僵尸改为扫描玩家和建筑（发电机/集装箱）
            this._isNight = true;
            this._buildingTarget = null;
            this._hatedTurret = null;
            this._aiState = 'WANDER';
            this._hasWanderTarget = false;
            this.pickNewWanderTarget();
        } else if (detail.phase === DayNightPhase.DAY) {
            // 进入白天：恢复游荡巡逻（扫描建筑）
            this._isNight = false;
            this.returnToDefaultTarget();
        }
        // DUSK / DAWN 过渡阶段：保持当前目标不变
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
        this._playerTaunted = false;
        this._wanderScanTimer = 0;
        this._memoryTimer = 0;
        this._hasWanderTarget = false;
        this._boss2SpawnLocal.set(this.node.position);
        if (this.isBoss2) {
            const dn = DayNightSystem.instance;
            const day = dn?.currentDay ?? 1;
            const isNight = dn?.isNight ?? false;
            // 读档/晚生成场景：当前已到达觉醒夜晚（或已过）→ 直接觉醒
            if (day > this.boss2AwakenDay || (day === this.boss2AwakenDay && isNight)) {
                this._boss2Awakened = true;
                this._boss2WarmupRemaining = 12;
                this._aiState = 'CHASE_BASE';
            } else {
                this._boss2Awakened = false;
                this._aiState = 'BOSS2_IDLE';
            }
        } else {
            this._aiState = asDayWanderer ? 'WANDER' : 'CHASE_BASE';
        }
        this._wanderLandmarkNode = null;
        this._landmarkScanned = false;
        this._isNight = DayNightSystem.instance?.isNight ?? false;

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

        // ===== 最终Boss（BOSS2）专属逻辑 =====
        if (this.isBoss2) {
            // 弹幕预热：每帧预生成 4 颗，分散粒子发射器创建开销
            this.updateBoss2BulletWarmup();
            // 未觉醒：原地静止待机，仅受击后触发反击
            if (this._aiState === 'BOSS2_IDLE') {
                this.updateBoss2Idle(dt);
                return;
            }
            // 非待机状态：确保呼吸缩放在离开待机后被还原
            this.resetBoss2Breath();
            // 射击动画播放中：播放射击帧，同时继续下方移动/AI逻辑（射击期间可移动，不 return）
            if (this._aiState === 'SHOT_ATTACK') {
                this.updateShotAnimation(dt);
            } else {
                // 无蓄力：玩家超出射击距离且冷却结束即发射
                this.updateShotTrigger(dt);
            }
        }

        // 帧动画更新（射击动画播放中跳过行走/攻击动画，避免覆盖射击帧）
        if (this._aiState !== 'SHOT_ATTACK') {
            this.updateWalkAnimation(dt);
            this.updateAttackAnimation(dt);
        }

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
                // 延迟到第一帧扫描地标（等 MapObstacle.start() 注册完碰撞体）
                if (!this._landmarkScanned) {
                    this._landmarkScanned = true;
                    this.scanNearbyLandmark();
                }
                this._wanderScanTimer -= dt;
                if (this._wanderScanTimer <= 0) {
                    this._wanderScanTimer = 1.0 + Math.random() * 1.0; // 1~2 秒扫描一次
                    if (this._isNight) {
                        // 夜间：扫描玩家和建筑（发电机/集装箱），玩家优先
                        this.scanForPlayer();
                        if (this._aiState === 'WANDER') {
                            this.scanForBuildings();
                        }
                    } else {
                        this.scanForBuildings();
                    }
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

    // ========== 最终Boss（BOSS2）专属逻辑 ==========

    /** Boss2 未觉醒静止待机：原地不动（仅播放待机/行走第1帧），受击后由 takeDamage 触发反击 */
    private updateBoss2Idle(dt: number) {
        // 递减攻击冷却
        if (this._attackCooldown > 0) {
            this._attackCooldown -= dt;
        }

        // 静止待机动画（walk 第1帧）：仅在未踱步时强制显示待机帧，
        // 否则每帧覆盖行走动画帧，行走动画被"掐头"只闪 1 帧就弹回待机帧，造成鬼畜闪烁
        if (this.bodySprite && this.walkFrames.length > 0) {
            if (!this._idleWalkActive && this.bodySprite.spriteFrame !== this.walkFrames[0]) {
                this.bodySprite.spriteFrame = this.walkFrames[0];
            }
        }

        // 呼吸效果：Y 轴轻微缩放振荡，模拟呼吸起伏（避免静止时看起来像贴图）
        const spriteNode = this.bodySprite?.node;
        if (spriteNode) {
            if (this._breathBaseScaleY === 0) {
                this._breathBaseScaleY = spriteNode.scale.y;
            }
            this._breathTime += dt;
            const breathe = 1 + Math.sin(this._breathTime * BREATH_FREQ * Math.PI * 2) * BREATH_AMPLITUDE;
            spriteNode.setScale(spriteNode.scale.x, this._breathBaseScaleY * breathe, spriteNode.scale.z);
            this._breathActive = true;
        }

        // 待机踱步：偶尔在出生点周围小范围慢速走动，其余时间原地静止（呼吸）
        this._idleWalkTimer -= dt;
        if (this._idleWalkActive) {
            if (this._idleWalkTimer <= 0) {
                // 走够时长或到达目标：停下休息
                this._idleWalkActive = false;
                this._idleWalkTimer = randomRange(IDLE_WALK_PAUSE_MIN, IDLE_WALK_PAUSE_MAX);
            } else {
                this.stepIdleWalk(dt);
            }
        } else if (this._idleWalkTimer <= 0) {
            // 静止结束：选新目标开始踱步
            this.pickIdleWalkTarget();
            this._idleWalkActive = true;
            this._idleWalkTimer = IDLE_WALK_DURATION;
        }

        // 若已觉醒（读档等场景下 phase 事件已错过），直接进入夜间僵尸逻辑
        if (this._boss2Awakened) {
            this._aiState = 'CHASE_BASE';
        }
    }

    /** 选择待机踱步目标：出生点 + 随机偏移（半径 IDLE_WALK_RADIUS 内），最小距离避免原地微挪。
     *  使用本地坐标（相对父节点），父节点随 GameWorld 移动时目标也随其移动，避免踱步漂移。 */
    private pickIdleWalkTarget() {
        const angle = randomRange(0, Math.PI * 2);
        const dist = randomRange(20, IDLE_WALK_RADIUS);
        this._idleWalkTargetLocal.set(
            this._boss2SpawnLocal.x + Math.cos(angle) * dist,
            this._boss2SpawnLocal.y + Math.sin(angle) * dist,
            0,
        );
        this.updateIdleWalkTargetWorld();
    }

    /** 将本地踱步目标转为世界坐标（随父节点/GameWorld 实时移动而重算，抵消世界漂移） */
    private updateIdleWalkTargetWorld() {
        const parent = this.node.parent;
        if (parent) {
            parent.getWorldMatrix(this._tempMat);
            Vec3.transformMat4(this._idleWalkTarget, this._idleWalkTargetLocal, this._tempMat);
        } else {
            this._idleWalkTarget.set(this._idleWalkTargetLocal);
        }
    }

    /** 朝待机踱步目标慢速移动一步；遇墙体/炮塔/资源时侧向绕行滑动，避免卡住 */
    private stepIdleWalk(dt: number) {
        // 每帧从本地目标重算世界目标，抵消 GameWorld/父节点移动
        this.updateIdleWalkTargetWorld();
        const selfPos = this.node.worldPosition;
        Vec3.subtract(this._tempDir, this._idleWalkTarget, selfPos);
        this._tempDir.z = 0;
        const len = this._tempDir.length();
        if (len < 1e-4) {
            this._idleWalkTimer = 0;
            return;
        }
        this._tempDir.normalize();
        this.playWalkAnimation(this._tempDir.x);

        const step = this.moveSpeed * IDLE_WALK_SPEED_FACTOR * dt;
        let toX = selfPos.x + this._tempDir.x * step;
        let toY = selfPos.y + this._tempDir.y * step;
        if (step >= len) {
            toX = this._idleWalkTarget.x;
            toY = this._idleWalkTarget.y;
        }

        // 目标点被占（墙体/炮塔/资源）则尝试左右前方绕行滑动，避免踱步卡进建筑；
        // 其他僵尸不阻挡踱步（blockGroups 不含 Zombie）
        if (this._collider) {
            const cw = CollisionWorld.instance;
            const hw = this.colliderHalfW;
            const hh = this.colliderHalfH;
            const blockGroups = [ColliderGroup.Wall, ColliderGroup.Turret, ColliderGroup.Resource];
            const hitX = toX;
            const hitY = toY + this.colliderOffsetY;

            let needSideCheck = false;
            if (cw && cw.checkHit(hitX, hitY, hw, hh, blockGroups, this._collider)) {
                needSideCheck = true;
            }

            if (needSideCheck) {
                const sideResult = this.trySideDirection(this._tempDir.x, this._tempDir.y, step, hitX, hitY, hw, hh, blockGroups, cw!);
                if (sideResult) {
                    toX = sideResult.x;
                    toY = sideResult.y - this.colliderOffsetY;
                    this._idleWalkStuckTime = 0;
                } else {
                    // 轴向/垂直/对角都不通：累计卡死时间，超阈值强制随机脱困，避免长时间卡在建筑里
                    toX = selfPos.x;
                    toY = selfPos.y;
                    this._idleWalkStuckTime += dt;
                    if (this._idleWalkStuckTime >= IDLE_WALK_STUCK_ESCAPE) {
                        this._idleWalkStuckTime = 0;
                        this.forceEscapeStuck();
                        return; // 已瞬移脱困，跳过本帧后续移动/碰撞体更新，避免把位置拉回卡点
                    }
                }
            } else {
                this._idleWalkStuckTime = 0;
                this._wallSlideDir.set(0, 0, 0);
            }

            const resolved = CollisionWorld.instance?.resolveMove(
                this._collider,
                selfPos.x, selfPos.y + this.colliderOffsetY,
                hitX, hitY,
            );
            if (resolved) {
                toX = resolved.x;
                toY = resolved.y - this.colliderOffsetY;
            }

            this._collider.x = toX;
            this._collider.y = toY + this.colliderOffsetY;
        }

        this._tempPos.set(toX, toY, selfPos.z);
        this.node.setWorldPosition(this._tempPos);
        // 推进行走动画帧（idle 分支在 update() 里提前 return，需在此手动推进）
        this.updateWalkAnimation(dt);
    }

    /** 离开待机后恢复 Sprite 节点 Y 缩放，避免呼吸缩放残留 */
    private resetBoss2Breath() {
        const spriteNode = this.bodySprite?.node;
        if (!spriteNode) return;
        if (this._breathActive) {
            const base = this._breathBaseScaleY !== 0 ? this._breathBaseScaleY : 1;
            spriteNode.setScale(spriteNode.scale.x, base, spriteNode.scale.z);
            this._breathActive = false;
        }
        this._breathTime = 0;
    }

    /**
     * Boss2 射击触发（无蓄力）：玩家在近战范围外（shotRange）且冷却结束立即发射弹幕。
     * 不要求必须处于追玩家状态——追击炮塔/基地等任何目标时，只要玩家在远处也会远程射击。
     * 发射后播放射击动画（期间仍可移动），期间按 shotStaggerInterval 逐颗顺序发射弹幕。
     */
    private updateShotTrigger(dt: number) {
        // 射击冷却递减
        if (this._shotCooldownTimer > 0) {
            this._shotCooldownTimer -= dt;
        }
        if (this._shotCooldownTimer > 0) {
            return;
        }

        const playerNode = this.getPlayerNode();
        if (!playerNode || !this.isPlayerAlive() || PlayerState.isPlayerInvisible) {
            return;
        }

        // 只对"玩家相关目标"开火：玩家主动攻击过（嘲讽）或正在追/打/追踪玩家时。
        // 否则若炮塔先攻击了 Boss2（玩家未出手），Boss2 会像普通僵尸一样只打炮塔，不把玩家当目标。
        // 若任何状态下都朝玩家开火，SHOT_ATTACK 期间 getEffectiveTargetPos 默认取玩家位置，
        // 会造成在炮塔与玩家之间往返移动。
        const playerEngaged = this._playerTaunted
            || this._aiState === 'CHASE_PLAYER'
            || this._aiState === 'ATTACK_PLAYER'
            || this._aiState === 'MEMORY_TRACK';
        if (!playerEngaged) {
            return;
        }

        const dist = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
        if (dist > this.shotRange && this.shotFrames.length > 0 && this.shotBulletPrefab) {
            this._shotCooldownTimer = this.shotCooldown;
            // 记录进入射击前的状态，动画播完后恢复
            this._shotPrevState = this._aiState;
            this._aiState = 'SHOT_ATTACK';
            this.startShotAnimation();
        }
    }

    /** 开始射击动画（切换到 SHOT_ATTACK 状态时调用） */
    private startShotAnimation() {
        if (this._isShotAnimPlaying) return;
        this._isShotAnimPlaying = true;
        this._animFrameIndex = 0;
        this._animFrameTimer = 0;
        this._attackAnimFinished = false;
        if (this.bodySprite && this.shotFrames.length > 0) {
            this.bodySprite.spriteFrame = this.shotFrames[0];
        }
        // 射击音效（每轮弹幕开始发射时播放一次）
        this.playShotSound();
        // 初始化本轮流射：第一颗对准玩家，后续按 SHOT_ANGLE_STEP 顺时针依次发射
        this._shotBulletsToFire = SHOT_BULLET_COUNT;
        this._shotFireTimer = 0;
        this._shotBaseAngle = this.getShotBaseAngle();
    }

    /** 播放射击动画；期间按 shotStaggerInterval 间隔逐颗发射弹幕（第一颗对准玩家，后续顺时针） */
    private updateShotAnimation(dt: number) {
        if (!this.bodySprite || this.shotFrames.length === 0) {
            this._isShotAnimPlaying = false;
            this._aiState = this._shotPrevState || (this._boss2Awakened ? 'CHASE_BASE' : 'BOSS2_IDLE');
            return;
        }

        this._animFrameTimer += dt;
        if (this._animFrameTimer >= this.shotFrameDuration) {
            this._animFrameTimer = 0;
            this._animFrameIndex++;
            if (this._animFrameIndex >= this.shotFrames.length) {
                this._animFrameIndex = 0;
            }
            this.bodySprite.spriteFrame = this.shotFrames[this._animFrameIndex];
        }

        // 顺序发射弹幕：每次到点只发一颗（第一颗对准玩家，后续顺时针旋转）
        this._shotFireTimer += dt;
        while (this._shotFireTimer >= this.shotStaggerInterval && this._shotBulletsToFire > 0) {
            this._shotFireTimer -= this.shotStaggerInterval;
            this.fireOneShotBullet();
        }

        // 全部发射完成：退出射击状态（无需等动画循环到帧尾）
        if (this._shotBulletsToFire <= 0) {
            this._isShotAnimPlaying = false;
            // 恢复射击前的 AI 状态（原为强制 CHASE_PLAYER，会导致打炮塔/基地时被打断改追玩家）
            this._aiState = this._shotPrevState || 'CHASE_PLAYER';
        }
    }

    /** 本轮射击基准角度：Boss2 → 玩家的方向（第一颗弹幕对准玩家） */
    private getShotBaseAngle(): number {
        const playerNode = this.getPlayerNode();
        if (playerNode?.isValid) {
            const origin = this.getHitWorldPosition(this._tempPos);
            const p = playerNode.worldPosition;
            return Math.atan2(p.y - origin.y, p.x - origin.x);
        }
        return 0;
    }

    /** 顺序发射单颗弹幕（从缓存取），当前角度 = 基准角 + 已发射数 × 步进 */
    private fireOneShotBullet() {
        if (!this.shotBulletPrefab || this.isDead) return;
        const shotIndex = SHOT_BULLET_COUNT - this._shotBulletsToFire;
        const origin = this.getHitWorldPosition(this._tempPos);
        const angle = this._shotBaseAngle + shotIndex * SHOT_ANGLE_STEP;
        const dir = new Vec3(Math.cos(angle), Math.sin(angle), 0);
        // 复用预生成弹幕缓存，避免每颗新建粒子发射器导致卡顿
        const bulletComp = this.acquireBoss2Bullet(origin);
        if (!bulletComp) return;
        bulletComp.init(null, this.damage, this.node, false);
        bulletComp.setDirection(dir);
        bulletComp.hitPlayer = true;
        this._shotBulletsToFire--;
    }

    /** 获取弹幕缓存根节点（隐藏容器） */
    private ensureBoss2BulletPoolRoot(): Node {
        if (this._boss2BulletPoolRoot?.isValid) return this._boss2BulletPoolRoot;
        const scene = this.node.scene ?? director.getScene();
        const gameWorld = scene ? (scene.getChildByName('GameWorld') ?? scene) : null;
        const root = new Node('Boss2BulletPool');
        root.active = false;
        if (gameWorld) {
            root.setParent(gameWorld);
            root.setSiblingIndex(0);
        } else if (scene) {
            root.setParent(scene);
        }
        this._boss2BulletPoolRoot = root;
        return root;
    }

    /** 预生成一颗弹幕并构建粒子特效（激活一次触发 onLoad/onEnable 后立即收回缓存） */
    private createBoss2BulletNode(): Bullet | null {
        if (!this.shotBulletPrefab) return null;
        const node = instantiate(this.shotBulletPrefab);
        const bulletComp = node.getComponent(Bullet);
        if (!bulletComp) {
            node.destroy();
            return null;
        }
        const scene = this.node.scene ?? director.getScene();
        const gameWorld = scene ? (scene.getChildByName('GameWorld') ?? scene) : null;
        if (gameWorld) {
            node.setParent(gameWorld);
            node.setWorldPosition(0, 0, 0);
            node.active = true; // 触发粒子特效一次性构建（ParticleSystem2D 创建）
            node.active = false; // 构建完成后立即失活，本帧内不会渲染
            node.removeFromParent();
        }
        const root = this.ensureBoss2BulletPoolRoot();
        node.setParent(root);
        node.setPosition(0, 0, 0);
        node.eulerAngles = Vec3.ZERO;
        return bulletComp;
    }

    /** 觉醒后每帧预热一批弹幕，分散创建粒子发射器的开销 */
    private updateBoss2BulletWarmup() {
        if (this._boss2WarmupRemaining <= 0) return;
        const perFrame = 4;
        for (let i = 0; i < perFrame && this._boss2WarmupRemaining > 0; i++) {
            const bulletComp = this.createBoss2BulletNode();
            if (!bulletComp) {
                this._boss2WarmupRemaining = 0;
                break;
            }
            this._boss2BulletPool.push(bulletComp);
            this._boss2WarmupRemaining--;
        }
    }

    /** 从缓存取一颗弹幕发射（缓存不足时临时实例化兜底） */
    private acquireBoss2Bullet(origin: Vec3): Bullet | null {
        if (!this.shotBulletPrefab) return null;
        const scene = this.node.scene ?? director.getScene();
        const gameWorld = scene ? (scene.getChildByName('GameWorld') ?? scene) : null;
        if (this._boss2BulletPool.length > 0) {
            const bulletComp = this._boss2BulletPool.pop()!;
            const node = bulletComp.node;
            if (gameWorld) {
                node.setParent(gameWorld);
                node.setSiblingIndex(gameWorld.children.length - 1);
            } else if (node.scene) {
                node.setParent(node.scene);
            }
            node.setWorldPosition(origin);
            node.active = true;
            return bulletComp;
        }
        // 缓存未就绪（预热完成前开火）：临时实例化兜底
        const node = instantiate(this.shotBulletPrefab);
        const bulletComp = node.getComponent(Bullet);
        if (!bulletComp) {
            node.destroy();
            return null;
        }
        Bullet.attachToWorld(node, origin);
        return bulletComp;
    }

    /** 回收弹幕：失活并归还缓存（Bullet.despawn 调用） */
    recycleBoss2Bullet(bulletComp: Bullet) {
        if (!bulletComp?.node?.isValid) return;
        const node = bulletComp.node;
        node.active = false;
        node.removeFromParent();
        const root = this.ensureBoss2BulletPoolRoot();
        node.setParent(root);
        node.setPosition(0, 0, 0);
        node.eulerAngles = Vec3.ZERO;
        if (this._boss2BulletPool.length < 32) {
            this._boss2BulletPool.push(bulletComp);
        } else {
            node.destroy();
        }
    }

    // ========== 受击系统 ==========

    /** 回到预定目标：游荡僵尸→WANDER（会自动扫建筑/玩家），夜间僵尸→CHASE_BASE */
    private returnToDefaultTarget() {
        this._hatedTurret = null;
        this._buildingTarget = null;
        this._playerTaunted = false;
        this._memoryTimer = 0;
        if (this.isDayWanderer) {
            this._aiState = 'WANDER';
            this.pickNewWanderTarget();
        } else if (this.isBoss2 && !this._boss2Awakened) {
            // Boss2 未觉醒：回到出生点原地静止待机
            this._aiState = 'BOSS2_IDLE';
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
            // 玩家嘲讽霸体：仅被玩家主动攻击过后才无视炮塔（视觉发现玩家不可免疫）
            if (this._playerTaunted) {
                // 无视炮塔
            }
            // 已锁定某座炮塔 → 忽略其他炮塔的攻击，防止多炮塔来回折返
            else if (this._hatedTurret && this._hatedTurret.isValid && turretNode !== this._hatedTurret) {
                // 忽略其他炮塔，死磕当前目标
            }
            // 首次被炮塔攻击，或之前锁定的炮塔已销毁 → 锁定新炮塔
            else if (!this._hatedTurret || !this._hatedTurret.isValid) {
                this._hatedTurret = turretNode;
                this._buildingTarget = turretNode;
                this._aiState = 'CHASE_TURRET';
                this._memoryTimer = 0;
            }
            // 同一炮塔的子弹，已在攻击中，不改变状态
        } else {
            // 玩家攻击（最高优先级）：立即清空炮塔仇恨，标记嘲讽霸体，死磕玩家
            const playerNode = this.getPlayerNode();
            if (playerNode && this.isPlayerAlive()) {
                this._hatedTurret = null;
                this._playerTaunted = true;
                this._lastKnownPlayerPos.set(playerNode.worldPosition);
                this._memoryTimer = MEMORY_DURATION;
                this._buildingTarget = null;
                // 已经在追击/攻击玩家时不重置状态，避免打断攻击
                if (this._aiState !== 'CHASE_PLAYER' && this._aiState !== 'ATTACK_PLAYER') {
                    this._aiState = 'CHASE_PLAYER';
                }
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

    /** 扫描附近最近的 Wall 碰撞体作为永久巡逻地标（与僵尸同在 YSortLayer 下，相对位置不变） */
    private scanNearbyLandmark() {
        if (this.wanderLandmarkScanRadius <= 0) return;

        const cw = CollisionWorld.instance;
        if (!cw) return;

        const wallColliders = cw.getCollidersByGroup(ColliderGroup.Wall);
        if (!wallColliders || wallColliders.length === 0) return;

        const selfPos = this.node.worldPosition;
        let nearestNode: Node | null = null;
        let nearestDist = this.wanderLandmarkScanRadius;

        for (const col of wallColliders) {
            if (!col.node?.isValid) continue;
            const d = Vec3.distance(selfPos, col.node.worldPosition);
            if (d < nearestDist) {
                nearestDist = d;
                nearestNode = col.node;
            }
        }

        this._wanderLandmarkNode = nearestNode;
    }

    /** 白天游荡者：扫描范围内最近的非防御性建筑（发电机/集装箱），锁定并追击 */
    private scanForBuildings() {
        const selfPos = this.node.worldPosition;
        let nearest: Node | null = null;
        let nearestDist = this.buildingScanRadius;

        const cachedBuildings = EnemyManager.getCachedBuildings();
        for (const node of cachedBuildings) {
            const d = Vec3.distance(selfPos, node.worldPosition);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = node;
            }
        }

        if (nearest) {
            this._buildingTarget = nearest;
            this._aiState = 'CHASE_BUILDING';
            this._memoryTimer = 0;
        }
    }

    /** 夜间游荡：扫描玩家，在视野内且距离<=alertRadius时锁定追击 */
    private scanForPlayer() {
        const playerNode = this.getPlayerNode();
        if (!playerNode || !this.isPlayerAlive()) return;

        const selfPos = this.node.worldPosition;
        const distToPlayer = Vec3.distance(selfPos, playerNode.worldPosition);
        if (distToPlayer > this.alertRadius * PlayerState.zombieAlertRadiusMultiplier) return;

        // 检查视线是否被墙阻挡
        const lineClear = CollisionWorld.instance?.isLineOfSightClear(
            selfPos, playerNode.worldPosition, [ColliderGroup.Wall],
        );
        if (!lineClear) return;

        // 发现玩家，切换追击
        this._lastKnownPlayerPos.set(playerNode.worldPosition);
        this._memoryTimer = MEMORY_DURATION;
        this._buildingTarget = null;
        this._hatedTurret = null;
        this._aiState = 'CHASE_PLAYER';
    }

    /** 夜间进攻型僵尸：扫描范围内最近的炮塔，返回节点或 null */
    private findNearestTurret(): Node | null {
        const selfPos = this.node.worldPosition;
        let nearest: Node | null = null;
        let nearestDist = this.buildingScanRadius;

        const cachedTurrets = EnemyManager.getCachedTurrets();
        for (const turretNode of cachedTurrets) {
            const d = Vec3.distance(selfPos, turretNode.worldPosition);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = turretNode;
            }
        }

        return nearest;
    }

    // ========== AI 状态更新 ==========

    /** 根据当前环境更新 AI 状态 */
    private updateAIState() {
        // 射击动画播放中：保持射击状态不切换 AI。
        // 否则会被下方"视觉发现玩家"分支（视线通畅时）每帧重置回 CHASE_PLAYER/ATTACK_PLAYER，
        // 导致射击动画永远播不完、弹幕射不出（只有玩家躲墙后 lineClear=false 时才能射完）。
        if (this._aiState === 'SHOT_ATTACK') {
            return;
        }

        const playerNode = this.getPlayerNode();
        const playerAlive = this.isPlayerAlive();
        const selfPos = this.node.worldPosition;

        // ===== 玩家不存在/死亡：重置玩家相关状态，但不阻止其他状态机运行 =====
        if (!playerNode || !playerAlive) {
            if (this._aiState === 'CHASE_PLAYER' || this._aiState === 'ATTACK_PLAYER'
                || this._aiState === 'MEMORY_TRACK') {
                this.returnToDefaultTarget();
            }
            // 继续执行后续状态机（炮塔/建筑/基地），不提前返回
        }

        const playerExists = playerNode != null && playerAlive;
        const distToPlayer = playerExists ? Vec3.distance(selfPos, playerNode!.worldPosition) : Infinity;
        const lineClear = playerExists ? (CollisionWorld.instance?.isLineOfSightClear(
            selfPos, playerNode!.worldPosition, [ColliderGroup.Wall],
        ) ?? false) : false;

        // ===== 死磕玩家状态：玩家隐身 / 超出视野范围且记忆耗尽 → 放弃追击 =====
        if (playerExists && (this._aiState === 'CHASE_PLAYER' || this._aiState === 'ATTACK_PLAYER')) {
            // 玩家隐身 → 丢失目标
            if (PlayerState.isPlayerInvisible) {
                this.returnToDefaultTarget();
                return;
            }

            // 统一脱战规则：视野范围 = alertRadius。玩家在视野内且可见 → 刷新记忆；
            // 超出视野（距离过远或墙体遮挡）→ 记忆自然衰减，记忆耗尽则放弃追击。
            const withinSight = distToPlayer <= this.alertRadius * PlayerState.zombieAlertRadiusMultiplier;

            if (this._aiState === 'ATTACK_PLAYER') {
                if (!lineClear || distToPlayer > this.attackRange + 5) {
                    this._aiState = this._memoryTimer > 0 ? 'MEMORY_TRACK' : 'CHASE_PLAYER';
                    return;
                }
                if (this._attackCooldown > 0) return;
                return;
            }

            // CHASE_PLAYER：进入攻击范围
            if (lineClear && withinSight && distToPlayer <= this.attackRange + 5 && this._attackCooldown <= 0) {
                this._aiState = 'ATTACK_PLAYER';
                this._attackCooldown = 0.3;
                return;
            }

            // 视野内且可见：持续刷新记忆计时器
            if (lineClear && withinSight) {
                this._memoryTimer = MEMORY_DURATION;
            }

            // 超出视野范围且记忆耗尽 → 放弃追击
            if (!withinSight && this._memoryTimer <= 0) {
                this.returnToDefaultTarget();
                return;
            }

            // 失去视线（墙挡）→ 记忆追踪
            if (!lineClear && this._memoryTimer > 0) {
                this._aiState = 'MEMORY_TRACK';
                return;
            }
            return;
        }

        // ===== MEMORY_TRACK =====
        if (playerExists && this._aiState === 'MEMORY_TRACK') {
            // 隐身 / 记忆耗尽（墙体遮挡或超出视野范围均按记忆衰减）→ 放弃追踪
            if (PlayerState.isPlayerInvisible || this._memoryTimer <= 0) {
                this.returnToDefaultTarget();
                return;
            }
            if (lineClear && distToPlayer <= this.alertRadius * PlayerState.zombieAlertRadiusMultiplier) {
                this._lastKnownPlayerPos.set(playerNode!.worldPosition);
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
            if (!this._buildingTarget || !this._buildingTarget.isValid || !this._buildingTarget.active) {
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
            if (!this._buildingTarget || !this._buildingTarget.isValid || !this._buildingTarget.active) {
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

        // ===== 夜间进攻型僵尸：扫描附近炮塔，优先攻击 =====
        if (this._aiState === 'CHASE_BASE' || this._aiState === 'ATTACK_BASE') {
            const nearestTurret = this.findNearestTurret();
            if (nearestTurret) {
                this._buildingTarget = nearestTurret;
                this._hatedTurret = nearestTurret;
                this._aiState = 'CHASE_TURRET';
                this._memoryTimer = 0;
                return;
            }
        }

        // ===== 夜间僵尸：看到玩家就追击（视觉发现，非玩家攻击，优先级低于炮塔） =====
        // 索敌与脱战统一使用 alertRadius：超出视野范围由记忆计时器兜底，无双半径冲突
        if (playerExists && lineClear && distToPlayer <= this.alertRadius * PlayerState.zombieAlertRadiusMultiplier) {
            this._lastKnownPlayerPos.set(playerNode!.worldPosition);
            this._memoryTimer = MEMORY_DURATION;
            this._buildingTarget = null;
            this._hatedTurret = null;
            this._playerTaunted = false;  // 视觉发现 ≠ 玩家攻击嘲讽

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
        const hitY = this.colliderOffsetY;
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
            const hitX = toX;
            const hitY = toY + this.colliderOffsetY;

            let needSideCheck = false;
            if (cw && cw.checkHit(hitX, hitY, hw, hh, blockGroups, this._collider)) {
                needSideCheck = true;
            }

            if (needSideCheck) {
                const sideResult = this.trySideDirection(this._tempDir.x, this._tempDir.y, step, hitX, hitY, hw, hh, blockGroups, cw!);
                if (sideResult) {
                    toX = sideResult.x;
                    toY = sideResult.y - this.colliderOffsetY;
                } else {
                    toX = selfPos.x;
                    toY = selfPos.y;
                }
            } else {
                this._wallSlideDir.set(0, 0, 0);
            }

            const resolved = CollisionWorld.instance?.resolveMove(
                this._collider,
                selfPos.x, selfPos.y + this.colliderOffsetY,
                hitX, hitY,
            );
            if (resolved) {
                toX = resolved.x;
                toY = resolved.y - this.colliderOffsetY;
            }

            this._collider.x = toX;
            this._collider.y = toY + this.colliderOffsetY;
        }

        this._tempPos.set(toX, toY, selfPos.z);
        this.node.setWorldPosition(this._tempPos);
    }

    // ========== 侧向寻路 ==========

    /**
     * 壁面循迹式滑动：正前方不通时，在四个轴向方向中选可通行者滑动。
     * 关键改进：滑动距离使用完整的 step（而非 dirX*step），垂直撞向长墙时不会退化为 0 位移；
     * 且一旦开始沿墙滑动，会用持久方向 _wallSlideDir 持续同向滑行直到绕过障碍，而不是每帧随机摇摆。
     */
    private trySideDirection(
        dirX: number, dirY: number, step: number, baseX: number, baseY: number,
        hw: number, hh: number, blockGroups: ColliderGroup[], cw: CollisionWorld,
    ): { x: number; y: number } | null {
        const startX = baseX - dirX * step;
        const startY = baseY - dirY * step;

        // 四个轴向候选：每次移动完整的 step
        const cands = [
            { x: startX + step, y: startY },
            { x: startX - step, y: startY },
            { x: startX, y: startY + step },
            { x: startX, y: startY - step },
        ];

        const free: { x: number; y: number }[] = [];
        for (const c of cands) {
            if (!cw.checkHit(c.x, c.y, hw, hh, blockGroups, this._collider)) {
                free.push(c);
            }
        }
        if (free.length === 0) {
            this._wallSlideDir.set(0, 0, 0);
            return null;
        }

        // 1) 持久方向优先：上次沿墙滑动方向仍可通行则继续同向，保证壁面循迹不回头
        //    （_wallSlideDir 存归一化方向 ±1/0，避免因 step 每帧抖动导致相等判断失败）
        if (this._wallSlideDir.x !== 0 || this._wallSlideDir.y !== 0) {
            for (const c of free) {
                if ((c.x - startX) / step === this._wallSlideDir.x && (c.y - startY) / step === this._wallSlideDir.y) {
                    return c;
                }
            }
        }

        // 2) 偏好：朝移动方向推进（点积最大）为主，顺时针（移动方向右侧）作为平局打破规则
        const rotCWx = dirY;
        const rotCWy = -dirX;
        let best = free[0];
        let bestScore = -Infinity;
        for (const c of free) {
            const cx = c.x - startX;
            const cy = c.y - startY;
            const score = (cx * dirX + cy * dirY) * 1.0 + (cx * rotCWx + cy * rotCWy) * 0.2;
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }

        // 记录持久滑动方向（归一化为 ±1/0）
        this._wallSlideDir.set((best.x - startX) / step, (best.y - startY) / step, 0);
        return best;
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

    /** 完全卡死时强制脱困：随机尝试最多 8 个方向，找到第一个空位就瞬移出去 */
    private forceEscapeStuck() {
        const wp = this.node.worldPosition;
        const hw = this.colliderHalfW;
        const hh = this.colliderHalfH;
        const blockGroups = [ColliderGroup.Zombie, ColliderGroup.Wall, ColliderGroup.Turret, ColliderGroup.Resource];
        const cw = CollisionWorld.instance;
        for (let i = 0; i < 8; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dx = Math.cos(angle) * STUCK_ESCAPE_DIST;
            const dy = Math.sin(angle) * STUCK_ESCAPE_DIST;
            const newX = wp.x + dx;
            const newY = wp.y + dy;
            if (cw && !cw.checkHit(newX, newY + this.colliderOffsetY, hw, hh, blockGroups, this._collider)) {
                this._tempPos.set(newX, newY, wp.z);
                this.node.setWorldPosition(this._tempPos);
                this._collider.x = newX;
                this._collider.y = newY + this.colliderOffsetY;
                this._lastX = newX;
                this._lastY = newY;
                return;
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

        // 普通攻击音效（命中时播放）
        this.playAttackSound();

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
        this._playerTaunted = false;

        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }

        this.playDeathAnimation();
        this.playDeathSound();
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

        // 每帧从 origin + offset 重算 target，抵消 YSortLayer 移动
        const origin = this.getWanderOriginWorld();
        this._wanderTarget.set(
            origin.x + this._wanderTargetOffset.x,
            origin.y + this._wanderTargetOffset.y,
            0,
        );

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
            const hitX = toX;
            const hitY = toY + this.colliderOffsetY;

            let needSideCheck = false;
            if (cw && cw.checkHit(hitX, hitY, hw, hh, blockGroups, this._collider)) {
                needSideCheck = true;
            }

            if (needSideCheck) {
                const sideResult = this.trySideDirection(this._tempDir.x, this._tempDir.y, step, hitX, hitY, hw, hh, blockGroups, cw!);
                if (sideResult) {
                    toX = sideResult.x;
                    toY = sideResult.y - this.colliderOffsetY;
                } else {
                    toX = selfPos.x;
                    toY = selfPos.y;
                }
            } else {
                this._wallSlideDir.set(0, 0, 0);
            }

            const resolved = CollisionWorld.instance?.resolveMove(
                this._collider,
                selfPos.x, selfPos.y + this.colliderOffsetY,
                hitX, hitY,
            );
            if (resolved) {
                toX = resolved.x;
                toY = resolved.y - this.colliderOffsetY;
            }
            this._collider.x = toX;
            this._collider.y = toY + this.colliderOffsetY;
        }

        this._tempPos.set(toX, toY, selfPos.z);
        this.node.setWorldPosition(this._tempPos);
    }

    private pickNewWanderTarget() {
        const origin = this.getWanderOriginWorld();
        const angle = Math.random() * Math.PI * 2;
        const radius = randomRange(0, this.wanderPatrolRadius);
        // 存储 offset，每帧从 origin + offset 重算 target，抵消 YSortLayer 移动
        this._wanderTargetOffset.set(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            0,
        );
        this._wanderTarget.set(
            origin.x + this._wanderTargetOffset.x,
            origin.y + this._wanderTargetOffset.y,
            0,
        );
        this._hasWanderTarget = true;
    }

    getWanderOriginWorld(): Vec3 {
        // 优先使用扫描到的地标节点（与僵尸同在 YSortLayer 下，相对位置不变）
        if (this._wanderLandmarkNode?.isValid) {
            return this._wanderLandmarkNode.worldPosition;
        }
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
                // 死亡动画播完直接销毁，避免节点失活后 scheduleOnce 不再触发导致永久残留
                if (this.node.isValid) {
                    this.node.destroy();
                }
                return;
            }
            this.bodySprite.spriteFrame = this.deathFrames[this._animFrameIndex];
        }
    }

    private playWalkAnimation(directionX = 0) {
        if (this._aiState === 'DEAD') return;
        if (!this.bodySprite || this.walkFrames.length === 0) return;

        // 朝右走时镜像逻辑：BOSS1 素材默认朝左，向右走需翻转；BOSS2 素材默认朝右，向左走需翻转
        const newMirror = this.boss2FacingRight
            ? (directionX < 0 ? -1 : 1)
            : (directionX > 0 ? -1 : 1);

        if (this._aiState !== 'WANDER' && this._aiState !== 'CHASE_BASE' && this._aiState !== 'CHASE_PLAYER'
            && this._aiState !== 'MEMORY_TRACK' && this._aiState !== 'CHASE_TURRET'
            && this._aiState !== 'CHASE_BUILDING' && this._aiState !== 'BOSS2_IDLE') {
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
        const scaleX = this.boss2FacingRight
            ? (targetIsRight ? 1 : -1)
            : (targetIsRight ? -1 : 1);
        this._walkMirror = scaleX;
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

    /** 播放死亡音效（距离衰减 + 同类型互斥） */
    private playDeathSound() {
        if (!this._audioSource || !this.deathSound) return;

        const typeKey = this.node.name;
        if (ZombieMove._deathSoundPlaying[typeKey]) return;

        const playerNode = find('GameWorld/YSortLayer/Player');
        if (!playerNode) return;

        const dist = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
        if (dist >= this.deathSoundMaxDistance) return;

        ZombieMove._deathSoundPlaying[typeKey] = true;
        const volume = 1 - dist / this.deathSoundMaxDistance;
        this._audioSource.playOneShot(this.deathSound, Math.max(0, volume));

        // 0.5秒后解除互斥，允许同类型下一只僵尸播放死亡音效
        this.scheduleOnce(() => {
            ZombieMove._deathSoundPlaying[typeKey] = false;
        }, 0.5);
    }

    /** 播放普通攻击音效（距离衰减） */
    private playAttackSound() {
        if (!this._audioSource || !this.attackSound) return;
        const playerNode = find('GameWorld/YSortLayer/Player');
        if (playerNode) {
            const dist = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
            if (dist >= this.attackSoundMaxDistance) return;
            const volume = 1 - dist / this.attackSoundMaxDistance;
            this._audioSource.playOneShot(this.attackSound, Math.max(0, volume));
        } else {
            this._audioSource.playOneShot(this.attackSound, 1);
        }
    }

    /** 播放射击音效（距离衰减，每轮弹幕开始发射时播放一次） */
    private playShotSound() {
        if (!this._audioSource || !this.shotSound) return;
        const playerNode = find('GameWorld/YSortLayer/Player');
        if (playerNode) {
            const dist = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
            if (dist >= this.shotSoundMaxDistance) return;
            const volume = 1 - dist / this.shotSoundMaxDistance;
            this._audioSource.playOneShot(this.shotSound, Math.max(0, volume));
        } else {
            this._audioSource.playOneShot(this.shotSound, 1);
        }
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

    /** 命中中心世界坐标：根节点位置 + 碰撞体 Y 偏移（贴图锚点在脚部时上移到贴图中心） */
    getHitWorldPosition(out: Vec3 = new Vec3()): Vec3 {
        out.set(this.node.worldPosition);
        out.y += this.colliderOffsetY;
        return out;
    }
}