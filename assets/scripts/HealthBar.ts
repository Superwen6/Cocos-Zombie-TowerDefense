import {
    _decorator,
    CCFloat,
    Color,
    Component,
    Node,
    Sprite,
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

    private _mode = HealthBarMode.BUILD;
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
        if (!this._started) return;

        if (this._mode === HealthBarMode.BUILD) {
            this._buildTimer += dt;
            const progress = Math.min(1, this._buildTimer / this.buildTime);
            this.updateProgress(progress);
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
        if (!parent) return;

        let hp = -1;
        let max = this._maxHp;

        const turret = parent.getComponent('Turret') as any;
        if (turret && typeof turret.hp === 'number') {
            hp = turret.hp;
            max = turret.maxHp || this._maxHp;
        }

        if (hp < 0) {
            const plant = parent.getComponent('PlantGenerator') as any;
            if (plant && typeof plant.hp === 'number') {
                hp = plant.hp;
                max = plant.maxHp || this._maxHp;
            }
        }

        if (hp < 0) {
            // BaseSystem 是全局单例，挂在 GameManagers 上而非 Base 节点
            const baseSys = BaseSystem.instance;
            if (baseSys && typeof baseSys.baseHp === 'number') {
                hp = baseSys.baseHp;
                max = baseSys.maxBaseHp || this._maxHp;
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
        if (this.backgroundSprite) this.backgroundSprite.node.active = true;
        if (this.fillSprite) this.fillSprite.node.active = true;
    }

    private hideVisuals() {
        if (this.backgroundSprite) this.backgroundSprite.node.active = false;
        if (this.fillSprite) this.fillSprite.node.active = false;
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