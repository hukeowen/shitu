# 仕兔平台

蓝领招聘 AI 匹配与人才流转平台。产品与工程文档见 [docs/](docs/README.md)，原型见 [prototype/](prototype/index.html)。

## 仓库结构

```
server/      Java 17 · Spring Boot 3.4 · Maven 多模块（模块化单体）
web/         pnpm workspace：seeker（C 端 H5）/ staff（驻场 H5）/ console（公司后台）/ ops（平台中台）
deploy/      本地依赖服务（docker-compose，可选）
docs/        功能清单、架构、开发计划、决策记录、原型核验报告
prototype/   产品原型（HTML）
```

## 本地开发

### 前置

| 工具 | 版本 | 说明 |
|---|---|---|
| JDK | 17 | 本机路径 `D:\tools\jdk17\jdk-17.0.19+10`；系统默认的 Java 8 不能用于构建 |
| Maven | 3.9+ | 使用 `-Paliyun` 走阿里云镜像 |
| Node.js / pnpm | 22+ / 10+ | |
| MySQL | 8.0 | 本机已有 MySQL80 服务；首次启动自动建库 `shitu` 并执行 Flyway 迁移 |
| Redis | 7 | Sprint 1 开始使用 |

### 后端

```bash
cd server
# Git Bash
export JAVA_HOME="/d/tools/jdk17/jdk-17.0.19+10"; export PATH="$JAVA_HOME/bin:$PATH"
mvn -Paliyun test                      # 单元测试（状态机、计费黄金用例、多租户隔离、架构规则）
DB_PASSWORD=你的密码 mvn -Paliyun -pl shitu-app -am spring-boot:run
```

- 健康检查：http://localhost:8080/actuator/health
- 接口文档：http://localhost:8080/swagger-ui.html
- 枚举字典：http://localhost:8080/api/v1/dict

数据库连接用环境变量 `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` 覆盖。`application.yml` 里的加密密钥只用于本地开发，**生产必须通过 `SHITU_ENC_KEY` / `SHITU_MAC_KEY` 注入**。

### 前端

```bash
cd web
pnpm install
pnpm dev:seeker    # http://localhost:5173  C 端 H5
pnpm dev:staff     # http://localhost:5174  驻场端 H5
pnpm dev:console   # http://localhost:5175  公司后台
pnpm dev:ops       # http://localhost:5176  平台中台
pnpm build         # 类型检查 + 构建全部应用
```

开发服务器把 `/api` 代理到 `http://localhost:8080`。

## 开发约定（摘要，详见 docs/02-系统架构.md）

- `user.user_status` / `bound_company_id` 只能通过 `LifecycleService.transition()` 修改；状态迁移规则在 `LifecycleEvent`，改规则先改测试。
- 新增数据表必须在 `TenantTables` 登记为 租户表 / 共享表 / 平台专属表，否则 `SchemaTenantCoverageTest` 失败。
- 计费口径改动必须先在 `BillingGoldenCasesTest` 增加用例。
- 业务代码取当前时间一律注入 `java.time.Clock`。
- 新的产品口径问题在 `docs/04-决策记录.md` 追加，不直接改原结论。
