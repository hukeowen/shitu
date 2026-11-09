package com.shitu.lifecycle.seeker;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.common.util.Rows;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.outbox.OutboxWriter;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 实名与合规风控（P-14）：申诉 → 人工复核队列 → 处理；平台黑名单维护。
 * <ul>
 *   <li>ID_OCCUPIED_APPEAL：身份证已被其他账号绑定（换号 / 被冒用）。通过 = 解除原账号实名，申诉人可重新实名。
 *       原账号正在报名 / 待确权 / 在岗时不能解除（先处理业务关系，避免合同与在职记录失去实名主体）。</li>
 *   <li>BLACKLIST_APPEAL：平台级失信申诉。通过 = 解除该用户（及其身份证）的全部黑名单记录。</li>
 * </ul>
 * 所有表都是平台表；JDBC 直接访问，调用方处于 SEEKER / OPS 上下文。
 */
@Service
public class KycReviewService {

    public static final Set<String> TYPES = Set.of("ID_OCCUPIED_APPEAL", "BLACKLIST_APPEAL");
    /** 与字典 BlacklistReason 一致。 */
    public static final Set<String> REASONS = Set.of("UNPAID_ADVANCE", "FRAUD", "MALICIOUS");
    /** 解除实名时原账号不能处于这些状态。 */
    private static final Set<String> BUSY = Set.of("PENDING_INTERVIEW", "PENDING_CONFIRM", "EMPLOYED");

    private final JdbcTemplate jdbc;
    private final FieldCipher cipher;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public KycReviewService(JdbcTemplate jdbc, FieldCipher cipher, OutboxWriter outbox, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    // ================================================================= C 端申诉

    @Transactional
    public long appeal(String userId, String type, String remark) {
        BizException.check(TYPES.contains(type), ErrorCode.SYS_BAD_REQUEST, "申诉类型不正确");
        BizException.check(remark != null && !remark.isBlank() && remark.trim().length() <= 500, ErrorCode.SYS_BAD_REQUEST,
                "请写明申诉理由（500 字以内）");
        String expect = "ID_OCCUPIED_APPEAL".equals(type) ? "ID_OCCUPIED" : "BLACKLISTED";
        List<Long> rec = jdbc.queryForList("SELECT id FROM kyc_record WHERE user_id = ? AND result = ? ORDER BY id DESC LIMIT 1",
                Long.class, userId, expect);
        boolean blacklisted = "BLACKLIST_APPEAL".equals(type) && count("SELECT COUNT(*) FROM `user` WHERE user_id = ? AND blacklist_flag = 1", userId) > 0;
        BizException.check(!rec.isEmpty() || blacklisted, ErrorCode.SYS_BAD_REQUEST,
                "ID_OCCUPIED_APPEAL".equals(type) ? "没有「身份证已被占用」的实名记录，无需申诉" : "账号没有失信记录，无需申诉");
        BizException.check(count("SELECT COUNT(*) FROM kyc_review WHERE user_id = ? AND review_type = ? AND status = 'PENDING'",
                userId, type) == 0, ErrorCode.SYS_CONFLICT, "已有一条申诉在处理中，请耐心等待");
        long recordId = rec.isEmpty() ? 0 : rec.get(0);
        jdbc.update("INSERT INTO kyc_review (user_id, kyc_record_id, review_type, remark) VALUES (?, ?, ?, ?)",
                userId, recordId, type, remark.trim());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    public List<Map<String, Object>> mine(String userId) {
        return Rows.camel(jdbc.queryForList("SELECT id, review_type, status, remark, reviewer_remark, created_at, reviewed_at "
                + "FROM kyc_review WHERE user_id = ? ORDER BY id DESC LIMIT 20", userId));
    }

    // ================================================================= 平台复核队列

    public List<Map<String, Object>> queue(String status, String type) {
        StringBuilder sql = new StringBuilder("SELECT r.id, r.user_id, r.review_type, r.status, r.remark, r.reviewer_id, r.reviewer_remark, "
                + "r.created_at, r.reviewed_at, k.id_card_hash, k.created_at AS kyc_at, u.phone_enc, u.user_status, u.registered_at "
                + "FROM kyc_review r JOIN `user` u ON u.user_id = r.user_id LEFT JOIN kyc_record k ON k.id = r.kyc_record_id WHERE 1 = 1");
        List<Object> args = new ArrayList<>();
        if (status != null && !status.isBlank()) {
            sql.append(" AND r.status = ?");
            args.add(status);
        }
        if (type != null && !type.isBlank()) {
            sql.append(" AND r.review_type = ?");
            args.add(type);
        }
        sql.append(" ORDER BY r.status = 'PENDING' DESC, r.created_at LIMIT 200");
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(sql.toString(), args.toArray())) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (String k : List.of("id", "user_id", "review_type", "status", "remark", "reviewer_id", "reviewer_remark", "created_at",
                    "reviewed_at", "user_status", "registered_at", "kyc_at")) {
                m.put(k, r.get(k));
            }
            m.put("phone_masked", Masks.phone(cipher.decrypt((String) r.get("phone_enc"))));
            String hash = (String) r.get("id_card_hash");
            if ("ID_OCCUPIED_APPEAL".equals(r.get("review_type")) && hash != null) {
                m.put("occupant", occupant(hash));
            }
            if ("BLACKLIST_APPEAL".equals(r.get("review_type"))) {
                m.put("blacklist", Rows.camel(jdbc.queryForList("SELECT id, reason_code, detail, created_at FROM blacklist "
                        + "WHERE status = 'ACTIVE' AND (user_id = ? OR (id_card_hash IS NOT NULL AND id_card_hash = ?))", r.get("user_id"), hash)));
            }
            out.add(m);
        }
        return Rows.camel(out);
    }

