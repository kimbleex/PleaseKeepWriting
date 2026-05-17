# Please Keep Writing

Please Keep Writing 是一个面向私人团队和项目记录的本地优先日记应用。它以成员权限为核心，支持私有日记、访问申请、项目式归档、成就排行、公告管理，以及可以查询和总结日记的 Agent 助手。

## 项目特点

- 私人团队写作：为小团队、项目组或长期协作关系提供一个不公开的日记空间。
- 权限可控：成员之间默认不能互看日记，需要发起申请并获得授权；管理员可管理成员。
- 本地优先：日记先保存在浏览器 IndexedDB，支持离线/弱网写作，再手动或后台同步到云端数据库。
- Agent 助手：基于 OpenAI-compatible API 和 LangChain，可查询个人/授权成员日记、总结时间段记录、写入今日日记、查看成就和统计数据。
- 项目记忆：按日期、成员、归档和成就沉淀团队状态，让每日记录变成可回顾的项目上下文。
- 数据库公告：管理员可在后台发布、编辑、置顶公告，并清空已读状态让成员重新收到提醒。

## 功能概览

- 日历首页：按日期查看团队写作情况，显示成员总数、已写/未写统计。
- 写日记：当前用户可以写入或更新自己的日记，本地保存后再同步。
- 日记归档：查看历史日记，支持按同步状态筛选和批量同步。
- 成员系统：成员列表、授权状态、成员日记访问入口。
- 权限管理：成员可申请查看他人日记，收到申请时导航菜单会显示红点提醒。
- 成就系统：根据连续写日记、加入系统时长、连续缺席等维度生成徽章和成员排行。
- 管理后台：管理员可以创建/删除成员，管理公告。
- 公告系统：顶部公告弹窗展示数据库公告，支持单篇已读、全部已读、未读红点和管理员重提醒。
- Agent 助手：支持流式输出和工具调用，可查询/总结日记、更新今日日记、查看成就与统计。

## 技术栈

- Astro 6
- TypeScript
- Prisma 7
- PostgreSQL
- Vercel adapter
- LangChain / OpenAI-compatible API
- IndexedDB / Web Crypto

## 环境要求

- Node.js `>=22.12.0`
- PostgreSQL 数据库

复制环境变量模板：

```bash
cp .env.template .env
```

`.env` 需要配置：

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
JWT_SECRET="change-me"
AI_API_KEY=""
AI_BASE_URL=""
AI_MODEL_NAME=""
```

`DATABASE_URL` 和 `JWT_SECRET` 是基础功能所需配置。Agent 功能需要同时配置 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL_NAME`；不配置 AI 时，登录、日记、权限、公告、成就等普通功能仍可运行。

## 安装与启动

安装依赖：

```bash
npm install
```

同步数据库结构并初始化管理员：

```bash
npx prisma db push
npx prisma db seed
```

开发启动：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

本地预览生产构建：

```bash
npm run preview
```

运行 Astro 检查：

```bash
npm run astro -- check
```

## 默认管理员

执行 `npx prisma db seed` 后，如果系统中还没有管理员，会创建默认账号：

```text
username: admin
password: admin123
```

首次部署后建议尽快登录并修改默认密码。

## Prisma 数据库操作

Prisma schema 文件在：

```text
prisma/schema.prisma
```

常用命令：

```bash
npx prisma generate
npx prisma db push
npx prisma format
npx prisma db seed
npx prisma studio
```

修改数据库结构后的建议流程：

1. 修改 `prisma/schema.prisma`。
2. 执行 `npx prisma format`。
3. 执行 `npx prisma db push` 同步数据库。
4. 执行 `npx prisma generate` 重新生成 Prisma Client。
5. 重启 `npm run dev`，避免开发服务器继续缓存旧 Prisma Client。

注意：`db push` 会直接把 schema 推到当前 `DATABASE_URL` 指向的数据库。操作生产库前请确认 `.env` 指向正确。

## 公告管理

公告已改为数据库管理，不再通过本地配置文件维护。

管理员登录后进入“管理面板”，切换到“公告管理”即可：

- 新建公告：填写标题、分类、发布日期、摘要和 Markdown 正文。
- 编辑公告：从公告列表选择已有公告后修改保存。
- 置顶公告：勾选“置顶公告”，置顶内容会优先展示。
- 重提醒：清空该公告的已读状态，让所有成员重新看到未读提醒。

## 本地优先与隐私

项目会在浏览器 IndexedDB 中缓存日记、成员、权限、公告等数据，用于更快加载和弱网写作。日记内容会结合登录用户派生的本地隐私密钥进行本地加密；退出登录或清理本地数据后，需要重新登录以恢复本地访问。

本地日记同步到云端后，会写入 PostgreSQL；成员之间的跨用户查看仍受权限系统约束。

## 目录说明

```text
prisma/
  schema.prisma        数据库模型
  seed.ts              初始化管理员
  migrations/          数据库迁移记录

src/
  components/          通用组件，例如顶部 Header
  layouts/             页面布局
  lib/                 数据库、认证、本地优先、成就、AI 和 Agent 工具
  pages/               Astro 页面和 API 路由
  styles/              全局样式

public/
  images/achievements/ 成就徽章图片
  manifest.json        PWA 配置
  sw.js                Service Worker
```

## 部署提示

项目使用 `@astrojs/vercel`，构建命令为：

```bash
npm run build
```

部署环境需要配置和本地一致的环境变量，至少包括 `DATABASE_URL` 和 `JWT_SECRET`。如果上线前改过 `prisma/schema.prisma`，需要先对目标数据库执行 `npx prisma db push`，再部署新版本。
