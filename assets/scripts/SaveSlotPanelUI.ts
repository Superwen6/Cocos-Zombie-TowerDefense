import { _decorator, AudioClip, AudioSource, Color, Component, Label, Node, Sprite } from 'cc';
import { SaveSystem, SAVE_SLOT_COUNT, getSlotSaveInfo } from './SaveSystem';

const { ccclass, property } = _decorator;

type PanelMode = 'save' | 'load';

const COLOR_SLOT_EMPTY = new Color(88, 92, 112, 255);
const COLOR_SLOT_FULL = new Color(96, 148, 96, 255);
const COLOR_TEXT = new Color(240, 240, 240, 255);
const COLOR_TEXT_DIM = new Color(180, 182, 192, 255);
const COLOR_WARN_TEXT = new Color(255, 220, 96, 255);

/**
 * 多存档槽位面板（存储/载入共用）。
 * 整个 UI 层次预先在场景中搭建好（Canvas 下的静态节点，含遮罩/面板/槽位/按钮/警告窗），
 * 本组件只负责引用与交互控制，不做任何动态创建。
 *
 * 场景层次约定（本组件挂载的节点下）：
 *   UI                 —— 面板整体容器（打开/关闭切换 active，默认关闭）
 *     ├─ Dim           —— 全屏遮罩 Sprite
 *     ├─ Panel         —— 面板背景
 *     │   ├─ TitleLabel
 *     │   ├─ BtnClose  —— 右上角关闭按钮
 *     │   ├─ Slot0..Slot3 —— 槽位按钮（带 Sprite + Label 子节点）
 *     │   └─ ResultLabel
 *     └─ Warn          —— 覆盖警告窗（默认关闭）
 *         ├─ TitleLabel
 *         ├─ TextLabel
 *         ├─ BtnYes / BtnNo
 */
@ccclass('SaveSlotPanelUI')
export class SaveSlotPanelUI extends Component {
    public static instance: SaveSlotPanelUI | null = null;

    /** save=游戏内存档；load=主菜单读档 */
    @property({ tooltip: '面板模式：save=free game save，load=main menu load' })
    mode: PanelMode = 'save';

