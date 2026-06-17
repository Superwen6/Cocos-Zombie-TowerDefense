import { _decorator, Component, director, find, Node } from 'cc';
import { MapObstacle } from './MapObstacle';
import { PlayerController } from './PlayerController';
import { ResourceItem } from './ResourceItem';
import { Turret } from './Turret';
import { ZombieMove } from './ZombieMove';

const { ccclass, property } = _decorator;

export const Y_SORT_LAYER_NAME = 'YSortLayer';

/**
 * Y 轴渲染排序：player / zombie（动态）与 wood、copper、iron、
 * MapElements、BaseTurret（静态）共用同一父节点，按 world Y 排序。
 *
 * Y 越小 → 渲染越靠前（遮挡 Y 更大的节点）。
 * 等价于：动态 Y < 静态 Y 时动态在前；动态 Y > 静态 Y 时静态在前。
 */
@ccclass('YSortManager')
export class YSortManager extends Component {
    static instance: YSortManager | null = null;

    @property({ tooltip: '只排序 active 节点' })
    onlyActive = true;

    private _sortLayer: Node | null = null;
    private _gameWorld: Node | null = null;
    private _playerNode: Node | null = null;

    onLoad() {
        if (YSortManager.instance && YSortManager.instance !== this) {
            this.destroy();
            return;
        }
        YSortManager.instance = this;

        this._gameWorld = find('GameWorld');
        if (!this._gameWorld) {
            console.warn('[YSortManager] 未找到 GameWorld');
            return;
        }

        this._sortLayer = this.ensureSortLayer(this._gameWorld);
    }

    start() {
        this.migrateExistingNodes();
    }

    onDestroy() {
        if (YSortManager.instance === this) {
            YSortManager.instance = null;
        }
    }

    get sortLayer(): Node | null {
        return this._sortLayer;
    }

    /** 供生成逻辑使用的统一排序层 */
    static getSortLayer(): Node | null {
        if (YSortManager.instance?._sortLayer?.isValid) {
            return YSortManager.instance._sortLayer;
        }
        const gameWorld = director.getScene()?.getChildByName('GameWorld')
            ?? find('GameWorld');
        if (!gameWorld) {
            return null;
        }
        return gameWorld.getChildByName(Y_SORT_LAYER_NAME);
    }

    /** 节点是否参与 Y 排序 */
    static isSortable(node: Node): boolean {
        return !!(
            node.getComponent(PlayerController)
            || node.getComponent(ZombieMove)
            || node.getComponent(ResourceItem)
            || node.getComponent(MapObstacle)
            || node.getComponent(Turret)
        );
    }

    private ensureSortLayer(gameWorld: Node): Node {
        let layer = gameWorld.getChildByName(Y_SORT_LAYER_NAME);
        if (layer) {
            return layer;
        }

        layer = new Node(Y_SORT_LAYER_NAME);
        layer.parent = gameWorld;

        const darkMask = gameWorld.getChildByName('DarkMask');
        if (darkMask) {
            layer.setSiblingIndex(darkMask.getSiblingIndex());
        } else {
            layer.setSiblingIndex(gameWorld.children.length - 1);
        }
        return layer;
    }

    /** 将场景中已有的可排序节点迁入 YSortLayer */
    private migrateExistingNodes() {
        if (!this._sortLayer || !this._gameWorld) {
            return;
        }

        const sourceNames = ['Player', 'EnemyRoot', 'ResourceRoot', 'MapElements'];
        for (const name of sourceNames) {
            const root = this._gameWorld.getChildByName(name);
            if (!root) {
                continue;
            }
            if (name === 'Player') {
                this.reparentIfSortable(root);
                continue;
            }
            const children = root.children.slice();
            for (const child of children) {
                this.reparentIfSortable(child);
            }
        }
    }

    private reparentIfSortable(node: Node) {
        if (!this._sortLayer || !YSortManager.isSortable(node)) {
            return;
        }
        if (node.parent === this._sortLayer) {
            return;
        }
        node.setParent(this._sortLayer, true);
    }

    lateUpdate() {
        if (!this._sortLayer?.isValid) {
            return;
        }

        const sortList: { node: Node; y: number }[] = [];
        for (const child of this._sortLayer.children) {
            if (!child.isValid) {
                continue;
            }
            if (this.onlyActive && !child.active) {
                continue;
            }
            sortList.push({ node: child, y: child.worldPosition.y });
        }

        if (sortList.length > 1) {
            // Y 大 → siblingIndex 小 → 先画在后；Y 小 → siblingIndex 大 → 后画在前
            sortList.sort((a, b) => b.y - a.y);
            for (let i = 0; i < sortList.length; i++) {
                sortList[i].node.setSiblingIndex(i);
            }
        }

        this.updateMapElementTransparency();
    }

    /**
     * 当玩家在 MapObstacle 元素后方（player Y > 元素 Y）且距离在阈值内时，
     * 将该元素设为半透明，让玩家可见。
     */
    private updateMapElementTransparency() {
        if (!this._sortLayer) return;

        // 缓存 Player 节点引用
        if (!this._playerNode || !this._playerNode.isValid) {
            this._playerNode = this._sortLayer.getChildByName('Player');
        }
        if (!this._playerNode || !this._playerNode.active) return;

        const playerX = this._playerNode.worldPosition.x;
        const playerY = this._playerNode.worldPosition.y;

        for (const child of this._sortLayer.children) {
            const obstacle = child.getComponent(MapObstacle);
            if (!obstacle) continue;
            if (!child.active) continue;

            const wx = child.worldPosition.x;
            const wy = child.worldPosition.y;
            const dx = playerX - wx;
            const dy = playerY - wy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const shouldBeTransparent = dist < obstacle.triggerDistance && playerY > wy;
            obstacle.setOpacity(shouldBeTransparent ? obstacle.semiTransparentOpacity : 255);
        }
    }
}
