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

/** 僵尸存档数据 */
export interface ZombieSaveData {
    /** 僵尸相对于父节点（YSortLayer）的本地坐标，不受 GameWorld 移动影响 */
    localX: number;
    localY: number;
    hp: number;
    maxHp: number;
    damage: number;
    isDayWanderer: boolean;
    /** 僵尸类型名称（预制体节点名），用于恢复时精确匹配预制体 */
    zombieType: string;
}

@ccclass('SpawnZone')
export class SpawnZone {
    @property({ type: CCFloat, tooltip: '最小 X 坐标（相对于 GameWorld）' })
    minX = 0;

    @property({ type: CCFloat, tooltip: '最大 X 坐标（相对于 GameWorld）' })
    maxX = 0;

    @property({ type: CCFloat, tooltip: '最小 Y 坐标（相对于 GameWorld）' })
    minY = 0;

    @property({ type: CCFloat, tooltip: '最大 Y 坐标（相对于 GameWorld）' })
    maxY = 0;
}

@ccclass('EnemyManager')
export class EnemyManager extends Component {
    private static _instance: EnemyManager | null = null;

    // ===== 建筑/炮塔缓存（性能优化：避免每个僵尸每帧遍历场景树） =====
    private static _cachedTurrets: Node[] = [];
    private static _cachedBuildings: Node[] = []; // 非防御性建筑：发电机、集装箱
    private static _cacheTimer = 0;
    private static readonly CACHE_REBUILD_INTERVAL = 2.0; // 每2秒重建缓存

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

    @property({ type: CCFloat, tooltip: '每日僵尸血量成长比例（0.06=每天+6%，第N天=1+(N-1)*该值）' })
    dayHpScale = 0.08;

    @property({ type: CCFloat, tooltip: '每日僵尸伤害成长比例（0.06=每天+6%）' })
    dayDamageScale = 0.06;

    @property({ type: CCFloat, tooltip: '每日僵尸移速成长比例（0.006=每天+0.6%）' })
    daySpeedScale = 0.006;

    @property({ tooltip: '白天游荡僵尸刷新间隔（秒）' })
    dayWanderInterval = 8;

    @property({ tooltip: '白天同时存在的最大游荡僵尸数' })
    maxDayWanderers = 5;

    @property({ type: Node, tooltip: '基地节点（纯 2D 世界坐标）' })
    baseNode: Node | null = null;

    @property({ type: Node, tooltip: '僵尸父节点（EnemyRoot），由编辑器绑定' })
    enemyRoot: Node | null = null;

    @property({ type: [SpawnZone], tooltip: '夜间僵尸生成矩形区域数组（相对于 GameWorld），为空则使用旧圆形生成' })
    spawnZones: SpawnZone[] = [];

    @property({ type: [SpawnZone], tooltip: '白天游荡僵尸生成矩形区域数组（相对于 GameWorld），为空则使用旧环形生成' })
    dayWanderSpawnZones: SpawnZone[] = [];

    @property({ type: Node, tooltip: '生成原点（旧圆形模式使用）' })
    spawnOrigin: Node | null = null;

    @property({ tooltip: '屏幕同时存在的最大僵尸数' })
    maxZombiesOnScreen = 200;
    private _nightSpawning = false;
    private _dayWanderSpawning = false;
    private _gameWorldRef: Node | null = null;

    onLoad() {
        EnemyManager._instance = this;
        DayNightSystem.eventTarget.on(
            DayNightEvents.PHASE_CHANGED,
            this.onPhaseChanged,
            this,
        );
    }

    onDestroy() {
        EnemyManager._instance = null;
        DayNightSystem.eventTarget.off(
            DayNightEvents.PHASE_CHANGED,
            this.onPhaseChanged,
            this,
        );
    }

    start() {
        this._gameWorldRef = find('Canvas/GameWorld') ?? find('GameWorld');

        const dayNight = DayNightSystem.instance;
        if (dayNight?.isNight) {
            this.startNightSpawning();
        } else if (dayNight?.isDay) {
            this.startDayWanderSpawning();
        }

        // 立即构建一次缓存
        EnemyManager.rebuildCaches();
    }

    update(dt: number) {
        // 定期重建建筑/炮塔缓存
        EnemyManager._cacheTimer -= dt;
        if (EnemyManager._cacheTimer <= 0) {
            EnemyManager._cacheTimer = EnemyManager.CACHE_REBUILD_INTERVAL;
            EnemyManager.rebuildCaches();
        }
    }

