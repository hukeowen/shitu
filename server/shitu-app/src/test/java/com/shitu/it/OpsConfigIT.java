package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.shitu.notify.outbox.OutboxDispatcher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * 平台中台配置：引擎参数版本化（校验 / 发布即生效 / 回滚）、实名申诉复核（身份证占用找回、失信申诉）与黑名单、通知模板（变量白名单）。
 * 引擎参数与模板是全局配置：测试结束前恢复原状，避免影响其他测试。
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
class OpsConfigIT extends FlowItSupport {

    @Autowired
    OutboxDispatcher dispatcher;

    @Test
    void engineParameters() throws Exception {
        int original = data(call(get("/api/v1/ops/engine/versions"), ops, null)).findValues("status").stream()
                .map(JsonNode::asText).toList().indexOf("ACTIVE");
        JsonNode versions = data(call(get("/api/v1/ops/engine/versions"), ops, null));
        int activeId = versions.get(original).get("versionId").asInt();
        // 清理上一轮遗留草稿
        for (JsonNode v : versions) {
            if ("DRAFT".equals(v.get("status").asText())) {
                data(call(delete("/api/v1/ops/engine/versions/" + v.get("versionId").asInt()), ops, null));
            }
        }
        JsonNode draft = data(call(post("/api/v1/ops/engine/drafts"), ops, null));
        int draftId = draft.get("versionId").asInt();
        assertThat(draft.get("status").asText()).isEqualTo("DRAFT");
        assertThat(code(call(post("/api/v1/ops/engine/drafts"), ops, null))).as("只能有一个草稿").isEqualTo("SYS_4090");
        try {
            ObjectNode bad = draft.get("config").deepCopy();
            ((ObjectNode) bad.get("factorWeights")).put("jobType", 29);
            assertThat(call(put("/api/v1/ops/engine/versions/" + draftId), ops, bad).get("message").asText()).contains("100");
            ObjectNode bad2 = draft.get("config").deepCopy();
            bad2.put("maxPerCompanyPublic", 99);
            assertThat(code(call(put("/api/v1/ops/engine/versions/" + draftId), ops, bad2))).isEqualTo("SYS_4000");
            ObjectNode bad3 = draft.get("config").deepCopy();
            ((ObjectNode) bad3.get("decay").get(0)).put("maxDays", 999);
            assertThat(code(call(put("/api/v1/ops/engine/versions/" + draftId), ops, bad3))).as("分档上限必须递增").isEqualTo("SYS_4000");

            ObjectNode good = draft.get("config").deepCopy();
            good.put("resultCount", 1);
            good.put("maxPerCompanyPublic", 1);
            data(call(put("/api/v1/ops/engine/versions/" + draftId), ops, good));
            data(call(post("/api/v1/ops/engine/versions/" + draftId + "/publish"), ops, null));

            // 发布即生效：新的匹配用新版本、最多 1 条结果
            Company c = company();
            job(c, c.projectId(), "引擎参数岗位一", 5);
            job(c, c.projectId(), "引擎参数岗位二", 5);
            String s = readySeeker(null);
            JsonNode m = data(call(post("/api/v1/seeker/match"), s, matchReq()));
            assertThat(jobIds(m)).hasSizeLessThanOrEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT engine_version_id FROM match_session WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
                    Integer.class, userId(s))).isEqualTo(draftId);
        } finally {
            data(call(post("/api/v1/ops/engine/versions/" + activeId + "/publish"), ops, null));
        }
        JsonNode after = data(call(get("/api/v1/ops/engine/versions/" + activeId), ops, null));
        assertThat(after.get("status").asText()).as("回滚到原版本").isEqualTo("ACTIVE");
        assertThat(data(call(get("/api/v1/ops/engine/versions/" + draftId), ops, null)).get("status").asText()).isEqualTo("ARCHIVED");
    }

    @Test
    void kycAppealsAndBlacklist() throws Exception {
        // 原账号 A 用身份证 X 实名；B（同一个人换了号）实名被拦截 → 申诉 → 通过后 A 解除实名，B 可以重新实名
        String a = seekerLogin(phone(), null);
        String id = idCard(30);
        data(call(post("/api/v1/seeker/kyc"), a, Map.of("realName", "李娜", "idCard", id, "idCardConfirm", id)));
        String b = seekerLogin(phone(), null);
        assertThat(code(call(post("/api/v1/seeker/kyc"), b, Map.of("realName", "李娜", "idCard", id, "idCardConfirm", id))))
                .isEqualTo("APP_4007");
        assertThat(code(call(post("/api/v1/seeker/kyc/appeals"), b, Map.of("type", "BLACKLIST_APPEAL", "remark", "x"))))
                .as("没有失信记录不能申诉").isEqualTo("SYS_4000");
        long reviewId = data(call(post("/api/v1/seeker/kyc/appeals"), b, Map.of("type", "ID_OCCUPIED_APPEAL",
                "remark", "原手机号已停用，现用新号码"))).asLong();
        assertThat(code(call(post("/api/v1/seeker/kyc/appeals"), b, Map.of("type", "ID_OCCUPIED_APPEAL", "remark", "再交一次"))))
                .isEqualTo("SYS_4090");
        JsonNode item = find(data(call(get("/api/v1/ops/kyc-reviews?status=PENDING"), ops, null)), "id", String.valueOf(reviewId));
        assertThat(item.get("occupant").get("userId").asText()).isEqualTo(userId(a));
        assertThat(item.get("occupant").get("releasable").asBoolean()).isTrue();
        assertThat(item.toString()).doesNotContain(id);
        data(call(post("/api/v1/ops/kyc-reviews/" + reviewId + "/decide"), ops, Map.of("approve", true, "remark", "电话核实为本人")));
        assertThat(code(call(post("/api/v1/ops/kyc-reviews/" + reviewId + "/decide"), ops, Map.of("approve", true, "remark", "again"))))
                .isEqualTo("SYS_4090");
        assertThat(jdbc.queryForObject("SELECT kyc_status FROM `user` WHERE user_id = ?", String.class, userId(a))).isEqualTo("NONE");
        assertThat(data(call(post("/api/v1/seeker/kyc"), b, Map.of("realName", "李娜", "idCard", id, "idCardConfirm", id)))
                .get("kycStatus").asText()).isEqualTo("VERIFIED");
        while (dispatcher.dispatch() > 0) { }
        assertThat(data(call(get("/api/v1/seeker/messages"), b, null)).toString()).contains("重新提交实名");
        assertThat(data(call(get("/api/v1/seeker/kyc/appeals"), b, null)).get(0).get("status").asText()).isEqualTo("APPROVED");

        // 黑名单 → 失信申诉 → 解除
        String bid = userId(b);
        long blId = data(call(post("/api/v1/ops/blacklist"), ops, Map.of("userId", bid, "reasonCode", "FRAUD", "detail", "冒名报名"))).asLong();
        assertThat(jdbc.queryForObject("SELECT blacklist_flag FROM `user` WHERE user_id = ?", Boolean.class, bid)).isEqualTo(true);
        assertThat(data(call(get("/api/v1/seeker/kyc"), b, null)).get("canApply").asBoolean()).isFalse();
        long appeal = data(call(post("/api/v1/seeker/kyc/appeals"), b, Map.of("type", "BLACKLIST_APPEAL", "remark", "非本人操作"))).asLong();
        JsonNode bl = find(data(call(get("/api/v1/ops/kyc-reviews?type=BLACKLIST_APPEAL"), ops, null)), "id", String.valueOf(appeal));
        assertThat(bl.get("blacklist").get(0).get("reasonCode").asText()).isEqualTo("FRAUD");
        data(call(post("/api/v1/ops/kyc-reviews/" + appeal + "/decide"), ops, Map.of("approve", true, "remark", "核实为误判")));
        assertThat(jdbc.queryForObject("SELECT blacklist_flag FROM `user` WHERE user_id = ?", Boolean.class, bid)).isEqualTo(false);
        assertThat(find(data(call(get("/api/v1/ops/blacklist"), ops, null)), "id", String.valueOf(blId)).get("status").asText())
                .isEqualTo("LIFTED");

        // 人工拉黑 → 手动解除
        long bl2 = data(call(post("/api/v1/ops/blacklist"), ops, Map.of("userId", bid, "reasonCode", "UNPAID_ADVANCE", "detail", "预支未还"))).asLong();
        assertThat(code(call(post("/api/v1/ops/blacklist/" + bl2 + "/lift"), ops, Map.of("remark", " ")))).isEqualTo("SYS_4000");
        data(call(post("/api/v1/ops/blacklist/" + bl2 + "/lift"), ops, Map.of("remark", "已还清")));
        assertThat(jdbc.queryForObject("SELECT blacklist_flag FROM `user` WHERE user_id = ?", Boolean.class, bid)).isEqualTo(false);
    }

    @Test
    void notifyTemplates() throws Exception {
        JsonNode list = data(call(get("/api/v1/ops/notify-templates"), ops, null));
        JsonNode t = find(list, "templateCode", "KB_ANSWERED");
        assertThat(t.get("variables").toString()).contains("jobTitle").contains("answer");
        String title = t.get("title").asText();
        String content = t.get("content").asText();
        try {
            JsonNode bad = call(put("/api/v1/ops/notify-templates/KB_ANSWERED"), ops, Map.of("content", "你好 ${userName}"));
            assertThat(code(bad)).isEqualTo("SYS_4000");
            assertThat(bad.get("message").asText()).contains("${userName}");
            assertThat(code(call(put("/api/v1/ops/notify-templates/KB_ANSWERED"), ops, Map.of("channels", List.of("WECHAT")))))
                    .isEqualTo("SYS_4000");
            JsonNode pv = data(call(post("/api/v1/ops/notify-templates/KB_ANSWERED/preview"), ops,
                    Map.of("content", "「${jobTitle}」回复：${answer}")));
            assertThat(pv.get("content").asText()).isEqualTo("「【jobTitle】」回复：【answer】");
            data(call(put("/api/v1/ops/notify-templates/KB_ANSWERED"), ops, Map.of("title", "岗位问答有新回复",
                    "content", "「${jobTitle}」新回复：${answer}")));
            JsonNode after = find(data(call(get("/api/v1/ops/notify-templates"), ops, null)), "templateCode", "KB_ANSWERED");
            assertThat(after.get("content").asText()).isEqualTo("「${jobTitle}」新回复：${answer}");
            assertThat(after.get("variables").toString()).as("去掉的变量仍可再用").contains("question");
            assertThat(status(get("/api/v1/ops/notify-templates"), company().owner(), null)).isEqualTo(403);
        } finally {
            data(call(put("/api/v1/ops/notify-templates/KB_ANSWERED"), ops, Map.of("title", title, "content", content)));
        }
    }
}
