import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { SaveSystem, SAVE_SLOT_COUNT, getSlotSaveInfo } from './SaveSystem';

const { ccclass, property } = _decorator;

type PanelMode = 'save' | 'load';

const COLOR_DIM = new Color(0, 0, 0, 160);
const COLOR_PANEL = new Color(30, 34, 48, 245);
const COLOR_SLOT_EMPTY = new Color(58, 62, 80, 255);
const COLOR_SLOT_FULL = new Color(88, 120, 90, 255);
const COLOR_BTN = new Color(70, 78, 100, 255);
const COLOR_BTN_CLOSE = new Color(150, 60, 60, 255);
const COLOR_WARN_BG = new Color(80, 40, 40, 245);
const COLOR_TEXT = new Color(240, 240, 240, 255);
const COLOR_TEXT_DIM = new Color(170, 170, 170, 255);
const COLOR_SUCCESS = new Color(90, 255, 120, 255);
const COLOR_WARN_TEXT = new Color(255, 220, 90, 255);
const COLOR_YES_BTN = new Color(60, 130, 70, 255);
const COLOR_NO_BTN = new Color(150, 70, 70, 255);

/**
 * 多存档槽位面板（存储/载入共用，代码动态构建 UI，后续可自行替换为美术资源）。
 * - save 模式：点击空槽位直接存档；点击已有存档槽位弹出覆盖警告（是/否）。
 * - load 模式：点击已有存档槽位回调 onSelect 载入；空槽位提示不可载入。
 * 节点需常驻场景（active 保持 true），打开/关闭通过本组件控制，避免 inactive 节点 onLoad 不执行。
 */
@ccclass('SaveSlotPanelUI')
export class SaveSlotPanelUI extends Component {
    public static instance: SaveSlotPanelUI | null = null;

    /** save=游戏内存档；load=主菜单读档 */
    @property({ tooltip: '面板模式：save=游戏内存档，load=主菜单读档' })
    mode: PanelMode = 'save';

    @property({ tooltip: '面板宽度' })
    panelWidth = 720;

    @property({ tooltip: '面板高度' })
    panelHeight = 520;

    private _content: Node | null = null;
    private _resultLabel: Label | null = null;
    private _slotBgNodes: Node[] = [];
    private _slotLabels: Label[] = [];
    private _warnContent: Node | null = null;
    private _warnTextLabel: Label | null = null;
    private _pendingSlot = -1;
    private _onSelect: ((slot: number) => void) | null = null;
    private _onClose: (() => void) | null = null;

    /** 主菜单读档：点击某槽位时回调（外部设置） */
    public setSelectHandler(handler: ((slot: number) => void) | null) {
        this._onSelect = handler;
    }

    /** 关闭面板时的回调（用于主菜单恢复被隐藏的按钮） */
    public setCloseHandler(handler: (() => void) | null) {
        this._onClose = handler;
    }

    onLoad() {
        SaveSlotPanelUI.instance = this;
        this.node.active = true;
        this.buildUI();
        this.hideAll();
    }

    onDestroy() {
        if (SaveSlotPanelUI.instance === this) SaveSlotPanelUI.instance = null;
    }

    /** 打开面板（按当前模式刷新槽位显示） */
    public open() {
        if (!this._content) return;
        this.refreshSlots();
        this.setResult('');
        this.hideWarning();
        this._content.active = true;
    }

    /** 关闭面板（触发 onClose 回调） */
    public close() {
        if (this._content) this._content.active = false;
        const cb = this._onClose;
        this._onClose = null;
        if (cb) cb();
    }

    private hideAll() {
        if (this._content) this._content.active = false;
        if (this._warnContent) this._warnContent.active = false;
    }

    // ── 静态入口（供 SettingPanelUI / MainMenuUI 调用） ──

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

    public static openLoadPanel(onSelect: (slot: number) => void, onClose: () => void): SaveSlotPanelUI | null {
        const inst = SaveSlotPanelUI.instance;
        if (!inst) {
            console.warn('[SaveSlotPanelUI] 场景中未找到 SaveSlotPanelUI 实例');
            return null;
        }
        inst.mode = 'load';
        inst.setSelectHandler(onSelect);
        inst.setCloseHandler(onClose);
        inst.open();
        return inst;
    }

    public static closePanel(): void {
        SaveSlotPanelUI.instance?.close();
    }

    // ── UI 构建 ──

