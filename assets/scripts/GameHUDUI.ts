import { _decorator, Color, Component, director, Label, ProgressBar, Sprite, SpriteFrame } from 'cc';
import { PlayerData } from './PlayerData';
import { PlayerState } from './PlayerState';
import { BaseSystem } from './BaseSystem';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { BuildPanelUI } from './BuildPanelUI';
import { AttributeUpgradePanel } from './AttributeUpgradePanel';
import { DayNightSystem, DayNightPhase } from './DayNightSystem';
import { SettingPanelUI } from './SettingPanelUI';

const { ccclass, property } = _decorator;

const HUD_REFRESH_INTERVAL = 0.1;
const FLASH_GREEN_DURATION = 0.5;
const FLASH_GREEN = new Color(0, 255, 0, 255);

/**
 * 常驻 HUD：实时显示玩家血量、疲劳与资源。
 * 资源显示为 [图标] 背包/仓库 格式。
 */
@ccclass('GameHUDUI')
export class GameHUDUI extends Component {
    @property({ type: Label, tooltip: '血量文本（hpText/Text 子节点的 Label）' })
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

    // ---- TopStatusPanel 新属性 ----
    @property({ type: Sprite, tooltip: '昼夜图标（PhaseIcon）' })
    phaseIcon: Sprite | null = null;

