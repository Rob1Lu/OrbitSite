#!/usr/bin/env node
// Compiles orbit-site/index.html (JSX + dev React) → dist/index.html (compiled JS + React prod)

const fs = require('fs');
const path = require('path');
const { transformSync } = require('@babel/core');
const { minify } = require('terser');

const SRC = path.join(__dirname, 'index.html');
const DIST_DIR = path.join(__dirname, 'dist');
const DIST = path.join(DIST_DIR, 'index.html');

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

  // ── 4. Replace JSX script block with compiled JS (before other edits) ────
  html = html.replace(fullBabelBlock, `<script>\n${minified}\n</script>`);

  // ── 5. Swap React dev → prod CDN ─────────────────────────────────────────
  html = html.replace(
    'https://unpkg.com/react@18.3.1/umd/react.development.js',
    'https://unpkg.com/react@18.3.1/umd/react.production.min.js'
  );
  html = html.replace(
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js',
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'
  );

  // ── 6. Remove Babel standalone ───────────────────────────────────────────
  html = html.replace(
    /\n?<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>/,
    ''
  );

  // ── 7. Lazy-load below-fold images ───────────────────────────────────────
  // Images set via src="" in static HTML (not React-rendered) get loading=lazy
  // React-rendered images are handled at runtime and are below fold anyway
  html = html.replace(/<img (?!.*loading=)/g, '<img loading="lazy" ');

  // ── 9. Add resource hints before </head> ─────────────────────────────────
  const resourceHints = `
  <link rel="preconnect" href="https://unpkg.com" crossorigin />
  <link rel="dns-prefetch" href="https://unpkg.com" />`;
  html = html.replace('</head>', `${resourceHints}\n</head>`);

  // ── 10. Write dist ───────────────────────────────────────────────────────
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // Copy assets
  const assetsDir = path.join(__dirname, 'assets');
  if (fs.existsSync(assetsDir)) {
    const distAssets = path.join(DIST_DIR, 'assets');
    fs.mkdirSync(distAssets, { recursive: true });
    for (const f of fs.readdirSync(assetsDir)) {
      fs.copyFileSync(path.join(assetsDir, f), path.join(distAssets, f));
    }
  }

  // Copy CNAME if present (needed for custom domain on GitHub Pages)
  const cname = path.join(__dirname, 'CNAME');
  if (fs.existsSync(cname)) {
    fs.copyFileSync(cname, path.join(DIST_DIR, 'CNAME'));
  }

  fs.writeFileSync(DIST, html, 'utf-8');

  const srcSize = Buffer.byteLength(jsx, 'utf-8');
  const dstSize = Buffer.byteLength(minified, 'utf-8');
  console.log(`✓  JSX compiled & minified: ${kb(srcSize)} → ${kb(dstSize)}`);
  console.log(`✓  dist/index.html written (${kb(Buffer.byteLength(html, 'utf-8'))})`);
  console.log(`✓  Babel standalone removed (~7 MB saved)`);
  console.log(`✓  React: development → production.min (~4.8 MB saved)`);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

build().catch(err => { console.error(err); process.exit(1); });
