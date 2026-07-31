import { _decorator, AudioClip, AudioSource, Color, Component, Node, Sprite, Vec3, warn } from 'cc';
import { BaseSystem } from './BaseSystem';
import { ReinforcementNotice } from './ReinforcementNotice';
import { PlayerController } from './PlayerController';
import { PlayerData } from './PlayerData';

const { ccclass, property } = _decorator;

/** 默认安全区半径（BaseSystem 未就绪时回退） */
const FALLBACK_SAFE_RADIUS = 300;

const FATIGUE_GAIN_MIN = 0.5;
const FATIGUE_RECOVERY_RATE = 8;
const FATIGUE_MAX = 100;
const FATIGUE_DT_MAX = 1 / 15; // dt 上限 ~0.067s，防止帧率骤降导致疲劳跳变
const STATUS_LOG_INTERVAL = 1;

enum FatigueMode {
    RECOVERING = 'recovering',
    RISING = 'rising',
    IDLE = 'idle',
}

/**
 * 主角属性、战斗数值、职业科技树与疲劳度核心逻辑。
 */
@ccclass('PlayerState')
export class PlayerState extends Component {
    static instance: PlayerState | null = null;

    @property({ tooltip: '当前血量' })
    hp = 100;

    @property({ tooltip: '最大血量' })
    maxHp = 100;

    @property({ tooltip: '玩家攻击力' })
    attackDamage = 10;

    @property({ tooltip: '每次攻击建筑的回血量' })
    repairPerHit = 10;

    @property({ tooltip: '攻击/维修范围（像素）' })
    repairRange = 50;

    @property({ tooltip: '移动速度（像素/秒）' })
    moveSpeed = 250;

    @property({ tooltip: '当前疲劳度 0-100' })
    fatigue = 0;

    @property({ tooltip: '疲劳满后每秒扣除的血量' })
    exhaustedHpDrain = 5;

    @property({ tooltip: '当前职业' })
    profession = 'Collector';

    @property({ tooltip: '速度分支加成（像素/秒）' })
    bonusSpeed = 0;

    @property({ tooltip: '贪婪分支：每次采集额外产出' })
    bonusYield = 0;

    @property({ tooltip: '疲劳基础增加速度（点/秒）' })
    fatigueGainBase = 5;

    @property({ tooltip: '忍耐分支：疲劳上升减免（点/秒）' })
    fatigueReduction = 0;

    @property({ tooltip: '速度分支等级 0-5' })
    collectorSpeedLevel = 0;

    @property({ tooltip: '贪婪分支等级 0-5' })
    collectorYieldLevel = 0;

    @property({ tooltip: '忍耐分支等级 0-5' })
    collectorFatigueLevel = 0;

    // ---- 属性升级面板 ----

    @property({ tooltip: '当前可用的升级点数' })
    upgradePoints = 0;

    @property({ tooltip: '每天获得的属性点数' })
    upgradePointsPerDay = 1;

    @property({ tooltip: '属性点数上限' })
    maxUpgradePoints = 20;

    @property({ tooltip: '行走速度倍率（生存面板升级）' })
    walkSpeedMultiplier = 1.0;

    @property({ tooltip: '血量倍率（生存面板升级）' })
    hpMultiplier = 1.0;

    @property({ tooltip: '疲劳增长倍率（生存面板升级，越低越好）' })
    fatigueGainMultiplier = 1.0;

    @property({ tooltip: '木材采集倍率（生存面板升级）' })
    woodCollectMultiplier = 1.0;

    @property({ tooltip: '铜矿采集倍率（生存面板升级）' })
    copperCollectMultiplier = 1.0;

    @property({ tooltip: '铁矿采集倍率（生存面板升级）' })
    ironCollectMultiplier = 1.0;

    @property({ tooltip: '背包容量倍率（生存面板bagexpand升级）' })
    backpackCapacityMultiplier = 1.0;

