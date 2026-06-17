import { _decorator, Component, log, Node, Vec3, warn } from 'cc';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

/** 默认安全区半径（BaseSystem 未就绪时回退） */
const FALLBACK_SAFE_RADIUS = 300;

const FATIGUE_GAIN_BASE = 5;
const FATIGUE_GAIN_MIN = 0.5;
const FATIGUE_RECOVERY_RATE = 8;
const FATIGUE_MAX = 100;
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

    @property({ tooltip: '忍耐分支：疲劳上升减免（点/秒）' })
    fatigueReduction = 0;

    @property({ tooltip: '速度分支等级 0-5' })
    collectorSpeedLevel = 0;

    @property({ tooltip: '贪婪分支等级 0-5' })
    collectorYieldLevel = 0;

    @property({ tooltip: '忍耐分支等级 0-5' })
    collectorFatigueLevel = 0;

    @property({ tooltip: '基地节点名（用于自动查找）' })
    baseNodeName = 'Base';

    @property({ type: Node, tooltip: '基地节点，不填则按名称在场景中查找' })
    baseNode: Node | null = null;

    @property({ tooltip: '每隔多少秒打印一次状态日志' })
    statusLogInterval = STATUS_LOG_INTERVAL;

    private _baseNode: Node | null = null;
    private _statusLogTimer = 0;
    private _fatigueMode: FatigueMode = FatigueMode.IDLE;
    private _wasExhausted = false;
    private _baseMissingLogged = false;
    private _deathLogged = false;

    onLoad() {
        if (PlayerState.instance && PlayerState.instance !== this) {
            warn('[PlayerState] 场景中存在多个 PlayerState，已销毁重复实例');
            this.destroy();
            return;
        }
        PlayerState.instance = this;
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

        log(
            `[PlayerState] 初始化 | HP ${this.hp}/${this.maxHp} | 攻击 ${this.attackDamage} / ${this.attackInterval}s | 移速 ${this.getFinalMoveSpeed()} | 安全区 ${this.getSafeRadius()}`,
        );
    }

    update(dt: number) {
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
        this.updateBaseHpRegen(dt, distance, safeRadius);

        const currMode = this.getFatigueMode(distance, safeRadius);
        this.logFatigueTransitions(prevMode, currMode, distance, safeRadius);
        this.logExhaustedTransition(prevExhausted, this.isExhausted);

        this._fatigueMode = currMode;
        this._wasExhausted = this.isExhausted;

        if (this.isExhausted) {
            this.hp = Math.max(0, this.hp - this.exhaustedHpDrain * dt);
            if (this.hp <= 0) {
                this.onPlayerDeath();
            }
        }

        this.hp = Math.min(this.hp, this.maxHp);
        this.fatigue = Math.min(this.fatigue, FATIGUE_MAX);

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
     * 最终移动速度 = (moveSpeed + bonusSpeed)，虚弱时减半。
     */
    getFinalMoveSpeed(): number {
        const raw = this.moveSpeed + this.bonusSpeed;
        return this.isExhausted ? raw * 0.5 : raw;
    }

    /** 受到伤害 */
    takeDamage(amount: number) {
        if (!this.isAlive || amount <= 0) {
            return;
        }

        this.hp = Math.max(0, this.hp - amount);

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

    private onPlayerDeath() {
        if (this._deathLogged) {
            return;
        }
        this._deathLogged = true;
        log('🚨 玩家已阵亡！游戏结束！');
    }

    private updateBaseHpRegen(dt: number, distance: number, safeRadius: number) {
        if (distance > safeRadius || this.fatigue > 0) {
            return;
        }

        const regen = BaseSystem.instance
            ? BaseSystem.instance.getCurrentHpRegen()
            : 0;

        if (regen <= 0 || this.hp >= this.maxHp) {
            return;
        }

        this.hp = Math.min(this.maxHp, this.hp + regen * dt);
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
            const gain = Math.max(FATIGUE_GAIN_MIN, FATIGUE_GAIN_BASE - this.fatigueReduction);
            log(
                `[PlayerState] 已离开基地（距离 ${distance.toFixed(0)} > ${safeRadius}），疲劳开始上升（约 ${gain.toFixed(1)} 点/秒）`,
            );
            return;
        }

        if (curr === FatigueMode.RECOVERING) {
            log(
                `[PlayerState] 已回到基地范围内（距离 ${distance.toFixed(0)} <= ${safeRadius}），疲劳开始下降（${FATIGUE_RECOVERY_RATE} 点/秒）`,
            );
            return;
        }

        if (curr === FatigueMode.IDLE && prev === FatigueMode.RECOVERING) {
            const regen = BaseSystem.instance?.getCurrentHpRegen() ?? 0;
            log(
                `[PlayerState] 疲劳已恢复至 0${regen > 0 ? `，基地回血 ${regen} 点/秒` : ''}`,
            );
        }
    }

    private logExhaustedTransition(wasExhausted: boolean, isExhausted: boolean) {
        if (!wasExhausted && isExhausted) {
            log(
                `[PlayerState] 疲劳已达 ${FATIGUE_MAX}，虚弱：移速减半，每秒扣血 ${this.exhaustedHpDrain}`,
            );
            return;
        }

        if (wasExhausted && !isExhausted) {
            log('[PlayerState] 已脱离虚弱惩罚状态');
        }
    }

    private logPeriodicStatus(distance: number, safeRadius: number) {
        const zone = this.isInsideBase ? '基地内' : '基地外';
        const exhaustedTag = this.isExhausted ? ' | 虚弱中' : '';
        const regen = BaseSystem.instance?.getCurrentHpRegen() ?? 0;
        const regenTag =
            this.isInsideBase && this.fatigue <= 0 && regen > 0
                ? ` | 回血 ${regen}/秒`
                : '';
        log(
            `[PlayerState] 疲劳: ${this.fatigue.toFixed(1)}, 血量: ${this.hp.toFixed(1)}/${this.maxHp} | ${zone} | 距基地: ${distance.toFixed(0)} | 安全区: ${safeRadius}${exhaustedTag}${regenTag}`,
        );
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
        if (distance > safeRadius) {
            const gainPerSecond = Math.max(
                FATIGUE_GAIN_MIN,
                FATIGUE_GAIN_BASE - this.fatigueReduction,
            );
            this.fatigue += gainPerSecond * dt;
        } else {
            this.fatigue = Math.max(0, this.fatigue - FATIGUE_RECOVERY_RATE * dt);
        }
    }
}
