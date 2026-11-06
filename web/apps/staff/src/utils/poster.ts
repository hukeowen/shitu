/** 合成专属码海报（保存图片用）：深色品牌头 + 白底二维码卡 + 成员 / 公司信息 */
export interface PosterInput {
  qrDataUrl: string
  name: string
  company: string
}

const FONT = '"PingFang SC","Microsoft YaHei",sans-serif'

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

export async function composePoster({ qrDataUrl, name, company }: PosterInput): Promise<string> {
  const W = 750
  const H = 1120
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持生成图片')

  const bg = ctx.createLinearGradient(0, 0, W * 0.6, H)
  bg.addColorStop(0, '#1D2733')
  bg.addColorStop(0.6, '#0D1117')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'top'
  ctx.fillStyle = '#E8590C'
  roundRect(ctx, 60, 70, 64, 64, 16)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = `700 34px ${FONT}`
  ctx.fillText('兔', 75, 84)
  ctx.font = `700 56px ${FONT}`
  ctx.fillText('仕兔', 146, 66)
  ctx.fillStyle = '#F6A97A'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText('找活儿', 276, 88)
  ctx.fillStyle = 'rgba(255,255,255,.62)'
  ctx.font = `28px ${FONT}`
  ctx.fillText('先了解你，再给你岗位 · 真实岗位 · 薪资公示', 60, 170)

  // 二维码卡
  const cardX = 60
  const cardY = 250
  const cardW = W - 120
  const cardH = 720
  ctx.fillStyle = '#fff'
  roundRect(ctx, cardX, cardY, cardW, cardH, 28)
  ctx.fill()

  ctx.fillStyle = '#0D1117'
  ctx.font = `700 38px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(fitText(ctx, company, cardW - 80), W / 2, cardY + 48)
  ctx.fillStyle = '#6B7887'
  ctx.font = `28px ${FONT}`
  ctx.fillText(fitText(ctx, `驻场老师 ${name} 邀请你加入仕兔`, cardW - 80), W / 2, cardY + 104)

  const qr = await loadImage(qrDataUrl)
  const qrSize = 440
  ctx.drawImage(qr, (W - qrSize) / 2, cardY + 170, qrSize, qrSize)

  ctx.fillStyle = '#B8460A'
  ctx.font = `600 28px ${FONT}`
  ctx.fillText('微信扫一扫 · 注册即享 24 小时专属跟进', W / 2, cardY + 640)

  ctx.fillStyle = 'rgba(255,255,255,.4)'
  ctx.font = `24px ${FONT}`
  ctx.fillText('平台仅提供匹配服务，不直接雇佣', W / 2, H - 90)
  ctx.textAlign = 'start'

  return canvas.toDataURL('image/png')
}
