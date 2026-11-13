/** 合成专属码海报（保存图片用）：信任蓝品牌标 + 白底二维码卡 + 成员 / 公司信息；二维码码点保持黑白（见 utils/qr.ts） */
export interface PosterInput {
  qrDataUrl: string
  name: string
  company: string
}

/** canvas 读不到 var()：运行时从 :root 取设计变量的真实色值，海报和页面跟着同一套变量走 */
function tokens() {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    primary: v('--primary'),
    primaryText: v('--primary-text'),
    primaryBg: v('--primary-bg'),
    onPrimary: v('--text-on-primary'),
    page: v('--bg-page'),
    card: v('--bg-card'),
    border: v('--border'),
    text1: v('--text-1'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    font: v('--font-sans') || 'sans-serif',
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('二维码图片加载失败'))
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

/** 品牌标：和 @shitu/ui-icons 的 BrandMark 同一造型（24 格的方块 + 拱形 + 短横），按 size 缩放 */
function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, t: ReturnType<typeof tokens>) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = t.primary
  roundRect(ctx, 1, 1, 22, 22, 6)
  ctx.fill()
  ctx.strokeStyle = t.onPrimary
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke(new Path2D('M8 17V9.5C8 7.8 9.3 6.5 11 6.5s3 1.3 3 3V17'))
  ctx.globalAlpha = 0.8
  ctx.stroke(new Path2D('M14 12h3'))
  ctx.restore()
}

export async function composePoster({ qrDataUrl, name, company }: PosterInput): Promise<string> {
  const W = 750
  const H = 1120
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持生成图片')
  const t = tokens()

  ctx.fillStyle = t.page
  ctx.fillRect(0, 0, W, H)

  // 头部：品牌标 + 「仕兔」+ 一句话
  ctx.textBaseline = 'top'
  drawBrandMark(ctx, 60, 70, 72, t)
  ctx.fillStyle = t.text1
  ctx.font = `600 56px ${t.font}`
  ctx.fillText('仕兔', 150, 76)
  ctx.fillStyle = t.primaryText
  ctx.font = `600 30px ${t.font}`
  ctx.fillText('找活儿', 280, 98)
  ctx.fillStyle = t.text2
  ctx.font = `28px ${t.font}`
  ctx.fillText('先了解你，再给你岗位 · 真实岗位 · 薪资公示', 60, 180)

  // 二维码卡：白底、1px 边框
  const cardX = 60
  const cardY = 250
  const cardW = W - 120
  const cardH = 750
  ctx.fillStyle = t.card
  roundRect(ctx, cardX, cardY, cardW, cardH, 24)
  ctx.fill()
  ctx.strokeStyle = t.border
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = t.text1
  ctx.font = `600 38px ${t.font}`
  ctx.fillText(fitText(ctx, company, cardW - 80), W / 2, cardY + 48)
  ctx.fillStyle = t.text3
  ctx.font = `28px ${t.font}`
  ctx.fillText(fitText(ctx, `驻场老师 ${name} 邀请你加入仕兔`, cardW - 80), W / 2, cardY + 104)

  // 二维码四周都是卡片白底：上下离文字 ≥ 48px、左右 105px，加上码自带的 1 模块白边，静区超过 4 个模块；码点上不压任何品牌元素。
  // 位置和大小改了要同步 tools/e2e/states.mjs 的 posterCheck
  const qr = await loadImage(qrDataUrl)
  const qrSize = 420
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(qr, (W - qrSize) / 2, cardY + 190, qrSize, qrSize)

  // 行动句：主色浅底胶囊配主色文字
  const cta = '微信扫一扫 · 注册即享 24 小时专属跟进'
  ctx.font = `600 28px ${t.font}`
  const ctaW = ctx.measureText(cta).width + 56
  ctx.fillStyle = t.primaryBg
  roundRect(ctx, (W - ctaW) / 2, cardY + 670, ctaW, 56, 28)
  ctx.fill()
  ctx.fillStyle = t.primaryText
  ctx.fillText(cta, W / 2, cardY + 684)

  ctx.fillStyle = t.text3
  ctx.font = `24px ${t.font}`
  ctx.fillText('平台仅提供匹配服务，不直接雇佣', W / 2, H - 80)
  ctx.textAlign = 'start'

  return canvas.toDataURL('image/png')
}
