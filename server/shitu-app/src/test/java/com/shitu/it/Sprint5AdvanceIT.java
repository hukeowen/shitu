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
import org.springframework.mock.web.MockMultipartFile;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Sprint 5 验收（预支部分）：5 项准入条件逐项反例、驻场初审 + 项目经理终审 + 登记拨款、驳回退回机会、
 * 工资表导入自动抵扣（部分抵扣结转）、有欠款不能离职、结清后可以离职。
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
class Sprint5AdvanceIT extends FlowItSupport {

    @Autowired
    ESignProvider esign;

    @Test
    void advanceAcceptance() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "预支验收岗位", 10);
        String s = readySeeker(null);
        String uid = userId(s);

        // 1. 未在岗
        assertThat(reasons(s)).contains("仅「已入职在岗」状态可以申请预支");
        assertThat(code(call(post("/api/v1/seeker/advance"), s, null))).isEqualTo("ADV_4001");

        employ(c, s, job);
        String empId = jdbc.queryForObject("SELECT employment_id FROM employment WHERE user_id = ?", String.class, uid);
        // 2. 在岗未满 7 天
        assertThat(reasons(s)).anyMatch(r -> r.contains("入职满 7 个在岗日"));

        // 构造「本月恰好发放 1 次机会」的入职日（机会 = 今天累计在岗日 / 7 − 上月末累计在岗日 / 7，D-26）：
        //   月初 1–7 号：入职放在上月倒数第 6 天（上月末累计 6 天），今天累计 6 + t 天（7–13）
        //   8 号以后：入职放在本月，今天累计 min(10, t) 天
        LocalDate today = LocalDate.now();
        int t = today.getDayOfMonth();
        LocalDate start = t <= 7 ? today.withDayOfMonth(1).minusDays(6) : today.minusDays(Math.min(10, t) - 1L);
        int now = (int) java.time.temporal.ChronoUnit.DAYS.between(start, today) + 1;
        jdbc.update("UPDATE employment SET start_date = ? WHERE employment_id = ?", Date.valueOf(start), empId);
        // 3. 请假旷工扣减在岗日：扣到 6 天 < 7
        for (int i = 0; i < now - 6; i++) {
            jdbc.update("INSERT INTO duty_absence (company_id, employment_id, absence_date, absence_type, marked_by) VALUES (?, ?, ?, 'LEAVE', 'T')",
                    c.companyId(), empId, Date.valueOf(today.minusDays(i)));
        }
        JsonNode q = data(call(get("/api/v1/seeker/advance/quota"), s, null));
        assertThat(q.get("dutyDays").asInt()).isEqualTo(6);
        assertThat(q.get("eligible").asBoolean()).isFalse();
        jdbc.update("DELETE FROM duty_absence WHERE employment_id = ?", empId);
        q = data(call(get("/api/v1/seeker/advance/quota"), s, null));
        assertThat(q.get("dutyDays").asInt()).isEqualTo(now);
        assertThat(q.get("eligible").asBoolean()).as(q.toString()).isTrue();
        assertThat(q.get("remainingThisMonth").asInt()).isEqualTo(1);


        // 4. 黑名单
        jdbc.update("UPDATE `user` SET blacklist_flag = 1 WHERE user_id = ?", uid);
        assertThat(reasons(s)).contains("账号受限，暂不能预支");
        jdbc.update("UPDATE `user` SET blacklist_flag = 0 WHERE user_id = ?", uid);

        // 5. 发起 → 有在审批的不能再发起 → 驻场驳回（退回机会）
        String a1 = data(call(post("/api/v1/seeker/advance"), s, null)).asText();
        assertThat(reasons(s)).contains("你有一笔预支正在审批中");
        assertThat(code(call(post("/api/v1/tenant/advances/" + a1 + "/site-review"), c.site(), Map.of("approve", false))))
                .as("驳回须填原因").isEqualTo("LC_4004");
        assertThat(status(post("/api/v1/tenant/advances/" + a1 + "/pm-review"), c.site(), Map.of("approve", true))).isEqualTo(403);
        data(call(post("/api/v1/tenant/advances/" + a1 + "/site-review"), c.site(), Map.of("approve", false, "opinion", "考勤待核实")));
        assertThat(data(call(get("/api/v1/seeker/advance/quota"), s, null)).get("remainingThisMonth").asInt()).as("驳回退回机会").isEqualTo(1);

        // 6. 再次发起 → 初审 → 终审 → 拨款，欠款 500
        String a2 = data(call(post("/api/v1/seeker/advance"), s, null)).asText();
        assertThat(code(call(post("/api/v1/tenant/advances/" + a2 + "/pm-review"), c.pm(), Map.of("approve", true))))
                .as("未经初审不能终审").isEqualTo("SYS_4090");
        data(call(post("/api/v1/tenant/advances/" + a2 + "/site-review"), c.site(), Map.of("approve", true)));
        data(call(post("/api/v1/tenant/advances/" + a2 + "/pm-review"), c.pm(), Map.of("approve", true)));
        data(call(post("/api/v1/tenant/advances/" + a2 + "/payout"), c.pm(), null));
        assertThat(debt(uid)).isEqualByComparingTo("500.00");
        // 本月机会用完
        assertThat(reasons(s)).anyMatch(r -> r.contains("本月暂无可用机会"));

        // 7. 本月 4 次上限
        jdbc.update("UPDATE advance_request SET biz_month = ? WHERE advance_id = ?", YearMonth.now().toString(), a2);
        for (int i = 0; i < 3; i++) {
            jdbc.update("INSERT INTO advance_request (advance_id, user_id, company_id, project_id, employment_id, amount, biz_month, status) "
                    + "VALUES (?, ?, ?, ?, ?, 500, ?, 'REPAID')", "YZT" + RND.nextInt(1_000_000_000), uid, c.companyId(), c.projectId(),
                    empId, YearMonth.now().toString());
        }
        assertThat(reasons(s)).anyMatch(r -> r.contains("本月已预支 4 次"));

        // 额度规则已验证完；把入职日提前到上上月，保证"上月工资"在任何日期都有在职记录
        jdbc.update("UPDATE employment SET start_date = ? WHERE employment_id = ?", Date.valueOf(today.minusMonths(2)), empId);

        // 8. 工资抵扣：应发 600 − 社保 200 = 400 → 抵扣 400，欠款结转 100，预支状态部分抵扣
        String phone = cipher.decrypt(jdbc.queryForObject("SELECT phone_enc FROM `user` WHERE user_id = ?", String.class, uid));
        JsonNode b1 = importPayroll(c.pm(), YearMonth.now().minusMonths(1), phone, "600", "200");
        assertThat(b1.get("rows").get(0).get("advanceDeduct").decimalValue()).isEqualByComparingTo("400.00");
        assertThat(b1.get("rows").get(0).get("netPay").decimalValue()).isEqualByComparingTo("0.00");
        assertThat(debt(uid)).isEqualByComparingTo("100.00");
        assertThat(jdbc.queryForObject("SELECT status FROM advance_request WHERE advance_id = ?", String.class, a2)).isEqualTo("PARTIALLY_REPAID");
        JsonNode dup = importPayroll(c.pm(), YearMonth.now().minusMonths(1), phone, "600", "200");
        assertThat(dup.get("rows").get(0).get("success").asBoolean()).as("同月重复导入被拦截").isFalse();
        assertThat(debt(uid)).isEqualByComparingTo("100.00");

        // 9. 有欠款不能离职
        long rid = data(call(post("/api/v1/tenant/employments/" + empId + "/resign"), c.site(),
                Map.of("resignDate", today.plusDays(1).toString()))).asLong();
        assertThat(code(call(post("/api/v1/tenant/resign-requests/" + rid + "/decide"), c.pm(), Map.of("approve", true)))).isEqualTo("SYS_4090");

        // 10. 下月工资抵扣剩余 100 → 结清 → 可以离职
        JsonNode b2 = importPayroll(c.pm(), YearMonth.now(), phone, "3000", "300");
        assertThat(b2.get("rows").get(0).get("advanceDeduct").decimalValue()).isEqualByComparingTo("100.00");
        assertThat(b2.get("rows").get(0).get("netPay").decimalValue()).isEqualByComparingTo("2600.00");
        assertThat(debt(uid)).isEqualByComparingTo("0.00");
        assertThat(jdbc.queryForObject("SELECT status FROM advance_request WHERE advance_id = ?", String.class, a2)).isEqualTo("REPAID");
        data(call(post("/api/v1/tenant/resign-requests/" + rid + "/decide"), c.pm(), Map.of("approve", true)));
        assertThat(user(uid).get("user_status")).isEqualTo("PUBLIC_SEEKING");

        JsonNode slips = data(call(get("/api/v1/seeker/payslips"), s, null));
        assertThat(slips.size()).isEqualTo(2);
        assertThat(data(call(get("/api/v1/seeker/advance/debt-log"), s, null)).size()).isEqualTo(3);
        JsonNode detail = data(call(get("/api/v1/seeker/advance/" + a2), s, null));
        assertThat(detail.get("approvals").size()).as("驻场初审 + 项目经理终审 + 拨款").isEqualTo(3);
        assertThat(detail.get("ledger").size()).isEqualTo(3);
        assertThat(detail.get("ledger").get(0).has("balanceAfter")).isTrue();
        assertThat(code(call(get("/api/v1/seeker/advance/" + a2), readySeeker(null), null))).isEqualTo("SYS_4040");
        String slipId = slips.get(0).get("payslipId").asText();
        assertThat(data(call(get("/api/v1/seeker/payslips/" + slipId), s, null)).get("payslipId").asText()).isEqualTo(slipId);
    }

    private java.util.List<String> reasons(String token) throws Exception {
        java.util.List<String> out = new java.util.ArrayList<>();
        data(call(get("/api/v1/seeker/advance/quota"), token, null)).get("reasons").forEach(r -> out.add(r.asText()));
        return out;
    }

    private BigDecimal debt(String uid) {
        return jdbc.queryForObject("SELECT advance_debt FROM `user` WHERE user_id = ?", BigDecimal.class, uid);
    }

    private JsonNode importPayroll(String token, YearMonth month, String phone, String gross, String social) throws Exception {
        return data(importPayrollRaw(token, month, phone, gross, social));
    }

    private JsonNode importPayrollRaw(String token, YearMonth month, String phone, String gross, String social) throws Exception {
        byte[] xlsx;
        try (var wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook(); var out = new java.io.ByteArrayOutputStream()) {
            var sh = wb.createSheet();
            sh.createRow(0).createCell(0).setCellValue("手机号");
            var r = sh.createRow(1);
            r.createCell(0).setCellValue(phone);
            r.createCell(1).setCellValue("");
            r.createCell(2).setCellValue(gross);
            r.createCell(3).setCellValue(social);
            wb.write(out);
            xlsx = out.toByteArray();
        }
        return body(mvc.perform(multipart("/api/v1/tenant/payroll/import").file(new MockMultipartFile("file", "p.xlsx",
                        "application/octet-stream", xlsx)).param("month", month.toString()).header("Authorization", "Bearer " + token))
                .andReturn());
    }

    private void employ(Company c, String seeker, String jobId) throws Exception {
        String app = apply(seeker, jobId);
        data(call(post("/api/v1/tenant/applications/" + app + "/result"), c.site(), Map.of("pass", true)));
        String url = data(call(post("/api/v1/tenant/applications/" + app + "/confirm"), c.site(), Map.of())).get("signUrl").asText();
        String body = json.writeValueAsString(Map.of("flowId", url.replaceAll(".*/esign/mock/", ""), "action", "SIGN_FLOW_COMPLETE"));
        mvc.perform(post("/api/v1/callback/esign").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(MockESignProvider.SIGNATURE_HEADER, ((MockESignProvider) esign).sign(body)));
    }
}
