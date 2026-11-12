# 本地联调冒烟（真实后端 + 开发库）

对 `http://localhost:8080` 的开发后端发真实请求，补充 `server` 里的端到端测试（那些跑在独立的 `shitu_it` 库上）。
用演示公司（空库首次启动时由后端创建，老板 13800000001 / 项目经理 13800000002 / 驻场 13800000003）。公司编号和公司码每个库不一样，脚本自己查，不用配；要指定公司码时设环境变量 `CHANNEL_CODE`。

| 脚本 | 内容 |
|---|---|
| `flow.mjs` | 业务主链路：扫码注册 → 私域 → 问薪 → 报名 → 驻场知悉 / 到厂 / 面试通过 → 确权 → 电子签 → 在岗 → 岗位问答回流 → 看板报表 → 投诉 → 预支准入 → 离职回公域 → 身份证占用申诉 → 归属治理 |
| `sweep.mjs` | 接口巡检：前端用到的每个 GET 接口按角色调用，5xx 或响应里出现下划线字段名即失败 |

## 准备

1. 启动后端（local profile，Mock 短信会回显验证码）。
2. 平台账号需要一次图形验证码：
   ```bash
   curl -s http://localhost:8080/api/v1/ops/auth/captcha   # 把 imageBase64 存成图片看验证码
   curl -s -c ops.cookies -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"<密码>","captchaId":"<id>","captchaCode":"<看到的字符>"}' \
     http://localhost:8080/api/v1/ops/auth/login
   ```
   `ops.cookies` 里的 refresh token 有效 30 天，脚本每次自动轮换。公司成员的会话缓存在 `tenant-<手机号>.rt`。

## 运行

```bash
node flow.mjs    # 每次新建一个求职者，会在开发库留下测试数据
node sweep.mjs
```

同一手机号 60 秒内只能发一次短信验证码；脚本优先复用缓存的会话，避免触发冷却。

## 浏览器冒烟与截图

需要 Chrome 以 `--remote-debugging-port=9888` 启动，四个前端的 dev server 绑定 IPv4（`npx vite --host 127.0.0.1 --port <端口>`）：
console 5175、ops 5176、seeker 5183、staff 5184。

```bash
node ui-smoke.mjs                     # 逐个打开四个应用的菜单路由（老板 / 项目经理 / 驻场 / 平台 / 新求职者），收集异常、报错、接口 ≥ 400
TZ_OVERRIDE=Pacific/Honolulu node ui-smoke.mjs   # 在非东八区时区下再跑一遍
node shot.mjs login-ops http://127.0.0.1:5176/login        # 单页截图（加第三个参数 1 = 手机尺寸）
```

截图输出到 `shots/`（不入库）。

## 改版前后截图对照

界面改版用：先把四个端每个页面截一遍存成基线，改完再截一遍，生成左右对照页。

| 脚本 | 内容 |
|---|---|
| `seed.mjs` | 造截图用的数据：各阶段的求职者、花名册老员工、工资条、预支、离职、工伤、知识库、投诉、反馈、流转池、待审岗位、入驻申请等。人物和单据编号写进 `shots/baseline-data.json`（跟着本机库走，不入库） |
| `routes.mjs` | 截图清单：四个端每个路由页面用谁登录、打开哪个地址。新增页面要在这里登记，漏了 `shots.mjs` 会提示 |
| `shots.mjs` | 批量截图，可以只截某个端或某组路由 |
| `compare.mjs` | 生成对照页：左边基线，右边当前截图，按路由排列 |
| `states.mjs` | 状态截图：加载中、失败、弹层、被拒提示和 360 宽。每个状态在脚本里登记一项（人物、地址、要拦截的接口、打开后点什么、截图前的检查）；有横向溢出、求职者端出现内部术语、检查没过时退出码为 1。会落库的接口（发起匹配、报名、投诉）一律拦住 |

### 运行前提

