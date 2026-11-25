package com.shitu.it;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * D-62 先答题后登录 + 问卷改版：游客读题库、匿名预览（打码、不落库、按 IP 限流），登录后用同一份 v2 答案正式匹配，
 * 渠道归属照常在注册时绑定。
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
class QuizV2PreviewIT extends FlowItSupport {

    /** 每次运行不同的来源 IP，限流计数不会串到上一次运行。 */
    static String ip() {
        return "10." + RND.nextInt(250) + "." + RND.nextInt(250) + "." + (1 + RND.nextInt(250));
    }

    JsonNode preview(String ip, Object payload) throws Exception {
        return call(post("/api/v1/seeker/public/match/preview").header("X-Forwarded-For", ip), null, payload);
    }

    Map<String, Object> previewReq(String channelCode) {
        Map<String, Object> m = new HashMap<>(matchReq());
        if (channelCode != null) {
            m.put("channelCode", channelCode);
        }
        return m;
    }

    @Test
    void 游客读到的是v2题库_不问工资() throws Exception {
        JsonNode quiz = data(call(get("/api/v1/seeker/public/quiz"), null, null));
        assertThat(quiz.get("name").asText()).contains("不问期望工资");
        JsonNode qs = quiz.get("questions");
        assertThat(qs).hasSize(7);
        List<String> fields = new ArrayList<>();
        qs.forEach(q -> fields.add(q.get("profileField").asText()));
        assertThat(fields).containsExactly("accept_factory", "locked_region", "expect_job_type", "age", "shift_matrix",
                "dorm_req", "work_years");
        JsonNode age = qs.get(3);
        assertThat(age.get("questionType").asText()).isEqualTo("NUMBER");
        assertThat(age.get("stem").asText()).isEqualTo("你今年多大？");
        assertThat(age.get("config").get("min").asInt()).isEqualTo(16);
        assertThat(age.get("config").get("max").asInt()).isEqualTo(65);
        JsonNode shift = qs.get(4);
        assertThat(shift.get("questionType").asText()).isEqualTo("MATRIX");
        assertThat(shift.get("options")).hasSize(4);
        assertThat(shift.get("config").get("followUp").asText()).isEqualTo("什么情况下可以？");
        assertThat(qs.get(5).get("options")).hasSize(2);
        assertThat(quiz.toString()).doesNotContain("元").doesNotContain("空调");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM quiz_version WHERE version_id = 1 AND status = 'ARCHIVED'", Integer.class))
                .as("v1 归档保留").isEqualTo(1);
    }

