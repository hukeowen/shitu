import { h } from 'vue'
import type { LucideIcon } from '@lucide/vue'

/** 全站图标的描边粗细（设计规范：线性 1.75） */
const ICON_STROKE_WIDTH = 1.75

/**
 * 把 Lucide 图标包成仕兔图标：默认描边 1.75，调用处可以用 stroke-width 覆盖。
 * 颜色（currentColor）、尺寸（24）沿用 Lucide 默认。
 * 不传 aria-label / aria-labelledby 时 Lucide 自动加 aria-hidden，装饰性图标什么都不用写；
 * 传了的图标是单独表意的，补上 role="img" 让读屏按图片读出名称。
 */
export function shituIcon(icon: LucideIcon): LucideIcon {
  return (props, { slots }) => {
    const defaults: Record<string, unknown> = {}
    if (!('strokeWidth' in props) && !('stroke-width' in props)) defaults.strokeWidth = ICON_STROKE_WIDTH
    if (('aria-label' in props || 'aria-labelledby' in props) && !('role' in props)) defaults.role = 'img'
    return h(icon, { ...defaults, ...props }, slots)
  }
}
