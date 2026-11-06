package com.shitu.lifecycle.domain;

/** 一次迁移对 bound_company_id 的影响。 */
public enum BoundEffect {
    /** 不变。 */
    KEEP,
    /** 写入目标公司（注册绑定 / 报名 / 花名册导入）。 */
    SET_TARGET,
    /** 清空 → 公域。 */
    CLEAR,
    /** 恢复到报名前的归属（D-31：报名前是私域则回私域，公域则回公域）。 */
    RESTORE_PRE_APPLY
}
