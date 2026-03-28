#!/bin/bash

set -euo pipefail

# Creates a gallery token in the access_tokens table.
# Usage:
#   ./scripts/create-admin-token.sh type=user
#   ./scripts/create-admin-token.sh type=admin
#   ./scripts/create-admin-token.sh user
#   TOKEN_DAYS=7 ./scripts/create-admin-token.sh type=admin
# Optional env vars:
#   DB_SERVICE (default: db)
#   POSTGRES_USER (default: postgres)
#   POSTGRES_DB (default: hochzeit_db)
#   DOCKER_COMPOSE_FILE (e.g. docker-compose.prod.yml)

TOKEN_DAYS="${TOKEN_DAYS:-30}"
DB_SERVICE="${DB_SERVICE:-db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-hochzeit_db}"
DOCKER_COMPOSE_FILE="${DOCKER_COMPOSE_FILE:-}"

TOKEN_TYPE=""

usage() {
  echo "Usage: $0 type=user|admin"
  echo "       $0 user|admin"
}

if [[ $# -gt 1 ]]; then
  usage
  exit 1
fi

if [[ $# -eq 1 ]]; then
  case "$1" in
    type=*)
      TOKEN_TYPE="${1#type=}"
      ;;
    user|admin)
      TOKEN_TYPE="$1"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
fi

if [[ -z "$TOKEN_TYPE" ]]; then
  echo "Error: Missing token type argument." >&2
  usage
  exit 1
fi

case "$TOKEN_TYPE" in
  user)
    TOKEN_PERMISSIONS="upload:view"
    ;;
  admin)
    TOKEN_PERMISSIONS="upload:view:admin:delete"
    ;;
  *)
    echo "Error: type must be 'user' or 'admin'." >&2
    usage
    exit 1
    ;;
esac

if ! [[ "$TOKEN_DAYS" =~ ^[0-9]+$ ]]; then
  echo "Error: TOKEN_DAYS must be an integer (e.g. 30)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v uuidgen >/dev/null 2>&1; then
  echo "Error: uuidgen is required but not installed." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required but not installed." >&2
  exit 1
fi

TOKEN_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
TOKEN_VALUE="$(openssl rand -hex 32)"

if [[ -n "$DOCKER_COMPOSE_FILE" ]]; then
  docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -c "INSERT INTO access_tokens (id, token, permissions, expires_at) VALUES ('$TOKEN_ID'::uuid, '$TOKEN_VALUE', '$TOKEN_PERMISSIONS', NOW() + INTERVAL '$TOKEN_DAYS days');"
else
  docker compose exec -T "$DB_SERVICE" psql \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -c "INSERT INTO access_tokens (id, token, permissions, expires_at) VALUES ('$TOKEN_ID'::uuid, '$TOKEN_VALUE', '$TOKEN_PERMISSIONS', NOW() + INTERVAL '$TOKEN_DAYS days');"
fi

echo "Token created successfully."
echo "type=$TOKEN_TYPE"
echo "id=$TOKEN_ID"
echo "token=$TOKEN_VALUE"
echo "permissions=$TOKEN_PERMISSIONS"
echo "expires_in_days=$TOKEN_DAYS"
