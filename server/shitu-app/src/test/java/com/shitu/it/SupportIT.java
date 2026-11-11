package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.notify.outbox.OutboxDispatcher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** C-508 问题反馈：提交 → 运营中台处理 → 站内信回复；只能看到自己的；公司后台不能访问；入驻审核结果通知老板。 */
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
class SupportIT extends FlowItSupport {

    @Autowired
    OutboxDispatcher dispatcher;

    @Test
    void feedbackFlow() throws Exception {
        Company c = company();
        String s = readySeeker(null);
        String other = readySeeker(null);

        // 校验：类型、长度
        assertThat(code(call(post("/api/v1/seeker/feedback"), s, Map.of("category", "NOPE", "content", "岗位信息和实际不一样")))).isEqualTo("SYS_4000");
        assertThat(code(call(post("/api/v1/seeker/feedback"), s, Map.of("category", "JOB", "content", "短")))).isEqualTo("SYS_4000");

        long id = data(call(post("/api/v1/seeker/feedback"), s,
                Map.of("category", "JOB", "content", "岗位写的包吃住，到了才说住宿要自费", "contact", "13900001234"))).asLong();
        JsonNode mine = data(call(get("/api/v1/seeker/feedback"), s, null));
        assertThat(mine.size()).isEqualTo(1);
        assertThat(mine.get(0).get("status").asText()).isEqualTo("OPEN");
        assertThat(data(call(get("/api/v1/seeker/feedback"), other, null)).size()).as("只能看到自己的反馈").isZero();

        // 公司后台、求职者都不能访问平台工单
        assertThat(status(get("/api/v1/ops/feedback"), c.owner(), null)).isIn(401, 403);
        assertThat(status(get("/api/v1/ops/feedback"), s, null)).isIn(401, 403);

        JsonNode row = find(data(call(get("/api/v1/ops/feedback?status=OPEN"), ops, null)), "id", String.valueOf(id));
        assertThat(row.get("contact").asText()).isEqualTo("13900001234");
        assertThat(row.get("phoneMasked").asText()).contains("****");
        assertThat(row.toString()).doesNotContain("phone_enc").doesNotContain("phoneEnc");

        assertThat(code(call(post("/api/v1/ops/feedback/" + id + "/reply"), ops, Map.of("reply", " ")))).isEqualTo("SYS_4000");
        data(call(post("/api/v1/ops/feedback/" + id + "/reply"), ops, Map.of("reply", "已联系该公司核实，住宿费将退还。")));
        assertThat(code(call(post("/api/v1/ops/feedback/" + id + "/reply"), ops, Map.of("reply", "重复处理")))).isEqualTo("SYS_4090");
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/seeker/feedback"), s, null)).get(0).get("reply").asText()).contains("住宿费将退还");
        assertThat(data(call(get("/api/v1/seeker/messages"), s, null)).toString()).contains("问题反馈已回复");

        // 入驻审核通过通知老板（company() 里已审核通过）
        assertThat(data(call(get("/api/v1/tenant/messages"), c.owner(), null)).toString()).contains("入驻审核");
    }

    @Test
    void injuryReportFlow() throws Exception {
        // T-405：驻场上报 → 老板、项目经理收到最高优先级站内信 → 项目经理结案；别的项目的驻场看不到
        Company c = company();
        Company other = company();
        String at = java.time.LocalDateTime.now().minusMinutes(10).withNano(0).toString();
        Map<String, Object> req = Map.of("projectId", c.projectId(), "personName", "赵大勇", "severity", "SERIOUS",
                "occurredAt", at, "detail", "冲压车间操作时左手被夹伤，已送昆山市第一人民医院");
        assertThat(status(post("/api/v1/tenant/incidents"), c.owner(), req)).as("老板不上报").isEqualTo(403);
        assertThat(code(call(post("/api/v1/tenant/incidents"), c.site(), Map.of("projectId", c.projectId2(), "personName", "赵大勇",
                "severity", "SERIOUS", "occurredAt", at, "detail", "不在自己负责的项目上报")))).as("驻场只能报自己的项目").isNotEqualTo("0");
        assertThat(code(call(post("/api/v1/tenant/incidents"), other.site(), req))).as("不能报别家公司的项目").isNotEqualTo("0");
        long id = data(call(post("/api/v1/tenant/incidents"), c.site(), req)).asLong();
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/tenant/messages"), c.owner(), null)).toString()).contains("工伤").contains("赵大勇");
        assertThat(data(call(get("/api/v1/tenant/messages"), c.site(), null)).toString()).as("上报人自己不收").doesNotContain("赵大勇");
        assertThat(jdbc.queryForObject("SELECT MAX(priority) FROM notification WHERE content LIKE '%赵大勇%'", Integer.class)).isEqualTo(2);

        assertThat(find(data(call(get("/api/v1/tenant/incidents?status=OPEN"), c.owner(), null)), "id", String.valueOf(id))
                .get("reportedByName").asText()).isEqualTo("王磊");
        assertThat(data(call(get("/api/v1/tenant/incidents"), other.owner(), null)).toString()).doesNotContain("赵大勇");
        assertThat(status(post("/api/v1/tenant/incidents/" + id + "/close"), c.site(), Map.of("note", "已处理"))).isEqualTo(403);
        assertThat(code(call(post("/api/v1/tenant/incidents/" + id + "/close"), other.owner(), Map.of("note", "越权结案")))).isEqualTo("SYS_4040");
        data(call(post("/api/v1/tenant/incidents/" + id + "/close"), c.owner(), Map.of("note", "已申报工伤认定，医疗费由公司垫付")));
        assertThat(code(call(post("/api/v1/tenant/incidents/" + id + "/close"), c.owner(), Map.of("note", "重复结案")))).isEqualTo("SYS_4090");
        assertThat(find(data(call(get("/api/v1/tenant/incidents"), c.site(), null)), "id", String.valueOf(id)).get("status").asText()).isEqualTo("CLOSED");
    }

    @Test
    void applicationInsight() throws Exception {
        // M-04：报名详情带画像标签、匹配记录、本公司历史报名；别家公司拿不到
        Company c = company();
        Company other = company();
        String jobId = job(c, c.projectId(), "画像测试岗位", 5);
        String s = readySeeker(null);
        String appId = apply(s, jobId);
        JsonNode in = data(call(get("/api/v1/tenant/applications/" + appId + "/insight"), c.site(), null));
        assertThat(in.get("profileTags").size()).isGreaterThan(3);
        assertThat(in.get("matchRecords").get(0).get("source").asBoolean()).isTrue();
        assertThat(find(in.get("matchRecords").get(0).get("jobs"), "jobId", jobId).get("appliedJob").asBoolean()).isTrue();
        assertThat(in.get("history").size()).isZero();
        assertThat(code(call(get("/api/v1/tenant/applications/" + appId + "/insight"), other.owner(), null))).isNotEqualTo("0");
        assertThat(status(get("/api/v1/tenant/applications/" + appId + "/insight"), s, null)).isIn(401, 403);
    }
}
