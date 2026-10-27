// Wspólny skrypt situus.pl. Cała treść strony jest w HTML-u i działa bez niego;
// skrypt dokłada stan serwera, zegar, dostęp do czatu i statystyki odwiedzin.

const CHAT_URL = 'https://chat.situus.pl';
const LOG_URL = 'https://log.situus.pl';

// Podgląd z dysku albo z localhosta nie wysyła statystyk do log.situus.pl.
const IS_LOCAL = location.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);


// --- Czat ---

let chatAuthorized = false;

async function checkChatAccess() {
    try {
        // credentials: 'include' wysyła ciasteczko sesji. Po ręcznym wylogowaniu
        // serwer widzi je i nie loguje automatycznie, nawet z zaufanego IP.
        const res = await fetch(`${CHAT_URL}/api/check_access`, { credentials: 'include' });
        const data = await res.json();
        if (data.authorized) {
            chatAuthorized = true;
            unlockChat();
        }
    } catch (e) {
        console.log('Auth check failed:', e);
    }
}

// Po autoryzacji elementy z data-unlocked-text dostają nowy tekst,
// a elementy z data-admin-only przestają być ukryte.
function unlockChat(root = document) {
    document.documentElement.classList.add('chat-unlocked');
    root.querySelectorAll('[data-unlocked-text]').forEach(el => {
        el.textContent = el.dataset.unlockedText;
    });
    root.querySelectorAll('[data-admin-only]').forEach(el => {
        el.hidden = false;
    });
}

// Link do czatu to zwykły link do chat.situus.pl. Bez dostępu zamiast
// przejścia otwiera się okno z wyjaśnieniem. Nasłuch jest na całym dokumencie,
// bo tryby strony dokładają linki do czatu już po załadowaniu.
function setupChatLinks() {
    const dialog = document.getElementById('chat-dialog');
    if (!dialog) return;

    document.addEventListener('click', e => {
        const link = e.target.closest('[data-chat-link]');
        if (!link || chatAuthorized) return;
        e.preventDefault();
        dialog.showModal();
        sendEvent('click', { target: 'Situus Chat (zablokowany - okno)' });
    });

    // Okno nie ma własnego paddingu, więc klik trafiający w sam <dialog> to klik w tło.
    dialog.addEventListener('click', e => {
        if (e.target === dialog) dialog.close();
    });
}


// --- Stan serwera ---

let serverState = null;

// check_access jest lekki, więc służy też jako ping.
async function checkServer() {
    if (!document.querySelector('[data-server-status], [data-server-ping], [data-server-box]')) return;

    const start = performance.now();
    serverState = { state: 'online', ping: '' };
    try {
        await fetch(`${CHAT_URL}/api/check_access`, { method: 'GET' });
        serverState.ping = `${Math.round(performance.now() - start)} ms`;
    } catch (e) {
        serverState.state = 'offline';
    }
    document.documentElement.dataset.server = serverState.state;
    applyServerState();
}

// Wpisuje ostatni wynik do elementów stanu. Tryby strony wołają to dla elementów,
// które zbudowały później.
function applyServerState(root = document) {
    if (!serverState) return;
    const { state, ping } = serverState;
    root.querySelectorAll('[data-server-status]').forEach(el => {
        el.textContent = el.dataset[state] || state;
    });
    root.querySelectorAll('[data-server-ping]').forEach(el => {
        el.textContent = ping || el.dataset.empty || '–';
    });
    // Bloki ze stanem są ukryte w HTML-u, żeby bez JS nie wisiało w nich „sprawdzam…”.
    root.querySelectorAll('[data-server-box]').forEach(el => {
        el.hidden = false;
    });
}

// Dla trybów strony: aktualny dostęp do czatu i odświeżenie nowych elementów.
// deviceExtra.collect() zwraca rozszerzone dane urządzenia (do sprawdzenia na localhoście).
window.situus = {
    chatUrl: CHAT_URL,
    collectExtra: () => deviceExtra.collect(),
    isChatAuthorized: () => chatAuthorized,
    applyState(root) {
        applyServerState(root);
        if (chatAuthorized) unlockChat(root);
    }
};


// --- Drobiazgi interfejsu ---

// data-clock pokazuje godzinę z sekundami, data-clock-short bez nich.
// Elementy są szukane co sekundę, bo tryby strony dodają własne zegary.
function startClock() {
    const tick = () => {
        const now = new Date();
        const long = now.toLocaleTimeString('pl-PL', { hour12: false });
        const short = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        document.querySelectorAll('[data-clock]').forEach(el => { el.textContent = long; });
        document.querySelectorAll('[data-clock-short]').forEach(el => { el.textContent = short; });
    };
    tick();
    setInterval(tick, 1000);
}

function fillDates() {
    const format = new Intl.DateTimeFormat('pl-PL', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    document.querySelectorAll('[data-today]').forEach(el => {
        el.textContent = format.format(new Date());
    });
}

function setupDismiss() {
    document.querySelectorAll('[data-dismiss]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.closest('[data-dismissible]');
            if (target) target.remove();
        });
    });
}


// --- Statystyki odwiedzin (log.situus.pl) ---

const pageStart = Date.now();
const visitId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `visit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

// Stały identyfikator przeglądarki i licznik wizyt – pozwala rozpoznać tę samą osobę,
// nawet gdy przełączy się z domowego Wi-Fi na dane komórkowe (inne IP).
function getVisitorSession() {
    let visitorId = null;
    let visitNumber = 1;
    try {
        visitorId = localStorage.getItem('situus_vid');
        if (!visitorId) {
            visitorId = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID().slice(0, 8)
                : Math.random().toString(36).slice(2, 10);
            localStorage.setItem('situus_vid', visitorId);
        }
        const prevCount = parseInt(localStorage.getItem('situus_vcnt') || '0', 10) || 0;
        if (!sessionStorage.getItem('situus_vses')) {
            visitNumber = prevCount + 1;
            localStorage.setItem('situus_vcnt', String(visitNumber));
            sessionStorage.setItem('situus_vses', '1');
        } else {
            visitNumber = Math.max(1, prevCount);
        }
    } catch (e) {}
    return { visitorId, visitNumber };
}

const { visitorId, visitNumber } = getVisitorSession();

function currentViewName() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (location.pathname.endsWith('praca_naukowa_2.html')) {
        return h ? `praca_naukowa_2.html#${h}` : 'praca_naukowa_2.html';
    }
    return h || 'start';
}

function currentPagePath() {
    const h = location.hash;
    return h && h !== '#' && h !== '#start' ? `${location.pathname}${h}` : location.pathname;
}

// text/plain omija CORS preflight (OPTIONS), dzięki czemu przeglądarka wysyła
// tylko jedno zapytanie POST zamiast dwóch, a logi nie śmiecą się wpisami OPTIONS.
function postAnalytics(payload, useBeacon = false) {
    if (IS_LOCAL) return;
    const body = JSON.stringify(payload);
    const url = `${LOG_URL}/api/analytics`;

    if (useBeacon && navigator.sendBeacon) {
        try {
            if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) {
                return;
            }
        } catch (e) {}
    }
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: useBeacon
    }).catch(() => {});
}

function sendEvent(eventType, extra = {}, useBeacon = false) {
    postAnalytics({
        event_type: eventType,
        ts: Date.now(),
        page: currentPagePath(),
        visit_id: visitId,
        visitor_id: visitorId,
        visit_number: visitNumber,
        ...extra
    }, useBeacon);
}


// --- Śledzenie rzeczywistego czasu aktywności, przewijania i nawigacji ---

let activeTimeMs = 0;
let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
let lastSentActiveMs = 0;
let maxScrollPct = 0;
const viewsVisited = [currentViewName()];
const tracksPlayed = [];

function getActiveTimeMs() {
    const currentChunk = visibleSince !== null ? (Date.now() - visibleSince) : 0;
    return activeTimeMs + Math.max(0, currentChunk);
}