    /** 僵尸感知距离倍率（生存面板潜行升级，越低越好） */
    static zombieAlertRadiusMultiplier = 1.0;

    /** 玩家是否处于完全隐身（僵尸已锁定玩家的也会丢失目标） */
    static isPlayerInvisible = false;

    /** 潜行技能等级（0=未激活，1=已激活） */
    static stealthLevel = 0;

    @property({ tooltip: '隐身持续时间（秒）' })
    stealthDuration = 10;

    @property({ tooltip: '隐身时透明度（0-255）' })
    stealthOpacity = 80;

    @property({ tooltip: '触发隐身的血量百分比阈值' })
    stealthHpThreshold = 0.15;

    /** 潜行阶段：normal / stealthed / reduced */
    private _stealthPhase: 'normal' | 'stealthed' | 'reduced' = 'normal';
    private _stealthTimer = 0;

    // ---- 工程面板升级 ----

    @property({ tooltip: '远程维修等级 (0-1)' })
    remoteRepairLevel = 0;

    @property({ tooltip: '远程维修范围（像素）' })
    remoteRepairRange = 200;

    @property({ tooltip: '远程维修每秒回血量' })
    remoteRepairHealPerSec = 5;

    @property({ tooltip: '是否启用远程用材料（直接消耗仓库物资）' })
    remoteMaterialEnabled = false;

    @property({ tooltip: '全局省材料率 (0-0.2，工程面板升级)' })
    materialSaveRate = 0;

    @property({ tooltip: '全局省电率 (0-0.2，工程面板升级)' })
    powerSaveRate = 0;

    @property({ tooltip: '拆除建筑材料返还比例 (0-1，工程面板 MaterialRetun 升级)' })
    materialRefundRate = 0;

    // ---- 武器面板升级 ----

    @property({ tooltip: '攻击力倍率（武器面板升级）' })
    attackDamageMultiplier = 1.0;

    @property({ tooltip: '是否处于武器模式（可攻击僵尸，不可采矿）' })
    weaponMode = false;

    @property({ tooltip: '武器攻击间隔（秒），由武器类型决定' })
    weaponAttackInterval = 0.5;

    @property({ tooltip: '武器伤害值（由武器类型决定）' })
    weaponDamage = 10;

    @property({ tooltip: '基地节点名（用于自动查找）' })
    baseNodeName = 'Base';

    @property({ type: Node, tooltip: '基地节点，不填则按名称在场景中查找' })
    baseNode: Node | null = null;

    @property({ type: Sprite, tooltip: '玩家身体Sprite，用于受击闪红效果' })
    playerSprite: Sprite | null = null;

    @property({ tooltip: '玩家控制器组件，用于死亡动画和复活' })
    playerController: PlayerController | null = null;

    @property({ tooltip: '每隔多少秒打印一次状态日志' })
    statusLogInterval = STATUS_LOG_INTERVAL;

    @property({ type: AudioClip, tooltip: '疲劳度满后间隔播放的音效' })
    fatigueSound: AudioClip | null = null;

    private _baseNode: Node | null = null;
    private _statusLogTimer = 0;
    private _fatigueMode: FatigueMode = FatigueMode.IDLE;
    private _wasExhausted = false;
    private _baseMissingLogged = false;
    private _deathLogged = false;
    private _flashTimer = 0;
    private _flashDuration = 0.15;
    private _audioSource: AudioSource | null = null;
    private _fatigueSoundTimer = 0;

    // 死亡与复活
    private _deathCount = 0;
    private _respawnTimer = 0;
    private _respawnLabelTimer = 0;
    private _isDead = false;

    /** 玩家本地坐标（每帧更新，供存档系统使用，相对于 GameWorld） */
    private _localX = 0;
    private _localY = 0;

    /** 获取玩家本地 X 坐标（相对于 GameWorld） */
    get worldX(): number { return this._localX; }
    /** 获取玩家本地 Y 坐标（相对于 GameWorld） */
    get worldY(): number { return this._localY; }

