import { _decorator, Component, Node, Vec3 } from 'cc';

const { ccclass } = _decorator;

/**
 * 简单的手动碰撞检测世界。
 * 不依赖物理引擎，每帧检测矩形碰撞并阻挡移动。
 */
export interface Collider2D {
    node: Node;
    x: number;
    y: number;
    halfW: number;
    halfH: number;
    group: ColliderGroup;
    /** 碰撞中心相对节点位置的 Y 偏移（贴图锚点在脚部时上移到贴图中心） */
    offsetY: number;
}

export enum ColliderGroup {
    Player = 1,
    Zombie = 2,
    Resource = 3,
    Turret = 4,
    Wall = 5,
}

/** 哪些组之间会产生碰撞阻挡（含放置时同组互阻） */
const BLOCK_PAIRS: [ColliderGroup, ColliderGroup][] = [
    [ColliderGroup.Player, ColliderGroup.Resource],
    [ColliderGroup.Player, ColliderGroup.Turret],
    [ColliderGroup.Player, ColliderGroup.Wall],
    [ColliderGroup.Player, ColliderGroup.Player],
    [ColliderGroup.Zombie, ColliderGroup.Resource],
    [ColliderGroup.Zombie, ColliderGroup.Turret],
    [ColliderGroup.Zombie, ColliderGroup.Wall],
    [ColliderGroup.Zombie, ColliderGroup.Zombie],
    [ColliderGroup.Player, ColliderGroup.Zombie],
    // 放置时互阻：资源不重叠、资源不与建筑重叠、炮塔不重叠、资源与炮塔不重叠
    [ColliderGroup.Resource, ColliderGroup.Resource],
    [ColliderGroup.Resource, ColliderGroup.Wall],
    [ColliderGroup.Turret, ColliderGroup.Turret],
    [ColliderGroup.Resource, ColliderGroup.Turret],
];

function willBlock(a: ColliderGroup, b: ColliderGroup): boolean {
    for (const [g1, g2] of BLOCK_PAIRS) {
        if ((a === g1 && b === g2) || (a === g2 && b === g1)) {
            return true;
        }
    }
    return false;
}

function rectsOverlap(
    ax: number, ay: number, ahw: number, ahh: number,
    bx: number, by: number, bhw: number, bhh: number,
): boolean {
    return Math.abs(ax - bx) < ahw + bhw && Math.abs(ay - by) < ahh + bhh;
}

/** 空间哈希网格单元格大小（像素） */
const GRID_CELL_SIZE = 120;
/** 网格 key 乘数，需大于最大网格坐标 */
const GRID_KEY_MULT = 100003;

@ccclass('CollisionWorld')
export class CollisionWorld extends Component {
    static instance: CollisionWorld | null = null;

    private _colliders: Collider2D[] = [];

    // ===== 空间哈希网格（性能优化：O(1) 附近碰撞体查询） =====
    private _gridDirty = true;
    private readonly _grid = new Map<number, Collider2D[]>();
    private readonly _groupCache = new Map<ColliderGroup, Collider2D[]>();

    onLoad() {
        CollisionWorld.instance = this;
    }

    onDestroy() {
        if (CollisionWorld.instance === this) {
            CollisionWorld.instance = null;
        }
    }

    /** 每帧结束时标记网格脏，下一帧首次查询时重建 */
    lateUpdate() {
        this._gridDirty = true;
    }

    register(c: Collider2D) {
        this._colliders.push(c);
        this._gridDirty = true;
    }

    unregister(c: Collider2D) {
        const idx = this._colliders.indexOf(c);
        if (idx >= 0) this._colliders.splice(idx, 1);
        this._gridDirty = true;
    }

    // ===== 空间哈希网格方法 =====

    private static cellKey(cx: number, cy: number): number {
        return cx * GRID_KEY_MULT + cy;
    }

