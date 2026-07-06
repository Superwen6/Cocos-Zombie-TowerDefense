import { _decorator, Component, Label, Sprite, SpriteFrame, Color } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { BaseSystem } from './BaseSystem';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { BuildPanelUI } from './BuildPanelUI';

const { ccclass, property } = _decorator;

const HUD_REFRESH_INTERVAL = 0.1;

// 电力进度条颜色（与炮塔血条相反：低负载绿，高负载红）
const POWER_GREEN = new Color(60, 255, 80, 255);
const POWER_YELLOW = new Color(255, 220, 60, 255);
const POWER_RED = new Color(255, 60, 60, 255);

/**
 * 常驻 HUD：实时显示玩家血量、疲劳与资源。
 * 资源显示为 [图标] 背包/仓库 格式。
 */
@ccclass('GameHUDUI')
export class GameHUDUI extends Component {
    @property({ type: Label, tooltip: '血量文本' })
    hpText: Label | null = null;

    @property({ type: Label, tooltip: '疲劳文本' })
    fatigueText: Label | null = null;

    @property({ type: Label, tooltip: '金钱文本' })
    moneyText: Label | null = null;

    // ---- 资源图标 Sprite ----
    @property({ type: Sprite, tooltip: '铁矿图标 Sprite' })
    ironIcon: Sprite | null = null;

    @property({ type: Sprite, tooltip: '铜矿图标 Sprite' })
    copperIcon: Sprite | null = null;

    @property({ type: Sprite, tooltip: '木头图标 Sprite' })
    woodIcon: Sprite | null = null;

    @property({ type: Sprite, tooltip: '金钱图标 Sprite' })
    moneyIcon: Sprite | null = null;

    // ---- 资源图标 SpriteFrame ----
    @property({ type: SpriteFrame, tooltip: '铁矿图标素材' })
    ironIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '铜矿图标素材' })
    copperIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '木头图标素材' })
    woodIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '金钱图标素材' })
    moneyIconSprite: SpriteFrame | null = null;

    // ---- 资源文本 Label ----
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
        // 确保打开面板按钮绑定（即使 UpgradePanel 未激活）
        BuildPanelUI.ensureOpenPanelBinding();

        // 设置资源图标
        if (this.ironIcon && this.ironIconSprite) this.ironIcon.spriteFrame = this.ironIconSprite;
        if (this.copperIcon && this.copperIconSprite) this.copperIcon.spriteFrame = this.copperIconSprite;
        if (this.woodIcon && this.woodIconSprite) this.woodIcon.spriteFrame = this.woodIconSprite;
        if (this.moneyIcon && this.moneyIconSprite) this.moneyIcon.spriteFrame = this.moneyIconSprite;

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
                this.moneyText.string = `$${data.money}`;
            } else {
                this.moneyText.string = '$--';
            }
        }

        if (this.ironText) {
            if (data) {
                const storage = GlobalContainerStorage.instance;
                this.ironText.string = `${data.ironCount}/${storage ? storage.storedIron : 0}`;
            } else {
                this.ironText.string = '--/--';
            }
        }

        if (this.copperText) {
            if (data) {
                const storage = GlobalContainerStorage.instance;
                this.copperText.string = `${data.copperCount}/${storage ? storage.storedCopper : 0}`;
            } else {
                this.copperText.string = '--/--';
            }
        }

        if (this.woodText) {
            if (data) {
                const storage = GlobalContainerStorage.instance;
                this.woodText.string = `${data.woodCount}/${storage ? storage.storedWood : 0}`;
            } else {
                this.woodText.string = '--/--';
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
