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

    @Test
    void seekerArchive() throws Exception {
        // C-305 经纪人进度 / C-504 我的简历 / C-506 我的台账：只能看到、改到自己的
        Company c = company();
        String jobId = job(c, c.projectId(), "档案测试岗位", 5);
        String s = readySeeker(null);
        String uid = userId(s);

        assertThat(absent(call(get("/api/v1/seeker/broker-case"), s, null), "data")).isTrue();
        jdbc.update("INSERT INTO broker_case (user_id, company_id, trigger_type, status, contact_due_at, resolve_due_at) "
                + "VALUES (?, ?, 'LOW_MATCH', 'OPEN', ?, ?)", uid, c.companyId(), java.time.LocalDateTime.now().plusHours(2),
                java.time.LocalDateTime.now().plusHours(24));
        JsonNode bc = data(call(get("/api/v1/seeker/broker-case"), s, null));
        assertThat(bc.get("status").asText()).isEqualTo("OPEN");
        assertThat(bc.get("recommendCount").asInt()).isZero();
        assertThat(absent(bc, "companyName")).isFalse();
        assertThat(bc.has("brokerId")).isFalse();

        JsonNode r0 = data(call(get("/api/v1/seeker/resume"), s, null));
        assertThat(r0.get("archive").get("realName").asText()).isNotEqualTo("张浩").startsWith("张");
        assertThat(r0.get("archive").get("age").asInt()).isBetween(19, 40);
        assertThat(r0.get("form").get("skillTags").size()).isZero();
        assertThat(code(call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/seeker/resume"), s, Map.of("emergencyPhone", "123")))).isEqualTo("SYS_4000");
        assertThat(code(call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/seeker/resume"), s, Map.of("expectJobTypes", java.util.List.of("PILOT"))))).isEqualTo("SYS_4000");
        data(call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/seeker/resume"), s, Map.of("wechatId", "zhanghao_88", "emergencyName", "张建军",
                "emergencyPhone", "13800001111", "expectJobTypes", java.util.List.of("ELECTRONICS", "QC"),
                "expectRegions", java.util.List.of("昆山"), "workYears", 3,
                "skillTags", java.util.List.of("叉车证", "叉车证", " 焊工 "), "intro", "做过两年贴片")));
        JsonNode r1 = data(call(get("/api/v1/seeker/resume"), s, null));
        assertThat(r1.get("form").get("emergencyPhone").asText()).isEqualTo("13800001111");
        assertThat(r1.get("form").get("skillTags").size()).as("去重去空格").isEqualTo(2);
        assertThat(r1.get("form").get("expectJobTypes").get(1).asText()).isEqualTo("QC");
        assertThat(jdbc.queryForObject("SELECT emergency_phone_enc FROM user_resume WHERE user_id = ?", String.class, uid))
                .as("紧急联系人电话加密存储").doesNotContain("13800001111");
        // 再保存一次是覆盖，清空也能存
        data(call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/seeker/resume"), s, Map.of("workYears", 4)));
        JsonNode r2 = data(call(get("/api/v1/seeker/resume"), s, null));
        assertThat(r2.get("form").get("workYears").asInt()).isEqualTo(4);
        assertThat(absent(r2.get("form"), "wechatId")).isTrue();

        String appId = apply(s, jobId);
        JsonNode lg = data(call(get("/api/v1/seeker/ledger"), s, null));
        assertThat(find(lg.get("applications"), "applicationId", appId).get("jobTitle").asText()).isEqualTo("档案测试岗位");
        assertThat(lg.get("employments").size()).isZero();
        assertThat(lg.get("payslips").size()).isZero();
        assertThat(data(call(get("/api/v1/seeker/resume"), s, null)).get("archive").get("applicationCount").asInt()).isEqualTo(1);

        String other = readySeeker(null);
        assertThat(data(call(get("/api/v1/seeker/ledger"), other, null)).get("applications").size()).isZero();
        assertThat(absent(call(get("/api/v1/seeker/broker-case"), other, null), "data")).isTrue();
        assertThat(status(get("/api/v1/seeker/resume"), c.owner(), null)).isIn(401, 403);
    }

    @Test
    void circulationPeopleLedger() throws Exception {
        // 流转人员台账：付费方看到来源公司与金额；来源方只看到用户 ID、天数、金额；仅老板可看
        Company payer = company();
        Company source = company();
        String active = "UCP" + RND.nextInt(1_000_000_000);
        String ended = "UCP" + RND.nextInt(1_000_000_000);
        java.time.LocalDate d = java.time.LocalDate.now().plusYears(5);
        String ins = "INSERT INTO billing_daily (biz_date, company_id, user_id, employment_id, fee_type, rule_version, unit_price, "
                + "payer_amount, supply_company_id, supply_amount, platform_amount) VALUES (?, ?, ?, ?, 'TRANSFER', 1, 10, 10, ?, 8, 2)";
        jdbc.update(ins, d.minusDays(2), payer.companyId(), ended, "E" + ended, source.companyId());
        jdbc.update(ins, d.minusDays(1), payer.companyId(), active, "E" + active, source.companyId());
        jdbc.update(ins, d, payer.companyId(), active, "E" + active, source.companyId());

        JsonNode mine = data(call(get("/api/v1/tenant/ledger/people"), payer.owner(), null));
        assertThat(mine.size()).isEqualTo(2);
        JsonNode a = find(mine, "userId", active);
        assertThat(a.get("direction").asText()).isEqualTo("PAYABLE");
        assertThat(a.get("counterpartCompanyId").asText()).isEqualTo(source.companyId());
        assertThat(a.get("days").asInt()).isEqualTo(2);
        assertThat(a.get("dailyAmount").asDouble()).isEqualTo(10.0);
        assertThat(a.get("totalAmount").asDouble()).isEqualTo(20.0);
        assertThat(a.get("active").asBoolean()).isTrue();
        assertThat(find(mine, "userId", ended).get("active").asBoolean()).isFalse();

        JsonNode theirs = data(call(get("/api/v1/tenant/ledger/people"), source.owner(), null));
        JsonNode b = find(theirs, "userId", active);
        assertThat(b.get("direction").asText()).isEqualTo("RECEIVABLE");
        assertThat(b.get("totalAmount").asDouble()).isEqualTo(16.0);
        assertThat(absent(b, "counterpartCompanyId")).as("来源方看不到去向公司").isTrue();
        assertThat(absent(b, "jobTitle")).isTrue();
        assertThat(theirs.toString()).doesNotContain(payer.companyId());

        assertThat(status(get("/api/v1/tenant/ledger/people"), payer.pm(), null)).isEqualTo(403);
        assertThat(status(get("/api/v1/tenant/ledger/people"), payer.site(), null)).isEqualTo(403);
        // 计费日期写在未来，用完清掉，不影响其他用例
        jdbc.update("DELETE FROM billing_daily WHERE user_id IN (?, ?)", active, ended);
    }

    @Test
    void billDisputeOverHttp() throws Exception {
        // 验收清单第 7 条的接口层：老板在异议期内提异议 → 平台驳回 / 接受 → 账单状态随之变化；越权与过期都被拒
        Company c = company();
        Company other = company();
        String billId = "MB" + RND.nextInt(1_000_000_000);
        jdbc.update("INSERT INTO monthly_bill (bill_id, company_id, bill_month, service_fee, transfer_payable, transfer_receivable, status, "
                + "issued_at, dispute_deadline, settle_deadline) VALUES (?, ?, '2031-03', 12.00, 1200.00, 0, 'ISSUED', ?, ?, ?)",
                billId, c.companyId(), java.time.LocalDateTime.now(), java.time.LocalDate.now().plusDays(5), java.time.LocalDate.now().plusDays(20));
        String url = "/api/v1/tenant/bills/" + billId + "/disputes";

        assertThat(status(post(url), c.pm(), Map.of("content", "x"))).as("只有老板能提异议").isEqualTo(403);
        assertThat(code(call(post(url), other.owner(), Map.of("content", "别家公司的账单")))).as("不能对别家账单提异议").isNotEqualTo("0");
        assertThat(code(call(post(url), c.owner(), Map.of("content", " ")))).isEqualTo("SYS_4000");

        JsonNode d1 = data(call(post(url), c.owner(), Map.of("content", "3 月有 2 人已于月中离职，应停止计费")));
        assertThat(d1.get("status").asText()).isEqualTo("OPEN");
        JsonNode detail = data(call(get("/api/v1/tenant/bills/" + billId), c.owner(), null));
        assertThat(detail.get("bill").get("status").asText()).isEqualTo("DISPUTED");
        assertThat(detail.get("disputes").size()).isEqualTo(1);
        assertThat(code(call(post(url), c.owner(), Map.of("content", "重复提交")))).as("处理中不能再提").isEqualTo("SYS_4000");

        String reply = "/api/v1/ops/disputes/" + d1.get("id").asLong() + "/reply";
        assertThat(status(post(reply), c.owner(), Map.of("accept", true, "reply", "x"))).as("企业不能自己处理异议").isEqualTo(403);
        assertThat(code(call(post(reply), ops, Map.of("accept", false, "reply", " ")))).isEqualTo("SYS_4000");
        data(call(post(reply), ops, Map.of("accept", false, "reply", "核对任职记录，离职日为月末，计费无误")));
        assertThat(code(call(post(reply), ops, Map.of("accept", true, "reply", "重复处理")))).isEqualTo("SYS_4040");
        detail = data(call(get("/api/v1/tenant/bills/" + billId), c.owner(), null));
        assertThat(detail.get("bill").get("status").asText()).as("驳回后回到已下发").isEqualTo("ISSUED");
        assertThat(detail.get("disputes").get(0).get("reply").asText()).contains("计费无误");

        JsonNode d2 = data(call(post(url), c.owner(), Map.of("content", "补充了离职证明，请重新核对")));
        data(call(post("/api/v1/ops/disputes/" + d2.get("id").asLong() + "/reply"), ops, Map.of("accept", true, "reply", "核实属实，修正后重新下发")));
        assertThat(data(call(get("/api/v1/ops/bills/" + billId), ops, null)).get("bill").get("status").asText())
                .as("接受后退回待下发").isEqualTo("GENERATED");

        // 过了异议期不能再提
        jdbc.update("UPDATE monthly_bill SET status = 'ISSUED', dispute_deadline = ? WHERE bill_id = ?", java.time.LocalDate.now().minusDays(1), billId);
        assertThat(code(call(post(url), c.owner(), Map.of("content", "过期后再提")))).isEqualTo("SYS_4000");
    }

    /** 空值字段在响应里可能被省略，也可能是 null */
    private static boolean absent(JsonNode n, String field) {
        return n.get(field) == null || n.get(field).isNull();
    }
}