    onLoad() {
        if (PlayerState.instance && PlayerState.instance !== this) {
            warn('[PlayerState] 场景中存在多个 PlayerState，已销毁重复实例');
            this.destroy();
            return;
        }
        PlayerState.instance = this;
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
        this.resolveBaseNode();
    }

    onDestroy() {
        if (PlayerState.instance === this) {
            PlayerState.instance = null;
        }
    }

    start() {
        if (!this._baseNode) {
            this.resolveBaseNode();
        }

        this._fatigueMode = this.getFatigueMode(this.getDistanceToBase());
        this._wasExhausted = this.isExhausted;
    }

    update(dt: number) {
        // 每帧更新本地坐标（相对于 GameWorld，供存档系统使用）
        const lp = this.node.position;
        this._localX = lp.x;
        this._localY = lp.y;

        // 受击闪红渐变恢复（隐身时跳过，避免覆盖透明度）
        if (this._flashTimer > 0 && this.playerSprite && !PlayerState.isPlayerInvisible) {
            this._flashTimer -= dt;
            const t = 1 - Math.max(0, this._flashTimer) / this._flashDuration;
            const r = 255;
            const g = Math.round(150 + 105 * t);
            const b = Math.round(150 + 105 * t);
            this.playerSprite.color = new Color(r, g, b, 255);
        }

        // 死亡复活倒计时
        if (this._isDead) {
            this._respawnTimer -= dt;
            this._respawnLabelTimer -= dt;
            if (this._respawnLabelTimer <= 0) {
                this._respawnLabelTimer = 1.0;
                const remaining = Math.ceil(this._respawnTimer);
                if (remaining > 0) {
                    ReinforcementNotice.show(`复活倒计时: ${remaining}秒`);
                }
            }
            if (this._respawnTimer <= 0) {
                this.respawn();
            }
            return;
        }

        if (this.hp <= 0) {
            return;
        }

        if (!this._baseNode) {
            if (!this._baseMissingLogged) {
                warn(`[PlayerState] 未找到基地节点 "${this.baseNodeName}"，疲劳逻辑未运行`);
                this._baseMissingLogged = true;
            }
            return;
        }

        const distance = this.getDistanceToBase();
        const safeRadius = this.getSafeRadius();
        const prevMode = this._fatigueMode;
        const prevExhausted = this._wasExhausted;

        this.updateFatigue(dt, distance, safeRadius);
        if (!prevExhausted && this.isExhausted) {
            ReinforcementNotice.show('疲劳度已满，每秒扣除生命值，请返回基地安全区恢复');
        }
        this.updateBaseHpRegen(dt, distance, safeRadius);

        const currMode = this.getFatigueMode(distance, safeRadius);
        this.logFatigueTransitions(prevMode, currMode, distance, safeRadius);
        this.logExhaustedTransition(prevExhausted, this.isExhausted);

        this._fatigueMode = currMode;
        this._wasExhausted = this.isExhausted;

        if (this.isExhausted) {
            this.hp = Math.max(0, this.hp - this.exhaustedHpDrain * dt);
            // 疲劳度已满时，间隔2秒播放疲劳音效
            this._fatigueSoundTimer += dt;
            if (this._fatigueSoundTimer >= 2 && this._audioSource && this.fatigueSound) {
                this._fatigueSoundTimer = 0;
                this._audioSource.playOneShot(this.fatigueSound, 1);
            }
            if (this.hp <= 0) {
                this.onPlayerDeath();
            }
        } else {
            this._fatigueSoundTimer = 0;
        }

        this.hp = Math.min(this.hp, this.getEffectiveMaxHp());
        this.fatigue = Math.min(this.fatigue, FATIGUE_MAX);

        // 远程维修：自动回血范围内炮塔
        this.updateRemoteRepair(dt);

        // 潜行技能：低血量自动隐身
        this.updateStealthState(dt);

        this._statusLogTimer += dt;
        if (this._statusLogTimer >= this.statusLogInterval) {
            this._statusLogTimer = 0;
            this.logPeriodicStatus(distance, safeRadius);
        }
    }

