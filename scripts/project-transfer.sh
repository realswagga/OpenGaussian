#!/bin/sh
set -eu

command=${1:-}
shift || true

PASSPHRASE=''
if [ "$command" != 'list' ]; then
  printf 'Transfer passphrase: ' >&2
  stty -echo
  IFS= read -r PASSPHRASE
  stty echo
  printf '\n' >&2
fi

run_transfer() {
  printf '%s\n' "$PASSPHRASE" | docker compose --profile tools run --rm -T transfer "$@"
}

case "$command" in
  export)
    docker compose stop api worker
    trap 'docker compose up -d api worker' EXIT INT TERM
    run_transfer export "$@"
    docker compose up -d api worker
    trap - EXIT INT TERM
    ;;
  validate)
    run_transfer validate "$@"
    ;;
  import)
    docker compose stop nginx public-web admin-web api worker
    trap 'docker compose up -d' EXIT INT TERM
    apply_config=false
    for argument in "$@"; do [ "$argument" = "--apply-config" ] && apply_config=true; done
    run_transfer import "$@"
    if [ "$apply_config" = true ]; then
      [ ! -f .env ] || cp .env "backups/.env.before-import-$(date +%Y%m%d%H%M%S)"
      cp backups/runtime.env.imported .env
      chmod 600 .env 2>/dev/null || true
    fi
    docker compose up -d
    trap - EXIT INT TERM
    ;;
  list)
    docker compose --profile tools run --rm -T transfer list
    ;;
  *)
    echo 'Usage: project-transfer.sh export|validate|import|list [arguments]' >&2
    exit 2
    ;;
esac
