import {
    _decorator,
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

    @property({ tooltip: '黑夜持续刷怪间隔（秒）' })
    spawnInterval = 2;

    @property({ tooltip: '白天游荡僵尸刷新间隔（秒）' })
    dayWanderInterval = 8;

    @property({ tooltip: '白天同时存在的最大游荡僵尸数' })
    maxDayWanderers = 5;

    @property({ type: Node, tooltip: '基地节点（纯 2D 世界坐标）' })
    baseNode: Node | null = null;

    @property({ tooltip: '僵尸移动速度（像素/秒），会写入 ZombieMove' })
    zombieSpeed = 120;

    @property({ type: Node, tooltip: '僵尸父节点（EnemyRoot），由编辑器绑定' })
    enemyRoot: Node | null = null;

    @property({ type: Node, tooltip: '出生/游荡圆心，一般为基地或屏幕中心' })
    spawnOrigin: Node | null = null;

    private maxZombiesOnScreen = 200;
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
        this.schedule(this.spawnZombie, this.spawnInterval);
    }

    private stopNightSpawning() {
        this._nightSpawning = false;
        this.unschedule(this.spawnZombie);
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

    /** 黑夜：在屏幕边缘生成攻击型僵尸 */
    private spawnZombie() {
        if (!this.enemyPrefab || this.getActiveZombieCount() >= this.maxZombiesOnScreen) return;

        const enemy = instantiate(this.enemyPrefab);
        const finalParent = this.resolveEnemyRoot();
        enemy.setParent(finalParent);

        const origin = this.spawnOrigin?.worldPosition ?? Vec3.ZERO;
        const angle = Math.random() * Math.PI * 2;
        const radius = 900;
        
        enemy.setWorldPosition(new Vec3(
            origin.x + Math.cos(angle) * radius,
            origin.y + Math.sin(angle) * radius,
            0
        ));

        const zombieMove = enemy.getComponent(ZombieMove);
        if (zombieMove) {
            zombieMove.init(this.baseNode ?? enemy, this.zombieSpeed, false);
        }
    }

    /** 白天：在基地周围生成游荡型僵尸（不攻击基地/玩家） */
    private spawnDayWanderer() {
        if (!this.enemyPrefab || this.getWandererCount() >= this.maxDayWanderers) return;

        const enemy = instantiate(this.enemyPrefab);
        const finalParent = this.resolveEnemyRoot();
        enemy.setParent(finalParent);

        const origin = this.spawnOrigin?.worldPosition ?? Vec3.ZERO;
        const angle = Math.random() * Math.PI * 2;
        const radius = 300 + Math.random() * 600;
        
        enemy.setWorldPosition(new Vec3(
            origin.x + Math.cos(angle) * radius,
            origin.y + Math.sin(angle) * radius,
            0
        ));

        const zombieMove = enemy.getComponent(ZombieMove);
        if (zombieMove) {
            zombieMove.init(this.baseNode ?? enemy, this.zombieSpeed, true);
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