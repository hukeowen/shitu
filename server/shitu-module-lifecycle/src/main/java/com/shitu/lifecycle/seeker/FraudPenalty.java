package com.shitu.lifecycle.seeker;

/**
 * 刷单确认后的企业扣分（D-17）。诚信分在风控模块，生命周期模块只声明端口，由应用层实现。
 */
public interface FraudPenalty {

    /** 对引流公司扣分；公司不存在时忽略。 */
    void penalize(String companyId, long reviewId, String remark, String operatorId);
}
