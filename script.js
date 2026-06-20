const form = document.querySelector("#linkForm");
const input = document.querySelector("#videoUrl");
const video = document.querySelector("#videoPlayer");
const iframe = document.querySelector("#embedPlayer");
const stage = document.querySelector(".video-stage");
const modeBadge = document.querySelector("#modeBadge");
const statusText = document.querySelector("#statusText");
const pasteButton = document.querySelector("#pasteButton");
const clearButton = document.querySelector("#clearButton");
const clearRecentButton = document.querySelector("#clearRecentButton");
const recentList = document.querySelector("#recentList");
const autoPlay = document.querySelector("#autoPlay");
const preferEmbed = document.querySelector("#preferEmbed");
const playerMode = document.querySelector("#playerMode");
const mediaForm = document.querySelector("#mediaForm");
const mediaTitleInput = document.querySelector("#mediaTitleInput");
const mediaCategoryInput = document.querySelector("#mediaCategoryInput");
const mediaUrlInput = document.querySelector("#mediaUrlInput");
const mediaPosterInput = document.querySelector("#mediaPosterInput");
const mediaMessage = document.querySelector("#mediaMessage");
const mediaShelves = document.querySelector("#mediaShelves");
const libraryProfileName = document.querySelector("#libraryProfileName");

const RECENT_KEY = "appfilmes:recent-links";
const MEDIA_LIBRARY_KEY = "appfilmes:media-library";
const DIRECT_VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "ogg",
  "ogv",
  "mov",
  "m4v",
  "3gp",
  "avi",
  "mkv",
  "flv",
  "ts",
];
const TORRENT_VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "mkv", "mov", "ogv", "ogg"];
const WEBTORRENT_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
];
const MEDIA_CATEGORIES = [
  { id: "filmes", label: "Filmes" },
  { id: "series", label: "Series" },
  { id: "animes", label: "Animes" },
  { id: "outros", label: "Outros" },
];

let hlsInstance = null;
let dashInstance = null;
let torrentClient = null;
let activeTorrent = null;
let mediaItems = [];

function getRecentStorageKey() {
  const session = window.AppFilmesAuth?.getSession?.();
  const profile = window.AppFilmesAuth?.getProfile?.();
  const userId = session?.user?.id || "guest";
  const profileId = profile?.id || "default";
  return `${RECENT_KEY}:${userId}:${profileId}`;
}

function getMediaStorageKey() {
  const session = window.AppFilmesAuth?.getSession?.();
  const profile = window.AppFilmesAuth?.getProfile?.();
  const userId = session?.user?.id || "guest";
  const profileId = profile?.id || "default";
  return `${MEDIA_LIBRARY_KEY}:${userId}:${profileId}`;
}

function getActiveProfile() {
  return window.AppFilmesAuth?.getProfile?.() || null;
}

function setStatus(mode, message, isError = false) {
  modeBadge.textContent = mode;
  statusText.textContent = message;
  document.body.classList.toggle("is-error", isError);
}

function resetPlayers() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  if (dashInstance) {
    dashInstance.reset();
    dashInstance = null;
  }

  destroyTorrent();
  video.pause();
  video.removeAttribute("src");
  video.load();
  iframe.removeAttribute("src");
  stage.className = "video-stage";
}

function normalizeUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Cole um link primeiro.");
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Use links http ou https.");
  }

  return parsed;
}

function isMagnetLink(value) {
  return /^magnet:/i.test(value.trim());
}

function isTorrentUrl(url) {
  return getExtension(url) === "torrent";
}

function enhanceMagnetTrackers(magnetLink) {
  const hasWebRtcTracker = WEBTORRENT_TRACKERS.some((tracker) =>
    magnetLink.toLowerCase().includes(encodeURIComponent(tracker).toLowerCase()) ||
    magnetLink.toLowerCase().includes(tracker.toLowerCase()),
  );

  if (hasWebRtcTracker) {
    return magnetLink;
  }

  const separator = magnetLink.includes("?") ? "&" : "?";
  const announce = WEBTORRENT_TRACKERS.map((tracker) => `tr=${encodeURIComponent(tracker)}`).join("&");
  return `${magnetLink}${separator}${announce}`;
}

