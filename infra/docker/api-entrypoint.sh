#!/bin/sh
# Entrypoint of the api image: prepare storage, apply SQL migrations, then exec the control plane.
# (The api also migrates on boot; running it here first makes a bad migration fail the deploy loudly before the
# HTTP server starts, and Railway keeps the previous deployment serving.)
set -eu

if [ "${STORAGE_DRIVER:-local}" = "local" ]; then
  dir="${STORAGE_DIR:-/data/storage}"
  if ! mkdir -p "$dir" 2>/dev/null || ! [ -w "$dir" ]; then
    echo "[entrypoint] STORAGE_DIR $dir is not writable: attach a Railway volume at /data (or set STORAGE_DRIVER=s3)" >&2
    exit 1
  fi
  case "$dir" in
    /data/*|/data) [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ] || [ -n "${ALLOW_EPHEMERAL_STORAGE:-}" ] || [ -z "${RAILWAY_ENVIRONMENT:-}" ] \
      || echo "[entrypoint] warning: no Railway volume detected; $dir is ephemeral and is wiped on every deploy" >&2 ;;
  esac
fi

if [ -n "${DATABASE_URL:-}" ] && [ "${SKIP_MIGRATIONS:-}" != "1" ]; then
  echo "[entrypoint] applying migrations"
  node apps/api/dist/migrate.js
fi

export GIT_COMMIT="${GIT_COMMIT:-${RAILWAY_GIT_COMMIT_SHA:-}}"
exec "$@"
