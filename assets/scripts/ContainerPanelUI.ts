import {
    _decorator, Button, Component, input, Input, EventKeyboard, KeyCode, Label, Node, Vec3, warn,
} from 'cc';
import { Container } from './Container';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { PlayerData } from './PlayerData';
import { PlayerController } from './PlayerController';

const { ccclass, property } = _decorator;

/** 交互检测距离（像素） */
const INTERACT_DISTANCE = 80;

/**
 * 集装箱交互面板 UI。
 * 玩家走到集装箱附近按 E 键打开面板，可存取资源。
 * 挂载在 Canvas 下。
 */
@ccclass('ContainerPanelUI')
export class ContainerPanelUI extends Component {
    @property({ type: Node, tooltip: '面板根节点（控制显示/隐藏）' })
    panelRoot: Node | null = null;

    @property({ type: Label, tooltip: '提示文本（"按 E 互动"）' })
    hintLabel: Label | null = null;

    @property({ type: Label, tooltip: '木材库存显示' })
    woodLabel: Label | null = null;

    @property({ type: Label, tooltip: '铜矿库存显示' })
    copperLabel: Label | null = null;

    @property({ type: Label, tooltip: '铁矿库存显示' })
    ironLabel: Label | null = null;

    // 存取按钮
    @property({ type: Button, tooltip: '木材存入按钮（-）' })
    woodDepositBtn: Button | null = null;

    @property({ type: Button, tooltip: '木材取出按钮（+）' })
    woodWithdrawBtn: Button | null = null;

    @property({ type: Button, tooltip: '铜矿存入按钮（-）' })
    copperDepositBtn: Button | null = null;

    @property({ type: Button, tooltip: '铜矿取出按钮（+）' })
    copperWithdrawBtn: Button | null = null;

    @property({ type: Button, tooltip: '铁矿存入按钮（-）' })
    ironDepositBtn: Button | null = null;

    @property({ type: Button, tooltip: '铁矿取出按钮（+）' })
    ironWithdrawBtn: Button | null = null;

    @property({ type: Button, tooltip: '关闭面板按钮' })
    closeBtn: Button | null = null;

    @property({ type: Node, tooltip: '玩家节点（用于距离检测）' })
    playerNode: Node | null = null;

    /** 当前交互的集装箱 */
    private _currentContainer: Container | null = null;
    /** 面板是否打开 */
    private _isOpen = false;

    start() {
        this.hideAll();
        this.bindButtons();
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    update(_dt: number) {
        if (this._isOpen) return;

        const container = this.findNearbyContainer();
        if (container) {
            this._currentContainer = container;
            this.showHint();
        } else {
            this._currentContainer = null;
            this.hideHint();
        }
    }

    private bindButtons() {
        this.bindBtn(this.woodDepositBtn, () => this.deposit('wood'));
        this.bindBtn(this.woodWithdrawBtn, () => this.withdraw('wood'));
        this.bindBtn(this.copperDepositBtn, () => this.deposit('copper'));
        this.bindBtn(this.copperWithdrawBtn, () => this.withdraw('copper'));
        this.bindBtn(this.ironDepositBtn, () => this.deposit('iron'));
        this.bindBtn(this.ironWithdrawBtn, () => this.withdraw('iron'));
        this.bindBtn(this.closeBtn, () => this.closePanel());
    }

    private bindBtn(btn: Button | null, handler: () => void) {
        if (!btn) return;
        btn.node.on(Button.EventType.CLICK, handler, this);
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_E) {
            if (this._isOpen) {
                this.closePanel();
            } else if (this._currentContainer) {
                this.openPanel();
            }
        }
        if (event.keyCode === KeyCode.ESCAPE && this._isOpen) {
            this.closePanel();
        }
    }

    /** 查找玩家附近的集装箱 */
    private findNearbyContainer(): Container | null {
        const player = this.playerNode ?? this.node.scene?.getChildByName('Player');
        if (!player) return null;

        const playerPos = player.worldPosition;
        const storage = GlobalContainerStorage.instance;
        if (!storage) return null;

        // 遍历场景中所有 Container 组件
        const scene = this.node.scene;
        if (!scene) return null;

        const containers = scene.getComponentsInChildren(Container);
        let closest: Container | null = null;
        let minDist = Number.MAX_VALUE;

        for (const c of containers) {
            if (!c || !c.isValid || !c.isPlaced || c.hp <= 0) continue;
            const dist = Vec3.distance(playerPos, c.node.worldPosition);
            if (dist < INTERACT_DISTANCE && dist < minDist) {
                minDist = dist;
                closest = c;
            }
        }

        return closest;
    }

    private showHint() {
        if (this.hintLabel) {
            this.hintLabel.node.active = true;
            this.hintLabel.string = '按 E 互动';
        }
    }

    private hideHint() {
        if (this.hintLabel) {
            this.hintLabel.node.active = false;
        }
    }

    private openPanel() {
        this._isOpen = true;
        if (this.panelRoot) this.panelRoot.active = true;
        this.hideHint();
        this.refreshPanel();
    }

    private closePanel() {
        this._isOpen = false;
        if (this.panelRoot) this.panelRoot.active = false;
    }

    private hideAll() {
        this._isOpen = false;
        this.hideHint();
        if (this.panelRoot) this.panelRoot.active = false;
    }

    /** 刷新面板显示 */
    private refreshPanel() {
        const storage = GlobalContainerStorage.instance;
        if (!storage) return;

        if (this.woodLabel) {
            this.woodLabel.string = `木材: ${storage.storedWood} / ${storage.maxWood}`;
        }
        if (this.copperLabel) {
            this.copperLabel.string = `铜矿: ${storage.storedCopper} / ${storage.maxCopper}`;
        }
        if (this.ironLabel) {
            this.ironLabel.string = `铁矿: ${storage.storedIron} / ${storage.maxIron}`;
        }
    }

    /** 存入资源（从玩家背包转到仓库） */
    private deposit(type: 'wood' | 'copper' | 'iron') {
        const storage = GlobalContainerStorage.instance;
        const data = PlayerData.instance;
        if (!storage || !data) return;

        switch (type) {
            case 'wood':
                if (data.woodCount <= 0) return;
                if (storage.storedWood >= storage.maxWood) return;
                data.woodCount--;
                storage.storedWood++;
                break;
            case 'copper':
                if (data.copperCount <= 0) return;
                if (storage.storedCopper >= storage.maxCopper) return;
                data.copperCount--;
                storage.storedCopper++;
                break;
            case 'iron':
                if (data.ironCount <= 0) return;
                if (storage.storedIron >= storage.maxIron) return;
                data.ironCount--;
                storage.storedIron++;
                break;
        }
        this.refreshPanel();
    }

    /** 取出资源（从仓库转到玩家背包，不超过携带上限） */
    private withdraw(type: 'wood' | 'copper' | 'iron') {
        const storage = GlobalContainerStorage.instance;
        const data = PlayerData.instance;
        if (!storage || !data) return;

        switch (type) {
            case 'wood':
                if (storage.storedWood <= 0) return;
                if (data.woodCount >= data.maxWood) return;
                storage.storedWood--;
                data.woodCount++;
                break;
            case 'copper':
                if (storage.storedCopper <= 0) return;
                if (data.copperCount >= data.maxCopper) return;
                storage.storedCopper--;
                data.copperCount++;
                break;
            case 'iron':
                if (storage.storedIron <= 0) return;
                if (data.ironCount >= data.maxIron) return;
                storage.storedIron--;
                data.ironCount++;
                break;
        }
        this.refreshPanel();
    }
}