package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 上线门槛第 8 条：每个角色只能看到权限矩阵允许的数据（自动化越权测试）。
 * <ol>
 *   <li>账号域隔离：C 端 / 公司 / 平台三套令牌互不通用，未登录一律 401</li>
 *   <li>公司内角色矩阵：老板 / 项目经理 / 驻场按接口授权</li>
 *   <li>跨公司：拿到别家公司的 ID 也只返回 404（不暴露存在与否）</li>
 *   <li>脱敏：手机号只有驻场能看完整号码</li>
 * </ol>
 * 所有违规组合收集后一次性断言，失败信息列出全部违规项。
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
class RoleMatrixIT extends FlowItSupport {

    @Test
    void authorizationMatrix() throws Exception {
        Company a = company();
        Company b = company();
        String jobA = job(a, a.projectId(), "越权测试岗位 A", 5);
        String jobB = job(b, b.projectId(), "越权测试岗位 B", 5);
        String seeker = readySeeker(null);
        String appB = apply(seeker, jobB);

        Map<String, String> who = new LinkedHashMap<>();
        who.put("anonymous", null);
        who.put("seeker", seeker);
        who.put("owner", a.owner());
        who.put("pm", a.pm());
        who.put("site", a.site());
        who.put("ops", ops);

        // 期望状态：未列出的身份 = 403（未登录 = 401）
        Map<String, Map<String, Integer>> matrix = new LinkedHashMap<>();
        matrix.put("/api/v1/seeker/me", Map.of("seeker", 200));
        matrix.put("/api/v1/seeker/applications", Map.of("seeker", 200));
        matrix.put("/api/v1/tenant/me", Map.of("owner", 200, "pm", 200, "site", 200));
        matrix.put("/api/v1/tenant/applications", Map.of("owner", 200, "pm", 200, "site", 200));
        matrix.put("/api/v1/tenant/site/workbench", Map.of("owner", 200, "pm", 200, "site", 200));
        matrix.put("/api/v1/tenant/bills", Map.of("owner", 200));
        matrix.put("/api/v1/tenant/reports/overview", Map.of("owner", 200));
        matrix.put("/api/v1/tenant/reports/channels", Map.of("owner", 200, "pm", 200));
        matrix.put("/api/v1/tenant/reports/board", Map.of("owner", 200, "pm", 200, "site", 200));
        matrix.put("/api/v1/tenant/kb", Map.of("owner", 200, "pm", 200));
        matrix.put("/api/v1/tenant/kb/pending", Map.of("owner", 200, "pm", 200));
        matrix.put("/api/v1/tenant/resign-requests", Map.of("pm", 200, "site", 200));
        matrix.put("/api/v1/tenant/payroll/batches", Map.of("owner", 200, "pm", 200));
        matrix.put("/api/v1/tenant/broker/cases", Map.of("pm", 200, "site", 200));
        matrix.put("/api/v1/ops/reports/overview", Map.of("ops", 200));
        matrix.put("/api/v1/ops/complaints", Map.of("ops", 200));
        matrix.put("/api/v1/ops/kyc-reviews", Map.of("ops", 200));
        matrix.put("/api/v1/ops/blacklist", Map.of("ops", 200));
        matrix.put("/api/v1/ops/notify-templates", Map.of("ops", 200));
        matrix.put("/api/v1/ops/engine/versions", Map.of("ops", 200));
        matrix.put("/api/v1/ops/audit-logs", Map.of("ops", 200));

        List<String> violations = new ArrayList<>();
        for (var e : matrix.entrySet()) {
            for (var w : who.entrySet()) {
                int expected = e.getValue().getOrDefault(w.getKey(), w.getValue() == null ? 401 : 403);
                int actual = status(get(e.getKey()), w.getValue(), null);
                if (actual != expected) {
                    violations.add(w.getKey() + " GET " + e.getKey() + " → " + actual + "（期望 " + expected + "）");
                }
            }
        }

        // 跨公司：A 公司成员访问 B 公司的报名 / 岗位
        for (String t : List.of(a.owner(), a.pm(), a.site())) {
            expectNotVisible(violations, "/api/v1/tenant/applications/" + appB, t);
            expectNotVisible(violations, "/api/v1/tenant/jobs/" + jobB, t);
        }
        // B 公司成员能看到自己的报名
        int own = status(get("/api/v1/tenant/applications/" + appB), b.site(), null);
        if (own != 200) {
            violations.add("B 驻场访问本公司报名 → " + own);
        }
        // A 公司列表里不出现 B 公司的报名
        if (data(call(get("/api/v1/tenant/applications?pageSize=100"), a.site(), null)).toString().contains(appB)) {
            violations.add("A 公司报名列表出现了 B 公司的报名");
        }

        // 脱敏：驻场看完整手机号，项目经理 / 老板看不到
        JsonNode bySite = data(call(get("/api/v1/tenant/applications/" + appB), b.site(), null));
        JsonNode byPm = data(call(get("/api/v1/tenant/applications/" + appB), b.pm(), null));
        JsonNode byOwner = data(call(get("/api/v1/tenant/applications/" + appB), b.owner(), null));
        if (!bySite.hasNonNull("phone") || bySite.get("phone").asText().contains("*")) {
            violations.add("驻场没有拿到完整手机号");
        }
        if (byPm.hasNonNull("phone") || byOwner.hasNonNull("phone")) {
            violations.add("项目经理 / 老板拿到了手机号");
        }
        // 岗位本身：A 公司岗位对 C 端只在匹配结果里可见，岗位详情不泄露公司内部字段
        String jobDetail = data(call(get("/api/v1/seeker/jobs/" + jobA), seeker, null)).toString();
        for (String f : List.of("matchWeight", "creditScore", "quotaTotal")) {
            if (jobDetail.contains(f)) {
                violations.add("C 端岗位详情泄露字段 " + f);
            }
        }

        assertThat(violations).as("越权 / 泄露清单").isEmpty();
    }

    private void expectNotVisible(List<String> violations, String path, String token) throws Exception {
        int s = status(get(path), token, null);
        if (s != 404 && s != 403) {
            violations.add("跨公司 GET " + path + " → " + s + "（期望 404）");
        }
    }
}
