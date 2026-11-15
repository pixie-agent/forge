# Forge

[English](README.md) | [简体中文](README.zh-CN.md)

Forge 是由 [Pixie Agent](https://github.com/pixie-agent) 维护的 AI 应用生成与托管平台。用户用自然语言描述需求,Agent 在隔离工作区内规划、编写并构建多文件 React 应用,Cloudflare Worker 负责账号、任务、数据和发布。

> **许可说明:** Forge 平台源码按 [PolyForm Noncommercial 1.0.0](LICENSE) 开放,仅授权非商业用途。商业部署、企业内部使用、付费集成或托管服务需要取得 [书面商业授权](COMMERCIAL-LICENSE.md)。Forge 生成应用中附带的平台模板采用 Apache-2.0,详见 `agent/template/LICENSE`。

线上实例:[app.1forgen.site](https://app.1forgen.site)

## 功能

- 自然语言生成和对话式修改多文件 React 应用
- 规划、代码变更和构建进度实时推送,SSE 失败时自动回落轮询
- 版本历史、草稿预览、一键发布和源码导出
- D1 平台元数据、R2 构建产物、KV,以及每项目 × 每环境的 Durable Object SQLite
- 图片与文本附件、执行中追加要求、失败断点恢复
- 邮箱验证、Google 登录、积分和 Creem 计费
- GA4、Stripe 等生成期连接器
- 11 种语言的界面(中文、英文、日文、韩文、俄文、西班牙文、法文、德文、意大利文、葡萄牙文、荷兰文),以及独立管理后台

## 架构

```text
浏览器
  │
  ▼
Cloudflare Worker(Hono)
  ├─ Web SPA / API / SSE / 发布与预览
  ├─ D1:账号、项目、任务、版本和计费元数据
  ├─ R2:源码快照、构建产物、附件对象
  ├─ KV:生成应用键值数据
  └─ Durable Object SQLite:每项目 × 每环境的应用数据
  │
  │ POST /run + X-Agent-Secret
  ▼
Google Cloud Run Agent
  ├─ pi coding agent
  ├─ 一次性工作目录
  ├─ Vite + React 模板和确定性构建
  └─ 进度、断点、成功或失败回调
```

Worker 创建任务后通过 `waitUntil` 派发 Agent,不依赖到 Cloud Run 的长连接返回结果。Agent 通过受 `X-Agent-Secret` 保护的内部接口持续回调;最终 `commit` 或 `fail` 回调决定任务终态。

详细设计见 [docs/FORGE2.md](docs/FORGE2.md)。首次公开仓库前按 [公开发布检查表](docs/PUBLIC_RELEASE_CHECKLIST.md) 完成组织设置和最终审查。

## 目录

```text
src/                    Cloudflare Worker、API 和 Durable Object
web/                    React 管理与用户界面
agent/                  Cloud Run Agent
agent/template/         复制进生成应用的 React 模板
scripts/                部署守卫和运营脚本
docs/                   架构、连接器和自托管文档
schema*.sql             新库 schema 与增量迁移
wrangler.jsonc          Pixie Agent 维护环境配置
wrangler.example.jsonc  自托管配置模板
```

## 环境要求

- Node.js 22.19 或更高版本(低于 23)
- npm 10 或更高版本
- Cloudflare 账号和 Wrangler CLI,本地开发由项目依赖提供
- 一个兼容 OpenAI、Anthropic Messages 或 OpenAI Responses 方言的模型服务
- 完整部署 Agent 时需要 Google Cloud CLI 和 Cloud Run

仓库包含四份独立 lockfile。安装全部依赖:

```bash
nvm use
npm run bootstrap
```

## 本地开发

复制本地配置:

```bash
cp .dev.vars.example .dev.vars
cp agent/.env.example agent/.env
```

编辑两个文件,保证 Worker 和 Agent 使用相同的 `AGENT_SECRET`,并在 `agent/.env` 中配置模型地址、模型 ID 和 API key。`.dev.vars` 中的 `AGENT_URL` 与 `AGENT_URL_FREE` 都应指向 `http://localhost:8080`;顶层维护者配置已有生产免费执行体地址,只覆盖 `AGENT_URL` 会让本地免费任务误派到生产。真实配置文件已被 `.gitignore` 排除。

初始化本地 D1:

```bash
npm run db:init:local
```

分别启动三个进程:

```bash
# 终端 A:Agent,http://localhost:8080
npm run dev:agent

# 终端 B:Worker,http://localhost:8787
npm run dev

# 终端 C:Web,http://localhost:5173
npm run dev:web
```

访问 `http://localhost:5173`。发布页和预览页由 Worker 提供,应通过 `http://localhost:8787/s/<slug>/` 或 `/p/<token>/` 验证。

新建本地数据库时,如果没有配置 Resend 或 Google OAuth,邮箱注册会创建待验证账号但无法收到邮件。仅限本地开发,可以在注册后手动完成验证并补充试用积分:

```bash
npx wrangler d1 execute DB --local --command="UPDATE users SET email_verified = 1, credits = 20 WHERE email = 'you@example.com'"
```

替换邮箱后重新登录。不要对远程数据库使用这个开发命令。

## 校验

```bash
npm run check
```

该命令检查 Worker、Web 和 Agent 类型,并构建 Web、Agent 和生成应用模板。GitHub Actions 在 `main`、`staging` 和所有 pull request 上执行同一命令。

## 自托管

不要直接使用仓库中的 Pixie Agent 生产资源配置。请从模板开始创建自己的 Cloudflare 和 Google Cloud 资源:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

替换模板中的 D1、KV、R2、Agent URL、公开 URL 和邮件配置,然后设置所需 secrets。完整步骤和安全边界见 [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)。

## 安全边界

- Worker 与 Agent 双向请求使用共享的 `X-Agent-Secret`。
- 生成页面使用不带 `allow-same-origin` 的 CSP sandbox,无法读取 Forge 主站 cookie。
- 发布应用的数据 API 不读取 Forge 登录 cookie,适合公开站点数据,不应存放机密信息。
- 管理后台只有设置 `ADMIN_PASSWORD` 后才启用。
- `.dev.vars`、`.env`、云凭据、本地数据库和 `.wrangler/` 不得提交。

漏洞请按 [SECURITY.md](SECURITY.md) 私下报告,不要公开提交利用细节或凭据。

## 贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。变更记录见 [CHANGELOG.md](CHANGELOG.md)。外部代码贡献在合并前需要完成 Pixie Agent 的贡献者许可安排,以便项目同时提供非商业源码许可和单独的商业授权。

## 许可证

- Forge 平台:[PolyForm Noncommercial License 1.0.0](LICENSE)
- 商业使用:[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)
- 生成应用模板:[Apache License 2.0](agent/template/LICENSE)
- 第三方组件:[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

公开源代码不代表获得商业使用权,也不授予 Forge 或 Pixie Agent 商标权。
