<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, type Payslip } from '@shitu/api-client'
import { fmtAmount, fmtMonth, fmtYuan } from '@/utils/format'
import { totalDeduct } from '@/utils/payslip'

/** S-41 我的工资（C-701）：按月展示实发；最新一月置顶展示应发 / 扣款 / 实发，预支抵扣单独提醒 */
const router = useRouter()

const list = ref<Payslip[]>([])
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    list.value = [...(await seekerApi.payslips())].sort((a, b) => b.payMonth.localeCompare(a.payMonth))
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
async function onRefresh() {
  await load()
  refreshing.value = false
}

function goBack() {
  if (window.history.state?.back) router.back()
  else void router.replace('/me')
}

const latest = computed(() => list.value[0] ?? null)
const open = (p: Payslip) => router.push(`/payslips/${p.payslipId}`)
</script>

<template>
  <div class="pays">
    <header class="hero phero">
      <div class="nav">
        <button type="button" class="ico" aria-label="返回" @click="goBack"><van-icon name="arrow-left" size="20" /></button>
        <span class="ttl">我的工资</span>
        <span class="ico"></span>
      </div>
      <template v-if="latest">
        <div class="row" style="gap: 7px; margin-bottom: 6px">
          <span class="tag tag-ok">已出工资条</span>
          <span class="hm">{{ fmtMonth(latest.payMonth) }}工资</span>
        </div>
        <div class="lbl">实发工资</div>
        <div class="amt num">{{ fmtYuan(latest.netPay) }}</div>
        <div class="hstats">
          <div><span>应发</span><b class="num">{{ fmtYuan(latest.grossPay) }}</b></div>
          <div><span>扣款</span><b class="num ded">−{{ fmtYuan(totalDeduct(latest)) }}</b></div>
          <div><span>预支抵扣</span><b class="num ded">−{{ fmtYuan(latest.advanceDeduct) }}</b></div>
        </div>
      </template>
      <template v-else>
        <div class="lbl">实发工资</div>
        <div class="amt num">{{ loading ? '…' : '¥—' }}</div>
        <p class="hdesc">劳务公司导入工资表后，每月工资条会在这里展示</p>
      </template>
    </header>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="pad stack body">
        <div v-if="loading" class="acard"><van-loading size="24" vertical>加载中…</van-loading></div>
        <section v-else-if="loadError" class="acard">
          <van-empty image="error" image-size="72" :description="loadError">
            <van-button round type="primary" size="small" @click="load">重新加载</van-button>
          </van-empty>
        </section>
        <section v-else-if="!list.length" class="acard">
          <van-empty image-size="72" description="还没有工资条">
            <p class="t-xs">工资由所属劳务公司核算发放，发薪后可在这里查看明细</p>
          </van-empty>
        </section>

        <template v-else>
          <button v-if="Number(latest!.advanceDeduct) > 0" type="button" class="acard advc" @click="open(latest!)">
            <div class="acard-hd"><h4 class="adv-h">预支抵扣</h4><span class="tag tag-warn">{{ fmtMonth(latest!.payMonth) }}</span></div>
            <div class="row-b">
              <span class="t-sm adv-t">本月工资已自动抵扣薪资预支</span>
              <span class="num adv-v">−{{ fmtAmount(latest!.advanceDeduct) }}</span>
            </div>
            <div class="t-xs adv-t" style="margin-top: 6px">无需主动还款，不产生任何利息或手续费 · 查看明细 ›</div>
          </button>

          <section class="acard list">
            <div class="acard-hd hd"><h4>历史工资</h4><span class="t-xs">共 {{ list.length }} 个月</span></div>
            <button v-for="p in list" :key="p.payslipId" type="button" class="lrow" @click="open(p)">
              <div class="lt">
                <b>{{ fmtMonth(p.payMonth) }}</b>
                <span>应发 {{ fmtYuan(p.grossPay) }}<template v-if="Number(p.advanceDeduct) > 0"> · 抵扣预支 {{ fmtYuan(p.advanceDeduct) }}</template></span>
              </div>
              <div class="rv">
                <b class="num">{{ fmtYuan(p.netPay) }}</b>
                <span class="t-xs">实发</span>
              </div>
              <van-icon name="arrow" class="chev" />
            </button>
          </section>
        </template>

        <div class="note note--info">工资由所属劳务公司核算发放，平台仅展示工资条。对工资有疑问请联系驻场老师，或在「问题反馈」中提交。</div>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.pays { min-height: 100vh; background: var(--surface-2); }
.phero { padding-bottom: 26px; }
.nav { display: flex; align-items: center; justify-content: space-between; margin: 0 -6px 16px; }
.nav .ico { width: 34px; height: 34px; display: grid; place-items: center; background: none; border: 0; color: #fff; padding: 0; }
.nav .ttl { font-size: 15px; font-weight: 700; }
.hm { font-size: 11.5px; color: rgba(255, 255, 255, .55); }
.lbl { font-size: 12px; color: rgba(255, 255, 255, .6); }
.amt { font-family: var(--f-dis); font-size: 38px; font-weight: 700; line-height: 1.1; margin-top: 2px; }
.hdesc { font-size: 12px; color: rgba(255, 255, 255, .55); margin-top: 10px; }
.hstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px dashed rgba(255, 255, 255, .2); }
.hstats span { display: block; font-size: 11px; color: rgba(255, 255, 255, .55); }
.hstats b { display: block; font-size: 14.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hstats b.ded { color: var(--signal-300); }
.body { margin-top: -10px; position: relative; z-index: 2; }
button.acard { display: block; width: 100%; text-align: left; font: inherit; }
.advc { border-color: var(--signal-300); background: var(--signal-50); }
.adv-h { color: var(--signal-700) !important; }
.adv-t { color: var(--signal-700); }
.adv-v { font-size: 20px; font-weight: 700; color: var(--signal-700); flex: none; }
.list { padding: 0; overflow: hidden; }
.list .hd { padding: 14px 14px 0; margin-bottom: 4px; }
.list .lrow { border-left: 0; border-right: 0; border-top: 0; }
.lt span { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv { text-align: right; flex: none; }
.rv b { display: block; font-size: 15px; color: var(--ink-900); }
</style>
