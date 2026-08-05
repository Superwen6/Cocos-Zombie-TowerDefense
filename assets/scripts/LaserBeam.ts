import { _decorator, CCFloat, Component, director, Node, UITransform, Vec3 } from 'cc';
import { ZombieMove } from './ZombieMove';

const { ccclass, property } = _decorator;

/**
 * 激光束子弹：从炮塔枪口到目标敌人之间生成一条持续光束，
 * 每隔 tickInterval 秒对目标造成一次伤害。
 * 光束没有持续时间限制，锁定目标后持续照射，直到目标死亡/失效或超出攻击范围才销毁。
 * 与普通子弹一次命中不同，激光束是"持续照射 + 周期性伤害"。
 */
@ccclass('LaserBeam')
export class LaserBeam extends Component {
    @property({ type: CCFloat, tooltip: '伤害倍率：每次 tick 伤害 = 炮塔伤害 × 该倍率' })
    damageFactor = 0.2;

    @property({ type: CCFloat, tooltip: '伤害间隔（秒），每 tickInterval 秒结算一次伤害' })
    tickInterval = 0.2;

    @property({ type: [Node], tooltip: '光束图层节点（从外到内：glow 外红光 / mid 中橙光 / core 核心白光），宽度由脚本控制，高度在预制体里按倍率配好' })
    layerNodes: Node[] = [];

    /** 每次 tick 实际伤害值（运行时 = 炮塔伤害 × damageFactor，向上取整） */
    damagePerTick = 1;

    private _targetNode: Node | null = null;
    private _target: ZombieMove | null = null;
    private _originNode: Node | null = null;
    private _originPos: Vec3 | null = null;
    private _attackerNode: Node | null = null;
    private _tickTimer = 0;
    private _maxRange = 0;
    private readonly _origin = new Vec3();
    private readonly _dir = new Vec3();

    static attachToWorld(beamNode: Node, worldPos: Vec3) {
        // 将光束挂载到 GameWorld 节点下，避免跟随玩家移动
        const gameWorld = beamNode.scene?.getChildByName('GameWorld')
            ?? director.getScene()?.getChildByName('GameWorld');
        if (gameWorld) {
            beamNode.setParent(gameWorld);
            beamNode.layer = gameWorld.layer;
        }
        beamNode.setWorldPosition(worldPos);
        if (gameWorld) {
            beamNode.setSiblingIndex(gameWorld.children.length - 1);
        }
    }

    /**
     * 初始化激光束。
     * @param targetNode 目标敌人节点
     * @param originNode 起点节点（炮塔枪口，跟随其位置；为 null 时用 originPos）
     * @param originPos 固定起点世界坐标（originNode 为 null 时使用）
     * @param baseDamage 炮塔伤害值，实际每次 tick 伤害 = baseDamage × damageFactor
     * @param attackerNode 攻击者节点（炮塔）
     * @param maxRange 最大攻击距离，超出则销毁；0 表示不限
     */
    init(
        targetNode: Node | null,
        originNode: Node | null,
        originPos: Vec3 | null,
        baseDamage: number,
        attackerNode?: Node,
        maxRange = 0,
    ) {
        this._targetNode = targetNode;
        this._target = targetNode?.getComponent(ZombieMove) ?? null;
        this._originNode = originNode;
        this._originPos = originPos;
        this._attackerNode = attackerNode ?? null;
        this._maxRange = maxRange;
        this.damagePerTick = Math.max(1, Math.round(baseDamage * this.damageFactor));
        this._tickTimer = 0;
        // 立即渲染光束，避免第一帧显示预制体默认短截状态
        this.updateBeamVisual();
        // 生成瞬间先结算一次伤害
        this.applyDamage();
    }

    /** 更新目标（炮塔切换目标时调用），目标已失效则自动销毁 */
    updateTarget(targetNode: Node | null) {
        if (this.node.isValid && targetNode?.isValid) {
            this._targetNode = targetNode;
            this._target = targetNode.getComponent(ZombieMove) ?? null;
            this._tickTimer = 0;
        }
    }

    update(dt: number) {
        // 目标失效则销毁
        if (!this._targetNode?.isValid || !this._target || this._target.isDead) {
            this.node.destroy();
            return;
        }

        // 目标超出最大攻击距离则销毁
        if (this._maxRange > 0 && this._originNode?.isValid) {
            const tp = this._target.getHitWorldPosition();
            const d = Vec3.distance(this._originNode.worldPosition, tp);
            if (d > this._maxRange) {
                this.node.destroy();
                return;
            }
        }

        this.updateBeamVisual();

        // 周期性伤害
        this._tickTimer += dt;
        if (this._tickTimer >= this.tickInterval) {
            this._tickTimer = 0;
            this.applyDamage();
        }
    }

    /** 把光束节点放到起点、旋转指向目标，并把贴图宽度拉满到目标 */
    private updateBeamVisual() {
        // 计算起点：优先跟随 originNode（炮塔枪口），否则使用固定坐标
        if (this._originNode?.isValid) {
            this._originNode.getWorldPosition(this._origin);
        } else if (this._originPos) {
            this._origin.set(this._originPos);
        }

        this.node.setWorldPosition(this._origin);

        const tp = this._target.getHitWorldPosition();
        this._dir.set(tp.x - this._origin.x, tp.y - this._origin.y, 0);
        const dist = this._dir.length();
        if (dist < 1) return;
        this._dir.normalize();

        const angle = Math.atan2(this._dir.y, this._dir.x) * 180 / Math.PI;
        this.node.eulerAngles = new Vec3(0, 0, angle);

        // 各图层以左中为锚点向右伸展，宽度 = 到目标的距离（高度在预制体按倍率配置）
        for (const layer of this.layerNodes) {
            if (layer?.isValid) {
                const ut = layer.getComponent(UITransform);
                if (ut) {
                    ut.width = dist;
                }
            }
        }
    }

    private applyDamage() {
        if (this._target && this._targetNode?.isValid && !this._target.isDead) {
            this._target.takeDamage(this.damagePerTick, this._attackerNode ?? undefined);
        }
    }
}
