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
    // 放置时互阻：资源不重叠、炮塔不重叠、资源与炮塔不重叠
    [ColliderGroup.Resource, ColliderGroup.Resource],
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

@ccclass('CollisionWorld')
export class CollisionWorld extends Component {
    static instance: CollisionWorld | null = null;

    private _colliders: Collider2D[] = [];

    onLoad() {
        CollisionWorld.instance = this;
    }

    onDestroy() {
        if (CollisionWorld.instance === this) {
            CollisionWorld.instance = null;
        }
    }

    register(c: Collider2D) {
        this._colliders.push(c);
    }

    unregister(c: Collider2D) {
        const idx = this._colliders.indexOf(c);
        if (idx >= 0) this._colliders.splice(idx, 1);
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
     */
    private _resolveStep(
        self: Collider2D,
        fromX: number, fromY: number,
        toX: number, toY: number,
    ): { x: number; y: number } {
        let resultX = toX;
        let resultY = toY;

        for (const other of this._colliders) {
            if (other === self) continue;
            if (!other.node.active || !other.node.worldPosition) continue;
            if (!willBlock(self.group, other.group)) continue;

            const ox = other.node.worldPosition.x;
            const oy = other.node.worldPosition.y;

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
     * 返回第一个命中的碰撞体，未命中返回 null。
     */
    checkHit(
        x: number, y: number, halfW: number, halfH: number,
        targetGroups: ColliderGroup[],
    ): Collider2D | null {
        for (const other of this._colliders) {
            if (!other.node.active || !other.node.worldPosition) continue;
            if (!targetGroups.includes(other.group)) continue;

            const ox = other.node.worldPosition.x;
            const oy = other.node.worldPosition.y;
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

    private checkOverlapAt(halfW: number, halfH: number, group: ColliderGroup, x: number, y: number): boolean {
        for (const other of this._colliders) {
            if (!other.node.active || !other.node.worldPosition) continue;
            if (!willBlock(group, other.group)) continue;

            const ox = other.node.worldPosition.x;
            const oy = other.node.worldPosition.y;
            if (rectsOverlap(x, y, halfW, halfH, ox, oy, other.halfW, other.halfH)) {
                return true;
            }
        }
        return false;
    }
}
