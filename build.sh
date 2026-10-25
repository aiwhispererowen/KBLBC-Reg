#!/bin/sh
# Single source of truth for the rules is docs/assets/core.js.
# Apps Script needs its own copy, named Core.gs.
set -e
cd "$(dirname "$0")"
cp docs/assets/core.js apps-script/Core.gs
echo "apps-script/Core.gs refreshed from docs/assets/core.js"
