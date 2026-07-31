import { _decorator, AudioClip, AudioSource, CCFloat, CCInteger, Color, Component, Node, Sprite, Vec3, find, log, warn } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { PlantGenerator } from './PlantGenerator';
import { Turret } from './Turret';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { HealthBar } from './HealthBar';
import { ReinforcementNotice } from './ReinforcementNotice';
import { TurretPlacementManager } from './TurretPlacementManager';
import { GameManager } from './GameManager';

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
const FALLBACK_MAX_BASE_HP = 1000;

@ccclass('BaseSystem')
export class BaseSystem extends Component {
    public static instance: BaseSystem = null!;

    @property({ type: CCInteger, tooltip: '基地初始等级' })
    currentLevel = 1;

    @property({ type: CCInteger, tooltip: '基地最大等级' })
    maxLevel = 5;

    @property({ type: CCInteger, tooltip: '基地当前耐久度' })
    baseHp = 1000;

    @property({ type: CCInteger, tooltip: '基地最大耐久度' })
    maxBaseHp = 1000;

    @property({ type: CCFloat, tooltip: '基地矩形碰撞半宽（僵尸攻击目标矩形）' })
    baseHalfW = 220;

    @property({ type: CCFloat, tooltip: '基地矩形碰撞半高（僵尸攻击目标矩形）' })
    baseHalfH = 150;

    @property({ type: [CCFloat], tooltip: '各等级安全区半径 (Lv1-Lv5)' })
    safeRadii: number[] = [300, 350, 400, 480, 600];

    @property({ type: [CCFloat], tooltip: '各等级每秒玩家回血速度 (Lv1-Lv5)' })
    hpRegens: number[] = [0, 1, 2, 4, 8];

    @property({ type: [CCInteger], tooltip: '各等级基地最大耐久 (Lv1-Lv5)' })
    maxBaseHpByLevel: number[] = [1000, 600, 700, 800, 1000];

