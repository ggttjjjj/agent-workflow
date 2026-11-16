#!/bin/zsh
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [[ -x /Users/Admin1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ]]; then
  NODE_BIN=/Users/Admin1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
else
  echo '请安装 Node.js 22.13 或更高版本，然后执行 npm install。'; read; exit 1
fi
if [[ ! -d node_modules ]]; then
  echo '请先在项目目录执行 npm install'; read; exit 1
fi
"$NODE_BIN" --import tsx server/index.ts
