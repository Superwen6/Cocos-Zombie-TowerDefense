import { _decorator, Component, director, Node, Vec3 } from 'cc';
import { ZombieMove } from './ZombieMove';
import { CollisionWorld, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

const HIT_RADIUS = 30;

@ccclass('Bullet')
export class Bullet extends Component {
    @property({ tooltip: '子弹飞行速度（像素/秒）' })
    speed = 400;

    @property({ tooltip: '子弹存活时间（秒）' })
    lifetime = 3;

    private _targetZombie: ZombieMove | null = null;
    private _targetNode: Node | null = null;
    private _damage = 0;
    private _lifetime = 0;
    private readonly _hitZombies = new Set<ZombieMove>();
    private readonly _tempVec = new Vec3();
    private readonly _zombiePos = new Vec3();

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

    init(targetNode: Node, damage: number) {
        this._targetNode = targetNode;
        this._targetZombie = targetNode.getComponent(ZombieMove);
        this._damage = damage;
        this._lifetime = 0;
        this._hitZombies.clear();
        // 延迟一帧恢复缩放，避免显示预制体默认角度
        setTimeout(() => {
            if (this.node?.isValid) {
                this.node.setScale(1, 1, 1);
            }
        }, 16);
    }

    update(dt: number) {
        this._lifetime += dt;
        if (this._lifetime >= this.lifetime) {
            this.node.destroy();
            return;
        }

        this.bringToFront();

        if (!this._targetNode?.isValid) {
            this.node.destroy();
            return;
        }

        this._targetNode.getWorldPosition(this._tempVec);
        const bulletWP = this.node.worldPosition.clone();
        const dir = this._tempVec.clone().subtract(bulletWP);
        const dist = dir.length();

        if (dist < HIT_RADIUS) {
            this.dealDamageToTarget();
            this.node.destroy();
            return;
        }

        dir.normalize();
        const step = this.speed * dt;
        const nextX = bulletWP.x + dir.x * step;
        const nextY = bulletWP.y + dir.y * step;

        // 检测墙体碰撞（子弹碰撞体半宽半高设为 3x3）
        const hit = CollisionWorld.instance?.checkHit(nextX, nextY, 3, 3, [ColliderGroup.Wall]);
        if (hit) {
            // 撞到墙体，销毁子弹
            this.node.destroy();
            return;
        }

        this.node.setWorldPosition(nextX, nextY, 0);

        // 弹头始终指向目标：精灵贴图默认朝上，需要旋转 -90° 对齐 x 轴正方向
        const angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI - 90;
        this.node.eulerAngles = new Vec3(0, 0, angle);

        this.checkPenetrationHits();
    }

    private checkPenetrationHits() {
        const scene = this.node.scene;
        if (!scene) return;

        const zombies: ZombieMove[] = [];
        this.collectZombies(scene, zombies);

        for (const zombie of zombies) {
            if (zombie === this._targetZombie) continue;
            if (this._hitZombies.has(zombie)) continue;
            if (!zombie.node.isValid || zombie.isDead || zombie.hp <= 0) continue;

            zombie.node.getWorldPosition(this._zombiePos);
            const d = Vec3.distance(this.node.worldPosition, this._zombiePos);
            if (d < HIT_RADIUS) {
                this._hitZombies.add(zombie);
                zombie.takeDamage(this._damage);
            }
        }
    }

    private dealDamageToTarget() {
        if (this._targetZombie?.isValid && !this._targetZombie.isDead) {
            this._targetZombie.takeDamage(this._damage);
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
