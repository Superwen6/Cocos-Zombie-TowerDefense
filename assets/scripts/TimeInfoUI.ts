import { _decorator, Component, Label } from 'cc';
import { DayNightSystem } from './DayNightSystem';

const { ccclass, property } = _decorator;

/**
 * 挂载在 TimeInfoLabel 节点上，实时更新游戏天数和阶段剩余时间。
 */
@ccclass('TimeInfoUI')
export class TimeInfoUI extends Component {
    @property({ type: Label, tooltip: '显示时间的 Label 组件' })
    timeLabel: Label | null = null;

    start() {
        if (!this.timeLabel) {
            this.timeLabel = this.getComponent(Label);
        }
    }

    update(_dt: number) {
        const ds = DayNightSystem.instance;
        if (!ds || !this.timeLabel) return;

        const day = ds.currentDay;
        const timeStr = ds.getRemainingTimeString();

        if (ds.isDayPhase) {
            this.timeLabel.string = `第 ${day} 天 | 黎明+白天 ${timeStr}`;
        } else {
            this.timeLabel.string = `第 ${day} 天 | 黄昏+夜晚 ${timeStr}`;
        }
    }
}