function getExtension(url) {
  const cleanPath = url.pathname.toLowerCase();
  const filename = cleanPath.split("/").pop() || "";
  return filename.includes(".") ? filename.split(".").pop() : "";
}

function loadScriptOnce(src, globalName) {
  if (window[globalName]) {
    return Promise.resolve(window[globalName]);
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-loader="${globalName}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window[globalName]));
      existing.addEventListener("error", () => reject(new Error(`Nao foi possivel carregar ${globalName}.`)));
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.loader = globalName;
    script.onload = () => resolve(window[globalName]);
    script.onerror = () => reject(new Error(`Nao foi possivel carregar ${globalName}.`));
    document.head.append(script);
  });
}

async function playWhenReady() {
  if (!autoPlay.checked) {
    return;
  }

  try {
    await video.play();
  } catch {
    setStatus(modeBadge.textContent, "Video carregado. Aperte play para iniciar.");
  }
}

function destroyTorrent() {
  activeTorrent = null;

  if (torrentClient) {
    torrentClient.destroy();
    torrentClient = null;
  }
}

function showVideo() {
  stage.classList.add("is-video");
  stage.classList.remove("is-embed");
}

function showEmbed() {
  stage.classList.add("is-embed");
  stage.classList.remove("is-video");
}

async function loadDirectVideo(url) {
  resetPlayers();
  showVideo();
  video.src = url.href;
  setStatus("Video direto", "Carregando arquivo no player do navegador...");
  await playWhenReady();
}

async function loadHls(url) {
  resetPlayers();
  showVideo();
  setStatus("HLS", "Preparando stream .m3u8...");

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url.href;
    await playWhenReady();
    return;
  }

  const Hls = await loadScriptOnce("https://cdn.jsdelivr.net/npm/hls.js@latest", "Hls");
  if (!Hls?.isSupported()) {
    throw new Error("Este navegador nao suporta HLS por MediaSource.");
  }

  hlsInstance = new Hls({ enableWorker: true });
  hlsInstance.loadSource(url.href);
  hlsInstance.attachMedia(video);
  hlsInstance.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) {
      setStatus("HLS bloqueado", "O stream falhou. Pode ser CORS, token expirado ou codec nao suportado.", true);
    }
  });
  await playWhenReady();
}

async function loadDash(url) {
  resetPlayers();
  showVideo();
  setStatus("DASH", "Preparando stream .mpd...");

  const dashjs = await loadScriptOnce("https://cdn.dashjs.org/latest/dash.all.min.js", "dashjs");
  dashInstance = dashjs.MediaPlayer().create();
  dashInstance.initialize(video, url.href, autoPlay.checked);
}

function getVideoTorrentFile(torrent) {
  return torrent.files
    .filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      return TORRENT_VIDEO_EXTENSIONS.includes(extension);
    })
    .sort((a, b) => b.length - a.length)[0];
}

async function loadTorrentVideo(torrentId) {
  resetPlayers();
  showVideo();

  if (!window.WebTorrent) {
    throw new Error("WebTorrent nao carregou. Verifique a conexao com o CDN jsDelivr.");
  }

  torrentClient = new WebTorrent();
  const safeTorrentId = isMagnetLink(torrentId) ? enhanceMagnetTrackers(torrentId) : torrentId;
  setStatus("Torrent", "Conectando aos peers WebRTC e lendo arquivos do torrent...");

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Nao encontrei peers WebTorrent. Magnets com apenas trackers UDP/classicos nao tocam direto no navegador."));
    }, 45000);

    torrentClient.on("error", reject);
    activeTorrent = torrentClient.add(safeTorrentId, { announce: WEBTORRENT_TRACKERS }, (torrent) => {
      window.clearTimeout(timeoutId);

      const file = getVideoTorrentFile(torrent);
      if (!file) {
        reject(new Error("O torrent nao tem arquivo de video compativel (.mp4, .webm, .mkv, .mov, .ogv)."));
        return;
      }

      setStatus("Torrent", `Carregando ${file.name}...`);
      file.renderTo(video, { autoplay: autoPlay.checked, controls: true }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        setStatus("Torrent", "Reproduzindo via WebTorrent. A velocidade depende dos peers disponiveis.");
        resolve();
      });
    });
  });
}

