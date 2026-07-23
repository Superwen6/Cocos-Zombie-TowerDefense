import { _decorator, AudioClip, AudioSource, CCFloat, Component, find, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 子弹发射音效组件，挂载到任意子弹预制体上即可。
 * 子弹实例化时自动播放 fireSound，根据与玩家距离衰减音量。
 */
@ccclass('BulletSound')
export class BulletSound extends Component {
    @property({ type: AudioClip, tooltip: '子弹发射音效' })
    fireSound: AudioClip | null = null;

    @property({ type: CCFloat, tooltip: '最大可听距离（像素），超出此距离不播放' })
    maxDistance = 800;

    private _audioSource: AudioSource | null = null;

    onLoad() {
        this._audioSource = this.node.addComponent(AudioSource);
        this._audioSource.loop = false;
    }

    start() {
        if (!this._audioSource || !this.fireSound) return;

        // 查找玩家节点获取位置（Player 在 GameWorld/YSortLayer 下）
        const playerNode = find('GameWorld/YSortLayer/Player');
        if (!playerNode) {
            return;
        }

        const dist = Vec3.distance(this.node.worldPosition, playerNode.worldPosition);
        if (dist >= this.maxDistance) return;

        // 距离越近音量越高：0距离时volume=1，maxDistance时volume=0
        const volume = 1 - dist / this.maxDistance;
        this._audioSource.playOneShot(this.fireSound, Math.max(0, volume));
    }
}