    /** 玩家是否存活 */
    get isAlive(): boolean {
        return this.hp > 0;
    }

    get isExhausted(): boolean {
        return this.fatigue >= FATIGUE_MAX;
    }

    get isInsideBase(): boolean {
        return this.getDistanceToBase() <= this.getSafeRadius();
    }

    /**
     * 最终移动速度 = (moveSpeed + bonusSpeed) * walkSpeedMultiplier，虚弱时减半。
     */
    getFinalMoveSpeed(): number {
        const raw = (this.moveSpeed + this.bonusSpeed) * this.walkSpeedMultiplier;
        return this.isExhausted ? raw * 0.5 : raw;
    }

    /** 受到伤害 */
    takeDamage(amount: number) {
        if (!this.isAlive || amount <= 0) {
            return;
        }

        this.hp = Math.max(0, this.hp - amount);

        // 受击闪红
        if (this.playerSprite) {
            this.playerSprite.color = new Color(255, 150, 150, 255);
            this._flashTimer = this._flashDuration;
        }

        // 播放受伤音效
        if (this.playerController) {
            this.playerController.playHurtSound();
        }

        if (this.hp <= 0) {
            this.onPlayerDeath();
        }
    }

    getSafeRadius(): number {
        return BaseSystem.instance
            ? BaseSystem.instance.getCurrentSafeRadius()
            : FALLBACK_SAFE_RADIUS;
    }

