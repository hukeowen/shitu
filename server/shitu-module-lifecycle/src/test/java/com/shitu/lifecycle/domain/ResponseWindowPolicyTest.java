package com.shitu.lifecycle.domain;

import com.shitu.common.Constants;
import org.junit.jupiter.api.Test;

import java.time.ZonedDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ResponseWindowPolicyTest {

    final ResponseWindowPolicy policy = ResponseWindowPolicy.DEFAULT;

    static ZonedDateTime at(int day, int hour) {
        return ZonedDateTime.of(2026, 7, day, hour, 0, 0, 0, Constants.ZONE);
    }

    @Test
    void 截止时刻为进入阶段后24小时() {
        assertThat(policy.deadline(at(23, 9))).isEqualTo(at(24, 9));
    }

    @Test
    void 白天进入_白天每6小时_进入夜间后每12小时() {
        // 09:00 进入 → 15:00(白) → 21:00(白) → 次日 03:00(夜) → 15:00 已过截止 09:00
        List<ZonedDateTime> times = policy.followUpTimes(at(23, 9));
        assertThat(times).containsExactly(at(23, 15), at(23, 21), at(24, 3));
    }

    @Test
    void 夜间进入_先按12小时() {
        // 23:00 进入 → 次日 11:00(白) → 17:00 → 23:00 = 截止，不含
        List<ZonedDateTime> times = policy.followUpTimes(at(23, 23));
        assertThat(times).containsExactly(at(24, 11), at(24, 17));
    }

    @Test
    void 白天边界_22点算夜间_8点算白天() {
        assertThat(policy.isDaytime(at(23, 22))).isFalse();
        assertThat(policy.isDaytime(at(23, 8))).isTrue();
        assertThat(policy.isDaytime(at(23, 7))).isFalse();
    }
}