function updateScrollDepth() {
    const doc = document.documentElement;
    const scrollable = Math.max(0, doc.scrollHeight - window.innerHeight);
    if (scrollable <= 0) return;
    const pct = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
    if (pct > maxScrollPct) maxScrollPct = pct;
}

function sendTimeOnPage(reason) {
    updateScrollDepth();
    const activeMs = getActiveTimeMs();
    // Wysyłamy przy pierwszym wyjściu albo gdy użytkownik wrócił do karty i spędził kolejne >= 3 s.
    if (lastSentActiveMs > 0 && (activeMs - lastSentActiveMs) < 3000 && reason !== 'pagehide') {
        return;
    }
    lastSentActiveMs = activeMs;
    sendEvent('login_time', {
        time_on_page_ms: Date.now() - pageStart,
        active_time_ms: activeMs,
        views_visited: viewsVisited,
        tracks_played: tracksPlayed.length ? tracksPlayed : undefined,
        max_scroll_pct: maxScrollPct,
        interaction: deviceExtra.snapshot(),
        reason
    }, true);
}


// --- Detekcja otwartego DevTools (bez fałszywych alarmów na telefonach i przy skalowaniu DPI) ---

const CONSOLE_THRESHOLD = 160;
const consoleCheckStart = Date.now();
let consoleDocked = false;
let consoleGreetingShown = false;
let baselineWidthDelta = null;
let baselineHeightDelta = null;

function showConsoleGreeting() {
    if (consoleGreetingShown) return;
    consoleGreetingShown = true;
    setTimeout(() => console.log('%c Witaj', 'color:#00ff41; font-weight:bold; font-size:16px;'), 1000);
    setTimeout(() => console.log('A jednak sprawdziłeś?'), 4000);
    setTimeout(() => console.log('Ciekawe...'), 10000);
}

function checkConsoleDocked() {
    // Na telefonach i w oknach o zerowym outerWidth różnica wymiarów daje fałszywe alarmy.
    if (!window.outerWidth || !window.outerHeight) return;
    const isMobileScreen = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
        navigator.maxTouchPoints > 0 && screen.width < 1024;
    if (isMobileScreen) return;

    // Uwzględniamy skalowanie ekranu (np. 125% / 150% na Windows).
    const dpr = window.devicePixelRatio || 1;
    const widthDelta = Math.min(
        Math.max(0, window.outerWidth - window.innerWidth),
        Math.max(0, Math.round(window.outerWidth / dpr) - window.innerWidth)
    );
    const heightDelta = Math.min(
        Math.max(0, window.outerHeight - window.innerHeight),
        Math.max(0, Math.round(window.outerHeight / dpr) - window.innerHeight)
    );

    if (baselineWidthDelta === null) {
        baselineWidthDelta = widthDelta;
        baselineHeightDelta = heightDelta;
    }

    if (Date.now() - consoleCheckStart < 500) return;

    if (widthDelta > CONSOLE_THRESHOLD || heightDelta > (CONSOLE_THRESHOLD + 60)) {
        showConsoleGreeting();
        if (!consoleDocked) {
            consoleDocked = true;
            sendEvent('console_docked_opened', {
                width_delta: widthDelta,
                height_delta: heightDelta,
                threshold: CONSOLE_THRESHOLD
            });
        }
    }
}


// --- Rozpoznawanie urządzenia, modelu telefonu, przeglądarki i źródła ---

function fnv1aHex(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

// Na iOS Apple ukrywa dokładny model iPhone'a w User-Agencie, ale rozdzielczość logiczna
// i mnożnik pikseli (@2x/@3x) zawężają model do konkretnej generacji.
function guessAppleDevice(platform, sw, sh, dpr) {
    if (platform !== 'iOS' && platform !== 'iPadOS') return null;
    const w = Math.min(sw, sh);
    const h = Math.max(sw, sh);
    const key = `${w}x${h}@${Math.round(dpr)}`;
    if (platform === 'iPadOS') return `iPad (${w}x${h})`;
    const map = {
        '440x956@3': 'iPhone 16 Pro Max',
        '402x874@3': 'iPhone 16 Pro',
        '430x932@3': 'iPhone 15/16 Plus lub 14/15 Pro Max',
        '393x852@3': 'iPhone 15/16 lub 14/15 Pro',
        '428x926@3': 'iPhone 12/13 Pro Max lub 14 Plus',
        '390x844@3': 'iPhone 12/13/14 lub 12/13 Pro',
        '375x812@3': 'iPhone X/XS/11 Pro lub 12/13 mini',
        '414x896@3': 'iPhone XS Max / 11 Pro Max',
        '414x896@2': 'iPhone 11 / XR',
        '414x736@3': 'iPhone 6+/7+/8+',
        '375x667@2': 'iPhone SE / 6/7/8',
        '360x780@3': 'iPhone 12/13 mini (zoom)'
    };
    return map[key] || `iPhone (${w}x${h} @${dpr}x)`;
}

// Wykrywa wbudowane przeglądarki komunikatorów (Messenger, Instagram, Facebook, Discord, TikTok).
function detectInAppAndSource(ua, referrer, search) {
    let inApp = null;
    if (/FBAN\/Messenger|MessengerForiOS|orca-android/i.test(ua)) inApp = 'Messenger';
    else if (/Instagram/i.test(ua)) inApp = 'Instagram';
    else if (/FB_IAB|FBAN|FBAV/i.test(ua)) inApp = 'Facebook';
    else if (/BytedanceWebview|musical_ly|TikTok/i.test(ua)) inApp = 'TikTok';
    else if (/Discord/i.test(ua)) inApp = 'Discord';
    else if (/Telegram/i.test(ua)) inApp = 'Telegram';
    else if (/WhatsApp/i.test(ua)) inApp = 'WhatsApp';
    else if (/Snapchat/i.test(ua)) inApp = 'Snapchat';
    else if (/GSA\//i.test(ua)) inApp = 'Google App';

    const params = new URLSearchParams(search || '');
    let trafficSource = null;
    if (inApp) trafficSource = `${inApp} (wbudowana przeglądarka)`;
    else if (params.has('fbclid')) trafficSource = 'Facebook / Messenger (fbclid)';
    else if (params.has('igsh') || params.has('igshid')) trafficSource = 'Instagram (link)';
    else if (params.get('utm_source')) trafficSource = params.get('utm_source');
    else if (params.get('od') || params.get('ref')) trafficSource = params.get('od') || params.get('ref');
    else if (referrer) {
        if (/com\.google\.android\.googlequicksearchbox/i.test(referrer)) trafficSource = 'Wyszukiwarka Google (Android)';
        else if (/facebook\.com|fb\.com|m\.me/i.test(referrer)) trafficSource = 'Facebook / Messenger';
        else if (/instagram\.com/i.test(referrer)) trafficSource = 'Instagram';
        else if (/google\./i.test(referrer)) trafficSource = 'Google';
        else if (/github\.com/i.test(referrer)) trafficSource = 'GitHub';
        else if (/t\.co|twitter\.com|x\.com/i.test(referrer)) trafficSource = 'X / Twitter';
        else if (/discord\.com|discordapp\.com/i.test(referrer)) trafficSource = 'Discord';
        else trafficSource = referrer;
    }
    return { inApp, trafficSource };
}

async function detectBrowserAndHints(ua) {
    let browser = 'Nieznana';
    let osVersion = null;
    let deviceModel = null;
    let arch = null;

    // 1. User-Agent Client Hints – w nowym Chrome/Edge/Brave/Opera/Samsung Internet
    // zwraca prawdziwy model telefonu z Androidem (zamiast "K") i odróżnia Windows 11 od 10.
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        try {
            const hints = await navigator.userAgentData.getHighEntropyValues([
                'model', 'platform', 'platformVersion', 'architecture', 'bitness', 'fullVersionList'
            ]);
            if (hints.model) deviceModel = hints.model;
            if (hints.architecture) {
                arch = hints.bitness ? `${hints.architecture}-${hints.bitness}` : hints.architecture;
            }
            if (hints.platform === 'Windows' && hints.platformVersion) {
                const major = parseInt(hints.platformVersion.split('.')[0], 10);
                if (major >= 13) osVersion = 'Windows 11';
                else if (major > 0) osVersion = 'Windows 10';
            } else if (hints.platform === 'Android' && hints.platformVersion) {
                const ver = hints.platformVersion.replace(/(\.0)+$/, '');
                osVersion = `Android ${ver}`;
            } else if (hints.platform && hints.platformVersion) {
                const ver = hints.platformVersion.replace(/(\.0)+$/, '');
                osVersion = `${hints.platform} ${ver}`;
            }

            if (Array.isArray(hints.fullVersionList)) {
                const brands = hints.fullVersionList.filter(b => !/Not.A.Brand|Chromium/i.test(b.brand));
                const preferred = brands.find(b => /Brave|Edge|Opera|Vivaldi|Samsung|Chrome/i.test(b.brand)) || brands[0];
                if (preferred) {
                    const shortVer = (preferred.version || '').split('.')[0];
                    const cleanBrand = preferred.brand.replace('Microsoft Edge', 'Edge').replace('Google Chrome', 'Chrome');
                    browser = `${cleanBrand} ${shortVer}`.trim();
                }
            }
        } catch (e) {}
    }

    // 2. Wykrycie Brave (Brave ukrywa się jako Chrome w Client Hints).
    try {
        if (navigator.brave && await navigator.brave.isBrave()) {
            const m = ua.match(/Chrome\/(\d+)/);
            browser = m ? `Brave (Chrome ${m[1]})` : 'Brave';
        }
    } catch (e) {}

    // 3. Fallback z klasycznego User-Agenta (Safari, Firefox, iOS, starsze przeglądarki).
    if (browser === 'Nieznana') {
        if (/SamsungBrowser\/([\d.]+)/.test(ua)) browser = `Samsung Internet ${RegExp.$1.split('.')[0]}`;
        else if (/EdgA?\/([\d.]+)/.test(ua)) browser = `Edge ${RegExp.$1.split('.')[0]}`;
        else if (/OPR\/([\d.]+)|OPT\/([\d.]+)/.test(ua)) browser = `Opera ${(RegExp.$1 || RegExp.$2).split('.')[0]}`;
        else if (/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/.test(ua)) browser = `Firefox ${(RegExp.$1 || RegExp.$2).split('.')[0]}`;
        else if (/CriOS\/([\d.]+)/.test(ua)) browser = `Chrome iOS ${RegExp.$1.split('.')[0]}`;
        else if (/Version\/([\d.]+).*Safari/.test(ua)) browser = `Safari ${RegExp.$1.split('.')[0]}`;
        else if (/Chrome\/([\d.]+)/.test(ua)) browser = `Chrome ${RegExp.$1.split('.')[0]}`;
    }

    if (!osVersion) {
        if (/CPU (?:iPhone )?OS ([\d_]+)/.test(ua)) osVersion = `iOS ${RegExp.$1.replace(/_/g, '.')}`;
        else if (/Android ([\d.]+)/.test(ua) && RegExp.$1 !== '10') osVersion = `Android ${RegExp.$1}`;
        else if (/Android/.test(ua)) osVersion = 'Android';
        else if (/Mac OS X ([\d_]+)/.test(ua)) osVersion = `macOS ${RegExp.$1.replace(/_/g, '.')}`;
        else if (/Windows NT 10\.0/.test(ua)) osVersion = 'Windows 10/11';
        else if (/Linux/.test(ua)) osVersion = 'Linux';
    }

    // Model z User-Agenta, jeśli nie przyszedł z Client Hints (np. Firefox / starszy Android / Pixel).
    if (!deviceModel && /Android[^;]*;\s*([^)]+)\)/.test(ua)) {
        const raw = RegExp.$1.replace(/Build\/.*$/, '').trim();
        if (raw && raw !== 'K' && !/^wv$/i.test(raw)) deviceModel = raw;
    }

    return { browser, osVersion, deviceModel, arch };
}

