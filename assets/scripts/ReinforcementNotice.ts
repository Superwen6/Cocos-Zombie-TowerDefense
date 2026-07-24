import { _decorator, AudioClip, AudioSource, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 炮塔强化通知组件。
 * 挂载在 Canvas/ReinforcementLabel 节点上，默认隐藏。
 * 其他脚本通过静态方法 ReinforcementNotice.show(msg) 显示通知，默认5秒后自动隐藏。
 */
@ccclass('ReinforcementNotice')
export class ReinforcementNotice extends Component {
    private static _instance: ReinforcementNotice | null = null;
    private _label: Label | null = null;
    private _audioSource: AudioSource | null = null;

    @property({ type: AudioClip, tooltip: '弹出提示音效' })
    popSound: AudioClip | null = null;

    onLoad() {
        ReinforcementNotice._instance = this;
        this._label = this.node.getComponent(Label);
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
        this.node.active = false;
    }

    onDestroy() {
        if (ReinforcementNotice._instance === this) {
            ReinforcementNotice._instance = null;
        }
    }

    /**
     * 显示通知文本，默认显示5秒后自动隐藏。
     * @param msg 通知文本
     * @param duration 显示时长（秒），默认5秒
     */
    static show(msg: string, duration = 5) {
        const inst = ReinforcementNotice._instance;
        if (!inst || !inst._label) return;
        inst._label.string = msg;
        inst.node.active = true;
        // 播放弹出音效
        if (inst._audioSource && inst.popSound) {
            inst._audioSource.playOneShot(inst.popSound, 1);
        }
        inst.unscheduleAllCallbacks();
        inst.scheduleOnce(() => {
            if (inst.node?.isValid) {
                inst.node.active = false;
            }
        }, duration);
    }
}