    private buildUI() {
        if (this._content) return;
        const root = this.node;
        if (!root.getComponent(UITransform)) root.addComponent(UITransform);
        const canvas = root.parent?.getComponent(UITransform);
        const w = canvas ? canvas.contentSize.width : 1920;
        const h = canvas ? canvas.contentSize.height : 1080;

        // 全屏遮罩
        this.createRectNode(root, w, h, COLOR_DIM, 0);

        // 面板容器
        this._content = this.createRectNode(root, this.panelWidth, this.panelHeight, COLOR_PANEL, 2);

        // 标题
        const title = this.createLabel(this._content, 'title', 28, COLOR_TEXT, 0, this.panelHeight / 2 - 40);
        title.string = this.mode === 'load' ? '载入存档' : '保存游戏进度';

        // 关闭按钮（右上角）
        const closeBtn = this.createButton(this._content, '×', 26, COLOR_BTN_CLOSE,
            this.panelWidth / 2 - 46, this.panelHeight / 2 - 44, 56, 56);
        closeBtn.on(Node.EventType.TOUCH_END, this.onCloseClick, this);

        // 槽位列表
        const slotCount = SAVE_SLOT_COUNT;
        const slotW = this.panelWidth - 120;
        const slotH = 58;
        const top = this.panelHeight / 2 - 95;
        const spacing = 76;
        for (let i = 0; i < slotCount; i++) {
            const y = top - spacing * i;
            const bg = this.createButton(this._content, `slot_${i}`, 24, COLOR_SLOT_EMPTY, 0, y, slotW, slotH);
            bg.on(Node.EventType.TOUCH_END, () => this.onSlotClick(i), this);
            const lbl = this.createLabel(bg, 'text', 24, COLOR_TEXT_DIM, 0, 0);
            this._slotBgNodes.push(bg);
            this._slotLabels.push(lbl);
        }

        // 底部结果提示（保存成功文本）
        this._resultLabel = this.createLabel(this._content, 'result', 22, COLOR_SUCCESS, 0, -this.panelHeight / 2 + 24);

        // 警告（覆盖确认）面板
        this._warnContent = this.createRectNode(root, 520, 240, COLOR_WARN_BG, 2);
        const warnTitle = this.createLabel(this._warnContent, 'warnTitle', 26, COLOR_TEXT, 0, 60);
        warnTitle.string = '确认覆盖';
        this._warnTextLabel = this.createLabel(this._warnContent, 'warnText', 22, COLOR_WARN_TEXT, 0, 10);
        const yesBtn = this.createButton(this._warnContent, 'yes', 26, COLOR_YES_BTN, -80, -90, 140, 52);
        yesBtn.on(Node.EventType.TOUCH_END, this.onWarningYes, this);
        const noBtn = this.createButton(this._warnContent, 'no', 26, COLOR_NO_BTN, 80, -90, 140, 52);
        noBtn.on(Node.EventType.TOUCH_END, this.onWarningNo, this);
        this._warnContent.active = false;
    }

    private createRectNode(parent: Node, width: number, height: number, fill: Color, borderW: number): Node {
        const node = new Node('rect');
        node.parent = parent;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, height);
        const g = node.addComponent(Graphics);
        g.fillColor = fill;
        if (borderW > 0) {
            g.lineWidth = borderW;
            g.strokeColor = new Color(255, 255, 255, 40);
        }
        g.roundRect(-width / 2, -height / 2, width, height, 8);
        g.fill();
        if (borderW > 0) g.stroke();
        return node;
    }

    private createLabel(parent: Node, name: string, fontSize: number, color: Color, x: number, y: number): Label {
        const node = new Node(name);
        node.parent = parent;
        node.setPosition(x, y, 0);
        const lbl = node.addComponent(Label);
        lbl.string = '';
        lbl.color = color;
        lbl.fontSize = fontSize;
        lbl.lineHeight = fontSize + 8;
        return lbl;
    }

    private createButton(parent: Node, text: string, fontSize: number, color: Color, x: number, y: number, w: number, h: number): Node {
        const node = this.createRectNode(parent, w, h, color, 0);
        node.name = text;
        node.setPosition(x, y, 0);
        const lbl = this.createLabel(node, 'label', fontSize, COLOR_TEXT, 0, 0);
        lbl.string = text;
        return node;
    }

    // ── 显示逻辑 ──

    private refreshSlots() {
        if (this._slotLabels.length === 0) return;
        for (let i = 0; i < this._slotLabels.length; i++) {
            const info = getSlotSaveInfo(i);
            const lbl = this._slotLabels[i];
            const g = this._slotBgNodes[i]?.getComponent(Graphics);
            if (info) {
                lbl.string = `槽位 ${i + 1} · 第${info.day}天 · ${this.formatTime(info.timestamp)}`;
                lbl.color = COLOR_TEXT;
                if (g) g.fillColor = COLOR_SLOT_FULL;
            } else {
                lbl.string = `槽位 ${i + 1} · 空槽位`;
                lbl.color = COLOR_TEXT_DIM;
                if (g) g.fillColor = COLOR_SLOT_EMPTY;
            }
        }
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

    private showWarning(text: string) {
        if (this._warnTextLabel) this._warnTextLabel.string = text;
        if (this._warnContent) this._warnContent.active = true;
    }

    private hideWarning() {
        if (this._warnContent) this._warnContent.active = false;
    }

    // ── 交互 ──

    private onSlotClick(i: number) {
        if (this.mode === 'save') {
            if (SaveSystem.hasSave(i)) {
                this._pendingSlot = i;
                this.showWarning(`槽位 ${i + 1} 已有存档，是否覆盖？`);
            } else {
                this.doSave(i);
            }
        } else {
            // load 模式
            if (SaveSystem.hasSave(i)) {
                const cb = this._onSelect;
                this.close();
                if (cb) cb(i);
            } else {
                this.setResult(`槽位 ${i + 1} 为空，无法载入`);
                if (this._resultLabel) this._resultLabel.color = COLOR_WARN_TEXT;
            }
        }
    }

    private doSave(i: number) {
        const ok = SaveSystem.save(i);
        if (ok) {
            this.setResult(`保存成功：已写入槽位 ${i + 1}`);
            if (this._resultLabel) this._resultLabel.color = COLOR_SUCCESS;
            this.refreshSlots();
        } else {
            this.setResult('保存失败');
            if (this._resultLabel) this._resultLabel.color = COLOR_WARN_TEXT;
        }
    }

    private onWarningYes() {
        this.hideWarning();
        this.doSave(this._pendingSlot);
        this._pendingSlot = -1;
    }

    private onWarningNo() {
        this.hideWarning();
        this._pendingSlot = -1;
    }

    private onCloseClick() {
        if (this._warnContent && this._warnContent.active) {
            this.hideWarning();
            this._pendingSlot = -1;
            return;
        }
        this.close();
    }
}
