package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.KvStore;
import com.shitu.identity.captcha.CaptchaService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * Sprint 1 端到端验收（docs/03 Sprint 1「验收」）：真实 MySQL + 完整安全链路 + 多租户拦截器。
 * <ol>
 *   <li>公司入驻：非成员手机号 → 入驻票据 → 上传执照 → 申请（老板登录，审核前不能用业务功能）→ 平台通过 → 免费期；</li>
 *   <li>组织：老板加项目经理；甲方 + 合作合同备案；项目经理建项目、发岗位 → 平台审核上架 → 暂停 / 恢复 / 调名额；</li>
 *   <li>渠道：公司码 /r/{code} 302；扫 A 码注册 → source = bound = A、PRIVATE_PENDING、24h 窗口；自主注册 → PLATFORM / 公域；
 *       已注册用户扫 B 码归属不变；</li>
 *   <li>隔离：B 公司看不到 A 公司的岗位 / 成员（404）；求职者 token 不能访问租户接口；</li>
 *   <li>会话：refresh 轮换；旧 refresh token 重放 → 会话吊销。</li>
 * </ol>
 * 运行：{@code SHITU_IT=true DB_PASSWORD=xxx mvn -Paliyun -pl shitu-app -am test -Dtest=Sprint1FlowIT -Dsurefire.failIfNoSpecifiedTests=false}
 * （使用独立库 shitu_it，首次运行自动建库并执行全部迁移）。
 */
@EnabledIfEnvironmentVariable(named = "SHITU_IT", matches = "true")
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:mysql://${DB_HOST:127.0.0.1}:${DB_PORT:3306}/shitu_it?useUnicode=true&characterEncoding=utf8"
                + "&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true&createDatabaseIfNotExist=true",
        "shitu.sms.expose-code-in-mock=true",
        "shitu.sms.captcha-after-per-ip=100000",
        "shitu.sms.ip-hourly-limit=100000",
        "shitu.ops.init-password=ItSuper2026",
        "shitu.jwt.reuse-grace=PT0S",
        "shitu.storage.local-dir=./target/it-uploads"
})
@AutoConfigureMockMvc
class Sprint1FlowIT {

    private static final SecureRandom RND = new SecureRandom();

    @Autowired
    MockMvc mvc;
    @Autowired
    ObjectMapper json;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    KvStore kv;
    @Autowired
    FieldCipher cipher;
    @MockitoSpyBean
    CaptchaService captcha;

    @BeforeEach
    void captchaAlwaysPasses() {
        doReturn(true).when(captcha).verify(any(), any());
        // 测试库里的超管跳过首登改密（改密流程本身由 OpsPasswordInterceptor 保证）
        jdbc.update("UPDATE ops_admin SET must_change_password = 0 WHERE username = 'admin'");
    }

