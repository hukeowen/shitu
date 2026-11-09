package com.shitu.matching.quiz;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.matching.domain.EngineConfig;
import com.shitu.matching.mapper.EngineConfigRowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 匹配引擎参数（P-13）：版本化，草稿 → 发布（原生效版本归档）→ 可回滚到任意归档版本。
 * 匹配与岗位权重任务每次都读当前生效版本，发布后立即生效；匹配快照记录所用版本号，便于复盘。
 */
@Service
public class EngineAdminService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;
    private static final BigDecimal TWO = new BigDecimal("2");

    private final EngineConfigRowMapper engines;
    private final ObjectMapper json;
    private final AuditLogger audit;
    private final Clock clock;

    public EngineAdminService(EngineConfigRowMapper engines, ObjectMapper json, AuditLogger audit, Clock clock) {
        this.engines = engines;
        this.json = json;
        this.audit = audit;
        this.clock = clock;
    }

    public record EngineVersion(int versionId, String status, JsonNode config, String publishedBy, LocalDateTime publishedAt,
                                LocalDateTime createdAt) {
    }

    public List<EngineVersion> list() {
        return TenantContext.runAsSystem(() -> engines.selectList(new LambdaQueryWrapper<EngineConfigRow>()
                .orderByDesc(EngineConfigRow::getVersionId))).stream().map(this::view).toList();
    }

    public EngineVersion get(int versionId) {
        return view(row(versionId));
    }

    /** 新建草稿：不传 config 时复制当前生效版本。同一时间只允许一个草稿。 */
    @Transactional
    public EngineVersion createDraft(JsonNode config, String operatorId) {
        return TenantContext.runAsSystem(() -> {
            Long drafts = engines.selectCount(new LambdaQueryWrapper<EngineConfigRow>().eq(EngineConfigRow::getStatus, "DRAFT"));
            BizException.check(drafts == 0, ErrorCode.SYS_CONFLICT, "已有一个草稿，请先编辑或发布它");
            String body;
            if (config == null || config.isNull()) {
                EngineConfigRow active = engines.selectOne(new LambdaQueryWrapper<EngineConfigRow>().eq(EngineConfigRow::getStatus, "ACTIVE"));
                BizException.check(active != null, ErrorCode.SYS_NOT_FOUND, "没有生效版本可复制");
                body = active.getConfig();
            } else {
                body = validated(config);
            }
            EngineConfigRow max = engines.selectOne(new LambdaQueryWrapper<EngineConfigRow>()
                    .orderByDesc(EngineConfigRow::getVersionId).last("LIMIT 1"));
            EngineConfigRow r = new EngineConfigRow();
            r.setVersionId(max == null ? 1 : max.getVersionId() + 1);
            r.setStatus("DRAFT");
            r.setConfig(body);
            engines.insert(r);
            audit.log("ENGINE_DRAFT_CREATE", "ENGINE_CONFIG", String.valueOf(r.getVersionId()), Map.of());
            return get(r.getVersionId());
        });
    }

    @Transactional
    public EngineVersion updateDraft(int versionId, JsonNode config) {
        EngineConfigRow r = row(versionId);
        BizException.check("DRAFT".equals(r.getStatus()), ErrorCode.SYS_BAD_REQUEST, "只能修改草稿");
        String body = validated(config);
        TenantContext.runAsSystem(() -> engines.update(null, new LambdaUpdateWrapper<EngineConfigRow>()
                .eq(EngineConfigRow::getVersionId, versionId).set(EngineConfigRow::getConfig, body)));
        return get(versionId);
    }

    /** 发布草稿或回滚到归档版本。 */
    @Transactional
    public EngineVersion publish(int versionId, String operatorId) {
        EngineConfigRow r = row(versionId);
        BizException.check(!"ACTIVE".equals(r.getStatus()), ErrorCode.SYS_BAD_REQUEST, "该版本已是生效版本");
        validated(readTree(r.getConfig()));
        TenantContext.runAsSystem(() -> {
            engines.update(null, new LambdaUpdateWrapper<EngineConfigRow>()
                    .eq(EngineConfigRow::getStatus, "ACTIVE").set(EngineConfigRow::getStatus, "ARCHIVED"));
            engines.update(null, new LambdaUpdateWrapper<EngineConfigRow>()
                    .eq(EngineConfigRow::getVersionId, versionId)
                    .set(EngineConfigRow::getStatus, "ACTIVE")
                    .set(EngineConfigRow::getPublishedBy, operatorId)
                    .set(EngineConfigRow::getPublishedAt, LocalDateTime.now(clock)));
            return null;
        });
        audit.log("ENGINE_PUBLISH", "ENGINE_CONFIG", String.valueOf(versionId), Map.of("from", r.getStatus()));
        return get(versionId);
    }

    @Transactional
    public void deleteDraft(int versionId) {
        EngineConfigRow r = row(versionId);
        BizException.check("DRAFT".equals(r.getStatus()), ErrorCode.SYS_BAD_REQUEST, "只能删除草稿");
        TenantContext.runAsSystem(() -> engines.deleteById(versionId));
    }

    // ------------------------------------------------------------------ 校验

    /** 能反序列化为 {@link EngineConfig}，且各参数在合理范围内。返回规范化后的 JSON。 */
    String validated(JsonNode node) {
        BizException.check(node != null && node.isObject(), ErrorCode.SYS_BAD_REQUEST, "参数必须是 JSON 对象");
        EngineConfig c;
        try {
            c = json.treeToValue(node, EngineConfig.class);
        } catch (Exception e) {
            throw new BizException(ErrorCode.SYS_BAD_REQUEST, "参数结构不正确：" + rootMessage(e));
        }
        check(c.factorWeights().total() == 100, "六个因子权重之和必须等于 100（当前 " + c.factorWeights().total() + "）");
        EngineConfig.FactorWeights w = c.factorWeights();
        check(w.jobType() >= 0 && w.salary() >= 0 && w.distance() >= 0 && w.shift() >= 0 && w.dorm() >= 0 && w.experience() >= 0,
                "因子权重不能为负数");
        tiers("距离分档", c.distanceScore().stream().map(EngineConfig.DistanceTier::maxKm).toList());
        c.distanceScore().forEach(t -> check(t.score() >= 0 && t.score() <= 100, "距离得分须在 0–100"));
        tiers("挂岗衰减", c.decay().stream().map(EngineConfig.DecayTier::maxDays).toList());
        c.decay().forEach(t -> factor("衰减系数", t.factor(), BigDecimal.ONE));
        check(!c.credit().isEmpty(), "诚信分档至少一档");
        c.credit().forEach(t -> {
            check(t.minScore() >= 0 && t.minScore() <= 100, "诚信分档的分数须在 0–100");
            factor("诚信系数", t.factor(), TWO);
        });
        check(c.credit().stream().anyMatch(t -> t.minScore() == 0), "诚信分档必须包含 0 分档（兜底）");
        if (c.lowConversion() != null) {
            factor("低转化系数", c.lowConversion().factor(), BigDecimal.ONE);
            factor("低转化阈值", c.lowConversion().maxConversionRate(), BigDecimal.ONE);
        }
        if (c.penalty() != null) {
            factor("二级处罚系数", c.penalty().level2(), BigDecimal.ONE);
            factor("三级处罚系数", c.penalty().level3(), BigDecimal.ONE);
        }
        if (c.quota() != null) {
            factor("名额将满系数", c.quota().factor(), BigDecimal.ONE);
        }
        if (c.newJobBoost() != null) {
            factor("新岗加权", c.newJobBoost().factor(), TWO);
        }
        check("MIN".equals(c.combineDecayAndConversion()) || "MULTIPLY".equals(c.combineDecayAndConversion()),
                "衰减与低转化的合并方式只能是 MIN 或 MULTIPLY");
        check(c.displayThreshold() >= 0 && c.displayThreshold() <= 100, "展示阈值须在 0–100");
        check(c.resultCount() >= 1 && c.resultCount() <= 20, "结果条数须在 1–20");
        check(c.maxPerCompanyPublic() >= 1 && c.maxPerCompanyPublic() <= c.resultCount(), "同公司上限须在 1 到结果条数之间");
        try {
            return json.writeValueAsString(c);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 分档上限严格递增，最后一档为 null（以上）。 */
    private static void tiers(String name, List<Integer> maxes) {
        check(!maxes.isEmpty(), name + "至少一档");
        check(maxes.get(maxes.size() - 1) == null, name + "最后一档的上限必须留空（表示「以上」）");
        Integer prev = null;
        for (int i = 0; i < maxes.size() - 1; i++) {
            Integer m = maxes.get(i);
            check(m != null && m > 0, name + "只有最后一档可以不填上限");
            check(prev == null || m > prev, name + "的上限必须从小到大");
            prev = m;
        }
    }

    private static void factor(String name, BigDecimal v, BigDecimal max) {
        check(v != null && v.compareTo(ZERO) >= 0 && v.compareTo(max) <= 0, name + "须在 0–" + max.toPlainString());
    }

    private static void check(boolean ok, String msg) {
        BizException.check(ok, ErrorCode.SYS_BAD_REQUEST, msg);
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) {
            t = t.getCause();
        }
        String m = t.getMessage();
        return m == null ? t.getClass().getSimpleName() : m.length() > 120 ? m.substring(0, 120) : m;
    }

    private EngineConfigRow row(int versionId) {
        EngineConfigRow r = TenantContext.runAsSystem(() -> engines.selectById(versionId));
        BizException.check(r != null, ErrorCode.SYS_NOT_FOUND);
        return r;
    }

    private JsonNode readTree(String s) {
        try {
            return json.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private EngineVersion view(EngineConfigRow r) {
        return new EngineVersion(r.getVersionId(), r.getStatus(), readTree(r.getConfig()), r.getPublishedBy(), r.getPublishedAt(),
                r.getCreatedAt());
    }
}
