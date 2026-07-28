import { _decorator, CCFloat, Component, find, instantiate, Node, Prefab, Vec3, warn, log } from 'cc';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { YSortManager } from './YSortManager';

const { ccclass, property } = _decorator;

@ccclass('ResourceSpawner')
export class ResourceSpawner extends Component {
    public static instance: ResourceSpawner | null = null;

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

    @property({ type: Node, tooltip: '坐标系参考节点（地图边界均相对于此节点）' })
    coordinateReference: Node | null = null;

    @property({ type: CCFloat, tooltip: '资源稀缺度：铁矿权重（越小越稀有）' })
    scarcityIron = 1;

    @property({ type: CCFloat, tooltip: '资源稀缺度：铜矿权重（越小越稀有）' })
    scarcityCopper = 2;

    @property({ type: CCFloat, tooltip: '资源稀缺度：木头权重（越小越稀有）' })
    scarcityWood = 4;

    @property({ type: CCFloat, tooltip: '地图最小 X 坐标（相对于 CoordinateReference）' })
    mapMinX = -2310;

    @property({ type: CCFloat, tooltip: '地图最大 X 坐标（相对于 CoordinateReference）' })
    mapMaxX = 3760;

    @property({ type: CCFloat, tooltip: '地图最小 Y 坐标（相对于 CoordinateReference）' })
    mapMinY = -2710;

    @property({ type: CCFloat, tooltip: '地图最大 Y 坐标（相对于 CoordinateReference）' })
    mapMaxY = 3350;

    start() {
        ResourceSpawner.instance = this;
        // 第一天也交由 DayNightSystem 在 showDayNotice 后触发，避免重复
    }

    onDestroy() {
        if (ResourceSpawner.instance === this) {
            ResourceSpawner.instance = null;
        }
    }

    /** 获取资源根节点（供 SaveSystem 使用） */
    public getResourceRoot(): Node | null {
        return YSortManager.getSortLayer()
            || this.resourceRoot
            || find('GameWorld/ResourceRoot');
    }

    /** 根据资源类型获取对应预制体（供 SaveSystem 使用） */
    public getPrefabByType(type: string): Prefab | null {
        switch (type) {
            case 'iron': return this.ironPrefab;
            case 'copper': return this.copperPrefab;
            case 'wood': return this.woodPrefab;
            default: return null;
        }
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

        // 获取坐标系参考原点（世界坐标），若未赋值则自动查找
        const coordRef = this.coordinateReference ?? find('GameWorld/CoordinateReference');
        const refWorldPos = coordRef?.worldPosition ?? Vec3.ZERO;
        const refX = refWorldPos.x;
        const refY = refWorldPos.y;

        for (let i = 0; i < actualSpawnCount; i++) {
            const prefab = this.pickRandomPrefab();
            if (prefab) {
                const node = instantiate(prefab);
                node.setParent(root);
                
                // 在地图矩形范围内随机生成位置（相对于 CoordinateReference 的本地坐标）
                let spawnX = this.mapMinX + Math.random() * (this.mapMaxX - this.mapMinX);
                let spawnY = this.mapMinY + Math.random() * (this.mapMaxY - this.mapMinY);

                // 碰撞检测使用世界坐标
                if (CollisionWorld.instance) {
                    const resolved = CollisionWorld.instance.resolvePlacement(
                        20, 20, ColliderGroup.Resource, refX + spawnX, refY + spawnY,
                    );
                    // 转换回本地坐标
                    spawnX = resolved.x - refX;
                    spawnY = resolved.y - refY;
                }

                // 确保碰撞解析后仍在边界内
                spawnX = Math.max(this.mapMinX, Math.min(this.mapMaxX, spawnX));
                spawnY = Math.max(this.mapMinY, Math.min(this.mapMaxY, spawnY));

                // 设置世界坐标
                node.setWorldPosition(new Vec3(refX + spawnX, refY + spawnY, 0));
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