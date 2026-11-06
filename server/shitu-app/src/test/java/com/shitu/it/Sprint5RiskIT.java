package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.risk.JobHealthTask;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Sprint 5 验收（风控部分）：投诉核实属实累计 3 次的岗位自动下架并扣诚信分；降权数值在公司后台和 C 端都看不到；
 * 诚信分 &lt; 30 取消收费服务权限 → 岗位移出匹配池（D-24）；三级处罚封禁；45 天未更新的岗位自动暂停并扣分。
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
class Sprint5RiskIT extends FlowItSupport {

    @Autowired
    JobHealthTask health;

    @Test
    void riskAcceptance() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "风控验收岗位", 10);

        // ---------------------------------------------------------------- 投诉：只能投诉匹配到 / 报名过的岗位
        String outsider = seekerLogin(phone(), null);
        assertThat(code(call(post("/api/v1/seeker/complaints"), outsider, Map.of("jobId", job, "category", "INFO_FALSE"))))
                .isEqualTo("APP_4004");
        long[] ids = new long[3];
        for (int i = 0; i < 3; i++) {
            String s = readySeeker(null);
            ids[i] = data(call(post("/api/v1/seeker/complaints"), s, Map.of("jobId", job, "category", "FULL_STILL_HIRING",
                    "content", "现场说已经招满"))).asLong();
            if (i == 0) {
                assertThat(code(call(post("/api/v1/seeker/complaints"), s, Map.of("jobId", job, "category", "FULL_STILL_HIRING"))))
                        .as("重复投诉").isEqualTo("SYS_4090");
            }
        }
        assertThat(status(get("/api/v1/ops/complaints"), c.owner(), null)).as("企业看不到投诉").isEqualTo(403);
        data(call(post("/api/v1/ops/complaints/" + ids[0] + "/handle"), ops, Map.of("verified", true, "remark", "电话核实属实")));
        data(call(post("/api/v1/ops/complaints/" + ids[1] + "/handle"), ops, Map.of("verified", true, "remark", "电话核实属实")));
        assertThat(jdbc.queryForObject("SELECT job_status FROM job WHERE job_id = ?", String.class, job)).isEqualTo("RECRUITING");
        data(call(post("/api/v1/ops/complaints/" + ids[2] + "/handle"), ops, Map.of("verified", true, "remark", "电话核实属实")));
        assertThat(jdbc.queryForObject("SELECT job_status FROM job WHERE job_id = ?", String.class, job)).isEqualTo("FORCE_OFFLINE");
        assertThat(credit(c)).isEqualTo(90);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM credit_score_log WHERE company_id = ? AND rule_code = 'COMPLAINT_3X'",
                Long.class, c.companyId())).isEqualTo(1);

        // ---------------------------------------------------------------- 降权数值只有平台看得到（R-14）
        String job2 = job(c, c.projectId(), "风控验收岗位二", 10);
        assertThat(data(call(get("/api/v1/tenant/jobs/" + job2), c.pm(), null)).has("matchWeight")).isFalse();
        assertThat(call(get("/api/v1/tenant/jobs?pageSize=100"), c.pm(), null).toString()).doesNotContain("matchWeight");
        JsonNode weights = data(call(get("/api/v1/ops/job-weights?companyId=" + c.companyId()), ops, null));
        assertThat(find(weights, "job_id", job2).has("match_weight")).isTrue();
        String s = readySeeker(null);
        JsonNode m = data(call(post("/api/v1/seeker/match"), s, matchReq()));
        assertThat(jobIds(m)).contains(job2);
        assertThat(m.toString()).doesNotContain("Weight").doesNotContain("weight");

        // ---------------------------------------------------------------- 诚信分 < 30 → 取消收费服务权限 → 移出匹配池
        assertThat(code(call(post("/api/v1/ops/companies/" + c.companyId() + "/credit"), ops, Map.of("delta", -65, "remark", " "))))
                .as("人工调分必须填原因").isEqualTo("SYS_4000");
        data(call(post("/api/v1/ops/companies/" + c.companyId() + "/credit"), ops, Map.of("delta", -65, "remark", "私下导流核实")));
        assertThat(credit(c)).isEqualTo(25);
        assertThat(jdbc.queryForObject("SELECT fee_rights_revoked FROM company WHERE company_id = ?", Boolean.class, c.companyId())).isTrue();
        JsonNode m2 = data(call(post("/api/v1/seeker/match"), s, matchReq()));
        assertThat(jobIds(m2)).doesNotContain(job2);

        // ---------------------------------------------------------------- 三级处罚 → 封禁
        data(call(post("/api/v1/ops/companies/" + c.companyId() + "/penalty"), ops, Map.of("level", 3, "reason", "多次虚假岗位")));
        assertThat(jdbc.queryForObject("SELECT company_status FROM company WHERE company_id = ?", String.class, c.companyId())).isEqualTo("BANNED");
        assertThat(code(call(get("/api/v1/tenant/projects"), c.pm(), null))).isEqualTo("TEN_4003");

        // ---------------------------------------------------------------- 45 天未更新 → 自动暂停 + 扣 5 分
        Company d = company();
        String stale = job(d, d.projectId(), "陈旧岗位", 5);
        jdbc.update("UPDATE job SET last_info_update_at = ? WHERE job_id = ?", LocalDateTime.now().minusDays(46), stale);
        int[] r = health.scan();
        assertThat(r[1]).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT job_status FROM job WHERE job_id = ?", String.class, stale)).isEqualTo("PAUSED");
        assertThat(credit(d)).isEqualTo(95);
    }

    private int credit(Company c) {
        return jdbc.queryForObject("SELECT credit_score FROM company WHERE company_id = ?", Integer.class, c.companyId());
    }
}
