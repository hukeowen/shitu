package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import com.shitu.lifecycle.seeker.FollowUpReminderTask;
import com.shitu.notify.outbox.OutboxDispatcher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * Sprint 3 端到端验收（docs/03 Sprint 3「验收」）：
 * <ol>
 *   <li>到厂 → 面试通过 → 确权发起电子签 → <b>签约回调重复 / 并发推送只入职一次</b>；伪造签名的回调被拒绝；</li>
 *   <li>签约完成后项目经理和老板都收到推送；</li>
 *   <li><b>爽约、取消、面试未通过</b>三条路径都正确回补名额并按规则释放（爽约 → 公域；未通过 / 取消 → 回到报名前归属 D-31）；</li>
 *   <li>人员管理、内部调岗、请假旷工标记；24h 窗口内的跟进提醒（J-03）。</li>
 * </ol>
 */
@EnabledIfEnvironmentVariable(named = "SHITU_IT", matches = "true")
@SpringBootTest(properties = {
        FlowItSupport.IT_DB,
        "shitu.sms.expose-code-in-mock=true",
        "shitu.sms.captcha-after-per-ip=100000",
        "shitu.sms.ip-hourly-limit=100000",
        "shitu.ops.init-password=ItSuper2026",
        "shitu.scheduling.enabled=false",
        "shitu.storage.local-dir=./target/it-uploads"
})
@AutoConfigureMockMvc
class Sprint3FlowIT extends FlowItSupport {

    @Autowired
    ESignProvider esign;
    @Autowired
    OutboxDispatcher dispatcher;
    @Autowired
    com.shitu.app.support.ContractExpiryTask contractExpiry;
    @Autowired
    FollowUpReminderTask followUps;

