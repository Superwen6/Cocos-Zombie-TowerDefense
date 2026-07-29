import { _decorator, AudioClip, AudioSource, CCInteger, CCFloat, Component, EventTouch, find, Node, Vec3 } from 'cc';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { ContainerPanelUI } from './ContainerPanelUI';
import { ReinforcementNotice } from './ReinforcementNotice';
import { EnemyManager } from './EnemyManager';

const { ccclass, property } = _decorator;

/** 双击间隔（毫秒） */
const DOUBLE_CLICK_INTERVAL = 300;

/**
 * 集装箱组件，挂载在集装箱预制体上。
 * 建造后向 GlobalContainerStorage 注册，实现全图资源互通。
 * 玩家靠近后双击集装箱实体可打开交互面板。
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

    @property({ type: CCFloat, tooltip: '玩家与集装箱交互的最大距离（像素）' })
    interactDistance = 80;

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
    private _lastClickTime = 0;
    private _audioSource: AudioSource | null = null;
    private _attackSoundTimer = 0;

    onLoad() {
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    start() {
        if (!this._isPlaced) {
            this.onPlaced();
        }
    }

    /** 由 TurretPlacementManager 在建造完成时调用，确保立即注册（避免 start() 延迟一帧导致电力统计滞后） */
    onPlaced() {
        if (this._isPlaced) return;
        this._isPlaced = true;
        this.hp = this.maxHp;
        GlobalContainerStorage.instance?.registerContainer(this);

        // 首个集装箱建造完成时提示
        if (GlobalContainerStorage.instance?.containerCount === 1) {
            ReinforcementNotice.show('双击集装箱进入存取面板');
        }
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        if (this._isPlaced) {
            GlobalContainerStorage.instance?.unregisterContainer(this);
            this._isPlaced = false;
        }
    }

    update(dt: number) {
        if (this._attackSoundTimer > 0) {
            this._attackSoundTimer -= dt;
        }
    }

    get isPlaced(): boolean {
        return this._isPlaced;
    }

    /** 受伤，供僵尸攻击等调用 */
    takeDamage(amount: number) {
        if (this.hp <= 0 || amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        this.playAttackSound();
        if (this.hp <= 0) {
            this.playDestroySound();
            EnemyManager.invalidateCache();
            this.node.destroy();
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

    /** 维修：恢复血量，不超过 maxHp */
    repair(amount: number): number {
        if (this.hp <= 0 || amount <= 0) return 0;
        const oldHp = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + amount);
        return this.hp - oldHp;
    }

    // ── 双击打开面板 ──

    private onTouchEnd(_event: EventTouch) {
        const now = Date.now();
        if (now - this._lastClickTime < DOUBLE_CLICK_INTERVAL) {
            this.openPanel();
        }
        this._lastClickTime = now;
    }

    /** 双击集装箱时打开交互面板（需玩家在附近） */
    private openPanel() {
        if (!this._isPlaced || this.hp <= 0) return;
        const scene = this.node.scene;
        if (!scene) return;

        // 检查玩家是否在交互距离内
        const player = this.findPlayerNode(scene);
        if (!player) return;
        const dist = Vec3.distance(this.node.worldPosition, player.worldPosition);
        if (dist > this.interactDistance) return;

        const panelUI = scene.getComponentInChildren(ContainerPanelUI);
        if (!panelUI) return;
        panelUI.openPanelPublic(this);
    }

    /** 查找玩家节点（递归搜索整个场景） */
    private findPlayerNode(scene: Node): Node | null {
        return this.findNodeByName(scene, 'Player');
    }

    private findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this.findNodeByName(child, name);
            if (found) return found;
        }
        return null;
    }
}