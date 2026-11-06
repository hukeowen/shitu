package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.KvStore;
import com.shitu.identity.captcha.CaptchaService;
import com.shitu.lifecycle.seeker.ResponseWindowScanner;
import com.shitu.matching.domain.MatchProfile;
import com.shitu.matching.domain.MatchScorer;
import com.shitu.matching.quiz.QuizService;
import com.shitu.matching.session.MatchService;
import com.shitu.notify.outbox.OutboxDispatcher;
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
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Sprint 2 端到端验收（docs/03 Sprint 2「验收」）：
 * <ol>
 *   <li>问薪 → 结果 → 详情（仅限结果内岗位）→ 告知书 → 实名（两次输入比对）→ 报名；</li>
 *   <li>报名后再进入问薪被拒绝、不能重复报名；</li>
 *   <li><b>并发 50 人抢最后 1 个名额，只有 1 人成功</b>；</li>
 *   <li>24h 到期（把截止时间改到过去再执行扫描）自动释放：归属清空、报名单超时、名额回补、状态日志、站内信；</li>
 *   <li>私域用户只匹配本公司岗位；驻场知悉推送面试信息 → 求职者收到通知；</li>
 *   <li>匹配结果可以凭快照复现。</li>
 * </ol>
 * 定时任务关闭，由测试直接驱动扫描和投递。运行方式同 {@link Sprint1FlowIT}。
 */
@EnabledIfEnvironmentVariable(named = "SHITU_IT", matches = "true")
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:mysql://${DB_HOST:127.0.0.1}:${DB_PORT:3306}/shitu_it?useUnicode=true&characterEncoding=utf8"
                + "&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true&createDatabaseIfNotExist=true",
        "shitu.sms.expose-code-in-mock=true",
        "shitu.sms.captcha-after-per-ip=100000",
        "shitu.sms.ip-hourly-limit=100000",
        "shitu.ops.init-password=ItSuper2026",
        "shitu.scheduling.enabled=false",
        "shitu.storage.local-dir=./target/it-uploads",
        "spring.datasource.hikari.maximum-pool-size=40"
})
@AutoConfigureMockMvc
class Sprint2FlowIT {

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
    @Autowired
    ResponseWindowScanner scanner;
    @Autowired
    OutboxDispatcher dispatcher;
    @Autowired
    MatchService matchService;
    @Autowired
    QuizService quizService;
    @MockitoSpyBean
    CaptchaService captcha;

    /** 本次运行独有的城市名：地域锁定后只会匹配到本测试建的岗位，不受库里历史数据影响。 */
    final String city = "验收" + RND.nextInt(1_000_000) + "市";

    @BeforeEach
    void setUp() {
        doReturn(true).when(captcha).verify(any(), any());
        jdbc.update("UPDATE ops_admin SET must_change_password = 0 WHERE username = 'admin'");
    }

