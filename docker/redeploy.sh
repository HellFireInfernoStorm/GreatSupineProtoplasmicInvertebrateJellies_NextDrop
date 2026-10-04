#!/bin/bash
# Redeploy the public stack (ADR 0051, ADR 0054): pull, rebuild, wait for the API, then reset the demo to a preset so
# every deploy starts from the seeded story day. Run it on the droplet:
#   /opt/nextdrop/docker/redeploy.sh                  reset to DEMO_DEPLOY_PRESET from .env, else before-cutoff
#   /opt/nextdrop/docker/redeploy.sh orders-closed    reset to another built preset
#   /opt/nextdrop/docker/redeploy.sh --keep           keep the current demo state
# A plain restart (reboot, crash) never resets: the seed alone keeps demo progress (ADR 0030).
set -euo pipefail

# Read the whole script before `git pull` can rewrite this file.
main() {
  cd "$(dirname "$0")/.."
  env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }

  local preset="${1:-$(env_value DEMO_DEPLOY_PRESET)}"
  preset="${preset:-before-cutoff}"

  git pull --ff-only
  # Fails on a broken build, instead of leaving the old container running unnoticed.
  docker compose up -d --build

  if [ "$preset" = "--keep" ]; then
    echo "Deployed. The demo state was kept."
    return
  fi

  local port key
  port="$(env_value APP_PORT)"
  port="${port:-8080}"
  key="$(env_value DEMO_SCRIPT_KEY)"
  if [ -z "$key" ]; then
    echo "DEMO_SCRIPT_KEY is empty in .env, so the demo cannot be reset. Set it, or pass --keep." >&2
    exit 1
  fi

  # The API listens only after the seed has finished, so a healthy API has a seeded database.
  local tries=0
  until curl -fsS "http://localhost:$port/api/healthz" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 90 ]; then
      echo "The API did not answer on port $port within 3 minutes. Check: docker compose logs app" >&2
      exit 1
    fi
    sleep 2
  done

  # The script key replaces the session; the CSRF header only has to be present (guard.ts).
  curl -sS --fail-with-body -X POST "http://localhost:$port/api/demo/reset" \
    -H "content-type: application/json" \
    -H "x-nextdrop-csrf: redeploy" \
    -H "x-nextdrop-script-key: $key" \
    -d "{\"preset\":\"$preset\"}"
  echo
  echo "Deployed and reset the demo to $preset."
}

main "$@"
exit