async function reproduzirMidia(urlOuMagnet) {
  const rawValue = urlOuMagnet.trim();

  if (isMagnetLink(rawValue)) {
    await loadTorrentVideo(rawValue);
    addRecent({ href: rawValue, hostname: "magnet" }, "Torrent");
    return;
  }

  const url = normalizeUrl(rawValue);
  const extension = getExtension(url);
  const forcedMode = playerMode.value;

  if (forcedMode === "torrent") {
    await loadTorrentVideo(url.href);
    addRecent(url, "Torrent");
    return;
  }

  if (forcedMode === "direct") {
    await loadDirectVideo(url);
    addRecent(url, "Direto");
    return;
  }

  if (forcedMode === "hls") {
    await loadHls(url);
    addRecent(url, "HLS");
    return;
  }

  if (forcedMode === "dash") {
    await loadDash(url);
    addRecent(url, "DASH");
    return;
  }

  if (forcedMode === "embed") {
    loadEmbed(url);
    addRecent(url, "Embed");
    return;
  }

  if (extension === "m3u8") {
    await loadHls(url);
    addRecent(url, "HLS");
    return;
  }

  if (extension === "mpd") {
    await loadDash(url);
    addRecent(url, "DASH");
    return;
  }

  if (isTorrentUrl(url)) {
    await loadTorrentVideo(url.href);
    addRecent(url, "Torrent");
    return;
  }

  if (DIRECT_VIDEO_EXTENSIONS.includes(extension)) {
    await loadDirectVideo(url);
    addRecent(url, "Direto");
    return;
  }

  loadEmbed(url);
  addRecent(url, "Embed");
}

function getYouTubeId(url) {
  if (url.hostname.includes("youtu.be")) {
    return url.pathname.split("/").filter(Boolean)[0];
  }

  if (url.hostname.includes("youtube.com")) {
    if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/").filter(Boolean)[1];
    }
    return url.searchParams.get("v");
  }

  return null;
}

function getVimeoId(url) {
  if (!url.hostname.includes("vimeo.com")) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  return parts.find((part) => /^\d+$/.test(part)) || null;
}

function getDailymotionId(url) {
  if (!url.hostname.includes("dailymotion.com") && !url.hostname.includes("dai.ly")) {
    return null;
  }

  if (url.hostname.includes("dai.ly")) {
    return url.pathname.split("/").filter(Boolean)[0];
  }

  const match = url.pathname.match(/\/video\/([^_/]+)/);
  return match?.[1] || null;
}

function getPornhubEmbedUrl(url) {
  const host = url.hostname.toLowerCase();
  const isPornhub = host === "pornhub.com" || host.endsWith(".pornhub.com");

  if (!isPornhub) {
    return null;
  }

  if (url.pathname.startsWith("/embed/")) {
    return url.href;
  }

  const viewKey = url.searchParams.get("viewkey");
  if (!viewKey) {
    return null;
  }

  return `https://www.pornhub.com/embed/${encodeURIComponent(viewKey)}`;
}

function getXvideosEmbedUrl(url) {
  const host = url.hostname.toLowerCase();
  const isXvideos = host === "xvideos.com" || host.endsWith(".xvideos.com");

  if (!isXvideos) {
    return null;
  }

  if (url.pathname.startsWith("/embedframe/")) {
    return url.href;
  }

  const modernMatch = url.pathname.match(/^\/video\.([a-z0-9]+)/i);
  const oldMatch = url.pathname.match(/^\/video(\d+)/i);
  const videoId = modernMatch?.[1] || oldMatch?.[1];

  if (!videoId) {
    return null;
  }

  return `https://www.xvideos.com/embedframe/${encodeURIComponent(videoId)}`;
}

