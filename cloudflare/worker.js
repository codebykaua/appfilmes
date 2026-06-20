const MAX_JSON_BYTES = 12_000;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PROFILE_LIMIT = 5;
const PROFILE_COLORS = ["#35d3b4", "#22aee8", "#f7c66a", "#ff7f8f", "#9d7cff"];
const PBKDF2_ITERATIONS = 100000;

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      const url = new URL(request.url);

      if (url.pathname === "/api/health" && request.method === "GET") {
        return json(request, { ok: true, service: "appfilmes-api" });
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        return await handleRegister(request, env, ctx);
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env, ctx);
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return await handleMe(request, env);
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return await handleLogout(request, env);
      }

      if (url.pathname === "/api/profiles" && request.method === "GET") {
        return await handleListProfiles(request, env);
      }

      if (url.pathname === "/api/profiles" && request.method === "POST") {
        return await handleCreateProfile(request, env);
      }

      const profileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
      if (profileMatch && request.method === "PATCH") {
        return await handleUpdateProfile(request, env, profileMatch[1]);
      }

      if (profileMatch && request.method === "DELETE") {
        return await handleDeleteProfile(request, env, profileMatch[1]);
      }

      const pinMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/verify-pin$/);
      if (pinMatch && request.method === "POST") {
        return await handleVerifyProfilePin(request, env, pinMatch[1]);
      }

      return json(request, { message: "Rota nao encontrada." }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { message: error.message }, error.status);
      }

      console.error(JSON.stringify({ level: "error", message: error.message }));
      return json(request, { message: "Erro interno da API." }, 500);
    }
  },
};

async function handleRegister(request, env, ctx) {
  const body = await readJson(request);
  const name = cleanText(body.name);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!name || !email || !password) {
    return json(request, { message: "Preencha nome, email e senha." }, 400);
  }

  if (!isValidEmail(email)) {
    return json(request, { message: "Email invalido." }, 400);
  }

  if (password.length < 6) {
    return json(request, { message: "A senha precisa ter pelo menos 6 caracteres." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) {
    return json(request, { message: "Ja existe uma conta com esse email." }, 409);
  }

  const now = new Date().toISOString();
  const salt = createRandomToken(18);
  const passwordHash = await hashPassword(password, salt);
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    createdAt: now,
  };

  await env.DB.prepare(
    "INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(user.id, user.name, user.email, passwordHash, salt, now)
    .run();

  const token = await createSession(env, user.id);
  ctx.waitUntil(cleanExpiredSessions(env));

  return json(request, { token, user }, 201);
}

async function handleLogin(request, env, ctx) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!email || !password) {
    return json(request, { message: "Preencha email e senha." }, 400);
  }

  const record = await env.DB.prepare(
    "SELECT id, name, email, password_hash, password_salt, created_at FROM users WHERE email = ?",
  )
    .bind(email)
    .first();

  if (!record) {
    return json(request, { message: "Email ou senha invalidos." }, 401);
  }

  const passwordHash = await hashPassword(password, record.password_salt);
  if (!constantTimeEqual(passwordHash, record.password_hash)) {
    return json(request, { message: "Email ou senha invalidos." }, 401);
  }

  const token = await createSession(env, record.id);
  ctx.waitUntil(cleanExpiredSessions(env));

  return json(request, {
    token,
    user: publicUser(record),
  });
}

async function handleMe(request, env) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(request, { message: "Sessao invalida ou expirada." }, 401);
  }

  return json(request, { user: session.user });
}

async function handleLogout(request, env) {
  const token = getBearerToken(request);

  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }

  return json(request, { ok: true });
}

async function handleListProfiles(request, env) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(request, { message: "Sessao invalida ou expirada." }, 401);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, name, pin_hash, color, created_at, updated_at FROM profiles WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(session.user.id)
    .all();

  return json(request, {
    profiles: results.map(publicProfile),
    limit: PROFILE_LIMIT,
  });
}

