import QRCode from 'qrcode'

/** 二维码码点和底色：保持纯黑白，保证手机能扫（qrcode 库画在 canvas 上，读不到设计变量，色值登记在守卫白名单里） */
export const QR_COLOR = { dark: '#000000', light: '#FFFFFF' } as const

/** 按链接生成二维码图片（data URL），四周留 1 个模块的白边，外面再由卡片的白底补足静区 */
export function qrDataUrl(text: string, width: number): Promise<string> {
  return QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M', color: { ...QR_COLOR } })
}
