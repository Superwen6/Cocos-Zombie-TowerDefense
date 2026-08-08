import { _decorator, AudioClip, AudioSource, Component, Node, Sprite } from 'cc';
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

    @property({ type: AudioClip, tooltip: '采集木材音效' })
    woodSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '采集铁矿音效' })
    ironSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '采集铜矿音效' })
    copperSound: AudioClip | null = null;

    private _collider: Collider2D | null = null;
    private _audioSource: AudioSource | null = null;

    start() {
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x,
            y: wp.y,
            halfW: this.colliderHalfW,
            halfH: this.colliderHalfH,
            group: ColliderGroup.Resource,
            offsetY: 0,
        };
        CollisionWorld.instance?.register(this._collider);
        this._audioSource = this.node.addComponent(AudioSource);
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

        // 每次击打都播放对应资源音效
        const clip = this.getCollectSound();
        if (clip && this._audioSource) {
            this._audioSource.clip = clip;
            this._audioSource.play();
        }

        if (this.hp <= 0) {
            this.collectAndDestroy();
        }
    }

    private collectAndDestroy() {
        const ps = PlayerState.instance;
        const bonusYield = ps?.bonusYield ?? 0;
        const multiplier = ps?.getResourceCollectMultiplier(this.resourceType) ?? 1.0;
        const totalAmount = Math.round((this.baseAmount + bonusYield) * multiplier);

        if (PlayerData.instance) {
            PlayerData.instance.addResource(this.resourceType, totalAmount);
        }

        // 隐藏所有 Sprite 并延迟销毁，让音效有足够时间播放完毕
        const clip = this.getCollectSound();
        if (clip) {
            this.hideAllSprites(this.node);
            this.scheduleOnce(() => {
                if (this.node?.isValid) this.node.destroy();
            }, 0.5);
        } else {
            this.node.destroy();
        }
    }

    /** 获取当前资源类型对应的采集音效 */
    private getCollectSound(): AudioClip | null {
        switch (this.resourceType) {
            case 'wood':   return this.woodSound;
            case 'iron':   return this.ironSound;
            case 'copper': return this.copperSound;
            default:       return null;
        }
    }

    /** 递归隐藏节点及其子节点上的所有 Sprite */
    private hideAllSprites(node: Node) {
        const sprite = node.getComponent(Sprite);
        if (sprite) sprite.enabled = false;
        for (const child of node.children) {
            this.hideAllSprites(child);
        }
    }
}
