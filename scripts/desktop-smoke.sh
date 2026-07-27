#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[1/3] Running deterministic unit tests..."
npm run test:run

echo "[2/3] Running existing browser E2E coverage..."
npm run test:e2e

echo "[3/3] Building and checking packaged desktop resources..."
npm run desktop:build
npm run desktop:smoke:packaged-resources
