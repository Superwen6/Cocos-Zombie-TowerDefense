import { _decorator, Component, Label, Sprite, Color } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

const HUD_REFRESH_INTERVAL = 0.1;

// 电力进度条颜色（与炮塔血条相反：低负载绿，高负载红）
const POWER_GREEN = new Color(60, 255, 80, 255);
const POWER_YELLOW = new Color(255, 220, 60, 255);
const POWER_RED = new Color(255, 60, 60, 255);

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

    @property({ type: Sprite, tooltip: '电力进度条（FILLED / HORIZONTAL）' })
    powerBar: Sprite | null = null;

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

    /** 更新电力 UI（文本 + 进度条） */
    public updatePowerUI() {
        const base = BaseSystem.instance;
        const gen = base ? base.totalPowerGen : 0;
        const cost = base ? base.totalPowerCost : 0;

        // 电力文本
        if (this.powerLabel) {
            this.powerLabel.string = `电力: ${gen}/${cost}`;
        }

        // 电力进度条（反向颜色：低负载绿，高负载红）
        if (this.powerBar && this.powerBar.spriteFrame) {
            const ratio = gen > 0 ? Math.min(1, cost / gen) : (cost > 0 ? 1 : 0);
            this.powerBar.fillRange = ratio;
            this.powerBar.color = this.getPowerColor(ratio);
        }
    }

    /** 电力颜色（反向）：绿(0~40%) → 黄(40~70%) → 红(70~100%+) */
    private getPowerColor(ratio: number): Color {
        if (ratio < 0.4) {
            return lerpColor(POWER_GREEN, POWER_YELLOW, ratio / 0.4);
        } else if (ratio < 0.7) {
            return lerpColor(POWER_YELLOW, POWER_RED, (ratio - 0.4) / 0.3);
        } else {
            return POWER_RED.clone();
        }
    }
}

function lerpColor(a: Color, b: Color, t: number): Color {
    const result = new Color();
    result.r = a.r + (b.r - a.r) * t;
    result.g = a.g + (b.g - a.g) * t;
    result.b = a.b + (b.b - a.b) * t;
    result.a = 255;
    return result;
}
