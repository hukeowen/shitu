package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.lifecycle.mapper.ApplicationMapper;
import com.shitu.lifecycle.mapper.FollowUpReminderMapper;
import com.shitu.lifecycle.mapper.ResponseWindowMapper;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * J-03 · 24h 窗口内的三方跟进提醒（D-14：白天 08–22 点每 6 小时、夜间每 12 小时，排期在开窗时已算好）。
 * 每分钟发送到期的提醒：写发件箱事件 FOLLOW_UP_DUE，由通知路由发给负责的驻场 / 项目经理。窗口关闭时排期已被取消。
 */
@Component
public class FollowUpReminderTask {

    private final FollowUpReminderMapper reminders;
    private final ResponseWindowMapper windows;
    private final ApplicationMapper applications;
    private final OutboxWriter outbox;
    private final TransactionTemplate tx;
    private final Clock clock;

    public FollowUpReminderTask(FollowUpReminderMapper reminders, ResponseWindowMapper windows,
                                ApplicationMapper applications, OutboxWriter outbox, TransactionTemplate tx, Clock clock) {
        this.reminders = reminders;
        this.windows = windows;
        this.applications = applications;
        this.outbox = outbox;
        this.tx = tx;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${shitu.jobs.follow-up-scan:PT1M}", initialDelayString = "PT40S")
    @SchedulerLock(name = "follow_up_reminder", lockAtMostFor = "PT5M")
    public void scheduled() {
        sendDue();
    }

    public int sendDue() {
        return TenantContext.runAsSystem(() -> {
            LocalDateTime now = LocalDateTime.now(clock);
            List<FollowUpReminder> due = reminders.selectList(new LambdaQueryWrapper<FollowUpReminder>()
                    .eq(FollowUpReminder::getStatus, "PLANNED").le(FollowUpReminder::getRemindAt, now)
                    .orderByAsc(FollowUpReminder::getRemindAt).last("LIMIT 200"));
            int sent = 0;
            for (FollowUpReminder r : due) {
                Boolean ok = tx.execute(s -> {
                    int claimed = reminders.update(null, new LambdaUpdateWrapper<FollowUpReminder>()
                            .eq(FollowUpReminder::getId, r.getId()).eq(FollowUpReminder::getStatus, "PLANNED")
                            .set(FollowUpReminder::getStatus, "SENT").set(FollowUpReminder::getSentAt, now));
                    ResponseWindow w = windows.selectById(r.getWindowId());
                    if (claimed == 0 || w == null || !ResponseWindow.OPEN.equals(w.getStatus())) {
                        return false;
                    }
                    Map<String, Object> payload = new HashMap<>();
                    payload.put("userId", w.getUserId());
                    payload.put("companyId", w.getCompanyId());
                    payload.put("stage", w.getStage());
                    payload.put("deadline", w.getDeadline().toString());
                    payload.put("round", r.getRoundNo());
                    if (w.getApplicationId() != null) {
                        Application a = applications.selectById(w.getApplicationId());
                        if (a != null) {
                            payload.put("projectId", a.getProjectId());
                        }
                    }
                    outbox.publish("FOLLOW_UP_DUE", "USER", w.getUserId(), payload);
                    return true;
                });
                if (Boolean.TRUE.equals(ok)) {
                    sent++;
                }
            }
            return sent;
        });
    }
}
