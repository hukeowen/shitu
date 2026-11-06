package com.shitu.matching.domain;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import com.shitu.matching.domain.MatchProfile.DormRequirement;
import com.shitu.matching.domain.MatchProfile.FactoryWillingness;
import com.shitu.matching.domain.MatchScorer.FilterReason;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class MatchScorerTest {

    static EngineConfig cfg;

    /** 直接解析种子数据里的 v1 引擎参数，保证代码与库里的配置结构一致。 */
    @BeforeAll
    static void loadSeedConfig() throws Exception {
        String sql = Files.readString(Path.of("../shitu-app/src/main/resources/db/migration/V1_0_7__seed.sql"), StandardCharsets.UTF_8);
        int start = sql.indexOf("(1, 'ACTIVE', '") + "(1, 'ACTIVE', '".length();
        int end = sql.indexOf("', 'SYSTEM'", start);
        cfg = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true)
                .readValue(sql.substring(start, end), EngineConfig.class);
    }

    static MatchProfile profile() {
        return new MatchProfile(FactoryWillingness.YES, null, JobType.ELECTRONICS, bd(5500), bd(6500), ShiftType.LONG_DAY,
                DormRequirement.REQUIRED, 1, null, null, null);
    }

    static JobCandidate job(String id, String company) {
        return new JobCandidate(id, company, "SMT 操作工", "苏州", null, null, JobType.ELECTRONICS, true, bd(5500), bd(6800),
                ShiftType.LONG_DAY, true, 6, true, true, 0, 18, 45, 10, true, false, BigDecimal.ONE);
    }

    static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }

    @Test
    void 种子配置解析正确() {
        assertThat(cfg.factorWeights().total()).isEqualTo(100);
        assertThat(cfg.displayThreshold()).isEqualTo(80);
        assertThat(cfg.resultCount()).isEqualTo(3);
        assertThat(cfg.maxPerCompanyPublic()).isEqualTo(2);
    }

    @Nested
    class 硬过滤 {
        @Test
        void 不接受进厂_过滤进厂岗位_保留厂外岗位() {
            MatchProfile p = new MatchProfile(FactoryWillingness.NO, null, null, null, null, null, null, 0, null, null, null);
            JobCandidate outside = new JobCandidate("J2", "C1", "仓储", "苏州", null, null, JobType.WAREHOUSE, false,
                    bd(5000), bd(6000), ShiftType.DAY, false, null, null, false, 0, 18, 45, 5, true, false, BigDecimal.ONE);
            MatchScorer.Outcome o = MatchScorer.match(p, List.of(job("J1", "C1"), outside), cfg, false);
            assertThat(o.results()).extracting(s -> s.job().jobId()).containsExactly("J2");
            assertThat(o.filtered()).containsEntry(FilterReason.FACTORY, 1);
        }

        @Test
        void 地域锁定_只留同城_忽略市字() {
            MatchProfile p = new MatchProfile(FactoryWillingness.YES, "苏州市", null, null, null, null, null, 0, null, null, null);
            JobCandidate kunshan = job("J2", "C1");
            JobCandidate other = new JobCandidate("J3", "C1", "x", "郑州", null, null, JobType.GENERAL, true, bd(5000), bd(6000),
                    ShiftType.DAY, false, null, null, false, 0, 18, 45, 5, true, false, BigDecimal.ONE);
            MatchScorer.Outcome o = MatchScorer.match(p, List.of(kunshan, other), cfg, false);
            assertThat(o.results()).extracting(s -> s.job().jobId()).containsExactly("J2");
            assertThat(o.filtered()).containsEntry(FilterReason.REGION, 1);
        }

        @Test
        void 名额已满_非招聘中_公司封禁_权重为零_年龄不符都被过滤() {
            JobCandidate base = job("J0", "C1");
            List<JobCandidate> jobs = List.of(
                    with(base, "J1", 0, true, false, BigDecimal.ONE, 18, 45),
                    with(base, "J2", 5, false, false, BigDecimal.ONE, 18, 45),
                    with(base, "J3", 5, true, true, BigDecimal.ONE, 18, 45),
                    with(base, "J4", 5, true, false, BigDecimal.ZERO, 18, 45),
                    with(base, "J5", 5, true, false, BigDecimal.ONE, 18, 30));
            MatchProfile p = new MatchProfile(FactoryWillingness.YES, null, JobType.ELECTRONICS, null, null, null, null, 0, 35, null, null);
            MatchScorer.Outcome o = MatchScorer.match(p, jobs, cfg, false);
            assertThat(o.results()).isEmpty();
            assertThat(o.filtered()).containsEntry(FilterReason.QUOTA_FULL, 1).containsEntry(FilterReason.NOT_RECRUITING, 1)
                    .containsEntry(FilterReason.COMPANY_BLOCKED, 1).containsEntry(FilterReason.ZERO_WEIGHT, 1)
                    .containsEntry(FilterReason.AGE, 1);
            assertThat(o.candidates()).isEqualTo(5);
        }
    }

    @Nested
    class 软打分 {
        @Test
        void 全部对口_匹配度满分_展示() {
            MatchScorer.Scored s = MatchScorer.score(profile(), job("J1", "C1"), cfg);
            // 距离因子无定位给中性 60 分：20 × 0.6 = 12，其余满分 80 → 92
            assertThat(s.matchScore()).isEqualByComparingTo("92.00");
            assertThat(s.displayed()).isTrue();
            assertThat(s.reason()).contains("工种对口").contains("包吃住").contains("长白班");
        }

        @Test
        void 有定位时按距离分档() {
            MatchProfile p = new MatchProfile(FactoryWillingness.YES, null, JobType.ELECTRONICS, bd(5500), bd(6500),
                    ShiftType.LONG_DAY, DormRequirement.REQUIRED, 1, null, new BigDecimal("120.9580"), new BigDecimal("31.3850"));
            JobCandidate near = new JobCandidate("J1", "C1", "x", "苏州", new BigDecimal("120.9800"), new BigDecimal("31.3900"),
                    JobType.ELECTRONICS, true, bd(5500), bd(6800), ShiftType.LONG_DAY, true, 6, true, true, 0, 18, 45, 10, true, false, BigDecimal.ONE);
            MatchScorer.Scored s = MatchScorer.score(p, near, cfg);
            assertThat(s.factors().distance()).isEqualTo(100);
            assertThat(s.matchScore()).isEqualByComparingTo("100.00");
            assertThat(s.reason()).contains("公里");
        }

        @Test
        void 薪资低于期望_按差距扣分_差25个百分点为零() {
            MatchProfile p = profile();
            assertThat(MatchScorer.salaryScore(p, salary(5500))).isEqualTo(100);
            assertThat(MatchScorer.salaryScore(p, salary(5225))).isEqualTo(80);
            assertThat(MatchScorer.salaryScore(p, salary(4125))).isZero();
        }

        @Test
        void 班次矩阵_住宿要求() {
            assertThat(MatchScorer.score(profile(), shift(ShiftType.DAY), cfg).factors().shift()).isEqualTo(80);
            assertThat(MatchScorer.score(profile(), shift(ShiftType.NIGHT), cfg).factors().shift()).isEqualTo(20);
            MatchProfile small = new MatchProfile(FactoryWillingness.YES, null, null, null, null, null, DormRequirement.SMALL_ROOM, 0, null, null, null);
            assertThat(MatchScorer.dormScore(small, job("J1", "C1"))).isEqualTo(60);
            MatchProfile none = new MatchProfile(FactoryWillingness.YES, null, null, null, null, null, DormRequirement.NONE, 0, null, null, null);
            assertThat(MatchScorer.dormScore(none, salary(5000))).isEqualTo(100);
        }

        @Test
        void 匹配度低于80不展示() {
            MatchProfile p = new MatchProfile(FactoryWillingness.YES, null, JobType.QC, bd(8000), bd(12000), ShiftType.DAY,
                    DormRequirement.AIRCON, 0, null, null, null);
            MatchScorer.Scored s = MatchScorer.score(p, job("J1", "C1"), cfg);
            assertThat(s.matchScore()).isLessThan(BigDecimal.valueOf(80));
            assertThat(s.displayed()).isFalse();
        }

        JobCandidate salary(long max) {
            JobCandidate j = job("J1", "C1");
            return new JobCandidate(j.jobId(), j.companyId(), j.title(), j.city(), null, null, j.jobType(), j.factoryJob(),
                    bd(max - 500), bd(max), j.shift(), j.dormProvided(), j.dormRoomSize(), j.dormAircon(), j.mealProvided(),
                    j.minWorkYears(), j.ageMin(), j.ageMax(), j.quotaRemaining(), true, false, BigDecimal.ONE);
        }

        JobCandidate shift(ShiftType s) {
            JobCandidate j = job("J1", "C1");
            return new JobCandidate(j.jobId(), j.companyId(), j.title(), j.city(), null, null, j.jobType(), j.factoryJob(),
                    j.salaryMin(), j.salaryMax(), s, j.dormProvided(), j.dormRoomSize(), j.dormAircon(), j.mealProvided(),
                    j.minWorkYears(), j.ageMin(), j.ageMax(), j.quotaRemaining(), true, false, BigDecimal.ONE);
        }
    }

    @Nested
    class 排序与输出 {
        @Test
        void 排序分等于匹配度乘权重_取前3() {
            List<JobCandidate> jobs = new ArrayList<>();
            for (int i = 1; i <= 5; i++) {
                jobs.add(with(job("J" + i, "C" + i), "J" + i, 10, true, false, new BigDecimal("0." + i), 18, 45));
            }
            MatchScorer.Outcome o = MatchScorer.match(profile(), jobs, cfg, false);
            assertThat(o.results()).extracting(s -> s.job().jobId()).containsExactly("J5", "J4", "J3");
            assertThat(o.results().get(0).sortScore()).isEqualByComparingTo("46.000");
        }

        @Test
        void 公域同一公司最多2个_私域不限() {
            List<JobCandidate> jobs = List.of(job("J1", "C1"), job("J2", "C1"), job("J3", "C1"), job("J4", "C2"));
            assertThat(MatchScorer.match(profile(), jobs, cfg, true).results())
                    .extracting(s -> s.job().jobId()).containsExactly("J1", "J2", "J4");
            assertThat(MatchScorer.match(profile(), jobs, cfg, false).results())
                    .extracting(s -> s.job().jobId()).containsExactly("J1", "J2", "J3");
        }

        @Test
        void 结果确定_同分按剩余名额再按编号() {
            List<JobCandidate> jobs = List.of(with(job("J9", "C1"), "J9", 3, true, false, BigDecimal.ONE, 18, 45),
                    with(job("J1", "C2"), "J1", 3, true, false, BigDecimal.ONE, 18, 45),
                    with(job("J5", "C3"), "J5", 8, true, false, BigDecimal.ONE, 18, 45));
            assertThat(MatchScorer.match(profile(), jobs, cfg, false).results())
                    .extracting(s -> s.job().jobId()).containsExactly("J5", "J1", "J9");
        }
    }

    static JobCandidate with(JobCandidate j, String id, int quota, boolean recruiting, boolean blocked, BigDecimal weight,
                             int ageMin, int ageMax) {
        return new JobCandidate(id, j.companyId(), j.title(), j.city(), j.lng(), j.lat(), j.jobType(), j.factoryJob(),
                j.salaryMin(), j.salaryMax(), j.shift(), j.dormProvided(), j.dormRoomSize(), j.dormAircon(), j.mealProvided(),
                j.minWorkYears(), ageMin, ageMax, quota, recruiting, blocked, weight);
    }
}