    @Test
    void sprint2Acceptance() throws Exception {
        String ops = data(call(post("/api/v1/ops/auth/login"), null,
                Map.of("username", "admin", "password", "ItSuper2026", "captchaId", "x", "captchaCode", "x"))).get("accessToken").asText();

        // ---------------------------------------------------------------- 准备：公司、驻场、项目、两个岗位
        String ownerPhone = phone();
        String ticket = data(tenantLogin(ownerPhone)).get("onboardingTicket").asText();
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
        String projectId = data(call(post("/api/v1/tenant/projects"), pm, Map.of("name", "验收项目", "clientId", clientId,
                "city", city, "address", city + "工业园 1 号", "lng", 120.958, "lat", 31.385))).get("projectId").asText();
        String sitePhone = phone();
        data(call(post("/api/v1/tenant/members"), owner, Map.of("name", "王磊", "phone", sitePhone, "roles", new String[]{"SITE"},
                "projectIds", new String[]{projectId})));
        String site = data(tenantLogin(sitePhone)).get("accessToken").asText();

        String lastSeat = createJob(pm, ops, projectId, "最后一个名额的岗位", 1);
        String roomy = createJob(pm, ops, projectId, "名额充足的岗位", 20);

        // ---------------------------------------------------------------- 1. 问薪 → 详情 → 告知书 → 实名 → 报名
        String s1 = seekerLogin(phone(), null);
        JsonNode m = data(call(post("/api/v1/seeker/match"), s1, matchReq()));
        assertThat(m.get("matched").asBoolean()).isTrue();
        assertThat(m.get("scope").asText()).isEqualTo("ALL_PLATFORM");
        assertThat(jobIds(m)).contains(lastSeat, roomy);
        assertThat(m.get("results").get(0).get("matchScore").decimalValue()).isGreaterThanOrEqualTo(new java.math.BigDecimal("80"));
        assertThat(m.get("results").get(0).has("jobWeight")).isFalse();
        // 详情只能看结果里的岗位
        assertThat(data(call(get("/api/v1/seeker/jobs/" + roomy), s1, null)).get("duties").asText()).isNotBlank();
        assertThat(code(call(get("/api/v1/seeker/jobs/J00000000000"), s1, null))).isEqualTo("APP_4004");

        // 前置条件逐项拦截
        assertThat(code(call(post("/api/v1/seeker/applications"), s1, Map.of("jobId", roomy)))).isEqualTo("APP_4012");
        String version = data(call(get("/api/v1/seeker/disclaimer"), s1, null)).get("version").asText();
        assertThat(data(call(post("/api/v1/seeker/disclaimer/agree"), s1, Map.of("version", version))).get("agreed").asBoolean()).isTrue();
        assertThat(code(call(post("/api/v1/seeker/applications"), s1, Map.of("jobId", roomy)))).isEqualTo("APP_4010");
        String id = idCard(25);
        assertThat(code(call(post("/api/v1/seeker/kyc"), s1, Map.of("realName", "张浩", "idCard", id,
                "idCardConfirm", id.substring(0, 17) + (id.charAt(17) == '1' ? '2' : '1'))))).isEqualTo("APP_4003");
        String minor = idCard(14);
        assertThat(code(call(post("/api/v1/seeker/kyc"), s1, Map.of("realName", "张浩", "idCard", minor,
                "idCardConfirm", minor)))).isEqualTo("APP_4006");
        JsonNode k = data(call(post("/api/v1/seeker/kyc"), s1, Map.of("realName", "张浩", "idCard", id, "idCardConfirm", id)));
        assertThat(k.get("kycStatus").asText()).isEqualTo("VERIFIED");
        assertThat(k.get("canApply").asBoolean()).isTrue();
        assertThat(code(call(post("/api/v1/seeker/kyc"), s1, Map.of("realName", "张浩", "idCard", id, "idCardConfirm", id)))).isEqualTo("APP_4013");

        int quotaBefore = quota(roomy);
        JsonNode applied = data(call(post("/api/v1/seeker/applications"), s1, Map.of("jobId", roomy)));
        String app1 = applied.get("applicationId").asText();
        assertThat(applied.get("responseDeadline").isNull()).isFalse();
        assertThat(quota(roomy)).isEqualTo(quotaBefore - 1);
        String u1 = userId(s1);
        Map<String, Object> row = jdbc.queryForMap("SELECT user_status, bound_company_id, current_application_id FROM `user` WHERE user_id = ?", u1);
        assertThat(row.get("user_status")).isEqualTo("PENDING_INTERVIEW");
        assertThat(row.get("bound_company_id")).isEqualTo(companyId);
        assertThat(row.get("current_application_id")).isEqualTo(app1);

        // ---------------------------------------------------------------- 2. 报名后不能再匹配 / 再报名
        assertThat(code(call(post("/api/v1/seeker/match"), s1, matchReq()))).isEqualTo("LC_4003");
        assertThat(code(call(post("/api/v1/seeker/applications"), s1, Map.of("jobId", lastSeat)))).isEqualTo("APP_4002");

        // ---------------------------------------------------------------- 3. 驻场知悉 → 推送面试信息 → 求职者收到通知
        dispatcher.dispatch();
        assertThat(unread(site, "/api/v1/tenant/messages/unread-count")).isGreaterThanOrEqualTo(1);
        JsonNode list = data(call(get("/api/v1/tenant/applications?status=PENDING_INTERVIEW&unacknowledged=true"), site, null));
        JsonNode mine = find(list.get("records"), "applicationId", app1);
        assertThat(mine.get("phone").asText()).hasSize(11);
        assertThat(mine.get("seekerName").asText()).isEqualTo("张*");
        assertThat(mine.get("allowedActions").toString()).contains("ACKNOWLEDGE");
        // 项目经理看不到手机号
        assertThat(find(data(call(get("/api/v1/tenant/applications"), pm, null)).get("records"), "applicationId", app1).has("phone")).isFalse();
        data(call(post("/api/v1/tenant/applications/" + app1 + "/acknowledge"), site, Map.of(
                "interviewAt", LocalDateTime.now().plusDays(1).withNano(0).toString(), "address", city + "工业园东门",
                "documents", new String[]{"身份证", "一寸照片"})));
        dispatcher.dispatch();
        JsonNode inbox = data(call(get("/api/v1/seeker/messages"), s1, null));
        assertThat(inbox.toString()).contains("面试信息").contains("一寸照片");
        JsonNode reports = data(call(get("/api/v1/seeker/applications"), s1, null));
        assertThat(reports.get(0).get("notice").get("address").asText()).contains("东门");

        // ---------------------------------------------------------------- 4. 24h 到期自动释放
        jdbc.update("UPDATE response_window SET deadline = ? WHERE user_id = ? AND status = 'OPEN'", LocalDateTime.now().minusMinutes(1), u1);
        int quotaBeforeRelease = quota(roomy);
        assertThat(scanner.scan()).isGreaterThanOrEqualTo(1);
        row = jdbc.queryForMap("SELECT user_status, bound_company_id, last_release_reason, current_application_id FROM `user` WHERE user_id = ?", u1);
        assertThat(row.get("user_status")).isEqualTo("PUBLIC_SEEKING");
        assertThat(row.get("bound_company_id")).isNull();
        assertThat(row.get("last_release_reason")).isEqualTo("TIMEOUT_24H");
        assertThat(row.get("current_application_id")).isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM application WHERE application_id = ?", String.class, app1)).isEqualTo("TIMEOUT");
        assertThat(quota(roomy)).isEqualTo(quotaBeforeRelease + 1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM response_window WHERE user_id = ? AND status = 'FIRED'", Long.class, u1)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM user_status_log WHERE user_id = ? AND event = 'TIMEOUT_24H' AND actor_role = 'SYSTEM'",
                Long.class, u1)).isEqualTo(1);
        assertThat(scanner.scan()).as("重复扫描幂等").isZero();
        dispatcher.dispatch();
        assertThat(data(call(get("/api/v1/seeker/messages"), s1, null)).toString()).contains("求职状态变更");
        assertThat(data(call(get("/api/v1/tenant/messages"), owner, null)).toString()).contains("已被释放至公域").contains("24h 超时");
        // 释放后可以重新匹配
        assertThat(code(call(post("/api/v1/seeker/match"), s1, matchReq()))).isEqualTo("0");

