package com.shitu.it;

import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;

import java.time.LocalDate;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Sprint 4 端到端验收（离职与归属治理部分；计费黄金用例见 {@link BillingFlowIT}）：
 * <ol>
 *   <li>驻场发起离职 → 项目经理审核通过：任职结束、合同解除、释放至公域（R-07），驳回不影响在岗；</li>
 *   <li>公司注销：在岗结束任职、私域用户释放至公域、岗位强制下架、成员停用且无法登录（R-11）。</li>
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
class Sprint4FlowIT extends FlowItSupport {

    @Autowired
    ESignProvider esign;

    @Test
    void resignAndCompanyClosure() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "离职验收岗位", 10);

        // ---------------------------------------------------------------- 1. 离职
        String s1 = readySeeker(null);
        String u1 = userId(s1);
        employ(c, s1, job);
        String empId = jdbc.queryForObject("SELECT employment_id FROM employment WHERE user_id = ?", String.class, u1);

        long rejectId = data(call(post("/api/v1/tenant/employments/" + empId + "/resign"), c.site(),
                Map.of("resignDate", LocalDate.now().plusDays(1).toString(), "reason", "回老家"))).asLong();
        assertThat(code(call(post("/api/v1/tenant/employments/" + empId + "/resign"), c.site(),
                Map.of("resignDate", LocalDate.now().plusDays(1).toString())))).as("重复申请").isEqualTo("SYS_4090");
        assertThat(status(post("/api/v1/tenant/resign-requests/" + rejectId + "/decide"), c.site(), Map.of("approve", true)))
                .as("驻场不能审核").isEqualTo(403);
        data(call(post("/api/v1/tenant/resign-requests/" + rejectId + "/decide"), c.pm(), Map.of("approve", false, "remark", "再沟通")));
        assertThat(user(u1).get("user_status")).isEqualTo("EMPLOYED");

        long id = data(call(post("/api/v1/tenant/employments/" + empId + "/resign"), c.site(),
                Map.of("resignDate", LocalDate.now().plusDays(1).toString(), "reason", "回老家"))).asLong();
        assertThat(data(call(get("/api/v1/tenant/resign-requests?status=PENDING"), c.pm(), null)).toString()).contains(empId);
        data(call(post("/api/v1/tenant/resign-requests/" + id + "/decide"), c.pm(), Map.of("approve", true)));
        assertThat(user(u1).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(u1).get("bound_company_id")).isNull();
        assertThat(user(u1).get("last_release_reason")).isEqualTo("RESIGNED");
        Map<String, Object> emp = jdbc.queryForMap("SELECT end_date, end_reason, contract_id FROM employment WHERE employment_id = ?", empId);
        assertThat(emp.get("end_date").toString()).isEqualTo(LocalDate.now().plusDays(1).toString());
        assertThat(emp.get("end_reason")).isEqualTo("RESIGNED");
        assertThat(jdbc.queryForObject("SELECT status FROM contract WHERE contract_id = ?", String.class, emp.get("contract_id")))
                .isEqualTo("DISSOLVED");
        assertThat(data(call(get("/api/v1/seeker/work"), s1, null)).get("endDate").asText()).isNotBlank();

        // ---------------------------------------------------------------- 2. 公司注销批量解绑
        String s2 = readySeeker(null);
        employ(c, s2, job);
        String codeA = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "注销验收码"))).get("code").asText();
        String s3 = readySeeker(codeA);
        String s4 = readySeeker(null);
        apply(s4, job);
        JsonUser u2 = new JsonUser(userId(s2)), u3 = new JsonUser(userId(s3)), u4 = new JsonUser(userId(s4));
        assertThat(user(u3.id()).get("user_status")).isEqualTo("PRIVATE_PENDING");
        assertThat(user(u4.id()).get("user_status")).isEqualTo("PENDING_INTERVIEW");

        assertThat(status(post("/api/v1/ops/companies/" + c.companyId() + "/close"), c.owner(), Map.of())).isEqualTo(403);
        var r = data(call(post("/api/v1/ops/companies/" + c.companyId() + "/close"), ops,
                Map.of("status", "DEREGISTERED", "remark", "工商注销")));
        assertThat(r.get("unboundUsers").asInt()).isEqualTo(3);
        assertThat(r.get("offlineJobs").asInt()).isEqualTo(1);
        for (JsonUser u : new JsonUser[]{u2, u3, u4}) {
            assertThat(user(u.id()).get("user_status")).isEqualTo("PUBLIC_SEEKING");
            assertThat(user(u.id()).get("bound_company_id")).isNull();
            assertThat(user(u.id()).get("last_release_reason")).isEqualTo("COMPANY_CLOSED");
        }
        assertThat(jdbc.queryForObject("SELECT end_reason FROM employment WHERE user_id = ?", String.class, u2.id())).isEqualTo("COMPANY_CLOSED");
        assertThat(jdbc.queryForObject("SELECT source_company_id FROM `user` WHERE user_id = ?", String.class, u3.id()))
                .as("来源归属保留仅存证").isEqualTo(c.companyId());
        assertThat(jdbc.queryForObject("SELECT job_status FROM job WHERE job_id = ?", String.class, job)).isEqualTo("FORCE_OFFLINE");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM member WHERE company_id = ? AND status = 'NORMAL'", Long.class, c.companyId())).isZero();
        assertThat(status(get("/api/v1/tenant/me"), c.owner(), null)).as("access token 仍有效但公司已不可用")
                .isIn(200, 401);
        assertThat(code(call(get("/api/v1/tenant/projects"), c.owner(), null))).isEqualTo("TEN_4003");
    }

    @Autowired
    com.shitu.circulation.BrokerService brokers;

    @Test
    void brokerCirculation() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "流转验收岗位", 10);
        String brokerPhone = phone();
        data(call(post("/api/v1/tenant/members"), c.owner(), Map.of("name", "李文倩", "phone", brokerPhone, "roles", new String[]{"BROKER"})));
        String broker = data(tenantLogin(brokerPhone)).get("accessToken").asText();
        String code = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "流转码"))).get("code").asText();

        // 1. 匹配度不足自动入池（LOW_MATCH）→ 联系 → AI 报告 → 二次推荐 → 用户确认后报名
        String s1 = readySeeker(code);
        String u1 = userId(s1);
        JsonNodeHolder noMatch = new JsonNodeHolder(data(call(post("/api/v1/seeker/match"), s1, badAnswers())));
        assertThat(noMatch.n().get("matched").asBoolean()).isFalse();
        var pool = data(call(get("/api/v1/tenant/broker/cases"), broker, null));
        var row = find(pool, "userId", u1);
        assertThat(row.get("triggerType").asText()).isEqualTo("LOW_MATCH");
        assertThat(row.get("phoneMasked").asText()).contains("****");
        long caseId = row.get("id").asLong();
        assertThat(data(call(post("/api/v1/tenant/broker/cases/" + caseId + "/contact"), broker, null)).get("status").asText()).isEqualTo("CONTACTED");
        var report = data(call(post("/api/v1/tenant/broker/cases/" + caseId + "/report"), broker, null));
        assertThat(report.get("summary").asText()).contains("不接受进厂");
        assertThat(report.get("recommendations").toString()).contains(job);
        assertThat(code(call(get("/api/v1/seeker/jobs/" + job), s1, null))).as("推荐前不在结果中").isEqualTo("APP_4004");
        assertThat(status(post("/api/v1/tenant/broker/cases/" + caseId + "/recommend"), c.site(), Map.of("jobId", job))).isEqualTo(403);
        data(call(post("/api/v1/tenant/broker/cases/" + caseId + "/recommend"), broker, Map.of("jobId", job, "note", "离家近")));
        var recs = data(call(get("/api/v1/seeker/recommendations"), s1, null));
        assertThat(recs.get(0).get("jobId").asText()).isEqualTo(job);
        data(call(post("/api/v1/seeker/recommendations/" + recs.get(0).get("id").asLong() + "/decision"), s1, Map.of("accept", true)));
        assertThat(data(call(get("/api/v1/seeker/jobs/" + job), s1, null)).get("title").asText()).isNotBlank();
        String app = apply(s1, job);
        assertThat(jdbc.queryForObject("SELECT broker_case_id FROM application WHERE application_id = ?", Long.class, app)).isEqualTo(caseId);
        assertThat(jdbc.queryForObject("SELECT status FROM broker_case WHERE id = ?", String.class, caseId)).isEqualTo("APPLIED");

        // 2. 主动释放（必填原因）
        String s2 = readySeeker(code);
        data(call(post("/api/v1/seeker/match"), s2, badAnswers()));
        long case2 = find(data(call(get("/api/v1/tenant/broker/cases"), broker, null)), "userId", userId(s2)).get("id").asLong();
        assertThat(code(call(post("/api/v1/tenant/broker/cases/" + case2 + "/release"), broker, Map.of("reason", " ")))).isEqualTo("SYS_4000");
        data(call(post("/api/v1/tenant/broker/cases/" + case2 + "/release"), broker, Map.of("reason", "公司已有岗位用户均不满意")));
        assertThat(user(userId(s2)).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(userId(s2)).get("last_release_reason")).isEqualTo("MANUAL");

        // 3. 驻场一键流转（SITE_TRANSFER）+ 24h 未出结果自动释放（BROKER_SLA_TIMEOUT）
        String s3 = readySeeker(code);
        String u3 = userId(s3);
        data(call(post("/api/v1/tenant/seekers/" + u3 + "/transfer-to-broker"), c.site(), null));
        assertThat(find(data(call(get("/api/v1/tenant/broker/cases"), broker, null)), "userId", u3).get("triggerType").asText()).isEqualTo("SITE_TRANSFER");
        jdbc.update("UPDATE broker_case SET resolve_due_at = ?, contact_due_at = ? WHERE user_id = ? AND status = 'OPEN'",
                java.time.LocalDateTime.now().minusMinutes(1), java.time.LocalDateTime.now().minusMinutes(1), u3);
        int[] sla = brokers.enforceSla();
        assertThat(sla[1]).isGreaterThanOrEqualTo(1);
        assertThat(user(u3).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(u3).get("last_release_reason")).isEqualTo("BROKER_SLA_TIMEOUT");
    }

    record JsonNodeHolder(com.fasterxml.jackson.databind.JsonNode n) {
    }

    /** 不接受进厂：演示与测试岗位都是进厂岗位，全部被硬过滤 → 匹配不足。 */
    private Map<String, Object> badAnswers() {
        return Map.of("answers", java.util.List.of(
                Map.of("seq", 1, "code", "C"), Map.of("seq", 2, "code", "A", "region", city), Map.of("seq", 3, "code", "A"),
                Map.of("seq", 4, "code", "B"), Map.of("seq", 5, "code", "D"), Map.of("seq", 6, "code", "B"),
                Map.of("seq", 7, "code", "C")));
    }

    record JsonUser(String id) {
    }

    /** 报名 → 通过 → 确权 → 模拟签约回调 → 在岗。 */
    private void employ(Company c, String seeker, String job) throws Exception {
        String app = apply(seeker, job);
        data(call(post("/api/v1/tenant/applications/" + app + "/result"), c.site(), Map.of("pass", true)));
        String url = data(call(post("/api/v1/tenant/applications/" + app + "/confirm"), c.site(), Map.of())).get("signUrl").asText();
        String flow = url.replaceAll(".*/esign/mock/", "");
        String body = json.writeValueAsString(Map.of("flowId", flow, "action", "SIGN_FLOW_COMPLETE"));
        mvc.perform(post("/api/v1/callback/esign").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(MockESignProvider.SIGNATURE_HEADER, ((MockESignProvider) esign).sign(body)));
        assertThat(user(userId(seeker)).get("user_status")).isEqualTo("EMPLOYED");
    }
}