    @property({ type: SpriteFrame, tooltip: '太阳图标素材' })
    sunIconSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '月亮图标素材' })
    moonIconSprite: SpriteFrame | null = null;

    @property({ type: Label, tooltip: '时间文本（TimeLabel）' })
    timeLabel: Label | null = null;

    @property({ type: Label, tooltip: '木材仓库文本（WoodInfo/Value）' })
    woodInfoLabel: Label | null = null;

    @property({ type: Label, tooltip: '铜矿仓库文本（CopperInfo/Value）' })
    copperInfoLabel: Label | null = null;

    @property({ type: Label, tooltip: '铁矿仓库文本（IronInfo/Value）' })
    ironInfoLabel: Label | null = null;

    private _refreshTimer = 0;
    private _flashTimer = 0;
    private _isFlashing = false;
    private _flashRed = true;

    /** 资源掉落闪绿状态：Label → 剩余闪绿时间 */
    private readonly _greenFlashTimers = new Map<Label, number>();

    start() {
        // 确保打开面板按钮绑定（即使 UpgradePanel 未激活）
        BuildPanelUI.ensureOpenPanelBinding();
        // 确保属性升级面板按钮绑定（即使 AttributeUpgradePanel 未激活）
        AttributeUpgradePanel.ensureOpenPanelBinding();
        // 确保设置面板按钮绑定（即使 settingpanel 未激活）
        SettingPanelUI.ensureOpenPanelBinding();

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

        // 更新资源掉落闪绿计时器
        for (const [label, remaining] of this._greenFlashTimers) {
            const newRemaining = remaining - dt;
            if (newRemaining <= 0) {
                if (label.isValid) {
                    label.color = Color.WHITE;
                }
                this._greenFlashTimers.delete(label);
            } else {
                this._greenFlashTimers.set(label, newRemaining);
            }
        }

        // 每帧刷新时间和昼夜图标
        this.updateTimeAndPhase(dt);
    }

    refreshHUD() {
        const state = PlayerState.instance;
        const data = PlayerData.instance;

        if (this.hpText) {
            if (state) {
                const hp = Math.ceil(state.hp);
                this.hpText.string = `${hp}`;
                this.hpText.color = hp <= 20 ? Color.RED : Color.WHITE;
            } else {
                this.hpText.string = '--';
                this.hpText.color = Color.WHITE;
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

        // 左下角面板：背包数量 / 背包容量（应用背包容量倍率）
        if (this.ironText) {
            if (data) {
                const effMaxIron = state?.getEffectiveBackpackMax(data.maxIron) ?? data.maxIron;
                this.ironText.string = `${data.ironCount}/${effMaxIron}`;
            } else {
                this.ironText.string = '--/--';
            }
        }

        if (this.copperText) {
            if (data) {
                const effMaxCopper = state?.getEffectiveBackpackMax(data.maxCopper) ?? data.maxCopper;
                this.copperText.string = `${data.copperCount}/${effMaxCopper}`;
            } else {
                this.copperText.string = '--/--';
            }
        }

        if (this.woodText) {
            if (data) {
                const effMaxWood = state?.getEffectiveBackpackMax(data.maxWood) ?? data.maxWood;
                this.woodText.string = `${data.woodCount}/${effMaxWood}`;
            } else {
                this.woodText.string = '--/--';
            }
        }

        // 顶部面板：仓库库存 / 仓库容量
        if (this.woodInfoLabel) {
            const storage = GlobalContainerStorage.instance;
            if (storage) {
                this.woodInfoLabel.string = `${storage.storedWood} / ${storage.maxWood}`;
            } else {
                this.woodInfoLabel.string = '-- / --';
            }
        }

        if (this.copperInfoLabel) {
            const storage = GlobalContainerStorage.instance;
            if (storage) {
                this.copperInfoLabel.string = `${storage.storedCopper} / ${storage.maxCopper}`;
            } else {
                this.copperInfoLabel.string = '-- / --';
            }
        }

        if (this.ironInfoLabel) {
            const storage = GlobalContainerStorage.instance;
            if (storage) {
                this.ironInfoLabel.string = `${storage.storedIron} / ${storage.maxIron}`;
            } else {
                this.ironInfoLabel.string = '-- / --';
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

    /** 每帧刷新时间倒计时和昼夜图标 */
    private updateTimeAndPhase(dt: number) {
        const dayNight = DayNightSystem.instance;
        if (!dayNight) return;

        // 更新图标
        if (this.phaseIcon) {
            const phase = dayNight.phase;
            if (phase === DayNightPhase.DAY || phase === DayNightPhase.DUSK) {
                if (this.sunIconSprite) this.phaseIcon.spriteFrame = this.sunIconSprite;
            } else {
                if (this.moonIconSprite) this.phaseIcon.spriteFrame = this.moonIconSprite;
            }
        }

        // 更新时间文本（倒计时格式）
        if (this.timeLabel) {
            const remaining = dayNight.remainingTime;
            const minutes = Math.floor(remaining / 60);
            const seconds = Math.floor(remaining % 60);
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            this.timeLabel.string = `第 ${dayNight.currentDay} 天 | ${dayNight.getPhaseName()} ${timeStr}`;

            // 黄昏/黎明红闪逻辑
            const phase = dayNight.phase;
            const shouldFlash = (phase === DayNightPhase.DUSK || phase === DayNightPhase.DAWN) && remaining <= 10;

            if (shouldFlash) {
                if (!this._isFlashing) {
                    this._isFlashing = true;
                    this._flashTimer = 0;
                    this._flashRed = true;
                }
                this._flashTimer += dt;
                if (this._flashTimer >= 0.4) {
                    this._flashTimer = 0;
                    this._flashRed = !this._flashRed;
                    this.timeLabel.color = this._flashRed ? Color.RED : Color.WHITE;
                }
            } else {
                if (this._isFlashing) {
                    this._isFlashing = false;
                    this.timeLabel.color = Color.WHITE;
                }
            }
        }
    }

    // ── 资源掉落闪绿 ──

    /** 资源掉落时对应 Label 闪绿 */
    public static flashResourceGreen(type: 'wood' | 'copper' | 'iron' | 'money') {
        // 从场景中查找 GameHUDUI 实例
        const scene = director.getScene();
        if (!scene) return;
        const hud = scene.getComponentInChildren(GameHUDUI);
        if (!hud) return;

        let label: Label | null = null;
        switch (type) {
            case 'wood': label = hud.woodInfoLabel; break;
            case 'copper': label = hud.copperInfoLabel; break;
            case 'iron': label = hud.ironInfoLabel; break;
            case 'money': label = hud.moneyText; break;
        }
        if (!label) return;

        hud.flashLabelGreen(label);
    }

    /** 对指定 Label 执行闪绿效果 */
    private flashLabelGreen(label: Label) {
        label.color = FLASH_GREEN;
        this._greenFlashTimers.set(label, FLASH_GREEN_DURATION);
    }
}