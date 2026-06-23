import { _decorator, CCInteger, CCFloat, Component, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 发电机组件，挂载在 4 个发电机预制体上。
 * 每种发电机最多只能建造 1 个。
 */
@ccclass('PlantGenerator')
export class PlantGenerator extends Component {
    /** 已放置的发电机映射表（plantId → PlantGenerator） */
    public static placedMap: Map<number, PlantGenerator> = new Map();

    @property({ type: CCInteger, tooltip: '发电机唯一 ID（1=光伏板, 2=光伏矩阵, 3=燃料电机, 4=能源核心）' })
    plantId = 1;

    @property({ type: CCInteger, tooltip: '该发电机产生的电力（瓦）' })
    powerGenerate = 10;

    @property({ type: Vec3, tooltip: '发电机固定建造中心点（世界坐标）' })
    placeCenter: Vec3 = new Vec3(0, 0, 0);

    @property({ type: CCFloat, tooltip: '在 placeCenter 周围的建造半径范围' })
    placeRadius = 100;

    @property({ type: CCInteger, tooltip: '建造消耗木头' })
    costWood = 50;

    @property({ type: CCInteger, tooltip: '建造消耗铜矿' })
    costCopper = 25;

    @property({ type: CCInteger, tooltip: '建造消耗铁矿' })
    costIron = 10;

    @property({ type: CCInteger, tooltip: '建造消耗金币' })
    costMoney = 500;

    private _isPlaced = false;

    get isPlaced(): boolean {
        return this._isPlaced;
    }

    /** 标记发电机为已放置，并注册到全局映射表 */
    markPlaced() {
        this._isPlaced = true;
        PlantGenerator.placedMap.set(this.plantId, this);
    }

    /** 检查该 ID 的发电机是否已被放置 */
    static isPlantPlaced(plantId: number): boolean {
        const plant = PlantGenerator.placedMap.get(plantId);
        return plant != null && plant.isValid && plant._isPlaced;
    }

    /** 获取所有已放置发电机的总发电量 */
    static getTotalPowerGen(): number {
        let total = 0;
        for (const plant of PlantGenerator.placedMap.values()) {
            if (plant && plant.isValid && plant._isPlaced) {
                total += plant.powerGenerate;
            }
        }
        return total;
    }

    onDestroy() {
        if (this._isPlaced) {
            PlantGenerator.placedMap.delete(this.plantId);
        }
    }
}