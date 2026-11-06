package com.shitu;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

/**
 * 模块边界（02-架构 §1 原则 1 / 6）。
 */
class ArchitectureTest {

    static final JavaClasses CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.shitu");

    @Test
    void 领域层不依赖Spring和框架层() {
        noClasses().that().resideInAPackage("..domain..")
                .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "com.shitu.framework..",
                        "com.baomidou..")
                .check(CLASSES);
    }

    @Test
    void common不依赖任何业务模块() {
        noClasses().that().resideInAPackage("com.shitu.common..")
                .should().dependOnClassesThat().resideInAnyPackage("com.shitu.lifecycle..", "com.shitu.billing..",
                        "com.shitu.advance..", "com.shitu.framework..", "com.shitu.app..")
                .check(CLASSES);
    }

    @Test
    void 计费与预支模块不能直接依赖生命周期模块_只能通过事件或接口() {
        noClasses().that().resideInAnyPackage("com.shitu.billing..", "com.shitu.advance..")
                .should().dependOnClassesThat().resideInAPackage("com.shitu.lifecycle..")
                .check(CLASSES);
    }
}
