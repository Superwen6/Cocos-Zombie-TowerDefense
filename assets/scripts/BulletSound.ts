import { _decorator, AudioClip, AudioSource, Component } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 子弹发射音效组件，挂载到任意子弹预制体上即可。
 * 子弹实例化时自动播放 fireSound，无需手动调用。
 */
@ccclass('BulletSound')
export class BulletSound extends Component {
    @property({ type: AudioClip, tooltip: '子弹发射音效' })
    fireSound: AudioClip | null = null;

    private _audioSource: AudioSource | null = null;

    onLoad() {
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
    }

    start() {
        if (!this._audioSource || !this.fireSound) return;
        this._audioSource.playOneShot(this.fireSound, 1);
    }
}