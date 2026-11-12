// 截图：node shot.mjs <name> <url> [mobile]   （Chrome 已以 --remote-debugging-port=9888 启动）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTab } from './cdp.mjs'
import { VIEWPORT } from './routes.mjs'

const [, , name, url, mobile] = process.argv
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')
fs.mkdirSync(DIR, { recursive: true })
const b = await openTab(mobile ? VIEWPORT.mobile : VIEWPORT.desktop)
await b.send('Network.clearBrowserCookies')
await b.send('Page.navigate', { url })
await b.settle()
const shot = await b.send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(DIR, name + '.png'), Buffer.from(shot.result.data, 'base64'))
if (b.events.length) console.log('errors:', b.events)
await b.close()
process.exit(0)
