#!/bin/sh
# Container start: make sure a session secret exists, apply migrations, then run the API.
# The seed runs inside the API start-up when SEED_ON_START=true (apps/api/src/main.ts).
set -eu

if [ -z "${SESSION_SECRET:-}" ]; then
  # No secret is committed. Generate one on first start and keep it in the app-data volume,
  # so sessions survive a restart. Set SESSION_SECRET for a public deployment.
  secret_file=/var/lib/nextdrop/session-secret
  if [ ! -s "$secret_file" ]; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" > "$secret_file"
    chmod 600 "$secret_file"
  fi
  SESSION_SECRET=$(cat "$secret_file")
  export SESSION_SECRET
fi

./node_modules/.bin/prisma migrate deploy
exec node --import tsx src/main.ts
