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
window.situus = {
    chatUrl: CHAT_URL,
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
});
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
