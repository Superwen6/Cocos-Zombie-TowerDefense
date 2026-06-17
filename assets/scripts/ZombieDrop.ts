import { _decorator, Component, director, instantiate, Node, Prefab, Vec3 } from 'cc';
import { PlayerData } from './PlayerData';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { YSortManager } from './YSortManager';

const { ccclass, property } = _decorator;

@ccclass('ZombieDrop')
export class ZombieDrop extends Component {
    @property({ type: Prefab, tooltip: '木材预制体' })
    woodPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '铜矿预制体' })
    copperPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '铁矿预制体' })
    ironPrefab: Prefab | null = null;

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
     * 执行掉落逻辑：在僵尸死亡时调用
     */
    drop() {
        const pos = this.node.worldPosition.clone();
        const resourceRoot = this.getResourceRoot();

        // 木材
        if (this.woodPrefab && Math.random() < this.woodDropChance) {
            const node = instantiate(this.woodPrefab);
            this.spawnResource(node, pos, resourceRoot);
        }

        // 铜矿
        if (this.copperPrefab && Math.random() < this.copperDropChance) {
            const node = instantiate(this.copperPrefab);
            this.spawnResource(node, pos, resourceRoot);
        }

        // 铁矿
        if (this.ironPrefab && Math.random() < this.ironDropChance) {
            const node = instantiate(this.ironPrefab);
            this.spawnResource(node, pos, resourceRoot);
        }

        // 金钱
        if (Math.random() < this.moneyDropChance) {
            PlayerData.instance?.addMoney(this.moneyAmount);
        }
    }

    private getResourceRoot(): Node | null {
        const sortLayer = YSortManager.getSortLayer();
        if (sortLayer) {
            return sortLayer;
        }
        const scene = director.getScene();
        if (!scene) return null;
        const gameWorld = scene.getChildByName('GameWorld');
        if (!gameWorld) return null;
        return gameWorld.getChildByName('ResourceRoot');
    }

    private spawnResource(node: Node, pos: Vec3, resourceRoot: Node | null) {
        if (resourceRoot) {
            node.setParent(resourceRoot);
        }

        // 碰撞检测：避免掉落物重叠
        let spawnX = pos.x;
        let spawnY = pos.y;
        if (CollisionWorld.instance) {
            const resolved = CollisionWorld.instance.resolvePlacement(
                20, 20, ColliderGroup.Resource, spawnX, spawnY, 60, 8,
            );
            spawnX = resolved.x;
            spawnY = resolved.y;
        }

        node.setWorldPosition(new Vec3(spawnX, spawnY, 0));
    }
}
