import { _decorator, Component } from 'cc';
import { PlayerData } from './PlayerData';
import { GlobalContainerStorage } from './GlobalContainerStorage';

const { ccclass, property } = _decorator;

@ccclass('ZombieDrop')
export class ZombieDrop extends Component {
    @property({ displayName: '木材掉落概率', tooltip: '0~1 之间的小数，0.08 = 8%' })
    woodDropChance = 0.08;

    @property({ displayName: '铜矿掉落概率', tooltip: '0~1 之间的小数，0.04 = 4%' })
    copperDropChance = 0.04;

    @property({ displayName: '铁矿掉落概率', tooltip: '0~1 之间的小数，0.02 = 2%' })
    ironDropChance = 0.02;

    @property({ displayName: '金钱掉落概率', tooltip: '0~1 之间的小数，0.30 = 30%' })
    moneyDropChance = 0.30;

    @property({ displayName: '金钱掉落数量' })
    moneyAmount = 10;

    /**
     * 执行掉落逻辑：在僵尸死亡时调用。
     * 资源直接存入仓库，不再掉落在地面（避免碰撞体阻碍僵尸移动）。
     */
    drop() {
        const storage = GlobalContainerStorage.instance;

        // 木材 → 直接存入仓库
        if (Math.random() < this.woodDropChance) {
            if (storage) {
                storage.storedWood = Math.min(storage.maxWood, storage.storedWood + 1);
            }
        }

        // 铜矿 → 直接存入仓库
        if (Math.random() < this.copperDropChance) {
            if (storage) {
                storage.storedCopper = Math.min(storage.maxCopper, storage.storedCopper + 1);
            }
        }

        // 铁矿 → 直接存入仓库
        if (Math.random() < this.ironDropChance) {
            if (storage) {
                storage.storedIron = Math.min(storage.maxIron, storage.storedIron + 1);
            }
        }

        // 金钱 → 直接加给玩家
        if (Math.random() < this.moneyDropChance) {
            PlayerData.instance?.addMoney(this.moneyAmount);
        }
    }
}
