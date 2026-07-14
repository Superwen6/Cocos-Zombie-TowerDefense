import {
    _decorator,
    CCFloat,
    Color,
    Component,
    EventTarget,
    Label,
    Sprite,
    UIOpacity,
    warn,
} from 'cc';
import { GameManager } from './GameManager';
import { ResourceSpawner } from './ResourceSpawner';

const { ccclass, property } = _decorator;

/** 昼夜阶段 */
export enum DayNightPhase {
    DAY = 0,        // 固定白天
    DUSK = 1,       // 渐变过渡（白天→黑夜）
    NIGHT = 2,      // 固定黑夜
    DAWN = 3,       // 渐变过渡（黑夜→白天）
}

/** 阶段切换事件名 */
export const DayNightEvents = {
    PHASE_CHANGED: 'day-night-phase-changed',
} as const;

/** 阶段切换事件参数 */
export interface DayNightPhaseChangedDetail {
    phase: DayNightPhase;
    previousPhase: DayNightPhase;
    currentDay: number;
}

/**
 * 昼夜交替系统（四阶段模式）。
 * 完整周期：白天(dayDuration - transitionTime) → 黄昏(transitionTime) → 夜晚(nightDuration - transitionTime) → 黎明(transitionTime) → 新的一天
 */
@ccclass('DayNightSystem')
export class DayNightSystem extends Component {
    @property({ type: Sprite, tooltip: '拖入 darkmask 节点上的 Sprite 组件' })
    darkMask: Sprite | null = null;

    @property({ tooltip: '白天持续时间（秒）' })
    dayDuration = 150;

    @property({ tooltip: '黑夜持续时间（秒）' })
    nightDuration = 90;

    @property({ tooltip: '昼夜切换时遮罩渐变时长（秒）' })
    transitionTime = 10;

    @property({ type: CCFloat, tooltip: '夜晚遮罩最大透明度（0~1，建议0.85左右，保留可见度）', range: [0, 1, 0.01], slide: true })
    maxNightAlpha = 0.85;

    @property({ tooltip: '阶段切换时打印日志' })
    enableLog = true;

    @property({ tooltip: '当前生存天数（从第 1 天开始）' })
    currentDay = 1;

    @property({ tooltip: '最大生存天数，达到后通关' })
    maxDays = 100;

    @property({ type: ResourceSpawner, tooltip: '拖入 ResourceSpawner，每天白天自动刷新资源' })
    resourceSpawner: ResourceSpawner | null = null;

    @property({ type: Label, tooltip: '屏幕中央天数大字报 Label' })
    dayNoticeLabel: Label | null = null;

    static readonly eventTarget = new EventTarget();

    private static _instance: DayNightSystem | null = null;

    private _phase: DayNightPhase = DayNightPhase.DAY;
    private _elapsed = 0;
    private _maskOpacity: UIOpacity | null = null;

    static get instance(): DayNightSystem | null {
        return DayNightSystem._instance;
    }

    get phase(): DayNightPhase {
        return this._phase;
    }

    /** 获取当前阶段已流逝时间（秒） */
    get elapsedTime(): number {
        return this._elapsed;
    }

    get isDay(): boolean {
        return this._phase === DayNightPhase.DAY;
    }

    get isNight(): boolean {
        return this._phase === DayNightPhase.NIGHT;
    }

    /** 获取当前阶段剩余时间（秒） */
    get remainingTime(): number {
        let duration = 0;
        switch (this._phase) {
            case DayNightPhase.DAY:
                duration = this.dayDuration;
                break;
            case DayNightPhase.NIGHT:
                duration = this.nightDuration;
                break;
            case DayNightPhase.DUSK:
            case DayNightPhase.DAWN:
                duration = this.transitionTime;
                break;
        }
        return Math.max(0, duration - this._elapsed);
    }