function getXhamsterEmbedUrl(url) {
  const host = url.hostname.toLowerCase();
  const isXhamster = host.includes("xhamster");

  if (!isXhamster) {
    return null;
  }

  if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/xembed.php")) {
    return url.href;
  }

  const explicitVideoId =
    url.searchParams.get("video") ||
    url.searchParams.get("id") ||
    url.searchParams.get("video_id");

  if (explicitVideoId) {
    return `https://xhamster.com/xembed.php?video=${encodeURIComponent(explicitVideoId)}`;
  }

  const lastPathPart = url.pathname.split("/").filter(Boolean).pop() || "";
  const slugMatch = lastPathPart.match(/(?:^|-)(xh[a-z0-9]+|\d{4,})$/i);
  const videoId = slugMatch?.[1];

  if (!videoId) {
    return null;
  }

  return `https://xhamster.com/xembed.php?video=${encodeURIComponent(videoId)}`;
}

function getEmbedUrl(url) {
  const youtubeId = getYouTubeId(url);
  if (youtubeId) {
    return {
      src: `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=${autoPlay.checked ? "1" : "0"}&rel=0`,
      official: true,
    };
  }

  const vimeoId = getVimeoId(url);
  if (vimeoId) {
    return {
      src: `https://player.vimeo.com/video/${encodeURIComponent(vimeoId)}?autoplay=${autoPlay.checked ? "1" : "0"}`,
      official: true,
    };
  }

  const dailymotionId = getDailymotionId(url);
  if (dailymotionId) {
    return {
      src: `https://www.dailymotion.com/embed/video/${encodeURIComponent(dailymotionId)}?autoplay=${autoPlay.checked ? "1" : "0"}`,
      official: true,
    };
  }

  const xvideosEmbedUrl = getXvideosEmbedUrl(url);
  if (xvideosEmbedUrl) {
    return {
      src: xvideosEmbedUrl,
      official: true,
    };
  }

  const xhamsterEmbedUrl = getXhamsterEmbedUrl(url);
  if (xhamsterEmbedUrl) {
    return {
      src: xhamsterEmbedUrl,
      official: true,
    };
  }

  const pornhubEmbedUrl = getPornhubEmbedUrl(url);
  if (pornhubEmbedUrl) {
    return {
      src: pornhubEmbedUrl,
      official: true,
    };
  }

  return preferEmbed.checked
    ? {
        src: url.href,
        official: false,
      }
    : null;
}

function loadEmbed(url) {
  const embed = getEmbedUrl(url);
  if (!embed) {
    throw new Error("Esse link nao parece ser um arquivo de video direto.");
  }

  resetPlayers();
  showEmbed();
  iframe.src = embed.src;

  if (embed.official) {
    setStatus("Embed", "Carregando pelo embed oficial com saidas externas bloqueadas.");
    return;
  }

  setStatus("Iframe", "Tentando abrir a pagina dentro do site. Se aparecer bloqueio, o servidor nao permite iframe.");
}

function addRecent(url, type) {
  const stored = getRecent();
  const next = [
    { url: url.href, host: url.hostname, type, addedAt: Date.now() },
    ...stored.filter((item) => item.url !== url.href),
  ].slice(0, 8);

  localStorage.setItem(getRecentStorageKey(), JSON.stringify(next));
  renderRecent();
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(getRecentStorageKey())) || [];
  } catch {
    return [];
  }
}

function renderRecent() {
  const items = getRecent();
  recentList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Nenhum link carregado ainda.";
    recentList.append(empty);
    return;
  }

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.title = item.url;

    const title = document.createElement("strong");
    title.textContent = item.host || "Video";

    const meta = document.createElement("span");
    meta.textContent = `${item.type} - ${item.url}`;

    button.append(title, meta);
    button.addEventListener("click", () => {
      input.value = item.url;
      handleLoad(item.url);
    });
    recentList.append(button);
  });
}

