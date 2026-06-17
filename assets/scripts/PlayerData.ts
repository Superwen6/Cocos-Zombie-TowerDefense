import { _decorator, CCInteger, Component, warn } from 'cc';

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

    addWood(amount: number) {
        this.woodCount = Math.min(this.maxWood, this.woodCount + amount);
    }

    addCopper(amount: number) {
        this.copperCount = Math.min(this.maxCopper, this.copperCount + amount);
    }

    addIron(amount: number) {
        this.ironCount = Math.min(this.maxIron, this.ironCount + amount);
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
}