    @property({ type: AudioClip, tooltip: '槽位点击音效（Slot0..Slot3 共用一个）' })
    slotClickSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '存档成功音效（ResultLabel 展示提示时播放）' })
    saveSuccessSound: AudioClip | null = null;

    private _audioSource: AudioSource | null = null;
    private _ui: Node | null = null;
    private _slotLabels: Label[] = [];
    private _slotSprites: Sprite[] = [];
    private _resultLabel: Label | null = null;
    private _warnContent: Node | null = null;
    private _warnTextLabel: Label | null = null;
    private _pendingSlot = -1;
    private _onSelect: ((slot: number) => void) | null = null;
    private _onClose: (() => void) | null = null;

    onLoad() {
        SaveSlotPanelUI.instance = this;
        this._audioSource = this.node.addComponent(AudioSource);
        this.registerUI();
    }

    onDestroy() {
        if (SaveSlotPanelUI.instance === this) SaveSlotPanelUI.instance = null;
    }

    /** 静态入口：游戏内打开存档面板 */
    public static openSavePanel(): SaveSlotPanelUI | null {
        const inst = SaveSlotPanelUI.instance;
        if (!inst) {
            console.warn('[SaveSlotPanelUI] 场景中未找到 SaveSlotPanelUI 实例');
            return null;
        }
        inst.mode = 'save';
        inst.open();
        return inst;
    }

    /** 静态入口：主菜单打开读档面板 */
    public static openLoadPanel(onSelect: (slot: number) => void, onClose: () => void): SaveSlotPanelUI | null {
        const inst = SaveSlotPanelUI.instance;
        if (!inst) {
            console.warn('[SaveSlotPanelUI] 场景中未找到 SaveSlotPanelUI 实例');
            return null;
        }
        inst.mode = 'load';
        inst._onSelect = onSelect;
        inst._onClose = onClose;
        inst.open();
        return inst;
    }

    public static closePanel(): void {
        SaveSlotPanelUI.instance?.close();
    }

    private getChild(root: Node, name: string): Node | null {
        for (const child of root.children) {
            if (child.name === name) return child;
        }
        return null;
    }

    private registerUI() {
        const root = this.node;
        this._ui = this.getChild(root, 'UI'); // UI 容器（默认不显示）
        if (!this._ui) {
            console.warn('[SaveSlotPanelUI] 缺少 UI 容器子节点');
            return;
        }

        const panel = this.getChild(this._ui, 'Panel');

        // 标题
        const titleLabel = panel ? this.getChild(panel, 'TitleLabel') : null;
        if (titleLabel) {
            const lbl = titleLabel.getComponent(Label);
            if (lbl) lbl.string = this.mode === 'load' ? '载入存档' : '保存游戏进度';
        }

        // 槽位（Slot0..Slot3）
        this._slotLabels = [];
        this._slotSprites = [];
        for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
            const slotNode = panel ? this.getChild(panel, `Slot${i}`) : null;
            const lbl = slotNode ? slotNode.getComponentInChildren(Label) : null;
            const sp = slotNode ? slotNode.getComponent(Sprite) : null;
            this._slotLabels.push(lbl);
            this._slotSprites.push(sp);
            if (slotNode) slotNode.on(Node.EventType.TOUCH_END, () => this.onSlotClick(i), this);
        }

        // 结果提示
        this._resultLabel = panel ? this.getLabel(panel, 'ResultLabel') : null;

        // 警告窗
        this._warnContent = this.getChild(this._ui, 'Warn');
        if (this._warnContent) {
            this._warnTextLabel = this.getLabel(this._warnContent, 'TextLabel');
            const yesBtn = this.getChild(this._warnContent, 'BtnYes');
            const noBtn = this.getChild(this._warnContent, 'BtnNo');
            if (yesBtn) yesBtn.on(Node.EventType.TOUCH_END, this.onWarningYes, this);
            if (noBtn) noBtn.on(Node.EventType.TOUCH_END, this.onWarningNo, this);
            this._warnContent.active = false;
        }

        // 关闭按钮
        if (panel) {
            const closeBtn = this.getChild(panel, 'BtnClose');
            if (closeBtn) closeBtn.on(Node.EventType.TOUCH_END, this.onCloseClick, this);
        }

        // 初始隐藏面板
        if (this._ui) this._ui.active = false;
    }

    private getLabel(root: Node, name: string): Label | null {
        const node = this.getChild(root, name);
        return node ? node.getComponent(Label) : null;
    }

    /** 打开面板 */
    public open() {
        if (!this._ui) return;
        this.refreshSlots();
        this.setResult('');
        if (this._warnContent) this._warnContent.active = false;
        this._ui.active = true;
    }

    /** 关闭面板（触发 onClose 回调） */
    public close() {
        if (this._ui) this._ui.active = false;
        const cb = this._onClose;
        this._onClose = null;
        if (cb) cb();
    }

    private refreshSlots() {
        for (let i = 0; i < this._slotLabels.length; i++) {
            const info = getSlotSaveInfo(i);
            const lbl = this._slotLabels[i];
            const sp = this._slotSprites[i];
            if (!lbl) continue;
            if (info) {
                lbl.string = `槽位 ${i + 1} · 第${info.day}天 · ${this.formatTime(info.timestamp)}`;
                lbl.color = COLOR_TEXT;
                if (sp) sp.color = COLOR_SLOT_FULL;
                this.setSpriteTint(sp);
            } else {
                lbl.string = `槽位 ${i + 1} · 空槽位`;
                lbl.color = COLOR_TEXT_DIM;
                if (sp) sp.color = COLOR_SLOT_EMPTY;
            }
        }
    }

    private setSpriteTint(sp: Sprite | null) {
        if (!sp) return;
        // 保留图片 alpha，仅叠加色调
        const col = sp.color;
        col.a = 255;
        sp.color = col;
    }

    private formatTime(ts: number): string {
        if (!ts) return '--';
        const d = new Date(ts);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    private setResult(text: string) {
        if (this._resultLabel) this._resultLabel.string = text;
    }

    /** 槽位点击处理 */
    private onSlotClick(i: number) {
        this.playSlotClickSound();
        if (this.mode === 'save') {
            if (SaveSystem.hasSave(i)) {
                this._pendingSlot = i;
                if (this._warnTextLabel) this._warnTextLabel.string = `槽位 ${i + 1} 已有存档，是否覆盖？`;
                if (this._warnContent) this._warnContent.active = true;
            } else {
                this.doSave(i);
            }
            return;
        }

        // load
        if (SaveSystem.hasSave(i)) {
            const cb = this._onSelect;
            this.close();
            if (cb) cb(i);
        } else {
            this.setResult(`槽位 ${i + 1} 为空，无法载入`);
            if (this._resultLabel) this._resultLabel.color = COLOR_WARN_TEXT;
        }
    }

    /** 执行存档 */
    private doSave(i: number) {
        const ok = SaveSystem.save(i);
        if (ok) {
            this.setResult(`保存成功：已写入槽位 ${i + 1}`);
            if (this._resultLabel) this._resultLabel.color = COLOR_TEXT;
            this.refreshSlots();
            this.playSaveSuccessSound();
        } else {
            this.setResult('保存失败');
            if (this._resultLabel) this._resultLabel.color = COLOR_WARN_TEXT;
        }
    }

    /** 播放槽位点击音效 */
    private playSlotClickSound() {
        if (this.slotClickSound && this._audioSource) {
            this._audioSource.playOneShot(this.slotClickSound, 1);
        }
    }

    /** 播放存档成功音效 */
    private playSaveSuccessSound() {
        if (this.saveSuccessSound && this._audioSource) {
            this._audioSource.playOneShot(this.saveSuccessSound, 1);
        }
    }

    private onWarningYes() {
        if (this._warnContent) this._warnContent.active = false;
        if (this._pendingSlot >= 0) this.doSave(this._pendingSlot);
        this._pendingSlot = -1;
    }

    private onWarningNo() {
        if (this._warnContent) this._warnContent.active = false;
        this._pendingSlot = -1;
    }

    private onCloseClick() {
        if (this._warnContent && this._warnContent.active) {
            this._warnContent.active = false;
            this._pendingSlot = -1;
            return;
        }
        this.close();
    }
}