async function handleCreateProfile(request, env) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(request, { message: "Sessao invalida ou expirada." }, 401);
  }

  const body = await readJson(request);
  const name = cleanText(body.name).slice(0, 32);
  const pin = cleanPin(body.pin);
  const now = new Date().toISOString();

  if (!name) {
    return json(request, { message: "Informe o nome da tela." }, 400);
  }

  if (body.pin && !pin) {
    return json(request, { message: "O PIN deve ter 4 numeros." }, 400);
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM profiles WHERE user_id = ?")
    .bind(session.user.id)
    .first();

  if (Number(count?.total || 0) >= PROFILE_LIMIT) {
    return json(request, { message: "Cada usuario pode ter no maximo 5 telas." }, 409);
  }

  const profileCount = Number(count?.total || 0);
  const color = PROFILE_COLORS[profileCount % PROFILE_COLORS.length];
  const pinSalt = pin ? createRandomToken(18) : null;
  const pinHash = pin ? await hashSecret(pin, pinSalt) : null;
  const profile = {
    id: crypto.randomUUID(),
    userId: session.user.id,
    name,
    hasPin: Boolean(pinHash),
    color,
    createdAt: now,
    updatedAt: now,
  };

  await env.DB.prepare(
    "INSERT INTO profiles (id, user_id, name, pin_hash, pin_salt, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(profile.id, profile.userId, profile.name, pinHash, pinSalt, profile.color, now, now)
    .run();

  return json(request, { profile }, 201);
}

async function handleUpdateProfile(request, env, profileId) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(request, { message: "Sessao invalida ou expirada." }, 401);
  }

  const profile = await getOwnedProfile(env, session.user.id, profileId);
  if (!profile) {
    return json(request, { message: "Tela nao encontrada." }, 404);
  }

  const body = await readJson(request);
  const name = body.name === undefined ? profile.name : cleanText(body.name).slice(0, 32);
  const wantsPinChange = body.pin !== undefined;
  const pin = wantsPinChange ? cleanPin(body.pin) : null;

  if (!name) {
    return json(request, { message: "Informe o nome da tela." }, 400);
  }

  if (wantsPinChange && body.pin && !pin) {
    return json(request, { message: "O PIN deve ter 4 numeros." }, 400);
  }

  const pinSalt = wantsPinChange && pin ? createRandomToken(18) : wantsPinChange ? null : profile.pin_salt;
  const pinHash = wantsPinChange && pin ? await hashSecret(pin, pinSalt) : wantsPinChange ? null : profile.pin_hash;
  const now = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE profiles SET name = ?, pin_hash = ?, pin_salt = ?, updated_at = ? WHERE id = ? AND user_id = ?",
  )
    .bind(name, pinHash, pinSalt, now, profileId, session.user.id)
    .run();

  const updated = await getOwnedProfile(env, session.user.id, profileId);
  return json(request, { profile: publicProfile(updated) });
}

async function handleDeleteProfile(request, env, profileId) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(request, { message: "Sessao invalida ou expirada." }, 401);
  }

  await env.DB.prepare("DELETE FROM profiles WHERE id = ? AND user_id = ?").bind(profileId, session.user.id).run();
  return json(request, { ok: true });
}

async function handleVerifyProfilePin(request, env, profileId) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(request, { message: "Sessao invalida ou expirada." }, 401);
  }

  const profile = await getOwnedProfile(env, session.user.id, profileId);
  if (!profile) {
    return json(request, { message: "Tela nao encontrada." }, 404);
  }

  if (!profile.pin_hash) {
    return json(request, { ok: true, profile: publicProfile(profile) });
  }

  const body = await readJson(request);
  const pin = cleanPin(body.pin);

  if (!pin) {
    return json(request, { message: "Informe o PIN de 4 numeros." }, 400);
  }

  const pinHash = await hashSecret(pin, profile.pin_salt);
  if (!constantTimeEqual(pinHash, profile.pin_hash)) {
    return json(request, { message: "PIN invalido." }, 401);
  }

  return json(request, { ok: true, profile: publicProfile(profile) });
}

async function createSession(env, userId) {
  const token = createRandomToken(32);
  const now = new Date();
  const ttlSeconds = Number(env.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  const expires = new Date(now.getTime() + ttlSeconds * 1000);

  await env.DB.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, now.toISOString(), expires.toISOString())
    .run();

  return token;
}

async function getSessionUser(request, env) {
  const token = getBearerToken(request);

  if (!token) {
    return null;
  }

  const record = await env.DB.prepare(
    `SELECT users.id, users.name, users.email, users.created_at
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > ?`,
  )
    .bind(token, new Date().toISOString())
    .first();

  if (!record) {
    return null;
  }

  return { user: publicUser(record) };
}

async function getOwnedProfile(env, userId, profileId) {
  return env.DB.prepare(
    "SELECT id, name, pin_hash, pin_salt, color, created_at, updated_at FROM profiles WHERE id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .first();
}

function cleanExpiredSessions(env) {
  return env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run()
    .catch((error) => {
      console.error(JSON.stringify({ level: "warn", message: "session_cleanup_failed", detail: error.message }));
    });
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_JSON_BYTES) {
    throw new HttpError("Payload muito grande.", 413);
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError("JSON invalido.", 400);
  }
}

async function hashPassword(password, salt) {
  return hashSecret(password, salt);
}

async function hashSecret(secret, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function createRandomToken(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }

  return diff === 0;
}

function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function publicUser(record) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    createdAt: record.created_at || record.createdAt,
  };
}

function publicProfile(record) {
  return {
    id: record.id,
    name: record.name,
    hasPin: Boolean(record.pin_hash),
    color: record.color,
    createdAt: record.created_at || record.createdAt,
    updatedAt: record.updated_at || record.updatedAt,
  };
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function cleanPin(value) {
  const pin = String(value || "").trim();
  return /^\d{4}$/.test(pin) ? pin : "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