0. **Node 22 或更高**（脚本用了 `Object.groupBy`、`zlib.crc32`，不装任何依赖）。
1. **后端**跑在 8080，local profile，连本机专用库（不是共享的开发库，`seed.mjs` 会写很多数据）。
2. **四个 dev server**，在 `web/apps/<端>` 下分别执行 `npx vite --host 127.0.0.1 --port <端口>`：console 5175、ops 5176、seeker 5183、staff 5184。
3. **Chrome 调试端口 9888**。不想占用日常的 Chrome 可以单开一个无界面的：
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9888 \
     --user-data-dir=/tmp/shitu-chrome --hide-scrollbars about:blank
   ```
4. **演示账号**：
   - 公司成员（老板 / 项目经理 / 驻场）用短信登录，验证码在开发环境直接回显，脚本自动完成。
   - 平台账号要先按上面「准备」一节存好 `ops.cookies`。新库的 `admin` 首次登录必须先改密码（`PUT /api/v1/ops/me/password`），改完要重新登录一次。
   - 求职者由 `seed.mjs` 注册，会话缓存在 `seeker-<手机号>.rt`。

### 命令

```bash
node seed.mjs                               # 每个库只跑一次；已有 shots/baseline-data.json 时拒绝重跑
node shots.mjs baseline                     # 改样式之前：四个端全部页面 → shots/baseline/
node shots.mjs current --app seeker         # 改完之后：只截求职者端 → shots/current/
node shots.mjs current --route /pm,/owner/bills   # 只截某组路由（按前缀匹配，'/' 只匹配首页）
node compare.mjs --app seeker               # → shots/compare-seeker.html，用浏览器打开
node compare.mjs --route /pm                # → shots/compare-pm.html
node states.mjs <任务目录>/screenshots --app seeker   # 状态截图，文件名 <端>_<页面>_<状态>_<宽>x<高>.png；--only login 只截名字里带 login 的
```

- 视口：后台 1440×900，手机 390×844（2 倍图）。每页存一张首屏；页面比一屏长时另存 `.full.png` 整页图（整页图里固定在底部的按钮栏会停在第一屏的位置，属正常）。
- `shots.mjs` 逐页报告：有没有落到别的页面、是否空白、有没有脚本异常和 ≥ 400 的接口，明细在 `shots/<目录>/report.json`，对照页里也会标出来。
- `shots.mjs` 开头还会对着路由表查页面里写死的站内跳转地址（`router.push('/x')`、`to="/x"`），有找不到的就列出来，退出码为 1。
- `compare.mjs` 默认拿 `baseline` 对 `current`，可用 `--base`、`--cur` 换目录，`--out` 指定文件名。
- 一个路由在不同状态下长得不一样时，在 `routes.mjs` 里登记多个人物（求职者首页就截了游客、自由求职、专属服务、待面试、在岗几种）。
- 报名成功页、入驻申请页、游客首页不能直接输地址进，`routes.mjs` 里给它们配了进入脚本。

### 注意

- 后端限制同一 IP 每小时 30 条短信验证码。`seed.mjs` 要新登录约 29 个手机号，跑它前后一小时内别跑 `flow.mjs`、`ui-smoke.mjs`（各自还要注册新求职者）。
- 基线和后续截图要在同一份数据上才好对照。造完数据后别再往库里加人；列表里的「剩余时间」等会随时间变化，属正常差异。
- `ui-smoke.mjs` 每跑一次会注册一个新求职者（演示公司多一个私域待匹配的人），驻场工作台、提醒这几页的数字会跟着变。
- 造完数据后存一份库快照，数据被弄乱时可以恢复（恢复会覆盖整个本机库，先停后端；恢复后各 `*.rt` 会话失效，脚本会自动重新登录，`ops.cookies` 要重新存）：
  ```bash
  docker exec -e MYSQL_PWD=<root 密码> shitu-mysql mysqldump -uroot --single-transaction shitu | gzip > shots/baseline/db-after-seed.sql.gz
  gunzip -c shots/baseline/db-after-seed.sql.gz | docker exec -i -e MYSQL_PWD=<root 密码> shitu-mysql mysql -uroot shitu
  ```
- 演示公司刚入驻、还在免费期，造不出月账单和跨公司流转：费用账单、对账管理、流转账本这几页只能截到空状态。
