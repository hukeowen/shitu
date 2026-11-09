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

    private static final Map<String, Map<String, String>> STATIC = statics();

    private static Map<String, Map<String, String>> statics() {
        Map<String, Map<String, String>> s = new LinkedHashMap<>();
        s.put("BillStatus", ordered("GENERATED", "已生成", "ISSUED", "已下发", "DISPUTED", "异议中", "CONFIRMED", "已确认", "SETTLED", "已结算"));
        s.put("DisputeStatus", ordered("OPEN", "处理中", "ACCEPTED", "已采纳", "REJECTED", "已驳回"));
        s.put("LedgerDirection", ordered("PAYABLE", "流入应付", "RECEIVABLE", "流出应收"));
        s.put("BrokerCaseStatus", ordered("OPEN", "待联系", "CONTACTED", "已联系", "RECOMMENDED", "已推荐", "APPLIED", "已报名", "RELEASED", "已释放", "CLOSED", "已结束"));
        s.put("BrokerTriggerType", ordered("LOW_MATCH", "匹配度不足", "REMATCH_LIMIT", "多次匹配未报名", "SITE_TRANSFER", "驻场流转", "JOB_CHANGE", "在职换岗"));
        s.put("ResignStatus", ordered("PENDING", "待审核", "APPROVED", "已通过", "REJECTED", "已驳回"));
        s.put("StaffSource", ordered("OWN", "本公司", "PLATFORM", "平台", "TRANSFER", "流转"));
        s.put("AbsenceType", ordered("LEAVE", "请假", "ABSENT", "旷工"));
        s.put("EmploymentOrigin", ordered("PLATFORM_ONBOARD", "平台入职", "ROSTER_IMPORT", "花名册导入"));
        s.put("ComplaintCategory", ordered("FULL_STILL_HIRING", "招满了还在招", "INFO_FALSE", "岗位信息不实", "MISMATCH_AFTER_INTERVIEW", "面试后发现不符"));
        s.put("ComplaintStatus", ordered("PENDING", "待核实", "VERIFIED", "属实", "REJECTED", "不属实"));
        s.put("KycReviewType", ordered("ID_OCCUPIED_APPEAL", "身份证被占用申诉", "BLACKLIST_APPEAL", "失信申诉", "LOW_CONFIDENCE", "识别置信度低", "FRAUD_SUSPECT", "疑似冒用"));
        s.put("ReviewStatus", ordered("PENDING", "待处理", "APPROVED", "已通过", "REJECTED", "已驳回"));
        s.put("BlacklistReason", ordered("UNPAID_ADVANCE", "预支未还", "FRAUD", "冒名 / 欺诈", "MALICIOUS", "恶意行为"));
        s.put("VersionStatus", ordered("DRAFT", "草稿", "ACTIVE", "生效中", "ARCHIVED", "已归档"));
        s.put("NotifyChannel", ordered("INBOX", "站内信", "SMS", "短信"));
        s.put("QuizProfileField", ordered("accept_factory", "进厂意愿", "locked_region", "地域锁定", "expect_job_type", "期望工种",
                "expect_salary", "期望薪资", "shift_pref", "班次", "dorm_req", "住宿", "work_years", "经验"));
        s.put("QuizMatchRole", ordered("HARD_FILTER", "硬过滤", "SOFT_WEIGHT", "软打分"));
        s.put("QuizQuestionType", ordered("JUDGE", "判断题", "CHOICE", "选择题"));
        s.put("FactoryWillingness", ordered("YES", "接受", "MAYBE", "可以试试", "NO", "不接受"));
        s.put("LockedRegion", ordered("LOCKED", "锁定城市", "ANY", "不限"));
        s.put("DormRequirement", ordered("REQUIRED", "必须包住", "SMALL_ROOM", "4 人间以内", "AIRCON", "要有空调", "NONE", "不需要住宿"));
        return s;
    }

    private static Map<String, String> ordered(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(kv[i], kv[i + 1]);
        }
        return m;
    }

    private static final Map<String, List<DictItem>> DICT = build();

    private static Map<String, List<DictItem>> build() {
        Map<String, List<DictItem>> m = new LinkedHashMap<>();
        for (Class<? extends LabeledEnum> c : ENUMS) {
            m.put(c.getSimpleName(), Arrays.stream(c.getEnumConstants())
                    .map(e -> new DictItem(e.name(), e.label())).toList());
        }
        // 只存在于表字段 / 接口里的取值（未建 Java 枚举），同样由后端统一给中文名
        STATIC.forEach((type, items) -> m.put(type, items.entrySet().stream().map(e -> new DictItem(e.getKey(), e.getValue())).toList()));
        return Map.copyOf(m);
    }

    @Operation(summary = "全部枚举字典")
    @GetMapping
    public ApiResponse<Map<String, List<DictItem>>> all() {
        return ApiResponse.ok(DICT);
    }
}
