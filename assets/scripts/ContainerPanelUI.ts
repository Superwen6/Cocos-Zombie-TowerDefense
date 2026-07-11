import {
    _decorator, Button, Component, Label, Node, Sprite,
} from 'cc';
import { Container } from './Container';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { PlayerData } from './PlayerData';

const { ccclass, property } = _decorator;

type ResourceType = 'wood' | 'copper' | 'iron';

/**
 * 集装箱交互面板 UI。
 * 双击集装箱实体打开面板，可存取资源。
 * 挂载在 Canvas 下。
 */
@ccclass('ContainerPanelUI')
export class ContainerPanelUI extends Component {
    @property({ type: Node, tooltip: '面板根节点（控制显示/隐藏）' })
    panelRoot: Node | null = null;

    @property({ type: Label, tooltip: '提示文本（已废弃，双击进入）' })
    hintLabel: Label | null = null;

    // 资源图标（Sprite）
    @property({ type: Sprite, tooltip: '木材图标' })
    woodIcon: Sprite | null = null;

    @property({ type: Sprite, tooltip: '铜矿图标' })
    copperIcon: Sprite | null = null;

    @property({ type: Sprite, tooltip: '铁矿图标' })
    ironIcon: Sprite | null = null;

    // 资源数量显示（Label，格式 "0 / 100"）
    @property({ type: Label, tooltip: '木材数量显示' })
    woodLabel: Label | null = null;

    @property({ type: Label, tooltip: '铜矿数量显示' })
    copperLabel: Label | null = null;

    @property({ type: Label, tooltip: '铁矿数量显示' })
    ironLabel: Label | null = null;

    // 存取按钮（1个）
    @property({ type: Button, tooltip: '木材存入按钮（-1）' })
    woodDepositBtn: Button | null = null;

    @property({ type: Button, tooltip: '木材取出按钮（+1）' })
    woodWithdrawBtn: Button | null = null;

    @property({ type: Button, tooltip: '铜矿存入按钮（-1）' })
    copperDepositBtn: Button | null = null;

    @property({ type: Button, tooltip: '铜矿取出按钮（+1）' })
    copperWithdrawBtn: Button | null = null;

    @property({ type: Button, tooltip: '铁矿存入按钮（-1）' })
    ironDepositBtn: Button | null = null;

    @property({ type: Button, tooltip: '铁矿取出按钮（+1）' })
    ironWithdrawBtn: Button | null = null;

    @property({ type: Button, tooltip: '关闭面板按钮' })
    closeBtn: Button | null = null;

    /** 当前交互的集装箱 */
    private _currentContainer: Container | null = null;
    /** 面板是否打开 */
    private _isOpen = false;

    start() {
        this.hideAll();
        this.bindButtons();
    }

    onDestroy() {}

    private bindButtons() {
        // 1个存取按钮（代码绑定）
        this.bindBtn(this.woodDepositBtn, () => this.depositBulk('wood', 1));
        this.bindBtn(this.woodWithdrawBtn, () => this.withdrawBulk('wood', 1));
        this.bindBtn(this.copperDepositBtn, () => this.depositBulk('copper', 1));
        this.bindBtn(this.copperWithdrawBtn, () => this.withdrawBulk('copper', 1));
        this.bindBtn(this.ironDepositBtn, () => this.depositBulk('iron', 1));
        this.bindBtn(this.ironWithdrawBtn, () => this.withdrawBulk('iron', 1));
        this.bindBtn(this.closeBtn, () => this.closePanel());
        // 注意：deposit-001 (5个)、deposit-002 (10个)、withdraw-001 (5个)、withdraw-002 (10个)
        // 这些按钮需要在编辑器中手动绑定 Click Events 到对应的 onDepositXxx / onWithdrawXxx 方法，
        // 并在 CustomEventData 中填入 "5" 或 "10"。
    }

    private bindBtn(btn: Button | null, handler: () => void) {
        if (!btn) return;
        btn.node.on(Button.EventType.CLICK, handler, this);
    }

    private closePanel() {
        this._isOpen = false;
        if (this.panelRoot) this.panelRoot.active = false;
    }

    /** 供外部调用的公共打开面板方法（由 Container 双击时调用） */
    public openPanelPublic(container: Container) {
        if (this._isOpen) return;
        this._currentContainer = container;
        this._isOpen = true;
        if (this.panelRoot) this.panelRoot.active = true;
        this.refreshPanel();
    }

    private hideAll() {
        this._isOpen = false;
        if (this.panelRoot) this.panelRoot.active = false;
    }

    /** 刷新面板显示（图标 + 数量/容量） */
    private refreshPanel() {
        const storage = GlobalContainerStorage.instance;
        if (!storage) return;

        if (this.woodLabel) {
            this.woodLabel.string = `${storage.storedWood} / ${storage.maxWood}`;
        }
        if (this.copperLabel) {
            this.copperLabel.string = `${storage.storedCopper} / ${storage.maxCopper}`;
        }
        if (this.ironLabel) {
            this.ironLabel.string = `${storage.storedIron} / ${storage.maxIron}`;
        }
    }

