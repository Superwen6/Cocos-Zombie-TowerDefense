import { _decorator, Component, log } from 'cc';
import { PlayerData, ResourceType } from './PlayerData';
import { PlayerState } from './PlayerState';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

@ccclass('ResourceItem')
export class ResourceItem extends Component {
    @property({ tooltip: '资源类型：iron | wood | copper' })
    resourceType: ResourceType = 'wood';

    @property({ tooltip: '基础产出数量（每次采集结算）' })
    baseAmount = 2;

    @property({ tooltip: '耐久度，需击打次数' })
    hp = 3;

    @property({ tooltip: '碰撞框半宽（碰撞体总宽度 = 此值 × 2）' })
    colliderHalfW = 20;

    @property({ tooltip: '碰撞框半高（碰撞体总高度 = 此值 × 2）' })
    colliderHalfH = 20;

    private _collider: Collider2D | null = null;

    start() {
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x,
            y: wp.y,
            halfW: this.colliderHalfW,
            halfH: this.colliderHalfH,
            group: ColliderGroup.Resource,
        };
        CollisionWorld.instance?.register(this._collider);
    }

    onDestroy() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
    }

    hit() {
        if (this.hp <= 0) {
            return;
        }

        this.hp -= 1;
        log(`[ResourceItem] 击打 ${this.resourceType}，剩余耐久 ${this.hp}`);

        if (this.hp <= 0) {
            this.collectAndDestroy();
        }
    }

    private collectAndDestroy() {
        const bonusYield = PlayerState.instance?.bonusYield ?? 0;
        const totalAmount = this.baseAmount + bonusYield;

        if (PlayerData.instance) {
            PlayerData.instance.addResource(this.resourceType, totalAmount);
        }

        this.node.destroy();
    }
}
