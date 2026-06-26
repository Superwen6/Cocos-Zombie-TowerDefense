import { _decorator, CCFloat, CCInteger, Color, Component, log, Node, Sprite, find, warn } from 'cc';
import { PlayerData } from './PlayerData';
import { PlantGenerator } from './PlantGenerator';
import { Turret } from './Turret';
import { HealthBar } from './HealthBar';

const { ccclass, property } = _decorator;

export interface BaseUpgradeTier {
    wood: number;
    copper: number;
    iron: number;
    money: number;
}

const TOWERS_UNLOCKED_AT_LEVEL: Record<number, string[]> = {
    2: ['ArrowTower'],
    3: ['SlowTower'],
    4: ['CannonTower'],
    5: ['LaserTower'],
};

/** 升级到对应等级前需要先放置的发电机 ID（Lv2→plantId 1, Lv3→2, Lv4→3, Lv5→4） */
const PLANT_REQUIRED_FOR_LEVEL: Record<number, number> = {
    2: 1,
    3: 2,
    4: 3,
    5: 4,
};

const FALLBACK_SAFE_RADIUS = 300;
const FALLBACK_HP_REGEN = 0;
const FALLBACK_MAX_BASE_HP = 500;

@ccclass('BaseSystem')
export class BaseSystem extends Component {
    public static instance: BaseSystem = null!;

    @property({ type: CCInteger, tooltip: '基地初始等级' })
    currentLevel = 1;

    @property({ type: CCInteger, tooltip: '基地最大等级' })
    maxLevel = 5;

    @property({ type: CCInteger, tooltip: '基地当前耐久度' })
    baseHp = 500;

    @property({ type: CCInteger, tooltip: '基地最大耐久度' })
    maxBaseHp = 500;

    @property({ type: CCFloat, tooltip: '基地矩形碰撞半宽（僵尸攻击目标矩形）' })
    baseHalfW = 220;

    @property({ type: CCFloat, tooltip: '基地矩形碰撞半高（僵尸攻击目标矩形）' })
    baseHalfH = 150;

    @property({ type: [CCFloat], tooltip: '各等级安全区半径 (Lv1-Lv5)' })
    safeRadii: number[] = [300, 350, 400, 480, 600];

    @property({ type: [CCFloat], tooltip: '各等级每秒玩家回血速度 (Lv1-Lv5)' })
    hpRegens: number[] = [0, 1, 2, 4, 8];

    @property({ type: [CCInteger], tooltip: '各等级基地最大耐久 (Lv1-Lv5)' })
    maxBaseHpByLevel: number[] = [500, 600, 700, 800, 1000];

