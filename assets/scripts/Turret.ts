import {
    _decorator,
    CCFloat,
    CCInteger,
    Component,
    instantiate,
    Label,
    Node,
    Prefab,
    Vec3,
    warn,
} from 'cc';
import { Bullet } from './Bullet';
import { ZombieMove } from './ZombieMove';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

const ANGLE_EPSILON = 5; // 角度误差阈值（度），小于此值认为已对准

/**
 * 1 级基础炮塔：范围锁最近敌、周期开火、可承受伤害。
 */
@ccclass('Turret')
export class Turret extends Component {
    @property({ type: CCInteger, tooltip: '建造消耗木头' })
    costWood = 10;

    @property({ type: CCInteger, tooltip: '建造消耗铜矿' })
    costCopper = 5;

    @property({ type: CCInteger, tooltip: '建造消耗铁矿' })
    costIron = 1;

    @property({ type: CCInteger, tooltip: '建造消耗美元' })
    costMoney = 0;

    @property({ type: CCInteger, tooltip: '炮塔最大血量' })
    maxHp = 150;

    @property({ type: CCInteger, tooltip: '炮塔攻击力' })
    damage = 10;

    @property({ type: CCFloat, tooltip: '炮塔攻击频率（秒/次）' })
    attackInterval = 0.5;

    @property({ type: CCFloat, tooltip: '炮塔攻击半径（像素）' })
    attackRange = 1200;

    @property({ type: Prefab, tooltip: '子弹预制体' })
    bulletPrefab: Prefab | null = null;

    @property({ type: Label, tooltip: '头顶血量 Label' })
    hpLabel: Label | null = null;

    @property({ type: Node, tooltip: '枪口/炮管节点（用于旋转指向目标）' })
    muzzleNode: Node | null = null;

    @property({ tooltip: '枪口末端偏移距离（像素），子弹从此处发射' })
    muzzleOffset = 50;

    @property({ tooltip: '炮管贴图默认朝向（度）。0=朝右，90=朝上，180=朝左，-90=朝下' })
    barrelDefaultAngle = -90;

    @property({ tooltip: '炮口旋转速度（度/秒）' })
    rotationSpeed = 360;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 20;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 20;

    @property({ type: Boolean, tooltip: '是否开启双发平行模式（仅双管炮塔使用）' })
    enableDualShot = false;

    @property({ type: CCFloat, tooltip: '双发子弹的平行间距（像素）' })
    dualShotSpread = 15;

    private hp = 150;
    private fireTimer = 0;
    private lockedTarget: ZombieMove | null = null;
    private _collider: Collider2D | null = null;

    // 平滑旋转状态
    private _currentAngle = 0;
    private _targetAngle = 0;
    private _hasTarget = false;
    private _angleAligned = false; // 当前是否已对准目标

    // 炮管初始角度偏移（从预制体 muzzleNode.angle 自动读取）
    private barrelAngleOffset = 0;

    private readonly _turretPos = new Vec3();
    private readonly _spawnPos = new Vec3();

