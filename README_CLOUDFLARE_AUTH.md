# AppFilmes Auth + Cloudflare

O frontend ja funciona com cadastro/login local usando `localStorage`. A API Cloudflare Worker esta em `cloudflare/worker.js` e usa o banco D1 configurado em `wrangler.jsonc`.

## Deploy da API

```powershell
npx wrangler deploy
```

Depois do deploy, copie a URL gerada pelo Wrangler e edite `api-config.js`:

```js
window.APPFILMES_CONFIG = {
  apiBaseUrl: "https://appfilmes-api.seu-subdominio.workers.dev",
};
```

## Endpoints esperados

### `POST /api/auth/register`

Entrada:

```json
{
  "name": "Nome",
  "email": "email@site.com",
  "password": "senha"
}
```

Resposta:

```json
{
  "token": "session-token",
  "user": {
    "id": "user-id",
    "name": "Nome",
    "email": "email@site.com",
    "createdAt": "2026-06-19T00:00:00.000Z"
  }
}
```

### `POST /api/auth/login`

Entrada:

```json
{
  "email": "email@site.com",
  "password": "senha"
}
```

Resposta igual ao cadastro.

### `GET /api/auth/me`

Header:

```http
Authorization: Bearer session-token
```

Resposta:

```json
{
  "user": {
    "id": "user-id",
    "name": "Nome",
    "email": "email@site.com",
    "createdAt": "2026-06-19T00:00:00.000Z"
  }
}
```

### `POST /api/auth/logout`

Header:

```http
Authorization: Bearer session-token
```

Resposta:

```json
{
  "ok": true
}
```

## Observacao de seguranca

O modo local serve para testar a tela. Em producao, a senha deve ser processada no Worker e salva como hash no D1. O frontend nunca deve salvar senha pura.
