import { _decorator, AudioClip, AudioSource, Button, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ButtonSound')
export class ButtonSound extends Component {
    @property({ type: AudioClip, tooltip: '按钮点击音效' })
    clickSound: AudioClip | null = null;

    private _audioSource: AudioSource | null = null;

    onLoad() {
        this._audioSource = this.node.addComponent(AudioSource);
    }

    start() {
        this._bindAllButtons();
    }

    /** 递归绑定当前节点及所有子节点上的 Button 点击事件 */
    private _bindAllButtons() {
        this._bindButton(this.node);
        for (const child of this.node.children) {
            this._bindButtonRecursive(child);
        }
    }

    private _bindButtonRecursive(node: Node) {
        this._bindButton(node);
        for (const child of node.children) {
            this._bindButtonRecursive(child);
        }
    }

    private _bindButton(node: Node) {
        const btn = node.getComponent(Button);
        if (!btn) return;
        node.on(Node.EventType.TOUCH_END, this.play, this);
    }

    /** 播放按钮点击音效 */
    play() {
        if (this.clickSound && this._audioSource) {
            this._audioSource.playOneShot(this.clickSound, 1);
        }
    }
}