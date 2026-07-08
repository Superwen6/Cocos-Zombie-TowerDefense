import { _decorator, Component, Label, ProgressBar, Sprite, SpriteFrame } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { BaseSystem } from './BaseSystem';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { BuildPanelUI } from './BuildPanelUI';

const { ccclass, property } = _decorator;

const HUD_REFRESH_INTERVAL = 0.1;

/**
 * 常驻 HUD：实时显示玩家血量、疲劳与资源。
 * 资源显示为 [图标] 背包/仓库 格式。
 */
@ccclass('GameHUDUI')
export class GameHUDUI extends Component {
    @property({ type: Label, tooltip: '血量文本' })
    hpText: Label | null = null;

    @property({ type: ProgressBar, tooltip: '疲劳度进度条' })
    fatigueProgress: ProgressBar | null = null;

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

    @property({ type: ProgressBar, tooltip: '电力进度条' })
    powerProgress: ProgressBar | null = null;

    @property({ type: Label, tooltip: '电力数值文本' })
    powerText: Label | null = null;

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

        if (this.fatigueProgress) {
            if (state) {
                const progress = Math.min(1, Math.max(0, 1 - state.fatigue / 100));
                this.fatigueProgress.progress = progress;

                // 直接设置 barSprite.fillRange，绕过 ProgressBar FILLED 模式更新延迟
                if (this.fatigueProgress.barSprite) {
                    this.fatigueProgress.barSprite.fillRange = progress;
                }
            } else {
                this.fatigueProgress.progress = 0;
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

    /** 更新电力 UI（进度条） */
    public updatePowerUI() {
        const base = BaseSystem.instance;
        const gen = base ? base.totalPowerGen : 0;
        const cost = base ? base.totalPowerCost : 0;

        if (this.powerProgress) {
            // 剩余电力比例 = 1 - 总耗电/总发电，封顶 0~1
            const ratio = gen > 0 ? Math.max(0, Math.min(1, 1 - cost / gen)) : 0;
            this.powerProgress.progress = ratio;

            // 直接设置 barSprite.fillRange，绕过 ProgressBar FILLED 模式更新延迟
            if (this.powerProgress.barSprite) {
                this.powerProgress.barSprite.fillRange = ratio;
            }
        }

        if (this.powerText) {
            this.powerText.string = `${Math.ceil(cost)} / ${Math.ceil(gen)}`;
        }
    }
}