    private Map<String, Object> occupant(String hash) {
        List<Map<String, Object>> us = jdbc.queryForList("SELECT user_id, phone_enc, user_status, registered_at, bound_company_id "
                + "FROM `user` WHERE id_card_hash = ?", hash);
        if (us.isEmpty()) {
            return null;
        }
        Map<String, Object> u = us.get(0);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("userId", u.get("user_id"));
        m.put("phoneMasked", Masks.phone(cipher.decrypt((String) u.get("phone_enc"))));
        m.put("userStatus", u.get("user_status"));
        m.put("registeredAt", u.get("registered_at"));
        m.put("boundCompanyId", u.get("bound_company_id"));
        m.put("releasable", !BUSY.contains((String) u.get("user_status")));
        return m;
    }

    @Transactional
    public void decide(long id, boolean approve, String remark, String operatorId) {
        Map<String, Object> r;
        try {
            r = jdbc.queryForMap("SELECT r.user_id, r.review_type, r.status, k.id_card_hash FROM kyc_review r "
                    + "LEFT JOIN kyc_record k ON k.id = r.kyc_record_id WHERE r.id = ? FOR UPDATE", id);
        } catch (EmptyResultDataAccessException e) {
            throw new BizException(ErrorCode.SYS_NOT_FOUND);
        }
        BizException.check("PENDING".equals(r.get("status")), ErrorCode.SYS_CONFLICT, "该申诉已处理");
        BizException.check(remark != null && !remark.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写处理意见");
        String userId = (String) r.get("user_id");
        String type = (String) r.get("review_type");
        String hash = (String) r.get("id_card_hash");
        if (approve && "ID_OCCUPIED_APPEAL".equals(type)) {
            BizException.check(hash != null, ErrorCode.SYS_BAD_REQUEST, "缺少实名记录，无法处理");
            Map<String, Object> occ = occupant(hash);
            if (occ != null && !userId.equals(occ.get("userId"))) {
                BizException.check(Boolean.TRUE.equals(occ.get("releasable")), ErrorCode.SYS_CONFLICT,
                        "原账号正在报名 / 待确权 / 在岗，需先结束其业务关系后才能解除实名");
                String old = (String) occ.get("userId");
                jdbc.update("UPDATE `user` SET real_name_enc = NULL, id_card_enc = NULL, id_card_hash = NULL, birth_date = NULL, gender = NULL, "
                        + "kyc_status = 'NONE' WHERE user_id = ?", old);
                audit.log("KYC_UNBIND", "USER", old, Map.of("reviewId", id, "appellant", userId));
                outbox.publish("KYC_APPEAL_RESULT", "USER", old, Map.of("userId", old,
                        "result", "你的账号实名已被平台解除（该身份证由本人在另一手机号申诉找回），如有疑问请联系客服"));
            }
        }
        if (approve && "BLACKLIST_APPEAL".equals(type)) {
            jdbc.update("UPDATE blacklist SET status = 'LIFTED', lifted_at = ? WHERE status = 'ACTIVE' "
                    + "AND (user_id = ? OR (id_card_hash IS NOT NULL AND id_card_hash = ?))", LocalDateTime.now(clock), userId, hash);
            jdbc.update("UPDATE `user` SET blacklist_flag = 0 WHERE user_id = ?", userId);
        }
        jdbc.update("UPDATE kyc_review SET status = ?, reviewer_id = ?, reviewer_remark = ?, reviewed_at = ? WHERE id = ?",
                approve ? "APPROVED" : "REJECTED", operatorId, remark.trim(), LocalDateTime.now(clock), id);
        audit.log("KYC_REVIEW_DECIDE", "KYC_REVIEW", String.valueOf(id), Map.of("approve", approve, "type", type));
        String result = !approve ? "申诉未通过：" + remark.trim()
                : "ID_OCCUPIED_APPEAL".equals(type) ? "申诉已通过，请重新提交实名认证" : "申诉已通过，失信记录已解除";
        outbox.publish("KYC_APPEAL_RESULT", "USER", userId, Map.of("userId", userId, "result", result));
    }

    // ================================================================= 黑名单

    public List<Map<String, Object>> blacklist(String status) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT b.id, b.user_id, b.reason_code, b.detail, b.status, b.created_by, b.created_at, "
                + "b.lifted_at, u.phone_enc FROM blacklist b LEFT JOIN `user` u ON u.user_id = b.user_id "
                + (status == null || status.isBlank() ? "" : "WHERE b.status = ? ") + "ORDER BY b.id DESC LIMIT 500",
                status == null || status.isBlank() ? new Object[0] : new Object[]{status});
        rows.forEach(r -> {
            Object enc = r.remove("phone_enc");
            r.put("phone_masked", enc == null ? null : Masks.phone(cipher.decrypt((String) enc)));
        });
        return Rows.camel(rows);
    }

    @Transactional
    public long addBlacklist(String userId, String reasonCode, String detail, String operatorId) {
        BizException.check(REASONS.contains(reasonCode), ErrorCode.SYS_BAD_REQUEST, "请选择拉黑原因");
        BizException.check(detail != null && !detail.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写事实说明");
        List<String> hash = jdbc.queryForList("SELECT id_card_hash FROM `user` WHERE user_id = ?", String.class, userId);
        BizException.check(!hash.isEmpty(), ErrorCode.SYS_NOT_FOUND, "用户不存在");
        try {
            jdbc.update("INSERT INTO blacklist (user_id, id_card_hash, reason_code, detail, created_by) VALUES (?, ?, ?, ?, ?)",
                    userId, hash.get(0), reasonCode, detail.trim(), operatorId);
        } catch (DuplicateKeyException e) {
            throw new BizException(ErrorCode.SYS_CONFLICT);
        }
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        jdbc.update("UPDATE `user` SET blacklist_flag = 1 WHERE user_id = ?", userId);
        audit.log("BLACKLIST_ADD", "USER", userId, Map.of("reason", reasonCode));
        return id == null ? 0 : id;
    }

    @Transactional
    public void lift(long id, String remark, String operatorId) {
        BizException.check(remark != null && !remark.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写解除原因");
        List<String> uid = jdbc.queryForList("SELECT user_id FROM blacklist WHERE id = ? AND status = 'ACTIVE'", String.class, id);
        BizException.check(!uid.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        jdbc.update("UPDATE blacklist SET status = 'LIFTED', lifted_at = ? WHERE id = ?", LocalDateTime.now(clock), id);
        if (count("SELECT COUNT(*) FROM blacklist WHERE user_id = ? AND status = 'ACTIVE'", uid.get(0)) == 0) {
            jdbc.update("UPDATE `user` SET blacklist_flag = 0 WHERE user_id = ?", uid.get(0));
        }
        audit.log("BLACKLIST_LIFT", "BLACKLIST", String.valueOf(id), Map.of("remark", remark.trim(), "operator", operatorId));
    }

    private long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }
}
