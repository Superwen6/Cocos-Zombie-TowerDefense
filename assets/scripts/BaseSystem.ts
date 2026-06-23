import { _decorator, CCFloat, CCInteger, Color, Component, log, Node, Sprite, warn } from 'cc';
import { PlayerData } from './PlayerData';

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
    }

    onDestroy() {
        if (BaseSystem.instance === this) {
            BaseSystem.instance = null!;
        }
    }

    get isMaxLevel(): boolean {
        return this.currentLevel >= this.maxLevel;
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

    upgradeBase(): boolean {
        const tier = this.getNextUpgradeTier();
        if (!tier) {
            warn('[BaseSystem] 基地已满级，无法继续升级');
            return false;
        }

        if (!PlayerData.instance?.spendUpgradeCost(tier.wood, tier.copper, tier.iron, tier.money)) {
            warn('[BaseSystem] 材料或金钱不足，升级失败');
            return false;
        }

        const prevLevel = this.currentLevel;
        this.currentLevel += 1;
        this.maxBaseHp = this.getMaxBaseHpForLevel(this.currentLevel);
        this.baseHp = this.maxBaseHp;

        log(
            `[BaseSystem] 基地升级成功 Lv.${prevLevel} -> Lv.${this.currentLevel} | 耐久 ${this.baseHp}/${this.maxBaseHp} | 安全区 ${this.getCurrentSafeRadius()} | 回血 ${this.getCurrentHpRegen()}/秒 | 防御塔: ${this.getUnlockedTowers().join(', ') || '无'}`,
        );
        this.refreshBaseAppearance();
        this.invokeUpgradeCallbacks();
        return true;
    }

    damageBase(amount: number) {
        if (amount <= 0) {
            return;
        }
        this.baseHp = Math.max(0, this.baseHp - amount);
        log(`[BaseSystem] 基地受损 -${amount}，剩余 ${this.baseHp}/${this.maxBaseHp}`);
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