    /** 惰性重建网格和分组缓存 */
    private ensureGrid() {
        if (!this._gridDirty) return;
        this._grid.clear();
        this._groupCache.clear();

        for (const c of this._colliders) {
            if (!c.node || !c.node.isValid || !c.node.active) continue;

            const wp = c.node.worldPosition;
            const cx = Math.floor(wp.x / GRID_CELL_SIZE);
            const cy = Math.floor((wp.y + c.offsetY) / GRID_CELL_SIZE);
            const key = CollisionWorld.cellKey(cx, cy);
            let cell = this._grid.get(key);
            if (!cell) {
                cell = [];
                this._grid.set(key, cell);
            }
            cell.push(c);

            // 分组缓存
            let groupList = this._groupCache.get(c.group);
            if (!groupList) {
                groupList = [];
                this._groupCache.set(c.group, groupList);
            }
            groupList.push(c);
        }

        this._gridDirty = false;
    }

    /** 获取指定位置附近的碰撞体（用于碰撞检测，避免全量遍历） */
    private getNearby(x: number, y: number, range: number): Collider2D[] {
        this.ensureGrid();

        const result: Collider2D[] = [];
        const seen = new Set<Collider2D>();
        const cellRange = Math.ceil(range / GRID_CELL_SIZE) + 1;
        const cx = Math.floor(x / GRID_CELL_SIZE);
        const cy = Math.floor(y / GRID_CELL_SIZE);

        for (let dx = -cellRange; dx <= cellRange; dx++) {
            for (let dy = -cellRange; dy <= cellRange; dy++) {
                const key = CollisionWorld.cellKey(cx + dx, cy + dy);
                const cell = this._grid.get(key);
                if (cell) {
                    for (const c of cell) {
                        if (!seen.has(c)) {
                            seen.add(c);
                            result.push(c);
                        }
                    }
                }
            }
        }
        return result;
    }

    /** 获取指定碰撞组的所有碰撞体（使用网格缓存，O(1)） */
    getCollidersByGroup(group: ColliderGroup): Collider2D[] {
        this.ensureGrid();
        const list = this._groupCache.get(group);
        if (!list) return [];
        // 过滤已销毁节点
        return list.filter(c => c.node && c.node.isValid && c.node.active);
    }

    /**
     * 尝试将实体从 (fromX, fromY) 移动到 (toX, toY)。
     * 如果移动路径上有阻挡物，返回被阻挡后的位置（贴着阻挡物）。
     * 自动对大位移做子步拆分，防止卡顿/帧率波动时发生穿模。
     */
    resolveMove(
        self: Collider2D,
        fromX: number, fromY: number,
        toX: number, toY: number,
    ): { x: number; y: number } {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 单步最大移动距离：取实体碰撞体较小半维的 0.8 倍，
        // 确保子步内不会越过任何阻挡物
        const maxStep = Math.min(self.halfW, self.halfH) * 0.8;
        if (maxStep < 1) {
            // 碰撞体极小，不做子步，直接单次结算
            return this._resolveStep(self, fromX, fromY, toX, toY);
        }

        if (dist <= maxStep) {
            return this._resolveStep(self, fromX, fromY, toX, toY);
        }

        // 子步拆分：将大位移拆成多个小步，每步都做碰撞检测
        const steps = Math.ceil(dist / maxStep);
        let cx = fromX;
        let cy = fromY;
        const sx = dx / steps;
        const sy = dy / steps;

        for (let i = 0; i < steps; i++) {
            const nx = cx + sx;
            const ny = cy + sy;
            const result = this._resolveStep(self, cx, cy, nx, ny);
            cx = result.x;
            cy = result.y;
        }

        return { x: cx, y: cy };
    }

