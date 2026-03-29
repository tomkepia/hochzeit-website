# Token Guide

This project stores gallery login tokens in PostgreSQL table `access_tokens`.

## List all tokens

```bash
docker compose exec -T db psql -U postgres -d hochzeit_db -c "SELECT id, token, permissions, expires_at, (expires_at > NOW()) AS is_valid FROM access_tokens ORDER BY expires_at DESC;"
```

## List only valid tokens

```bash
docker compose exec -T db psql -U postgres -d hochzeit_db -c "SELECT id, token, permissions, expires_at FROM access_tokens WHERE expires_at > NOW() ORDER BY expires_at DESC;"
```

## Optional: token count

```bash
docker compose exec -T db psql -U postgres -d hochzeit_db -c "SELECT COUNT(*) AS valid_tokens FROM access_tokens WHERE expires_at > NOW();"
```

## If command fails

1. Start services:

```bash
docker compose up -d db backend
```

2. Check running containers:

```bash
docker compose ps
```