    start() {
        this.hp = this.maxHp;
        this.refreshHpLabel();
        if (this.muzzleNode) {
            // 记录炮管初始角度作为偏移量（2turret炮管初始90°，baseTurret初始0°）
            this.barrelAngleOffset = this.muzzleNode.angle;
            // 内部角度从0开始，旋转时加上偏移量应用到节点
            this._currentAngle = 0;
            this._targetAngle = 0;
        }
        if (!this.bulletPrefab) {
            warn('[Turret] bulletPrefab 未绑定，炮塔无法发射子弹！请在 BaseTurret 预制体上绑定 TurretBullet.prefab');
        }
        // 注册碰撞体
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x,
            y: wp.y,
            halfW: this.colliderHalfW,
            halfH: this.colliderHalfH,
            group: ColliderGroup.Turret,
        };
        CollisionWorld.instance?.register(this._collider);
    }

    onDestroy() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
    }

    update(dt: number) {
        if (this.hp <= 0) {
            return;
        }

        this.lockedTarget = this.findClosestZombieInRange();

        // 平滑旋转炮口
        if (this.muzzleNode) {
            if (this.lockedTarget) {
                const turretPos = this.muzzleNode.worldPosition;
                const targetPos = this.lockedTarget.node.worldPosition;
                const dirX = targetPos.x - turretPos.x;
                const dirY = targetPos.y - turretPos.y;
                // 炮管视觉方向 = muzzleNode.angle + barrelDefaultAngle
                // 要让炮管指向目标：muzzleNode.angle + barrelDefaultAngle = atan2
                // muzzleNode.angle = _currentAngle + barrelAngleOffset
                // 所以：_targetAngle = atan2 - barrelDefaultAngle - barrelAngleOffset
                this._targetAngle = Math.atan2(dirY, dirX) * 180 / Math.PI - this.barrelDefaultAngle - this.barrelAngleOffset;
                this._hasTarget = true;
            }

            // 计算最短角度差
            if (this._hasTarget) {
                let angleDiff = this._targetAngle - this._currentAngle;
                // 归一化到 [-180, 180]
                while (angleDiff > 180) angleDiff -= 360;
                while (angleDiff < -180) angleDiff += 360;

                const maxStep = this.rotationSpeed * dt;
                if (Math.abs(angleDiff) <= maxStep) {
                    this._currentAngle = this._targetAngle;
                } else {
                    this._currentAngle += Math.sign(angleDiff) * maxStep;
                }

                // 应用角度：muzzleNode.angle = _currentAngle + barrelAngleOffset
                // 炮管视觉方向 = muzzleNode.angle + barrelDefaultAngle
                this.muzzleNode.angle = this._currentAngle + this.barrelAngleOffset;

                // 判断是否已对准（角度差小于阈值）
                this._angleAligned = Math.abs(angleDiff) <= ANGLE_EPSILON;
            }
        }

        this.fireTimer += dt;

        // 只有在对准目标后才允许射击
        if (this.fireTimer < this.attackInterval || !this.lockedTarget || !this._angleAligned) {
            return;
        }

        this.fireAt(this.lockedTarget);
        this.fireTimer = 0;
    }

    takeDamage(amount: number) {
        if (this.hp <= 0 || amount <= 0) {
            return;
        }

        this.hp = Math.max(0, this.hp - amount);
        this.refreshHpLabel();

        if (this.hp <= 0) {
            this.node.destroy();
        }
    }

    private refreshHpLabel() {
        if (this.hpLabel) {
            this.hpLabel.string = `${this.hp}/${this.maxHp}`;
        }
    }

    private findClosestZombieInRange(): ZombieMove | null {
        const scene = this.node.scene;
        if (!scene) {
            return null;
        }

        this.node.getWorldPosition(this._turretPos);
        const zombies: ZombieMove[] = [];
        this.collectZombies(scene, zombies);

        let closest: ZombieMove | null = null;
        let minDist = Number.MAX_VALUE;

        for (const zombie of zombies) {
            if (!zombie.node.isValid || zombie.isDead || zombie.hp <= 0) {
                continue;
            }
            const zombiePos = zombie.node.worldPosition;
            const dist = Vec3.distance(this._turretPos, zombiePos);
            if (dist > this.attackRange || dist >= minDist) {
                continue;
            }
            // 视线检测：炮塔与僵尸之间是否有墙体阻挡
            if (!CollisionWorld.instance?.isLineOfSightClear(
                this._turretPos, zombiePos, [ColliderGroup.Wall],
            )) {
                continue; // 视线被挡，跳过该僵尸
            }
            minDist = dist;
            closest = zombie;
        }

        return closest;
    }

    private collectZombies(root: Node, out: ZombieMove[]) {
        const zombie = root.getComponent(ZombieMove);
        if (zombie) {
            out.push(zombie);
        }
        for (const child of root.children) {
            this.collectZombies(child, out);
        }
    }

    private fireAt(target: ZombieMove) {
        if (!this.bulletPrefab) {
            return;
        }

        // 计算子弹发射位置：沿炮管视觉方向偏移 muzzleOffset 距离
        // 如果没有muzzleNode，从节点中心发射
        const turretPos = this.muzzleNode ? this.muzzleNode.worldPosition : this.node.worldPosition;
        // 炮管实际视觉方向 = muzzleNode.angle + barrelDefaultAngle
        const barrelVisualAngle = this._currentAngle + this.barrelAngleOffset + this.barrelDefaultAngle;
        const rad = barrelVisualAngle * Math.PI / 180;
        const dirX = Math.cos(rad);
        const dirY = Math.sin(rad);
        this._spawnPos.set(
            turretPos.x + dirX * this.muzzleOffset,
            turretPos.y + dirY * this.muzzleOffset,
            0,
        );

        if (this.enableDualShot) {
            // 双发模式：沿垂直于炮管方向偏移，生成两发平行子弹
            const perpX = -dirY;
            const perpY = dirX;
            const halfSpread = this.dualShotSpread / 2;

            // 第一发子弹
            this.spawnBullet(
                this._spawnPos.x + perpX * halfSpread,
                this._spawnPos.y + perpY * halfSpread,
                target,
            );
            // 第二发子弹
            this.spawnBullet(
                this._spawnPos.x - perpX * halfSpread,
                this._spawnPos.y - perpY * halfSpread,
                target,
            );
        } else {
            this.spawnBullet(this._spawnPos.x, this._spawnPos.y, target);
        }
    }

    private spawnBullet(x: number, y: number, target: ZombieMove) {
        // 实例化子弹，初始缩放为 0，避免显示预制体默认角度
        const bulletNode = instantiate(this.bulletPrefab!);
        bulletNode.setScale(0, 0, 1);
        const pos = new Vec3(x, y, 0);
        Bullet.attachToWorld(bulletNode, pos);

        const bullet = bulletNode.getComponent(Bullet);
        if (bullet) {
            bullet.init(target.node, this.damage);
        } else {
            warn('[Turret] 子弹预制体上未找到 Bullet 组件');
            bulletNode.destroy();
        }
    }
}