    // ===== 建筑/炮塔缓存方法 =====

    /** 重建建筑和炮塔缓存（遍历场景树） */
    static rebuildCaches() {
        EnemyManager._cachedTurrets = [];
        EnemyManager._cachedBuildings = [];

        const inst = EnemyManager._instance;
        if (!inst) return;

        const root = inst.node.scene;
        if (!root) return;

        EnemyManager._walkSceneForCache(root);
    }

    private static _walkSceneForCache(node: Node) {
        if (!node || !node.isValid) return;

        // 炮塔
        const turret = node.getComponent('Turret') as any;
        if (turret && turret.enabled) {
            EnemyManager._cachedTurrets.push(node);
        }

        // 非防御性建筑：发电机、集装箱
        const plant = node.getComponent('PlantGenerator') as any;
        if (plant && plant.isPlaced) {
            EnemyManager._cachedBuildings.push(node);
        }
        const container = node.getComponent('Container') as any;
        if (container && container.enabled) {
            EnemyManager._cachedBuildings.push(node);
        }

        for (const child of node.children) {
            EnemyManager._walkSceneForCache(child);
        }
    }

    /** 获取缓存的炮塔列表（过滤已销毁节点） */
    static getCachedTurrets(): Node[] {
        return EnemyManager._cachedTurrets.filter(n => n && n.isValid && n.active);
    }

    /** 获取缓存的非防御性建筑列表（发电机、集装箱） */
    static getCachedBuildings(): Node[] {
        return EnemyManager._cachedBuildings.filter(n => n && n.isValid && n.active);
    }

