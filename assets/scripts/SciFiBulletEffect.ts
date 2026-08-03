import { _decorator, CCFloat, CCInteger, Color, Component, Node, ParticleSystem2D, Sprite, SpriteFrame, Texture2D, UITransform, Vec2, ImageAsset, sys } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 生成一张柔和的圆形渐变贴图（白心透明羽化边）。
 * 浏览器/原生平台用 HTMLCanvas 绘制（引擎官方可靠路径），其他平台回退到内存像素数据。
 */
function createSoftCircleSpriteFrame(size: number): SpriteFrame | null {
    if (sys.isBrowser && typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);
            const img = new ImageAsset(canvas);
            const tex = new Texture2D();
            tex.image = img;
            const sf = new SpriteFrame();
            sf.texture = tex;
            return sf;
        }
    }
    return createSoftCircleSpriteFrameFromMemory(size);
}

function createSoftCircleSpriteFrameFromMemory(size: number): SpriteFrame | null {
    const data = new Uint8Array(size * size * 4);
    const half = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - half;
            const dy = y - half;
            const dist = Math.sqrt(dx * dx + dy * dy) / half;
            const alpha = Math.max(0, 1 - dist);
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.round(alpha * 255);
        }
    }
    const tex = new Texture2D();
    tex.reset({ width: size, height: size, format: Texture2D.PixelFormat.RGBA8888 });
    tex.uploadData(data, 0, 0);
    const sf = new SpriteFrame();
    sf.texture = tex;
    return sf;
}

/**
 * 星际子弹特效：白炽能量核心 + 霓虹光环 + 高能粒子拖尾（科幻感）。
 * 不依赖任何素材文件，直接挂在子弹预制体根节点上即可。
 */
@ccclass('SciFiBulletEffect')
export class SciFiBulletEffect extends Component {
    @property({ type: CCFloat, tooltip: '能量核心直径（像素）' })
    coreSize = 16;

    @property({ type: Color, tooltip: '能量核心颜色（默认冰蓝白）' })
    coreColor: Color = new Color(220, 245, 255, 255);

    @property({ type: Color, tooltip: '霓虹光环颜色（默认电青）' })
    ringColor: Color = new Color(0, 220, 255, 255);

    @property({ type: CCFloat, tooltip: '光环直径（像素，需大于核心）' })
    ringSize = 34;

    @property({ type: CCFloat, tooltip: '光环脉冲速度（每秒缩放倍数）' })
    ringPulseSpeed = 3;

    @property({ type: CCInteger, tooltip: '能量粒子每秒发射数' })
    emissionRate = 60;

    @property({ type: CCFloat, tooltip: '能量粒子寿命（秒）' })
    particleLife = 0.3;

    @property({ type: CCFloat, tooltip: '能量粒子起始尺寸（像素）' })
    startSize = 12;

    @property({ type: CCFloat, tooltip: '能量粒子结束尺寸（像素）' })
    endSize = 1;

    @property({ type: CCFloat, tooltip: '能量粒子向后飘散速度（像素/秒）' })
    trailSpeed = 50;

    @property({ type: Color, tooltip: '能量粒子起始颜色（亮青）' })
    startColor: Color = new Color(160, 240, 255, 255);

    @property({ type: Color, tooltip: '能量粒子结束颜色（透明深蓝）' })
    endColor: Color = new Color(30, 60, 200, 0);

    private _initialized = false;
    private _ringScale = 1;

    onLoad() {
        this.build();
    }

    onEnable() {
        if (!this._initialized) {
            this.build();
        }
    }

    update(dt: number) {
        if (!this._initialized) return;
        this._ringScale = 1 + Math.sin(this._ringPulsePhase) * 0.15;
        this._ringPulsePhase += this.ringPulseSpeed * dt;
        this._ringNode?.setScale(this._ringScale, this._ringScale, 1);
    }

    private _ringNode: Node | null = null;
    private _ringPulsePhase = 0;

    private build() {
        if (this._initialized) return;
        this._initialized = true;

        const sf = createSoftCircleSpriteFrame(64);

        this.buildCore(sf);
        this.buildRing(sf);
        this.buildTrail(sf);
    }

    private buildCore(sf: SpriteFrame | null) {
        if (!sf) return;
        const coreNode = new Node('core');
        this.node.addChild(coreNode);
        const ui = coreNode.addComponent(UITransform);
        ui.setContentSize(this.coreSize, this.coreSize);
        const sprite = coreNode.addComponent(Sprite);
        sprite.spriteFrame = sf;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = this.coreColor;
        sprite.srcBlendFactor = 2;
        sprite.dstBlendFactor = 4;
    }

    private buildRing(sf: SpriteFrame | null) {
        if (!sf) return;
        const ringNode = new Node('ring');
        this.node.addChild(ringNode);
        const ui = ringNode.addComponent(UITransform);
        ui.setContentSize(this.ringSize, this.ringSize);
        const sprite = ringNode.addComponent(Sprite);
        sprite.spriteFrame = sf;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = this.ringColor;
        // 光环用更透明的质感
        const c = this.ringColor.clone();
        c.a = 120;
        sprite.color = c;
        sprite.srcBlendFactor = 2;
        sprite.dstBlendFactor = 4;
        this._ringNode = ringNode;
    }

    private buildTrail(sf: SpriteFrame | null) {
        if (!sf) return;
        const ps = this.node.getComponent(ParticleSystem2D)
            ?? this.node.addComponent(ParticleSystem2D);

        ps.spriteFrame = sf;
        ps.duration = -1;
        ps.playOnLoad = true;
        ps.emissionRate = this.emissionRate;
        ps.emitterMode = 0;
        ps.life = this.particleLife;
        ps.lifeVar = 0.1;
        ps.speed = this.trailSpeed;
        ps.speedVar = 12;
        // Bullet 会把节点旋转到飞行方向（eulerAngles.z = 飞行角-90，精灵默认朝上）。
        // 粒子角度是世界空间：世界角 = ps.angle + worldRotation。
        // 设 270 使世界角 = 270 + (飞行角-90) = 飞行角 + 180，即始终朝飞行反方向飘散。
        ps.angle = 270;
        ps.angleVar = 20;
        ps.startSize = this.startSize;
        ps.startSizeVar = 4;
        ps.endSize = this.endSize;
        ps.posVar = new Vec2(1, 1);
        ps.startColor = this.startColor;
        ps.startColorVar = new Color(0, 20, 20, 0);
        ps.endColor = this.endColor;
        ps.gravity = new Vec2(0, 0);
        ps.srcBlendFactor = 2;
        ps.dstBlendFactor = 4;
    }
}
