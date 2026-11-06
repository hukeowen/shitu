package com.shitu.lifecycle.seeker;

import com.shitu.framework.param.SysParams;
import com.shitu.framework.web.ClientInfo;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 求职告知书与免责声明（C-403）：首次报名强制阅读同意；同意记录 user_id + 时间 + IP + 版本号永久存档。
 * 告知书版本变化（sys_param disclaimer.version）后用户需要重新同意。
 */
@Service
public class DisclaimerService {

    public record Disclaimer(String version, String title, List<String> paragraphs, boolean agreed) {
    }

    /** V1.0 正文（法务定稿后替换；变更正文必须同时升级 disclaimer.version）。 */
    private static final List<String> TEXT = List.of(
            "仕兔平台为求职者提供岗位匹配与报名服务，岗位信息由入驻的劳务派遣 / 人力资源服务机构发布，平台对机构资质和甲方合作合同做了备案审核。",
            "平台不向求职者收取任何费用。任何人以报名费、押金、体检费、服装费等名义向你收费，请拒绝并通过「问题反馈」或岗位投诉告诉我们。",
            "报名时需要完成实名认证。你的姓名、身份证号、手机号加密保存，只用于身份核验、劳动合同签订和工资发放，不会向无关方提供。",
            "报名成功后，劳务公司驻场人员会联系你并推送面试时间、地点和所需证件。面试结果出来前不能重新匹配或报名其他岗位；如需更换岗位，请联系驻场人员取消报名。",
            "未满 18 周岁不能报名岗位。请确保提交的信息真实，冒用他人身份或恶意刷单将被列入平台失信名单。",
            "入职以电子劳动合同签署完成为准，薪资、工时、社保等以劳动合同和用工单位规定为准。");

    private final JdbcTemplate jdbc;
    private final SysParams params;
    private final Clock clock;

    public DisclaimerService(JdbcTemplate jdbc, SysParams params, Clock clock) {
        this.jdbc = jdbc;
        this.params = params;
        this.clock = clock;
    }

    public String currentVersion() {
        return params.getString("disclaimer.version", "1.0");
    }

    public Disclaimer current(String userId) {
        return new Disclaimer(currentVersion(), "求职告知书与免责声明", TEXT, hasAgreed(userId));
    }

    public boolean hasAgreed(String userId) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM disclaimer_consent WHERE user_id = ? AND doc_version = ?",
                Long.class, userId, currentVersion());
        return n != null && n > 0;
    }

    /** 同意（幂等：同一版本只记一次）。 */
    public void agree(String userId, String version) {
        com.shitu.common.exception.BizException.check(currentVersion().equals(version),
                com.shitu.common.exception.ErrorCode.APP_DISCLAIMER_REQUIRED, "告知书已更新，请重新阅读后同意");
        if (hasAgreed(userId)) {
            return;
        }
        String ip = ClientInfo.ip();
        jdbc.update("INSERT INTO disclaimer_consent (user_id, doc_version, ip, user_agent, agreed_at) VALUES (?, ?, ?, ?, ?)",
                userId, version, ip == null ? "-" : ip, ClientInfo.userAgent(), LocalDateTime.now(clock));
    }
}