    @Test
    void sprint3Acceptance() throws Exception {
        Company c = company();
        String jobA = job(c, c.projectId(), "确权验收岗位", 10);
        String jobB = job(c, c.projectId2(), "调岗目标岗位", 5);

        // ---------------------------------------------------------------- 1. 到厂 → 通过 → 确权 → 签约回调（幂等）
        String sA = readySeeker(null);
        String uA = userId(sA);
        String appA = apply(sA, jobA);
        int quotaAfterApply = quota(jobA);
        JsonNode row = data(call(get("/api/v1/tenant/applications/" + appA), c.site(), null));
        assertThat(row.get("allowedActions").toString()).contains("ARRIVE", "PASS", "FAIL", "NO_SHOW", "CANCEL");
        data(call(post("/api/v1/tenant/applications/" + appA + "/arrive"), c.site(), null));
        assertThat(data(call(get("/api/v1/tenant/applications/" + appA), c.site(), null)).get("allowedActions").toString())
                .doesNotContain("ARRIVE");
        // 今日到厂筛选与计数（北京日历日）
        assertThat(data(call(get("/api/v1/tenant/applications?status=PENDING_INTERVIEW&arrivedToday=true"), c.site(), null))
                .get("records").toString()).contains(appA);
        assertThat(data(call(get("/api/v1/tenant/site/workbench"), c.site(), null)).get("arrivedToday").asLong()).isEqualTo(1);
        data(call(post("/api/v1/tenant/applications/" + appA + "/result"), c.site(), Map.of("pass", true)));
        assertThat(user(uA).get("user_status")).isEqualTo("PENDING_CONFIRM");
        assertThat(jdbc.queryForObject("SELECT stage FROM response_window WHERE user_id = ? AND status = 'OPEN'", String.class, uA))
                .isEqualTo("PENDING_CONFIRM");
        assertThat(data(call(get("/api/v1/tenant/applications/" + appA), c.site(), null)).get("allowedActions").toString())
                .contains("CONFIRM");

        JsonNode contract = data(call(post("/api/v1/tenant/applications/" + appA + "/confirm"), c.site(),
                Map.of("startDate", LocalDate.now().toString(), "employeeNo", "KS-0001")));
        assertThat(contract.get("status").asText()).isEqualTo("PENDING_SIGN");
        // 重发：旧流程作废，新流程生效
        JsonNode resent = data(call(post("/api/v1/tenant/applications/" + appA + "/confirm"), c.site(),
                Map.of("startDate", LocalDate.now().toString(), "employeeNo", "KS-0001")));
        assertThat(jdbc.queryForObject("SELECT status FROM contract WHERE contract_id = ?", String.class,
                contract.get("contractId").asText())).isEqualTo("VOIDED");
        JsonNode pending = data(call(get("/api/v1/seeker/contracts/pending"), sA, null));
        assertThat(pending.get("contractId").asText()).isEqualTo(resent.get("contractId").asText());
        assertThat(pending.get("signUrl").asText()).contains("/esign/mock/");
        String flowId = pending.get("signUrl").asText().replaceAll(".*/esign/mock/", "");
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/seeker/messages"), sA, null)).toString()).contains("请签署劳动合同");

        // 伪造签名的回调被拒绝
        String cb = json.writeValueAsString(Map.of("flowId", flowId, "action", "SIGN_FLOW_COMPLETE"));
        assertThat(mvc.perform(post("/api/v1/callback/esign").contentType(MediaType.APPLICATION_JSON).content(cb)
                .header(MockESignProvider.SIGNATURE_HEADER, "forged")).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(user(uA).get("user_status")).isEqualTo("PENDING_CONFIRM");

        // 同一回调并发推送 8 次 + 事后再推 1 次：只入职一次
        String sig = ((MockESignProvider) esign).sign(cb);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Integer>> fs = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            fs.add(pool.submit(() -> {
                go.await();
                return mvc.perform(post("/api/v1/callback/esign").contentType(MediaType.APPLICATION_JSON).content(cb)
                        .header(MockESignProvider.SIGNATURE_HEADER, sig)).andReturn().getResponse().getStatus();
            }));
        }
        go.countDown();
        for (Future<Integer> f : fs) {
            assertThat(f.get()).isEqualTo(200);
        }
        pool.shutdown();
        mvc.perform(post("/api/v1/callback/esign").contentType(MediaType.APPLICATION_JSON).content(cb)
                .header(MockESignProvider.SIGNATURE_HEADER, sig));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM employment WHERE user_id = ?", Long.class, uA)).isEqualTo(1);
        assertThat(user(uA).get("user_status")).isEqualTo("EMPLOYED");
        assertThat(user(uA).get("bound_company_id")).isEqualTo(c.companyId());
        Map<String, Object> emp = jdbc.queryForMap("SELECT employee_no, is_transfer, source_company_id_snapshot, start_date FROM employment WHERE user_id = ?", uA);
        assertThat(emp.get("employee_no")).isEqualTo("KS-0001");
        assertThat(emp.get("source_company_id_snapshot")).isEqualTo("PLATFORM");
        assertThat(emp.get("is_transfer")).isEqualTo(true);
        assertThat(jdbc.queryForObject("SELECT status FROM contract WHERE esign_flow_id = ?", String.class, flowId)).isEqualTo("EFFECTIVE");
        assertThat(jdbc.queryForObject("SELECT status FROM application WHERE application_id = ?", String.class, appA)).isEqualTo("EMPLOYED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM response_window WHERE user_id = ? AND status = 'OPEN'", Long.class, uA)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM user_status_log WHERE user_id = ? AND event = 'CONTRACT_SIGNED'", Long.class, uA)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT decay_reset_at FROM job WHERE job_id = ?", LocalDateTime.class, jobA)).isNotNull();
        assertThat(quota(jobA)).as("入职不回补名额").isEqualTo(quotaAfterApply);

        // ---------------------------------------------------------------- 2. 签约完成推送项目经理 + 老板
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/tenant/messages"), c.pm(), null)).toString()).contains("签约完成");
        assertThat(data(call(get("/api/v1/tenant/messages"), c.owner(), null)).toString()).contains("签约完成");
        assertThat(data(call(get("/api/v1/seeker/work"), sA, null)).get("employeeNo").asText()).isEqualTo("KS-0001");
        assertThat(data(call(get("/api/v1/seeker/contracts"), sA, null)).get(0).get("status").asText()).isEqualTo("EFFECTIVE");

        // 合同到期（J-13）：剩 20 天 → 只补「30 天」这一档，不连发；重跑不重复；过期 → 已到期并通知项目经理
        String cid = jdbc.queryForObject("SELECT contract_id FROM contract WHERE esign_flow_id = ?", String.class, flowId);
        jdbc.update("UPDATE contract SET term_end = ? WHERE contract_id = ?", java.time.LocalDate.now().plusDays(20), cid);
        contractExpiry.run();
        contractExpiry.run();
        while (dispatcher.dispatch() > 0) { }
        assertThat(jdbc.queryForObject("SELECT expiry_reminded FROM contract WHERE contract_id = ?", Integer.class, cid)).isEqualTo(30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notification WHERE template_code = 'CONTRACT_EXPIRING_SEEKER' AND recipient_id = ?",
                Integer.class, userId(sA))).as("只提醒一次").isEqualTo(1);
        assertThat(data(call(get("/api/v1/seeker/messages"), sA, null)).toString()).contains("20 天后");
        assertThat(data(call(get("/api/v1/tenant/messages"), c.pm(), null)).toString()).contains("员工合同即将到期");
        jdbc.update("UPDATE contract SET term_end = ? WHERE contract_id = ?", java.time.LocalDate.now().minusDays(1), cid);
        contractExpiry.run();
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/seeker/contracts"), sA, null)).get(0).get("status").asText()).isEqualTo("EXPIRED");
        assertThat(data(call(get("/api/v1/tenant/messages"), c.pm(), null)).toString()).contains("员工合同已到期");
        assertThat(data(call(get("/api/v1/seeker/work"), sA, null)).get("employeeNo").asText()).as("任职不受影响").isEqualTo("KS-0001");
        jdbc.update("UPDATE contract SET status = 'EFFECTIVE', ended_at = NULL, term_end = ? WHERE contract_id = ?",
                java.time.LocalDate.now().plusYears(1), cid);

        // ---------------------------------------------------------------- 3a. 面试未通过：公域用户回公域，私域用户回私域（D-31），名额 +1
        String sB = readySeeker(null);
        String appB = apply(sB, jobA);
        int q = quota(jobA);
        assertThat(code(call(post("/api/v1/tenant/applications/" + appB + "/result"), c.site(), Map.of("pass", false))))
                .as("未通过必须填原因").isEqualTo("LC_4004");
        data(call(post("/api/v1/tenant/applications/" + appB + "/result"), c.site(), Map.of("pass", false, "remark", "体检不合格")));
        assertThat(user(userId(sB)).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(userId(sB)).get("bound_company_id")).isNull();
        assertThat(quota(jobA)).isEqualTo(q + 1);

        String codeA = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "验收码"))).get("code").asText();
        String sC = readySeeker(codeA);
        String uC = userId(sC);
        String appC = apply(sC, jobA);
        q = quota(jobA);
        data(call(post("/api/v1/tenant/applications/" + appC + "/result"), c.site(), Map.of("pass", false, "remark", "技能不符")));
        assertThat(user(uC).get("user_status")).isEqualTo("PRIVATE_PENDING");
        assertThat(user(uC).get("bound_company_id")).isEqualTo(c.companyId());
        assertThat(jdbc.queryForObject("SELECT stage FROM response_window WHERE user_id = ? AND status = 'OPEN'", String.class, uC))
                .isEqualTo("PRIVATE_PENDING");
        assertThat(quota(jobA)).isEqualTo(q + 1);
        assertThat(jdbc.queryForObject("SELECT status FROM application WHERE application_id = ?", String.class, appC)).isEqualTo("INTERVIEW_FAILED");

        // ---------------------------------------------------------------- 3b. 爽约：仅驻场可标记，释放至公域，名额 +1
        data(call(post("/api/v1/seeker/match"), sC, matchReq()));
        String appC2 = apply(sC, jobA);
        q = quota(jobA);
        assertThat(status(post("/api/v1/tenant/applications/" + appC2 + "/no-show"), c.owner(), Map.of())).as("老板不能标记爽约").isEqualTo(403);
        // D-60：项目经理也能标记爽约
        data(call(post("/api/v1/tenant/applications/" + appC2 + "/no-show"), c.pm(), Map.of()));
        assertThat(code(call(post("/api/v1/tenant/applications/" + appC2 + "/no-show"), c.site(), Map.of()))).as("已处置的不能再标").isNotEqualTo("0");
        assertThat(user(uC).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(uC).get("bound_company_id")).isNull();
        assertThat(user(uC).get("last_release_reason")).isEqualTo("NO_SHOW");
        assertThat(quota(jobA)).isEqualTo(q + 1);

        // ---------------------------------------------------------------- 3c. 后台取消：必须填原因；回到报名前归属，名额 +1
        String sD = readySeeker(codeA);
        String uD = userId(sD);
        String appD = apply(sD, jobA);
        q = quota(jobA);
        assertThat(code(call(post("/api/v1/tenant/applications/" + appD + "/cancel"), c.pm(), Map.of("reason", " ")))).isEqualTo("SYS_4000");
        data(call(post("/api/v1/tenant/applications/" + appD + "/cancel"), c.pm(), Map.of("reason", "用户要求换岗")));
        assertThat(user(uD).get("user_status")).isEqualTo("PRIVATE_PENDING");
        assertThat(quota(jobA)).isEqualTo(q + 1);
        assertThat(jdbc.queryForObject("SELECT end_operator_id IS NOT NULL FROM application WHERE application_id = ?", Boolean.class, appD)).isTrue();

        // ---------------------------------------------------------------- 4. 人员管理、调岗、请假旷工
        JsonNode staff = data(call(get("/api/v1/tenant/employments?active=true"), c.pm(), null));
        JsonNode me = find(staff.get("records"), "userId", uA);
        assertThat(me.get("source").asText()).isEqualTo("PLATFORM");
        assertThat(me.has("phone")).as("项目经理看不到手机号").isFalse();
        assertThat(find(data(call(get("/api/v1/tenant/employments"), c.site(), null)).get("records"), "userId", uA).get("phone").asText()).hasSize(11);
        String empId = me.get("employmentId").asText();
        assertThat(status(post("/api/v1/tenant/employments/" + empId + "/transfer"), c.site(), Map.of("projectId", c.projectId2()))).isEqualTo(403);
        data(call(post("/api/v1/tenant/employments/" + empId + "/transfer"), c.pm(), Map.of("projectId", c.projectId2(), "jobId", jobB)));
        assertThat(jdbc.queryForObject("SELECT project_id FROM employment WHERE employment_id = ?", String.class, empId)).isEqualTo(c.projectId2());
        assertThat(user(uA).get("user_status")).as("调岗不改变在岗状态").isEqualTo("EMPLOYED");
        data(call(put("/api/v1/tenant/employments/" + empId + "/absences"), c.pm(), Map.of("date", LocalDate.now().toString(), "type", "LEAVE")));
        data(call(put("/api/v1/tenant/employments/" + empId + "/absences"), c.pm(), Map.of("date", LocalDate.now().toString(), "type", "ABSENT")));
        assertThat(jdbc.queryForObject("SELECT absence_type FROM duty_absence WHERE employment_id = ?", String.class, empId)).isEqualTo("ABSENT");
        assertThat(code(call(put("/api/v1/tenant/employments/" + empId + "/absences"), c.pm(),
                Map.of("date", LocalDate.now().plusDays(1).toString(), "type", "LEAVE")))).isEqualTo("SYS_4000");

        // ---------------------------------------------------------------- 5. 24h 窗口内的跟进提醒（J-03）
        jdbc.update("UPDATE follow_up_reminder SET remind_at = ? WHERE status = 'PLANNED' AND window_id = "
                + "(SELECT id FROM response_window WHERE user_id = ? AND status = 'OPEN') ORDER BY round_no LIMIT 1",
                LocalDateTime.now().minusMinutes(1), uD);
        assertThat(followUps.sendDue()).isGreaterThanOrEqualTo(1);
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/tenant/messages"), c.site(), null)).toString()).contains("24h 跟进提醒");
    }
}
