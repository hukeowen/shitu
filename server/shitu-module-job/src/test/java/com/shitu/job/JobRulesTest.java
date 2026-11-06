package com.shitu.job;

import com.shitu.common.enums.JobStatus;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import com.shitu.common.exception.BizException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JobRulesTest {

    static JobService.JobCommand valid() {
        return new JobService.JobCommand("P1", "SMT 操作工", JobType.ELECTRONICS, true,
                new BigDecimal("5500"), new BigDecimal("6800"), ShiftType.LONG_DAY, true, 6, true, false, true,
                0, 18, 45, "贴片机上下料", null, List.of("身份证"), null, "昆山东门", "工作日 09:00", 30);
    }

    static JobService.JobCommand with(java.util.function.UnaryOperator<Object[]> f) {
        JobService.JobCommand v = valid();
        Object[] a = {v.projectId(), v.title(), v.jobType(), v.factoryJob(), v.salaryMin(), v.salaryMax(), v.shiftType(),
                v.dormProvided(), v.dormRoomSize(), v.dormAircon(), v.dormPrivateBath(), v.mealProvided(), v.minWorkYears(),
                v.ageMin(), v.ageMax(), v.duties(), v.benefits(), v.requiredDocuments(), v.notes(), v.interviewAddress(),
                v.interviewTimeDesc(), v.quotaTotal()};
        a = f.apply(a);
        @SuppressWarnings("unchecked")
        List<String> docs = (List<String>) a[17];
        return new JobService.JobCommand((String) a[0], (String) a[1], (JobType) a[2], (Boolean) a[3], (BigDecimal) a[4],
                (BigDecimal) a[5], (ShiftType) a[6], (Boolean) a[7], (Integer) a[8], (Boolean) a[9], (Boolean) a[10],
                (Boolean) a[11], (Integer) a[12], (Integer) a[13], (Integer) a[14], (String) a[15], (String) a[16],
                docs, (String) a[18], (String) a[19], (String) a[20], (Integer) a[21]);
    }

    @Test
    void 合法岗位通过校验() {
        assertThatCode(() -> JobService.validate(valid())).doesNotThrowAnyException();
    }

    @Test
    void 薪资下限不能高于上限() {
        assertThatThrownBy(() -> JobService.validate(with(a -> {
            a[4] = new BigDecimal("7000");
            return a;
        }))).isInstanceOf(BizException.class).hasMessageContaining("薪资");
    }

    @Test
    void 年龄范围_名额范围() {
        assertThatThrownBy(() -> JobService.validate(with(a -> {
            a[13] = 15;
            return a;
        }))).hasMessageContaining("年龄");
        assertThatThrownBy(() -> JobService.validate(with(a -> {
            a[21] = 0;
            return a;
        }))).hasMessageContaining("名额");
    }

    @Test
    void 缺少面试地址或职责() {
        assertThatThrownBy(() -> JobService.validate(with(a -> {
            a[19] = " ";
            return a;
        }))).hasMessageContaining("面试地址");
        assertThatThrownBy(() -> JobService.validate(with(a -> {
            a[15] = null;
            return a;
        }))).hasMessageContaining("职责");
    }

    @ParameterizedTest
    @EnumSource(JobStatus.class)
    void 每个状态都有明确的可用操作(JobStatus s) {
        assertThat(JobService.tenantActions(s)).isNotNull();
        assertThat(JobService.opsActions(s)).isNotNull();
    }

    @Test
    void 只有招聘中可暂停_只有暂停可恢复_下架后只能编辑重新提交() {
        assertThat(JobService.tenantActions(JobStatus.RECRUITING)).contains("PAUSE").doesNotContain("RESUME");
        assertThat(JobService.tenantActions(JobStatus.PAUSED)).contains("RESUME").doesNotContain("PAUSE");
        assertThat(JobService.tenantActions(JobStatus.OFFLINE)).containsExactly("EDIT");
        assertThat(JobService.tenantActions(JobStatus.FORCE_OFFLINE)).containsExactly("EDIT");
        assertThat(JobService.opsActions(JobStatus.PENDING_AUDIT)).contains("APPROVE", "REJECT");
    }
}
