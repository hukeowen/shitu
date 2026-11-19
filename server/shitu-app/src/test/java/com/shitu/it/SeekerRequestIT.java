package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalDate;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 求职者自助申请：申请取消报名（驻场不同意 → 再次申请 → 同意并取消）、申请离职（撤回 → 再申请 → 项目经理通过）。
 * R-04 不变：求职者自己调取消接口没有任何入口，取消只能经驻场 / 项目经理同意。
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
class SeekerRequestIT extends FlowItSupport {

    @Autowired
    ESignProvider esign;

    @Test
    void cancelRequest() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "取消申请验收岗位", 10);
        String seeker = readySeeker(null);
        String user = userId(seeker);
        String app = apply(seeker, job);
        String base = "/api/v1/seeker/applications/" + app + "/cancel-request";

        assertThat(empty(data(call(get(base), seeker, null)))).as("还没申请过").isTrue();
        assertThat(code(call(post(base), seeker, Map.of("reason", " ")))).as("原因必填").isNotEqualTo("0");
        JsonNode first = data(call(post(base), seeker, Map.of("reason", "找到其他工作了")));
        assertThat(first.get("status").asText()).isEqualTo("PENDING");
        assertThat(code(call(post(base), seeker, Map.of("reason", "再催一次")))).as("同一条报名只能有一条待处理").isEqualTo("SYS_4090");
        assertThat(jdbc.queryForObject("SELECT status FROM application WHERE application_id = ?", String.class, app))
                .as("提交申请不会直接取消报名").isEqualTo("PENDING_INTERVIEW");

        // 另一个求职者不能替别人申请
        String other = readySeeker(null);
        assertThat(code(call(post(base), other, Map.of("reason", "乱申请")))).isEqualTo("SYS_4040");

        // ---------------------------------------------------------------- 驻场看到并处理
        assertThat(data(call(get("/api/v1/tenant/cancel-requests/pending-count"), c.site(), null)).asLong()).isGreaterThanOrEqualTo(1);
        JsonNode rows = data(call(get("/api/v1/tenant/cancel-requests?status=PENDING"), c.site(), null));
        JsonNode row = find(rows, app);
        assertThat(row).isNotNull();
        assertThat(row.get("reason").asText()).isEqualTo("找到其他工作了");
        assertThat(row.get("seekerName").asText()).as("姓名脱敏").contains("*");
        long id = row.get("id").asLong();
        assertThat(status(get("/api/v1/tenant/cancel-requests"), c.owner(), null)).as("老板没有处理权限").isEqualTo(403);
        assertThat(code(call(post("/api/v1/tenant/cancel-requests/" + id + "/decide"), c.site(), Map.of("approve", false))))
                .as("不同意必须写说明").isNotEqualTo("0");
        data(call(post("/api/v1/tenant/cancel-requests/" + id + "/decide"), c.site(), Map.of("approve", false, "reply", "名额已为你保留，明天面试完再决定")));
        JsonNode mine = data(call(get(base), seeker, null));
        assertThat(mine.get("status").asText()).isEqualTo("REJECTED");
        assertThat(mine.get("reply").asText()).contains("名额已为你保留");
        assertThat(code(call(post("/api/v1/tenant/cancel-requests/" + id + "/decide"), c.site(), Map.of("approve", true))))
                .as("处理过的不能再处理").isEqualTo("SYS_4090");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM outbox_event WHERE event_type = 'SEEKER_NOTICE' AND aggregate_id = ?",
                Integer.class, app)).as("不同意会通知求职者").isEqualTo(1);

        // ---------------------------------------------------------------- 再次申请 → 项目经理同意并取消
        int quotaBefore = quota(job);
        long id2 = data(call(post(base), seeker, Map.of("reason", "家里有事去不了"))).get("id").asLong();
        data(call(post("/api/v1/tenant/cancel-requests/" + id2 + "/decide"), c.pm(), Map.of("approve", true)));
        assertThat(data(call(get(base), seeker, null)).get("status").asText()).isEqualTo("APPROVED");
        Map<String, Object> ended = jdbc.queryForMap("SELECT status, end_remark, end_operator_id FROM application WHERE application_id = ?", app);
        assertThat(String.valueOf(ended.get("status"))).as("报名已结束").isNotIn("PENDING_INTERVIEW", "PENDING_CONFIRM");
        assertThat(String.valueOf(ended.get("end_remark"))).contains("求职者申请取消").contains("家里有事去不了");
        assertThat(ended.get("end_operator_id")).as("R-04：取消有后台操作人").isNotNull();
        assertThat(quota(job)).as("名额退回").isEqualTo(quotaBefore + 1);
        assertThat(code(call(post(base), seeker, Map.of("reason", "还想取消")))).as("报名已结束不能再申请").isNotEqualTo("0");

        // ---------------------------------------------------------------- 报名因其他原因结束 → 待处理申请自动关闭
        data(call(post("/api/v1/seeker/match"), seeker, matchReq()));
        String app2 = apply(seeker, job);
        String base2 = "/api/v1/seeker/applications/" + app2 + "/cancel-request";
        data(call(post(base2), seeker, Map.of("reason", "报错岗位了")));
        data(call(post("/api/v1/tenant/applications/" + app2 + "/cancel"), c.site(), Map.of("reason", "岗位已招满")));
        assertThat(data(call(get(base2), seeker, null)).get("status").asText()).isEqualTo("CLOSED");
        assertThat(user).isNotBlank();
    }

    @Test
    void resignRequest() throws Exception {
        Company c = company();
        String job = job(c, c.projectId(), "离职申请验收岗位", 10);
        String seeker = readySeeker(null);
        String user = userId(seeker);
        String base = "/api/v1/seeker/resign-request";
        String date = LocalDate.now().plusDays(3).toString();

        assertThat(code(call(post(base), seeker, Map.of("resignDate", date, "reason", "回老家")))).as("没在岗不能申请离职").isNotEqualTo("0");
        employ(c, seeker, job);
        String empId = jdbc.queryForObject("SELECT employment_id FROM employment WHERE user_id = ?", String.class, user);
        assertThat(empty(data(call(get(base), seeker, null)))).isTrue();
        assertThat(code(call(post(base), seeker, Map.of("resignDate", LocalDate.now().minusDays(1).toString(), "reason", "回老家"))))
                .as("不能选过去的日期").isNotEqualTo("0");
        assertThat(code(call(post(base), seeker, Map.of("resignDate", LocalDate.now().plusDays(31).toString(), "reason", "回老家"))))
                .as("最多 30 天内").isNotEqualTo("0");

        // 申请 → 撤回 → 再申请
        JsonNode r = data(call(post(base), seeker, Map.of("resignDate", date, "reason", "回老家")));
        assertThat(r.get("status").asText()).isEqualTo("PENDING");
        assertThat(r.get("source").asText()).isEqualTo("SEEKER");
        assertThat(code(call(post(base), seeker, Map.of("resignDate", date, "reason", "再申请")))).as("已有在办的申请").isEqualTo("SYS_4090");
        data(call(post(base + "/withdraw"), seeker, null));
        assertThat(data(call(get(base), seeker, null)).get("status").asText()).isEqualTo("WITHDRAWN");
        assertThat(code(call(post(base + "/withdraw"), seeker, null))).as("没有可撤回的").isEqualTo("SYS_4090");
        long id = data(call(post(base), seeker, Map.of("resignDate", date, "reason", "回老家照顾家人"))).get("id").asLong();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM outbox_event WHERE event_type = 'STAFF_NOTICE' AND aggregate_id = ?",
                Integer.class, empId)).as("每次申请都通知项目经理").isEqualTo(2);

        // 项目经理在离职审核里看到「本人申请」并通过（离职日在未来 → 待生效）
        JsonNode row = null;
        for (JsonNode n : data(call(get("/api/v1/tenant/resign-requests?status=PENDING"), c.pm(), null))) {
            if (n.get("id").asLong() == id) {
                row = n;
            }
        }
        assertThat(row).isNotNull();
        assertThat(row.get("source").asText()).isEqualTo("SEEKER");
        data(call(post("/api/v1/tenant/resign-requests/" + id + "/decide"), c.pm(), Map.of("approve", true)));
        JsonNode after = data(call(get(base), seeker, null));
        assertThat(after.get("status").asText()).isEqualTo("SCHEDULED");
        assertThat(after.get("resignDate").asText()).isEqualTo(date);
        assertThat(code(call(post(base + "/withdraw"), seeker, null))).as("审核通过后不能自己撤回").isEqualTo("SYS_4090");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM outbox_event WHERE event_type = 'SEEKER_NOTICE' AND aggregate_id = ?",
                Integer.class, user)).as("审核结果通知本人").isEqualTo(1);

        // 驻场代办的离职不通知本人、本人也不能撤回
        String seeker2 = readySeeker(null);
        employ(c, seeker2, job);
        String emp2 = jdbc.queryForObject("SELECT employment_id FROM employment WHERE user_id = ?", String.class, userId(seeker2));
        data(call(post("/api/v1/tenant/employments/" + emp2 + "/resign"), c.site(), Map.of("resignDate", date, "reason", "驻场代办")));
        JsonNode staffMade = data(call(get(base), seeker2, null));
        assertThat(staffMade.get("source").asText()).isEqualTo("STAFF");
        assertThat(code(call(post(base + "/withdraw"), seeker2, null))).as("驻场发起的本人不能撤回").isEqualTo("SYS_4090");
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

    private static boolean empty(JsonNode n) {
        return n == null || n.isNull();
    }

    private static JsonNode find(JsonNode rows, String applicationId) {
        for (JsonNode n : rows) {
            if (applicationId.equals(n.get("applicationId").asText())) {
                return n;
            }
        }
        return null;
    }
}
