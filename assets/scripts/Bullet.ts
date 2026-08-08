import { _decorator, Component, director, Node, UITransform, Vec3 } from 'cc';
import { ZombieMove } from './ZombieMove';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';
import { PlayerState } from './PlayerState';
import { EnemyManager } from './EnemyManager';
import { BaseSystem } from './BaseSystem';
import { Container } from './Container';
import { PlantGenerator } from './PlantGenerator';
import { Turret } from './Turret';

const { ccclass, property } = _decorator;

const HIT_RADIUS = 30;

@ccclass('Bullet')
export class Bullet extends Component {
    @property({ tooltip: '子弹飞行速度（像素/秒）' })
    speed = 400;

    @property({ tooltip: '子弹存活时间（秒）' })
    lifetime = 3;

    /** 是否为 Boss2 弹幕（无目标模式下命中玩家并造成伤害） */
    hitPlayer = false;

    private _targetZombie: ZombieMove | null = null;
    private _targetNode: Node | null = null;
    private _attackerNode: Node | null = null;
    private _damage = 0;
    private _lifetime = 0;
    private _homing = true;
    private _piercing = false;
    /** 缓存池归属（Boss2 弹幕复用，其余为 null 直接销毁） */
    private _poolOwner: ZombieMove | null = null;
    private readonly _hitZombies = new Set<ZombieMove>();
    private readonly _tempVec = new Vec3();
    private readonly _zombiePos = new Vec3();
    private readonly _initialDir = new Vec3();

    static attachToWorld(
        bulletNode: Node,
        worldPos: Vec3,
    ) {
        // 将子弹挂载到 GameWorld 节点下，避免跟随玩家移动
        // 注意：instantiate 出来的节点 scene 为 null，需要从场景获取
        const gameWorld = bulletNode.scene?.getChildByName('GameWorld')
            ?? director.getScene()?.getChildByName('GameWorld');
        if (gameWorld) {
            bulletNode.setParent(gameWorld);
            // 确保子弹 Layer 与 GameWorld 一致（默认层）
            bulletNode.layer = gameWorld.layer;
        }
        bulletNode.setWorldPosition(worldPos);
        if (gameWorld) {
            bulletNode.setSiblingIndex(gameWorld.children.length - 1);
        }
    }

    init(targetNode: Node | null, damage: number, attackerNode?: Node, homing = true, piercing = false) {
        this._targetNode = targetNode;
        this._targetZombie = targetNode?.getComponent(ZombieMove) ?? null;
        this._attackerNode = attackerNode ?? null;
        this._poolOwner = attackerNode?.getComponent(ZombieMove) ?? null;
        this._damage = damage;
        this._lifetime = 0;
        this._homing = homing;
        this._piercing = piercing;
        this._hitZombies.clear();

        // 非跟踪模式且有目标：记录初始发射方向（指向目标命中中心而非节点脚部，
        // 否则带 colliderOffsetY 的僵尸（贴图锚点在脚部）直线子弹永远从脚下穿过打不中）
        if (!this._homing && targetNode) {
            if (this._targetZombie) {
                this._targetZombie.getHitWorldPosition(this._tempVec);
            } else {
                targetNode.getWorldPosition(this._tempVec);
            }
            const bulletWP = this.node.worldPosition;
            this._initialDir.set(
                this._tempVec.x - bulletWP.x,
                this._tempVec.y - bulletWP.y,
                0,
            );
            this._initialDir.normalize();
        }
    }

    /** 设置子弹飞行方向（不依赖目标节点，用于玩家武器） */
    setDirection(dir: Vec3) {
        this._initialDir.set(dir);
        this._initialDir.normalize();
    }

    /** 销毁或回收子弹（Boss2 弹幕走缓存池，其余直接销毁） */
    despawn() {
        if (!this.node?.isValid) return;
        const poolOwner = this._poolOwner && this._poolOwner.node?.isValid ? this._poolOwner : null;
        if (poolOwner) {
            poolOwner.recycleBoss2Bullet(this);
        } else {
            this.node.destroy();
        }
    }

