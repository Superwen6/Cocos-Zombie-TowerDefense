import { _decorator, Component, UIOpacity } from 'cc';
import { CollisionWorld, Collider2D, ColliderGroup } from './CollisionWorld';

const { ccclass, property } = _decorator;

/**
 * 地图静态障碍物（树木、路灯、石头等）。
 * 功能：碰撞体注册、玩家遮挡时半透明效果
 */
@ccclass('MapObstacle')
export class MapObstacle extends Component {
    @property({ tooltip: '碰撞框半宽' })
    colliderHalfW = 30;

    @property({ tooltip: '碰撞框半高' })
    colliderHalfH = 30;

    @property({ tooltip: '玩家遮挡时，元素透明度 (0~255，越小越透明)' })
    semiTransparentOpacity = 100;

    @property({ tooltip: '触发半透明的距离阈值（世界坐标单位）' })
    triggerDistance = 80;

    private _collider: Collider2D | null = null;
    private _uiOpacity: UIOpacity | null = null;

    start() {
        const wp = this.node.worldPosition;
        this._collider = {
            node: this.node,
            x: wp.x, y: wp.y,
            halfW: this.colliderHalfW, halfH: this.colliderHalfH,
            group: ColliderGroup.Wall,
        };
        CollisionWorld.instance?.register(this._collider);

        // 确保 UIOpacity 组件存在
        this._uiOpacity = this.node.getComponent(UIOpacity);
        if (!this._uiOpacity) {
            this._uiOpacity = this.node.addComponent(UIOpacity);
        }
    }

    onDestroy() {
        if (this._collider) {
            CollisionWorld.instance?.unregister(this._collider);
            this._collider = null;
        }
    }

    /** 设置元素透明度（由 YSortManager 调用） */
    setOpacity(opacity: number) {
        if (this._uiOpacity) {
            this._uiOpacity.opacity = opacity;
        }
    }
}