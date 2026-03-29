# Token Guide

This project stores gallery login tokens in PostgreSQL table `access_tokens`.

There are two token types:

| Type    | Permissions                        | Use case                              |
|---------|------------------------------------|---------------------------------------|
| `user`  | `upload:view`                      | Guests — can upload and view photos   |
| `admin` | `upload:view:admin:delete`         | Admins — full access including delete |

Tokens expire after **30 days** by default. Override with `TOKEN_DAYS=N`.

---

## Create a token — local development

```bash
./scripts/create-admin-token.sh user
./scripts/create-admin-token.sh admin

# Custom expiry (e.g. 7 days)
TOKEN_DAYS=7 ./scripts/create-admin-token.sh admin
```

Requires Docker to be running with the `db` service up:

```bash
docker compose up -d db backend
```

---

## Create a token — deployed on Hetzner VPS

SSH into the server and run the script using the production compose file.
The production database is named `hochzeit_production`, so `POSTGRES_DB` must be set explicitly:

```bash
ssh root@your-server-ip
cd /opt/hochzeit-website

# Create a user token
POSTGRES_DB=hochzeit_production DOCKER_COMPOSE_FILE=docker-compose.prod-shared.yml ./scripts/create-admin-token.sh user

# Create an admin token
POSTGRES_DB=hochzeit_production DOCKER_COMPOSE_FILE=docker-compose.prod-shared.yml ./scripts/create-admin-token.sh admin

# Custom expiry (e.g. 157 days)
TOKEN_DAYS=157 POSTGRES_DB=hochzeit_production DOCKER_COMPOSE_FILE=docker-compose.prod-shared.yml ./scripts/create-admin-token.sh user
```

The script prints the token value to stdout — copy it and share it with the guest or admin.

---

## List all tokens

**Local:**
```bash
docker compose exec -T db psql -U postgres -d hochzeit_db -c "SELECT id, token, permissions, expires_at, (expires_at > NOW()) AS is_valid FROM access_tokens ORDER BY expires_at DESC;"
```

**Deployed:**
```bash
docker compose -f docker-compose.prod-shared.yml exec -T db psql -U postgres -d hochzeit_production -c "SELECT id, token, permissions, expires_at, (expires_at > NOW()) AS is_valid FROM access_tokens ORDER BY expires_at DESC;"
```

## List only valid tokens

**Local:**
```bash
docker compose exec -T db psql -U postgres -d hochzeit_db -c "SELECT id, token, permissions, expires_at FROM access_tokens WHERE expires_at > NOW() ORDER BY expires_at DESC;"
```

**Deployed:**
```bash
docker compose -f docker-compose.prod-shared.yml exec -T db psql -U postgres -d hochzeit_production -c "SELECT id, token, permissions, expires_at FROM access_tokens WHERE expires_at > NOW() ORDER BY expires_at DESC;"
```

## Token count

**Local:**
```bash
docker compose exec -T db psql -U postgres -d hochzeit_db -c "SELECT COUNT(*) AS valid_tokens FROM access_tokens WHERE expires_at > NOW();"
```

**Deployed:**
```bash
docker compose -f docker-compose.prod-shared.yml exec -T db psql -U postgres -d hochzeit_production -c "SELECT COUNT(*) AS valid_tokens FROM access_tokens WHERE expires_at > NOW();"
```

---

## Delete a token

```bash
# Replace <token-id> with the UUID from the listing above
docker compose exec -T db psql -U postgres -d hochzeit_db -c "DELETE FROM access_tokens WHERE id = '<token-id>'::uuid;"
```

For production, add `-f docker-compose.prod-shared.yml` and use `-d hochzeit_production`.

---

## Troubleshooting

If a command fails, check that the required services are running.

**Local:**
```bash
docker compose up -d db backend
docker compose ps
```

**Deployed:**
```bash
cd /opt/hochzeit-website
docker compose -f docker-compose.prod-shared.yml up -d db backend
docker compose -f docker-compose.prod-shared.yml ps
```
