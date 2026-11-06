package com.shitu.app.dict;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.enums.*;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 枚举字典：前端统一从这里取中文名，不在前端硬编码（02-架构 §13）。
 */
@Tag(name = "字典")
@RestController
@RequestMapping("/api/v1/dict")
public class DictController {

    public record DictItem(String value, String label) {
    }

    private static final List<Class<? extends LabeledEnum>> ENUMS = List.of(
            UserStatus.class, DomainTag.class, MatchScope.class, ReleaseReason.class, ActorRole.class,
            ChannelType.class, ApplicationStatus.class, JobStatus.class, CompanyStatus.class,
            ContractStatus.class, AdvanceStatus.class, FeeType.class, JobType.class, ShiftType.class,
            OpsRole.class, ClientContractStatus.class, ProjectStatus.class, MemberStatus.class, AuthDomain.class);

    private static final Map<String, List<DictItem>> DICT = build();

    private static Map<String, List<DictItem>> build() {
        Map<String, List<DictItem>> m = new LinkedHashMap<>();
        for (Class<? extends LabeledEnum> c : ENUMS) {
            m.put(c.getSimpleName(), Arrays.stream(c.getEnumConstants())
                    .map(e -> new DictItem(e.name(), e.label())).toList());
        }
        return Map.copyOf(m);
    }

    @Operation(summary = "全部枚举字典")
    @GetMapping
    public ApiResponse<Map<String, List<DictItem>>> all() {
        return ApiResponse.ok(DICT);
    }
}
