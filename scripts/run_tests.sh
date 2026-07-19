#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Checking HTML validity (site/)"
python3 scripts/check_html.py site/index.html

echo "==> Checking workflow YAML parses"
ruby -ryaml -e "YAML.load_file('.github/workflows/deploy.yml')"

echo "==> Running cdk synth"
(
  cd infra
  if [ ! -d node_modules ]; then
    npm install
  fi
  npx cdk synth >/dev/null
)

echo "All tests passed."