    @property({ type: [CCInteger], tooltip: '升级所需木头 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeWood: number[] = [100, 250, 250, 500];

    @property({ type: [CCInteger], tooltip: '升级所需铜矿 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeCopper: number[] = [50, 125, 125, 250];

    @property({ type: [CCInteger], tooltip: '升级所需铁矿 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeIron: number[] = [20, 50, 50, 100];

    @property({ type: [CCInteger], tooltip: '升级所需美元 (Lv1→2, Lv2→3, Lv3→4, Lv4→5)' })
    upgradeMoney: number[] = [800, 2000, 5000, 10000];

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

    /** 是否已显示过首次受攻击提示 */
    private _hasShownAttackWarning = false;
    private _audioSource: AudioSource | null = null;
    /** 预警音效冷却计时器（3秒内最多播放一次） */
    private _attackWarningCooldown = 0;
    /** 受攻击音效冷却计时器（1秒内最多播放一次） */
    private _attackSoundTimer = 0;
    /** 电力音效跳过计数（跳过首次进入的断电和首次恢复，共2次） */
    private _powerSoundSkipCount = 2;

    @property({ type: HealthBar, tooltip: 'Canvas上的Base血条（用于显示升级建造进度和血量）' })
    canvasHealthBar: HealthBar | null = null;

    @property({ type: AudioClip, tooltip: '基地受攻击预警音效' })
    attackWarningSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '断电音效' })
    powerOutageSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '电力恢复音效' })
    powerRestoreSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '受到攻击音效' })
    attackSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '受攻击音效最大距离（像素），超出此距离不播放' })
    attackSoundMaxDistance = 250;

    @property({ type: CCFloat, tooltip: '受攻击音效最小播放间隔（秒），0=每次受击都播放，0.3=间隔0.3秒，2=间隔2秒' })
    attackSoundCooldown = 1;

    onLoad() {
        if (BaseSystem.instance && BaseSystem.instance !== this) {
            warn('[BaseSystem] 场景中存在多个 BaseSystem，已销毁重复实例');
            this.destroy();
            return;
        }
        BaseSystem.instance = this;
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
        log(`[BaseSystem] onLoad: baseHp=${this.baseHp}, maxBaseHp=${this.maxBaseHp}, maxBaseHpByLevel[0]=${this.maxBaseHpByLevel[0]}, currentLevel=${this.currentLevel}`);
        this.syncMaxBaseHpFromLevel();
        this.clampBaseHp();
        log(`[BaseSystem] onLoad 后: baseHp=${this.baseHp}, maxBaseHp=${this.maxBaseHp}`);
    }

    start() {
        this.syncMaxBaseHpFromLevel();
        this.clampBaseHp();
        this.captureWallOriginalColors();
        this.refreshBaseAppearance();
        this.updatePowerStatus();

        // 发电机放置/摧毁时立即刷新电力状态
        PlantGenerator.onPlacedCallbacks.push(this.updatePowerStatus.bind(this));

        // 初始化基地血条为战斗模式（_started 默认为 false，不调用 finishBuild 则血条不显示）
        const baseNode = find('GameWorld/Base');
        if (baseNode) {
            const healthBar = baseNode.getComponentInChildren(HealthBar);
            if (healthBar) {
                healthBar.bindParent(baseNode);
                healthBar.finishBuild();
            }
        }
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
        // 预警音效冷却递减
        if (this._attackWarningCooldown > 0) {
            this._attackWarningCooldown -= dt;
        }
        if (this._attackSoundTimer > 0) {
            this._attackSoundTimer -= dt;
        }

        if (!this._isUpgrading) return;

        this._upgradeTimer += dt;
        if (this._upgradeHealthBar) {
            const progress = Math.min(1, this._upgradeTimer / this._upgradeHealthBar.buildTime);
            this._upgradeHealthBar.updateProgress(progress);
        }

        if (this._upgradeHealthBar && this._upgradeTimer >= this._upgradeHealthBar.buildTime) {
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
        return 0;
    }

    /** 获取升级到下一级所需的耗电量 */
    getNextLevelPowerCost(): number {
        const index = this.currentLevel;
        if (index >= 0 && index < this.levelPowerCosts.length) {
            return this.levelPowerCosts[index];
        }
        return 0;
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
        const ps = PlayerState.instance;
        const saveRate = ps ? ps.materialSaveRate : 0;
        const actualWood = Math.round(tier.wood * (1 - saveRate));
        const actualCopper = Math.round(tier.copper * (1 - saveRate));
        const actualIron = Math.round(tier.iron * (1 - saveRate));
        const actualMoney = Math.round(tier.money * (1 - saveRate));

        // 材料从仓库检查，金钱从背包检查
        const storage = GlobalContainerStorage.instance;
        const woodOk = storage ? storage.storedWood >= actualWood : false;
        const copperOk = storage ? storage.storedCopper >= actualCopper : false;
        const ironOk = storage ? storage.storedIron >= actualIron : false;
        const moneyOk = (PlayerData.instance?.money ?? 0) >= actualMoney;
        return woodOk && copperOk && ironOk && moneyOk;
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
    /** 最近一次升级失败的提示信息，供 UI 面板读取显示 */
    upgradeWarning = '';

    startUpgrade(): boolean {
        this.upgradeWarning = '';

        if (this._isUpgrading) {
            this.upgradeWarning = '基地正在升级建造中，无法重复操作';
            warn(`[BaseSystem] ${this.upgradeWarning}`);
            return false;
        }

        const tier = this.getNextUpgradeTier();
        if (!tier) {
            this.upgradeWarning = '基地已满级，无法继续升级';
            warn(`[BaseSystem] ${this.upgradeWarning}`);
            return false;
        }

        if (!this.checkUpgradePlantRequirement()) {
            const requiredId = this.getRequiredPlantIdForNextLevel();
            this.upgradeWarning = `需要先建造发电机 ID=${requiredId} 才能升级到 Lv.${this.currentLevel + 1}`;
            warn(`[BaseSystem] ${this.upgradeWarning}`);
            return false;
        }

        // 应用省材料率
        const ps = PlayerState.instance;
        const saveRate = ps ? ps.materialSaveRate : 0;
        const actualWood = Math.round(tier.wood * (1 - saveRate));
        const actualCopper = Math.round(tier.copper * (1 - saveRate));
        const actualIron = Math.round(tier.iron * (1 - saveRate));
        const actualMoney = Math.round(tier.money * (1 - saveRate));

        // 材料从仓库扣除，金钱从背包扣除
        const storage = GlobalContainerStorage.instance;
        const woodOk = storage ? storage.storedWood >= actualWood : false;
        const copperOk = storage ? storage.storedCopper >= actualCopper : false;
        const ironOk = storage ? storage.storedIron >= actualIron : false;
        const moneyOk = (PlayerData.instance?.money ?? 0) >= actualMoney;

        if (!woodOk || !copperOk || !ironOk || !moneyOk) {
            this.upgradeWarning = '材料或金钱不足，升级失败';
            warn(`[BaseSystem] ${this.upgradeWarning}`);
            return false;
        }

        if (storage) {
            storage.storedWood -= actualWood;
            storage.storedCopper -= actualCopper;
            storage.storedIron -= actualIron;
        }
        if (PlayerData.instance) {
            PlayerData.instance.money -= actualMoney;
        }

        // BaseSystem 挂在 GameManagers 上，优先使用 Canvas 上的血条，否则查找 GameWorld/Base 节点下
        this._upgradeHealthBar = this.canvasHealthBar ?? find('GameWorld/Base')?.getComponentInChildren(HealthBar) ?? null;
        if (!this._upgradeHealthBar) {
            this.finishUpgrade();
            return true;
        }

        this._upgradeHealthBar.startBuild();
        this._upgradeTimer = 0;
        this._isUpgrading = true;

        return true;
    }

    /** 完成升级：执行真正的等级提升逻辑 */
    private finishUpgrade() {
        const prevLevel = this.currentLevel;
        this.currentLevel += 1;
        this.maxBaseHp = this.getMaxBaseHpForLevel(this.currentLevel);
        this.baseHp = this.maxBaseHp;

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

        // 播放建造完成音效（复用 TurretPlacementManager 的 buildCompleteSound）
        const sound = TurretPlacementManager.instance?.buildCompleteSound;
        if (this._audioSource && sound) {
            this._audioSource.playOneShot(sound, 1);
        }
    }

    damageBase(amount: number) {
        if (amount <= 0) {
            return;
        }
        this.baseHp = Math.max(0, this.baseHp - amount);

        // 基地血量归零，触发逃脱失败
        if (this.baseHp <= 0) {
            GameManager.instance?.triggerDefeat();
        }

        // 播放受攻击音效（距离衰减，1秒冷却）
        this.playAttackSound();

        // 播放预警音效（3秒冷却，避免多个僵尸同时攻击时重复播放）
        if (this._audioSource && this.attackWarningSound && this._attackWarningCooldown <= 0) {
            this._audioSource.playOneShot(this.attackWarningSound, 1);
            this._attackWarningCooldown = 3;
        }

        if (!this._hasShownAttackWarning) {
            this._hasShownAttackWarning = true;
            ReinforcementNotice.show('基地正在遭受攻击，在基地或其他建筑物附近点击即可维修');
        }
    }

    /** 播放受攻击音效（距离衰减，冷却时间由属性控制） */
    private playAttackSound() {
        if (this.attackSoundCooldown > 0 && this._attackSoundTimer > 0) return;
        if (!this._audioSource || !this.attackSound) return;
        const baseNode = find('GameWorld/Base');
        const basePos = baseNode?.worldPosition ?? this.node.worldPosition;
        const player = find('GameWorld/YSortLayer/Player');
        if (player) {
            const dist = Vec3.distance(basePos, player.worldPosition);
            if (dist >= this.attackSoundMaxDistance) return;
            const volume = 1 - (dist / this.attackSoundMaxDistance);
            this._audioSource.playOneShot(this.attackSound, volume);
        } else {
            this._audioSource.playOneShot(this.attackSound, 1);
        }
        this._attackSoundTimer = this.attackSoundCooldown;
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

        // 统计所有集装箱的电力消耗（通过 GlobalContainerStorage）
        const containerCost = GlobalContainerStorage.instance?.getTotalPowerCost() ?? 0;
        totalCost += containerCost;

        // 加上基地自身耗电量
        totalCost += this.getCurrentBasePowerCost();

        this.totalPowerCost = totalCost;

        const wasOutage = this.isPowerOutage;
        this.isPowerOutage = this.totalPowerGen === 0 || this.totalPowerGen < this.totalPowerCost;

        // 检测电力状态变化
        const stateChanged = wasOutage !== this.isPowerOutage;
        if (stateChanged && this._powerSoundSkipCount > 0) {
            this._powerSoundSkipCount--;
            return;
        }

        // 从正常状态进入断电状态时播放断电音效并提示
        if (!wasOutage && this.isPowerOutage) {
            if (this._audioSource && this.powerOutageSound) {
                this._audioSource.playOneShot(this.powerOutageSound, 1);
            }
            ReinforcementNotice.show('电力不足，部分建筑功能受限！');
        }

        // 从断电状态恢复到正常时播放电力恢复音效并提示
        if (wasOutage && !this.isPowerOutage) {
            if (this._audioSource && this.powerRestoreSound) {
                this._audioSource.playOneShot(this.powerRestoreSound, 1);
            }
            ReinforcementNotice.show('电力已恢复，所有建筑功能恢复正常！');
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