function setMediaMessage(message, isError = false) {
  if (!mediaMessage) {
    return;
  }

  mediaMessage.textContent = message;
  mediaMessage.classList.toggle("is-error", isError);
}

function getLocalMedia() {
  try {
    return JSON.parse(localStorage.getItem(getMediaStorageKey())) || [];
  } catch {
    return [];
  }
}

function saveLocalMedia(items) {
  localStorage.setItem(getMediaStorageKey(), JSON.stringify(items));
}

async function listMediaItems() {
  const profile = getActiveProfile();
  if (!profile) {
    return [];
  }

  if (window.AppFilmesAuth?.usesRemoteAuth?.()) {
    const data = await window.AppFilmesAuth.request(`/api/media?profileId=${encodeURIComponent(profile.id)}`, {
      token: window.AppFilmesAuth.getToken(),
    });
    return data.media || [];
  }

  return getLocalMedia();
}

async function createMediaItem(fields) {
  if (window.AppFilmesAuth?.usesRemoteAuth?.()) {
    const data = await window.AppFilmesAuth.request("/api/media", {
      token: window.AppFilmesAuth.getToken(),
      payload: fields,
    });
    return data.media;
  }

  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    ...fields,
    createdAt: now,
    updatedAt: now,
  };
  const next = [item, ...getLocalMedia()];
  saveLocalMedia(next);
  return item;
}

async function removeMediaItem(id) {
  if (window.AppFilmesAuth?.usesRemoteAuth?.()) {
    await window.AppFilmesAuth.request(`/api/media/${encodeURIComponent(id)}`, {
      token: window.AppFilmesAuth.getToken(),
      method: "DELETE",
    });
    return;
  }

  saveLocalMedia(getLocalMedia().filter((item) => item.id !== id));
}

function categoryLabel(categoryId) {
  return MEDIA_CATEGORIES.find((category) => category.id === categoryId)?.label || "Outros";
}

function createPosterElement(item) {
  const poster = document.createElement("button");
  poster.type = "button";
  poster.className = "media-card-poster";
  poster.title = `Assistir ${item.title}`;

  if (item.posterDataUrl) {
    const image = document.createElement("img");
    image.src = item.posterDataUrl;
    image.alt = "";
    poster.append(image);
  } else {
    const logo = document.createElement("img");
    logo.className = "media-card-logo";
    logo.src = "assets/logo-cinehub.png";
    logo.alt = "";
    poster.append(logo);
  }

  poster.addEventListener("click", () => playMediaItem(item));
  return poster;
}

function renderMediaLibrary() {
  if (!mediaShelves) {
    return;
  }

  const profile = getActiveProfile();
  libraryProfileName.textContent = profile ? profile.name : "Escolha uma tela";
  mediaShelves.replaceChildren();

  if (!profile) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Escolha uma tela para montar sua biblioteca.";
    mediaShelves.append(empty);
    return;
  }

  if (!mediaItems.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Nenhum filme ou serie adicionado nesta tela.";
    mediaShelves.append(empty);
    return;
  }

  MEDIA_CATEGORIES.forEach((category) => {
    const items = mediaItems.filter((item) => item.category === category.id);
    if (!items.length) {
      return;
    }

    const shelf = document.createElement("section");
    shelf.className = "media-shelf";

    const title = document.createElement("h3");
    title.textContent = category.label;

    const row = document.createElement("div");
    row.className = "media-row";

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "media-card";

      const poster = createPosterElement(item);
      const body = document.createElement("div");
      body.className = "media-card-body";

      const itemTitle = document.createElement("strong");
      itemTitle.textContent = item.title;

      const itemMeta = document.createElement("span");
      itemMeta.textContent = categoryLabel(item.category);

      const actions = document.createElement("div");
      actions.className = "media-card-actions";

      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.textContent = "Assistir";
      playButton.addEventListener("click", () => playMediaItem(item));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Apagar";
      deleteButton.addEventListener("click", async () => {
        const confirmed = window.confirm(`Apagar "${item.title}" da biblioteca?`);
        if (!confirmed) {
          return;
        }

        try {
          await removeMediaItem(item.id);
          await loadMediaLibrary();
        } catch (error) {
          setMediaMessage(error.message || "Nao foi possivel apagar.", true);
        }
      });

      actions.append(playButton, deleteButton);
      body.append(itemTitle, itemMeta, actions);
      card.append(poster, body);
      row.append(card);
    });

    shelf.append(title, row);
    mediaShelves.append(shelf);
  });
}

