#!/bin/bash
# Redeploy the public stack (ADR 0051, ADR 0054, ADR 0055): pull, rebuild, install the hourly demo reset, then reset
# the demo so every deploy starts on the seeded story day. Run it on the droplet:
#   /opt/nextdrop/docker/redeploy.sh                  reset to DEMO_DEPLOY_PRESET from .env, else orders-closed
#   /opt/nextdrop/docker/redeploy.sh before-cutoff    reset to another built preset
#   /opt/nextdrop/docker/redeploy.sh --keep           keep the current demo state (the hourly reset still runs)
# DEMO_RESET_HOURLY=false in .env removes the hourly reset on the next redeploy.
# A plain restart (reboot, crash) never resets: the seed alone keeps demo progress (ADR 0030).
set -euo pipefail

# Read the whole script before `git pull` can rewrite this file.
main() {
  cd "$(dirname "$0")/.."
  env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }

  local preset="${1:-}"

  git pull --ff-only
  # Fails on a broken build, instead of leaving the old container running unnoticed.
  docker compose up -d --build

  if [ "$(id -u)" = 0 ] && [ -d /etc/cron.d ]; then
    if [ "$(env_value DEMO_RESET_HOURLY)" = "false" ]; then
      docker/reset-demo.sh --remove-cron
    else
      docker/reset-demo.sh --install-cron
    fi
  else
    echo "Not root, or no /etc/cron.d: the hourly demo reset was not installed."
  fi

  if [ "$preset" = "--keep" ]; then
    echo "Deployed. The demo state was kept."
    return
  fi
  docker/reset-demo.sh "$preset"
  echo "Deployed."
}

main "$@"
exit
