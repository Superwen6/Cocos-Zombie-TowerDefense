import {
    _decorator,
    CCFloat,
    Component,
    find,
    instantiate,
    Node,
    Prefab,
    Vec3,
    warn,
} from 'cc';
import {
    DayNightEvents,
    DayNightPhase,
    DayNightPhaseChangedDetail,
    DayNightSystem,
} from './DayNightSystem';
import { ZombieMove } from './ZombieMove';
import { YSortManager } from './YSortManager';

const { ccclass, property } = _decorator;

@ccclass('EnemyManager')
export class EnemyManager extends Component {
    @property({ type: Prefab, tooltip: '僵尸预制体' })
    enemyPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '护士僵尸预制体' })
    nurseZombiePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '胖子僵尸预制体' })
    fatZombiePrefab: Prefab | null = null;

    @property({ tooltip: '护士僵尸刷出概率（0~1）' })
    nurseZombieChance = 0.25;

    @property({ tooltip: '胖子僵尸刷出概率（0~1）' })
    fatZombieChance = 0.20;

    @property({ type: CCFloat, tooltip: '第一天刷怪间隔（秒），天数越高间隔越短' })
    spawnStartInterval = 2.0;

    @property({ type: CCFloat, tooltip: '达到 maxDay 时的刷怪间隔（秒）' })
    spawnEndInterval = 0.01;

    @property({ type: CCFloat, tooltip: '难度递增曲线指数：1=线性，>1=前期慢后期快，<1=前期快后期慢' })
    spawnCurveExponent = 1.0;

    @property({ tooltip: '白天游荡僵尸刷新间隔（秒）' })
    dayWanderInterval = 8;

    @property({ tooltip: '白天同时存在的最大游荡僵尸数' })
    maxDayWanderers = 5;

    @property({ type: CCFloat, tooltip: '白天游荡僵尸生成最小半径（像素），相对于 spawnOrigin' })
    dayWanderSpawnRadiusMin = 300;

    @property({ type: CCFloat, tooltip: '白天游荡僵尸生成最大半径（像素），相对于 spawnOrigin' })
    dayWanderSpawnRadiusMax = 900;

    @property({ type: CCFloat, tooltip: '夜间僵尸生成半径（像素），相对于 spawnOrigin' })
    nightSpawnRadius = 900;

    @property({ type: Node, tooltip: '基地节点（纯 2D 世界坐标）' })
    baseNode: Node | null = null;

    @property({ type: Node, tooltip: '僵尸父节点（EnemyRoot），由编辑器绑定' })
    enemyRoot: Node | null = null;

    @property({ type: Node, tooltip: '出生/游荡圆心，一般为基地或屏幕中心' })
    spawnOrigin: Node | null = null;

    @property({ tooltip: '屏幕同时存在的最大僵尸数' })
    maxZombiesOnScreen = 200;
    private _nightSpawning = false;
    private _dayWanderSpawning = false;

    onLoad() {
        DayNightSystem.eventTarget.on(
            DayNightEvents.PHASE_CHANGED,
            this.onPhaseChanged,
            this,
        );
    }

    onDestroy() {
        DayNightSystem.eventTarget.off(
            DayNightEvents.PHASE_CHANGED,
            this.onPhaseChanged,
            this,
        );
    }

    start() {
        const dayNight = DayNightSystem.instance;
        if (dayNight?.isNight) {
            this.startNightSpawning();
        } else if (dayNight?.isDay) {
            this.startDayWanderSpawning();
        }
    }

    private resolveEnemyRoot(): Node {
        const sortLayer = YSortManager.getSortLayer();
        if (sortLayer) {
            return sortLayer;
        }
        if (this.enemyRoot) return this.enemyRoot;
        const found = find('GameWorld/EnemyRoot');
        if (found) return found;
        
        warn('[EnemyManager] 动态未找到 EnemyRoot，降级挂载至场景根节点');
        return this.node.scene!;
    }

    private onPhaseChanged(detail: DayNightPhaseChangedDetail) {
        if (detail.phase === DayNightPhase.NIGHT) {
            this.stopDayWanderSpawning();
            this.startNightSpawning();
        } else {
            this.stopNightSpawning();
            this.startDayWanderSpawning();
        }
    }

    private startNightSpawning() {
        if (this._nightSpawning) return;
        this._nightSpawning = true;
        const interval = this.getDynamicSpawnInterval();
        this.schedule(this.spawnZombie, interval);
    }

    private stopNightSpawning() {
        this._nightSpawning = false;
        this.unschedule(this.spawnZombie);
    }

    /** 根据当前天数动态计算刷怪间隔 */
    private getDynamicSpawnInterval(): number {
        const dayNight = DayNightSystem.instance;
        if (!dayNight) return this.spawnStartInterval;

        const currentDay = dayNight.currentDay;
        const maxDay = dayNight.maxDays;
        if (maxDay <= 1) return this.spawnStartInterval;

        const progress = (currentDay - 1) / (maxDay - 1);
        const interval = this.spawnStartInterval
            - (this.spawnStartInterval - this.spawnEndInterval)
            * Math.pow(progress, this.spawnCurveExponent);
        return Math.max(this.spawnEndInterval, interval);
    }

    private startDayWanderSpawning() {
        if (this._dayWanderSpawning) return;
        this._dayWanderSpawning = true;
        this.schedule(this.spawnDayWanderer, this.dayWanderInterval);
        // 进入白天立即刷新 1-2 只游荡僵尸
        this.spawnDayWanderer();
        if (Math.random() < 0.5) this.spawnDayWanderer();
    }

    private stopDayWanderSpawning() {
        this._dayWanderSpawning = false;
        this.unschedule(this.spawnDayWanderer);
    }

    /** 根据权重随机选取一个僵尸预制体 */
    private pickZombiePrefab(): Prefab | null {
        const hasFat = !!this.fatZombiePrefab;
        const hasNurse = !!this.nurseZombiePrefab;
        const hasNormal = !!this.enemyPrefab;

        // 只有一个可用时直接返回
        const count = [hasFat, hasNurse, hasNormal].filter(Boolean).length;
        if (count === 0) return null;
        if (count === 1) {
            return this.fatZombiePrefab || this.nurseZombiePrefab || this.enemyPrefab;
        }

        const rand = Math.random();
        // 胖子僵尸：fatZombieChance（默认 20%）
        if (hasFat && rand < this.fatZombieChance) return this.fatZombiePrefab;
        // 护士僵尸：nurseZombieChance（默认 25%）
        if (hasNurse && rand < this.fatZombieChance + this.nurseZombieChance) return this.nurseZombiePrefab;
        // 其余为普通僵尸
        return this.enemyPrefab || this.nurseZombiePrefab || this.fatZombiePrefab;
    }

    /** 黑夜：在屏幕边缘生成攻击型僵尸 */
    private spawnZombie() {
        const prefab = this.pickZombiePrefab();
        if (!prefab || this.getActiveZombieCount() >= this.maxZombiesOnScreen) return;

        const enemy = instantiate(prefab);
        const finalParent = this.resolveEnemyRoot();
        enemy.setParent(finalParent);

        const origin = this.spawnOrigin?.worldPosition ?? Vec3.ZERO;
        const angle = Math.random() * Math.PI * 2;
        const radius = this.nightSpawnRadius;
        
        enemy.setWorldPosition(new Vec3(
            origin.x + Math.cos(angle) * radius,
            origin.y + Math.sin(angle) * radius,
            0
        ));

        const zombieMove = enemy.getComponent(ZombieMove);
        if (zombieMove) {
            zombieMove.init(this.baseNode ?? enemy);
        }
    }

    /** 白天：在基地周围生成游荡型僵尸（不攻击基地/玩家） */
    private spawnDayWanderer() {
        const prefab = this.pickZombiePrefab();
        if (!prefab || this.getWandererCount() >= this.maxDayWanderers) return;

        const enemy = instantiate(prefab);
        const finalParent = this.resolveEnemyRoot();
        enemy.setParent(finalParent);

        const origin = this.spawnOrigin?.worldPosition ?? Vec3.ZERO;
        const angle = Math.random() * Math.PI * 2;
        const radius = this.dayWanderSpawnRadiusMin + Math.random() * (this.dayWanderSpawnRadiusMax - this.dayWanderSpawnRadiusMin);
        
        enemy.setWorldPosition(new Vec3(
            origin.x + Math.cos(angle) * radius,
            origin.y + Math.sin(angle) * radius,
            0
        ));

        const zombieMove = enemy.getComponent(ZombieMove);
        if (zombieMove) {
            zombieMove.init(this.baseNode ?? enemy, undefined, true);
        }
    }

    getActiveZombieCount(): number {
        return this.countZombiesUnder(this.resolveEnemyRoot());
    }

    private getWandererCount(): number {
        let count = 0;
        this.walkZombies(this.resolveEnemyRoot(), (zm) => {
            if (zm.isDayWanderer) {
                count++;
            }
        });
        return count;
    }

    private countZombiesUnder(root: Node): number {
        let count = 0;
        this.walkZombies(root, () => {
            count++;
        });
        return count;
    }

    private walkZombies(root: Node, visitor: (zombie: ZombieMove) => void) {
        const zombie = root.getComponent(ZombieMove);
        if (zombie) {
            visitor(zombie);
        }
        for (const child of root.children) {
            this.walkZombies(child, visitor);
        }
    }
}