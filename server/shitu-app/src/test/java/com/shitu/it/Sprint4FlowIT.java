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
