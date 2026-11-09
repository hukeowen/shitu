package com.shitu.app.seeker;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.seeker.KycReviewService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 实名申诉：身份证被占用（APP_4007）/ 平台级失信（APP_4008）时由本人发起，平台风控人工复核（P-14）。 */
@Tag(name = "C 端 · 实名申诉")
@RestController
@RequestMapping("/api/v1/seeker/kyc/appeals")
public class SeekerAppealController {

    private final KycReviewService reviews;

    public SeekerAppealController(KycReviewService reviews) {
        this.reviews = reviews;
    }

    public record AppealRequest(@NotBlank(message = "请选择申诉类型") String type,
                                @NotBlank(message = "请写明申诉理由") String remark) {
    }

    @Operation(summary = "提交申诉（type：ID_OCCUPIED_APPEAL / BLACKLIST_APPEAL）")
    @PostMapping
    public ApiResponse<Long> appeal(@Valid @RequestBody AppealRequest req) {
        return ApiResponse.ok(reviews.appeal(CurrentUser.subjectId(), req.type(), req.remark()));
    }

    @Operation(summary = "我的申诉记录")
    @GetMapping
    public ApiResponse<List<Map<String, Object>>> mine() {
        return ApiResponse.ok(reviews.mine(CurrentUser.subjectId()));
    }
}
