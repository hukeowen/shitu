import QRCode from 'qrcode'

export function qrDataUrl(text: string, width = 240): Promise<string> {
  return QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0D1117', light: '#FFFFFF' } })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('二维码生成失败'))
    img.src = src
  })
}

/** 下载带名称说明的二维码 PNG（便于打印张贴） */
export async function downloadQrPng(opts: { url: string; title: string; subtitle?: string; filename: string }) {
  const size = 600
  const pad = 40
  const W = size + pad * 2
  const H = size + pad * 2 + 110
  const qr = await loadImage(await qrDataUrl(opts.url, size))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持导出图片')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(qr, pad, pad, size, size)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#0D1117'
  ctx.font = 'bold 34px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText(opts.title.slice(0, 20), W / 2, size + pad + 58)
  if (opts.subtitle) {
    ctx.fillStyle = '#6B7887'
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.fillText(opts.subtitle.slice(0, 40), W / 2, size + pad + 96)
  }
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${opts.filename}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
