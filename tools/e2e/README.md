# 本地联调冒烟（真实后端 + 开发库）

对 `http://localhost:8080` 的开发后端发真实请求，补充 `server` 里的端到端测试（那些跑在独立的 `shitu_it` 库上）。
用演示公司 C10002（老板 13800000001 / 项目经理 13800000002 / 驻场 13800000003，渠道码 `qYAtWMU9`）。

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
