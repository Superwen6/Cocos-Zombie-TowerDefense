import { _decorator, Component } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { GameHUDUI } from './GameHUDUI';

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
        const data = PlayerData.instance;
        // 仓库可用且至少有一个集装箱时存入仓库，否则存入背包
        const hasStorage = storage && storage.maxWood > 0;

        // 资源掉落概率倍率（武器面板 greedy2 升级：所有僵尸资源掉落概率*2）
        const resourceMult = PlayerState.instance?.resourceDropMultiplier ?? 1.0;

        // 木材 → 优先存入仓库，仓库不可用时存入背包
        if (Math.random() < this.woodDropChance * resourceMult) {
            if (hasStorage) {
                storage.storedWood = Math.min(storage.maxWood, storage.storedWood + 1);
            } else if (data) {
                data.addWood(1);
            }
            GameHUDUI.flashResourceGreen('wood');
        }

        // 铜矿 → 优先存入仓库，仓库不可用时存入背包
        if (Math.random() < this.copperDropChance * resourceMult) {
            if (hasStorage) {
                storage.storedCopper = Math.min(storage.maxCopper, storage.storedCopper + 1);
            } else if (data) {
                data.addCopper(1);
            }
            GameHUDUI.flashResourceGreen('copper');
        }

        // 铁矿 → 优先存入仓库，仓库不可用时存入背包
        if (Math.random() < this.ironDropChance * resourceMult) {
            if (hasStorage) {
                storage.storedIron = Math.min(storage.maxIron, storage.storedIron + 1);
            } else if (data) {
                data.addIron(1);
            }
            GameHUDUI.flashResourceGreen('iron');
        }

        // 金钱 → 直接加给玩家
        const moneyMult = PlayerState.instance?.moneyDropMultiplier ?? 1.0;
        if (Math.random() < this.moneyDropChance * moneyMult) {
            data?.addMoney(this.moneyAmount);
            GameHUDUI.flashResourceGreen('money');
        }
    }
}
