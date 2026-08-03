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
 * 重型炮弹特效：实心金属弹头核心 + 火星四溅粒子 + 灰白烟雾尾迹。
 * 不依赖任何素材文件，直接挂在子弹预制体根节点上即可。
 */
@ccclass('HeavyCannonEffect')
export class HeavyCannonEffect extends Component {
    @property({ type: CCFloat, tooltip: '弹头直径（像素）' })
    coreSize = 26;

    @property({ type: Color, tooltip: '弹头核心颜色（默认深铁灰）' })
    coreColor: Color = new Color(60, 60, 70, 255);

    @property({ type: Color, tooltip: '弹头高光颜色（默认亮银）' })
    highlightColor: Color = new Color(230, 230, 240, 255);

    @property({ type: CCInteger, tooltip: '火星粒子每秒发射数' })
    sparkRate = 35;

    @property({ type: CCFloat, tooltip: '火星粒子寿命（秒）' })
    sparkLife = 0.35;

    @property({ type: CCFloat, tooltip: '火星粒子起始尺寸（像素）' })
    sparkStartSize = 12;

    @property({ type: CCFloat, tooltip: '火星粒子结束尺寸（像素）' })
    sparkEndSize = 2;

    @property({ type: CCFloat, tooltip: '火星飞溅速度（像素/秒）' })
    sparkSpeed = 90;

    @property({ type: Color, tooltip: '火星起始颜色（亮橙）' })
    sparkStartColor: Color = new Color(255, 200, 80, 255);

    @property({ type: Color, tooltip: '火星结束颜色（暗红）' })
    sparkEndColor: Color = new Color(160, 60, 0, 0);

    @property({ type: CCInteger, tooltip: '烟雾粒子每秒发射数' })
    smokeRate = 20;

    @property({ type: CCFloat, tooltip: '烟雾粒子寿命（秒）' })
    smokeLife = 0.6;

    @property({ type: CCFloat, tooltip: '烟雾粒子起始尺寸（像素）' })
    smokeStartSize = 18;

    @property({ type: CCFloat, tooltip: '烟雾粒子结束尺寸（像素）' })
    smokeEndSize = 30;

    @property({ type: CCFloat, tooltip: '烟雾飘散速度（像素/秒）' })
    smokeSpeed = 30;

    @property({ type: Color, tooltip: '烟雾颜色（浅灰）' })
    smokeColor: Color = new Color(200, 200, 205, 160);

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
        const ringSf = createSoftCircleSpriteFrame(64);

        this.buildCore(sf);
        this.buildSparks(sf);
        this.buildSmoke(ringSf);
    }

    private buildCore(sf: SpriteFrame | null) {
        if (!sf) return;
        // 弹头主体
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

        // 弹头内侧高光（略小，提升金属质感）
        const hlNode = new Node('highlight');
        coreNode.addChild(hlNode);
        const hlUi = hlNode.addComponent(UITransform);
        hlUi.setContentSize(this.coreSize * 0.6, this.coreSize * 0.6);
        const hlSprite = hlNode.addComponent(Sprite);
        hlSprite.spriteFrame = sf;
        hlSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        hlSprite.color = this.highlightColor;
        hlSprite.srcBlendFactor = 2;
        hlSprite.dstBlendFactor = 4;
    }

    private buildSparks(sf: SpriteFrame | null) {
        if (!sf) return;
        const sparks = new Node('sparks');
        this.node.addChild(sparks);
        const ps = sparks.addComponent(ParticleSystem2D);

        ps.spriteFrame = sf;
        ps.duration = -1;
        ps.playOnLoad = true;
        ps.emissionRate = this.sparkRate;
        ps.emitterMode = 0;
        ps.life = this.sparkLife;
        ps.lifeVar = 0.15;
        ps.speed = this.sparkSpeed;
        ps.speedVar = 25;
        // 火星向四周飞溅（世界角 = 飞行角 + 180 向后为主 + 180 锥形）
        ps.angle = 270;
        ps.angleVar = 150;
        ps.startSize = this.sparkStartSize;
        ps.startSizeVar = 4;
        ps.endSize = this.sparkEndSize;
        ps.posVar = new Vec2(2, 2);
        ps.startColor = this.sparkStartColor;
        ps.startColorVar = new Color(0, 30, 40, 0);
        ps.endColor = this.sparkEndColor;
        ps.gravity = new Vec2(0, 0);
        ps.srcBlendFactor = 2;
        ps.dstBlendFactor = 4;
    }

    private buildSmoke(sf: SpriteFrame | null) {
        if (!sf) return;
        const smoke = new Node('smoke');
        this.node.addChild(smoke);
        const ps = smoke.addComponent(ParticleSystem2D);

        ps.spriteFrame = sf;
        ps.duration = -1;
        ps.playOnLoad = true;
        ps.emissionRate = this.smokeRate;
        ps.emitterMode = 0;
        ps.life = this.smokeLife;
        ps.lifeVar = 0.2;
        ps.speed = this.smokeSpeed;
        ps.speedVar = 10;
        // 烟雾向后飘散并扩散
        ps.angle = 270;
        ps.angleVar = 40;
        ps.startSize = this.smokeStartSize;
        ps.startSizeVar = 4;
        ps.endSize = this.smokeEndSize;
        ps.posVar = new Vec2(3, 3);
        ps.startColor = this.smokeColor;
        ps.startColorVar = new Color(0, 0, 0, 0);
        ps.endColor = new Color(this.smokeColor.r, this.smokeColor.g, this.smokeColor.b, 0);
        ps.gravity = new Vec2(0, 0);
        // 烟雾用标准半透明混合
        ps.srcBlendFactor = 2;
        ps.dstBlendFactor = 4;
    }
}
