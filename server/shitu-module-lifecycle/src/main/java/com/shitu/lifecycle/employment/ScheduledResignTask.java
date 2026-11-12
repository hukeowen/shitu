package com.shitu.lifecycle.employment;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 待生效离职到期执行（D-59）：每小时第 5 分钟检查一次，离职日已到的申请结束任职并释放至公域。
 * 当天的日计费在次日凌晨跑，所以只要在离职日当天内执行，离职日就不会被计费。
 */
@Component
public class ScheduledResignTask {

    private final ResignService resign;

    public ScheduledResignTask(ResignService resign) {
        this.resign = resign;
    }

    @Scheduled(cron = "0 5 * * * *", zone = "Asia/Shanghai")
    @SchedulerLock(name = "scheduled_resign", lockAtMostFor = "PT10M")
    public void run() {
        resign.executeScheduled();
    }
}
