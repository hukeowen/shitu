package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.notify.outbox.OutboxDispatcher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** T-305 / C-409：岗位级条目命中、跨公司不串、未命中回流待补并通知、补充答案后通知提问人、权限范围。 */
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
class KnowledgeIT extends FlowItSupport {

    @Autowired
    OutboxDispatcher dispatcher;

    @Test
    void knowledgeBase() throws Exception {
        Company c = company();
        Company other = company();
        String job = job(c, c.projectId(), "知识库岗位", 10);
        String job2 = job(c, c.projectId2(), "知识库岗位二", 10);
        String otherJob = job(other, other.projectId(), "别家岗位", 10);

        // ---------------------------------------------------------------- 维护：作用域与权限
        assertThat(code(call(post("/api/v1/tenant/kb"), c.pm(), entry(null, null, "公司有没有社保", "入职当月起缴纳五险。"))))
                .as("公司通用条目只有老板能建").isEqualTo("SYS_4030");
        data(call(post("/api/v1/tenant/kb"), c.owner(), entry(null, null, "公司有没有社保", "入职当月起缴纳五险。")));
        long jobEntry = data(call(post("/api/v1/tenant/kb"), c.pm(), entry(null, job, "宿舍几个人一间", "6 人间，有空调和独立卫浴，水电自理。"))).asLong();
        assertThat(code(call(post("/api/v1/tenant/kb"), other.pm(), entry(null, job, "宿舍", "别家来改"))))
                .as("别家公司不能给本公司岗位建条目").isEqualTo("SYS_4040");
        data(call(post("/api/v1/tenant/kb"), other.owner(), entry(null, otherJob, "夜班补贴多少", "别家：夜班每天 30 元。")));
        assertThat(status(get("/api/v1/tenant/kb"), c.site(), null)).isEqualTo(403);
        JsonNode list = data(call(get("/api/v1/tenant/kb?jobId=" + job), c.pm(), null));
        assertThat(list).hasSize(1);
        assertThat(list.get(0).get("projectId").asText()).as("岗位条目自动归到岗位所在项目").isEqualTo(c.projectId());

        // ---------------------------------------------------------------- 问答：命中岗位条目 / 公司通用条目
        String s = readySeeker(null);
        JsonNode a1 = data(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s, Map.of("question", "宿舍是几个人一间呀")));
        assertThat(a1.get("answered").asBoolean()).isTrue();
        assertThat(a1.get("answer").asText()).contains("6 人间");
        JsonNode a2 = data(call(post("/api/v1/seeker/jobs/" + job2 + "/ask"), s, Map.of("question", "有没有社保")));
        assertThat(a2.get("answer").asText()).contains("五险");
        JsonNode a3 = data(call(post("/api/v1/seeker/jobs/" + job2 + "/ask"), s, Map.of("question", "宿舍几个人一间")));
        assertThat(a3.get("answer").asText()).as("岗位条目不串到同公司其他岗位").doesNotContain("6 人间");
        JsonNode a4 = data(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s, Map.of("question", "夜班补贴多少")));
        assertThat(a4.get("answered").asBoolean()).as("不串到别家公司").isFalse();

        // ---------------------------------------------------------------- 未命中 → 待补充 → 通知项目经理
        String s2 = readySeeker(null);
        data(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s2, Map.of("question", "夜班补贴多少")));
        data(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s2, Map.of("question", "夜班补贴多少")));
        JsonNode pending = data(call(get("/api/v1/tenant/kb/pending"), c.pm(), null));
        JsonNode item = find(pending, "question", "夜班补贴多少");
        assertThat(item.get("askedTimes").asLong()).as("同一人重复提问只记一次").isEqualTo(2);
        assertThat(data(call(get("/api/v1/tenant/kb/pending"), other.pm(), null)).toString()).doesNotContain(job);
        while (dispatcher.dispatch() > 0) { }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notification WHERE template_code = 'KB_QUESTION_PENDING' "
                + "AND content LIKE '%夜班补贴多少%' AND recipient_id IN (SELECT member_id FROM member WHERE company_id = ?)", Long.class, c.companyId())).as("同一问题只通知一次").isEqualTo(1);

        // ---------------------------------------------------------------- 补充答案 → 两位提问人都收到回复，之后直接命中
        data(call(post("/api/v1/tenant/kb/pending/" + item.get("id").asLong() + "/answer"), c.pm(),
                Map.of("answer", "夜班每天补贴 40 元，当月随工资发放。")));
        assertThat(data(call(get("/api/v1/tenant/kb/pending"), c.pm(), null)).toString()).doesNotContain("夜班补贴多少");
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/seeker/messages"), s, null)).toString()).contains("40 元");
        assertThat(data(call(get("/api/v1/seeker/messages"), s2, null)).toString()).contains("40 元");
        assertThat(data(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s2, Map.of("question", "夜班补贴多少")))
                .get("answer").asText()).contains("40 元");

        // ---------------------------------------------------------------- 忽略 / 删除
        data(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s2, Map.of("question", "老板帅不帅")));
        long junk = find(data(call(get("/api/v1/tenant/kb/pending"), c.pm(), null)), "question", "老板帅不帅").get("id").asLong();
        data(call(post("/api/v1/tenant/kb/pending/" + junk + "/ignore"), c.pm(), null));
        assertThat(data(call(get("/api/v1/tenant/kb/pending"), c.pm(), null)).toString()).doesNotContain("老板帅不帅");
        assertThat(code(call(delete("/api/v1/tenant/kb/" + jobEntry), other.owner(), null))).isEqualTo("SYS_4040");
        data(call(delete("/api/v1/tenant/kb/" + jobEntry), c.pm(), null));
        assertThat(data(call(get("/api/v1/tenant/kb?jobId=" + job), c.pm(), null)).toString()).doesNotContain("6 人间");
        assertThat(code(call(post("/api/v1/seeker/jobs/" + job + "/ask"), s, Map.of("question", "?")))).isEqualTo("SYS_4000");
    }

    private static Map<String, Object> entry(String projectId, String jobId, String q, String a) {
        Map<String, Object> m = new HashMap<>();
        m.put("projectId", projectId);
        m.put("jobId", jobId);
        m.put("question", q);
        m.put("answer", a);
        return m;
    }
}