    /**
     * 单步碰撞结算：从 (fromX,fromY) 移动到 (toX,toY)。
     * 使用 fromX/fromY 判断推开方向，确保实体被推回起始侧而非穿透。
     * 使用空间哈希网格仅检查附近碰撞体，避免全量遍历。
     */
    private _resolveStep(
        self: Collider2D,
        fromX: number, fromY: number,
        toX: number, toY: number,
    ): { x: number; y: number } {
        let resultX = toX;
        let resultY = toY;

        const maxHalf = Math.max(self.halfW, self.halfH);
        const searchRange = maxHalf + GRID_CELL_SIZE;
        const nearby = this.getNearby(toX, toY, searchRange);

        for (const other of nearby) {
            if (other === self) continue;
            if (!other.node.active || !other.node.worldPosition) continue;
            if (!willBlock(self.group, other.group)) continue;

            const ox = other.node.worldPosition.x;
            const oy = other.node.worldPosition.y + other.offsetY;

            if (rectsOverlap(resultX, resultY, self.halfW, self.halfH, ox, oy, other.halfW, other.halfH)) {
                // 用起始位置判断推开方向，防止穿模
                const pushDx = fromX - ox;
                const pushDy = fromY - oy;
                const overlapX = self.halfW + other.halfW - Math.abs(resultX - ox);
                const overlapY = self.halfH + other.halfH - Math.abs(resultY - oy);

                if (overlapX < overlapY) {
                    resultX += pushDx > 0 ? overlapX : -overlapX;
                } else {
                    resultY += pushDy > 0 ? overlapY : -overlapY;
                }
            }
        }

        return { x: resultX, y: resultY };
    }

    /**
     * 为静态物体（资源、掉落物、建造炮塔）找到一个不与其他碰撞体重叠的位置。
     * 从原点开始螺旋扫描，找到最近的空闲位置。
     * @param halfW 碰撞体半宽
     * @param halfH 碰撞体半高
     * @param group 碰撞组
     * @param originX 期望位置的 X
     * @param originY 期望位置的 Y
     * @param maxRadius 最大搜索半径（超出则返回原点）
     * @param step 螺旋步进大小
     */
    resolvePlacement(
        halfW: number, halfH: number, group: ColliderGroup,
        originX: number, originY: number,
        maxRadius = 200, step = 8,
    ): { x: number; y: number } {
        // 先尝试原点
        if (!this.checkOverlapAt(halfW, halfH, group, originX, originY)) {
            return { x: originX, y: originY };
        }

        // 螺旋向外搜索
        let angle = 0;
        let radius = step;
        while (radius <= maxRadius) {
            const pointsOnRing = Math.ceil((2 * Math.PI * radius) / step);
            for (let i = 0; i < pointsOnRing; i++) {
                const a = (i / pointsOnRing) * Math.PI * 2 + angle;
                const tx = originX + Math.cos(a) * radius;
                const ty = originY + Math.sin(a) * radius;
                if (!this.checkOverlapAt(halfW, halfH, group, tx, ty)) {
                    return { x: tx, y: ty };
                }
            }
            radius += step;
            angle += 0.3; // 错开每圈角度，避免重复采样
        }

        // 找不到空闲位置，返回原点
        return { x: originX, y: originY };
    }

    /**
     * 检测指定位置是否与目标碰撞组的物体重叠。
     * 使用空间哈希网格仅检查附近碰撞体。
     * @param excludeSelf 排除自身碰撞体（避免检测到自己），可选
     * @returns 第一个命中的碰撞体，未命中返回 null
     */
    checkHit(
        x: number, y: number, halfW: number, halfH: number,
        targetGroups: ColliderGroup[],
        excludeSelf?: Collider2D,
    ): Collider2D | null {
        const searchRange = Math.max(halfW, halfH) + GRID_CELL_SIZE;
        const nearby = this.getNearby(x, y, searchRange);

        for (const other of nearby) {
            if (other === excludeSelf) continue;
            if (!other.node.active || !other.node.worldPosition) continue;
            if (!targetGroups.includes(other.group)) continue;

            const ox = other.node.worldPosition.x;
            const oy = other.node.worldPosition.y + other.offsetY;
            if (rectsOverlap(x, y, halfW, halfH, ox, oy, other.halfW, other.halfH)) {
                return other;
            }
        }
        return null;
    }

