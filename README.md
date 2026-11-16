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

- `shared/domain.ts`：领域类型、校验与默认提示词。
- `server/model.ts`：DeepSeek请求与流式解析。
- `server/engine.ts`：两阶段规划、等待、取消、重试和候选保护。
- `server/store.ts`：SQLite持久化与版本条件写入。
- `server/index.ts`：本机API、图片校验、SSE与页面服务。
- `src/components/`：输入、图编辑、属性、设置及方案审查。
