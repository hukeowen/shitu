import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_TYPES, ROUTES } from './routes.mjs'

test('每个截图条目都能按规范页面类型浏览', () => {
  for (const row of ROUTES) {
    assert.ok(row.types?.length, `${row.file} 缺少页面类型`)
    for (const type of row.types) assert.ok(PAGE_TYPES[type], `${row.file} 的类型 ${type} 未登记`)
  }
})

test('同页多种排法保留在各自分类，启动屏不混入工作台', () => {
  const types = (app, route) => ROUTES.find((r) => r.app === app && r.route === route && r.name !== 'splash')?.types
  assert.deepEqual(types('console', '/site/home'), ['dashboard', 'list-detail'])
  assert.deepEqual(types('staff', '/advance'), ['card-list', 'review'])
  assert.deepEqual(ROUTES.find((r) => r.name === 'splash').types, ['login'])
})
