import { _decorator, CCInteger, CCFloat, Component, EventTouch, Node, Vec3 } from 'cc';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { ContainerPanelUI } from './ContainerPanelUI';

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

    private _isPlaced = false;
    private _lastClickTime = 0;

    onLoad() {
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
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
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

    // ── 双击打开面板 ──

    private onTouchEnd(_event: EventTouch) {
        console.log(`[Container] 触摸事件触发, 节点=${this.node.name}, hp=${this.hp}, isPlaced=${this._isPlaced}`);
        const now = Date.now();
        const elapsed = now - this._lastClickTime;
        console.log(`[Container] 距上次点击: ${elapsed}ms, 双击阈值: ${DOUBLE_CLICK_INTERVAL}ms`);
        if (elapsed < DOUBLE_CLICK_INTERVAL) {
            console.log('[Container] 检测到双击，尝试打开面板...');
            this.openPanel();
        }
        this._lastClickTime = now;
    }

    /** 双击集装箱时打开交互面板（需玩家在附近） */
    private openPanel() {
        if (!this._isPlaced) {
            console.warn('[Container] openPanel 失败: 集装箱未放置');
            return;
        }
        if (this.hp <= 0) {
            console.warn('[Container] openPanel 失败: 集装箱已销毁 (hp=0)');
            return;
        }
        const scene = this.node.scene;
        if (!scene) {
            console.warn('[Container] openPanel 失败: node.scene 为空');
            return;
        }

        // 检查玩家是否在交互距离内
        const player = this.findPlayerNode(scene);
        if (!player) {
            console.warn('[Container] openPanel 失败: 找不到 Player 节点');
            return;
        }
        const dist = Vec3.distance(this.node.worldPosition, player.worldPosition);
        console.log(`[Container] 玩家距离: ${dist.toFixed(1)}px, 交互距离: ${this.interactDistance}px`);
        if (dist > this.interactDistance) {
            console.warn(`[Container] openPanel 失败: 玩家距离太远 (${dist.toFixed(1)} > ${this.interactDistance})`);
            return;
        }

        const panelUI = scene.getComponentInChildren(ContainerPanelUI);
        if (!panelUI) {
            console.warn('[Container] openPanel 失败: 找不到 ContainerPanelUI 组件');
            return;
        }
        console.log('[Container] 打开面板成功!');
        panelUI.openPanelPublic(this);
    }

    /** 查找玩家节点 */
    private findPlayerNode(scene: Node): Node | null {
        const p1 = scene.getChildByName('Player');
        if (p1) {
            console.log(`[Container] 找到 Player: scene/Player`);
            return p1;
        }
        const gw = scene.getChildByName('GameWorld');
        const p2 = gw?.getChildByName('Player');
        if (p2) {
            console.log(`[Container] 找到 Player: scene/GameWorld/Player`);
            return p2;
        }
        return null;
    }
}