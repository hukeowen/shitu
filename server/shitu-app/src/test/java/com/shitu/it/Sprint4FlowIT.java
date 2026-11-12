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
    @Autowired
    com.shitu.lifecycle.employment.ResignService resign;

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
        // D-59：离职日在明天 → 待生效，人仍在岗、任职未结束；不能重复申请；可以撤销
        assertThat(jdbc.queryForObject("SELECT status FROM resign_request WHERE id = ?", String.class, id)).isEqualTo("SCHEDULED");
        assertThat(user(u1).get("user_status")).as("离职日未到仍在岗").isEqualTo("EMPLOYED");
        assertThat(jdbc.queryForMap("SELECT end_date FROM employment WHERE employment_id = ?", empId).get("end_date")).isNull();
        assertThat(resign.executeScheduled()).as("离职日未到不执行").isZero();
        assertThat(data(call(get("/api/v1/seeker/advance/quota"), s1, null)).get("reasons").toString()).contains("离职已审核通过");
        assertThat(code(call(post("/api/v1/tenant/employments/" + empId + "/resign"), c.site(),
                Map.of("resignDate", LocalDate.now().plusDays(2).toString())))).as("待生效期间不能再申请").isEqualTo("SYS_4090");
        assertThat(code(call(post("/api/v1/tenant/resign-requests/" + id + "/decide"), c.pm(), Map.of("approve", true))))
                .as("待生效的不能再次通过").isEqualTo("SYS_4090");
        data(call(post("/api/v1/tenant/resign-requests/" + id + "/decide"), c.pm(), Map.of("approve", false, "remark", "本人改主意，撤销")));
        assertThat(jdbc.queryForObject("SELECT status FROM resign_request WHERE id = ?", String.class, id)).isEqualTo("REJECTED");
        assertThat(user(u1).get("user_status")).isEqualTo("EMPLOYED");

        // 重新申请并通过；到了离职日由定时任务生效
        id = data(call(post("/api/v1/tenant/employments/" + empId + "/resign"), c.site(),
                Map.of("resignDate", LocalDate.now().plusDays(1).toString(), "reason", "回老家"))).asLong();
        data(call(post("/api/v1/tenant/resign-requests/" + id + "/decide"), c.pm(), Map.of("approve", true)));
        jdbc.update("UPDATE resign_request SET resign_date = ? WHERE id = ?", LocalDate.now(), id);
        assertThat(resign.executeScheduled()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM resign_request WHERE id = ?", String.class, id)).isEqualTo("APPROVED");
        assertThat(resign.executeScheduled()).as("不会重复执行").isZero();
        assertThat(user(u1).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(u1).get("bound_company_id")).isNull();
        assertThat(user(u1).get("last_release_reason")).isEqualTo("RESIGNED");
        Map<String, Object> emp = jdbc.queryForMap("SELECT end_date, end_reason, contract_id FROM employment WHERE employment_id = ?", empId);
        assertThat(emp.get("end_date").toString()).isEqualTo(LocalDate.now().toString());
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

    @Autowired
    com.shitu.circulation.BrokerService brokers;

    @Test
    void brokerCirculation() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "流转验收岗位", 10);
        String brokerPhone = phone();
        data(call(post("/api/v1/tenant/members"), c.owner(), Map.of("name", "李文倩", "phone", brokerPhone, "roles", new String[]{"BROKER"})));
        String broker = data(tenantLogin(brokerPhone)).get("accessToken").asText();
        String code = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "流转码"))).get("code").asText();

        // 1. 匹配度不足自动入池（LOW_MATCH）→ 联系 → AI 报告 → 二次推荐 → 用户确认后报名
        String s1 = readySeeker(code);
        String u1 = userId(s1);
        JsonNodeHolder noMatch = new JsonNodeHolder(data(call(post("/api/v1/seeker/match"), s1, badAnswers())));
        assertThat(noMatch.n().get("matched").asBoolean()).isFalse();
        var pool = data(call(get("/api/v1/tenant/broker/cases"), broker, null));
        var row = find(pool, "userId", u1);
        assertThat(row.get("triggerType").asText()).isEqualTo("LOW_MATCH");
        assertThat(row.get("phoneMasked").asText()).contains("****");
        long caseId = row.get("id").asLong();
        assertThat(data(call(post("/api/v1/tenant/broker/cases/" + caseId + "/contact"), broker, null)).get("status").asText()).isEqualTo("CONTACTED");
        var report = data(call(post("/api/v1/tenant/broker/cases/" + caseId + "/report"), broker, null));
        assertThat(report.get("summary").asText()).contains("不接受进厂");
        assertThat(report.get("recommendations").toString()).contains(job);
        assertThat(code(call(get("/api/v1/seeker/jobs/" + job), s1, null))).as("推荐前不在结果中").isEqualTo("APP_4004");
        assertThat(status(post("/api/v1/tenant/broker/cases/" + caseId + "/recommend"), c.site(), Map.of("jobId", job))).isEqualTo(403);
        data(call(post("/api/v1/tenant/broker/cases/" + caseId + "/recommend"), broker, Map.of("jobId", job, "note", "离家近")));
        var recs = data(call(get("/api/v1/seeker/recommendations"), s1, null));
        assertThat(recs.get(0).get("jobId").asText()).isEqualTo(job);
        data(call(post("/api/v1/seeker/recommendations/" + recs.get(0).get("id").asLong() + "/decision"), s1, Map.of("accept", true)));
        assertThat(data(call(get("/api/v1/seeker/jobs/" + job), s1, null)).get("title").asText()).isNotBlank();
        String app = apply(s1, job);
        assertThat(jdbc.queryForObject("SELECT broker_case_id FROM application WHERE application_id = ?", Long.class, app)).isEqualTo(caseId);
        assertThat(jdbc.queryForObject("SELECT status FROM broker_case WHERE id = ?", String.class, caseId)).isEqualTo("APPLIED");

        // 2. 主动释放（必填原因）
        String s2 = readySeeker(code);
        data(call(post("/api/v1/seeker/match"), s2, badAnswers()));
        long case2 = find(data(call(get("/api/v1/tenant/broker/cases"), broker, null)), "userId", userId(s2)).get("id").asLong();
        assertThat(code(call(post("/api/v1/tenant/broker/cases/" + case2 + "/release"), broker, Map.of("reason", " ")))).isEqualTo("SYS_4000");
        data(call(post("/api/v1/tenant/broker/cases/" + case2 + "/release"), broker, Map.of("reason", "公司已有岗位用户均不满意")));
        assertThat(user(userId(s2)).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(userId(s2)).get("last_release_reason")).isEqualTo("MANUAL");

        // 3. 驻场一键流转（SITE_TRANSFER）+ 24h 未出结果自动释放（BROKER_SLA_TIMEOUT）
        String s3 = readySeeker(code);
        String u3 = userId(s3);
        data(call(post("/api/v1/tenant/seekers/" + u3 + "/transfer-to-broker"), c.site(), null));
        assertThat(find(data(call(get("/api/v1/tenant/broker/cases"), broker, null)), "userId", u3).get("triggerType").asText()).isEqualTo("SITE_TRANSFER");
        jdbc.update("UPDATE broker_case SET resolve_due_at = ?, contact_due_at = ? WHERE user_id = ? AND status = 'OPEN'",
                java.time.LocalDateTime.now().minusMinutes(1), java.time.LocalDateTime.now().minusMinutes(1), u3);
        int[] sla = brokers.enforceSla();
        assertThat(sla[1]).isGreaterThanOrEqualTo(1);
        assertThat(user(u3).get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(user(u3).get("last_release_reason")).isEqualTo("BROKER_SLA_TIMEOUT");
    }

    @Test
    void rosterImport() throws Exception {
        Company c = company();
        Company other = company();
        String publicSeeker = readySeeker(null);
        String publicPhone = jdbc.queryForObject("SELECT phone_enc FROM `user` WHERE user_id = ?", String.class, userId(publicSeeker));
        String publicPhonePlain = cipher.decrypt(publicPhone);
        String otherCode = data(call(post("/api/v1/tenant/channel-codes"), other.owner(), Map.of("name", "他司码"))).get("code").asText();
        String otherPhone = phone();
        seekerLogin(otherPhone, otherCode);
        String newPhone = phone();
        String newId = idCard(30);
        String today = LocalDate.now().toString();
        byte[] xlsx = xlsx(new String[][]{
                {"新员工", newPhone, newId, c.projectId(), "", LocalDate.now().minusDays(10).toString(), "R-001"},
                {"老用户", publicPhonePlain, idCard(28), "验收项目一", "", today, ""},
                {"别家人", otherPhone, idCard(26), c.projectId(), "", today, ""},
                {"坏号码", phone(), "123", c.projectId(), "", today, ""},
                {"重复号", newPhone, idCard(25), c.projectId(), "", today, ""},
                {"项目错", phone(), idCard(24), "不存在的项目", "", today, ""}});
        var res = data(body(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/api/v1/tenant/roster/import")
                .file(new org.springframework.mock.web.MockMultipartFile("file", "r.xlsx", "application/octet-stream", xlsx))
                .header("Authorization", "Bearer " + c.pm())).andReturn()));
        assertThat(res.get("total").asInt()).isEqualTo(6);
        assertThat(res.get("success").asInt()).as(res.toString()).isEqualTo(1);
        assertThat(res.get("inFreePeriod").asBoolean()).isTrue();
        String newUser = jdbc.queryForObject("SELECT user_id FROM `user` WHERE phone_hash = ?", String.class, cipher.blindIndex(newPhone));
        assertThat(user(newUser).get("user_status")).isEqualTo("EMPLOYED");
        Map<String, Object> e = jdbc.queryForMap("SELECT source_company_id_snapshot, is_stock, origin, employee_no FROM employment WHERE user_id = ?", newUser);
        assertThat(e.get("source_company_id_snapshot")).isEqualTo(c.companyId());
        assertThat(e.get("is_stock")).isEqualTo(true);
        assertThat(e.get("origin")).isEqualTo("ROSTER_IMPORT");
        assertThat(jdbc.queryForObject("SELECT kyc_status FROM `user` WHERE user_id = ?", String.class, newUser)).isEqualTo("VERIFIED");
        var rows = res.get("rows");
        assertThat(rows.get(1).get("error").asText()).as("已实名用户身份证与表中不一致").contains("不一致");
        assertThat(rows.get(2).get("error").asText()).contains("私域待匹配");
        assertThat(rows.get(3).get("error").asText()).contains("身份证");
        assertThat(rows.get(4).get("error").asText()).contains("重复");
        assertThat(rows.get(5).get("error").asText()).contains("项目不存在");
        assertThat(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/api/v1/tenant/roster/import")
                .file(new org.springframework.mock.web.MockMultipartFile("file", "r.xlsx", "application/octet-stream", xlsx))
                .header("Authorization", "Bearer " + c.owner())).andReturn().getResponse().getStatus()).as("老板不能导入").isEqualTo(403);
        var failed = mvc.perform(get("/api/v1/tenant/roster/batches/" + res.get("batchId").asText() + "/failed")
                .header("Authorization", "Bearer " + c.pm())).andReturn().getResponse().getContentAsByteArray();
        try (var wb = org.apache.poi.ss.usermodel.WorkbookFactory.create(new java.io.ByteArrayInputStream(failed))) {
            assertThat(wb.getSheetAt(0).getLastRowNum()).isEqualTo(5);
            assertThat(wb.getSheetAt(0).getRow(1).getCell(7).getStringCellValue()).isNotBlank();
        }
    }

    private static byte[] xlsx(String[][] rows) throws Exception {
        try (var wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook(); var out = new java.io.ByteArrayOutputStream()) {
            var sh = wb.createSheet();
            sh.createRow(0).createCell(0).setCellValue("姓名");
            for (int i = 0; i < rows.length; i++) {
                var r = sh.createRow(i + 1);
                for (int j = 0; j < rows[i].length; j++) {
                    r.createCell(j).setCellValue(rows[i][j]);
                }
            }
            wb.write(out);
            return out.toByteArray();
        }
    }

    record JsonNodeHolder(com.fasterxml.jackson.databind.JsonNode n) {
    }

    /** 不接受进厂：演示与测试岗位都是进厂岗位，全部被硬过滤 → 匹配不足。 */
    private Map<String, Object> badAnswers() {
        return Map.of("answers", java.util.List.of(
                Map.of("seq", 1, "code", "C"), Map.of("seq", 2, "code", "A", "region", city), Map.of("seq", 3, "code", "A"),
                Map.of("seq", 4, "code", "B"), Map.of("seq", 5, "code", "D"), Map.of("seq", 6, "code", "B"),
                Map.of("seq", 7, "code", "C")));
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
