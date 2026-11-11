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
}