    /**
     * 检测两点之间的视线是否被指定碰撞组的物体阻挡。
     * 使用离散化射线检测：沿线段每隔 stepSize 像素采样一次。
     * @param from 起点
     * @param to 终点
     * @param groups 需要检测的碰撞组（如 [ColliderGroup.Wall]）
     * @param stepSize 采样步长（像素），越小越精确，默认 8
     * @param shrink 起终点缩进距离，避免自阻塞，默认 5
     */
    isLineOfSightClear(
        from: Vec3, to: Vec3,
        groups: ColliderGroup[],
        stepSize = 8, shrink = 5,
    ): boolean {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) return true; // 距离太近，直接视为通畅

        // 归一化方向
        const nx = dx / dist;
        const ny = dy / dist;

        // 起终点缩进，避免自阻塞
        const startX = from.x + nx * shrink;
        const startY = from.y + ny * shrink;
        const endX = to.x - nx * shrink;
        const endY = to.y - ny * shrink;

        const segDx = endX - startX;
        const segDy = endY - startY;
        const segDist = Math.sqrt(segDx * segDx + segDy * segDy);

        if (segDist < 1) return true;

        const steps = Math.ceil(segDist / stepSize);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = startX + segDx * t;
            const py = startY + segDy * t;

            // 用一个小矩形（3x3）检测是否进入碰撞体
            if (this.checkHit(px, py, 3, 3, groups)) {
                return false; // 视线被阻挡
            }
        }

        return true; // 视线通畅
    }

    /** 调试用：检测视线是否通畅，被阻挡时返回阻挡碰撞体的节点名称 */
    debugLineOfSight(
        from: Vec3, to: Vec3,
        groups: ColliderGroup[],
        stepSize = 8, shrink = 5,
    ): string | null {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return null;

        const nx = dx / dist;
        const ny = dy / dist;
        const startX = from.x + nx * shrink;
        const startY = from.y + ny * shrink;
        const endX = to.x - nx * shrink;
        const endY = to.y - ny * shrink;
        const segDx = endX - startX;
        const segDy = endY - startY;
        const segDist = Math.sqrt(segDx * segDx + segDy * segDy);
        if (segDist < 1) return null;

        const steps = Math.ceil(segDist / stepSize);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = startX + segDx * t;
            const py = startY + segDy * t;
            const blocker = this.debugCheckHit(px, py, 3, 3, groups);
            if (blocker) return blocker;
        }
        return null;
    }

    private debugCheckHit(x: number, y: number, halfW: number, halfH: number, groups: ColliderGroup[]): string | null {
        for (const c of this._colliders) {
            if (!c.node || !c.node.isValid) continue;
            if (!groups.includes(c.group)) continue;
            const ox = c.node.worldPosition.x;
            const oy = c.node.worldPosition.y + c.offsetY;
            if (rectsOverlap(x, y, halfW, halfH, ox, oy, c.halfW, c.halfH)) {
                return c.node.name;
            }
        }
        return null;
    }

    private checkOverlapAt(halfW: number, halfH: number, group: ColliderGroup, x: number, y: number): boolean {
        const searchRange = Math.max(halfW, halfH) + GRID_CELL_SIZE;
        const nearby = this.getNearby(x, y, searchRange);

        for (const other of nearby) {
            if (!other.node.active || !other.node.worldPosition) continue;
            if (!willBlock(group, other.group)) continue;

            const ox = other.node.worldPosition.x;
            const oy = other.node.worldPosition.y + other.offsetY;
            if (rectsOverlap(x, y, halfW, halfH, ox, oy, other.halfW, other.halfH)) {
                return true;
            }
        }
        return false;
    }
}
