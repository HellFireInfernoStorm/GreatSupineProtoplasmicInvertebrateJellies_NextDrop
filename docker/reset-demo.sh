#!/bin/bash
# Reset the public demo to a preset (ADR 0054, ADR 0055). docker/redeploy.sh runs it after each deploy, and an hourly
# cron job runs it so the demo clock never drifts far from the story day. Run it on the droplet:
#   /opt/nextdrop/docker/reset-demo.sh                  reset to DEMO_DEPLOY_PRESET from .env, else orders-closed
#   /opt/nextdrop/docker/reset-demo.sh before-cutoff    reset to another built preset
#   /opt/nextdrop/docker/reset-demo.sh --install-cron   install the hourly job in /etc/cron.d (as root)
#   /opt/nextdrop/docker/reset-demo.sh --remove-cron    remove the hourly job
set -euo pipefail

# Read the whole script before `git pull` can rewrite this file.
main() {
  cd "$(dirname "$0")/.."
  local root cron_file=/etc/cron.d/nextdrop-demo-reset log_file=/var/log/nextdrop-demo-reset.log
  root="$(pwd)"
  env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }

  case "${1:-}" in
    --install-cron)
      # cron.d needs a root-owned file that only root can write, with no dot in its name.
      cat > "$cron_file.tmp" <<EOF
# Installed by $root/docker/reset-demo.sh --install-cron (ADR 0055): resets the public demo every hour, on the hour.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 * * * * root "$root/docker/reset-demo.sh" >> $log_file 2>&1
EOF
      chmod 644 "$cron_file.tmp"
      mv "$cron_file.tmp" "$cron_file"
      echo "Installed $cron_file: the demo resets every hour, on the hour. Log: $log_file"
      return
      ;;
    --remove-cron)
      rm -f "$cron_file"
      echo "Removed the hourly demo reset."
      return
      ;;
  esac

  local preset="${1:-$(env_value DEMO_DEPLOY_PRESET)}"
  preset="${preset:-orders-closed}"

  local port key
  port="$(env_value APP_PORT)"
  port="${port:-8080}"
  key="$(env_value DEMO_SCRIPT_KEY)"
  if [ -z "$key" ]; then
    echo "DEMO_SCRIPT_KEY is empty in .env, so the demo cannot be reset." >&2
    exit 1
  fi

  # One reset at a time: the hourly job and a redeploy can meet on the hour.
  if [ "$(uname -s)" = Linux ] && command -v flock >/dev/null; then
    exec 9>/tmp/nextdrop-demo-reset.lock
    flock -w 300 9
  fi

  # The API listens only after the seed has finished, so a healthy API has a seeded database.
  local tries=0
  until curl -fsS "http://localhost:$port/api/healthz" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 90 ]; then
      echo "$(date -Is) The API did not answer on port $port within 3 minutes. Check: docker compose logs app" >&2
      exit 1
    fi
    sleep 2
  done

  # The script key replaces the session; the CSRF header only has to be present (guard.ts).
  local state
  state="$(curl -sS --fail-with-body -X POST "http://localhost:$port/api/demo/reset" \
    -H "content-type: application/json" \
    -H "x-nextdrop-csrf: reset-demo" \
    -H "x-nextdrop-script-key: $key" \
    -d "{\"preset\":\"$preset\"}")" || {
    echo "$(date -Is) Reset to $preset failed: $state" >&2
    exit 1
  }
  echo "$(date -Is) Reset the demo to $preset: $state"
}

main "$@"
exit
