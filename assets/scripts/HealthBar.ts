import {
    _decorator,
    AudioClip,
    AudioSource,
    Camera,
    CCFloat,
    Color,
    Component,
    Label,
    Node,
    Sprite,
    UITransform,
    Vec3,
    log,
    view,
} from 'cc';
import { BaseSystem } from './BaseSystem';

const { ccclass, property } = _decorator;

enum HealthBarMode {
    BUILD,
    COMBAT,
}

const RED = new Color(255, 60, 60, 255);
const YELLOW = new Color(255, 220, 60, 255);
const GREEN = new Color(60, 255, 80, 255);

/**
 * 通用矩形血条/建造进度条。
 * - 建造阶段：从 0% 加载到 100%，红→黄→绿。
 * - 战斗阶段：读取父节点 hp/maxHp，自动变色与隐藏。
 */
@ccclass('HealthBar')
export class HealthBar extends Component {
    @property({ type: CCFloat, tooltip: '建造时间（秒）' })
    buildTime = 3.0;

    @property({ type: Sprite, tooltip: '血条背景' })
    backgroundSprite: Sprite | null = null;

    @property({ type: Sprite, tooltip: '填充条（FILLED / HORIZONTAL）' })
    fillSprite: Sprite | null = null;

    @property({ type: Sprite, tooltip: '血条描边框（可选）' })
    borderSprite: Sprite | null = null;

    @property({ type: Label, tooltip: '标题文本（可选，如"基地"）' })
    titleLabel: Label | null = null;

    @property({ type: Node, tooltip: '跟随目标节点（设为基座节点后血条将跟随其世界坐标显示在 Canvas 上）' })
    followTarget: Node | null = null;

    @property({ type: Camera, tooltip: '世界相机（用于跟随模式下的坐标转换）' })
    worldCamera: Camera | null = null;

    @property({ type: Vec3, tooltip: '跟随模式下的屏幕坐标偏移' })
    screenOffset: Vec3 = new Vec3(0, 80, 0);

    @property({ type: AudioClip, tooltip: '建造进度音效（循环播放直到建造完成）' })
    buildProgressSound: AudioClip | null = null;

    private _mode = HealthBarMode.BUILD;
    private _progressAudioSource: AudioSource | null = null;
    private _buildTimer = 0;
    private _hideTimer = 0;
    private _lastHp = -1;
    private _isVisible = true;
    private _maxHp = 100;
    /** 是否已启动（startBuild 调用后为 true，防止放置阶段自动运行） */
    private _started = false;
    /** 绑定的建筑节点（通过 bindParent 设置） */
    private _boundNode: Node | null = null;

    /** 绑定建筑节点，之后血条将读取该节点的 hp/maxHp */
    public bindParent(parentNode: Node) {
        this._boundNode = parentNode;
    }

    onLoad() {
        this._progressAudioSource = this.node.addComponent(AudioSource);
        this._progressAudioSource.loop = true;
    }

    /** 组件启动时，若跟随目标是 Base，则直接进入战斗模式显示血量 */
    start() {
        if (this.followTarget?.name === 'Base') {
            this._started = true;
            this._mode = HealthBarMode.COMBAT;
            this._isVisible = true;
            this.showVisuals();
        }
    }

    /** 启动建造进度 */
    public startBuild(buildTime?: number) {
        if (buildTime != null && buildTime > 0) {
            this.buildTime = buildTime;
        }
        this._started = true;
        this._mode = HealthBarMode.BUILD;
        this._buildTimer = 0;
        this._hideTimer = 0;
        this._isVisible = true;
        this.showVisuals();
        this.updateProgress(0);

        // 播放建造进度音效
        if (this.buildProgressSound && this._progressAudioSource) {
            this._progressAudioSource.clip = this.buildProgressSound;
            this._progressAudioSource.play();
        }
    }

    /** 更新建造进度（0~1） */
    public updateProgress(progress: number) {
        const p = Math.max(0, Math.min(1, progress));
        if (this.fillSprite && this.fillSprite.spriteFrame) {
            this.fillSprite.fillRange = p;
        }
        this.updateBuildColor(p);
    }

    /** 建造完成，切换到战斗血量模式 */
    public finishBuild() {
        this._started = true;
        this._mode = HealthBarMode.COMBAT;
        this._hideTimer = 0;
        this._isVisible = true;
        this.showVisuals();

        // 停止建造进度音效
        this._progressAudioSource?.stop();
    }

    /** 显示血条（外部调用，如受到攻击时） */
    public show() {
        if (!this._isVisible) {
            this._isVisible = true;
            this.showVisuals();
        }
        this._hideTimer = 0;
    }

