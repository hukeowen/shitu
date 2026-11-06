package com.shitu.matching.session;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 答题会话（快照：所用题库 / 引擎版本、答案、画像 → 结果可复现、可解释）。 */
@Data
@TableName("match_session")
public class MatchSession {
    @TableId(type = IdType.INPUT)
    private String sessionId;
    private String userId;
    private Integer quizVersionId;
    private Integer engineVersionId;
    /** ALL_PLATFORM / OWN_COMPANY */
    private String scope;
    private String scopeCompanyId;
    /** JSON 数组 [{seq, code, region}] */
    private String answers;
    /** JSON：MatchProfile */
    private String profile;
    private Integer profileVersion;
    /** MATCHED / NO_MATCH */
    private String status;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