    // ==================== 批量存取核心逻辑 ====================

    /**
     * 批量存入资源（从玩家背包转到仓库）
     * @param type 资源类型
     * @param amount 期望存入数量
     */
    private depositBulk(type: ResourceType, amount: number) {
        const storage = GlobalContainerStorage.instance;
        const data = PlayerData.instance;
        if (!storage || !data) return;

        const playerCount = this.getPlayerCount(data, type);
        const storageCount = this.getStorageCount(storage, type);
        const storageMax = this.getStorageMax(storage, type);

        if (playerCount <= 0) return;
        if (storageCount >= storageMax) return;

        // 实际存入量 = min(期望数量, 玩家持有量, 仓库剩余空间)
        const actual = Math.min(amount, playerCount, storageMax - storageCount);

        this.applyDeposit(data, storage, type, actual);
        this.refreshPanel();
    }

    /**
     * 批量取出资源（从仓库转到玩家背包）
     * @param type 资源类型
     * @param amount 期望取出数量
     */
    private withdrawBulk(type: ResourceType, amount: number) {
        const storage = GlobalContainerStorage.instance;
        const data = PlayerData.instance;
        if (!storage || !data) return;

        const playerCount = this.getPlayerCount(data, type);
        const playerMax = this.getPlayerMax(data, type);
        const storageCount = this.getStorageCount(storage, type);

        if (storageCount <= 0) return;
        if (playerCount >= playerMax) return;

        // 实际取出量 = min(期望数量, 仓库库存, 玩家剩余空间)
        const actual = Math.min(amount, storageCount, playerMax - playerCount);

        this.applyWithdraw(data, storage, type, actual);
        this.refreshPanel();
    }

    // ==================== 供编辑器绑定的事件方法 ====================
    // 使用方式：在编辑器中，将 deposit-001 / deposit-002 / withdraw-001 / withdraw-002
    // 按钮的 Click Events 绑定到对应方法，并在 CustomEventData 中填入 "5" 或 "10"。

    public onDepositWood(_btn: Button, customEventData: string) {
        this.depositBulk('wood', parseInt(customEventData) || 1);
    }
    public onDepositCopper(_btn: Button, customEventData: string) {
        this.depositBulk('copper', parseInt(customEventData) || 1);
    }
    public onDepositIron(_btn: Button, customEventData: string) {
        this.depositBulk('iron', parseInt(customEventData) || 1);
    }
    public onWithdrawWood(_btn: Button, customEventData: string) {
        this.withdrawBulk('wood', parseInt(customEventData) || 1);
    }
    public onWithdrawCopper(_btn: Button, customEventData: string) {
        this.withdrawBulk('copper', parseInt(customEventData) || 1);
    }
    public onWithdrawIron(_btn: Button, customEventData: string) {
        this.withdrawBulk('iron', parseInt(customEventData) || 1);
    }

    // ==================== 辅助方法 ====================

    private getPlayerCount(data: PlayerData, type: ResourceType): number {
        switch (type) {
            case 'wood': return data.woodCount;
            case 'copper': return data.copperCount;
            case 'iron': return data.ironCount;
        }
    }

    private getPlayerMax(data: PlayerData, type: ResourceType): number {
        switch (type) {
            case 'wood': return data.maxWood;
            case 'copper': return data.maxCopper;
            case 'iron': return data.maxIron;
        }
    }

    private getStorageCount(storage: GlobalContainerStorage, type: ResourceType): number {
        switch (type) {
            case 'wood': return storage.storedWood;
            case 'copper': return storage.storedCopper;
            case 'iron': return storage.storedIron;
        }
    }

    private getStorageMax(storage: GlobalContainerStorage, type: ResourceType): number {
        switch (type) {
            case 'wood': return storage.maxWood;
            case 'copper': return storage.maxCopper;
            case 'iron': return storage.maxIron;
        }
    }

    private applyDeposit(data: PlayerData, storage: GlobalContainerStorage, type: ResourceType, amount: number) {
        switch (type) {
            case 'wood':
                data.woodCount -= amount;
                storage.storedWood += amount;
                break;
            case 'copper':
                data.copperCount -= amount;
                storage.storedCopper += amount;
                break;
            case 'iron':
                data.ironCount -= amount;
                storage.storedIron += amount;
                break;
        }
    }

    private applyWithdraw(data: PlayerData, storage: GlobalContainerStorage, type: ResourceType, amount: number) {
        switch (type) {
            case 'wood':
                storage.storedWood -= amount;
                data.woodCount += amount;
                break;
            case 'copper':
                storage.storedCopper -= amount;
                data.copperCount += amount;
                break;
            case 'iron':
                storage.storedIron -= amount;
                data.ironCount += amount;
                break;
        }
    }
}