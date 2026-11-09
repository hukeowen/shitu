package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** 看板与报表：数字正确、按角色授权、老板总览不含个人明细（R-13）、跨公司隔离。 */
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
class ReportIT extends FlowItSupport {

    @Autowired
    ESignProvider esign;

    @Test
    void reports() throws Exception {
        Company c = company();
        Company other = company();
        String job = job(c, c.projectId(), "报表岗位", 10);
        String code = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "报表海报"))).get("code").asText();

        String s1 = readySeeker(code);
        employ(c, s1, job);
        String s2 = readySeeker(code);
        apply(s2, job); // 待面试
        JsonNode byDeadline = data(call(get("/api/v1/tenant/applications?status=PENDING_INTERVIEW&sort=DEADLINE"), c.site(), null));
        assertThat(byDeadline.get("total").asLong()).isEqualTo(1);
        assertThat(status(get("/api/v1/tenant/applications?sort=CREATED_DESC"), c.owner(), null)).isEqualTo(200);

        // ---------------------------------------------------------------- 项目经理看板
        JsonNode board = data(call(get("/api/v1/tenant/reports/board"), c.pm(), null));
        assertThat(board.get("employed").asLong()).isEqualTo(1);
        assertThat(board.get("hiredThisMonth").asLong()).isEqualTo(1);
        assertThat(board.get("pendingInterview").asLong()).isEqualTo(1);
        assertThat(board.get("recruitingJobs").asLong()).isEqualTo(1);
        assertThat(data(call(get("/api/v1/tenant/reports/board"), other.pm(), null)).get("employed").asLong())
                .as("跨公司隔离").isZero();

        // ---------------------------------------------------------------- 老板总览：只有聚合
        assertThat(status(get("/api/v1/tenant/reports/overview"), c.pm(), null)).isEqualTo(403);
        JsonNode ov = data(call(get("/api/v1/tenant/reports/overview"), c.owner(), null));
        assertThat(ov.get("totalHired").asLong()).isEqualTo(1);
        assertThat(ov.get("employed").asLong()).isEqualTo(1);
        assertThat(find(ov.get("projects"), "projectId", c.projectId()).get("employed").asLong()).isEqualTo(1);
        String userId = userId(s1);
        assertThat(ov.toString()).doesNotContain(userId).doesNotContain("phone").doesNotContain("id_card");

        // ---------------------------------------------------------------- 渠道转化漏斗
        JsonNode ch = find(data(call(get("/api/v1/tenant/reports/channels"), c.owner(), null)), "code", code);
        assertThat(ch.get("registrations").asLong()).isEqualTo(2);
        assertThat(ch.get("applied").asLong()).isEqualTo(2);
        assertThat(ch.get("hired").asLong()).isEqualTo(1);
        assertThat(status(get("/api/v1/tenant/reports/channels"), c.site(), null)).isEqualTo(403);
        assertThat(data(call(get("/api/v1/tenant/reports/channels"), other.owner(), null)).toString()).doesNotContain(code);

        // ---------------------------------------------------------------- 运营总览
        JsonNode p = data(call(get("/api/v1/ops/reports/overview"), ops, null));
        assertThat(p.get("employed").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(p.get("registeredToday").asLong()).isGreaterThanOrEqualTo(2);
        assertThat(p.has("yesterday")).isTrue();
        assertThat(status(get("/api/v1/ops/reports/overview"), c.owner(), null)).isEqualTo(403);
    }

    private void employ(Company c, String seeker, String job) throws Exception {
        String app = apply(seeker, job);
        data(call(post("/api/v1/tenant/applications/" + app + "/arrive"), c.site(), Map.of()));
        data(call(post("/api/v1/tenant/applications/" + app + "/result"), c.site(), Map.of("pass", true)));
        String url = data(call(post("/api/v1/tenant/applications/" + app + "/confirm"), c.site(), Map.of())).get("signUrl").asText();
        JsonNode one = data(call(get("/api/v1/tenant/applications/" + app), c.site(), null));
        assertThat(one.get("arrivedAt").isNull()).isFalse();
        assertThat(one.get("contract").get("status").asText()).isEqualTo("PENDING_SIGN");
        assertThat(one.get("contract").get("signUrl").asText()).isEqualTo(url);
        String flow = url.replaceAll(".*/esign/mock/", "");
        String body = json.writeValueAsString(Map.of("flowId", flow, "action", "SIGN_FLOW_COMPLETE"));
        mvc.perform(post("/api/v1/callback/esign").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(MockESignProvider.SIGNATURE_HEADER, ((MockESignProvider) esign).sign(body)));
        assertThat(user(userId(seeker)).get("user_status")).isEqualTo("EMPLOYED");
    }
}