async function sendDeviceInfo() {
    if (IS_LOCAL) return;

    const ua = navigator.userAgent || '';
    const rawPlatform = navigator.platform || '';
    let platform = rawPlatform;
    if (/Android/i.test(ua)) platform = 'Android';
    else if (/iPhone|iPod/i.test(ua)) platform = 'iOS';
    else if (/iPad/i.test(ua) || (rawPlatform === 'MacIntel' && navigator.maxTouchPoints > 1)) platform = 'iPadOS';
    else if (/Win/i.test(rawPlatform)) platform = 'Windows';
    else if (/Mac/i.test(rawPlatform)) platform = 'MacOS';
    else if (/Linux/i.test(rawPlatform)) platform = 'Linux';

    const { browser, osVersion, deviceModel: hintedModel, arch } = await detectBrowserAndHints(ua);
    const { inApp, trafficSource } = detectInAppAndSource(ua, document.referrer, location.search);

    const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
    const appleModel = guessAppleDevice(platform === 'iOS' ? 'iOS' : platform, screen.width, screen.height, dpr);
    const deviceModel = hintedModel || appleModel || null;

    // Połączenie sieciowe (Network Information API – dostępne w Chromium / Androidzie).
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    let connectionType = 'Unknown';
    let netDetails = null;
    if (conn) {
        const parts = [];
        if (conn.type && conn.type !== 'unknown') parts.push(conn.type);
        if (conn.effectiveType) parts.push(conn.effectiveType);
        if (typeof conn.downlink === 'number' && conn.downlink > 0) parts.push(`${conn.downlink} Mbps`);
        if (typeof conn.rtt === 'number' && conn.rtt > 0) parts.push(`${conn.rtt} ms`);
        if (parts.length) connectionType = parts.join(', ');
        netDetails = {
            type: conn.type || null,
            effective_type: conn.effectiveType || null,
            downlink_mbps: typeof conn.downlink === 'number' ? conn.downlink : null,
            rtt_ms: typeof conn.rtt === 'number' ? conn.rtt : null,
            save_data: Boolean(conn.saveData)
        };
    }

    let gpuVendor = 'Unknown';
    let gpuRenderer = 'Unknown';
    let maxTextureSize = null;
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown';
                gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown';
            }
        }
    } catch (e) {}

    // Odcisk canvas: ten sam rysunek renderuje się minimalnie inaczej na różnych
    // urządzeniach. Tekst 'Honeypot123' zostaje dla pełnej zgodności ze starymi logami.
    let canvasHash = 'Unknown';
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = "14px 'Arial'";
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Honeypot123', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('Honeypot123', 4, 17);
        const b64 = canvas.toDataURL().replace('data:image/png;base64,', '');
        let hash = 0;
        for (let i = 0; i < b64.length; i++) {
            hash = ((hash << 5) - hash) + b64.charCodeAt(i);
            hash |= 0;
        }
        canvasHash = hash.toString(16);
    } catch (e) {}

    let batteryLevel = null;
    let batteryCharging = null;
    if (navigator.getBattery) {
        try {
            const battery = await navigator.getBattery();
            batteryLevel = Math.round(battery.level * 100) / 100;
            batteryCharging = battery.charging;
        } catch (e) {}
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const langs = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages.join(', ')
        : navigator.language;

    // Wykrycie emulacji telefonu w DevTools na komputerze (np. User-Agent mówi Pixel/iPhone,
    // ale karta graficzna to stacjonarny GeForce RTX / Radeon / Intel UHD albo rawPlatform to Win32).
    const desktopGpu = /NVIDIA|GeForce|Radeon|Intel\(R\)|Apple M\d/i.test(gpuRenderer);
    const desktopPlat = /^Win|^Mac|^Linux x86/i.test(rawPlatform);
    const devtoolsEmulation = (platform === 'Android' || platform === 'iOS') && (desktopGpu || desktopPlat);

    // Stabilny odcisk sprzętowy łączący wszystkie stałe parametry urządzenia.
    const sw = Math.min(screen.width, screen.height);
    const sh = Math.max(screen.width, screen.height);
    const deviceFp = fnv1aHex([
        platform, sw, sh, dpr, screen.colorDepth,
        navigator.hardwareConcurrency || '', navigator.deviceMemory || '',
        gpuVendor, gpuRenderer, maxTextureSize || '',
        canvasHash, tz, langs, navigator.maxTouchPoints || 0
    ].join('|'));

    const data = {
        visit_id: visitId,
        visitor_id: visitorId,
        visit_number: visitNumber,
        device_fp: deviceFp,
        platform: platform === 'iPadOS' ? 'iOS' : platform,
        os_version: osVersion,
        device_model: deviceModel,
        browser: browser,
        in_app: inApp,
        traffic_source: trafficSource,
        arch: arch,
        screen_width: screen.width,
        screen_height: screen.height,
        window_width: window.innerWidth,
        window_height: window.innerHeight,
        pixel_ratio: dpr,
        color_depth: screen.colorDepth || null,
        dark_mode: window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : null,
        hdr: window.matchMedia ? window.matchMedia('(dynamic-range: high)').matches : null,
        touch_points: navigator.maxTouchPoints || 0,
        timezone: tz,
        language: navigator.language,
        languages: langs,
        cores: navigator.hardwareConcurrency || null,
        memory: navigator.deviceMemory || null,
        user_agent: ua,
        gpu_renderer: gpuRenderer,
        gpu_vendor: gpuVendor,
        connection_type: connectionType,
        network: netDetails,
        canvas_hash: canvasHash,
        battery_level: batteryLevel,
        battery_charging: batteryCharging,
        webdriver: Boolean(navigator.webdriver),
        devtools_emulation: devtoolsEmulation || undefined,
        chat_authorized: chatAuthorized || undefined
    };

    postAnalytics(data);
}


