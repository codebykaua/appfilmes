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

const RECENT_KEY = "appfilmes:recent-links";
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

let hlsInstance = null;
let dashInstance = null;
let torrentClient = null;
let activeTorrent = null;

function getRecentStorageKey() {
  const session = window.AppFilmesAuth?.getSession?.();
  const profile = window.AppFilmesAuth?.getProfile?.();
  const userId = session?.user?.id || "guest";
  const profileId = profile?.id || "default";
  return `${RECENT_KEY}:${userId}:${profileId}`;
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

async function loadTorrentVideo(magnetLink) {
  resetPlayers();
  showVideo();

  if (!window.WebTorrent) {
    throw new Error("WebTorrent nao carregou. Verifique a conexao com o CDN jsDelivr.");
  }

  torrentClient = new WebTorrent();
  setStatus("Torrent", "Conectando aos peers via WebTorrent...");

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Nao encontrei peers WebTorrent a tempo. Esse magnet pode nao ter tracker WebRTC ativo."));
    }, 45000);

    torrentClient.on("error", reject);
    activeTorrent = torrentClient.add(magnetLink, (torrent) => {
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
  setStatus("Aguardando link", "Pronto para carregar videos diretos, HLS, DASH e embeds permitidos.");
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
  }
});

window.addEventListener("appfilmes:profile-change", (event) => {
  renderRecent();

  if (!event.detail.profile) {
    resetPlayers();
    setStatus("Aguardando tela", "Escolha uma tela para carregar videos.");
  }
});

renderRecent();

window.reproduzirMidia = reproduzirMidia;