    update(dt: number) {
        // 跟随模式：将目标世界坐标转换为 Canvas 局部坐标（Canvas 父节点下跳过跟随，固定位置）
        if (this.followTarget && this.followTarget.isValid && this.worldCamera
            && this.node.parent?.name !== 'Canvas') {
            const worldPos = this.followTarget.worldPosition;
            const screenPos = this.worldCamera.worldToScreen(worldPos);

            const canvas = this.node.parent;
            if (canvas) {
                const canvasTransform = canvas.getComponent(UITransform);
                if (canvasTransform) {
                    const designSize = canvasTransform.contentSize;
                    const visibleSize = view.getVisibleSize();
                    const scaleX = designSize.width / visibleSize.width;
                    const scaleY = designSize.height / visibleSize.height;
                    this.node.position = new Vec3(
                        (screenPos.x - visibleSize.width / 2) * scaleX + this.screenOffset.x,
                        (screenPos.y - visibleSize.height / 2) * scaleY + this.screenOffset.y,
                        0,
                    );
                }
            }
        }

        if (!this._started) return;

        if (this._mode === HealthBarMode.BUILD) {
            this._buildTimer += dt;
            const progress = Math.min(1, this._buildTimer / this.buildTime);
            this.updateProgress(progress);

            // 进度达到100%时停止音效
            if (progress >= 1 && this._progressAudioSource?.playing) {
                this._progressAudioSource.stop();
            }
            return;
        }

        // 战斗模式：持续同步血量
        this.syncHealth();

        // 自动隐藏：血量 100% 且持续 3 秒未受攻击后隐藏
        if (this._isVisible && this._lastHp >= this._maxHp) {
            this._hideTimer += dt;
            if (this._hideTimer >= 3) {
                this.hideVisuals();
                this._isVisible = false;
            }
        }
    }

    /** 从绑定的建筑节点同步血量 */
    private syncHealth() {
        const parent = this._boundNode;

        let hp = -1;
        let max = this._maxHp;

        if (parent) {
            const turret = parent.getComponent('Turret') as any;
            if (turret && typeof turret.hp === 'number') {
                hp = turret.hp;
                max = turret.maxHp || this._maxHp;
            }
        }

        if (hp < 0 && parent) {
            const plant = parent.getComponent('PlantGenerator') as any;
            if (plant && typeof plant.hp === 'number') {
                hp = plant.hp;
                max = plant.maxHp || this._maxHp;
            }
        }

        if (hp < 0 && parent) {
            const container = parent.getComponent('Container') as any;
            if (container && typeof container.hp === 'number') {
                hp = container.hp;
                max = container.maxHp || this._maxHp;
            }
        }

        if (hp < 0 && (this.isBaseNode(parent) || this.followTarget?.name === 'Base')) {
            // BaseSystem 是全局单例，挂在 GameManagers 上而非 Base 节点
            const baseSys = BaseSystem.instance;
            if (baseSys && typeof baseSys.baseHp === 'number') {
                hp = baseSys.baseHp;
                max = baseSys.maxBaseHp || this._maxHp;
                log(`[HealthBar] syncHealth Base: hp=${hp}, maxBaseHp=${baseSys.maxBaseHp}, max=${max}, _maxHp=${this._maxHp}`);
            }
        }

        if (hp < 0) return;

        this._maxHp = max;
        this._lastHp = hp;

        const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
        this.updateHealthUI(ratio);

        if (hp < max) {
            this.show();
        }
    }

    /** 判断节点是否为 Base 或其子孙节点 */
    private isBaseNode(node: Node): boolean {
        if (!node || !node.isValid) return false;
        let current: Node | null = node;
        while (current) {
            if (current.name === 'Base') return true;
            current = current.parent;
        }
        return false;
    }

    /** 更新血量 UI */
    private updateHealthUI(ratio: number) {
        if (this.fillSprite && this.fillSprite.spriteFrame) {
            this.fillSprite.fillRange = ratio;
        }
        this.updateHealthColor(ratio);
    }

    /** 建造颜色渐变：红(0) → 黄(0.5) → 绿(1) */
    private updateBuildColor(progress: number) {
        if (!this.fillSprite) return;
        if (progress < 0.5) {
            this.fillSprite.color = lerpColor(RED, YELLOW, progress / 0.5);
        } else {
            this.fillSprite.color = lerpColor(YELLOW, GREEN, (progress - 0.5) / 0.5);
        }
    }

    /** 血量颜色：红(<40%) → 黄(40%-70%) → 绿(>70%) */
    private updateHealthColor(ratio: number) {
        if (!this.fillSprite) return;
        if (ratio < 0.4) {
            this.fillSprite.color = lerpColor(RED, YELLOW, ratio / 0.4);
        } else if (ratio < 0.7) {
            this.fillSprite.color = lerpColor(YELLOW, GREEN, (ratio - 0.4) / 0.3);
        } else {
            this.fillSprite.color = GREEN.clone();
        }
    }

    private showVisuals() {
        if (this.backgroundSprite && this.backgroundSprite.node) this.backgroundSprite.node.active = true;
        if (this.fillSprite && this.fillSprite.node) this.fillSprite.node.active = true;
        if (this.borderSprite && this.borderSprite.node) this.borderSprite.node.active = true;
        if (this.titleLabel && this.titleLabel.node) this.titleLabel.node.active = true;
    }

    private hideVisuals() {
        if (this.backgroundSprite && this.backgroundSprite.node) this.backgroundSprite.node.active = false;
        if (this.fillSprite && this.fillSprite.node) this.fillSprite.node.active = false;
        if (this.borderSprite && this.borderSprite.node) this.borderSprite.node.active = false;
        if (this.titleLabel && this.titleLabel.node) this.titleLabel.node.active = false;
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