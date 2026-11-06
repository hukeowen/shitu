package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.KvStore;
import com.shitu.identity.captcha.CaptchaService;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 端到端验收测试的公共部分：登录、建公司 / 成员 / 项目 / 岗位、求职者问薪到报名。
 * 子类自己声明 {@code @SpringBootTest(properties = ...)}（使用独立库 shitu_it）。
 */
abstract class FlowItSupport {

    static final SecureRandom RND = new SecureRandom();
    static final String IT_DB = "spring.datasource.url=jdbc:mysql://${DB_HOST:127.0.0.1}:${DB_PORT:3306}/shitu_it?useUnicode=true"
            + "&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true&createDatabaseIfNotExist=true";

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

    /** 本次运行独有的城市：地域锁定后只会匹配到本测试建的岗位。 */
    final String city = "验收" + RND.nextInt(1_000_000) + "市";
    String ops;

    record Company(String companyId, String owner, String pm, String site, String projectId, String projectId2,
                   String clientId) {
    }

    @BeforeEach
    void baseSetUp() throws Exception {
        doReturn(true).when(captcha).verify(any(), any());
        jdbc.update("UPDATE ops_admin SET must_change_password = 0 WHERE username = 'admin'");
        ops = data(call(post("/api/v1/ops/auth/login"), null,
                Map.of("username", "admin", "password", "ItSuper2026", "captchaId", "x", "captchaCode", "x"))).get("accessToken").asText();
    }

    /** 审核通过的公司：老板、项目经理（负责两个项目）、驻场（负责项目 1）、甲方合同已备案。 */
    Company company() throws Exception {
        String ticket = data(tenantLogin(phone())).get("onboardingTicket").asText();
        String license = data(upload("/api/v1/tenant/onboarding/files", null, ticket)).get("key").asText();
        String owner = data(call(post("/api/v1/tenant/onboarding/apply").header("X-Onboarding-Ticket", ticket), null,
                Map.of("name", "验收劳务派遣有限公司" + RND.nextInt(100000), "unifiedCreditCode", creditCode(),
                        "contactName", "郭伟", "licenseFiles", new String[]{license}))).get("accessToken").asText();
        String companyId = data(call(get("/api/v1/tenant/me"), owner, null)).get("company").get("companyId").asText();
        data(call(post("/api/v1/ops/companies/" + companyId + "/approve"), ops, Map.of()));
        String pmPhone = phone();
        data(call(post("/api/v1/tenant/members"), owner, Map.of("name", "刘建国", "phone", pmPhone, "roles", new String[]{"PM"})));
        String pm = data(tenantLogin(pmPhone)).get("accessToken").asText();
        String clientId = data(call(post("/api/v1/tenant/clients"), pm, Map.of("name", "验收甲方电子有限公司" + RND.nextInt(100000)))).get("clientId").asText();
        String key = data(upload("/api/v1/tenant/files?category=contract", pm, null)).get("key").asText();
        String contractId = data(call(post("/api/v1/tenant/client-contracts"), pm, Map.of("clientId", clientId, "fileKey", key,
                "validFrom", LocalDate.now().minusDays(1).toString(), "validTo", LocalDate.now().plusYears(1).toString()))).get("contractId").asText();
        data(call(post("/api/v1/ops/client-contracts/" + contractId + "/approve"), ops, Map.of()));
        String p1 = data(call(post("/api/v1/tenant/projects"), pm, Map.of("name", "验收项目一", "clientId", clientId,
                "city", city, "address", city + "工业园 1 号"))).get("projectId").asText();
        String p2 = data(call(post("/api/v1/tenant/projects"), pm, Map.of("name", "验收项目二", "clientId", clientId,
                "city", city, "address", city + "工业园 2 号"))).get("projectId").asText();
        String sitePhone = phone();
        data(call(post("/api/v1/tenant/members"), owner, Map.of("name", "王磊", "phone", sitePhone, "roles", new String[]{"SITE"},
                "projectIds", new String[]{p1})));
        String site = data(tenantLogin(sitePhone)).get("accessToken").asText();
        return new Company(companyId, owner, pm, site, p1, p2, clientId);
    }

    String job(Company c, String projectId, String title, int quota) throws Exception {
        String jobId = data(call(post("/api/v1/tenant/jobs"), c.pm(), Map.ofEntries(Map.entry("projectId", projectId),
                Map.entry("title", title), Map.entry("jobType", "ELECTRONICS"), Map.entry("salaryMin", 5500),
                Map.entry("salaryMax", 6800), Map.entry("shiftType", "LONG_DAY"), Map.entry("dormProvided", true),
                Map.entry("dormRoomSize", 4), Map.entry("dormAircon", true), Map.entry("mealProvided", true),
                Map.entry("duties", "贴片机上下料、目检"), Map.entry("interviewAddress", city + "工业园东门"),
                Map.entry("quotaTotal", quota)))).get("jobId").asText();
        data(call(post("/api/v1/ops/jobs/" + jobId + "/approve"), ops, Map.of()));
        return jobId;
    }