    /** 立即标记缓存需要重建（建筑放置/销毁时调用） */
    static invalidateCache() {
        EnemyManager._cacheTimer = 0;
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

    /** 按当前天数缩放僵尸属性（血量/伤害/移速），天数越高越强 */
    private applyDayScaling(zm: ZombieMove) {
        const dayNight = DayNightSystem.instance;
        const day = dayNight?.currentDay ?? 1;
        if (day <= 1) return;

        const hpMult = 1 + this.dayHpScale * (day - 1);
        const dmgMult = 1 + this.dayDamageScale * (day - 1);
        const speedMult = 1 + this.daySpeedScale * (day - 1);

        zm.maxHp = Math.round(zm.maxHp * hpMult);
        zm.damage = Math.max(1, Math.round(zm.damage * dmgMult));
        zm.moveSpeed = Math.round(zm.moveSpeed * speedMult);
        zm.hp = zm.maxHp;
    }

    /** 黑夜：在屏幕边缘生成攻击型僵尸 */
    private spawnZombie() {
        const prefab = this.pickZombiePrefab();
        if (!prefab || this.getActiveZombieCount() >= this.maxZombiesOnScreen) return;

        const enemy = instantiate(prefab);
        const finalParent = this.resolveEnemyRoot();
        enemy.setParent(finalParent);

        if (this.spawnZones.length > 0) {
            // 矩形区域生成：随机选一个区域，在区域内随机坐标
            const zone = this.spawnZones[Math.floor(Math.random() * this.spawnZones.length)];
            const gwPos = this._gameWorldRef?.worldPosition ?? Vec3.ZERO;
            const x = gwPos.x + zone.minX + Math.random() * (zone.maxX - zone.minX);
            const y = gwPos.y + zone.minY + Math.random() * (zone.maxY - zone.minY);
            enemy.setWorldPosition(new Vec3(x, y, 0));
        } else {
            // 旧圆形生成：兜底
            const origin = this.spawnOrigin?.worldPosition ?? Vec3.ZERO;
            const angle = Math.random() * Math.PI * 2;
            const radius = 900;
            enemy.setWorldPosition(new Vec3(
                origin.x + Math.cos(angle) * radius,
                origin.y + Math.sin(angle) * radius,
                0
            ));
        }

        const zombieMove = enemy.getComponent(ZombieMove);
        if (zombieMove) {
            this.applyDayScaling(zombieMove);
            zombieMove.init(this.baseNode ?? enemy);
        }
    }

    /** 白天：在基地周围生成游荡型僵尸（不攻击基地/玩家） */
    private spawnDayWanderer() {
        const prefab = this.pickZombiePrefab();
        if (!prefab || this.getWandererCount() >= this.maxDayWanderers) {
            return;
        }

        const enemy = instantiate(prefab);
        const finalParent = this.resolveEnemyRoot();
        enemy.setParent(finalParent);

        if (this.dayWanderSpawnZones.length > 0) {
            // 矩形区域生成：随机选一个区域，在区域内随机坐标
            const zone = this.dayWanderSpawnZones[Math.floor(Math.random() * this.dayWanderSpawnZones.length)];
            const gwPos = this._gameWorldRef?.worldPosition ?? Vec3.ZERO;
            const x = gwPos.x + zone.minX + Math.random() * (zone.maxX - zone.minX);
            const y = gwPos.y + zone.minY + Math.random() * (zone.maxY - zone.minY);
            enemy.setWorldPosition(new Vec3(x, y, 0));
        } else {
            // 旧环形生成：兜底
            const origin = this.spawnOrigin?.worldPosition ?? Vec3.ZERO;
            const angle = Math.random() * Math.PI * 2;
            const radius = 300 + Math.random() * 600;
            const x = origin.x + Math.cos(angle) * radius;
            const y = origin.y + Math.sin(angle) * radius;
            enemy.setWorldPosition(new Vec3(x, y, 0));
        }

        const zombieMove = enemy.getComponent(ZombieMove);
        if (zombieMove) {
            this.applyDayScaling(zombieMove);
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
        this.walkZombies(root, (zm) => {
            if (!zm.isDead) {
                count++;
            }
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

    /** 收集所有存活僵尸的存档数据 */
    static getZombieData(): ZombieSaveData[] {
        const inst = EnemyManager._instance;
        if (!inst) return [];

        const result: ZombieSaveData[] = [];
        const root = inst.resolveEnemyRoot();
        inst.walkZombies(root, (zm) => {
            if (zm.isDead || zm.hp <= 0) return;
            const typeName = zm.node.name;
            result.push({
                localX: zm.node.position.x,
                localY: zm.node.position.y,
                hp: zm.hp,
                maxHp: zm.maxHp,
                damage: zm.damage,
                isDayWanderer: zm.isDayWanderer,
                zombieType: typeName,
            });
        });
        return result;
    }

    /** 从存档数据恢复僵尸 */
    static restoreZombies(data: ZombieSaveData[]): void {
        const inst = EnemyManager._instance;
        if (!inst || data.length === 0) return;

        const root = inst.resolveEnemyRoot();

        // 先清除场景中已有的僵尸（避免重复）
        const existingZombies: Node[] = [];
        inst.walkZombies(root, (zm) => {
            if (!zm.isDead && zm.node.isValid) {
                existingZombies.push(zm.node);
            }
        });
        for (const node of existingZombies) {
            node.destroy();
        }

        for (const zd of data) {
            // 根据 zombieType 精确匹配预制体
            let prefab: Prefab | null = null;
            const instFatName = inst.fatZombiePrefab?.data?.name ?? inst.fatZombiePrefab?.name ?? '';
            const instNurseName = inst.nurseZombiePrefab?.data?.name ?? inst.nurseZombiePrefab?.name ?? '';
            const instNormalName = inst.enemyPrefab?.data?.name ?? inst.enemyPrefab?.name ?? '';

            if (zd.zombieType && inst.fatZombiePrefab && zd.zombieType === instFatName) {
                prefab = inst.fatZombiePrefab;
            } else if (zd.zombieType && inst.nurseZombiePrefab && zd.zombieType === instNurseName) {
                prefab = inst.nurseZombiePrefab;
            } else if (zd.zombieType && inst.enemyPrefab && zd.zombieType === instNormalName) {
                prefab = inst.enemyPrefab;
            } else {
                // 回退：根据 maxHp 猜测类型
                if (inst.fatZombiePrefab && zd.maxHp >= 150) {
                    prefab = inst.fatZombiePrefab;
                } else if (inst.nurseZombiePrefab && zd.maxHp <= 60) {
                    prefab = inst.nurseZombiePrefab;
                } else {
                    prefab = inst.enemyPrefab;
                }
            }

            if (!prefab) continue;

            const enemy = instantiate(prefab);
            enemy.setParent(root);
            enemy.setPosition(zd.localX, zd.localY, 0);

            const zm = enemy.getComponent(ZombieMove);
            if (zm) {
                zm.init(inst.baseNode ?? enemy, undefined, zd.isDayWanderer);
                zm.maxHp = zd.maxHp || zm.maxHp;
                zm.hp = Math.min(zd.hp, zm.maxHp);
                if (zd.damage > 0) zm.damage = zd.damage;
            }
        }
    }
}