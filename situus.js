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
// Nazwy zdarzeń (login_*) pochodzą ze starej strony logowania.
// Nie zmieniać ich bez zmiany po stronie log.situus.pl.

const pageStart = Date.now();
let timeOnPageSent = false;
const visitId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `visit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

// sendBeacon dochodzi także przy zamykaniu karty, dlatego używa go zdarzenie końca wizyty.
function sendEvent(eventType, extra = {}, useBeacon = false) {
    if (IS_LOCAL) return;

    const body = JSON.stringify({
        event_type: eventType,
        ts: Date.now(),
        page: window.location.pathname,
        visit_id: visitId,
        ...extra
    });
    const url = `${LOG_URL}/api/analytics`;

    if (useBeacon && navigator.sendBeacon) {
        try {
            navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
            return;
        } catch (e) {}
    }
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: useBeacon
    }).catch(() => {});
}

function sendTimeOnPage(reason) {
    if (timeOnPageSent) return;
    timeOnPageSent = true;
    sendEvent('login_time', { time_on_page_ms: Date.now() - pageStart, reason }, true);
}

// DevTools zadokowane przy krawędzi okna zmniejszają obszar strony, więc
// różnica między outer i inner rośnie. Wtedy w konsoli pojawia się powitanie.
const CONSOLE_THRESHOLD = 160;
const consoleCheckStart = Date.now();
let consoleDocked = false;
let consoleGreetingShown = false;

function showConsoleGreeting() {
    if (consoleGreetingShown) return;
    consoleGreetingShown = true;
    setTimeout(() => console.log('%c Witaj', 'color:#00ff41; font-weight:bold; font-size:16px;'), 1000);
    setTimeout(() => console.log('A jednak sprawdziłeś?'), 4000);
    setTimeout(() => console.log('Ciekawe...'), 10000);
}

function checkConsoleDocked() {
    // Tuż po załadowaniu wymiary okna bywają jeszcze nieustalone.
    if (Date.now() - consoleCheckStart < 500) return;
    const widthDelta = Math.abs(window.outerWidth - window.innerWidth);
    const heightDelta = Math.abs(window.outerHeight - window.innerHeight);
    if (widthDelta > CONSOLE_THRESHOLD || heightDelta > CONSOLE_THRESHOLD) {
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

// Dane o urządzeniu: ekran, system, GPU, odcisk canvas i bateria.
// Idą osobnym zapytaniem, bez event_type – tak jak w poprzedniej wersji.
async function sendDeviceInfo() {
    if (IS_LOCAL) return;

    const ua = navigator.userAgent;
    let platform = navigator.platform;
    if (/Android/.test(ua)) platform = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) platform = 'iOS';
    else if (/Win/.test(platform)) platform = 'Windows';
    else if (/Mac/.test(platform)) platform = 'MacOS';
    else if (/Linux/.test(platform)) platform = 'Linux';

    const data = {
        screen_width: screen.width,
        screen_height: screen.height,
        window_width: window.innerWidth,
        window_height: window.innerHeight,
        pixel_ratio: window.devicePixelRatio,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        cores: navigator.hardwareConcurrency,
        memory: navigator.deviceMemory,
        platform: platform,
        user_agent: ua,
        gpu_renderer: 'Unknown',
        gpu_vendor: 'Unknown',
        connection_type: 'Unknown',
        canvas_hash: 'Unknown',
        battery_level: null,
        battery_charging: null
    };

    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        const debugInfo = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            data.gpu_vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            data.gpu_renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
    } catch (e) {}

    // Odcisk canvas: ten sam rysunek renderuje się minimalnie inaczej na różnych
    // urządzeniach. Tekst 'Honeypot123' musi zostać – inny tekst zmieni wszystkie hashe.
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
        data.canvas_hash = hash.toString(16);
    } catch (e) {}

    if (navigator.getBattery) {
        try {
            const battery = await navigator.getBattery();
            data.battery_level = battery.level;
            data.battery_charging = battery.charging;
        } catch (e) {}
    }

    fetch(`${LOG_URL}/api/analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).catch(() => {});
}


// --- Start ---

checkChatAccess();
checkServer();
setupChatLinks();
startClock();
fillDates();
setupDismiss();

sendEvent('login_page_view', { referrer: document.referrer || null });
sendDeviceInfo();

setTimeout(checkConsoleDocked, 600);
window.addEventListener('resize', checkConsoleDocked);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendTimeOnPage('visibility_hidden');
});
window.addEventListener('pagehide', () => sendTimeOnPage('pagehide'));