    @property({ type: [CCInteger], tooltip: '升级所需木头 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeWood: number[] = [100, 250, 250, 500];

    @property({ type: [CCInteger], tooltip: '升级所需铜矿 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeCopper: number[] = [50, 125, 125, 250];

    @property({ type: [CCInteger], tooltip: '升级所需铁矿 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeIron: number[] = [20, 50, 50, 100];

    @property({ type: [CCInteger], tooltip: '升级所需美元 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeMoney: number[] = [800, 2000, 5000, 10000];

    @property({ type: CCInteger, tooltip: '1级基地自身耗电量（瓦）' })
    basePowerCost = 5;

    @property({ type: [CCInteger], tooltip: '各等级基地自身耗电量 (Lv1-Lv5)' })
    levelPowerCosts: number[] = [5, 10, 15, 20, 25];

    @property({ type: Node, tooltip: '二级基地外观节点（SecondaryBase）' })
    secondaryBase: Node | null = null;

    @property({ type: Node, tooltip: '三级基地外观节点（Tertiarybase）' })
    tertiaryBase: Node | null = null;

    @property({ type: Node, tooltip: '四级基地外观节点（Fourthbase）' })
    fourthBase: Node | null = null;

    @property({ type: [Node], tooltip: '5级时需要变色的墙体节点' })
    wallNodes: Node[] = [];

    @property({ type: Color, tooltip: '5级时墙体的颜色' })
    wallColorLv5: Color = new Color(255, 102, 102, 255);

    @property({ type: CCFloat, tooltip: '基地升级建造时间（秒）' })
    upgradeBuildTime = 5.0;

    private _wallOriginalColors: Map<Node, Color> = new Map();

    /** 升级成功后的回调列表，供面板等外部组件注册刷新逻辑 */
    public onUpgradeCallbacks: (() => void)[] = [];

    // ── 电力系统 ──
    /** 当前总发电量 */
    public totalPowerGen = 0;
    /** 当前总耗电量 */
    public totalPowerCost = 0;
    /** 是否处于断电状态（发电量 < 耗电量） */
    public isPowerOutage = false;

    // ── 基地升级建造进度 ──
    /** 是否正在升级建造中 */
    private _isUpgrading = false;
    /** 升级建造计时器 */
    private _upgradeTimer = 0;
    /** 升级血条组件（Base 节点下的子节点，挂载 HealthBar.ts） */
    private _upgradeHealthBar: HealthBar | null = null;

    onLoad() {
        if (BaseSystem.instance && BaseSystem.instance !== this) {
            warn('[BaseSystem] 场景中存在多个 BaseSystem，已销毁重复实例');
            this.destroy();
            return;
        }
        BaseSystem.instance = this;
        this.syncMaxBaseHpFromLevel();
        this.clampBaseHp();
    }

    start() {
        this.syncMaxBaseHpFromLevel();
        this.clampBaseHp();
        this.captureWallOriginalColors();
        this.refreshBaseAppearance();
        this.updatePowerStatus();
    }

    onDestroy() {
        if (BaseSystem.instance === this) {
            BaseSystem.instance = null!;
        }
    }

    get isMaxLevel(): boolean {
        return this.currentLevel >= this.maxLevel;
    }

    /** 是否正在升级建造中 */
    get isUpgrading(): boolean {
        return this._isUpgrading;
    }

    update(dt: number) {
        if (!this._isUpgrading) return;

        this._upgradeTimer += dt;
        if (this._upgradeHealthBar) {
            const progress = Math.min(1, this._upgradeTimer / this.upgradeBuildTime);
            this._upgradeHealthBar.updateProgress(progress);
        }

        if (this._upgradeTimer >= this.upgradeBuildTime) {
            this.finishUpgrade();
        }
    }

    getNextUpgradeTier(): BaseUpgradeTier | null {
        if (this.isMaxLevel) {
            return null;
        }
        const idx = this.currentLevel - 1;
        if (idx < 0 || idx >= this.upgradeWood.length) {
            return null;
        }
        return {
            wood: this.upgradeWood[idx] ?? 0,
            copper: this.upgradeCopper[idx] ?? 0,
            iron: this.upgradeIron[idx] ?? 0,
            money: this.upgradeMoney[idx] ?? 0,
        };
    }

    getCurrentSafeRadius(): number {
        const index = this.currentLevel - 1;
        if (index >= 0 && index < this.safeRadii.length) {
            const value = this.safeRadii[index];
            if (value != null && !Number.isNaN(value)) {
                return value;
            }
        }
        return FALLBACK_SAFE_RADIUS;
    }

    getCurrentHpRegen(): number {
        const index = this.currentLevel - 1;
        if (index >= 0 && index < this.hpRegens.length) {
            const value = this.hpRegens[index];
            if (value != null && !Number.isNaN(value)) {
                return value;
            }
        }
        return FALLBACK_HP_REGEN;
    }

    /** 获取当前等级基地的自身耗电量 */
    getCurrentBasePowerCost(): number {
        const index = this.currentLevel - 1;
        if (index >= 0 && index < this.levelPowerCosts.length) {
            return this.levelPowerCosts[index];
        }
        return this.basePowerCost;
    }

    getMaxBaseHpForLevel(level: number): number {
        const index = Math.min(this.maxLevel, Math.max(1, level)) - 1;
        if (index >= 0 && index < this.maxBaseHpByLevel.length) {
            const value = this.maxBaseHpByLevel[index];
            if (value != null && value > 0) {
                return value;
            }
        }
        return FALLBACK_MAX_BASE_HP;
    }

    getUnlockedTowers(): string[] {
        const unlocked: string[] = [];
        for (let lv = 2; lv <= this.currentLevel; lv++) {
            const towers = TOWERS_UNLOCKED_AT_LEVEL[lv];
            if (towers) {
                for (const tower of towers) {
                    if (!unlocked.includes(tower)) {
                        unlocked.push(tower);
                    }
                }
            }
        }
        return unlocked;
    }

    checkUpgradeAvailable(): boolean {
        const tier = this.getNextUpgradeTier();
        if (!tier) {
            return false;
        }
        return PlayerData.instance?.canAfford(tier.wood, tier.copper, tier.iron, tier.money) ?? false;
    }

    /** 检查升级到下一级所需的发电机是否已放置 */
    checkUpgradePlantRequirement(): boolean {
        const nextLevel = this.currentLevel + 1;
        const requiredPlantId = PLANT_REQUIRED_FOR_LEVEL[nextLevel];
        if (requiredPlantId == null) return true; // 没有发电机要求
        return PlantGenerator.isPlantPlaced(requiredPlantId);
    }

    /** 获取升级到下一级所需发电机的 ID（0 表示无要求） */
    getRequiredPlantIdForNextLevel(): number {
        const nextLevel = this.currentLevel + 1;
        return PLANT_REQUIRED_FOR_LEVEL[nextLevel] ?? 0;
    }

    upgradeBase(): boolean {
        return this.startUpgrade();
    }

    /** 启动基地升级建造进度（扣除资源，查找子节点 HealthBar，开始倒计时） */
    startUpgrade(): boolean {
        if (this._isUpgrading) {
            warn('[BaseSystem] 基地正在升级建造中，无法重复操作');
            return false;
        }

        const tier = this.getNextUpgradeTier();
        if (!tier) {
            warn('[BaseSystem] 基地已满级，无法继续升级');
            return false;
        }

        if (!this.checkUpgradePlantRequirement()) {
            const requiredId = this.getRequiredPlantIdForNextLevel();
            warn(`[BaseSystem] 需要先建造发电机 ID=${requiredId} 才能升级到 Lv.${this.currentLevel + 1}`);
            return false;
        }

        if (!PlayerData.instance?.spendUpgradeCost(tier.wood, tier.copper, tier.iron, tier.money)) {
            warn('[BaseSystem] 材料或金钱不足，升级失败');
            return false;
        }

        // BaseSystem 挂在 GameManagers 上，HealthBar 在 GameWorld/Base 节点下
        const baseNode = find('GameWorld/Base') ?? this.node;
        this._upgradeHealthBar = baseNode.getComponentInChildren(HealthBar);
        if (!this._upgradeHealthBar) {
            log('[BaseSystem] Base 节点下未挂载 HealthBar 子节点，跳过建造进度，直接升级');
            this.finishUpgrade();
            return true;
        }

        this._upgradeHealthBar.startBuild(this.upgradeBuildTime);
        this._upgradeTimer = 0;
        this._isUpgrading = true;

        log(`[BaseSystem] 基地升级建造开始，预计 ${this.upgradeBuildTime} 秒完成`);
        return true;
    }

    /** 完成升级：执行真正的等级提升逻辑 */
    private finishUpgrade() {
        const prevLevel = this.currentLevel;
        this.currentLevel += 1;
        this.maxBaseHp = this.getMaxBaseHpForLevel(this.currentLevel);
        this.baseHp = this.maxBaseHp;

        log(
            `[BaseSystem] 基地升级成功 Lv.${prevLevel} -> Lv.${this.currentLevel} | 耐久 ${this.baseHp}/${this.maxBaseHp} | 安全区 ${this.getCurrentSafeRadius()} | 回血 ${this.getCurrentHpRegen()}/秒 | 防御塔: ${this.getUnlockedTowers().join(', ') || '无'}`,
        );
        this.refreshBaseAppearance();
        this.updatePowerStatus();
        this.invokeUpgradeCallbacks();

        // 通知血条切换到战斗模式（绑定 GameWorld/Base 节点以读取 baseHp/maxBaseHp）
        if (this._upgradeHealthBar) {
            const baseNode = find('GameWorld/Base') ?? this.node;
            this._upgradeHealthBar.bindParent(baseNode);
            this._upgradeHealthBar.finishBuild();
            this._upgradeHealthBar = null;
        }
        this._isUpgrading = false;
        this._upgradeTimer = 0;
    }

    damageBase(amount: number) {
        if (amount <= 0) {
            return;
        }
        this.baseHp = Math.max(0, this.baseHp - amount);
        log(`[BaseSystem] 基地受损 -${amount}，剩余 ${this.baseHp}/${this.maxBaseHp}`);
    }

    // ── 电力系统 ──

    /** 更新电力状态：计算总发电量 vs 总耗电量，判断是否断电 */
    updatePowerStatus() {
        this.totalPowerGen = PlantGenerator.getTotalPowerGen();

        // 统计所有炮塔的电力消耗
        let totalCost = 0;
        const scene = this.node.scene;
        if (scene) {
            const turrets = scene.getComponentsInChildren(Turret);
            for (const t of turrets) {
                if (t && t.node.isValid && t.enabled) {
                    totalCost += t.powerCost;
                }
            }
        }

        // 加上基地自身耗电量
        totalCost += this.getCurrentBasePowerCost();

        this.totalPowerCost = totalCost;

        const wasOutage = this.isPowerOutage;
        this.isPowerOutage = this.totalPowerGen < this.totalPowerCost;

        if (wasOutage !== this.isPowerOutage) {
            if (this.isPowerOutage) {
                log(`[BaseSystem] 电力不足！发电 ${this.totalPowerGen} < 耗电 ${this.totalPowerCost}，所有炮塔停机`);
            } else {
                log(`[BaseSystem] 电力恢复！发电 ${this.totalPowerGen} >= 耗电 ${this.totalPowerCost}，炮塔恢复运行`);
            }
        }
    }

    /** 触发所有升级回调 */
    private invokeUpgradeCallbacks() {
        for (const cb of this.onUpgradeCallbacks) {
            try { cb(); } catch (e) { warn('[BaseSystem] 升级回调执行异常', e); }
        }
    }

    repairBase(amount: number) {
        if (amount <= 0) {
            return;
        }
        this.baseHp = Math.min(this.maxBaseHp, this.baseHp + amount);
    }

    private syncMaxBaseHpFromLevel() {
        this.maxBaseHp = this.getMaxBaseHpForLevel(this.currentLevel);
    }

    private clampBaseHp() {
        this.baseHp = Math.min(this.maxBaseHp, Math.max(0, this.baseHp));
    }

    /** 根据当前等级激活/关闭外观节点，并刷新墙体颜色 */
    private refreshBaseAppearance() {
        const lv = this.currentLevel;

        if (this.secondaryBase) {
            this.secondaryBase.active = lv >= 2;
        }
        if (this.tertiaryBase) {
            this.tertiaryBase.active = lv >= 3;
        }
        if (this.fourthBase) {
            this.fourthBase.active = lv >= 4;
        }

        this.refreshWallColor();
    }

    /** 记录墙体节点 Sprite 原始颜色 */
    private captureWallOriginalColors() {
        this._wallOriginalColors.clear();
        for (const wall of this.wallNodes) {
            if (!wall || !wall.isValid) continue;
            const sprite = wall.getComponent(Sprite);
            if (sprite) {
                this._wallOriginalColors.set(wall, sprite.color.clone());
            }
        }
    }

    /** 5 级时把墙体颜色改为 wallColorLv5，其他等级恢复原色 */
    private refreshWallColor() {
        for (const wall of this.wallNodes) {
            if (!wall || !wall.isValid) continue;
            const sprite = wall.getComponent(Sprite);
            if (!sprite) continue;
            if (this.currentLevel >= 5) {
                sprite.color = this.wallColorLv5;
            } else {
                const original = this._wallOriginalColors.get(wall);
                if (original) {
                    sprite.color = original;
                }
            }
        }
    }
}