const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector("#appShell");
const loginTab = document.querySelector("#loginTab");
const signupTab = document.querySelector("#signupTab");
const loginForm = document.querySelector("#loginForm");
const signupForm = document.querySelector("#signupForm");
const authMessage = document.querySelector("#authMessage");
const sessionUserName = document.querySelector("#sessionUserName");
const logoutButton = document.querySelector("#logoutButton");

const AUTH_USERS_KEY = "appfilmes:auth-users";
const AUTH_SESSION_KEY = "appfilmes:auth-session";
const AUTH_API_BASE = (window.APPFILMES_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");

function usesRemoteAuth() {
  return Boolean(AUTH_API_BASE);
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

function dispatchAuthChange(session) {
  window.dispatchEvent(new CustomEvent("appfilmes:auth-change", { detail: { session } }));
}

function showApp(session) {
  authScreen.hidden = true;
  appShell.hidden = false;
  sessionUserName.textContent = session.user.name || session.user.email;
  document.body.classList.add("is-authenticated");
  dispatchAuthChange(session);
}

function showAuth() {
  authScreen.hidden = false;
  appShell.hidden = true;
  document.body.classList.remove("is-authenticated");
  dispatchAuthChange(null);
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  loginTab.classList.toggle("is-active", isLogin);
  signupTab.classList.toggle("is-active", !isLogin);
  loginTab.setAttribute("aria-selected", String(isLogin));
  signupTab.setAttribute("aria-selected", String(!isLogin));
  loginForm.hidden = !isLogin;
  signupForm.hidden = isLogin;
  setAuthMessage("");
}

function getStoredUsers() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveStoredUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function createSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

async function hashPassword(password, salt) {
  if (!crypto.subtle) {
    throw new Error("Abra pelo servidor local para usar login seguro.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(salt),
      iterations: 120000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function createToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function requestAuth(path, payload, token) {
  const response = await fetch(`${AUTH_API_BASE}${path}`, {
    method: payload ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Nao foi possivel conectar a autenticacao.");
  }

  return data;
}

async function registerLocal({ name, email, password }) {
  const users = getStoredUsers();
  const normalizedEmail = normalizeEmail(email);

  if (users.some((user) => user.email === normalizedEmail)) {
    throw new Error("Ja existe uma conta com esse email.");
  }

  const salt = createSalt();
  const passwordHash = await hashPassword(password, salt);
  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: normalizedEmail,
    salt,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveStoredUsers(users);

  return {
    token: createToken(),
    user: publicUser(user),
  };
}

async function loginLocal({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const user = getStoredUsers().find((item) => item.email === normalizedEmail);

  if (!user) {
    throw new Error("Email ou senha invalidos.");
  }

  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    throw new Error("Email ou senha invalidos.");
  }

  return {
    token: createToken(),
    user: publicUser(user),
  };
}

async function registerUser(fields) {
  if (usesRemoteAuth()) {
    return requestAuth("/api/auth/register", fields);
  }

  return registerLocal(fields);
}

async function loginUser(fields) {
  if (usesRemoteAuth()) {
    return requestAuth("/api/auth/login", fields);
  }

  return loginLocal(fields);
}

async function validateRemoteSession(session) {
  if (!usesRemoteAuth() || !session?.token) {
    return session;
  }

  try {
    const data = await requestAuth("/api/auth/me", null, session.token);
    return { ...session, user: data.user || session.user };
  } catch {
    clearSession();
    return null;
  }
}

loginTab.addEventListener("click", () => switchAuthTab("login"));
signupTab.addEventListener("click", () => switchAuthTab("signup"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("Entrando...");

  const formData = new FormData(loginForm);
  const fields = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  try {
    const session = await loginUser(fields);
    saveSession(session);
    showApp(session);
  } catch (error) {
    setAuthMessage(error.message || "Nao foi possivel entrar.", true);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("Criando conta...");

  const formData = new FormData(signupForm);
  const fields = {
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };

  if (fields.password !== fields.confirmPassword) {
    setAuthMessage("As senhas nao conferem.", true);
    return;
  }

  if (fields.password.length < 6) {
    setAuthMessage("A senha precisa ter pelo menos 6 caracteres.", true);
    return;
  }

  try {
    const session = await registerUser({
      name: fields.name,
      email: fields.email,
      password: fields.password,
    });
    saveSession(session);
    showApp(session);
  } catch (error) {
    setAuthMessage(error.message || "Nao foi possivel criar a conta.", true);
  }
});

logoutButton.addEventListener("click", async () => {
  const session = readSession();

  if (usesRemoteAuth() && session?.token) {
    await requestAuth("/api/auth/logout", {}, session.token).catch(() => {});
  }

  clearSession();
  showAuth();
  switchAuthTab("login");
});

window.AppFilmesAuth = {
  getSession: readSession,
  usesRemoteAuth,
};

validateRemoteSession(readSession()).then((session) => {
  if (session?.user) {
    saveSession(session);
    showApp(session);
    return;
  }

  showAuth();
});
