import { _decorator, Component, warn } from 'cc';
import { Container } from './Container';

const { ccclass } = _decorator;

/**
 * 全局仓库单例：管理所有集装箱共享的存储空间。
 * 挂载在 GameManagers 或 Canvas 等常驻节点上。
 */
@ccclass('GlobalContainerStorage')
export class GlobalContainerStorage extends Component {
    public static instance: GlobalContainerStorage = null!;

    /** 存储的木材 */
    storedWood = 0;
    /** 存储的铜矿 */
    storedCopper = 0;
    /** 存储的铁矿 */
    storedIron = 0;

    /** 最大木材存储上限（所有集装箱 maxStorageWood 之和） */
    private totalMaxWood = 0;
    /** 最大铜矿存储上限 */
    private totalMaxCopper = 0;
    /** 最大铁矿存储上限 */
    private totalMaxIron = 0;

    /** 存活集装箱列表 */
    private _containers: Container[] = [];

    onLoad() {
        if (GlobalContainerStorage.instance && GlobalContainerStorage.instance !== this) {
            warn('[GlobalContainerStorage] 场景中存在多个实例，已销毁重复实例');
            this.destroy();
            return;
        }
        GlobalContainerStorage.instance = this;
    }

    onDestroy() {
        if (GlobalContainerStorage.instance === this) {
            GlobalContainerStorage.instance = null!;
        }
    }

    /** 注册集装箱（建造完成后调用） */
    registerContainer(container: Container) {
        if (this._containers.includes(container)) return;
        this._containers.push(container);
        this.recalculateMaxStorage();
    }

    /** 注销集装箱（被摧毁时调用） */
    unregisterContainer(container: Container) {
        const idx = this._containers.indexOf(container);
        if (idx >= 0) {
            this._containers.splice(idx, 1);
        }
        this.recalculateMaxStorage();
        // 超出上限的存储资源自动丢弃
        this.clampStorage();
    }

    /** 重新计算所有集装箱的存储上限之和 */
    private recalculateMaxStorage() {
        this.totalMaxWood = 0;
        this.totalMaxCopper = 0;
        this.totalMaxIron = 0;
        for (const c of this._containers) {
            if (c && c.isValid) {
                this.totalMaxWood += c.maxStorageWood;
                this.totalMaxCopper += c.maxStorageCopper;
                this.totalMaxIron += c.maxStorageIron;
            }
        }
    }

    /** 裁切存储量不超过上限 */
    private clampStorage() {
        this.storedWood = Math.min(this.storedWood, this.totalMaxWood);
        this.storedCopper = Math.min(this.storedCopper, this.totalMaxCopper);
        this.storedIron = Math.min(this.storedIron, this.totalMaxIron);
    }

    /** 获取木材存储上限 */
    get maxWood(): number {
        return this.totalMaxWood;
    }

    /** 获取铜矿存储上限 */
    get maxCopper(): number {
        return this.totalMaxCopper;
    }

    /** 获取铁矿存储上限 */
    get maxIron(): number {
        return this.totalMaxIron;
    }

    /** 存活集装箱数量 */
    get containerCount(): number {
        return this._containers.filter(c => c && c.isValid).length;
    }

    /** 获取所有存活集装箱的总耗电量 */
    getTotalPowerCost(): number {
        let total = 0;
        for (const c of this._containers) {
            if (c && c.isValid && c.enabled && c.isPlaced) {
                total += c.powerCost;
            }
        }
        return total;
    }
}