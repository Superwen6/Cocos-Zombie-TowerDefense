import { _decorator, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 炮塔强化通知组件。
 * 挂载在 Canvas/ReinforcementLabel 节点上，默认隐藏。
 * 其他脚本通过静态方法 ReinforcementNotice.show(msg) 显示通知，3秒后自动隐藏。
 */
@ccclass('ReinforcementNotice')
export class ReinforcementNotice extends Component {
    private static _instance: ReinforcementNotice | null = null;
    private _label: Label | null = null;

    onLoad() {
        ReinforcementNotice._instance = this;
        this._label = this.node.getComponent(Label);
        this.node.active = false;
    }

    onDestroy() {
        if (ReinforcementNotice._instance === this) {
            ReinforcementNotice._instance = null;
        }
    }

    /**
     * 显示通知文本，默认显示3秒后自动隐藏。
     * @param msg 通知文本
     * @param duration 显示时长（秒），默认3秒
     */
    static show(msg: string, duration = 3) {
        const inst = ReinforcementNotice._instance;
        if (!inst || !inst._label) return;
        inst._label.string = msg;
        inst.node.active = true;
        inst.unscheduleAllCallbacks();
        inst.scheduleOnce(() => {
            if (inst.node?.isValid) {
                inst.node.active = false;
            }
        }, duration);
    }
}