    getDistanceToBase(): number {
        if (!this._baseNode) {
            return Number.MAX_VALUE;
        }
        const playerPos = this.node.worldPosition;
        const basePos = this._baseNode.worldPosition;
        const dx = playerPos.x - basePos.x;
        const dy = playerPos.y - basePos.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    applyCollectorTechLevels(speedLv: number, yieldLv: number, fatigueLv: number) {
        this.collectorSpeedLevel = Math.min(5, Math.max(0, speedLv));
        this.collectorYieldLevel = Math.min(5, Math.max(0, yieldLv));
        this.collectorFatigueLevel = Math.min(5, Math.max(0, fatigueLv));

        this.bonusSpeed = this.collectorSpeedLevel * 20;
        this.bonusYield = this.collectorYieldLevel;
        this.fatigueReduction = this.collectorFatigueLevel;
    }

    /** 获取当前有效最大血量（maxHp * hpMultiplier） */
    getEffectiveMaxHp(): number {
        return Math.round(this.maxHp * this.hpMultiplier);
    }

    /** 获取指定资源类型的采集倍率 */
    getResourceCollectMultiplier(resourceType: string): number {
        switch (resourceType) {
            case 'wood': return this.woodCollectMultiplier;
            case 'copper': return this.copperCollectMultiplier;
            case 'iron': return this.ironCollectMultiplier;
            default: return 1.0;
        }
    }

    /** 获取背包有效容量上限（基础上限 × 背包容量倍率） */
    getEffectiveBackpackMax(baseMax: number): number {
        return Math.round(baseMax * this.backpackCapacityMultiplier);
    }

    /** 远程维修：范围内所有受损建筑自动回血 */
    private updateRemoteRepair(dt: number) {
        if (this.remoteRepairLevel <= 0) return;

        const buildings = this.findAllDamageableBuildings();
        const playerPos = this.node.worldPosition;

        for (const building of buildings) {
            if (!building.node.isValid) continue;
            const hp = building['hp'] ?? building['baseHp'] ?? 0;
            const maxHp = building['maxHp'] ?? building['maxBaseHp'] ?? 0;
            if (hp <= 0 || maxHp <= 0) continue;

            const dist = Vec3.distance(playerPos, building.node.worldPosition);
            if (dist > this.remoteRepairRange) continue;
            // 距离越近，回血越多（线性衰减）
            const ratio = 1 - dist / this.remoteRepairRange;
            const heal = this.remoteRepairHealPerSec * ratio * dt;
            const newHp = Math.min(maxHp, hp + heal);

            if ('baseHp' in building) {
                building['baseHp'] = newHp;
            } else if ('hp' in building) {
                building['hp'] = newHp;
            }
        }
    }

    /** 潜行技能：低血量自动隐身状态机 */
    private updateStealthState(dt: number) {
        if (PlayerState.stealthLevel < 1) return;

        const effectiveMaxHp = this.getEffectiveMaxHp();
        const hpRatio = this.hp / effectiveMaxHp;
        const isLowHp = this.hp > 0 && hpRatio <= this.stealthHpThreshold;

        switch (this._stealthPhase) {
            case 'normal':
                if (isLowHp) {
                    this._stealthPhase = 'stealthed';
                    this._stealthTimer = this.stealthDuration;
                    this.setPlayerOpacity(this.stealthOpacity);
                    PlayerState.isPlayerInvisible = true;
                    PlayerState.zombieAlertRadiusMultiplier = 0;
                }
                break;

            case 'stealthed':
                if (!isLowHp) {
                    this._stealthPhase = 'normal';
                    this._stealthTimer = 0;
                    this.setPlayerOpacity(255);
                    PlayerState.isPlayerInvisible = false;
                    PlayerState.zombieAlertRadiusMultiplier = 1.0;
                } else {
                    this._stealthTimer -= dt;
                    if (this._stealthTimer <= 0) {
                        this._stealthPhase = 'reduced';
                        this.setPlayerOpacity(255);
                        PlayerState.isPlayerInvisible = false;
                        PlayerState.zombieAlertRadiusMultiplier = 0.5;
                    }
                }
                break;

            case 'reduced':
                if (!isLowHp) {
                    this._stealthPhase = 'normal';
                    this.setPlayerOpacity(255);
                    PlayerState.zombieAlertRadiusMultiplier = 1.0;
                }
                break;
        }
    }

    /** 设置玩家贴图透明度 */
    private setPlayerOpacity(opacity: number) {
        if (!this.playerSprite) return;
        const color = this.playerSprite.color.clone();
        this.playerSprite.color = new Color(color.r, color.g, color.b, opacity);
    }

    /** 查找场景中所有可伤害的建筑（Turret, PlantGenerator, Container） */
    private findAllDamageableBuildings(): Component[] {
        const scene = this.node.scene;
        if (!scene) return [];
        const result: Component[] = [];
        this.collectDamageableComponents(scene, result);
        return result;
}

    /** 递归收集所有带 hp 的建筑组件 */
    private collectDamageableComponents(root: Node, out: Component[]) {
        // 检查所有建筑类型
        const turret = root.getComponent('Turret') as Component | null;
        if (turret && typeof turret['hp'] === 'number') out.push(turret);

        const plant = root.getComponent('PlantGenerator') as Component | null;
        if (plant && typeof plant['hp'] === 'number') out.push(plant);

        const container = root.getComponent('Container') as Component | null;
        if (container && typeof container['hp'] === 'number') out.push(container);

        const base = root.getComponent('BaseSystem') as Component | null;
        if (base && typeof base['baseHp'] === 'number') out.push(base);

        for (const child of root.children) {
            this.collectDamageableComponents(child, out);
        }
    }

    private onPlayerDeath() {
        if (this._deathLogged) {
            return;
        }
        this._deathLogged = true;
        this._isDead = true;
        this._deathCount++;

        // 播放死亡动画
        if (this.playerController) {
            this.playerController.playDeathAnimation();
        }

        // 背包资源与金钱清零
        const data = PlayerData.instance;
        if (data) {
            data.woodCount = 0;
            data.copperCount = 0;
            data.ironCount = 0;
            data.money = 0;
        }

        // 计算复活时间（15s → 30s → 60s → 90s 上限）
        this._respawnTimer = Math.min(15 * Math.pow(2, this._deathCount - 1), 90);
        ReinforcementNotice.show(`你已死亡，${this._respawnTimer}秒后在基地复活，背包资源已清零`);
    }

    /** 复活：恢复血量、移动到基地、恢复玩家显示 */
    private respawn() {
        this._isDead = false;
        this._deathLogged = false;
        this._respawnTimer = 0;

        // 恢复血量与疲劳
        this.hp = this.getEffectiveMaxHp();
        this.fatigue = 0;

        // 重置隐身状态
        this._stealthPhase = 'normal';
        this._stealthTimer = 0;
        this.setPlayerOpacity(255);
        PlayerState.isPlayerInvisible = false;
        PlayerState.zombieAlertRadiusMultiplier = 1.0;

        // 移动到基地位置
        if (this._baseNode) {
            const basePos = this._baseNode.worldPosition.clone();
            this.node.setWorldPosition(basePos.x, basePos.y, 0);
        }

        // 恢复玩家显示
        if (this.playerController) {
            this.playerController.respawn();
        }

        ReinforcementNotice.show('你已在基地复活');
    }

    private updateBaseHpRegen(dt: number, distance: number, safeRadius: number) {
        if (distance > safeRadius || this.fatigue > 0) {
            return;
        }

        const regen = BaseSystem.instance
            ? BaseSystem.instance.getCurrentHpRegen()
            : 0;

        const effectiveMaxHp = this.getEffectiveMaxHp();
        if (regen <= 0 || this.hp >= effectiveMaxHp) {
            return;
        }

        this.hp = Math.min(effectiveMaxHp, this.hp + regen * dt);
    }

    private getFatigueMode(distance: number, safeRadius: number): FatigueMode {
        if (distance <= safeRadius) {
            return this.fatigue > 0 ? FatigueMode.RECOVERING : FatigueMode.IDLE;
        }
        return FatigueMode.RISING;
    }

    private logFatigueTransitions(
        prev: FatigueMode,
        curr: FatigueMode,
        distance: number,
        safeRadius: number,
    ) {
        if (prev === curr) {
            return;
        }

        if (curr === FatigueMode.RISING) {
            return;
        }

        if (curr === FatigueMode.RECOVERING) {
            return;
        }

        if (curr === FatigueMode.IDLE && prev === FatigueMode.RECOVERING) {
            // 疲劳已恢复，不需要额外处理
        }
    }

    private logExhaustedTransition(wasExhausted: boolean, isExhausted: boolean) {
        // 不需要日志
    }

    private logPeriodicStatus(distance: number, safeRadius: number) {
        // 不需要日志
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
            warn(`[PlayerState] 未找到名为 "${this.baseNodeName}" 的基地节点`);
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

    private updateFatigue(dt: number, distance: number, safeRadius: number) {
        // 裁剪 dt 防止帧率骤降导致疲劳跳变
        const clampedDt = Math.min(dt, FATIGUE_DT_MAX);

        if (distance > safeRadius) {
            const gainPerSecond = Math.max(
                FATIGUE_GAIN_MIN,
                this.fatigueGainBase * this.fatigueGainMultiplier - this.fatigueReduction,
            );
            this.fatigue += gainPerSecond * clampedDt;
        } else {
            this.fatigue = Math.max(0, this.fatigue - FATIGUE_RECOVERY_RATE * clampedDt);
        }
    }

    /** 每日增加属性点（不超过上限） */
    addDayUpgradePoints() {
        this.upgradePoints = Math.min(
            this.maxUpgradePoints,
            this.upgradePoints + this.upgradePointsPerDay,
        );
    }
}