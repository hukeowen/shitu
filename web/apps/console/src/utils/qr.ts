import QRCode from 'qrcode'

/** 二维码码点和底色：保持纯黑白，保证手机能扫（qrcode 库画在 canvas 上，读不到设计变量，色值登记在守卫白名单里） */
export const QR_COLOR = { dark: '#000000', light: '#FFFFFF' } as const

/**
 * 下载图的尺寸：二维码边长和四周白边。白边 64px 加上码自带的 1 个模块白边，静区不少于 4 个模块；
 * 名称和说明写在静区下面。tools/e2e/states.mjs 的 qrPng 直接读这组常量查码区和静区
 */
export const QR_POSTER = { size: 600, pad: 64 } as const

export function qrDataUrl(text: string, width = 240): Promise<string> {
  return QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M', color: { ...QR_COLOR } })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('二维码生成失败'))
    img.src = src
  })
}

/** canvas 读不到 var()：运行时从 :root 取设计变量的真实色值；读不到就报错，不静默沿用上一种颜色 */
function tokens() {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => {
    const value = cs.getPropertyValue(name).trim()
    if (!value) throw new Error(`生成图片失败：读不到设计变量 ${name}`)
    return value
  }
  return { text1: v('--text-1'), text3: v('--text-3'), font: v('--font-sans') }
}

/** 合成带名称说明的二维码图片（便于打印张贴），返回 data URL */
export async function qrPosterDataUrl(opts: { url: string; title: string; subtitle?: string }): Promise<string> {
  const t = tokens()
  const { size, pad } = QR_POSTER
  const W = size + pad * 2
  const H = W + 100
  const qr = await loadImage(await qrDataUrl(opts.url, size))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持导出图片')
  ctx.fillStyle = QR_COLOR.light
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(qr, pad, pad, size, size)
  ctx.textAlign = 'center'
  ctx.fillStyle = t.text1
  ctx.font = `600 34px ${t.font}`
  ctx.fillText(opts.title.slice(0, 20), W / 2, W + 34)
  if (opts.subtitle) {
    ctx.fillStyle = t.text3
    ctx.font = `22px ${t.font}`
    ctx.fillText(opts.subtitle.slice(0, 40), W / 2, W + 76)
  }
  return canvas.toDataURL('image/png')
}

/** 下载带名称说明的二维码 PNG */
export async function downloadQrPng(opts: { url: string; title: string; subtitle?: string; filename: string }) {
  const a = document.createElement('a')
  a.href = await qrPosterDataUrl(opts)
  a.download = `${opts.filename}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
