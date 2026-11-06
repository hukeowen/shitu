/**
 * 高德地图 URI API：在微信内置浏览器中打开高德 H5，已安装 App 时可唤起导航。
 * 有坐标用 marker 定位；只有地址时按关键字搜索。
 */
export function amapLink(opts: { address?: string | null; name?: string | null; lng?: number | null; lat?: number | null }): string | null {
  const name = encodeURIComponent(opts.name || opts.address || '面试地点')
  if (opts.lng != null && opts.lat != null && Number(opts.lng) !== 0 && Number(opts.lat) !== 0) {
    return `https://uri.amap.com/marker?position=${Number(opts.lng)},${Number(opts.lat)}&name=${name}&src=shitu&coordinate=gaode&callnative=1`
  }
  if (opts.address) return `https://uri.amap.com/search?keyword=${encodeURIComponent(opts.address)}&src=shitu&callnative=1`
  return null
}