    /** 获取当前阶段剩余时间，格式化为 分:秒 */
    getRemainingTimeString(): string {
        const totalSeconds = Math.max(0, this.remainingTime);
        const mins = Math.floor(totalSeconds / 60);
        const secs = Math.floor(totalSeconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    /** 获取当前阶段的中文名称 */
    getPhaseName(): string {
        switch (this._phase) {
            case DayNightPhase.DAY:   return '白天';
            case DayNightPhase.DUSK:  return '黄昏';
            case DayNightPhase.NIGHT: return '夜晚';
            case DayNightPhase.DAWN:  return '黎明';
            default:                  return '';
        }
    }

    onLoad() {
        DayNightSystem._instance = this;
        this._phase = DayNightPhase.DAY;
        this._elapsed = 0;
        this.initDarkMask();
        this.initDayNoticeHidden();
    }

    onEnable() {
        this.initDarkMask();
    }

    onDestroy() {
        if (DayNightSystem._instance === this) {
            DayNightSystem._instance = null;
        }
    }

    start() {
        this.showDayNotice(`Day ${this.currentDay}`);
        this.spawnDayResources();
    }

    update(dt: number) {
        this._elapsed += dt;

        let duration = this._getPhaseDuration();
        while (this._elapsed >= duration) {
            this._elapsed -= duration;
            this._switchPhase();
            duration = this._getPhaseDuration();
        }

        // 更新遮罩
        this.updateMaskSmoothly();
    }

    forcePhase(phase: DayNightPhase) {
        if (this._phase === phase) {
            return;
        }
        const previous = this._phase;
        this._phase = phase;
        this._elapsed = 0;
        this.emitPhaseChanged(previous);
    }

    /**
     * 屏幕中央天数大字报：闪现后逐渐淡出隐藏。
     */
    showDayNotice(dayText: string) {
        if (!this.dayNoticeLabel) {
            warn('[DayNightSystem] 未绑定 dayNoticeLabel，无法显示天数大字报');
            return;
        }

        const node = this.dayNoticeLabel.node;
        node.active = true;
        this.dayNoticeLabel.string = dayText;

        // 确保有 UIOpacity
        let opacity = node.getComponent(UIOpacity);
        if (!opacity) {
            opacity = node.addComponent(UIOpacity);
        }
        opacity.opacity = 255;

        // 淡出动画
        let fadeElapsed = 0;
        const fadeUpdate = (dt: number) => {
            fadeElapsed += dt;
            const t = Math.min(fadeElapsed / 2, 1);
            if (opacity && opacity.isValid) {
                opacity.opacity = 255 * (1 - t);
            }
            if (t >= 1) {
                this.unschedule(fadeUpdate);
                if (node && node.isValid) {
                    node.active = false;
                }
            }
        };
        this.unschedule(fadeUpdate);
        this.schedule(fadeUpdate, 0);
    }

    private initDayNoticeHidden() {
        if (this.dayNoticeLabel) {
            this.dayNoticeLabel.node.active = false;
        }
    }

    /** 获取当前阶段的持续时间 */
    private _getPhaseDuration(): number {
        switch (this._phase) {
            case DayNightPhase.DAY:
                return this.dayDuration - this.transitionTime;
            case DayNightPhase.NIGHT:
                return this.nightDuration - this.transitionTime;
            case DayNightPhase.DUSK:
            case DayNightPhase.DAWN:
                return this.transitionTime;
            default:
                return 0;
        }
    }

    /** 切换到下一阶段 */
    private _switchPhase() {
        const previous = this._phase;
        switch (this._phase) {
            case DayNightPhase.DAY:
                this._phase = DayNightPhase.DUSK;  // 白天 → 渐变到黑夜
                break;
            case DayNightPhase.DUSK:
                this._phase = DayNightPhase.NIGHT; // 渐变结束 → 黑夜
                break;
            case DayNightPhase.NIGHT:
                this._phase = DayNightPhase.DAWN;  // 黑夜 → 渐变到白天
                break;
            case DayNightPhase.DAWN:
                // 渐变结束 → 进入新的一天（白天）
                this._phase = DayNightPhase.DAY;
                this.onEnterNewDay();
                break;
        }
        this.emitPhaseChanged(previous);
    }

    private emitPhaseChanged(previousPhase: DayNightPhase) {
        const detail: DayNightPhaseChangedDetail = {
            phase: this._phase,
            previousPhase,
            currentDay: this.currentDay,
        };

        this.node.emit(DayNightEvents.PHASE_CHANGED, detail);
        DayNightSystem.eventTarget.emit(DayNightEvents.PHASE_CHANGED, detail);
    }

    /** 进入新的一天 */
    private onEnterNewDay() {
        if (this.currentDay >= this.maxDays) {
            if (GameManager.instance) {
            return;
        }

        this.currentDay += 1;
        this.showDayNotice(`Day ${this.currentDay}`);
        this.spawnDayResources();
    }

    /** 统一封装资源刷新逻辑 */
    private spawnDayResources() {
        if (this.resourceSpawner) {
            this.resourceSpawner.spawnDayResources();
        } else {
            const spawner = this.getComponent(ResourceSpawner);
            if (spawner) {
                spawner.spawnDayResources();
            }
        }
    }

    private initDarkMask() {
        if (!this.darkMask) {
            return;
        }
        this.darkMask.node.active = true;
        // 初始化 UIOpacity
        this._maskOpacity = this.darkMask.node.getComponent(UIOpacity);
        if (!this._maskOpacity) {
            this._maskOpacity = this.darkMask.node.addComponent(UIOpacity);
        }
        // 遮罩固定为黑色，仅通过 UIOpacity 控制透明度
        this.darkMask.color = Color.BLACK;
        this._maskOpacity.opacity = 0;
    }

    /** 每帧根据当前阶段计算遮罩透明度（纯 Alpha 方案，无颜色插值） */
    private updateMaskSmoothly() {
        if (!this.darkMask || !this._maskOpacity) return;

        const maxOpacity = this.maxNightAlpha * 255;
        let targetAlpha: number;

        switch (this._phase) {
            case DayNightPhase.DAY:
                // 白天：完全透明
                targetAlpha = 0;
                break;

            case DayNightPhase.DUSK:
                // 白天 → 黑夜：0 → maxNightAlpha
                targetAlpha = maxOpacity * (this._elapsed / this.transitionTime);
                break;

            case DayNightPhase.NIGHT:
                // 黑夜：保持 maxNightAlpha
                targetAlpha = maxOpacity;
                break;

            case DayNightPhase.DAWN:
                // 黑夜 → 白天：maxNightAlpha → 0
                targetAlpha = maxOpacity * (1 - this._elapsed / this.transitionTime);
                break;

            default:
                targetAlpha = 0;
        }

        this._maskOpacity.opacity = targetAlpha;
    }
}
