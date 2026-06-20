const authScreen = document.querySelector("#authScreen");
const profileScreen = document.querySelector("#profileScreen");
const appShell = document.querySelector("#appShell");
const loginTab = document.querySelector("#loginTab");
const signupTab = document.querySelector("#signupTab");
const loginForm = document.querySelector("#loginForm");
const signupForm = document.querySelector("#signupForm");
const authMessage = document.querySelector("#authMessage");
const sessionUserName = document.querySelector("#sessionUserName");
const currentProfileName = document.querySelector("#currentProfileName");
const logoutButton = document.querySelector("#logoutButton");
const switchProfileButton = document.querySelector("#switchProfileButton");
const profileLogoutButton = document.querySelector("#profileLogoutButton");
const profileAccountName = document.querySelector("#profileAccountName");
const profileList = document.querySelector("#profileList");
const addProfileButton = document.querySelector("#addProfileButton");
const profileMessage = document.querySelector("#profileMessage");
const profileModal = document.querySelector("#profileModal");
const profileForm = document.querySelector("#profileForm");
const profileModalTitle = document.querySelector("#profileModalTitle");
const profileNameInput = document.querySelector("#profileNameInput");
const profileImageInput = document.querySelector("#profileImageInput");
const profileImagePreview = document.querySelector("#profileImagePreview");
const removeProfileImageButton = document.querySelector("#removeProfileImageButton");
const profilePinToggle = document.querySelector("#profilePinToggle");
const profilePinWrap = document.querySelector("#profilePinWrap");
const profilePinInput = document.querySelector("#profilePinInput");
const profileFormMessage = document.querySelector("#profileFormMessage");
const cancelProfileButton = document.querySelector("#cancelProfileButton");
const pinModal = document.querySelector("#pinModal");
const pinForm = document.querySelector("#pinForm");
const pinModalTitle = document.querySelector("#pinModalTitle");
const pinInput = document.querySelector("#pinInput");
const pinMessage = document.querySelector("#pinMessage");
const cancelPinButton = document.querySelector("#cancelPinButton");

const AUTH_USERS_KEY = "appfilmes:auth-users";
const AUTH_SESSION_KEY = "appfilmes:auth-session";
const PROFILE_UNLOCK_KEY = "appfilmes:unlocked-profile";
const LOCAL_PROFILES_KEY = "appfilmes:profiles";
const PROFILE_LIMIT = 5;
const AUTH_API_BASE = (window.APPFILMES_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");
const MAX_UPLOAD_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 170_000;

let activeSession = null;
let activeProfile = null;
let profiles = [];
let editingProfileId = null;
let pendingPinProfile = null;
let profileImageDataUrl = null;
let removeProfileImage = false;

function usesRemoteAuth() {
  return Boolean(AUTH_API_BASE);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
}

function setProfileMessage(message, isError = false) {
  profileMessage.textContent = message;
  profileMessage.classList.toggle("is-error", isError);
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

function readUnlockedProfile(session = activeSession) {
  try {
    const unlocked = JSON.parse(sessionStorage.getItem(PROFILE_UNLOCK_KEY));
    return unlocked?.userId === session?.user?.id ? unlocked.profile : null;
  } catch {
    return null;
  }
}

function saveUnlockedProfile(profile) {
  sessionStorage.setItem(
    PROFILE_UNLOCK_KEY,
    JSON.stringify({
      userId: activeSession.user.id,
      profile,
      unlockedAt: new Date().toISOString(),
    }),
  );
}

function clearUnlockedProfile() {
  sessionStorage.removeItem(PROFILE_UNLOCK_KEY);
}

function dispatchAuthChange(session) {
  window.dispatchEvent(new CustomEvent("appfilmes:auth-change", { detail: { session } }));
}

function dispatchProfileChange(profile) {
  window.dispatchEvent(new CustomEvent("appfilmes:profile-change", { detail: { profile } }));
}

function showAuth() {
  activeSession = null;
  activeProfile = null;
  authScreen.hidden = false;
  profileScreen.hidden = true;
  appShell.hidden = true;
  document.body.classList.remove("is-authenticated", "is-profile-selecting");
  dispatchAuthChange(null);
  dispatchProfileChange(null);
}

async function showProfiles(session) {
  activeSession = session;
  activeProfile = null;
  authScreen.hidden = true;
  profileScreen.hidden = false;
  appShell.hidden = true;
  profileAccountName.textContent = session.user.name || session.user.email;
  document.body.classList.add("is-profile-selecting");
  document.body.classList.remove("is-authenticated");
  dispatchAuthChange(session);
  dispatchProfileChange(null);
  await loadProfiles();
}

function showApp(session, profile) {
  activeSession = session;
  activeProfile = profile;
  authScreen.hidden = true;
  profileScreen.hidden = true;
  appShell.hidden = false;
  sessionUserName.textContent = session.user.name || session.user.email;
  currentProfileName.textContent = profile.name;
  document.body.classList.add("is-authenticated");
  document.body.classList.remove("is-profile-selecting");
  dispatchAuthChange(session);
  dispatchProfileChange(profile);
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

function getLocalProfiles() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROFILES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLocalProfiles(value) {
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(value));
}

async function compressImageFile(file, maxSize = 420, quality = 0.78) {
  if (!file) {
    return null;
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem.");
  }

  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error("A imagem precisa ter no maximo 3 MB.");
  }

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = imageUrl;

  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }

  const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);

  let dataUrl = canvas.toDataURL("image/webp", quality);
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  }

  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error("A imagem ainda ficou grande. Tente uma foto menor.");
  }

  return dataUrl;
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

