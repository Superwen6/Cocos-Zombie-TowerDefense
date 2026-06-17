import { _decorator, CCFloat, Component, find, instantiate, Node, Prefab, Vec3, warn, log } from 'cc';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { YSortManager } from './YSortManager';

const { ccclass, property } = _decorator;

@ccclass('ResourceSpawner')
export class ResourceSpawner extends Component {

    @property({ type: Prefab, tooltip: '铁矿预制体' })
    ironPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '铜矿预制体' })
    copperPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '木头预制体' })
    woodPrefab: Prefab | null = null;

    @property({ tooltip: '白天资源生成总量' })
    spawnCount = 30;

    @property({ tooltip: '地图上自然生成的资源数量上限（僵尸掉落不参与此限制）' })
    mapResourceLimit = 80;

    @property({ type: Node, tooltip: '资源父节点' })
    resourceRoot: Node | null = null;

    @property({ type: Node, tooltip: '基地节点' })
    baseNode: Node | null = null;

    @property({ type: CCFloat, tooltip: '资源稀缺度：铁矿权重（越小越稀有）' })
    scarcityIron = 1;

    @property({ type: CCFloat, tooltip: '资源稀缺度：铜矿权重（越小越稀有）' })
    scarcityCopper = 2;

    @property({ type: CCFloat, tooltip: '资源稀缺度：木头权重（越小越稀有）' })
    scarcityWood = 4;

    @property({ tooltip: '最小生成半径（避免资源刷在基地脚下）' })
    minSpawnRadius = 150;

    @property({ tooltip: '最大生成半径（控制资源散布范围）' })
    maxSpawnRadius = 900;

    start() {
        console.log("[DEBUG] ResourceSpawner 启动，等待 DayNightSystem 触发资源生成...");
        // 第一天也交由 DayNightSystem 在 showDayNotice 后触发，避免重复
    }

    public spawnDayResources() {
        const root = YSortManager.getSortLayer()
            || this.resourceRoot
            || find('GameWorld/ResourceRoot');
        if (!root) {
            warn('[ResourceSpawner] 找不到 ResourceRoot，资源无法生成');
            return;
        }

        // 统计当前地图上自然生成的资源数量
        const currentCount = this.getResourceCount(root);
        const remaining = Math.max(0, this.mapResourceLimit - currentCount);
        const actualSpawnCount = Math.min(this.spawnCount, remaining);

        if (actualSpawnCount <= 0) {
            log(`[ResourceSpawner] 地图资源已达上限 (${currentCount}/${this.mapResourceLimit})，今日不生成新资源`);
            return;
        }

        log(`[ResourceSpawner] Day 资源生成：请求 ${this.spawnCount}，当前地图 ${currentCount}/${this.mapResourceLimit}，实际生成 ${actualSpawnCount}`);

        const origin = this.baseNode?.worldPosition || Vec3.ZERO;

        for (let i = 0; i < actualSpawnCount; i++) {
            const prefab = this.pickRandomPrefab();
            if (prefab) {
                const node = instantiate(prefab);
                node.setParent(root);
                
                // 在基地周围 minSpawnRadius-maxSpawnRadius 范围内随机偏移
                const angle = Math.random() * Math.PI * 2;
                const radius = this.minSpawnRadius + Math.random() * (this.maxSpawnRadius - this.minSpawnRadius);
                let spawnX = origin.x + Math.cos(angle) * radius;
                let spawnY = origin.y + Math.sin(angle) * radius;

                // 碰撞检测：避免资源重叠
                if (CollisionWorld.instance) {
                    const resolved = CollisionWorld.instance.resolvePlacement(
                        20, 20, ColliderGroup.Resource, spawnX, spawnY,
                    );
                    spawnX = resolved.x;
                    spawnY = resolved.y;
                }

                node.setWorldPosition(new Vec3(spawnX, spawnY, 0));
            }
        }
    }

    /** 根据本组件的稀缺度权重随机选择预制体 */
    private pickRandomPrefab(): Prefab | null {
        const entries: { prefab: Prefab, weight: number }[] = [];
        if (this.ironPrefab) entries.push({ prefab: this.ironPrefab, weight: this.scarcityIron });
        if (this.copperPrefab) entries.push({ prefab: this.copperPrefab, weight: this.scarcityCopper });
        if (this.woodPrefab) entries.push({ prefab: this.woodPrefab, weight: this.scarcityWood });

        if (entries.length === 0) return null;

        const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
        let random = Math.random() * totalWeight;
        for (const entry of entries) {
            random -= entry.weight;
            if (random <= 0) return entry.prefab;
        }
        return entries[entries.length - 1].prefab;
    }

    /** 统计地图上已存在的资源数量 */
    private getResourceCount(root: Node): number {
        let count = 0;
        this.walkResources(root, () => {
            count++;
        });
        return count;
    }

    private walkResources(root: Node, visitor: () => void) {
        if (root.active && root.getComponent('ResourceItem')) {
            visitor();
        }
        for (const child of root.children) {
            this.walkResources(child, visitor);
        }
    }
}