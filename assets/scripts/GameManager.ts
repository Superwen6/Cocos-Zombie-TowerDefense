import { _decorator, Component, log, warn, Node } from 'cc';
import { CollisionWorld } from './CollisionWorld';
import { YSortManager } from './YSortManager';

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

    private ensureCollisionWorld() {
        if (CollisionWorld.instance) {
            return;
        }
        const cwNode = new Node('CollisionWorld');
        cwNode.parent = this.node;
        cwNode.addComponent(CollisionWorld);
        log('[GameManager] CollisionWorld 已创建');
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
        log('🎉 恭喜！你已成功生存 100 天，通关胜利！');
    }
}