async function loadMediaLibrary() {
  const profile = getActiveProfile();
  mediaItems = [];

  if (!profile) {
    renderMediaLibrary();
    return;
  }

  setMediaMessage("Carregando biblioteca...");

  try {
    mediaItems = await listMediaItems();
    renderMediaLibrary();
    setMediaMessage("");
  } catch (error) {
    renderMediaLibrary();
    setMediaMessage(error.message || "Nao foi possivel carregar a biblioteca.", true);
  }
}

function playMediaItem(item) {
  input.value = item.url;
  setMediaMessage(`Abrindo ${item.title}...`);
  handleLoad(item.url);
}

async function handleLoad(rawUrl) {
  try {
    await reproduzirMidia(rawUrl);
  } catch (error) {
    resetPlayers();
    setStatus("Nao abriu", error.message || "Nao foi possivel carregar esse link.", true);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleLoad(input.value);
});

mediaForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const profile = getActiveProfile();
  if (!profile) {
    setMediaMessage("Escolha uma tela antes de adicionar filmes ou series.", true);
    return;
  }

  const title = mediaTitleInput.value.trim();
  const url = mediaUrlInput.value.trim();

  if (!title || !url) {
    setMediaMessage("Informe nome e link.", true);
    return;
  }

  setMediaMessage("Salvando na biblioteca...");

  try {
    const posterFile = mediaPosterInput.files?.[0] || null;
    const posterDataUrl = posterFile
      ? await window.AppFilmesAuth.compressImageFile(posterFile, 520, 0.76)
      : null;

    await createMediaItem({
      profileId: profile.id,
      title,
      category: mediaCategoryInput.value,
      url,
      ...(posterDataUrl ? { posterDataUrl } : {}),
    });

    mediaForm.reset();
    await loadMediaLibrary();
    setMediaMessage("Item adicionado.");
  } catch (error) {
    setMediaMessage(error.message || "Nao foi possivel adicionar esse item.", true);
  }
});

pasteButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    input.value = text.trim();
    input.focus();
  } catch {
    setStatus("Clipboard", "Nao consegui acessar a area de transferencia.", true);
  }
});

clearButton.addEventListener("click", () => {
  input.value = "";
  resetPlayers();
  setStatus("Aguardando link", "Pronto para videos diretos, HLS, DASH, embeds, magnet e .torrent.");
  input.focus();
});

clearRecentButton.addEventListener("click", () => {
  localStorage.removeItem(getRecentStorageKey());
  renderRecent();
});

video.addEventListener("error", () => {
  setStatus("Erro no video", "O navegador nao conseguiu tocar esse arquivo. Pode ser codec, CORS, hotlink ou DRM.", true);
});

window.addEventListener("appfilmes:auth-change", (event) => {
  renderRecent();

  if (!event.detail.session) {
    resetPlayers();
    setStatus("Aguardando link", "Entre na sua conta para carregar videos.");
    loadMediaLibrary();
  }
});

window.addEventListener("appfilmes:profile-change", (event) => {
  renderRecent();
  loadMediaLibrary();

  if (!event.detail.profile) {
    resetPlayers();
    setStatus("Aguardando tela", "Escolha uma tela para carregar videos.");
  }
});

renderRecent();
loadMediaLibrary();

window.reproduzirMidia = reproduzirMidia;
