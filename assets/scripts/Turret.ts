import {
    _decorator,
    AudioClip,
    AudioSource,
    CCFloat,
    CCInteger,
    Component,
    find,
    instantiate,
    Label,
    Node,
    Prefab,
    Vec3,
    warn,
} from 'cc';
import { Bullet } from './Bullet';
import { LaserBeam } from './LaserBeam';
import { BulletSound } from './BulletSound';
import { ZombieMove } from './ZombieMove';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';
import { BaseSystem } from './BaseSystem';
import { EnemyManager } from './EnemyManager';

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

    // 以下为运行时记录（非编辑器属性），用于拆除时按实际消耗返还
    materialSaveApplied = false;
    actualCostWood = 0;
    actualCostCopper = 0;
    actualCostIron = 0;
    actualCostMoney = 0;

    @property({ type: CCInteger, tooltip: '炮塔电力消耗（单位：瓦）' })
    powerCost = 1;

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

    @property({ type: Boolean, tooltip: '子弹是否跟踪敌人（取消勾选后子弹沿初始方向直线飞行）' })
    homingBullet = true;

    @property({ type: Boolean, tooltip: '子弹是否穿透僵尸（勾选后子弹可穿透多个僵尸）' })
    piercingBullet = false;

    @property({ type: AudioClip, tooltip: '被摧毁音效' })
    destroySound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '被摧毁音效最大距离（像素），超出此距离不播放' })
    destroySoundMaxDistance = 800;

    @property({ type: AudioClip, tooltip: '受到攻击音效' })
    attackSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '受攻击音效最大距离（像素），超出此距离不播放' })
    attackSoundMaxDistance = 250;

    @property({ type: CCFloat, tooltip: '受攻击音效最小播放间隔（秒），0=每次受击都播放，0.3=间隔0.3秒，2=间隔2秒' })
    attackSoundCooldown = 1;

    private _hp = 150;

    /** 当前血量（公开读写，供 SaveSystem 存档/读档使用） */
    get hp(): number { return this._hp; }
    set hp(v: number) { this._hp = v; }

    /** 放置虚影阶段标记（隐藏血量文字，与 HealthBar 虚影隐藏一致） */
    public ghostPreview = false;
    private _hpLabelHideTimer = 0;
    private fireTimer = 0;
    private lockedTarget: ZombieMove | null = null;
    private _activeLaser: LaserBeam | null = null;
    private _collider: Collider2D | null = null;
    private _audioSource: AudioSource | null = null;
    private _attackSoundTimer = 0;

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
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
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
            offsetY: 0,
        };
        CollisionWorld.instance?.register(this._collider);
    }

    onDestroy() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
        // 炮塔被摧毁或拆除后立即刷新电力UI
        BaseSystem.instance?.updatePowerStatus();
    }

    /** 拆除前从 CollisionWorld 注销碰撞体（DemolishManager 调用） */
    public unregisterCollider() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
    }

    update(dt: number) {
        if (this._attackSoundTimer > 0) {
            this._attackSoundTimer -= dt;
        }
        if (this.hp <= 0) {
            return;
        }

        // 血量文字：实时取整刷新 + 显隐控制（虚影/满血3秒）
        this.syncHpLabel(dt);

        // 断电检查：电力不足时完全停机（不搜索目标、不旋转、不发射）
        if (BaseSystem.instance?.isPowerOutage) {
            return;
        }

        this.lockedTarget = this.findClosestZombieInRange();

        // 平滑旋转炮口
        if (this.muzzleNode) {
            if (this.lockedTarget) {
                const turretPos = this.muzzleNode.worldPosition;
                const targetPos = this.lockedTarget.getHitWorldPosition();
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
        this.playAttackSound();

        if (this.hp <= 0) {
            this.playDestroySound();
            EnemyManager.invalidateCache();
            this.node.destroy();
        }
    }

    /** 播放被摧毁音效（距离衰减） */
    private playDestroySound() {
        if (!this._audioSource || !this.destroySound) return;
        const player = find('GameWorld/YSortLayer/Player');
        if (player) {
            const dist = Vec3.distance(this.node.worldPosition, player.worldPosition);
            if (dist >= this.destroySoundMaxDistance) return;
            const volume = 1 - (dist / this.destroySoundMaxDistance);
            this._audioSource.playOneShot(this.destroySound, volume);
        } else {
            this._audioSource.playOneShot(this.destroySound, 1);
        }
    }

    /** 播放受攻击音效（距离衰减，冷却时间由属性控制） */
    private playAttackSound() {
        if (this.attackSoundCooldown > 0 && this._attackSoundTimer > 0) return;
        if (!this._audioSource || !this.attackSound) return;
        const player = find('GameWorld/YSortLayer/Player');
        if (player) {
            const dist = Vec3.distance(this.node.worldPosition, player.worldPosition);
            if (dist >= this.attackSoundMaxDistance) return;
            const volume = 1 - (dist / this.attackSoundMaxDistance);
            this._audioSource.playOneShot(this.attackSound, volume);
        } else {
            this._audioSource.playOneShot(this.attackSound, 1);
        }
        this._attackSoundTimer = this.attackSoundCooldown;
    }

    private refreshHpLabel() {
        if (this.hpLabel) {
            // 取整：维修可能产生小数血量，只显示整数
            this.hpLabel.string = `${Math.round(this.hp)}/${Math.round(this.maxHp)}`;
        }
    }

    /** 实时同步血量文字并控制显隐（虚影隐藏 / 满血3秒后隐藏，与 HealthBar 一致） */
    private syncHpLabel(dt: number) {
        if (!this.hpLabel) return;

        // 放置虚影阶段：始终隐藏血量文字
        if (this.ghostPreview) {
            if (this.hpLabel.node.active) this.hpLabel.node.active = false;
            return;
        }

        // 实时刷新（取整），维修/受伤后及时更新
        const text = `${Math.round(this.hp)}/${Math.round(this.maxHp)}`;
        if (this.hpLabel.string !== text) {
            this.hpLabel.string = text;
        }

        if (this.hp < this.maxHp) {
            // 血不满：显示
            if (!this.hpLabel.node.active) this.hpLabel.node.active = true;
            this._hpLabelHideTimer = 0;
        } else if (this.hpLabel.node.active) {
            // 满血：3 秒后隐藏
            this._hpLabelHideTimer += dt;
            if (this._hpLabelHideTimer >= 3) {
                this.hpLabel.node.active = false;
            }
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
            const zombiePos = zombie.getHitWorldPosition();
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

        // 播放发射音效（距离衰减）
        this.getComponent(BulletSound)?.play();

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
        // 激光束：同一目标只保持一条光束，避免叠加
        // 先判断已有光束是否存活，存活则只切换目标，不再实例化新节点（避免闪现预制体短截）
        if (this._activeLaser?.node?.isValid) {
            this._activeLaser.updateTarget(target.node);
            return;
        }

        const bulletNode = instantiate(this.bulletPrefab!);
        const laser = bulletNode.getComponent(LaserBeam);
        if (laser) {
            const pos = new Vec3(x, y, 0);
            LaserBeam.attachToWorld(bulletNode, pos);
            laser.init(target.node, this.muzzleNode ?? null, pos, this.damage, this.node, this.attackRange);
            this._activeLaser = laser;
            return;
        }

        // 普通子弹：保持预制体原始缩放（曾用 setScale(0,0,1) 隐藏首帧默认角度，
        // 但依赖 Bullet.init 的 setTimeout 恢复缩放；该恢复已移除，置 0 会导致贴图子弹永久不可见）
        const pos = new Vec3(x, y, 0);
        Bullet.attachToWorld(bulletNode, pos);

        const bullet = bulletNode.getComponent(Bullet);
        if (bullet) {
            bullet.init(target.node, this.damage, this.node, this.homingBullet, this.piercingBullet);
        } else {
            warn('[Turret] 子弹预制体上未找到 Bullet 组件');
            bulletNode.destroy();
        }
    }
}
