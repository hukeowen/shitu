package com.shitu.framework.web;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.shitu.common.api.PageResult;

import java.util.List;
import java.util.function.Function;

/** MyBatis-Plus 分页 ↔ 统一分页结构。page 从 1 开始，pageSize 上限 100。 */
public final class Pages {

    private Pages() {
    }

    public static <T> Page<T> of(Integer page, Integer pageSize) {
        long p = page == null || page < 1 ? 1 : page;
        long s = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
        return Page.of(p, s);
    }

    public static <T, R> PageResult<R> map(Page<T> page, Function<T, R> mapper) {
        List<R> records = page.getRecords().stream().map(mapper).toList();
        return new PageResult<>(records, page.getTotal(), page.getCurrent(), page.getSize());
    }
}
