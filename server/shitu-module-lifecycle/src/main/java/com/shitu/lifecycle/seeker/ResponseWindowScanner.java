package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.mapper.ResponseWindowMapper;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;

/**
 * J-02 · 24h 响应窗口到期释放（D-06）：每分钟扫描一次到期的 OPEN 窗口，逐个以 SYSTEM 身份执行
 * TIMEOUT_24H（待匹配 / 待面试）或 CONFIRM_TIMEOUT（待确权）。
 * <ul>
 *   <li>窗口在超时前被正常推进时早已变成 CLOSED，扫描不会选中 —— 天然幂等；</li>
 *   <li>每个用户单独一个事务，一个失败不影响其他；</li>
 *   <li>窗口阶段与用户当前状态对不上（历史脏数据）时只关窗口，不做迁移。</li>
 * </ul>
 */
@Component
public class ResponseWindowScanner {

    private static final Logger log = LoggerFactory.getLogger(ResponseWindowScanner.class);
    private static final int BATCH = 200;

    private final ResponseWindowMapper windows;
    private final LifecycleService lifecycle;
    private final Clock clock;

    public ResponseWindowScanner(ResponseWindowMapper windows, LifecycleService lifecycle, Clock clock) {
        this.windows = windows;
        this.lifecycle = lifecycle;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${shitu.jobs.response-window-scan:PT1M}", initialDelayString = "PT30S")
    @SchedulerLock(name = "response_window_scan", lockAtMostFor = "PT5M")
    public void scheduled() {
        scan();
    }

    /** @return 本次释放的人数 */
    public int scan() {
        return TenantContext.runAsSystem(() -> {
            LocalDateTime now = LocalDateTime.now(clock);
            List<ResponseWindow> due = windows.selectList(new LambdaQueryWrapper<ResponseWindow>()
                    .eq(ResponseWindow::getStatus, ResponseWindow.OPEN)
                    .le(ResponseWindow::getDeadline, now)
                    .orderByAsc(ResponseWindow::getDeadline)
                    .last("LIMIT " + BATCH));
            int released = 0;
            for (ResponseWindow w : due) {
                try {
                    if (release(w)) {
                        released++;
                    }
                } catch (RuntimeException e) {
                    log.error("response window {} (user {}) timeout handling failed", w.getId(), w.getUserId(), e);
                }
            }
            if (released > 0) {
                log.info("24h 响应窗口到期释放 {} 人", released);
            }
            return released;
        });
    }

    private boolean release(ResponseWindow w) {
        UserStatus stage = UserStatus.valueOf(w.getStage());
        LifecycleEvent event = stage == UserStatus.PENDING_CONFIRM ? LifecycleEvent.CONFIRM_TIMEOUT : LifecycleEvent.TIMEOUT_24H;
        UserStatus current = lifecycle.find(w.getUserId()).map(SeekerUser::getUserStatus).orElse(null);
        if (current != stage) {
            closeStale(w);
            return false;
        }
        try {
            lifecycle.transition(w.getUserId(), event, TransitionContext.of(ActorRole.SYSTEM), null, "24h 响应窗口到期，系统自动释放");
            return true;
        } catch (BizException e) {
            // 状态在扫描间隙被推进（并发）：窗口已失效
            log.info("skip window {}: {}", w.getId(), e.getMessage());
            closeStale(w);
            return false;
        }
    }

    private void closeStale(ResponseWindow w) {
        windows.update(null, new LambdaUpdateWrapper<ResponseWindow>()
                .eq(ResponseWindow::getId, w.getId())
                .eq(ResponseWindow::getStatus, ResponseWindow.OPEN)
                .set(ResponseWindow::getStatus, ResponseWindow.CLOSED)
                .set(ResponseWindow::getClosedAt, LocalDateTime.now(clock)));
    }
}
