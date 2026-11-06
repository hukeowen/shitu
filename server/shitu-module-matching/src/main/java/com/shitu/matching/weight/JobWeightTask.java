package com.shitu.matching.weight;

import com.shitu.common.Constants;
import com.shitu.matching.domain.EngineConfig;
import com.shitu.matching.domain.JobWeightCalculator;
import com.shitu.matching.quiz.QuizService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * 岗位权重重算（{@link JobWeightCalculator}）：每小时一次，写 job.match_weight（仅平台可见 R-14）。每日留痕表 job_weight_daily 随 Sprint 5 风控一起写入。
 * 每小时而不是每天跑，是为了让新上架岗位的冷启动加成、名额快满降权及时生效。
 */
@Component
public class JobWeightTask {

    private static final Logger log = LoggerFactory.getLogger(JobWeightTask.class);

    private record Row(String jobId, LocalDateTime postedAt, LocalDateTime decayResetAt, int quotaRemaining,
                       int creditScore, int penaltyLevel, long applied, long hired) {
    }

    private final JdbcTemplate jdbc;
    private final QuizService quiz;
    private final Clock clock;

    public JobWeightTask(JdbcTemplate jdbc, QuizService quiz, Clock clock) {
        this.jdbc = jdbc;
        this.quiz = quiz;
        this.clock = clock;
    }

    @Scheduled(cron = "${shitu.jobs.job-weight-cron:0 5 * * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "job_weight", lockAtMostFor = "PT10M")
    public void scheduled() {
        recompute();
    }

    public int recompute() {
        EngineConfig cfg = quiz.activeEngine().config();
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        List<Row> rows = jdbc.query("""
                        SELECT j.job_id, j.posted_at, j.decay_reset_at, j.quota_remaining, c.credit_score, c.penalty_level,
                               (SELECT COUNT(*) FROM application a WHERE a.job_id = j.job_id AND a.created_at >= j.posted_at) AS applied,
                               (SELECT COUNT(*) FROM application a WHERE a.job_id = j.job_id AND a.created_at >= j.posted_at
                                  AND a.status = 'EMPLOYED') AS hired
                        FROM job j JOIN company c ON c.company_id = j.company_id
                        WHERE j.job_status = 'RECRUITING'""",
                (rs, i) -> new Row(rs.getString(1), toLdt(rs.getTimestamp(2)), toLdt(rs.getTimestamp(3)), rs.getInt(4),
                        rs.getInt(5), rs.getInt(6), rs.getLong(7), rs.getLong(8)));
        for (Row r : rows) {
            LocalDateTime from = r.postedAt();
            if (cfg.resetDecayOnHire() && r.decayResetAt() != null && (from == null || r.decayResetAt().isAfter(from))) {
                from = r.decayResetAt();
            }
            long days = from == null ? 0 : Math.max(0, ChronoUnit.DAYS.between(from.toLocalDate(), today));
            BigDecimal conv = r.applied() == 0 ? null
                    : BigDecimal.valueOf(r.hired()).divide(BigDecimal.valueOf(r.applied()), 4, RoundingMode.HALF_UP);
            BigDecimal w = JobWeightCalculator.weight(new JobWeightCalculator.Input(days, conv, r.creditScore(),
                    r.penaltyLevel(), r.quotaRemaining()), cfg);
            jdbc.update("UPDATE job SET match_weight = ? WHERE job_id = ?", w, r.jobId());
        }
        if (!rows.isEmpty()) {
            log.info("岗位权重重算完成：{} 个招聘中岗位", rows.size());
        }
        return rows.size();
    }

    private static LocalDateTime toLdt(Timestamp t) {
        return t == null ? null : t.toLocalDateTime();
    }
}
