// 驻场批量操作与答题漏斗。
// 覆盖：POST /tenant/applications/batch/acknowledge（公司后台）、POST /tenant/applications/batch/arrive（驻场手机端）、
//       POST /seeker/quiz/step 与运营中台「各题进入 / 放弃人数」。
export default (h) => ({
  /**
   * 两名新求职者报名同一家公司 → 驻场在公司后台待办清单勾选两人「批量知悉」→ 驻场在手机端待面试页「批量」选两人「批量到厂确认」。
   * 自己注册求职者，不动演示数据；结束后两人停在「已到厂、等面试结果」。
   */
  async batchOps() {
    const ui = h.ui
    const one = (q) => h.sql(q)[0]?.[0]
    const channel = one("SELECT code FROM channel_code WHERE company_id = 'C10001' AND status = 'ACTIVE' LIMIT 1")
    const apps = []
    const phones = []
    for (let i = 0; i < 2; i++) {
      const p = await h.registerAndApply(channel)
      phones.push(p.phone)
      apps.push(one("SELECT application_id FROM application WHERE status = 'PENDING_INTERVIEW' ORDER BY created_at DESC LIMIT 1"))
    }
    const inList = `('${apps.join("','")}')`

    // ---- 公司后台：待知悉页签勾选两人 → 批量知悉
    await h.loginConsole('13800000003')
    await ui.goto('/admin/site/todo')
    await ui.see(apps[1])
    const boxSel = '.el-table__body td.sel-col .el-checkbox'
    for (const id of apps) {
      const nth = await ui.ev(`[...document.querySelectorAll('.el-table__body tr')].filter((r) => r.querySelector('td.sel-col .el-checkbox')).findIndex((r) => r.innerText.includes('${id}'))`)
      if (nth < 0) throw new Error('待知悉列表里找不到可勾选的 ' + id)
      await ui.clickSel(boxSel, { nth })
    }
    await ui.see('已选 2 人')
    await ui.click('批量知悉')
    await ui.see('将为 2 人推送同一份面试信息')
    await ui.click('知悉并推送（2 人）')
    await ui.see('已为 2 人推送面试信息')
    h.expectDb(`SELECT COUNT(*) FROM application WHERE application_id IN ${inList} AND acknowledged_at IS NOT NULL AND interview_at IS NOT NULL`, 2)

    // ---- 驻场手机端：待面试页 → 批量 → 选两人 → 批量到厂确认
    await h.loginStaff('13800000003')
    await ui.goto('/staff/todo')
    await ui.click('待面试')
    await ui.sleep(800)
    await ui.clickSel('button.batch-toggle')
    for (const ph of phones) {
      const tel = h.spaced(ph)
      const nth = await ui.ev(`[...document.querySelectorAll('article.app')].findIndex((c) => c.innerText.includes('${tel}') || c.innerText.includes('${ph}'))`)
      if (nth < 0) throw new Error('待面试列表里找不到 ' + ph)
      await ui.clickSel('article.app .card-check', { nth })
    }
    await ui.see('已选 2 人')
    await ui.click('批量到厂确认')
    await ui.see('请核验本人到场、人证一致')
    await ui.click('确认到厂')
    await ui.see('已确认 2 人到厂')
    h.expectDb(`SELECT COUNT(*) FROM application WHERE application_id IN ${inList} AND arrived_at IS NOT NULL`, 2)
  },

  /** 答题漏斗：一名新求职者答题，运营中台「各题进入 / 放弃人数」里第 1 题的进入人数随之增加。 */
  async quizSteps() {
    const ui = h.ui
    const entered = () => Number(h.sql('SELECT COUNT(DISTINCT user_id) FROM quiz_step WHERE seq = 1 AND biz_date >= CURDATE() - INTERVAL 6 DAY')[0][0])
    const before = entered()
    await h.registerAndApply(null) // 走完整套问卷并报名
    const after = entered()
    if (after !== before + 1) throw new Error(`答完题后第 1 题进入人数应 +1：之前 ${before}，之后 ${after}`)
    const last = Number(h.sql('SELECT MAX(seq) FROM quiz_step WHERE biz_date = CURDATE()')[0][0])
    if (last < 7) throw new Error('没有记录到最后一题，最大题号：' + last)
    await h.loginOps()
    await ui.goto('/ops/engine/quiz')
    await ui.see('各题进入 / 放弃人数')
    await ui.see('在此放弃')
    await ui.see('第 7 题')
  },
})
