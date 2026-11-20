#!/bin/bash
set -Eeuo pipefail
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
