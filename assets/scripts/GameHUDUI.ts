import { _decorator, Component, Label } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

const HUD_REFRESH_INTERVAL = 0.1;

/**
 * 常驻 HUD：实时显示玩家血量、疲劳与美金。
 * 挂在 Canvas 下常驻 HUD 根节点上。
 */
@ccclass('GameHUDUI')
export class GameHUDUI extends Component {
    @property({ type: Label, tooltip: '血量文本' })
    hpText: Label | null = null;

    @property({ type: Label, tooltip: '疲劳文本' })
    fatigueText: Label | null = null;

    @property({ type: Label, tooltip: '金钱文本' })
    moneyText: Label | null = null;

    @property({ type: Label, tooltip: '铁矿文本' })
    ironText: Label | null = null;

    @property({ type: Label, tooltip: '铜矿文本' })
    copperText: Label | null = null;

    @property({ type: Label, tooltip: '木头文本' })
    woodText: Label | null = null;

    @property({ type: Label, tooltip: '电力文本（发电/消耗）' })
    powerLabel: Label | null = null;

    private _refreshTimer = 0;

    start() {
        this.refreshHUD();
    }

    update(dt: number) {
        this._refreshTimer += dt;
        if (this._refreshTimer >= HUD_REFRESH_INTERVAL) {
            this._refreshTimer = 0;
            this.refreshHUD();
        }
    }

    refreshHUD() {
        const state = PlayerState.instance;
        const data = PlayerData.instance;

        if (this.hpText) {
            if (state) {
                this.hpText.string = `血量: ${Math.ceil(state.hp)}/${state.maxHp}`;
            } else {
                this.hpText.string = '血量: --/--';
            }
        }

        if (this.fatigueText) {
            if (state) {
                this.fatigueText.string = `疲劳: ${Math.ceil(state.fatigue)}/100`;
            } else {
                this.fatigueText.string = '疲劳: --/100';
            }
        }

        if (this.moneyText) {
            if (data) {
                this.moneyText.string = `资产: $${data.money}`;
            } else {
                this.moneyText.string = '资产: $--';
            }
        }

        if (this.ironText) {
            if (data) {
                this.ironText.string = `铁矿: ${data.ironCount}`;
            } else {
                this.ironText.string = '铁矿: --';
            }
        }

        if (this.copperText) {
            if (data) {
                this.copperText.string = `铜矿: ${data.copperCount}`;
            } else {
                this.copperText.string = '铜矿: --';
            }
        }

        if (this.woodText) {
            if (data) {
                this.woodText.string = `木头: ${data.woodCount}`;
            } else {
                this.woodText.string = '木头: --';
            }
        }

        this.updatePowerUI();
    }

    /** 更新电力文本（可由外部调用，如建造/拆除后立即刷新） */
    public updatePowerUI() {
        if (!this.powerLabel) {
            return;
        }
        const base = BaseSystem.instance;
        if (!base) {
            this.powerLabel.string = '电力: 0/0';
            return;
        }
        const gen = base.totalPowerGen;
        const cost = base.totalPowerCost;
        this.powerLabel.string = `电力: ${gen}/${cost}`;
    }
}