    @Test
    void sprint1Acceptance() throws Exception {
        // ---------------------------------------------------------------- 平台登录
        String ops = data(call(post("/api/v1/ops/auth/login"), null,
                Map.of("username", "admin", "password", "ItSuper2026", "captchaId", "x", "captchaCode", "x"))).get("accessToken").asText();

        // ---------------------------------------------------------------- A 公司入驻
        Company a = onboard("昆山仕兔A劳务派遣有限公司", ops);
        Company b = onboard("苏州仕兔B人力资源有限公司", ops);

        // 免费期：入驻日 + 3 个月 − 1 天
        JsonNode comp = data(call(get("/api/v1/tenant/company"), a.ownerToken, null));
        assertThat(comp.get("status").asText()).isEqualTo("NORMAL");
        LocalDate onboard = LocalDate.parse(comp.get("onboardDate").asText());
        assertThat(LocalDate.parse(comp.get("freePeriodEnd").asText())).isEqualTo(onboard.plusMonths(3).minusDays(1));

        // ---------------------------------------------------------------- 组织：老板加项目经理
        String pmPhone = phone();
        JsonNode pm = data(call(post("/api/v1/tenant/members"), a.ownerToken,
                Map.of("name", "刘建国", "phone", pmPhone, "roles", new String[]{"PM"})));
        String pmId = pm.get("memberId").asText();
        assertThat(pm.get("phoneMasked").asText()).contains("****");
        // 同一手机号不能加入第二家公司
        assertThat(code(call(post("/api/v1/tenant/members"), b.ownerToken,
                Map.of("name", "张三", "phone", pmPhone, "roles", new String[]{"SITE"})))).isEqualTo("TEN_4002");
        // 老板以外的角色不能管理成员
        String pmToken = tenantLogin(pmPhone);
        assertThat(status(post("/api/v1/tenant/members"), pmToken,
                Map.of("name", "x", "phone", phone(), "roles", new String[]{"SITE"}))).isEqualTo(403);

        // ---------------------------------------------------------------- 甲方 + 合作合同
        JsonNode client = data(call(post("/api/v1/tenant/clients"), pmToken,
                Map.of("name", "立讯精密工业（昆山）有限公司" + RND.nextInt(100000), "city", "苏州")));
        String clientId = client.get("clientId").asText();
        Map<String, Object> projectReq = Map.of("name", "立讯昆山二期", "clientId", clientId, "city", "苏州",
                "address", "昆山市锦溪镇长云路 1 号");
        String projectId = data(call(post("/api/v1/tenant/projects"), pmToken, projectReq)).get("projectId").asText();

        // 没有备案合同不能发岗位
        assertThat(code(call(post("/api/v1/tenant/jobs"), pmToken, jobReq(projectId, 30)))).isEqualTo("TEN_4004");

        String contractKey = data(upload("/api/v1/tenant/files?category=contract", pmToken, null)).get("key").asText();
        String contractId = data(call(post("/api/v1/tenant/client-contracts"), pmToken, Map.of("clientId", clientId,
                "fileKey", contractKey, "validFrom", LocalDate.now().minusDays(1).toString(),
                "validTo", LocalDate.now().plusYears(1).toString()))).get("contractId").asText();
        // 别的公司不能引用 A 公司上传的文件
        assertThat(code(call(post("/api/v1/tenant/client-contracts"), b.ownerToken, Map.of("clientId", clientId,
                "fileKey", contractKey, "validFrom", LocalDate.now().toString(),
                "validTo", LocalDate.now().plusYears(1).toString())))).isEqualTo("TEN_4008");
        data(call(post("/api/v1/ops/client-contracts/" + contractId + "/approve"), ops, Map.of()));

        // ---------------------------------------------------------------- 岗位：发布 → 审核 → 暂停 / 恢复 / 调名额
        JsonNode job = data(call(post("/api/v1/tenant/jobs"), pmToken, jobReq(projectId, 30)));
        String jobId = job.get("jobId").asText();
        assertThat(job.get("status").asText()).isEqualTo("PENDING_AUDIT");
        assertThat(job.has("matchWeight")).isFalse();
        data(call(post("/api/v1/ops/jobs/" + jobId + "/approve"), ops, Map.of()));
        job = data(call(get("/api/v1/tenant/jobs/" + jobId), pmToken, null));
        assertThat(job.get("status").asText()).isEqualTo("RECRUITING");
        assertThat(job.get("allowedActions").toString()).contains("PAUSE");
        assertThat(data(call(post("/api/v1/tenant/jobs/" + jobId + "/pause"), pmToken, Map.of())).get("status").asText()).isEqualTo("PAUSED");
        assertThat(data(call(post("/api/v1/tenant/jobs/" + jobId + "/resume"), pmToken, Map.of())).get("status").asText()).isEqualTo("RECRUITING");
        job = data(call(put("/api/v1/tenant/jobs/" + jobId + "/quota"), pmToken, Map.of("quotaTotal", 50)));
        assertThat(job.get("quotaTotal").asInt()).isEqualTo(50);
        assertThat(job.get("quotaRemaining").asInt()).isEqualTo(50);
        assertThat(job.get("status").asText()).isEqualTo("RECRUITING");
        // 岗位管理只有项目经理
        assertThat(status(post("/api/v1/tenant/jobs/" + jobId + "/pause"), a.ownerToken, Map.of())).isEqualTo(403);

        // ---------------------------------------------------------------- 多租户隔离
        assertThat(status(get("/api/v1/tenant/jobs/" + jobId), b.ownerToken, null)).isEqualTo(404);
        assertThat(status(put("/api/v1/tenant/members/" + pmId), b.ownerToken,
                Map.of("name", "篡改", "roles", new String[]{"OWNER"}))).isEqualTo(404);
        assertThat(data(call(get("/api/v1/tenant/jobs"), b.ownerToken, null)).get("total").asLong()).isZero();

        // ---------------------------------------------------------------- 渠道码 → 扫码注册
        String codeA = data(call(post("/api/v1/tenant/channel-codes"), a.ownerToken, Map.of("name", "门店海报"))).get("code").asText();
        String codeB = data(call(post("/api/v1/tenant/channel-codes"), b.ownerToken, Map.of("name", "B 公司海报"))).get("code").asText();

        MvcResult redirect = mvc.perform(get("/r/" + codeA)).andReturn();
        assertThat(redirect.getResponse().getStatus()).isEqualTo(302);
        assertThat(redirect.getResponse().getHeader("Location")).endsWith("ch=" + codeA);
        assertThat(redirect.getResponse().getCookie("shitu_ch").getValue()).isEqualTo(codeA);

        // 扫 A 公司码注册：source = bound = A、私域待匹配、24h 窗口
        String seeker1Phone = phone();
        JsonNode s1 = seekerLogin(seeker1Phone, codeA);
        assertThat(s1.get("newUser").asBoolean()).isTrue();
        JsonNode p1 = s1.get("profile");
        assertThat(p1.get("status").asText()).isEqualTo("PRIVATE_PENDING");
        assertThat(p1.get("sourceIsPlatform").asBoolean()).isFalse();
        assertThat(p1.get("responseDeadline").isNull()).isFalse();
        String u1 = p1.get("userId").asText();
        Map<String, Object> row = jdbc.queryForMap("SELECT source_company_id, bound_company_id, user_status FROM `user` WHERE user_id = ?", u1);
        assertThat(row.get("source_company_id")).isEqualTo(a.companyId);
        assertThat(row.get("bound_company_id")).isEqualTo(a.companyId);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM response_window WHERE user_id = ? AND status = 'OPEN'", Long.class, u1)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM user_status_log WHERE user_id = ? AND event = 'REGISTER_VIA_COMPANY'", Long.class, u1)).isEqualTo(1);

        // 自主注册：PLATFORM / 公域
        JsonNode p2 = seekerLogin(phone(), null).get("profile");
        assertThat(p2.get("status").asText()).isEqualTo("PUBLIC_SEEKING");
        assertThat(p2.get("sourceIsPlatform").asBoolean()).isTrue();
        assertThat(p2.get("domainTag").asText()).isEqualTo("PUBLIC");

        // 已注册用户再扫 B 公司码：归属不变（C-106）
        JsonNode again = seekerLogin(seeker1Phone, codeB);
        assertThat(again.get("newUser").asBoolean()).isFalse();
        row = jdbc.queryForMap("SELECT source_company_id, bound_company_id FROM `user` WHERE user_id = ?", u1);
        assertThat(row.get("source_company_id")).isEqualTo(a.companyId);
        assertThat(row.get("bound_company_id")).isEqualTo(a.companyId);

        // 渠道统计：A 码 1 次访问、1 个注册
        JsonNode codes = data(call(get("/api/v1/tenant/channel-codes"), a.ownerToken, null));
        JsonNode item = null;
        for (JsonNode c : codes) {
            if (c.get("code").asText().equals(codeA)) {
                item = c;
            }
        }
        assertThat(item).isNotNull();
        assertThat(item.get("registrations").asLong()).isEqualTo(1);
        assertThat(item.get("visits").asLong()).isGreaterThanOrEqualTo(1);

        // 求职者 token 不能访问租户 / 平台接口
        String seekerToken = again.get("accessToken").asText();
        assertThat(status(get("/api/v1/tenant/me"), seekerToken, null)).isEqualTo(403);
        assertThat(status(get("/api/v1/ops/companies"), seekerToken, null)).isEqualTo(403);
        assertThat(code(call(get("/api/v1/seeker/me"), seekerToken, null))).isEqualTo("0");

        // ---------------------------------------------------------------- 会话：refresh 轮换 + 重放检测
        MvcResult login = sendTenantLogin(pmPhone);
        Cookie rt1 = login.getResponse().getCookie("shitu_rt");
        MvcResult r2 = mvc.perform(post("/api/v1/tenant/auth/refresh").header("X-Requested-With", "XMLHttpRequest").cookie(rt1)).andReturn();
        assertThat(body(r2).get("code").asText()).isEqualTo("0");
        Cookie rt2 = r2.getResponse().getCookie("shitu_rt");
        assertThat(rt2.getValue()).isNotEqualTo(rt1.getValue());
        // 没有自定义头的刷新请求拒绝（CSRF）
        assertThat(mvc.perform(post("/api/v1/tenant/auth/refresh").cookie(rt2)).andReturn().getResponse().getStatus()).isEqualTo(403);
        // 旧 token 重放 → 吊销整个会话，新 token 也随之失效
        assertThat(mvc.perform(post("/api/v1/tenant/auth/refresh").header("X-Requested-With", "XMLHttpRequest").cookie(rt1))
                .andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(mvc.perform(post("/api/v1/tenant/auth/refresh").header("X-Requested-With", "XMLHttpRequest").cookie(rt2))
                .andReturn().getResponse().getStatus()).isEqualTo(401);

        // ---------------------------------------------------------------- 审计
        JsonNode logs = data(call(get("/api/v1/ops/audit-logs?companyId=" + a.companyId + "&action=COMPANY_APPROVE"), ops, null));
        assertThat(logs.get("total").asLong()).isEqualTo(1);
    }

    // ==================================================================== helpers

    record Company(String companyId, String ownerToken) {
    }

    private Company onboard(String name, String ops) throws Exception {
        String ownerPhone = phone();
        JsonNode r = data(sendTenantLoginJson(ownerPhone));
        assertThat(r.get("status").asText()).isEqualTo("NOT_MEMBER");
        String ticket = r.get("onboardingTicket").asText();
        String licenseKey = data(upload("/api/v1/tenant/onboarding/files", null, ticket)).get("key").asText();
        String owner = data(call(post("/api/v1/tenant/onboarding/apply").header("X-Onboarding-Ticket", ticket), null,
                Map.of("name", name + RND.nextInt(10000), "unifiedCreditCode", creditCode(), "contactName", "郭伟",
                        "licenseFiles", new String[]{licenseKey}))).get("accessToken").asText();
        JsonNode me = data(call(get("/api/v1/tenant/me"), owner, null));
        assertThat(me.get("company").get("status").asText()).isEqualTo("PENDING_AUDIT");
        assertThat(me.get("operational").asBoolean()).isFalse();
        assertThat(me.get("roles").toString()).contains("OWNER");
        // 审核通过前不能使用业务功能
        assertThat(code(call(get("/api/v1/tenant/projects"), owner, null))).isEqualTo("TEN_4003");
        String companyId = me.get("company").get("companyId").asText();
        assertThat(data(call(get("/api/v1/ops/pending"), ops, null)).get("companies").asLong()).isGreaterThanOrEqualTo(1);
        data(call(post("/api/v1/ops/companies/" + companyId + "/approve"), ops, Map.of()));
        assertThat(data(call(get("/api/v1/tenant/me"), owner, null)).get("operational").asBoolean()).isTrue();
        return new Company(companyId, owner);
    }

    private Map<String, Object> jobReq(String projectId, int quota) {
        return Map.ofEntries(Map.entry("projectId", projectId), Map.entry("title", "SMT 操作工（长白班）"),
                Map.entry("jobType", "ELECTRONICS"), Map.entry("salaryMin", 5500), Map.entry("salaryMax", 6800),
                Map.entry("shiftType", "LONG_DAY"), Map.entry("dormProvided", true), Map.entry("dormRoomSize", 6),
                Map.entry("mealProvided", true), Map.entry("duties", "贴片机上下料、目检"),
                Map.entry("interviewAddress", "昆山市锦溪镇长云路 1 号东门"), Map.entry("quotaTotal", quota));
    }

    private String tenantLogin(String phone) throws Exception {
        JsonNode d = data(sendTenantLoginJson(phone));
        assertThat(d.get("status").asText()).isEqualTo("OK");
        return d.get("accessToken").asText();
    }

    private MvcResult sendTenantLogin(String phone) throws Exception {
        kv.delete("sms:iv:tenant:" + cipher.blindIndex(phone));
        String code = data(call(post("/api/v1/tenant/auth/sms-code"), null, Map.of("phone", phone))).get("devCode").asText();
        return mvc.perform(post("/api/v1/tenant/auth/sms-login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("phone", phone, "code", code)))).andReturn();
    }

    private JsonNode sendTenantLoginJson(String phone) throws Exception {
        return body(sendTenantLogin(phone));
    }

    private JsonNode seekerLogin(String phone, String channelCode) throws Exception {
        kv.delete("sms:iv:seeker:" + cipher.blindIndex(phone));
        String code = data(call(post("/api/v1/seeker/auth/sms-code"), null, Map.of("phone", phone))).get("devCode").asText();
        Map<String, Object> req = channelCode == null ? Map.of("phone", phone, "code", code)
                : Map.of("phone", phone, "code", code, "channelCode", channelCode);
        return data(call(post("/api/v1/seeker/auth/sms-login"), null, req));
    }

    private JsonNode upload(String path, String token, String ticket) throws Exception {
        byte[] png = new byte[64];
        System.arraycopy(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, 0, png, 0, 8);
        var req = multipart(path).file(new MockMultipartFile("file", "license.png", "image/png", png));
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (ticket != null) {
            req.header("X-Onboarding-Ticket", ticket);
        }
        return body(mvc.perform(req).andReturn());
    }

    private JsonNode call(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        return body(perform(req, token, payload));
    }

    private int status(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        return perform(req, token, payload).getResponse().getStatus();
    }

    private MvcResult perform(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (payload != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(payload));
        }
        return mvc.perform(req).andReturn();
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsByteArray());
    }

    private static JsonNode data(JsonNode body) {
        assertThat(body.get("code").asText()).as(body.toString()).isEqualTo("0");
        return body.get("data");
    }

    private static String code(JsonNode body) {
        return body.get("code").asText();
    }

    private static String phone() {
        return "139" + String.format("%08d", RND.nextInt(100_000_000));
    }

    /** 随机但格式合法的统一社会信用代码（91 + 6 位行政区划 + 10 位）。 */
    private static String creditCode() {
        String alphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY";
        StringBuilder sb = new StringBuilder("91320583");
        for (int i = 0; i < 10; i++) {
            sb.append(alphabet.charAt(RND.nextInt(alphabet.length())));
        }
        return sb.toString();
    }
}
