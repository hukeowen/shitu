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

    @Test
    void fraudSuspectQueueAndPenalty() throws Exception {
        // D-17：同一证件 24h 内被 3 个手机号提交实名 → 自动进确认队列 → 确认后引流公司扣 30 分
        Company c = company();
        String code = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "刷单测试码"))).get("code").asText();
        String holder = seekerLogin(phone(), null);
        String id = idCard(28);
        Map<String, Object> kyc = Map.of("realName", "周强", "idCard", id, "idCardConfirm", id);
        data(call(post("/api/v1/seeker/kyc"), holder, kyc));
        String f1 = seekerLogin(phone(), code);
        assertThat(code(call(post("/api/v1/seeker/kyc"), f1, kyc))).isEqualTo("APP_4007");
        String hash = jdbc.queryForObject("SELECT id_card_hash FROM `user` WHERE user_id = ?", String.class, userId(holder));
        String pendingSql = "SELECT COUNT(*) FROM kyc_review r JOIN kyc_record k ON k.id = r.kyc_record_id "
                + "WHERE r.review_type = 'FRAUD_SUSPECT' AND k.id_card_hash = ?";
        assertThat(jdbc.queryForObject(pendingSql, Long.class, hash)).as("2 个手机号不触发").isZero();
        String f2 = seekerLogin(phone(), code);
        call(post("/api/v1/seeker/kyc"), f2, kyc);
        call(post("/api/v1/seeker/kyc"), f2, kyc);
        assertThat(jdbc.queryForObject(pendingSql, Long.class, hash)).as("第 3 个手机号触发，且不重复建单").isEqualTo(1);
        assertThat(data(call(get("/api/v1/seeker/kyc/appeals"), f2, null))).as("系统建的单不出现在用户的申诉列表").isEmpty();

        JsonNode q = data(call(get("/api/v1/ops/kyc-reviews?type=FRAUD_SUSPECT&status=PENDING"), ops, null));
        JsonNode item = find(q, "userId", userId(f2));
        assertThat(item.get("accounts")).hasSize(3);
        assertThat(find(item.get("accounts"), "userId", userId(holder)).get("holder").asBoolean()).isTrue();
        assertThat(find(item.get("accounts"), "userId", userId(f1)).get("sourceCompanyId").asText()).isEqualTo(c.companyId());

        int before = jdbc.queryForObject("SELECT credit_score FROM company WHERE company_id = ?", Integer.class, c.companyId());
        data(call(post("/api/v1/ops/kyc-reviews/" + item.get("id").asLong() + "/decide"), ops, Map.of("approve", true, "remark", "同一渠道码批量注册")));
        assertThat(jdbc.queryForObject("SELECT credit_score FROM company WHERE company_id = ?", Integer.class, c.companyId()))
                .as("两个涉事账号同属一家公司，只扣一次").isEqualTo(before - 30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM credit_score_log WHERE company_id = ? AND rule_code = 'FRAUD_REGISTER'",
                Long.class, c.companyId())).isEqualTo(1);
    }

    @Test
    void sysParams() throws Exception {
        JsonNode list = data(call(get("/api/v1/ops/sys-params"), ops, null));
        JsonNode p = find(list, "paramKey", "matching.rematch_alert_count");
        String old = p.get("paramValue").asText();
        assertThat(list.toString()).as("由引擎参数管理的副本已移除").doesNotContain("matching.result_count");
        String url = "/api/v1/ops/sys-params/matching.rematch_alert_count";
        try {
            assertThat(code(call(put(url), ops, Map.of("value", "abc", "remark", "x")))).isEqualTo("SYS_4000");
            assertThat(code(call(put(url), ops, Map.of("value", "5")))).as("必须写原因").isEqualTo("SYS_4000");
            assertThat(code(call(put("/api/v1/ops/sys-params/response_window.duration"), ops, Map.of("value", "24h", "remark", "x"))))
                    .isEqualTo("SYS_4000");
            assertThat(code(call(put("/api/v1/ops/sys-params/response_window.day_start"), ops, Map.of("value", "25:00", "remark", "x"))))
                    .isEqualTo("SYS_4000");
            assertThat(status(put(url), company().owner(), Map.of("value", "5", "remark", "x"))).isEqualTo(403);
            data(call(put(url), ops, Map.of("value", "5", "remark", "试点期放宽")));
            JsonNode after = find(data(call(get("/api/v1/ops/sys-params"), ops, null)), "paramKey", "matching.rematch_alert_count");
            assertThat(after.get("paramValue").asText()).isEqualTo("5");
            assertThat(after.get("updateRemark").asText()).isEqualTo("试点期放宽");
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM audit_log WHERE action = 'SYS_PARAM_UPDATE' AND target_id = ?",
                    Long.class, "matching.rematch_alert_count")).isPositive();
        } finally {
            jdbc.update("UPDATE sys_param SET param_value = ? WHERE param_key = 'matching.rematch_alert_count'", old);
        }
    }

    @Test
    void holidays() throws Exception {
        // D-23：只接受「工作日放假」「周末上班」两种记录；重复录入覆盖；公司后台不能访问
        java.time.LocalDate d = java.time.LocalDate.of(2099, 1, 1);
        while (d.getDayOfWeek().getValue() >= 6) {
            d = d.plusDays(1);
        }
        java.time.LocalDate sat = d.with(java.time.temporal.TemporalAdjusters.next(java.time.DayOfWeek.SATURDAY));
        try {
            assertThat(code(call(post("/api/v1/ops/holidays"), ops, Map.of("items", List.of(
                    Map.of("date", sat.toString(), "workday", false, "name", "周末放假")))))).isEqualTo("SYS_4000");
            assertThat(code(call(post("/api/v1/ops/holidays"), ops, Map.of("items", List.of(
                    Map.of("date", d.toString(), "workday", true, "name", "工作日上班")))))).isEqualTo("SYS_4000");
            data(call(post("/api/v1/ops/holidays"), ops, Map.of("items", List.of(
                    Map.of("date", d.toString(), "workday", false, "name", "元旦"),
                    Map.of("date", sat.toString(), "workday", true, "name", "调休上班")))));
            data(call(post("/api/v1/ops/holidays"), ops, Map.of("items", List.of(Map.of("date", d.toString(), "workday", false, "name", "元旦节")))));
            JsonNode list = data(call(get("/api/v1/ops/holidays?year=2099"), ops, null));
            assertThat(list.size()).isEqualTo(2);
            assertThat(find(list, "holidayDate", d.toString()).get("name").asText()).isEqualTo("元旦节");
            assertThat(status(get("/api/v1/ops/holidays?year=2099"), company().owner(), null)).isEqualTo(403);
            data(call(delete("/api/v1/ops/holidays/" + sat), ops, null));
            assertThat(data(call(get("/api/v1/ops/holidays?year=2099"), ops, null)).size()).isEqualTo(1);
        } finally {
            jdbc.update("DELETE FROM holiday WHERE holiday_date >= '2099-01-01'");
        }
    }

    @Test
    void attributionDisputes() throws Exception {
        // P-08：登记争议 → 待处理队列 → 写结论结案；只留痕不改归属；公司后台不能访问
        Company c = company();
        String s = seekerLogin(phone(), null);
        String uid = userId(s);
        String source = jdbc.queryForObject("SELECT source_company_id FROM `user` WHERE user_id = ?", String.class, uid);
        assertThat(code(call(post("/api/v1/ops/attribution/disputes"), ops, Map.of("userId", "U-NOPE", "content", "x")))).isEqualTo("SYS_4040");
        assertThat(code(call(post("/api/v1/ops/attribution/disputes"), ops, Map.of("userId", uid, "companyId", "C-NOPE", "content", "x"))))
                .isEqualTo("SYS_4040");
        long id = data(call(post("/api/v1/ops/attribution/disputes"), ops, Map.of("userId", uid, "companyId", c.companyId(),
                "content", "公司称该用户是其线下门店引流，扫码时网络故障未带上渠道码"))).asLong();
        assertThat(find(data(call(get("/api/v1/ops/attribution/disputes"), ops, null)), "id", String.valueOf(id)).get("status").asText())
                .isEqualTo("OPEN");
        assertThat(status(get("/api/v1/ops/attribution/disputes"), c.owner(), null)).isEqualTo(403);
        data(call(post("/api/v1/ops/attribution/disputes/" + id + "/resolve"), ops, Map.of("conclusion", "注册日志显示为自然注册，来源归属不变")));
        assertThat(code(call(post("/api/v1/ops/attribution/disputes/" + id + "/resolve"), ops, Map.of("conclusion", "重复处理")))).isEqualTo("SYS_4090");
        JsonNode mine = data(call(get("/api/v1/ops/attribution/disputes?userId=" + uid), ops, null));
        assertThat(mine.get(0).get("conclusion").asText()).contains("来源归属不变");
        assertThat(mine.get(0).get("companyName").isNull()).isFalse();
        assertThat(jdbc.queryForObject("SELECT source_company_id FROM `user` WHERE user_id = ?", String.class, uid)).as("归属不变").isEqualTo(source);
    }
}
