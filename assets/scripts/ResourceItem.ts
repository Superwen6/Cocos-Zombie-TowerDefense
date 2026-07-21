import { _decorator, assetManager, AudioClip, AudioSource, Component } from 'cc';
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

    // 木材采集音效（静态共享，避免重复加载）
    private static _woodAudioClip: AudioClip | null = null;
    private static _woodAudioLoaded = false;

    start() {
        ResourceItem.loadWoodAudio();

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

    /** 加载木材采集音效（仅第一次调用时加载） */
    private static loadWoodAudio() {
        if (ResourceItem._woodAudioLoaded) return;
        ResourceItem._woodAudioLoaded = true;
        assetManager.loadAny(
            { uuid: '65aeade2-399e-4601-9b5a-d948617e29e2' },
            (_err, asset) => {
                if (asset instanceof AudioClip) {
                    ResourceItem._woodAudioClip = asset;
                }
            },
        );
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

        // 采集木材时播放音效
        if (this.resourceType === 'wood' && ResourceItem._woodAudioClip) {
            AudioSource.playOneShot(ResourceItem._woodAudioClip, 1);
        }

        this.node.destroy();
    }
}
