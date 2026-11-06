package com.shitu.matching.session;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.math.BigDecimal;

@Data
@TableName("match_result")
public class MatchResult {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String sessionId;
    private Integer rankNo;
    private String jobId;
    private BigDecimal matchScore;
    private BigDecimal jobWeight;
    private BigDecimal sortScore;
    /** JSON：各因子得分 */
    private String factorScores;
    private String reasonText;
    private Boolean displayed;
}
