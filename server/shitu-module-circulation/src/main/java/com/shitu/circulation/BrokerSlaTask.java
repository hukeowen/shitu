package com.shitu.circulation;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** D-10 经纪人 SLA：每分钟检查 2 小时联系时限与 24 小时出结果时限。 */
@Component
public class BrokerSlaTask {

    private static final Logger log = LoggerFactory.getLogger(BrokerSlaTask.class);

    private final BrokerService brokers;

    public BrokerSlaTask(BrokerService brokers) {
        this.brokers = brokers;
    }

    @Scheduled(fixedDelayString = "${shitu.jobs.broker-sla-scan:PT1M}", initialDelayString = "PT50S")
    @SchedulerLock(name = "broker_sla", lockAtMostFor = "PT5M")
    public void scheduled() {
        int[] r = brokers.enforceSla();
        if (r[0] + r[1] > 0) {
            log.info("经纪人 SLA：联系超时提醒 {} 单，超时释放 {} 人", r[0], r[1]);
        }
    }
}