        // ---------------------------------------------------------------- 5. 私域用户只匹配本公司岗位
        String codeA = data(call(post("/api/v1/tenant/channel-codes"), owner, Map.of("name", "验收码"))).get("code").asText();
        String privateSeeker = seekerLogin(phone(), codeA);
        JsonNode pm1 = data(call(post("/api/v1/seeker/match"), privateSeeker, matchReq()));
        assertThat(pm1.get("scope").asText()).isEqualTo("OWN_COMPANY");
        assertThat(jobIds(pm1)).isNotEmpty().allMatch(j -> j.equals(lastSeat) || j.equals(roomy));

        // ---------------------------------------------------------------- 6. 50 人并发抢最后 1 个名额
        int n = 50;
        List<String> tokens = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            String t = seekerLogin(phone(), null);
            data(call(post("/api/v1/seeker/disclaimer/agree"), t, Map.of("version", version)));
            String idc = idCard(20 + RND.nextInt(20));
            data(call(post("/api/v1/seeker/kyc"), t, Map.of("realName", "并发用户", "idCard", idc, "idCardConfirm", idc)));
            assertThat(jobIds(data(call(post("/api/v1/seeker/match"), t, matchReq())))).contains(lastSeat);
            tokens.add(t);
        }
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(n);
        List<Future<String>> futures = new ArrayList<>();
        for (String t : tokens) {
            futures.add(pool.submit(() -> {
                go.await();
                return code(call(post("/api/v1/seeker/applications"), t, Map.of("jobId", lastSeat)));
            }));
        }
        go.countDown();
        List<String> codes = new ArrayList<>();
        for (Future<String> f : futures) {
            codes.add(f.get());
        }
        pool.shutdown();
        assertThat(codes.stream().filter("0"::equals).count()).as(codes.toString()).isEqualTo(1);
        assertThat(codes.stream().filter(c -> !c.equals("0"))).allMatch("APP_4001"::equals);
        assertThat(quota(lastSeat)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM application WHERE job_id = ?", Long.class, lastSeat)).isEqualTo(1);

        // ---------------------------------------------------------------- 7. 匹配结果可凭快照复现
        String sessionId = data(call(get("/api/v1/seeker/match/latest"), s1, null)).get("sessionId").asText();
        JsonNode snap = data(call(get("/api/v1/ops/match-sessions/" + sessionId), ops, null));
        MatchService.Snapshot snapshot = matchService.snapshot(sessionId);
        MatchProfile profile = matchService.profileOf(snapshot.session());
        var cfg = quizService.engine(snapshot.session().getEngineVersionId());
        var replay = MatchScorer.match(profile, com.shitu.framework.tenant.TenantContext.runAsSystem(() -> matchService.candidates(null)).list().stream()
                .filter(c -> c.jobId().equals(roomy)).toList(), cfg, true);
        var stored = snapshot.results().stream().filter(r -> r.getJobId().equals(roomy)).findFirst().orElseThrow();
        assertThat(replay.results().get(0).matchScore()).isEqualByComparingTo(stored.getMatchScore());
        assertThat(json.valueToTree(replay.results().get(0).factors()).equals(json.readTree(stored.getFactorScores()))).isTrue();
        assertThat(snap.get("session").get("engineVersionId").asInt()).isEqualTo(snapshot.session().getEngineVersionId());
    }

    // ==================================================================== helpers

    private String createJob(String pm, String ops, String projectId, String title, int quota) throws Exception {
        String jobId = data(call(post("/api/v1/tenant/jobs"), pm, Map.ofEntries(Map.entry("projectId", projectId),
                Map.entry("title", title), Map.entry("jobType", "ELECTRONICS"), Map.entry("salaryMin", 5500),
                Map.entry("salaryMax", 6800), Map.entry("shiftType", "LONG_DAY"), Map.entry("dormProvided", true),
                Map.entry("dormRoomSize", 4), Map.entry("dormAircon", true), Map.entry("mealProvided", true),
                Map.entry("duties", "贴片机上下料、目检"), Map.entry("interviewAddress", city + "工业园东门"),
                Map.entry("requiredDocuments", new String[]{"身份证"}), Map.entry("quotaTotal", quota)))).get("jobId").asText();
        data(call(post("/api/v1/ops/jobs/" + jobId + "/approve"), ops, Map.of()));
        return jobId;
    }

    /** 题库 v1：进厂 / 锁定本测试城市 / 电子 / 5500–6500 / 长白班 / 4 人间 / 1–3 年。 */
    private Map<String, Object> matchReq() {
        return Map.of("answers", List.of(
                Map.of("seq", 1, "code", "A"), Map.of("seq", 2, "code", "A", "region", city), Map.of("seq", 3, "code", "A"),
                Map.of("seq", 4, "code", "B"), Map.of("seq", 5, "code", "D"), Map.of("seq", 6, "code", "B"),
                Map.of("seq", 7, "code", "C")));
    }

    private List<String> jobIds(JsonNode outcome) {
        List<String> ids = new ArrayList<>();
        outcome.get("results").forEach(r -> ids.add(r.get("jobId").asText()));
        return ids;
    }

    private int quota(String jobId) {
        return jdbc.queryForObject("SELECT quota_remaining FROM job WHERE job_id = ?", Integer.class, jobId);
    }

    private String userId(String seekerToken) throws Exception {
        return data(call(get("/api/v1/seeker/me"), seekerToken, null)).get("userId").asText();
    }

    private long unread(String token, String path) throws Exception {
        return data(call(get(path), token, null)).asLong();
    }

    private static JsonNode find(JsonNode arr, String field, String value) {
        for (JsonNode n : arr) {
            if (n.get(field).asText().equals(value)) {
                return n;
            }
        }
        throw new AssertionError(field + "=" + value + " not found in " + arr);
    }

    private JsonNode tenantLogin(String phone) throws Exception {
        kv.delete("sms:iv:tenant:" + cipher.blindIndex(phone));
        String code = data(call(post("/api/v1/tenant/auth/sms-code"), null, Map.of("phone", phone))).get("devCode").asText();
        return call(post("/api/v1/tenant/auth/sms-login"), null, Map.of("phone", phone, "code", code));
    }

    private String seekerLogin(String phone, String channelCode) throws Exception {
        kv.delete("sms:iv:seeker:" + cipher.blindIndex(phone));
        String code = data(call(post("/api/v1/seeker/auth/sms-code"), null, Map.of("phone", phone))).get("devCode").asText();
        Map<String, Object> req = channelCode == null ? Map.of("phone", phone, "code", code)
                : Map.of("phone", phone, "code", code, "channelCode", channelCode);
        return data(call(post("/api/v1/seeker/auth/sms-login"), null, req)).get("accessToken").asText();
    }

    private JsonNode upload(String path, String token, String ticket) throws Exception {
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

    private JsonNode call(MockHttpServletRequestBuilder req, String token, Object payload) throws Exception {
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (payload != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(payload));
        }
        return body(mvc.perform(req).andReturn());
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
        return "137" + String.format("%08d", RND.nextInt(100_000_000));
    }

    private static String creditCode() {
        String alphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY";
        StringBuilder sb = new StringBuilder("91320583");
        for (int i = 0; i < 10; i++) {
            sb.append(alphabet.charAt(RND.nextInt(alphabet.length())));
        }
        return sb.toString();
    }

    /** 指定年龄、随机生日与顺序码的合法身份证号（GB 11643 校验码）。 */
    static String idCard(int age) {
        LocalDate birth = LocalDate.now().minusYears(age).minusDays(1 + RND.nextInt(300));
        String first17 = "320583" + birth.format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
                + String.format("%03d", RND.nextInt(1000));
        int[] w = {7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2};
        char[] c = {'1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'};
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            sum += (first17.charAt(i) - '0') * w[i];
        }
        return first17 + c[sum % 11];
    }
}
