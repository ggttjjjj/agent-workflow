# 织序 WEAVE

## 启动

需要 Node.js 22.13+（推荐24），首次启动需安装依赖和配置环境变量：

```sh
npm install
# 在 .env 填写 DEEPSEEK_API_KEY
cp .env.example .env
```

启动开发服务器：

```sh
npm run dev
```

生产构建与启动：

```sh
npm run build
npm start
```

数据存储于 `data/weave.sqlite`（SQLite WAL）。浏览器编辑草稿保存在浏览器的 localStorage。

## 运行测试

```sh
npm test
```

## 项目结构

```
src/client/           前端（React）
  ├─ main.tsx         浏览器入口
  ├─ App.tsx / api.ts / style.css
  └─ components/      InputPanel、Editor、Graph、Inspector、SettingsPanel
src/server/           后端（Node/Express）
  ├─ index.ts         API、SSE、图片校验、页面服务
  ├─ engine.ts        两阶段规划、取消、重试、候选保护
  ├─ model.ts         DeepSeek 请求与流解析
  ├─ store.ts         SQLite 持久化
  └─ config.ts        环境变量与项目根解析
src/shared/domain.ts  前后端共用模型
tests/                测试
```
## 需求与验收记录

- [MVP 实施说明、缺口修复与剩余验收](docs/implemented/agent-workflow-mvp.md)（已合并原产品基线与缺口修复记录）
- [Workflow 规划阶段节点实施说明](docs/implemented/workflow-planning-stage-nodes.md)（已实施；真实浏览器及 API 验收待执行）

规划结果保存失败时，已校验结果会保留在 SQLite 路径旁的 `.recovery/` 目录，重试不重复调用模型；备份应用数据时请同时保留该目录。
