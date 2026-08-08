import { _decorator, CCFloat, CCInteger, Color, Component, Node, ParticleSystem2D, Sprite, SpriteFrame, Texture2D, UITransform, Vec2, ImageAsset, sys } from 'cc';

const { ccclass, property } = _decorator;

// 贴图缓存：所有实例共享，避免每颗子弹重复生成 64x64 纹理
const _spriteFrameCache = new Map<string, SpriteFrame | null>();
const _textureSizes = new Map<string, number>();

function getCachedSpriteFrame(key: string, create: () => SpriteFrame | null): SpriteFrame | null {
    if (_spriteFrameCache.has(key)) {
        return _spriteFrameCache.get(key)!;
    }
    const sf = create();
    _spriteFrameCache.set(key, sf);
    return sf;
}

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

/**
 * 生成彗尾贴图：竖直锥形渐细条（顶部宽、靠近头部），向下渐窄渐透明（远离头部）。
 */
function createCometTailSpriteFrame(size: number): SpriteFrame | null {
    if (sys.isBrowser && typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            for (let y = 0; y < size; y++) {
                // t: 0=末端(底部), 1=靠近头部(顶部)
                const t = 1 - y / size;
                const halfW = size * 0.46 * t;
                const alpha = Math.min(0.75, t * t * 1.2);
                if (halfW < 0.4 || alpha <= 0.01) continue;
                ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
                ctx.fillRect(size / 2 - halfW, y, halfW * 2, 1);
            }
            const img = new ImageAsset(canvas);
            const tex = new Texture2D();
            tex.image = img;
            const sf = new SpriteFrame();
            sf.texture = tex;
            return sf;
        }
    }
    return createCometTailSpriteFrameFromMemory(size);
}

function createCometTailSpriteFrameFromMemory(size: number): SpriteFrame | null {
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
        const t = 1 - y / size;
        const halfW = size * 0.46 * t;
        const alpha = Math.min(0.75, t * t * 1.2);
        for (let x = 0; x < size; x++) {
            const dx = Math.abs(x - half);
            if (dx > halfW) continue;
            const fade = Math.max(0, 1 - dx / halfW);
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.round(alpha * fade * 255);
        }
    }
    const tex = new Texture2D();
    tex.reset({ width: size, height: size, format: Texture2D.PixelFormat.RGBA8888 });
    tex.uploadData(data, 0, 0);
    const sf = new SpriteFrame();
    sf.texture = tex;
    return sf;
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

    @property({ type: Color, tooltip: '彗尾颜色（默认电青）' })
    ringColor: Color = new Color(0, 220, 255, 255);

    @property({ type: CCFloat, tooltip: '彗尾长度（像素）' })
    ringSize = 50;

    @property({ type: CCFloat, tooltip: '彗尾最大宽度（像素）' })
    ringPulseSpeed = 8;

    @property({ type: CCInteger, tooltip: '能量粒子每秒发射数' })
    emissionRate = 60;

    @property({ type: CCFloat, tooltip: '能量粒子寿命（秒）' })
    particleLife = 0.3;

    @property({ type: CCFloat, tooltip: '能量粒子起始尺寸（像素）' })
    startSize = 6;

    @property({ type: CCFloat, tooltip: '能量粒子结束尺寸（像素）' })
    endSize = 1;

    @property({ type: CCFloat, tooltip: '能量粒子向后飘散速度（像素/秒）' })
    trailSpeed = 50;

    @property({ type: Color, tooltip: '能量粒子起始颜色（亮青）' })
    startColor: Color = new Color(160, 240, 255, 255);

    @property({ type: Color, tooltip: '能量粒子结束颜色（透明深蓝）' })
    endColor: Color = new Color(30, 60, 200, 0);

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

        const sf = getCachedSpriteFrame('softCircle_64', () => createSoftCircleSpriteFrame(64));
        const tailSf = getCachedSpriteFrame('cometTail_64', () => createCometTailSpriteFrame(64));

        this.buildCore(sf);
        this.buildTail(tailSf);
        this.buildTrail(sf);
    }

    private buildCore(sf: SpriteFrame | null) {
        if (!sf) return;
        const coreNode = new Node('core');
        this.node.addChild(coreNode);
        const ui = coreNode.addComponent(UITransform);
        const sprite = coreNode.addComponent(Sprite);
        sprite.spriteFrame = sf;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = this.coreColor;
        sprite.srcBlendFactor = 2;
        sprite.dstBlendFactor = 4;
        // 必须在设置 spriteFrame 之后设置尺寸：设置 spriteFrame 时
        // Sprite 会按 sizeMode(TRIMMED 默认) 把 contentSize 重置为贴图原始尺寸。
        ui.setContentSize(this.coreSize, this.coreSize);
    }

    /**
     * 彗尾：位于核心正后方（节点局部 -y 方向），沿飞行反方向拉伸渐细。
     */
    private buildTail(sf: SpriteFrame | null) {
        if (!sf) return;
        const tailNode = new Node('cometTail');
        // Bullet 旋转后精灵默认朝上(+y)即飞行方向，故尾巴放在 -y 一侧。
        tailNode.setPosition(0, -(this.coreSize / 2 + this.ringSize / 2), 0);
        this.node.addChild(tailNode);
        const ui = tailNode.addComponent(UITransform);
        const sprite = tailNode.addComponent(Sprite);
        sprite.spriteFrame = sf;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = this.ringColor;
        sprite.srcBlendFactor = 2;
        sprite.dstBlendFactor = 4;
        // 必须在设置 spriteFrame 之后设置尺寸（见 buildCore 注释）
        ui.setContentSize(this.ringPulseSpeed, this.ringSize);
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
        ps.speedVar = 10;
        // 粒子发射位置收拢在核心附近，避免四散成毛球。
        ps.posVar = new Vec2(0.5, 0.5);
        // Bullet 会把节点旋转到飞行方向（eulerAngles.z = 飞行角-90，精灵默认朝上）。
        // 粒子角度是世界空间：世界角 = ps.angle + worldRotation。
        // 设 270 使世界角 = 270 + (飞行角-90) = 飞行角 + 180，即始终朝飞行反方向飘散。
        ps.angle = 270;
        // 角度收拢，粒子集中成一条向后延伸的光带。
        ps.angleVar = 6;
        ps.startSize = this.startSize;
        ps.startSizeVar = 3;
        ps.endSize = this.endSize;
        ps.startColor = this.startColor;
        ps.startColorVar = new Color(0, 20, 20, 0);
        ps.endColor = this.endColor;
        ps.gravity = new Vec2(0, 0);
        ps.srcBlendFactor = 2;
        ps.dstBlendFactor = 4;
    }
}
