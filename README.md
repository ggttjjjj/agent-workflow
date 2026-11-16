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

## 方案管理

左侧「我的方案」保存全部历史方案，支持按名称与需求摘要搜索、重命名、创建副本和删除；「回收站」集中管理已删除方案。删除分两步，避免误删：

1. **移入回收站**：可撤销，也可稍后恢复。生成中的方案会先取消本次生成，迟到的模型结果不会再写入；该方案未保存的浏览器编辑草稿同时清除。
2. **彻底删除**：仅在回收站中提供，需要输入完整方案标题确认；确认后方案、全部修订、确认记录、需求图片和画布布局从 `data/weave.sqlite` 移除，无法恢复。「清空回收站」还需输入确认口令，并校验确认时看到的方案数量。

## 运行测试

```sh
npm test
```

## 项目结构

```
src/client/           前端（React）
  ├─ main.tsx         浏览器入口
  ├─ App.tsx / api.ts / style.css
  └─ components/      PlanPanel、InputPanel、Editor、Graph、Inspector、SettingsPanel
src/server/           后端（Node/Express）
  ├─ index.ts         API、SSE、图片校验、页面服务
  ├─ engine.ts        两阶段规划、取消、重试、候选保护、删除时的生成取消
  ├─ model.ts         DeepSeek 请求与流解析
  ├─ store.ts         SQLite 持久化、回收站与方案管理
  └─ config.ts        环境变量与项目根解析
src/shared/domain.ts  前后端共用模型
tests/                测试

