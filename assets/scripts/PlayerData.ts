import { _decorator, CCInteger, CCFloat, Component, warn } from 'cc';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { PlayerState } from './PlayerState';

const { ccclass, property } = _decorator;

export type ResourceType = 'iron' | 'wood' | 'copper';

@ccclass('PlayerData')
export class PlayerData extends Component {
    public static instance: PlayerData = null!;

    @property({ type: CCInteger, tooltip: '当前金钱' })
    money = 0;

    @property({ type: CCInteger, tooltip: '当前木头数量' })
    woodCount = 0;

    @property({ type: CCInteger, tooltip: '当前铜矿数量' })
    copperCount = 0;

    @property({ type: CCInteger, tooltip: '当前铁矿数量' })
    ironCount = 0;

    @property({ type: CCInteger, tooltip: '木头上限' })
    maxWood = 999;

    @property({ type: CCInteger, tooltip: '铜矿上限' })
    maxCopper = 999;

    @property({ type: CCInteger, tooltip: '铁矿上限' })
    maxIron = 999;

    @property({ type: CCInteger, tooltip: '金钱上限' })
    maxMoney = 999999;

    @property({ type: CCFloat, tooltip: '玩家周围建造半径（像素），炮塔等建筑必须在此范围内' })
    buildRadius = 200;

    @property({ type: CCFloat, tooltip: '拆除建筑时的资源返还比例（0~1）', range: [0, 1, 0.05] })
    demolishRefundRate = 0.5;

    onLoad() {
        if (PlayerData.instance && PlayerData.instance !== this) {
            warn('[PlayerData] 场景中存在多个 PlayerData，已销毁重复实例');
            this.destroy();
            return;
        }
        PlayerData.instance = this;
    }

    onDestroy() {
        if (PlayerData.instance === this) {
            PlayerData.instance = null!;
        }
    }

    canAfford(wood: number, copper: number, iron: number, money: number): boolean {
        return (
            this.woodCount >= wood &&
            this.copperCount >= copper &&
            this.ironCount >= iron &&
            this.money >= money
        );
    }

    spendUpgradeCost(wood: number, copper: number, iron: number, money: number): boolean {
        if (!this.canAfford(wood, copper, iron, money)) {
            return false;
        }
        this.woodCount -= wood;
        this.copperCount -= copper;
        this.ironCount -= iron;
        this.money -= money;
        return true;
    }

    /** 退还建造消耗（取消放置时使用）。
     * RemoteMaterial 激活时：优先返还到仓库，仓库满后剩余部分落回背包；
     * 否则：仅返还到背包。 */
    refundUpgradeCost(wood: number, copper: number, iron: number, money: number) {
        const ps = PlayerState.instance;
        const remoteMaterial = ps?.remoteMaterialEnabled ?? false;
        const storage = GlobalContainerStorage.instance;
        const effMaxWood = ps?.getEffectiveBackpackMax('wood', this.maxWood) ?? this.maxWood;
        const effMaxCopper = ps?.getEffectiveBackpackMax('copper', this.maxCopper) ?? this.maxCopper;
        const effMaxIron = ps?.getEffectiveBackpackMax('iron', this.maxIron) ?? this.maxIron;

        // 木材：优先仓库
        if (remote && storage) {
            const wWoodIntoWarehouse = Math.min(wood, Math.max(0, storage.maxWood - storage.storedWood));
            storage.storedWood += wWoodIntoWarehouse;
            this.woodCount = Math.min(effMaxWood, this.woodCount + (wood - wWoodIntoWarehouse));

            const wCopperIntoWarehouse = Math.min(copper, Math.max(0, storage.maxCopper - storage.storedCopper));
            storage.storedCopper += wCopperIntoWarehouse;
            this.copperCount = Math.min(effMaxCopper, this.copperCount + (copper - wCopperIntoWarehouse));

            const wIronIntoWarehouse = Math.min(iron, Math.max(0, storage.maxIron - storage.storedIron));
            storage.storedIron += wIronIntoWarehouse;
            this.ironCount = Math.min(effMaxIron, this.ironCount + (iron - wIronIntoWarehouse));
        } else {
            this.woodCount = Math.min(effMaxWood, this.woodCount + wood);
            this.copperCount = Math.min(effMaxCopper, this.copperCount + copper);
            this.ironCount = Math.min(effMaxIron, this.ironCount + iron);
        }
        this.money = Math.min(this.maxMoney, this.money + money);
    }

    addWood(amount: number) {
        const effectiveMax = PlayerState.instance?.getEffectiveBackpackMax('wood', this.maxWood) ?? this.maxWood;
        this.woodCount = Math.min(effectiveMax, this.woodCount + amount);
    }