    @Test
    void 匿名预览_打码_不落库_渠道码决定范围_按IP限流() throws Exception {
        Company c = company();
        job(c, c.projectId(), "预览岗位一", 5);
        job(c, c.projectId2(), "预览岗位二", 5);
        String code = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "预览海报"))).get("code").asText();
        String companyName = jdbc.queryForObject("SELECT name FROM company WHERE company_id = ?", String.class, c.companyId());
        long sessions = jdbc.queryForObject("SELECT COUNT(*) FROM match_session", Long.class);
        long visits = jdbc.queryForObject("SELECT COUNT(*) FROM channel_visit WHERE code = ?", Long.class, code);

        String ip = ip();
        JsonNode p = data(preview(ip, previewReq(code)));
        assertThat(p.get("privateScope").asBoolean()).as("公司渠道码 → 只看该公司岗位").isTrue();
        assertThat(p.get("matched").asBoolean()).isTrue();
        assertThat(p.get("salaryByRank").asBoolean()).isTrue();
        JsonNode results = p.get("results");
        assertThat(results.size()).isBetween(1, 3);
        for (JsonNode r : results) {
            assertThat(r.has("jobId")).isFalse();
            assertThat(r.has("companyName")).isFalse();
            assertThat(r.has("address")).isFalse();
            assertThat(r.get("title").asText()).startsWith("预览岗位");
            assertThat(r.get("companyHint").asText()).isEqualTo(city.substring(0, city.length() - 1) + "一家劳务公司");
            assertThat(r.get("salaryMax").asInt()).isEqualTo(6800);
            assertThat(r.get("dormProvided").asBoolean()).isTrue();
            assertThat(r.get("reason").asText()).isNotBlank();
        }
        assertThat(p.toString()).doesNotContain(companyName).doesNotContain("工业园").doesNotContain(c.companyId());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM match_session", Long.class)).as("预览不落会话").isEqualTo(sessions);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM channel_visit WHERE code = ?", Long.class, code))
                .as("预览不计渠道访问").isEqualTo(visits);

        // 没有渠道码 / 无效码 → 全平台
        assertThat(data(preview(ip, previewReq(null))).get("privateScope").asBoolean()).isFalse();
        assertThat(data(preview(ip, previewReq("NOPE0000"))).get("privateScope").asBoolean()).isFalse();

        // 答案校验同正式匹配
        Map<String, Object> bad = new HashMap<>(matchReq());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answers = new ArrayList<>((List<Map<String, Object>>) bad.get("answers"));
        answers.set(3, Map.of("seq", 4, "number", 12));
        bad.put("answers", answers);
        JsonNode err = preview(ip, bad);
        assertThat(code(err)).isEqualTo("SYS_4000");
        assertThat(err.get("message").asText()).contains("16–65");

        // 每个 IP 每小时 120 次（上面已用 4 次）
        for (int i = 0; i < 116; i++) {
            assertThat(code(preview(ip, previewReq(null)))).isEqualTo("0");
        }
        JsonNode limited = preview(ip, previewReq(null));
        assertThat(code(limited)).isEqualTo("SYS_4290");
        assertThat(limited.get("message").asText()).contains("一小时");
        assertThat(code(preview(ip(), previewReq(null)))).as("别的 IP 不受影响").isEqualTo("0");
    }

    @Test
    void 登录后用同一份v2答案正式匹配_渠道归属照常绑定() throws Exception {
        Company c = company();
        String j1 = job(c, c.projectId(), "正式匹配岗位", 5);
        String code = data(call(post("/api/v1/tenant/channel-codes"), c.owner(), Map.of("name", "先答题海报"))).get("code").asText();
        assertThat(code(preview(ip(), previewReq(code)))).isEqualTo("0");

        // 游客答完题后登录（渠道码随登录提交），再用同一份答案匹配
        String s = seekerLogin(phone(), code);
        String uid = userId(s);
        assertThat(user(uid).get("bound_company_id")).as("渠道归属在注册时绑定").isEqualTo(c.companyId());
        JsonNode m = data(call(post("/api/v1/seeker/match"), s, matchReq()));
        assertThat(m.get("matched").asBoolean()).isTrue();
        assertThat(m.get("salaryByRank").asBoolean()).isTrue();
        assertThat(m.get("scope").asText()).isEqualTo("OWN_COMPANY");
        assertThat(jobIds(m)).contains(j1);
        String answers = jdbc.queryForObject("SELECT answers FROM match_session WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
                String.class, uid);
        assertThat(answers).contains("\"matrix\"").contains("\"number\"");
        assertThat(data(call(get("/api/v1/seeker/match/latest"), s, null)).get("salaryByRank").asBoolean()).isTrue();

        // 自报年龄超出岗位年龄要求 → 被年龄过滤（岗位默认年龄上限内的 30 岁可以，64 岁不行）
        Map<String, Object> old = new HashMap<>(matchReq());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answers2 = new ArrayList<>((List<Map<String, Object>>) old.get("answers"));
        answers2.set(3, Map.of("seq", 4, "number", 64));
        old.put("answers", answers2);
        JsonNode m2 = data(call(post("/api/v1/seeker/match"), s, old));
        assertThat(jobIds(m2)).doesNotContain(j1);
    }
}
