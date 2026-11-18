<script setup lang="ts">
import { BrandMark } from '@shitu/ui-icons'
import { APP_TITLE } from '@/router/menu'

/** 入驻外框：左侧白底文字说明（入驻流程、需要准备的材料），右侧白卡片表单 */
const STEPS = [
  { t: '验证手机号', d: '用手机号和短信验证码登录，未加入公司的手机号会进入入驻申请' },
  { t: '填写公司资料', d: '资料须与营业执照一致，提交后你就是这家公司的老板账号' },
  { t: '平台审核', d: '通常 1–2 个工作日内完成，被驳回可修改后重新提交' },
  { t: '开通使用', d: '审核通过后即可发布岗位、管理成员' },
]
const MATERIALS = [
  '营业执照',
  '劳务派遣许可证（如有，一并上传）',
  '统一社会信用代码（18 位）',
  '负责对接平台的联系人姓名',
]
</script>

<template>
  <div class="auth">
    <aside class="auth-aside">
      <div class="brand">
        <BrandMark :size="28" />
        <b>{{ APP_TITLE }}</b>
      </div>
      <h1>劳务公司入驻</h1>
      <p class="lead">驻场、人才经纪人、项目经理和老板共用一套数据，按角色看到各自该看的内容。</p>

      <section>
        <h2>入驻流程</h2>
        <ol class="steps">
          <li v-for="(s, i) in STEPS" :key="s.t">
            <span class="no">{{ i + 1 }}</span>
            <div>
              <b>{{ s.t }}</b>
              <p>{{ s.d }}</p>
            </div>
          </li>
        </ol>
      </section>

      <section>
        <h2>需要准备的材料</h2>
        <ul class="mats">
          <li v-for="m in MATERIALS" :key="m">{{ m }}</li>
        </ul>
        <p class="fmt">文件支持 JPG / PNG / PDF，单个不超过 10MB，最多 6 个。</p>
      </section>
    </aside>

    <main class="pane">
      <div class="auth-card">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth { min-height: 100vh; display: flex; background: var(--bg-page); }
.auth-aside { width: 400px; flex: none; display: flex; flex-direction: column; gap: var(--space-6); padding: var(--space-8) 40px; background: var(--bg-card); border-right: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: var(--space-2); }
.brand b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
h1 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); margin-top: var(--space-4); }
.lead { margin-top: calc(-1 * var(--space-4)); font-size: var(--font-size-body); line-height: 1.7; color: var(--text-2); }
h2 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); margin-bottom: var(--space-3); }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-4); }
.steps li { display: flex; gap: var(--space-3); }
.no { width: 24px; height: 24px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: var(--font-size-min); font-weight: var(--font-weight-semibold); background: var(--bg-fill); color: var(--text-2); }
.steps b { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.steps p { margin-top: 2px; font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
.mats { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--font-size-body); color: var(--text-1); }
.fmt { margin-top: var(--space-3); font-size: var(--font-size-aux); color: var(--text-3); }
.pane { flex: 1; min-width: 0; display: flex; align-items: flex-start; justify-content: center; padding: var(--space-8) var(--space-6); }
.auth-card { width: 680px; max-width: 100%; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-card); }
@media (max-width: 900px) { .auth-aside { display: none; } }
</style>
