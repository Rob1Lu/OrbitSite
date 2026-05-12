#!/usr/bin/env node
// Compiles orbit-site/index.html (JSX + dev React) → dist/index.html
// Replaces React CDN (~139 KB) with inline Preact (~10 KB)

const fs = require('fs');
const path = require('path');
const { transformSync } = require('@babel/core');
const { minify } = require('terser');

const SRC = path.join(__dirname, 'index.html');
const DIST_DIR = path.join(__dirname, 'dist');
const DIST = path.join(DIST_DIR, 'index.html');
const NM = path.join(__dirname, 'node_modules/preact');

async function build() {
  const src = fs.readFileSync(SRC, 'utf-8');
  let html = src;

  // ── 1. Extract JSX script ────────────────────────────────────────────────
  const BABEL_OPEN = '<script type="text/babel">';
  const BABEL_CLOSE = '\n</script>';
  const babelOpenIdx = src.indexOf(BABEL_OPEN);
  if (babelOpenIdx === -1) throw new Error('No <script type="text/babel"> found');
  const jsxStart = babelOpenIdx + BABEL_OPEN.length;
  const jsxEnd = src.indexOf(BABEL_CLOSE, jsxStart);
  const jsx = src.slice(jsxStart, jsxEnd);
  const fullBabelBlock = src.slice(babelOpenIdx, jsxEnd + BABEL_CLOSE.length);

  // ── 2. Compile JSX → JS ──────────────────────────────────────────────────
  const { code: compiled } = transformSync(jsx, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    sourceMaps: false,
    compact: false,
  });

  // ── 3. Minify compiled JS ────────────────────────────────────────────────
  const { code: minified } = await minify(compiled, {
    compress: { drop_console: false },
    mangle: true,
  });

  // ── 4. Replace JSX script block with compiled JS ─────────────────────────
  html = html.replace(fullBabelBlock, `<script>\n${minified}\n</script>`);

  // ── 5. Build inline Preact bundle (replaces React CDN scripts) ────────────
  // preact.min.umd.js is already minified; hooks + compat need minification
  const preactCore = fs.readFileSync(path.join(NM, 'dist/preact.min.umd.js'), 'utf-8');
  const hooksRaw   = fs.readFileSync(path.join(NM, 'hooks/dist/hooks.umd.js'), 'utf-8');
  const compatRaw  = fs.readFileSync(path.join(NM, 'compat/dist/compat.umd.js'), 'utf-8');
  const { code: preactMin } = await minify(preactCore + '\n' + hooksRaw + '\n' + compatRaw, {
    compress: true, mangle: true,
  });
  // preactCompat.render(vnode, container) is the legacy API;
  // React 18's createRoot(el).render(vnode) needs a small shim
  const alias = 'window.React=preactCompat;window.ReactDOM={createRoot:function(el){return{render:function(c){preactCompat.render(c,el)}}}};';
  const inlinePreact = `<script>\n${preactMin}\n${alias}\n</script>`;

  // Replace react.development.js tag with inline preact.
  // Use a replacer function (not string) to prevent $& special patterns in
  // preact's CSS transform code ("-$&") from being interpreted by replace().
  html = html.replace(
    /<script src="https:\/\/unpkg\.com\/react@[^"]*"[^>]*><\/script>/,
    () => inlinePreact
  );
  // Remove react-dom tag
  html = html.replace(
    /\n?<script src="https:\/\/unpkg\.com\/react-dom@[^"]*"[^>]*><\/script>/,
    ''
  );
  // Remove Babel standalone
  html = html.replace(
    /\n?<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>/,
    ''
  );

  // ── 6. Lazy-load below-fold images ───────────────────────────────────────
  html = html.replace(/<img (?!.*loading=)/g, '<img loading="lazy" ');

  // ── 7. Add resource hints before </head> ─────────────────────────────────
  const resourceHints = `  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`;
  // fonts preconnect is already in source; this is a no-op guard

  // ── 8. Write dist ────────────────────────────────────────────────────────
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const assetsDir = path.join(__dirname, 'assets');
  if (fs.existsSync(assetsDir)) {
    const distAssets = path.join(DIST_DIR, 'assets');
    fs.mkdirSync(distAssets, { recursive: true });
    for (const f of fs.readdirSync(assetsDir)) {
      fs.copyFileSync(path.join(assetsDir, f), path.join(distAssets, f));
    }
  }

  const cname = path.join(__dirname, 'CNAME');
  if (fs.existsSync(cname)) fs.copyFileSync(cname, path.join(DIST_DIR, 'CNAME'));

  fs.writeFileSync(DIST, html, 'utf-8');

  const preactSize = Buffer.byteLength(preactMin, 'utf-8');
  const jsxSize = Buffer.byteLength(jsx, 'utf-8');
  const appSize = Buffer.byteLength(minified, 'utf-8');
  console.log(`✓  JSX compiled & minified: ${kb(jsxSize)} → ${kb(appSize)}`);
  console.log(`✓  Preact inlined: ${kb(preactSize)} (replaced React CDN ~139 KB)`);
  console.log(`✓  0 external JS requests`);
  console.log(`✓  dist/index.html written (${kb(Buffer.byteLength(html, 'utf-8'))})`);
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;

build().catch(err => { console.error(err); process.exit(1); });
