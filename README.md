# 织序 WEAVE

本地单人 Agent 规划与审查软件，依据 `agent-workflow-mvp(1).md`（2026-11-15）实现。本期仅调用 PM 与编排器两个逻辑阶段；下游 Agent 是可编辑定义，确认不触发任何下游模型或工具调用。

## 启动

需要 Node.js 22.13+（推荐24），首次安装依赖：

```sh
npm install
cp .env.example .env
# 在 .env 填写 DEEPSEEK_API_KEY，不要提交密钥
npm run dev
```

推荐统一使用 npm 安装依赖，保留 `package-lock.json`；后续干净安装可运行 `npm ci`。不要在同一个 `node_modules` 目录混用 npm 与 pnpm。若此前用 pnpm 安装后，`npm install` 报 `Cannot read properties of null (reading 'matches')`，先将现有 `node_modules` 移至项目外备份，再运行 `npm install`，无需删除 `.env` 或 `data`。

打开 http://127.0.0.1:3000 。本机依赖已安装时也可双击 `start.command`。修改 `.env` 后重启服务。没有密钥时可保存需求、查看与编辑已有方案，但不能进行真实 AI 生成。设置页不接收或暴露密钥。

服务固定读取项目根目录下的 `.env`，不受启动时工作目录影响；已设置的系统/启动命令环境变量优先于 `.env`。默认端口为 `3000`，可在 `.env` 中用 `PORT=8080` 等有效端口覆盖。`DATA_PATH` 的相对路径也以项目根目录为基准。

生产构建与启动：

```sh
npm run build
npm start
```

数据存储于 `data/weave.sqlite`（SQLite WAL）。备份时先停止服务，再复制整个 `data` 目录。浏览器编辑草稿保存在 localStorage；清空浏览器数据会删除未正式保存的草稿。此软件仅监听本机，不提供账号与远程访问能力。

## 使用

1. 新建方案，输入文本或上传/粘贴图片，开始规划。
2. PM 若提出澄清问题，填写回答；信息充分后自动进入编排。
3. 编排器若提出异议，系统停止等待，不让两个角色自动循环。
4. 画布上拖动节点、连接端口、双击边删除。右侧修改任务、输入输出、验收和 Agent 分配。
5. Agent 页编辑动态角色、职责、系统提示词和未来能力声明；下游统一使用该方案的模型/强度快照。
6. “需求覆盖”定位错误。结构错误阻止正式保存；仅覆盖遗漏可保存但不能确认。
7. 保存方案，再确认具体修订。确认仅表示审查通过，不表示业务目标完成。
8. 修改需求会建立新需求版本，使旧方案过期；AI重生成保留原方案，新稿需在“版本与候选”比较后采用或放弃。

图片本地限制为12张、每张10MB、2400万像素，支持静态PNG/JPEG/WebP/GIF。后端解码校验并统一为PNG；动画需要转静态后提交。请求体40MB，超限提示调整。图片随需求持久化，并实际进入PM与编排器的请求。

## 实现边界

- React + TypeScript + React Flow，Node/Express，Node内置SQLite。
- DeepSeek `deepseek-flash` Chat Completions，thinking enabled，low/high/max，JSON Output与流式content；不读取展示reasoning_content，不传tools。
- 流式SSE为服务端状态快照推送，重连不启动模型调用。
- 设置、需求、已回答内容和当前方案在请求创建时冻结。主动重试复用已校验PM结果和原设置；新反馈/需求/设置要明确重生成。
- 已校验完整结果先保留到生成记录，再提交方案；方案提交失败时重试保存，不重复调用。存储介质彻底不可写时仍可能无法持久化新结果，界面不会显示已保存。
- 数据库条件版本更新拒绝过期保存、确认及候选提交。取消后旧响应无法接纳。服务重启将活动生成标为中断，等待用户明确重试。
- 原方案和历史确认保持不变；画布布局不影响确认。
- 未保存草稿自动独立保留，错误草稿可恢复；基础修订不一致时保留双方并提示冲突，可导出草稿或选择已保存方案。
- 不实现下游执行、联网检索、Worker、多人协作和收费系统。

## 验证

```sh
npm test
npm run build
```

`tests/planner.test.ts` 使用注入模型验证状态与协议，不发送外部请求。已验证流式末块、空白/截断、澄清异议、取消、候选、设置快照、重试复用、过期需求与重启。浏览器检查使用隔离测试数据库，包含画布、人工修改、草稿刷新、保存确认、无效任务/Agent拦截以及移动布局。

真实DeepSeek文本及图片组合联调需要有效本地密钥。当前交付未以模拟结果冒充真实API验证。`DEEPSEEK_BASE_URL`仅供本地协议测试覆盖；正常使用无需设置。

官方接入依据：
- https://api-docs.deepseek.com/zh-cn/guides/vision/
- https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/
- https://api-docs.deepseek.com/zh-cn/guides/json_mode/

## 目录

- `shared/domain.ts`：领域类型、校验与默认提示词。
- `server/model.ts`：DeepSeek请求与流式解析。
- `server/engine.ts`：两阶段规划、等待、取消、重试和候选保护。
- `server/store.ts`：SQLite持久化与版本条件写入。
- `server/index.ts`：本机API、图片校验、SSE与页面服务。
- `src/components/`：输入、图编辑、属性、设置及方案审查。
