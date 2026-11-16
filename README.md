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