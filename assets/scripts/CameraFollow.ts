import { _decorator, Camera, CCFloat, Component, EventMouse, find, input, Input, Node, screen, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CameraFollow')
export class CameraFollow extends Component {
    @property({ type: Node, tooltip: '跟随目标（Player/Body）' })
    target: Node = null!;

    @property({ tooltip: '延迟时间（秒）。0.1=几乎无延迟，0.3=平衡，0.5=明显滞后' })
    delayTime = 0.3;

    @property({ tooltip: '每次滚轮缩放步长' })
    zoomStep = 1.0;

    @property({ tooltip: '最小 orthoHeight（最近视野）' })
    minOrthoHeight = 5;

    @property({ tooltip: '最大 orthoHeight（最远视野）' })
    maxOrthoHeight = 50;

    @property({ tooltip: '缩放平滑速度（越大越快到位）' })
    zoomSmooth = 8;

    @property({ type: Node, tooltip: '坐标系参考节点（与ResourceSpawner一致）' })
    coordinateReference: Node | null = null;

    @property({ type: CCFloat, tooltip: '地图最小 X 坐标（相对于 CoordinateReference）' })
    mapMinX = -2310;

    @property({ type: CCFloat, tooltip: '地图最大 X 坐标（相对于 CoordinateReference）' })
    mapMaxX = 3760;

    @property({ type: CCFloat, tooltip: '地图最小 Y 坐标（相对于 CoordinateReference）' })
    mapMinY = -2710;

    @property({ type: CCFloat, tooltip: '地图最大 Y 坐标（相对于 CoordinateReference）' })
    mapMaxY = 3350;

    private _currentPos = new Vec3();
    private _targetPos = new Vec3();
    private _initialized = false;
    private _camera: Camera | null = null;
    private _targetOrthoHeight = 0;

    onLoad() {
        this._camera = this.node.getComponent(Camera);
        if (this._camera) {
            this._targetOrthoHeight = this._camera.orthoHeight;
        }
        input.on(Input.EventType.MOUSE_WHEEL, this._onMouseWheel, this);
    }

    onDestroy() {
        input.off(Input.EventType.MOUSE_WHEEL, this._onMouseWheel, this);
    }

    private _onMouseWheel(event: EventMouse) {
        if (!this._camera) return;
        const scrollY = event.getScrollY();
        // 滚轮向上（scrollY > 0）→ 拉近（orthoHeight 减小）
        // 滚轮向下（scrollY < 0）→ 拉远（orthoHeight 增大）
        this._targetOrthoHeight -= scrollY * 0.001 * this.zoomStep;
        this._targetOrthoHeight = Math.max(this.minOrthoHeight, Math.min(this.maxOrthoHeight, this._targetOrthoHeight));
    }

    update(dt: number) {
        if (!this.target || dt <= 0) return;

        // 平滑缩放 orthoHeight
        if (this._camera) {
            const factor = 1 - Math.exp(-this.zoomSmooth * dt);
            this._camera.orthoHeight += (this._targetOrthoHeight - this._camera.orthoHeight) * factor;
        }

        this.target.getWorldPosition(this._targetPos);
        this.node.getWorldPosition(this._currentPos);

        // 首帧直接对齐，避免从原点跳过来
        if (!this._initialized) {
            this._currentPos.set(this._targetPos);
            this.node.setWorldPosition(this._currentPos);
            this._initialized = true;
            return;
        }

        // 保持 z 轴不变
        const targetZ = this._currentPos.z;

        // 帧率无关的指数平滑
        const lerpFactor = 1 - Math.exp(-dt / this.delayTime);

        this._currentPos.x += (this._targetPos.x - this._currentPos.x) * lerpFactor;
        this._currentPos.y += (this._targetPos.y - this._currentPos.y) * lerpFactor;
        this._currentPos.z = targetZ;

        // 边界限制：确保相机视野不超出地图范围
        this._clampCameraToMap();

        this.node.setWorldPosition(this._currentPos);
    }

    /** 将相机位置 clamp 到地图边界内，防止显示黑色工作区 */
    private _clampCameraToMap() {
        if (!this._camera) return;

        const coordRef = this.coordinateReference ?? find('GameWorld/CoordinateReference');
        const refPos = coordRef?.worldPosition ?? Vec3.ZERO;
        const minWorldX = refPos.x + this.mapMinX;
        const maxWorldX = refPos.x + this.mapMaxX;
        const minWorldY = refPos.y + this.mapMinY;
        const maxWorldY = refPos.y + this.mapMaxY;

        const orthoHeight = this._camera.orthoHeight;
        const windowSize = screen.windowSize;
        const aspectRatio = windowSize.width / windowSize.height;
        const halfViewW = orthoHeight * aspectRatio;
        const halfViewH = orthoHeight;

        const mapW = maxWorldX - minWorldX;
        const mapH = maxWorldY - minWorldY;

        // 视口大于地图 → 居中；否则 → clamp 边缘
        if (halfViewW * 2 >= mapW) {
            this._currentPos.x = (minWorldX + maxWorldX) / 2;
        } else {
            this._currentPos.x = Math.max(minWorldX + halfViewW, Math.min(maxWorldX - halfViewW, this._currentPos.x));
        }

        if (halfViewH * 2 >= mapH) {
            this._currentPos.y = (minWorldY + maxWorldY) / 2;
        } else {
            this._currentPos.y = Math.max(minWorldY + halfViewH, Math.min(maxWorldY - halfViewH, this._currentPos.y));
        }
    }
}
