#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deveco_contents="${DEVECO_APP_CONTENTS:-/Applications/DevEco-Studio.app/Contents}"
if [[ ! -x "$deveco_contents/tools/node/bin/node" || ! -f "$deveco_contents/tools/hvigor/bin/hvigorw.js" ]]; then
  printf 'DevEco build tools not found. Set DEVECO_APP_CONTENTS to the installed app Contents directory.\n' >&2
  exit 1
fi
cd "$project_root"
export DEVECO_SDK_HOME="$deveco_contents/sdk"
export NODE_HOME="$deveco_contents/tools/node"
exec "$NODE_HOME/bin/node" "$deveco_contents/tools/hvigor/bin/hvigorw.js" \
  --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon "$@"