async function requestAuth(path, { payload, token, method } = {}) {
  let response;

  try {
    response = await fetch(`${AUTH_API_BASE}${path}`, {
      method: method || (payload ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch {
    throw new Error("Nao consegui conectar na API. Confira se o api-config.js esta publicado e se o Worker esta online.");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Nao foi possivel conectar a API.");
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
    return requestAuth("/api/auth/register", { payload: fields });
  }

  return registerLocal(fields);
}

async function loginUser(fields) {
  if (usesRemoteAuth()) {
    return requestAuth("/api/auth/login", { payload: fields });
  }

  return loginLocal(fields);
}

async function validateRemoteSession(session) {
  if (!usesRemoteAuth() || !session?.token) {
    return session;
  }

  try {
    const data = await requestAuth("/api/auth/me", { token: session.token });
    return { ...session, user: data.user || session.user };
  } catch {
    clearSession();
    return null;
  }
}

async function listProfiles() {
  if (usesRemoteAuth()) {
    return requestAuth("/api/profiles", { token: activeSession.token });
  }

  const allProfiles = getLocalProfiles();
  return {
    profiles: allProfiles[activeSession.user.id] || [],
    limit: PROFILE_LIMIT,
  };
}

async function createProfile({ name, pin, imageDataUrl }) {
  if (usesRemoteAuth()) {
    return requestAuth("/api/profiles", {
      token: activeSession.token,
      payload: { name, ...(pin ? { pin } : {}), ...(imageDataUrl ? { imageDataUrl } : {}) },
    });
  }

  const allProfiles = getLocalProfiles();
  const userProfiles = allProfiles[activeSession.user.id] || [];
  if (userProfiles.length >= PROFILE_LIMIT) {
    throw new Error("Cada usuario pode ter no maximo 5 telas.");
  }

  const now = new Date().toISOString();
  const profile = {
    id: crypto.randomUUID(),
    name,
    hasPin: Boolean(pin),
    pin,
    imageDataUrl: imageDataUrl || null,
    color: ["#35d3b4", "#22aee8", "#f7c66a", "#ff7f8f", "#9d7cff"][userProfiles.length % 5],
    createdAt: now,
    updatedAt: now,
  };
  allProfiles[activeSession.user.id] = [...userProfiles, profile];
  saveLocalProfiles(allProfiles);
  return { profile: sanitizeLocalProfile(profile) };
}

async function updateProfile(profileId, { name, pin, pinEnabled, imageDataUrl, removeImage }) {
  if (usesRemoteAuth()) {
    const payload = { name };
    if (pinEnabled === false) {
      payload.pin = "";
    } else if (pin) {
      payload.pin = pin;
    }
    if (removeImage) {
      payload.removeImage = true;
    } else if (imageDataUrl) {
      payload.imageDataUrl = imageDataUrl;
    }

    return requestAuth(`/api/profiles/${encodeURIComponent(profileId)}`, {
      token: activeSession.token,
      method: "PATCH",
      payload,
    });
  }

  const allProfiles = getLocalProfiles();
  const userProfiles = allProfiles[activeSession.user.id] || [];
  const nextProfiles = userProfiles.map((profile) => {
    if (profile.id !== profileId) {
      return profile;
    }

    return {
      ...profile,
      name,
      ...(pinEnabled === false ? { pin: "", hasPin: false } : {}),
      ...(pin ? { pin, hasPin: true } : {}),
      ...(removeImage ? { imageDataUrl: null } : {}),
      ...(imageDataUrl ? { imageDataUrl } : {}),
      updatedAt: new Date().toISOString(),
    };
  });
  allProfiles[activeSession.user.id] = nextProfiles;
  saveLocalProfiles(allProfiles);
  return { profile: sanitizeLocalProfile(nextProfiles.find((profile) => profile.id === profileId)) };
}

async function deleteProfile(profileId) {
  if (usesRemoteAuth()) {
    return requestAuth(`/api/profiles/${encodeURIComponent(profileId)}`, {
      token: activeSession.token,
      method: "DELETE",
    });
  }

  const allProfiles = getLocalProfiles();
  allProfiles[activeSession.user.id] = (allProfiles[activeSession.user.id] || []).filter(
    (profile) => profile.id !== profileId,
  );
  saveLocalProfiles(allProfiles);
  return { ok: true };
}

async function verifyProfilePin(profile, pin) {
  if (usesRemoteAuth()) {
    return requestAuth(`/api/profiles/${encodeURIComponent(profile.id)}/verify-pin`, {
      token: activeSession.token,
      payload: { pin },
    });
  }

  if (profile.pin && profile.pin !== pin) {
    throw new Error("PIN invalido.");
  }

  return { ok: true, profile: sanitizeLocalProfile(profile) };
}

function sanitizeLocalProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    name: profile.name,
    hasPin: Boolean(profile.hasPin),
    color: profile.color,
    imageDataUrl: profile.imageDataUrl || null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

async function loadProfiles() {
  setProfileMessage("Carregando telas...");

  try {
    const data = await listProfiles();
    profiles = data.profiles || [];
    renderProfiles(data.limit || PROFILE_LIMIT);
    setProfileMessage(profiles.length ? "" : "Crie sua primeira tela para entrar no player.");
  } catch (error) {
    setProfileMessage(error.message || "Nao foi possivel carregar as telas.", true);
  }
}

function renderProfiles(limit = PROFILE_LIMIT) {
  profileList.replaceChildren();

  profiles.forEach((profile) => {
    const card = document.createElement("article");
    card.className = "profile-card";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "profile-open";

    const avatar = createProfileAvatar(profile);
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const meta = document.createElement("span");
    meta.textContent = profile.hasPin ? "Protegida por PIN" : "Sem PIN";

    openButton.append(avatar, name, meta);
    openButton.addEventListener("click", () => selectProfile(profile));

    const actions = document.createElement("div");
    actions.className = "profile-card-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => openProfileModal(profile));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Apagar";
    deleteButton.addEventListener("click", () => removeProfile(profile));

    actions.append(editButton, deleteButton);
    card.append(openButton, actions);
    profileList.append(card);
  });

  addProfileButton.disabled = profiles.length >= limit;
  addProfileButton.textContent = profiles.length >= limit ? `Limite de ${limit} telas atingido` : `Adicionar tela (${profiles.length}/${limit})`;
}

function createProfileAvatar(profile) {
  const avatar = document.createElement("span");
  avatar.className = "profile-avatar";
  avatar.style.setProperty("--profile-color", profile.color || "#35d3b4");

  if (profile.imageDataUrl) {
    avatar.classList.add("has-image");
    const image = document.createElement("img");
    image.className = "profile-avatar-img";
    image.src = profile.imageDataUrl;
    image.alt = "";
    avatar.append(image);
    return avatar;
  }

  avatar.textContent = getInitials(profile.name);
  return avatar;
}

function getInitials(name) {
  return String(name || "AF")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function selectProfile(profile) {
  if (profile.hasPin) {
    pendingPinProfile = profile;
    pinModalTitle.textContent = profile.name;
    pinInput.value = "";
    pinMessage.textContent = "";
    pinModal.hidden = false;
    pinInput.focus();
    return;
  }

  unlockProfile(profile);
}

function unlockProfile(profile) {
  activeProfile = profile;
  saveUnlockedProfile(profile);
  showApp(activeSession, profile);
}

function renderProfileImagePreview(dataUrl, name = "") {
  profileImagePreview.replaceChildren();
  profileImagePreview.classList.toggle("has-image", Boolean(dataUrl));

  if (dataUrl) {
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = "";
    profileImagePreview.append(image);
    return;
  }

  profileImagePreview.textContent = getInitials(name || profileNameInput.value || "CH");
}

function syncProfilePinField() {
  const enabled = profilePinToggle.checked;
  profilePinWrap.hidden = !enabled;
  profilePinInput.disabled = !enabled;
  if (!enabled) {
    profilePinInput.value = "";
  }
}

function openProfileModal(profile = null) {
  editingProfileId = profile?.id || null;
  profileModalTitle.textContent = profile ? "Editar tela" : "Nova tela";
  profileNameInput.value = profile?.name || "";
  profileImageInput.value = "";
  profileImageDataUrl = profile?.imageDataUrl || null;
  removeProfileImage = false;
  renderProfileImagePreview(profileImageDataUrl, profile?.name || "");
  profilePinToggle.checked = Boolean(profile?.hasPin);
  syncProfilePinField();
  profilePinInput.value = "";
  profileFormMessage.textContent = profile?.hasPin
    ? "PIN ligado: deixe vazio para manter ou digite outro. Desmarque para remover."
    : "PIN desligado. Marque a opcao se quiser proteger esta tela.";
  profileFormMessage.classList.remove("is-error");
  profileModal.hidden = false;
  profileNameInput.focus();
}

function closeProfileModal() {
  editingProfileId = null;
  profileImageDataUrl = null;
  removeProfileImage = false;
  profileModal.hidden = true;
  profileForm.reset();
  syncProfilePinField();
  renderProfileImagePreview(null);
  profileFormMessage.textContent = "";
}

async function removeProfile(profile) {
  const confirmed = window.confirm(`Apagar a tela "${profile.name}"?`);
  if (!confirmed) {
    return;
  }

  try {
    await deleteProfile(profile.id);
    const unlocked = readUnlockedProfile();
    if (unlocked?.id === profile.id) {
      clearUnlockedProfile();
    }
    await loadProfiles();
  } catch (error) {
    setProfileMessage(error.message || "Nao foi possivel apagar a tela.", true);
  }
}

async function logout() {
  const session = readSession();

  if (usesRemoteAuth() && session?.token) {
    await requestAuth("/api/auth/logout", { payload: {}, token: session.token }).catch(() => {});
  }

  clearSession();
  clearUnlockedProfile();
  showAuth();
  switchAuthTab("login");
}

loginTab.addEventListener("click", () => switchAuthTab("login"));
signupTab.addEventListener("click", () => switchAuthTab("signup"));
addProfileButton.addEventListener("click", () => openProfileModal());
cancelProfileButton.addEventListener("click", closeProfileModal);
profilePinToggle.addEventListener("change", () => {
  syncProfilePinField();
  profileFormMessage.textContent = profilePinToggle.checked
    ? "Digite um PIN de 4 numeros para bloquear esta tela."
    : "PIN desligado para esta tela.";
  profileFormMessage.classList.remove("is-error");
});
profileNameInput.addEventListener("input", () => {
  if (!profileImageDataUrl) {
    renderProfileImagePreview(null, profileNameInput.value);
  }
});
profileImageInput.addEventListener("change", async () => {
  const file = profileImageInput.files?.[0];
  if (!file) {
    return;
  }

  profileFormMessage.textContent = "Preparando foto...";
  profileFormMessage.classList.remove("is-error");

  try {
    profileImageDataUrl = await compressImageFile(file, 360, 0.78);
    removeProfileImage = false;
    renderProfileImagePreview(profileImageDataUrl, profileNameInput.value);
    profileFormMessage.textContent = "Foto pronta para salvar.";
  } catch (error) {
    profileImageInput.value = "";
    profileFormMessage.textContent = error.message || "Nao foi possivel carregar a foto.";
    profileFormMessage.classList.add("is-error");
  }
});
removeProfileImageButton.addEventListener("click", () => {
  profileImageInput.value = "";
  profileImageDataUrl = null;
  removeProfileImage = true;
  renderProfileImagePreview(null, profileNameInput.value);
});
cancelPinButton.addEventListener("click", () => {
  pendingPinProfile = null;
  pinModal.hidden = true;
});
logoutButton.addEventListener("click", logout);
profileLogoutButton.addEventListener("click", logout);
switchProfileButton.addEventListener("click", () => {
  clearUnlockedProfile();
  showProfiles(activeSession);
});

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
    clearUnlockedProfile();
    await showProfiles(session);
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
    clearUnlockedProfile();
    await showProfiles(session);
  } catch (error) {
    setAuthMessage(error.message || "Nao foi possivel criar a conta.", true);
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileFormMessage.textContent = "Salvando...";
  profileFormMessage.classList.remove("is-error");

  const name = profileNameInput.value.trim();
  const pin = profilePinInput.value.trim();
  const pinEnabled = profilePinToggle.checked;
  const editingProfile = profiles.find((profile) => profile.id === editingProfileId);

  if (!name) {
    profileFormMessage.textContent = "Informe o nome da tela.";
    profileFormMessage.classList.add("is-error");
    return;
  }

  if (pinEnabled && !pin && !editingProfile?.hasPin) {
    profileFormMessage.textContent = "Digite um PIN de 4 numeros ou desmarque a opcao de PIN.";
    profileFormMessage.classList.add("is-error");
    return;
  }

  if (pinEnabled && pin && !/^\d{4}$/.test(pin)) {
    profileFormMessage.textContent = "O PIN deve ter 4 numeros.";
    profileFormMessage.classList.add("is-error");
    return;
  }

  try {
    if (editingProfileId) {
      await updateProfile(editingProfileId, {
        name,
        pin,
        pinEnabled,
        imageDataUrl: profileImageDataUrl,
        removeImage: removeProfileImage,
      });
    } else {
      await createProfile({
        name,
        pin: pinEnabled ? pin : "",
        imageDataUrl: profileImageDataUrl,
      });
    }

    closeProfileModal();
    await loadProfiles();
  } catch (error) {
    profileFormMessage.textContent = error.message || "Nao foi possivel salvar a tela.";
    profileFormMessage.classList.add("is-error");
  }
});

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  pinMessage.textContent = "Verificando...";
  pinMessage.classList.remove("is-error");

  try {
    const data = await verifyProfilePin(pendingPinProfile, pinInput.value.trim());
    const profile = data.profile || pendingPinProfile;
    pendingPinProfile = null;
    pinModal.hidden = true;
    unlockProfile(profile);
  } catch (error) {
    pinMessage.textContent = error.message || "PIN invalido.";
    pinMessage.classList.add("is-error");
  }
});

window.AppFilmesAuth = {
  getSession: readSession,
  getProfile: () => activeProfile || readUnlockedProfile(),
  getToken: () => readSession()?.token || null,
  request: requestAuth,
  compressImageFile,
  usesRemoteAuth,
};

validateRemoteSession(readSession()).then(async (session) => {
  if (!session?.user) {
    showAuth();
    return;
  }

  saveSession(session);
  activeSession = session;

  const unlockedProfile = readUnlockedProfile(session);
  if (unlockedProfile) {
    showApp(session, unlockedProfile);
    return;
  }

  await showProfiles(session);
});
