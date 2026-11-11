package com.shitu.notify;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 免打扰时段结束后补发延迟的通知短信（P-16）。 */
@Component
public class DeferredSmsTask {

    private final NotificationService notifications;

    public DeferredSmsTask(NotificationService notifications) {
        this.notifications = notifications;
    }

    @Scheduled(fixedDelayString = "${shitu.jobs.deferred-sms:PT5M}", initialDelayString = "PT1M")
    @SchedulerLock(name = "deferred_sms", lockAtMostFor = "PT10M")
    public void run() {
        while (notifications.flushDeferredSms() == 200) {
            // 一批 200 条，积压时连续发完
        }
    }
}