    /** 新求职者：注册（可带渠道码）→ 告知书 → 实名 → 问薪；返回 token。 */
    String readySeeker(String channelCode) throws Exception {
        String t = seekerLogin(phone(), channelCode);
        String v = data(call(get("/api/v1/seeker/disclaimer"), t, null)).get("version").asText();
        data(call(post("/api/v1/seeker/disclaimer/agree"), t, Map.of("version", v)));
        String id = idCard(20 + RND.nextInt(20));
        data(call(post("/api/v1/seeker/kyc"), t, Map.of("realName", "张浩", "idCard", id, "idCardConfirm", id)));
        data(call(post("/api/v1/seeker/match"), t, matchReq()));
        return t;
    }

    /** 报名并返回报名单号。 */
    String apply(String seeker, String jobId) throws Exception {
        return data(call(post("/api/v1/seeker/applications"), seeker, Map.of("jobId", jobId))).get("applicationId").asText();
    }

    Map<String, Object> matchReq() {
        return Map.of("answers", List.of(
                Map.of("seq", 1, "code", "A"), Map.of("seq", 2, "code", "A", "region", city), Map.of("seq", 3, "code", "A"),
                Map.of("seq", 4, "code", "B"), Map.of("seq", 5, "code", "D"), Map.of("seq", 6, "code", "B"),
                Map.of("seq", 7, "code", "C")));
    }

    List<String> jobIds(JsonNode outcome) {
        List<String> ids = new ArrayList<>();
        outcome.get("results").forEach(r -> ids.add(r.get("jobId").asText()));
        return ids;
    }

    int quota(String jobId) {
        return jdbc.queryForObject("SELECT quota_remaining FROM job WHERE job_id = ?", Integer.class, jobId);
    }

    String userId(String seekerToken) throws Exception {
        return data(call(get("/api/v1/seeker/me"), seekerToken, null)).get("userId").asText();
    }

    Map<String, Object> user(String userId) {
        return jdbc.queryForMap("SELECT user_status, bound_company_id, last_release_reason, current_application_id FROM `user` WHERE user_id = ?", userId);
    }

    static JsonNode find(JsonNode arr, String field, String value) {
        for (JsonNode n : arr) {
            if (n.get(field).asText().equals(value)) {
                return n;
            }
        }
        throw new AssertionError(field + "=" + value + " not found in " + arr);
    }

    JsonNode tenantLogin(String phone) throws Exception {
        kv.delete("sms:iv:tenant:" + cipher.blindIndex(phone));
        String code = data(call(post("/api/v1/tenant/auth/sms-code"), null, Map.of("phone", phone))).get("devCode").asText();
        return call(post("/api/v1/tenant/auth/sms-login"), null, Map.of("phone", phone, "code", code));
    }

    String seekerLogin(String phone, String channelCode) throws Exception {
        kv.delete("sms:iv:seeker:" + cipher.blindIndex(phone));
        String code = data(call(post("/api/v1/seeker/auth/sms-code"), null, Map.of("phone", phone))).get("devCode").asText();
        Map<String, Object> req = channelCode == null ? Map.of("phone", phone, "code", code)
                : Map.of("phone", phone, "code", code, "channelCode", channelCode);
        return data(call(post("/api/v1/seeker/auth/sms-login"), null, req)).get("accessToken").asText();
    }

    JsonNode upload(String path, String token, String ticket) throws Exception {
        byte[] png = new byte[64];
        System.arraycopy(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, 0, png, 0, 8);
        var req = multipart(path).file(new MockMultipartFile("file", "f.png", "image/png", png));
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (ticket != null) {
            req.header("X-Onboarding-Ticket", ticket);
        }
        return body(mvc.perform(req).andReturn());
    }

    JsonNode call(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        return body(perform(req, token, payload));
    }

    int status(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        return perform(req, token, payload).getResponse().getStatus();
    }

    MvcResult perform(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (payload != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(payload));
        }
        return mvc.perform(req).andReturn();
    }

    JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsByteArray());
    }

    static JsonNode data(JsonNode body) {
        assertThat(body.get("code").asText()).as(body.toString()).isEqualTo("0");
        return body.get("data");
    }

    static String code(JsonNode body) {
        return body.get("code").asText();
    }

    static String phone() {
        return "136" + String.format("%08d", RND.nextInt(100_000_000));
    }

    static String creditCode() {
        String alphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY";
        StringBuilder sb = new StringBuilder("91320583");
        for (int i = 0; i < 10; i++) {
            sb.append(alphabet.charAt(RND.nextInt(alphabet.length())));
        }
        return sb.toString();
    }

    static String idCard(int age) {
        return Sprint2FlowIT.idCard(age);
    }
}