    addCopper(amount: number) {
        const effectiveMax = PlayerState.instance?.getEffectiveBackpackMax('copper', this.maxCopper) ?? this.maxCopper;
        this.copperCount = Math.min(effectiveMax, this.copperCount + amount);
    }

    addIron(amount: number) {
        const effectiveMax = PlayerState.instance?.getEffectiveBackpackMax('iron', this.maxIron) ?? this.maxIron;
        this.ironCount = Math.min(effectiveMax, this.ironCount + amount);
    }

    addMoney(amount: number) {
        this.money = Math.min(this.maxMoney, this.money + amount);
    }

    addResource(type: ResourceType, amount: number) {
        switch (type) {
            case 'wood':
                this.addWood(amount);
                break;
            case 'copper':
                this.addCopper(amount);
                break;
            case 'iron':
                this.addIron(amount);
                break;
        }
    }

    // ── 仓库+背包总资源查询（用于 CostDisplay 显示） ──

    /** 获取木材总量（背包+仓库） */
    static getTotalWood(): number {
        const data = PlayerData.instance;
        const storage = GlobalContainerStorage.instance;
        return (data?.woodCount ?? 0) + (storage?.storedWood ?? 0);
    }

    /** 获取铜矿总量（背包+仓库） */
    static getTotalCopper(): number {
        const data = PlayerData.instance;
        const storage = GlobalContainerStorage.instance;
        return (data?.copperCount ?? 0) + (storage?.storedCopper ?? 0);
    }

    /** 获取铁矿总量（背包+仓库） */
    static getTotalIron(): number {
        const data = PlayerData.instance;
        const storage = GlobalContainerStorage.instance;
        return (data?.ironCount ?? 0) + (storage?.storedIron ?? 0);
    }

    /** 获取仓库木材数量 */
    static getWarehouseWood(): number {
        return GlobalContainerStorage.instance?.storedWood ?? 0;
    }

    /** 获取仓库铜矿数量 */
    static getWarehouseCopper(): number {
        return GlobalContainerStorage.instance?.storedCopper ?? 0;
    }

    /** 获取仓库铁矿数量 */
    static getWarehouseIron(): number {
        return GlobalContainerStorage.instance?.storedIron ?? 0;
    }

    // ── RemoteMaterial 感知的资源检查与扣除 ──

    /**
     * 检查是否有足够资源（含仓库）。
     * RemoteMaterial 激活时：仓库+背包；否则：仅背包。
     */
    static canAffordWithWarehouse(wood: number, copper: number, iron: number, money: number): boolean {
        const data = PlayerData.instance;
        if (!data) return false;
        const ps = PlayerState.instance;
        const remoteMaterial = ps?.remoteMaterialEnabled ?? false;
        const storage = GlobalContainerStorage.instance;

        const wWood = remoteMaterial ? (storage?.storedWood ?? 0) : 0;
        const wCopper = remoteMaterial ? (storage?.storedCopper ?? 0) : 0;
        const wIron = remoteMaterial ? (storage?.storedIron ?? 0) : 0;

        return (data.woodCount + wWood) >= wood
            && (data.copperCount + wCopper) >= copper
            && (data.ironCount + wIron) >= iron
            && data.money >= money;
    }

    /**
     * 扣除资源（RemoteMaterial 感知）。
     * RemoteMaterial 激活时：优先扣除仓库，不足部分从背包扣除；
     * 否则：仅扣除背包。
     * @returns 是否成功扣除
     */
    static spendWithWarehouse(wood: number, copper: number, iron: number, money: number): boolean {
        if (!PlayerData.canAffordWithWarehouse(wood, copper, iron, money)) return false;

        const data = PlayerData.instance!;
        const ps = PlayerState.instance;
        const remoteMaterial = ps?.remoteMaterialEnabled ?? false;
        const storage = GlobalContainerStorage.instance;

        if (remoteMaterial && storage) {
            const fromWarehouseWood = Math.min(storage.storedWood, wood);
            const fromWarehouseCopper = Math.min(storage.storedCopper, copper);
            const fromWarehouseIron = Math.min(storage.storedIron, iron);

            storage.storedWood -= fromWarehouseWood;
            storage.storedCopper -= fromWarehouseCopper;
            storage.storedIron -= fromWarehouseIron;

            data.woodCount -= (wood - fromWarehouseWood);
            data.copperCount -= (copper - fromWarehouseCopper);
            data.ironCount -= (iron - fromWarehouseIron);
        } else {
            data.woodCount -= wood;
            data.copperCount -= copper;
            data.ironCount -= iron;
        }

        data.money -= money;
        return true;
    }
}