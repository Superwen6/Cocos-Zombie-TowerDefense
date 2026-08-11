import { _decorator, Component, Node, UITransform, Graphics, Vec2, Vec3, input, Input, EventTouch, view, Color } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 手机端虚拟摇杆（动态摇杆）。
 * - 触摸屏幕左半部分时，在触摸点出现摇杆，拖动控制移动方向。
 * - 松手后摇杆隐藏。
 * - 提供静态单例接口 getInstance().moveDir 供 PlayerController 读取。
 * - 纯代码创建，不依赖图集 SpriteFrame。
 */
@ccclass('VirtualJoystick')
export class VirtualJoystick extends Component {
    /** 摇杆半径（设计分辨率单位） */
    @property({ tooltip: '摇杆半径（px）' })
    radius = 90;

    @property({ tooltip: '摇杆杆可拖动的最大偏移（px）' })
    knobMaxOffset = 50;

    @property({ tooltip: '摇杆透明度（0-255）' })
    opacity = 160;

    private static _instance: VirtualJoystick | null = null;
    static get instance(): VirtualJoystick | null {
        return VirtualJoystick._instance;
    }

    private _bg: Node | null = null;
    private _knob: Node | null = null;
    private _bgGfx: Graphics | null = null;
    private _knobGfx: Graphics | null = null;

    /** 摇杆当前移动方向（归一化，屏幕右/上为正） */
    private _dir = new Vec2();
    /** 屏幕坐标下摇杆中心 */
    private _centerScreen = new Vec2();
    private _touchId: number | null = null;
    private _active = false;

    get moveDir(): Vec2 {
        return this._dir;
    }

    get isActive(): boolean {
        return this._active;
    }

    onLoad() {
        VirtualJoystick._instance = this;
        this._buildUI();
        this._active = false;

        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDestroy() {
        if (VirtualJoystick._instance === this) {
            VirtualJoystick._instance = null;
        }
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private _buildUI() {
        // 根节点 UITransform 覆盖全屏，用于坐标换算
        let ut = this.node.getComponent(UITransform);
        if (!ut) {
            ut = this.node.addComponent(UITransform);
        }
        ut.setContentSize(1280, 720);

        // 摇杆底
        this._bg = new Node('JoystickBG');
        const bgUt = this._bg.addComponent(UITransform);
        bgUt.setContentSize(this.radius * 2, this.radius * 2);
        this._bgGfx = this._bg.addComponent(Graphics);
        this._drawCircle(this._bgGfx, this.radius, true);
        this.node.addChild(this._bg);

        // 摇杆杆
        this._knob = new Node('JoystickKnob');
        const knobUt = this._knob.addComponent(UITransform);
        knobUt.setContentSize(this.knobMaxOffset * 2, this.knobMaxOffset * 2);
        this._knobGfx = this._knob.addComponent(Graphics);
        this._drawCircle(this._knobGfx, this.knobMaxOffset * 0.7, false);
        this.node.addChild(this._knob);

        this._bg.active = false;
        this._knob.active = false;
    }

    private _drawCircle(g: Graphics, radius: number, isBg: boolean) {
        if (!g) return;
        if (isBg) {
            g.fillColor = new Color(255, 255, 255, 40);
            g.circle(0, 0, radius);
            g.fill();
            g.lineWidth = 3;
            g.strokeColor = new Color(255, 255, 255, 120);
            g.circle(0, 0, radius);
            g.stroke();
        } else {
            g.fillColor = new Color(255, 255, 255, 190);
            g.circle(0, 0, radius);
            g.fill();
        }
    }

    private onTouchStart(event: EventTouch) {
        // 只在左半屏生成摇杆
        const loc = event.getLocation();
        const size = view.getVisibleSize();
        if (loc.x > size.width * 0.5) {
            return;
        }
        // 多点触控：只响应第一个
        if (this._touchId !== null) {
            return;
        }
        this._touchId = event.getID();
        this._centerScreen.set(loc.x, loc.y);
        this._dir.set(0, 0);
        this._active = true;

        // 把摇杆移到触摸点（屏幕坐标 -> UI 坐标）
        this._bg.active = true;
        this._knob.active = true;
        this._bg.setPosition(this.screenToUIPos(loc.x, loc.y));
        this._knob.setPosition(this._bg.position);
    }

    private onTouchMove(event: EventTouch) {
        if (event.getID() !== this._touchId) return;
        const loc = event.getLocation();
        let dx = loc.x - this._centerScreen.x;
        let dy = loc.y - this._centerScreen.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > this.knobMaxOffset) {
            dx = dx / len * this.knobMaxOffset;
            dy = dy / len * this.knobMaxOffset;
        }
        if (this._knob) {
            const uiPos = this.screenToUIPos(this._centerScreen.x + dx, this._centerScreen.y + dy);
            this._knob.setPosition(uiPos.x, uiPos.y);
        }
        // 方向：按摇杆实际偏移 / 最大偏移，得到 0~1 强度
        const normLen = Math.min(1, len / this.knobMaxOffset);
        this._dir.set(dx / this.knobMaxOffset, dy / this.knobMaxOffset);
        if (this._dir.lengthSqr() > 1) this._dir.normalize();
        this._dir.multiplyScalar(normLen);
    }

    private onTouchEnd(event: EventTouch) {
        if (event.getID() !== this._touchId) return;
        this._touchId = null;
        this._active = false;
        this._dir.set(0, 0);
        if (this._bg) this._bg.active = false;
        if (this._knob) this._knob.active = false;
    }

    /** 屏幕坐标转 UI 坐标（基于本组件所在 Canvas） */
    private screenToUIPos(sx: number, sy: number): Vec3 {
        const canvas = this.node;
        const ut = canvas.getComponent(UITransform);
        const canvasSize = ut ? new Vec2(ut.width, ut.height) : new Vec2(1280, 720);
        const visibleSize = view.getVisibleSize();
        // UI 坐标：以节点锚点(0.5)为中心
        const x = sx / visibleSize.width * canvasSize.x - canvasSize.x / 2;
        const y = sy / visibleSize.height * canvasSize.y - canvasSize.y / 2;
        return new Vec3(x, y, 0);
    }
}
