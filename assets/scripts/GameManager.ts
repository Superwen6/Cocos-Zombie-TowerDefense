import { _decorator, Component, Node, warn } from 'cc';
import { CollisionWorld } from './CollisionWorld';
import { YSortManager } from './YSortManager';
import { SaveSystem } from './SaveSystem';

const { ccclass } = _decorator;

/**
 * 全局游戏流程管理（通关、失败等）。
 * 挂在场景常驻 GameManager 节点上。
 */
@ccclass('GameManager')
export class GameManager extends Component {
    static instance: GameManager | null = null;

    onLoad() {
        if (GameManager.instance && GameManager.instance !== this) {
            warn('[GameManager] 场景中存在多个 GameManager，已销毁重复实例');
            this.destroy();
            return;
        }
        GameManager.instance = this;
        // 确保 CollisionWorld 在 onLoad 中创建，保证其他组件 start 时可用
        this.ensureCollisionWorld();
        this.ensureYSortManager();
    }

    onDestroy() {
        if (GameManager.instance === this) {
            GameManager.instance = null;
        }
    }

    start() {
        // 检查是否有待加载的存档（从主菜单载入游戏时）
        if (SaveSystem.hasPendingLoad()) {
            console.log('[GameManager] 检测到待加载存档，开始恢复...');
            const data = SaveSystem.consumePendingLoad();
            if (data) {
                console.log('[GameManager] 存档数据已取出, timestamp=', new Date(data.timestamp).toLocaleString(), ', playerPos=(', data.playerPos.x.toFixed(1), ',', data.playerPos.y.toFixed(1), ')');
                SaveSystem.apply(data);
            } else {
                console.warn('[GameManager] consumePendingLoad 返回 null');
            }
        } else {
            console.log('[GameManager] 无待加载存档，新游戏开始');
        }
    }

    private ensureCollisionWorld() {
        if (CollisionWorld.instance) {
            return;
        }
        const cwNode = new Node('CollisionWorld');
        cwNode.parent = this.node;
        cwNode.addComponent(CollisionWorld);
    }

    private ensureYSortManager() {
        if (YSortManager.instance) {
            return;
        }
        // 检查是否已在编辑器中手动添加
        const existingNode = this.node.getChildByName('YSortManager');
        if (existingNode?.getComponent(YSortManager)) {
            return;
        }
        const ysNode = new Node('YSortManager');
        ysNode.parent = this.node;
        ysNode.addComponent(YSortManager);
    }

    /** 百日生存通关 */
    triggerVictory() {
    }
}
