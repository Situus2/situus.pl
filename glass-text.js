// Szklany napis: tekst jako soczewka nad tapetą, w tym samym stylu co szkło liquidGL
// na stronie (wypukła krawędź, prawo Snella, światło z góry z lewej). liquidGL umie tylko
// zaokrąglone prostokąty, więc litery rysuje ten mały renderer WebGL.
//
// Użycie: const g = situusGlassText(h1, imgTapety); g.render() po każdej zmianie położenia.
// Bez WebGL zwraca null, a napis zostaje zwykłym tekstem.

(() => {
    const VERT = `
        attribute vec2 a;
        varying vec2 v;
        void main() {
            v = vec2(a.x * 0.5 + 0.5, 0.5 - a.y * 0.5);
            gl_Position = vec4(a, 0.0, 1.0);
        }`;

    // v: 0..1 po płótnie, oś y w dół. Wszystkie odległości w px CSS.
    const FRAG = `
        precision highp float;
        varying vec2 v;
        uniform sampler2D u_sdf;   // R: odległość od krawędzi litery, GB: normalna na zewnątrz
        uniform sampler2D u_bg;    // tapeta
        uniform vec2 u_pos;        // lewy górny róg płótna w oknie
        uniform vec2 u_size;       // rozmiar płótna
        uniform vec4 u_cover;      // gdzie leży obrazek tapety (object-fit: cover)
        uniform vec2 u_shade;      // dół i wysokość sceny – przyciemnienie jak .scene-shade
        uniform float u_range;     // zakres zapisanej odległości
        uniform float u_bevel;     // szerokość fazy
        uniform float u_px;        // 1 px urządzenia

        vec3 bg(vec2 p) {
            vec2 uv = clamp((p - u_cover.xy) / u_cover.zw, 0.0, 1.0);
            vec3 c = texture2D(u_bg, uv).rgb;
            float a = 0.5 * clamp(1.0 - (u_shade.x - p.y) / (0.4 * u_shade.y), 0.0, 1.0);
            return mix(c, vec3(0.02, 0.024, 0.055), a);
        }

        float dist(vec2 uv) { return (texture2D(u_sdf, uv).r * 2.0 - 1.0) * u_range; }

        void main() {
            vec4 t = texture2D(u_sdf, v);
            float d = (t.r * 2.0 - 1.0) * u_range;
            vec2 p = u_pos + v * u_size;

            // Miękki cień: kształt liter przesunięty w dół
            float ds = dist(v - vec2(0.0, 12.0) / u_size);
            float shadowA = 0.32 * smoothstep(-30.0, 6.0, ds);

            float alpha = smoothstep(-0.6 * u_px, 0.6 * u_px, d);
            vec3 col = vec3(0.0);
            if (alpha > 0.0) {
                vec2 n = normalize(t.gb * 2.0 - 1.0 + vec2(0.00001));

                // Ten sam profil i prawo Snella co w łatce liquidGL
                float xb = clamp(d / u_bevel, 0.0, 1.0);
                float om = 1.0 - max(xb, 0.02);
                float dh = pow(om, 1.5) * pow(max(1.0 - pow(om, 2.5), 0.0001), -0.6);
                float tiltA = atan(dh * 1.1);
                float bend = tiltA - asin(sin(tiltA) / 1.5);
                float disp = tan(bend) * u_bevel * 1.6 * (1.0 - smoothstep(0.85, 1.0, xb));
                vec2 q = p - n * disp;
                vec2 ch = n * disp * 0.07;

                float r = 1.4;
                vec3 c = bg(q) * 0.4 + (bg(q + vec2(r, 0.0)) + bg(q - vec2(r, 0.0)) +
                                        bg(q + vec2(0.0, r)) + bg(q - vec2(0.0, r))) * 0.15;
                c.r = mix(c.r, bg(q - ch).r, 0.6);
                c.b = mix(c.b, bg(q + ch).b, 0.6);

                // Przezroczyste szkło: tylko odrobinę jaśniej niż tło, żeby napis było widać
                float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
                c = mix(vec3(lum), c, 1.1) * 1.08 + 0.02;

                // Krawędź: cienka linia od góry z lewej, słabszy odblask z dołu z prawej
                vec2 L = normalize(vec2(-0.55, -0.83));
                float ndl = dot(n, L);
                float lit = pow(max(ndl, 0.0), 1.6);
                float back = pow(max(-ndl, 0.0), 1.6);
                float rim = 1.0 - smoothstep(0.0, max(u_px, u_bevel * 0.07), d);
                float halo = 1.0 - smoothstep(0.0, u_bevel * 0.4, d);
                c += rim * (0.07 + 0.85 * lit + 0.38 * back) + halo * halo * halo * 0.08 * lit;
                col = c;
            }

            float sa = shadowA * (1.0 - alpha);
            gl_FragColor = vec4(col * alpha, alpha + sa);
        }`;

    // Transformata odległości euklidesowej (Felzenszwalb–Huttenlocher), jak w mapbox/tiny-sdf
    const INF = 1e20;

    function edt1d(grid, offset, stride, length, f, v, z) {
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 0; q < length; q++) f[q] = grid[offset + q * stride];
        for (let q = 1, k = 0, s = 0; q < length; q++) {
            do {
                const r = v[k];
                s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
            } while (s <= z[k] && --k > -1);
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = INF;
        }
        for (let q = 0, k = 0; q < length; q++) {
            while (z[k + 1] < q) k++;
            const r = v[k];
            grid[offset + q * stride] = f[r] + (q - r) * (q - r);
        }
    }

    function edt(grid, w, h) {
        const n = Math.max(w, h);
        const f = new Float64Array(n), v = new Uint16Array(n), z = new Float64Array(n + 1);
        for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
        for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
    }

    // Odległość od krawędzi (+ w środku litery) z kanału alfa maski
    function signedDistance(alpha, w, h) {
        const outer = new Float64Array(w * h), inner = new Float64Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const a = alpha[i] / 255;
            outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
            inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
        }
        edt(outer, w, h);
        edt(inner, w, h);
        const d = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) d[i] = Math.sqrt(inner[i]) - Math.sqrt(outer[i]);
        return d;
    }

    function blur3(src, w, h) {
        const out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= w) continue;
                        sum += src[yy * w + xx];
                        cnt++;
                    }
                }
                out[y * w + x] = sum / cnt;
            }
        }
        return out;
    }

    function shader(gl, type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }

    window.situusGlassText = function (el, img) {
        const host = el.parentElement;
        const canvas = document.createElement('canvas');
        canvas.className = 'glass-text';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;pointer-events:none;';
        const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
        if (!gl) return null;

        let program;
        try {
            program = gl.createProgram();
            gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        } catch (e) {
            console.warn('Szklany napis: shader się nie skompilował', e);
            return null;
        }

        // Tapeta jako tekstura. Z file:// obrazek musi być data: URL-em, inaczej WebGL go nie przeczyta.
        const bgTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, bgTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } catch (e) {
            console.warn('Szklany napis: tapeta niedostępna dla WebGL', e);
            return null;
        }

        const sdfTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, sdfTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aLoc = gl.getAttribLocation(program, 'a');
        const u = name => gl.getUniformLocation(program, name);
        const U = {
            sdf: u('u_sdf'), bg: u('u_bg'), pos: u('u_pos'), size: u('u_size'), cover: u('u_cover'),
            shade: u('u_shade'), range: u('u_range'), bevel: u('u_bevel'), px: u('u_px'),
        };

        host.appendChild(canvas);
        el.classList.add('has-glass');

        const PAD = 40;
        const RANGE = 28;
        let key = '';
        let geo = null;

        // Gdzie stoi linia bazowa i początek tekstu – tam rysujemy litery maski.
        // Wymiary z układu (offset*), nie z getBoundingClientRect: transformacje przejść
        // między zakładkami ich nie zmieniają, więc maska nie przelicza się w każdej klatce.
        // Rodzicem (offsetParent) jest host z position: relative.
        function measure() {
            const probe = document.createElement('span');
            probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
            el.insertBefore(probe, el.firstChild);
            const textX = probe.offsetLeft, baseline = probe.offsetTop;
            probe.remove();
            const cs = getComputedStyle(el);
            return {
                left: el.offsetLeft - PAD,
                top: el.offsetTop - PAD,
                w: Math.ceil(el.offsetWidth + PAD * 2),
                h: Math.ceil(el.offsetHeight + PAD * 2),
                textX: textX - el.offsetLeft + PAD,
                baseY: baseline - el.offsetTop + PAD,
                font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
                size: parseFloat(cs.fontSize),
                spacing: parseFloat(cs.letterSpacing) || 0,
                text: el.textContent.trim(),
            };
        }

        function layoutKey() {
            const cs = getComputedStyle(el);
            return [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight, cs.font, cs.letterSpacing, el.textContent].join('|');
        }

        function buildSdf(m) {
            // Odległości liczymy w siatce ~1,5× gęstszej niż px CSS; dwuliniowe próbkowanie robi resztę
            const scale = Math.min(1.5, Math.max(1, Math.sqrt(1.4e6 / (m.w * m.h))));
            const w = Math.round(m.w * scale), h = Math.round(m.h * scale);
            const mask = document.createElement('canvas');
            mask.width = w;
            mask.height = h;
            const ctx = mask.getContext('2d', { willReadFrequently: true });
            ctx.scale(scale, scale);
            ctx.font = m.font;
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'alphabetic';
            if ('letterSpacing' in ctx) {
                ctx.letterSpacing = m.spacing + 'px';
                ctx.fillText(m.text, m.textX, m.baseY);
            } else {
                let x = m.textX;
                for (const ch of m.text) {
                    ctx.fillText(ch, x, m.baseY);
                    x += ctx.measureText(ch).width + m.spacing;
                }
            }
            const rgba = ctx.getImageData(0, 0, w, h).data;
            const alpha = new Uint8ClampedArray(w * h);
            for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];

            const d = signedDistance(alpha, w, h);
            for (let i = 0; i < d.length; i++) d[i] /= scale;
            const smooth = blur3(blur3(d, w, h), w, h);

            const data = new Uint8Array(w * h * 4);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const gx = smooth[y * w + Math.min(w - 1, x + 1)] - smooth[y * w + Math.max(0, x - 1)];
                    const gy = smooth[Math.min(h - 1, y + 1) * w + x] - smooth[Math.max(0, y - 1) * w + x];
                    const len = Math.hypot(gx, gy) || 1;
                    data[i * 4] = Math.round((Math.max(-1, Math.min(1, d[i] / RANGE)) * 0.5 + 0.5) * 255);
                    data[i * 4 + 1] = Math.round((-gx / len * 0.5 + 0.5) * 255);
                    data[i * 4 + 2] = Math.round((-gy / len * 0.5 + 0.5) * 255);
                    data[i * 4 + 3] = 255;
                }
            }
            gl.bindTexture(gl.TEXTURE_2D, sdfTex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        }

        let m = null;

        function render() {
            if (!el.isConnected || !el.offsetWidth || !el.offsetHeight) return;

            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const k = layoutKey() + '|' + dpr;
            if (k !== key) {
                key = k;
                m = measure();
                canvas.style.left = m.left + 'px';
                canvas.style.top = m.top + 'px';
                canvas.style.width = m.w + 'px';
                canvas.style.height = m.h + 'px';
                canvas.width = Math.round(m.w * dpr);
                canvas.height = Math.round(m.h * dpr);
                buildSdf(m);
            }

            // Gdzie na ekranie leży tapeta (object-fit: cover + object-position)
            const ib = img.getBoundingClientRect();
            const ics = getComputedStyle(img);
            const [px, py] = ics.objectPosition.split(' ').map(v => parseFloat(v) / 100);
            const sc = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight);
            const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
            const cover = [ib.left + (ib.width - dw) * (isNaN(px) ? 0.5 : px), ib.top + (ib.height - dh) * (isNaN(py) ? 0.5 : py), dw, dh];
            const cr = canvas.getBoundingClientRect();

            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.enableVertexAttribArray(aLoc);
            gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sdfTex);
            gl.uniform1i(U.sdf, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, bgTex);
            gl.uniform1i(U.bg, 1);
            gl.uniform2f(U.pos, cr.left, cr.top);
            gl.uniform2f(U.size, cr.width, cr.height);
            gl.uniform4f(U.cover, cover[0], cover[1], cover[2], cover[3]);
            gl.uniform2f(U.shade, ib.bottom, ib.height);
            gl.uniform1f(U.range, RANGE);
            gl.uniform1f(U.bevel, Math.max(4, m.size * 0.075));
            gl.uniform1f(U.px, 1 / dpr);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        canvas.addEventListener('webglcontextlost', e => e.preventDefault());
        render();
        return { render, canvas };
    };
})();
