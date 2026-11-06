package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** D-27：驻场标记的请假 / 旷工（M-15），扣减有效在岗日。 */
@Data
@TableName("duty_absence")
public class DutyAbsence {
    public static final String LEAVE = "LEAVE";
    public static final String ABSENT = "ABSENT";

    @TableId(type = IdType.AUTO)
    private Long id;
    private String companyId;
    private String employmentId;
    private LocalDate absenceDate;
    private String absenceType;
    private String markedBy;
    private String remark;
    private LocalDateTime createdAt;
}
