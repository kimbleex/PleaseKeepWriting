# Please Keep Writing

一个给团队/成员一起写日记的 Astro 应用。项目支持账号登录、成员权限、日记归档、本地优先同步、Agent 日记助手，以及顶部公告系统。

## 功能概览

- 日历首页：按日期查看团队写作情况，显示成员总数、已写/未写统计。
- 写日记：当前用户可以写入或更新自己的日记。
- 日记归档：查看历史日记，支持按同步状态筛选、批量同步。
- 本地优先：日记会先写入浏览器 IndexedDB，并通过“同步数据”上传到云端数据库。
- 成员系统：成员列表、查看授权、成员日记访问。
- 权限管理：成员之间可以申请查看权限，收到申请时菜单会显示红点。
- 管理后台：管理员可以创建成员、删除成员。
- 公告系统：顶部“公告”入口弹窗展示更新公告，支持单篇已读、全部已读和未读红点。
- Agent 助手：基于配置的 AI 模型查询/总结日记内容。

## 技术栈

- Astro 6
- TypeScript
- Prisma 7
- PostgreSQL
- Vercel adapter
- LangChain / OpenAI-compatible API

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

AI 功能需要 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL_NAME` 都存在；不使用 AI 时，普通日记功能仍可运行。

## 安装依赖

```bash
npm install
```

## 启动脚本

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

运行 Astro CLI：

```bash
npm run astro -- check
```

## Prisma 数据库操作

Prisma schema 文件在：

```text
prisma/schema.prisma
```

生成 Prisma Client：

```bash
npx prisma generate
```

把当前 schema 同步到 `DATABASE_URL` 指向的数据库：

```bash
npx prisma db push
```

格式化 schema：

```bash
npx prisma format
```

初始化管理员账号：

```bash
npx prisma db seed
```

默认 seed 会在没有管理员时创建：

```text
username: admin
password: admin123
```

打开 Prisma Studio：

```bash
npx prisma studio
```

### 修改数据库结构后的流程

1. 修改 `prisma/schema.prisma`。
2. 执行 `npx prisma format`。
3. 执行 `npx prisma db push` 同步数据库。
4. 执行 `npx prisma generate` 重新生成 Prisma Client。
5. 重启 `npm run dev`，避免 dev server 继续缓存旧 Prisma Client。

注意：`db push` 会直接把 schema 推到当前 `DATABASE_URL` 指向的数据库。操作生产库前请确认 `.env` 指向正确。

## 公告配置

公告内容维护在：

```text
src/lib/announcements.ts
```

新增公告时，在 `announcements` 数组最前面加一项：

```ts
{
  id: '2026-05-15-example',
  title: '公告标题',
  publishedAt: '2026-05-15',
  tag: '功能更新',
  summary: '公告摘要',
  pinned: true,
  body: `
# Markdown 标题

- 支持列表
- 支持 * 号列表
- 支持 **加粗**
- 支持 *斜体*
- 支持 > 引用
- 支持 \`行内代码\`
  `.trim(),
}
```

`pinned: true` 表示置顶。多个置顶公告会排在普通公告前面，并按 `publishedAt` 从新到旧排序。

`id` 一旦发布后不要改。用户是否已读是按 `userId + announcementId` 存在数据库里的；如果想让所有用户重新看到未读红点，请发布一个新的 `id`。

## 目录说明

```text
prisma/
  schema.prisma        数据库模型
  seed.ts              初始化管理员

src/
  components/          通用组件，例如顶部 Header
  layouts/             页面布局
  lib/                 数据库、认证、本地同步、AI、公告配置
  pages/               Astro 页面和 API 路由
  styles/              全局样式

public/
  manifest.json        PWA 配置
  sw.js                Service Worker
```

## 部署提示

项目使用 `@astrojs/vercel`，构建命令为：

```bash
npm run build
```

部署环境需要配置和本地一致的环境变量，尤其是 `DATABASE_URL`、`JWT_SECRET`。如果上线前改过 `prisma/schema.prisma`，需要先对目标数据库执行 `npx prisma db push`。