    update(dt: number) {
        this._lifetime += dt;
        if (this._lifetime >= this.lifetime) {
            this.despawn();
            return;
        }

        this.bringToFront();

        const bulletWP = this.node.worldPosition.clone();
        let dir: Vec3;

        if (this._homing && this._targetNode?.isValid) {
            // 跟踪模式：每帧重新计算指向目标的方向
            if (this._targetZombie) {
                this._targetZombie.getHitWorldPosition(this._tempVec);
            } else {
                this._targetNode.getWorldPosition(this._tempVec);
            }
            dir = this._tempVec.clone().subtract(bulletWP);
            const dist = dir.length();
            dir.normalize();
            if (dist < HIT_RADIUS) {
                this.dealDamageToTarget();
                if (this._piercing) {
                    // 穿透：目标已命中，继续沿当前方向飞行
                    this._targetNode = null;
                    this._targetZombie = null;
                    this._initialDir.set(dir);
                } else {
                    this.despawn();
                    return;
                }
            }
        } else if (this._targetNode?.isValid) {
            // 非跟踪模式 + 有目标：沿初始方向直线飞行，检测与目标距离
            dir = this._initialDir.clone();
            if (this._targetZombie) {
                this._targetZombie.getHitWorldPosition(this._tempVec);
            } else {
                this._targetNode.getWorldPosition(this._tempVec);
            }
            const dist = Vec3.distance(bulletWP, this._tempVec);
            if (dist < HIT_RADIUS) {
                this.dealDamageToTarget();
                if (this._piercing) {
                    // 穿透：目标已命中，继续沿初始方向飞行
                    this._targetNode = null;
                    this._targetZombie = null;
                } else {
                    this.despawn();
                    return;
                }
            }
        } else {
            // 无目标模式：沿初始方向飞行，仅靠碰撞检测
            dir = this._initialDir.clone();
            // Boss2 弹幕：检测命中玩家
            if (this.hitPlayer) {
                const player = PlayerState.instance;
                if (player && player.isAlive && player.node?.isValid) {
                    const playerPos = player.node.worldPosition;
                    if (Vec3.distance(bulletWP, playerPos) < HIT_RADIUS) {
                        player.takeDamage(this._damage);
                        this.despawn();
                        return;
                    }
                }
            }
        }

        const step = this.speed * dt;
        const nextX = bulletWP.x + dir.x * step;
        const nextY = bulletWP.y + dir.y * step;

        // 检测墙体碰撞（子弹碰撞体半宽半高设为 3x3）
        const hit = CollisionWorld.instance?.checkHit(nextX, nextY, 3, 3, [ColliderGroup.Wall]);
        if (hit) {
            // 撞到墙体，销毁子弹
            this.despawn();
            return;
        }

        this.node.setWorldPosition(nextX, nextY, 0);

        // Boss2 弹幕：检测命中炮塔/建筑/基地（命中即消耗子弹）
        if (this.hitPlayer && this.checkStructureHits()) {
            return;
        }

        // 弹头始终指向飞行方向：精灵贴图默认朝上，需要旋转 -90° 对齐 x 轴正方向
        const angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI - 90;
        this.node.eulerAngles = new Vec3(0, 0, angle);

        this.checkPenetrationHits();
    }

    /** Boss2 弹幕命中玩家建筑/基地检测（命中即消耗子弹） */
    private checkStructureHits(): boolean {
        const pos = this.node.worldPosition;
        const x = pos.x;
        const y = pos.y;

        for (const turretNode of EnemyManager.getCachedTurrets()) {
            if (!turretNode?.isValid) continue;
            if (this.distToRect(x, y, turretNode) < HIT_RADIUS) {
                turretNode.getComponent(Turret)?.takeDamage(this._damage);
                this.despawn();
                return true;
            }
        }

        for (const buildingNode of EnemyManager.getCachedBuildings()) {
            if (!buildingNode?.isValid) continue;
            if (this.distToRect(x, y, buildingNode) < HIT_RADIUS) {
                const comp = buildingNode.getComponent(Container) ?? buildingNode.getComponent(PlantGenerator);
                comp?.takeDamage(this._damage);
                this.despawn();
                return true;
            }
        }

        const base = BaseSystem.instance;
        if (base?.node?.isValid) {
            const basePos = base.node.worldPosition;
            if (Math.abs(x - basePos.x) <= base.baseHalfW && Math.abs(y - basePos.y) <= base.baseHalfH) {
                base.damageBase(this._damage);
                this.despawn();
                return true;
            }
        }
        return false;
    }

    /** 计算点与节点矩形包围盒的最近距离 */
    private distToRect(x: number, y: number, node: Node): number {
        const ui = node.getComponent(UITransform);
        const halfW = ui ? ui.width * 0.5 : 30;
        const halfH = ui ? ui.height * 0.5 : 30;
        const pos = node.worldPosition;
        const cx = Math.max(pos.x - halfW, Math.min(x, pos.x + halfW));
        const cy = Math.max(pos.y - halfH, Math.min(y, pos.y + halfH));
        return Math.hypot(x - cx, y - cy);
    }

    private checkPenetrationHits() {
        // Boss2 弹幕（hitPlayer 模式）：仅命中玩家，不误伤其他僵尸
        if (this.hitPlayer) return;

        const scene = this.node.scene;
        if (!scene) return;

        const zombies: ZombieMove[] = [];
        this.collectZombies(scene, zombies);

        for (const zombie of zombies) {
            if (zombie === this._targetZombie) continue;
            if (this._hitZombies.has(zombie)) continue;
            if (!zombie.node.isValid || zombie.isDead || zombie.hp <= 0) continue;

            zombie.getHitWorldPosition(this._zombiePos);
            const d = Vec3.distance(this.node.worldPosition, this._zombiePos);
            if (d < HIT_RADIUS) {
                this._hitZombies.add(zombie);
                zombie.takeDamage(this._damage, this._attackerNode ?? undefined);
            }
        }
    }

    private dealDamageToTarget() {
        if (this._targetZombie?.isValid && !this._targetZombie.isDead) {
            this._targetZombie.takeDamage(this._damage, this._attackerNode ?? undefined);
        }
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

    private bringToFront() {
        const parent = this.node.parent;
        if (parent?.isValid) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }
    }
}
