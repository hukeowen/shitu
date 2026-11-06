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
mvn -Paliyun test                                   # 单元测试（状态机、计费黄金用例、多租户隔离、架构规则）
SHITU_IT=true DB_PASSWORD=你的密码 mvn -Paliyun test  # 另跑端到端验收（独立库 shitu_it，首次自动建库迁移）
DB_PASSWORD=你的密码 mvn -Paliyun -pl shitu-app -am spring-boot:run
```

- 健康检查：http://localhost:8080/actuator/health
- 接口文档：http://localhost:8080/swagger-ui.html
- 枚举字典：http://localhost:8080/api/v1/dict

本地开发（默认 `local` profile）的约定：

| 项 | 说明 |
|---|---|
| 短信 | Mock 通道，不真发；发送接口返回 `devCode`，前端会提示验证码 |
| 平台中台账号 | 空库首次启动自动创建 `admin`，本地初始密码 `Shitu@2026`，首次登录须修改 |
| 验证码 / 限流存储 | 进程内存（`shitu.kv.type=memory`）；多实例部署必须设 `SHITU_KV_TYPE=redis` |
| 上传文件 | `server/shitu-app/data/uploads`（已在 .gitignore） |

数据库连接用环境变量 `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` 覆盖。

**生产必须注入的密钥**（`application.yml` 里的默认值只用于本地开发）：`SHITU_ENC_KEY` / `SHITU_MAC_KEY`（字段加密与盲索引）、`SHITU_JWT_SECRET`（登录令牌），并设置 `SHITU_COOKIE_SECURE=true`、`SHITU_OPS_INIT_PASSWORD`、`SHITU_H5_PUBLIC_BASE=https://m.shitu.com`。

### CI

`.github/workflows/ci.yml`：每次推送到 `main` 和每个 PR 都会跑后端全部测试（含连 MySQL 8 的端到端验收）和前端 4 个应用的类型检查与构建。

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
