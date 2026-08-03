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
 * 火焰子弹特效：运行时动态生成圆形渐变贴图，组合「核心火球 Sprite + 2D 粒子火焰尾迹」。
 * 不依赖任何素材文件，直接挂在子弹预制体根节点上即可。
 */
@ccclass('FlameBulletEffect')
export class FlameBulletEffect extends Component {
    @property({ type: CCFloat, tooltip: '核心火球直径（像素）' })
    coreSize = 22;

    @property({ type: Color, tooltip: '核心火球颜色（默认橙黄）' })
    coreColor: Color = new Color(255, 170, 60, 255);

    @property({ type: CCInteger, tooltip: '火焰粒子每秒发射数' })
    emissionRate = 40;

    @property({ type: CCFloat, tooltip: '火焰粒子寿命（秒）' })
    particleLife = 0.45;

    @property({ type: CCFloat, tooltip: '火焰粒子起始尺寸（像素）' })
    startSize = 16;

    @property({ type: CCFloat, tooltip: '火焰粒子结束尺寸（像素）' })
    endSize = 3;

    @property({ type: CCFloat, tooltip: '火焰粒子向后飘散速度（像素/秒）' })
    trailSpeed = 40;

    @property({ type: Color, tooltip: '火焰粒子起始颜色（亮黄）' })
    startColor: Color = new Color(255, 215, 110, 255);

    @property({ type: Color, tooltip: '火焰粒子结束颜色（橙红半透明）' })
    endColor: Color = new Color(255, 80, 0, 0);

    private _initialized = false;

    onLoad() {
        this.build();
    }

    onEnable() {
        if (!this._initialized) {
            this.build();
        }
    }

    private build() {
        if (this._initialized) return;
        this._initialized = true;

        const sf = createSoftCircleSpriteFrame(64);

        this.buildCore(sf);
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
        ps.lifeVar = 0.2;
        ps.speed = this.trailSpeed;
        ps.speedVar = 12;
        // Bullet 会把节点旋转到飞行方向（eulerAngles.z = 飞行角-90，精灵默认朝上）。
        // 粒子角度是世界空间：世界角 = ps.angle + worldRotation。
        // 设 270 使世界角 = 270 + (飞行角-90) = 飞行角 + 180，即始终朝飞行反方向飘散。
        ps.angle = 270;
        ps.angleVar = 28;
        ps.startSize = this.startSize;
        ps.startSizeVar = 5;
        ps.endSize = this.endSize;
        ps.posVar = new Vec2(2, 2);
        ps.startColor = this.startColor;
        ps.startColorVar = new Color(0, 30, 40, 0);
        ps.endColor = this.endColor;
        ps.gravity = new Vec2(0, 0);
        ps.srcBlendFactor = 2;
        ps.dstBlendFactor = 4;
    }
}
