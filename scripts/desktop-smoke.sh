#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_BLUE_DIR="$HOME/.codex/pets/work-blue-cat"
PET_JSON="$WORK_BLUE_DIR/pet.json"
PET_WEBP="$WORK_BLUE_DIR/spritesheet.webp"

echo "[1/4] 检查本地测试资源 ..."
if [[ ! -f "$PET_JSON" || ! -f "$PET_WEBP" ]]; then
  echo "缺少工作蓝猫资源：请确认以下文件存在"
  echo "  - $PET_JSON"
  echo "  - $PET_WEBP"
  exit 1
fi

cd "$ROOT_DIR"

echo "[2/4] 运行关键测试（默认猫 + work-blue-cat 真实文件）..."
npm run test:run -- src/app/DesktopApp.test.tsx src/features/pets/domain/importPet.localfile.test.ts src/features/pets/components/PetLibrary.test.tsx

echo "[3/4] 构建桌面版产物..."
npm run build

echo "[4/4] 启动应用进行手动验收（默认猫 + 导入 + 隐藏侧边）..."
echo "执行以下命令并完成手动验证："
echo "  cd \"$ROOT_DIR\""
echo "  npm run start:direct"
echo "  # 1) 启动后应先显示内置猫"
echo "  # 2) 导入 ${PET_JSON} 与 ${PET_WEBP}，保存后应能显示工作蓝猫"
echo "  # 3) 可切回内置猫，并点击“隐藏到侧边”进行吸附与恢复验证"