// --- Rozszerzone dane o urządzeniu (zdarzenie device_extra) i zachowanie na stronie ---
// Same odczyty pasywne: żaden nie pokazuje odwiedzającemu pytania o zgodę, więc nie ma tu
// kamery, mikrofonu, lokalizacji ani adresu IP z WebRTC. Wynik idzie osobnym zdarzeniem,
// żeby nie ruszać formatu pierwszej paczki, którą czyta serwer. Całość siedzi w jednym
// obiekcie, żeby nie dokładać nazw do globalnego zakresu.

const deviceExtra = (() => {
    const loadVisibility = document.visibilityState;
    const mq = query => (window.matchMedia ? window.matchMedia(query).matches : null);
    const round1 = n => Math.round(n * 10) / 10;

    // Każdy pomiar jest osobno, żeby brak jednego API nie psuł reszty.
    async function probe(fn, ms = 1500) {
        try {
            return await Promise.race([
                Promise.resolve().then(fn),
                new Promise(resolve => setTimeout(() => resolve(null), ms))
            ]);
        } catch (e) {
            return null;
        }
    }

    function sync(fn) {
        try { return fn(); } catch (e) { return null; }
    }

    function median(values) {
        if (!values.length) return null;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    }

    function hashBytes(bytes) {
        let h = 0x811c9dc5;
        for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }


    // --- Ekran, ustawienia systemu i przeglądarka ---

    function collectDisplay() {
        const vv = window.visualViewport;
        const gamut = mq('(color-gamut: rec2020)') ? 'rec2020'
            : mq('(color-gamut: p3)') ? 'p3'
            : mq('(color-gamut: srgb)') ? 'srgb' : null;
        const displayMode = ['standalone', 'fullscreen', 'minimal-ui', 'picture-in-picture']
            .find(m => mq(`(display-mode: ${m})`)) || 'browser';
        return {
            avail: `${screen.availWidth}x${screen.availHeight}`,
            outer: `${window.outerWidth}x${window.outerHeight}`,
            inner: `${window.innerWidth}x${window.innerHeight}`,
            visual_viewport: vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} @${vv.scale}` : null,
            dpr: window.devicePixelRatio,
            pixel_depth: screen.pixelDepth,
            orientation: screen.orientation ? `${screen.orientation.type} ${screen.orientation.angle}` : null,
            extended: typeof screen.isExtended === 'boolean' ? screen.isExtended : null,
            color_gamut: gamut,
            // Dodana do ekranu głównego iPhone'a (PWA) albo zainstalowana aplikacja.
            display_mode: displayMode,
            ios_standalone: typeof navigator.standalone === 'boolean' ? navigator.standalone : null,
            // Domyślny rozmiar tekstu: zmieniony w ustawieniach dostępności daje inną wartość niż 16.
            root_font_px: parseFloat(getComputedStyle(document.documentElement).fontSize) || null
        };
    }

    function collectPrefs() {
        const first = list => list.find(v => v[1]) || [null];
        return {
            reduced_motion: mq('(prefers-reduced-motion: reduce)'),
            reduced_transparency: mq('(prefers-reduced-transparency: reduce)'),
            reduced_data: mq('(prefers-reduced-data: reduce)'),
            contrast: first([
                ['more', mq('(prefers-contrast: more)')],
                ['less', mq('(prefers-contrast: less)')],
                ['custom', mq('(prefers-contrast: custom)')]
            ])[0] || 'no-preference',
            forced_colors: mq('(forced-colors: active)'),
            inverted_colors: mq('(inverted-colors: inverted)'),
            pointer: ['fine', 'coarse', 'none'].find(p => mq(`(pointer: ${p})`)) || null,
            any_pointer: ['fine', 'coarse'].filter(p => mq(`(any-pointer: ${p})`)),
            hover: mq('(hover: hover)'),
            any_hover: mq('(any-hover: hover)'),
            video_hdr: mq('(video-dynamic-range: high)')
        };
    }

    async function collectNavigator() {
        const nav = navigator;
        const out = {
            vendor: nav.vendor || null,
            product_sub: nav.productSub || null,
            oscpu: nav.oscpu || null,
            cookie_enabled: nav.cookieEnabled,
            dnt: nav.doNotTrack === undefined ? null : nav.doNotTrack,
            gpc: nav.globalPrivacyControl === undefined ? null : nav.globalPrivacyControl,
            pdf_viewer: nav.pdfViewerEnabled === undefined ? null : nav.pdfViewerEnabled,
            online: nav.onLine,
            plugins: nav.plugins ? nav.plugins.length : null,
            mime_types: nav.mimeTypes ? nav.mimeTypes.length : null,
            cookies_set: document.cookie ? document.cookie.split(';').length : 0,
            history_length: history.length,
            framed: window.top !== window,
            has_opener: Boolean(window.opener),
            charset: document.characterSet,
            gamepads: sync(() => Array.from(nav.getGamepads()).filter(Boolean).length)
        };
        const uad = nav.userAgentData;
        if (uad) {
            out.ua_data = {
                mobile: uad.mobile,
                platform: uad.platform,
                brands: (uad.brands || []).map(b => `${b.brand} ${b.version}`)
            };
            let hints = await probe(() => uad.getHighEntropyValues([
                'architecture', 'bitness', 'formFactors', 'fullVersionList', 'model',
                'platformVersion', 'uaFullVersion', 'wow64'
            ]));
            if (!hints) {
                hints = await probe(() => uad.getHighEntropyValues([
                    'architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion'
                ]));
            }
            if (hints) {
                Object.assign(out.ua_data, {
                    model: hints.model || null,
                    architecture: hints.architecture || null,
                    bitness: hints.bitness || null,
                    form_factors: hints.formFactors || null,
                    platform_version: hints.platformVersion || null,
                    full_version: hints.uaFullVersion || null,
                    wow64: hints.wow64 === undefined ? null : hints.wow64,
                    full_brands: (hints.fullVersionList || []).map(b => `${b.brand} ${b.version}`)
                });
            }
        }
        return out;
    }

    function collectLocale() {
        const opts = Intl.DateTimeFormat().resolvedOptions();
        const year = new Date().getFullYear();
        return {
            locale: opts.locale,
            calendar: opts.calendar,
            numbering_system: opts.numberingSystem,
            hour_cycle: opts.hourCycle || null,
            tz_offset_min: new Date().getTimezoneOffset(),
            tz_offset_jan: new Date(year, 0, 1).getTimezoneOffset(),
            tz_offset_jul: new Date(year, 6, 1).getTimezoneOffset(),
            // Zapis daty i liczby zależy od ustawień regionu w systemie.
            number_sample: (1234567.89).toLocaleString(),
            date_sample: new Date(2020, 11, 31, 23, 59).toLocaleString(),
            tz_long_name: (new Date().toString().match(/\(([^)]+)\)/) || [])[1] || null
        };
    }

    async function collectStorage() {
        const works = fn => { try { fn(); return true; } catch (e) { return false; } };
        const out = {
            local: works(() => { localStorage.setItem('situus_t', '1'); localStorage.removeItem('situus_t'); }),
            session: works(() => { sessionStorage.setItem('situus_t', '1'); sessionStorage.removeItem('situus_t'); }),
            indexed_db: Boolean(window.indexedDB),
            cache_api: 'caches' in window,
            service_worker: 'serviceWorker' in navigator ? Boolean(navigator.serviceWorker.controller) : null
        };
        // Mały limit miejsca zwykle oznacza tryb prywatny; duży zdradza wielkość dysku.
        const est = await probe(() => navigator.storage.estimate());
        if (est) {
            out.quota_mb = Math.round((est.quota || 0) / 1048576);
            out.usage_kb = Math.round((est.usage || 0) / 1024);
        }
        out.persisted = await probe(() => navigator.storage.persisted());

        // permissions.query tylko podaje stan, nigdy nie wyświetla pytania.
        const names = ['notifications', 'geolocation', 'camera', 'microphone', 'clipboard-read',
            'persistent-storage', 'accelerometer', 'gyroscope', 'midi', 'screen-wake-lock', 'local-fonts'];
        const states = await Promise.all(names.map(name =>
            probe(() => navigator.permissions.query({ name }), 600)));
        out.permissions = {};
        names.forEach((name, i) => { if (states[i]) out.permissions[name] = states[i].state; });
        return out;
    }

    // Wizyty tego samego urządzenia: pierwsza, poprzednia i ile minut temu.
    function collectReturning() {
        let first = null;
        let last = null;
        try {
            first = parseInt(localStorage.getItem('situus_first') || '', 10) || null;
            last = parseInt(localStorage.getItem('situus_last') || '', 10) || null;
            const now = Date.now();
            if (!first) localStorage.setItem('situus_first', String(now));
            localStorage.setItem('situus_last', String(now));
        } catch (e) {}
        return {
            returning: Boolean(first),
            first_visit_ts: first,
            previous_visit_ts: last,
            minutes_since_previous: last ? Math.round((Date.now() - last) / 60000) : null
        };
    }


    // --- Wydajność i ładowanie strony ---

    function timerResolution() {
        let best = Infinity;
        const t0 = Date.now();
        for (let i = 0; i < 20 && Date.now() - t0 < 40; i++) {
            const a = performance.now();
            let b = a;
            for (let n = 0; b === a && n < 2e6; n++) b = performance.now();
            if (b > a) best = Math.min(best, b - a);
        }
        return Number.isFinite(best) ? Math.round(best * 1e4) / 1e4 : null;
    }

    function collectTiming() {
        const out = {
            visibility: loadVisibility,
            prerendering: Boolean(document.prerendering),
            has_focus: document.hasFocus(),
            timer_res_ms: timerResolution()
        };
        const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
        if (nav) {
            Object.assign(out, {
                nav_type: nav.type,
                redirects: nav.redirectCount,
                protocol: nav.nextHopProtocol || null,
                dns_ms: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
                connect_ms: Math.round(nav.connectEnd - nav.connectStart),
                tls_ms: nav.secureConnectionStart > 0 ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
                ttfb_ms: Math.round(nav.responseStart - nav.requestStart),
                dom_ready_ms: Math.round(nav.domContentLoadedEventEnd),
                load_ms: nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
                transfer_kb: Math.round((nav.transferSize || 0) / 1024),
                activation_start_ms: nav.activationStart ? Math.round(nav.activationStart) : 0
            });
        }
        const mem = performance.memory;
        if (mem) {
            out.js_heap_limit_mb = Math.round(mem.jsHeapSizeLimit / 1048576);
            out.js_heap_used_mb = Math.round(mem.usedJSHeapSize / 1048576);
        }
        return out;
    }

    // Stały kawałek obliczeń: wynik w ms mówi, jak szybki jest procesor w tej chwili.
    function cpuBenchmark() {
        const t0 = performance.now();
        let x = 0;
        for (let i = 1; i < 150000; i++) x += Math.sqrt(i) * Math.sin(i);
        const ms = performance.now() - t0;
        return x === Infinity ? -1 : round1(ms);
    }

    // Odświeżanie ekranu z requestAnimationFrame: 120 Hz to ProMotion (iPhone Pro, iPad Pro),
    // a tryb oszczędzania baterii na iPhonie zwykle obniża je do 60 albo 30.
    function measureRefreshRate() {
        return new Promise(resolve => {
            if (document.visibilityState !== 'visible' || !window.requestAnimationFrame) {
                resolve(null);
                return;
            }
            const deltas = [];
            let last = null;
            const step = now => {
                if (last !== null) deltas.push(now - last);
                last = now;
                if (deltas.length < 40) {
                    requestAnimationFrame(step);
                    return;
                }
                const m = median(deltas.slice(5));
                const hz = m ? 1000 / m : null;
                const known = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
                resolve(hz ? {
                    measured_hz: round1(hz),
                    hz: known.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a))
                } : null);
            };
            requestAnimationFrame(step);
        });
    }

    async function collectBatteryTimes() {
        if (!navigator.getBattery) return null;
        const b = await navigator.getBattery();
        return {
            charging_time_s: Number.isFinite(b.chargingTime) ? b.chargingTime : null,
            discharging_time_s: Number.isFinite(b.dischargingTime) ? b.dischargingTime : null
        };
    }


    // --- Grafika, dźwięk i czcionki ---

    function collectWebgl() {
        const out = {};
        ['webgl', 'webgl2'].forEach(kind => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext(kind);
            if (!gl) {
                out[kind] = false;
                return;
            }
            const get = name => gl.getParameter(gl[name]);
            const range = name => { const v = get(name); return v ? Array.from(v) : null; };
            const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
            const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
            const exts = gl.getSupportedExtensions() || [];
            const info = {
                version: get('VERSION'),
                glsl: get('SHADING_LANGUAGE_VERSION'),
                vendor: get('VENDOR'),
                renderer: get('RENDERER'),
                max_texture: get('MAX_TEXTURE_SIZE'),
                max_cube_map: get('MAX_CUBE_MAP_TEXTURE_SIZE'),
                max_renderbuffer: get('MAX_RENDERBUFFER_SIZE'),
                max_vertex_attribs: get('MAX_VERTEX_ATTRIBS'),
                max_varying_vectors: get('MAX_VARYING_VECTORS'),
                max_vertex_uniforms: get('MAX_VERTEX_UNIFORM_VECTORS'),
                max_fragment_uniforms: get('MAX_FRAGMENT_UNIFORM_VECTORS'),
                max_texture_units: get('MAX_TEXTURE_IMAGE_UNITS'),
                max_combined_units: get('MAX_COMBINED_TEXTURE_IMAGE_UNITS'),
                max_viewport: range('MAX_VIEWPORT_DIMS'),
                line_width: range('ALIASED_LINE_WIDTH_RANGE'),
                point_size: range('ALIASED_POINT_SIZE_RANGE'),
                antialias: gl.getContextAttributes().antialias,
                high_float: precision ? [precision.rangeMin, precision.rangeMax, precision.precision] : null,
                max_anisotropy: aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null,
                extensions_count: exts.length,
                extensions_hash: fnv1aHex(exts.slice().sort().join(','))
            };
            if (kind === 'webgl2') {
                info.max_3d_texture = get('MAX_3D_TEXTURE_SIZE');
                info.max_array_layers = get('MAX_ARRAY_TEXTURE_LAYERS');
                info.max_samples = get('MAX_SAMPLES');
                info.max_color_attachments = get('MAX_COLOR_ATTACHMENTS');
            } else {
                info.extensions = exts;
            }
            out[kind] = info;
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        });
        return out;
    }

    // Wynik renderowania prostego shadera: sterownik i układ graficzny dają minimalnie inne piksele.
    function webglRenderHash() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!gl) return null;
        const compile = (type, src) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, src);
            gl.compileShader(shader);
            return shader;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER,
            'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}'));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER,
            'precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(' +
            'sin(v.x*12.9898)*.5+.5,cos(v.y*78.233)*.5+.5,' +
            'fract(sin(dot(v,vec2(12.9898,78.233)))*43758.5453),1.);}'));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const px = new Uint8Array(64 * 64 * 4);
        gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return hashBytes(px);
    }

    // WebGPU podaje architekturę układu graficznego, czyli często generację procesora w telefonie.
    async function collectWebgpu() {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { adapter: null };
        const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {}) || {};
        const limits = adapter.limits || {};
        const mb = n => (n ? Math.round(n / 1048576) : null);
        return {
            vendor: info.vendor || null,
            architecture: info.architecture || null,
            device: info.device || null,
            description: info.description || null,
            fallback: adapter.isFallbackAdapter === undefined ? null : adapter.isFallbackAdapter,
            features: Array.from(adapter.features || []).sort(),
            max_texture_2d: limits.maxTextureDimension2D || null,
            max_buffer_mb: mb(limits.maxBufferSize),
            max_storage_buffer_mb: mb(limits.maxStorageBufferBindingSize),
            max_compute_invocations: limits.maxComputeInvocationsPerWorkgroup || null,
            max_bind_groups: limits.maxBindGroups || null
        };
    }

    // OfflineAudioContext nie gra i nie wymaga gestu użytkownika.
    async function audioFingerprint() {
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) return null;
        const ctx = new Ctx(1, 5000, 44100);
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 10000;
        const comp = ctx.createDynamicsCompressor();
        [['threshold', -50], ['knee', 40], ['ratio', 12], ['attack', 0], ['release', 0.25]].forEach(([k, v]) => {
            if (comp[k] && comp[k].setValueAtTime) comp[k].setValueAtTime(v, ctx.currentTime);
        });
        osc.connect(comp);
        comp.connect(ctx.destination);
        osc.start(0);
        const buffer = await ctx.startRendering();
        const data = buffer.getChannelData(0).subarray(4500);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);
        return { hash: fnv1aHex(String(sum)), sum: sum.toFixed(10) };
    }

    // Czcionki widać po szerokości tekstu: jeśli czcionki nie ma, rysuje się domyślna.
    const FONT_CANDIDATES = [
        'Arial', 'Arial Black', 'Bahnschrift', 'Book Antiqua', 'Calibri', 'Cambria', 'Candara',
        'Cascadia Code', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
        'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Garamond', 'Georgia',
        'Gill Sans MT', 'Impact', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode',
        'Malgun Gothic', 'Microsoft YaHei', 'MS Gothic', 'Nirmala UI', 'Palatino Linotype',
        'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Variable', 'Sylfaen', 'Tahoma', 'Times New Roman',
        'Trebuchet MS', 'Verdana', 'Yu Gothic',
        'American Typewriter', 'Apple Color Emoji', 'Avenir', 'Avenir Next', 'Baskerville',
        'Chalkboard SE', 'Didot', 'Futura', 'Geneva', 'Gill Sans', 'Helvetica', 'Helvetica Neue',
        'Hiragino Sans', 'Hoefler Text', 'Lucida Grande', 'Marker Felt', 'Menlo', 'Monaco',
        'New York', 'Noteworthy', 'Optima', 'Palatino', 'Papyrus', 'PingFang SC', 'SF Mono',
        'SF Pro Display', 'SF Pro Text', 'Zapfino',
        'Cantarell', 'DejaVu Sans', 'Droid Sans', 'Fira Sans', 'Google Sans', 'Lato',
        'Liberation Sans', 'Noto Color Emoji', 'Noto Sans', 'Noto Serif', 'Open Sans', 'Roboto',
        'SamsungOne', 'Source Sans Pro', 'Ubuntu'
    ];

    function detectFonts() {
        const ctx = document.createElement('canvas').getContext('2d');
        const bases = ['monospace', 'sans-serif', 'serif'];
        const text = 'mmmmmmmmmmlliWQ@#1234 ĄŻŹ';
        const baseWidth = {};
        bases.forEach(b => { ctx.font = `72px ${b}`; baseWidth[b] = ctx.measureText(text).width; });
        return FONT_CANDIDATES.filter(font => bases.some(b => {
            ctx.font = `72px "${font}", ${b}`;
            return ctx.measureText(text).width !== baseWidth[b];
        }));
    }

    // Nowe emoji w starym systemie rysują się jako dwa znaki albo kwadracik, więc szerokość
    // względem zwykłej buźki zdradza, do której wersji Unicode system ma czcionkę.
    const EMOJI_PROBES = [
        ['12', '\u{1F971}'], ['13', '\u{1F972}'], ['13.1', '\u{1F62E}‍\u{1F4A8}'],
        ['14', '\u{1FAE0}'], ['15', '\u{1FAE8}'], ['15.1', '\u{1F426}‍⬛'],
        ['16', '\u{1FAE9}'], ['17', '\u{1FAEA}']
    ];

    function emojiSupport() {
        const canvas = document.createElement('canvas');
        canvas.width = 260;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.font = '32px sans-serif';
        const base = ctx.measureText('\u{1F600}').width;
        const ratios = {};
        let newest = null;
        EMOJI_PROBES.forEach(([version, ch]) => {
            const ratio = ctx.measureText(ch).width / base;
            ratios[version] = Math.round(ratio * 100) / 100;
            if (ratio < 1.4) newest = version;
        });
        ctx.fillText('\u{1F600}\u{1F971}\u{1FAE0}\u{1F3F3}️‍\u{1F308}\u{1F468}‍\u{1F469}‍\u{1F467}Ąż', 4, 36);
        return { newest_version: newest, ratios, render_hash: fnv1aHex(canvas.toDataURL()) };
    }

    // Wyniki funkcji matematycznych różnią się w ostatnich cyfrach między silnikami i procesorami.
    function mathFingerprint() {
        const values = [Math.tan(-1e300), Math.sinh(1), Math.expm1(1), Math.acosh(1e300),
            Math.atanh(0.5), Math.cbrt(100), Math.cosh(1), Math.log1p(10), Math.pow(Math.PI, -100)];
        return fnv1aHex(values.join('|'));
    }


    // --- Multimedia, urządzenia i obsługa funkcji przeglądarki ---

    async function collectMedia() {
        const video = document.createElement('video');
        const audio = document.createElement('audio');
        const can = (el, type) => ({ '': '-', maybe: 'm', probably: 'p' }[el.canPlayType(type)] || '-');
        const out = {
            video: {
                h264: can(video, 'video/mp4; codecs="avc1.42E01E"'),
                h265: can(video, 'video/mp4; codecs="hvc1.1.6.L93.B0"'),
                vp8: can(video, 'video/webm; codecs="vp8"'),
                vp9: can(video, 'video/webm; codecs="vp9"'),
                av1: can(video, 'video/mp4; codecs="av01.0.05M.08"'),
                theora: can(video, 'video/ogg; codecs="theora"')
            },
            audio: {
                mp3: can(audio, 'audio/mpeg'),
                aac: can(audio, 'audio/mp4; codecs="mp4a.40.2"'),
                flac: can(audio, 'audio/flac'),
                opus: can(audio, 'audio/ogg; codecs="opus"'),
                vorbis: can(audio, 'audio/ogg; codecs="vorbis"'),
                alac: can(audio, 'audio/mp4; codecs="alac"')
            }
        };
        // Dekodowanie 4K/60: sprzętowa obsługa AV1 czy HEVC zależy od generacji układu.
        // Wynik: s = obsługiwane, m = płynne, e = energooszczędne (sprzętowe).
        if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
            const tests = {
                h264: 'video/mp4; codecs="avc1.640033"',
                h265: 'video/mp4; codecs="hvc1.1.6.L153.B0"',
                vp9: 'video/webm; codecs="vp09.00.51.08"',
                av1: 'video/mp4; codecs="av01.0.12M.08"'
            };
            out.decode_4k60 = {};
            const names = Object.keys(tests);
            const results = await Promise.all(names.map(name => probe(() =>
                navigator.mediaCapabilities.decodingInfo({
                    type: 'file',
                    video: { contentType: tests[name], width: 3840, height: 2160, bitrate: 20000000, framerate: 60 }
                }), 1200)));
            names.forEach((name, i) => {
                const r = results[i];
                out.decode_4k60[name] = r ? `${r.supported ? 's' : '-'}${r.smooth ? 'm' : '-'}${r.powerEfficient ? 'e' : '-'}` : null;
            });
        }
        return out;
    }

    // enumerateDevices bez zgody zwraca same liczby, bez nazw.
    async function collectMediaDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
        const list = await navigator.mediaDevices.enumerateDevices();
        const count = kind => list.filter(d => d.kind === kind).length;
        return { audio_in: count('audioinput'), audio_out: count('audiooutput'), video_in: count('videoinput') };
    }

    // Lista głosów syntezatora mowy zależy od systemu i jego języków.
    function collectVoices() {
        return new Promise(resolve => {
            if (!window.speechSynthesis) {
                resolve(null);
                return;
            }
            const read = () => speechSynthesis.getVoices();
            const done = list => resolve(list.length ? {
                count: list.length,
                hash: fnv1aHex(list.map(v => v.name).sort().join('|')),
                langs: Array.from(new Set(list.map(v => v.lang))).sort().slice(0, 40),
                default: (list.find(v => v.default) || {}).name || null
            } : { count: 0 });
            const first = read();
            if (first.length) {
                done(first);
                return;
            }
            speechSynthesis.addEventListener('voiceschanged', () => done(read()), { once: true });
            setTimeout(() => done(read()), 800);
        });
    }

    function collectFeatures() {
        const hasWin = name => name in window;
        const hasNav = name => name in navigator;
        const checks = {
            bluetooth: hasNav('bluetooth'), usb: hasNav('usb'), serial: hasNav('serial'), hid: hasNav('hid'),
            nfc: hasWin('NDEFReader'), share: hasNav('share'), wake_lock: hasNav('wakeLock'),
            vibrate: hasNav('vibrate'), contacts: hasNav('contacts'), credentials: hasNav('credentials'),
            webauthn: hasWin('PublicKeyCredential'), gpu: hasNav('gpu'), ml: hasNav('ml'), xr: hasNav('xr'),
            battery: hasNav('getBattery'), idle_callback: hasWin('requestIdleCallback'),
            shared_array_buffer: typeof SharedArrayBuffer !== 'undefined',
            cross_origin_isolated: Boolean(window.crossOriginIsolated),
            wasm: typeof WebAssembly === 'object', offscreen_canvas: hasWin('OffscreenCanvas'),
            notifications: hasWin('Notification'), push: hasWin('PushManager'),
            speech_recognition: hasWin('SpeechRecognition') || hasWin('webkitSpeechRecognition'),
            device_motion: hasWin('DeviceMotionEvent'), device_orientation: hasWin('DeviceOrientationEvent'),
            ambient_light: hasWin('AmbientLightSensor'), file_picker: hasWin('showOpenFilePicker'),
            eye_dropper: hasWin('EyeDropper'), payment_request: hasWin('PaymentRequest'),
            apple_pay: hasWin('ApplePaySession')
        };
        const out = { supported: Object.keys(checks).filter(k => checks[k]) };
        // Apple Pay: czy w telefonie jest skonfigurowana karta (nie pokazuje żadnego pytania).
        if (checks.apple_pay) out.apple_pay_ready = sync(() => window.ApplePaySession.canMakePayments());
        return out;
    }

    // Nowe funkcje CSS pojawiają się w konkretnych wersjach przeglądarki, więc zawężają wersję.
    const CSS_PROBES = {
        anchor: ['anchor-name', '--a'], view_transition: ['view-transition-name', 'a'],
        container: ['container-type', 'inline-size'], text_wrap_balance: ['text-wrap', 'balance'],
        field_sizing: ['field-sizing', 'content'], interpolate_size: ['interpolate-size', 'allow-keywords'],
        corner_shape: ['corner-shape', 'squircle'], text_box_trim: ['text-box-trim', 'trim-both'],
        scroll_timeline: ['animation-timeline', 'scroll()'], oklch: ['color', 'oklch(0.5 0.1 200)'],
        light_dark: ['color', 'light-dark(red, blue)'], contrast_color: ['color', 'contrast-color(red)'],
        sibling_index: ['width', 'calc(sibling-index() * 1px)'], has: ['selector(:has(a))'],
        backdrop_filter: ['backdrop-filter', 'blur(1px)'], touch_callout: ['-webkit-touch-callout', 'none']
    };

    function collectCss() {
        if (!window.CSS || !CSS.supports) return null;
        return Object.keys(CSS_PROBES).filter(key => {
            const args = CSS_PROBES[key];
            return sync(() => (args.length === 2 ? CSS.supports(args[0], args[1]) : CSS.supports(args[0])));
        });
    }


    // --- Zachowanie na stronie (dołączane do zdarzenia login_time) ---

    const interaction = {
        pointer: { touch: 0, mouse: 0, pen: 0 },
        max_touches: 0, keys: 0, scrolls: 0, copies: 0, selections: 0, context_menus: 0,
        resizes: 0, orientation_changes: 0, tab_switches: 0, blurs: 0, offline_events: 0, net_changes: 0,
        first_input_ms: null, first_scroll_ms: null, max_pinch_scale: 1,
        js_errors: 0, last_js_error: null
    };
    const vitals = { fcp_ms: null, lcp_ms: null, cls: 0, long_tasks: 0, long_task_ms: 0, max_event_ms: 0 };

    function startTracking() {
        const on = (target, type, handler, opts) => { if (target) target.addEventListener(type, handler, opts); };
        const sinceStart = () => Date.now() - pageStart;
        const markInput = () => { if (interaction.first_input_ms === null) interaction.first_input_ms = sinceStart(); };

        // Zliczamy tylko zdarzenia, bez treści: nie zapisujemy naciśniętych klawiszy ani miejsc dotknięć.
        on(window, 'pointerdown', e => {
            if (e.pointerType in interaction.pointer) interaction.pointer[e.pointerType]++;
            markInput();
        }, { passive: true, capture: true });
        on(window, 'touchstart', e => {
            interaction.max_touches = Math.max(interaction.max_touches, e.touches.length);
        }, { passive: true, capture: true });
        on(window, 'keydown', () => { interaction.keys++; markInput(); }, { capture: true });
        on(window, 'scroll', () => {
            interaction.scrolls++;
            if (interaction.first_scroll_ms === null) interaction.first_scroll_ms = sinceStart();
        }, { passive: true });
        on(document, 'copy', () => { interaction.copies++; });
        on(document, 'contextmenu', () => { interaction.context_menus++; });
        on(document, 'selectionchange', () => { if (interaction.selections < 50) interaction.selections++; });
        on(window, 'resize', () => { interaction.resizes++; });
        on(screen.orientation, 'change', () => { interaction.orientation_changes++; });
        on(document, 'visibilitychange', () => {
            if (document.visibilityState === 'hidden') interaction.tab_switches++;
        });
        on(window, 'blur', () => { interaction.blurs++; });
        on(window, 'offline', () => { interaction.offline_events++; });
        on(navigator.connection, 'change', () => { interaction.net_changes++; });
        on(window.visualViewport, 'resize', () => {
            interaction.max_pinch_scale = Math.max(interaction.max_pinch_scale,
                Math.round(window.visualViewport.scale * 100) / 100);
        });
        on(window, 'error', e => {
            interaction.js_errors++;
            const file = String(e.filename || '').split('/').pop();
            interaction.last_js_error = `${e.message} @${file}:${e.lineno}`.slice(0, 160);
        });
        on(window, 'unhandledrejection', () => { interaction.js_errors++; });

        const observe = (type, handler, extra) => {
            try {
                const po = new PerformanceObserver(list => list.getEntries().forEach(handler));
                po.observe(Object.assign({ type, buffered: true }, extra));
            } catch (e) {}
        };
        observe('paint', en => {
            if (en.name === 'first-contentful-paint') vitals.fcp_ms = Math.round(en.startTime);
        });
        observe('largest-contentful-paint', en => { vitals.lcp_ms = Math.round(en.startTime); });
        observe('layout-shift', en => {
            if (!en.hadRecentInput) vitals.cls = Math.round((vitals.cls + en.value) * 1000) / 1000;
        });
        observe('longtask', en => { vitals.long_tasks++; vitals.long_task_ms += Math.round(en.duration); });
        observe('event', en => {
            vitals.max_event_ms = Math.max(vitals.max_event_ms, Math.round(en.duration));
        }, { durationThreshold: 40 });
    }

    function snapshot() {
        return { ...interaction, pointer: { ...interaction.pointer }, vitals: { ...vitals } };
    }


    // --- Zebranie wszystkiego w jedno zdarzenie ---

    async function collect() {
        // Odświeżanie mierzymy jako pierwsze, zanim reszta zajmie procesor.
        const refresh = await probe(measureRefreshRate, 2500);
        const [navInfo, storage, webgpu, audio, media, devices, voices, battery] = await Promise.all([
            probe(collectNavigator),
            probe(collectStorage, 3000),
            probe(collectWebgpu),
            probe(audioFingerprint),
            probe(collectMedia, 4000),
            probe(collectMediaDevices),
            probe(collectVoices, 1200),
            probe(collectBatteryTimes)
        ]);
        const fonts = sync(detectFonts);
        return {
            load: sync(collectTiming),
            display: sync(collectDisplay),
            refresh,
            prefs: sync(collectPrefs),
            nav: navInfo,
            locale: sync(collectLocale),
            storage,
            returning: sync(collectReturning),
            cpu_ms: sync(cpuBenchmark),
            webgl: sync(collectWebgl),
            webgl_render_hash: sync(webglRenderHash),
            webgpu,
            audio,
            fonts: fonts && { count: fonts.length, hash: fnv1aHex(fonts.join('|')), list: fonts },
            emoji: sync(emojiSupport),
            math_hash: sync(mathFingerprint),
            media,
            devices,
            voices,
            battery,
            features: sync(collectFeatures),
            css: sync(collectCss)
        };
    }

    async function send() {
        const data = await collect();
        // Serwer odrzuca zdarzenia powyżej 16 KB, więc w razie potrzeby ucinamy najdłuższe listy.
        const tooBig = () => JSON.stringify(data).length > 13000;
        if (tooBig() && data.fonts) delete data.fonts.list;
        if (tooBig() && data.webgl && data.webgl.webgl) delete data.webgl.webgl.extensions;
        if (tooBig() && data.voices) delete data.voices.langs;
        sendEvent('device_extra', data);
    }

    // Po pierwszej paczce i poza ścieżką ładowania strony, a strona wyrenderowana z góry
    // (prerender) czeka na faktyczne wejście odwiedzającego.
    function schedule() {
        const run = () => {
            const later = window.requestIdleCallback
                ? fn => requestIdleCallback(fn, { timeout: 4000 })
                : fn => setTimeout(fn, 1500);
            later(() => { send().catch(() => {}); });
        };
        if (document.prerendering) {
            document.addEventListener('prerenderingchange', run, { once: true });
        } else {
            run();
        }
    }

    return { start: startTracking, schedule, snapshot, collect };
})();


// --- Śledzenie tego, co odwiedzający robi na stronie (zakładki, odsłuchy, kliknięcia) ---

function setupActivityTracking() {
    // 1. Zmiana widoku / zakładki (#muzyka, #muzyka/submerged, #narzedzia/chat itd.)
    window.addEventListener('hashchange', () => {
        const view = currentViewName();
        if (viewsVisited[viewsVisited.length - 1] !== view) {
            viewsVisited.push(view);
        }
        sendEvent('view_change', {
            view,
            elapsed_s: Math.round((Date.now() - pageStart) / 100) / 10
        });
    });

    // 2. Odsłuch fragmentów utworów (audio)
    document.querySelectorAll('audio[id]').forEach(audio => {
        let reportedPlay = false;
        audio.addEventListener('play', () => {
            const track = audio.id.replace(/^audio-/, '');
            if (!tracksPlayed.includes(track)) tracksPlayed.push(track);
            if (!reportedPlay) {
                reportedPlay = true;
                sendEvent('audio_play', { track });
            }
        });
    });

    // 3. Kliknięcia w zewnętrzne linki, narzędzia, pracę naukową i ważne przyciski
    document.addEventListener('click', e => {
        const a = e.target.closest('a[href]');
        if (a) {
            const href = a.getAttribute('href') || '';
            if (!href || href.startsWith('#')) return;
            // Zablokowany czat jest już obsługiwany w setupChatLinks.
            if (a.hasAttribute('data-chat-link') && !chatAuthorized) return;

            let label = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            if (/spotify\.com/i.test(href)) label = 'Spotify';
            else if (/music\.apple\.com/i.test(href)) label = 'Apple Music';
            else if (/youtube\.com|youtu\.be/i.test(href)) label = 'YouTube';
            else if (/tidal\.com/i.test(href)) label = 'Tidal';
            else if (/wrapped\.situus\.pl/i.test(href)) label = 'Messenger Wrapped';
            else if (/chat\.situus\.pl/i.test(href)) label = 'Situus Chat';
            else if (/praca_naukowa_2\.html/i.test(href)) label = 'Praca badawcza (STARK-WEB)';
            else if (/^mailto:/i.test(href)) label = `E-mail (${href.replace(/^mailto:/i, '').split('?')[0]})`;

            sendEvent('click', { target: label || href, href }, true);
            return;
        }

        const cotBtn = e.target.closest('#cot-demo-btn');
        if (cotBtn && cotBtn.getAttribute('aria-expanded') !== 'true') {
            sendEvent('click', { target: 'Demo CoT (9 kroków myślenia)' });
        }
    });

    // 4. Pomiar przewinięcia strony i aktywnego czasu w karcie
    window.addEventListener('scroll', updateScrollDepth, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (visibleSince !== null) {
                activeTimeMs += Math.max(0, Date.now() - visibleSince);
                visibleSince = null;
            }
            sendTimeOnPage('visibility_hidden');
        } else if (document.visibilityState === 'visible') {
            visibleSince = Date.now();
        }
    });

    window.addEventListener('pagehide', () => {
        if (visibleSince !== null) {
            activeTimeMs += Math.max(0, Date.now() - visibleSince);
            visibleSince = null;
        }
        sendTimeOnPage('pagehide');
    });
}


// --- Start ---

Promise.race([
    checkChatAccess(),
    new Promise(resolve => setTimeout(resolve, 600))
]).then(() => {
    sendDeviceInfo();
    deviceExtra.schedule();
});
deviceExtra.start();
checkServer();
setupChatLinks();
startClock();
fillDates();
setupDismiss();
setupActivityTracking();

const initialSource = detectInAppAndSource(navigator.userAgent || '', document.referrer, location.search);
sendEvent('login_page_view', {
    view: currentViewName(),
    referrer: document.referrer || null,
    traffic_source: initialSource.trafficSource,
    in_app: initialSource.inApp,
    query: location.search || undefined
});

setTimeout(checkConsoleDocked, 600);
window.addEventListener('resize', checkConsoleDocked);
