import { _decorator, AudioClip, AudioSource, CCInteger, CCFloat, Component, find, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 发电机组件，挂载在 4 个发电机预制体上。
 * 每种发电机最多只能建造 1 个。
 */
@ccclass('PlantGenerator')
export class PlantGenerator extends Component {
    /** 已放置的发电机映射表（plantId → PlantGenerator） */
    public static placedMap: Map<number, PlantGenerator> = new Map();

    /** 发电机放置成功后的回调列表，供 PlantPanelUI 等外部组件注册刷新逻辑 */
    public static onPlacedCallbacks: (() => void)[] = [];

    @property({ type: CCInteger, tooltip: '发电机唯一 ID（1=光伏板, 2=光伏矩阵, 3=燃料电机, 4=能源核心）' })
    plantId = 1;

    @property({ type: CCInteger, tooltip: '发电机最大血量' })
    maxHp = 100;

    /** 当前血量（运行时由 start 初始化，HealthBar 通过 getComponent 读取） */
    hp = 100;

    @property({ type: CCFloat, tooltip: '建造时间（秒）' })
    buildTime = 4.0;

    @property({ type: CCInteger, tooltip: '该发电机产生的电力（瓦）' })
    powerGenerate = 10;

    @property({ type: CCInteger, tooltip: '该发电机自身耗电量' })
    powerCost = 0;

    @property({ type: Vec3, tooltip: '发电机固定建造中心点（GameWorld 绝对世界坐标）。在场景中选中目标位置节点，复制其 Position 的 X/Y 填入此处' })
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

    @property({ type: Number, tooltip: '虚影透明度（0~1）', range: [0, 1, 0.05] })
    ghostOpacity = 0.5;

    @property({ type: AudioClip, tooltip: '被摧毁音效' })
    destroySound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '被摧毁音效最大距离（像素），超出此距离不播放' })
    destroySoundMaxDistance = 800;

    @property({ type: AudioClip, tooltip: '受到攻击音效' })
    attackSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '受攻击音效最大距离（像素），超出此距离不播放' })
    attackSoundMaxDistance = 250;

    @property({ type: CCFloat, tooltip: '受攻击音效最小播放间隔（秒），0=每次受击都播放，0.3=间隔0.3秒，2=间隔2秒' })
    attackSoundCooldown = 1;

    private _isPlaced = false;
    private _audioSource: AudioSource | null = null;
    private _attackSoundTimer = 0;

    onLoad() {
    }

    start() {
        this.hp = this.maxHp;
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
    }

    update(dt: number) {
        if (this._attackSoundTimer > 0) {
            this._attackSoundTimer -= dt;
        }
    }

    /** 受伤，供僵尸攻击等调用 */
    takeDamage(amount: number) {
        if (this.hp <= 0 || amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        this.playAttackSound();
        if (this.hp <= 0) {
            this.playDestroySound();
            // 发电机被摧毁：停用节点而非销毁，以支持重建
            this.node.active = false;
            if (this._isPlaced) {
                this._isPlaced = false;
                PlantGenerator.placedMap.delete(this.plantId);
                PlantGenerator.invokePlacedCallbacks();
            }
        }
    }

    /** 播放被摧毁音效（距离衰减） */
    private playDestroySound() {
        if (!this._audioSource || !this.destroySound) return;
        const player = find('GameWorld/YSortLayer/Player');
        if (player) {
            const dist = Vec3.distance(this.node.worldPosition, player.worldPosition);
            if (dist >= this.destroySoundMaxDistance) return;
            const volume = 1 - (dist / this.destroySoundMaxDistance);
            this._audioSource.playOneShot(this.destroySound, volume);
        } else {
            this._audioSource.playOneShot(this.destroySound, 1);
        }
    }

    /** 播放受攻击音效（距离衰减，冷却时间由属性控制） */
    private playAttackSound() {
        if (this.attackSoundCooldown > 0 && this._attackSoundTimer > 0) return;
        if (!this._audioSource || !this.attackSound) return;
        const player = find('GameWorld/YSortLayer/Player');
        if (player) {
            const dist = Vec3.distance(this.node.worldPosition, player.worldPosition);
            if (dist >= this.attackSoundMaxDistance) return;
            const volume = 1 - (dist / this.attackSoundMaxDistance);
            this._audioSource.playOneShot(this.attackSound, volume);
        } else {
            this._audioSource.playOneShot(this.attackSound, 1);
        }
        this._attackSoundTimer = this.attackSoundCooldown;
    }

    get isPlaced(): boolean {
        return this._isPlaced;
    }

    /** 标记发电机为已放置，并注册到全局映射表，触发回调 */
    markPlaced() {
        this._isPlaced = true;
        PlantGenerator.placedMap.set(this.plantId, this);
        // 通知所有监听者（如 PlantPanelUI 刷新按钮状态）
        PlantGenerator.invokePlacedCallbacks();
    }

    /** 检查该 ID 的发电机是否已被放置且处于激活状态 */
    static isPlantPlaced(plantId: number): boolean {
        const plant = PlantGenerator.placedMap.get(plantId);
        return plant != null && plant.isValid && plant._isPlaced && plant.node.active;
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

    /** 触发所有放置回调 */
    private static invokePlacedCallbacks() {
        for (const cb of PlantGenerator.onPlacedCallbacks) {
            try { cb(); } catch (e) { /* ignore */ }
        }
    }

    onDestroy() {
        if (this._isPlaced) {
            this._isPlaced = false;
            PlantGenerator.placedMap.delete(this.plantId);
            PlantGenerator.invokePlacedCallbacks();
        }
    }

    /** 拆除回调（DemolishManager 调用）。从映射表移除并触发刷新。 */
    onDemolish() {
        if (this._isPlaced) {
            this._isPlaced = false;
            PlantGenerator.placedMap.delete(this.plantId);
            PlantGenerator.invokePlacedCallbacks();
        }
    }
}