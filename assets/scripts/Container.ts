import { _decorator, CCInteger, CCFloat, Component } from 'cc';
import { GlobalContainerStorage } from './GlobalContainerStorage';

const { ccclass, property } = _decorator;

/**
 * 集装箱组件，挂载在集装箱预制体上。
 * 建造后向 GlobalContainerStorage 注册，实现全图资源互通。
 */
@ccclass('Container')
export class Container extends Component {
    @property({ type: CCInteger, tooltip: '最大血量' })
    maxHp = 200;

    /** 当前血量（运行时初始化） */
    hp = 200;

    @property({ type: CCFloat, tooltip: '建造时间（秒）' })
    buildTime = 5.0;

    @property({ type: CCInteger, tooltip: '建造消耗木头' })
    costWood = 50;

    @property({ type: CCInteger, tooltip: '建造消耗铜矿' })
    costCopper = 30;

    @property({ type: CCInteger, tooltip: '建造消耗铁矿' })
    costIron = 20;

    @property({ type: CCInteger, tooltip: '建造消耗金币' })
    costMoney = 300;

    @property({ type: CCInteger, tooltip: '自身耗电量' })
    powerCost = 2;

    @property({ type: CCInteger, tooltip: '最大木材存储量' })
    maxStorageWood = 500;

    @property({ type: CCInteger, tooltip: '最大铜矿存储量' })
    maxStorageCopper = 500;

    @property({ type: CCInteger, tooltip: '最大铁矿存储量' })
    maxStorageIron = 500;

    private _isPlaced = false;

    start() {
        this.hp = this.maxHp;
        this._isPlaced = true;
        GlobalContainerStorage.instance?.registerContainer(this);
    }

    onDestroy() {
        if (this._isPlaced) {
            GlobalContainerStorage.instance?.unregisterContainer(this);
            this._isPlaced = false;
        }
    }

    get isPlaced(): boolean {
        return this._isPlaced;
    }

    /** 受伤，供僵尸攻击等调用 */
    takeDamage(amount: number) {
        if (this.hp <= 0 || amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp <= 0) {
            this.node.destroy();
        }
    }

    /** 维修：恢复血量，不超过 maxHp */
    repair(amount: number): number {
        if (this.hp <= 0 || amount <= 0) return 0;
        const oldHp = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + amount);
        return this.hp - oldHp;
    }
}