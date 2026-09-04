/**
 * build.js — generates the static site into _site/
 *
 * Usage: node generator/build.js
 *
 * Steps:
 *   1. Load and validate settings.toml (see settings.js)
 *   2. Copy the media/ folder into _site/, optimizing images along the way
 *   3. Render the chosen template with Nunjucks
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import { loadSettings, SettingsError } from './settings.js';
import { buildJsonLd } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const ASSETS_DIR = path.join(__dirname, 'assets');
const OUT = path.join(ROOT, '_site');

// Images wider than this get resized down; quality settings keep files small.
const MAX_IMAGE_WIDTH = 1800;
const JPEG_QUALITY = 80;
const WEBP_QUALITY = 80;

// ---------------------------------------------------------------------------

export function availableTemplates() {
  return fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

function readTemplateMeta(name) {
  const metaPath = path.join(TEMPLATES_DIR, name, 'template.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return meta;
}

// --- Google Fonts URL ------------------------------------------------------

function googleFontsUrl(meta, fontOverrides) {
  const families = [...(meta.googleFonts || [])];
  for (const fontName of Object.values(fontOverrides)) {
    // Bare family name: Google serves whatever weights the font has at its
    // default, and never rejects the request. (Weight-specific URLs return
    // a 400 error when a font lacks that exact weight, which would silently
    // break ALL fonts on the page — not worth the risk for user overrides.)
    families.push(fontName.trim().replace(/\s+/g, '+'));
  }
  if (families.length === 0) return null;
  const params = families.map((f) => `family=${f}`).join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

function fontStack(fontName, fallback) {
  return `'${fontName.trim()}', ${fallback}`;
}

// --- media copying + image optimization ------------------------------------

async function copyMedia(onWarning) {
  const src = path.join(ROOT, 'media');
  if (!fs.existsSync(src)) return;
  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    onWarning('Image optimizer (sharp) is not available — copying images at their original size.');
  }

  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) continue;
      const rel = path.relative(ROOT, full);
      const dest = path.join(OUT, rel);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        await walk(full);
        continue;
      }
      // Skip if the copied file is already newer than the source (fast rebuilds)
      try {
        const s = fs.statSync(full), d = fs.statSync(dest);
        if (d.mtimeMs >= s.mtimeMs) continue;
      } catch { /* dest doesn't exist yet */ }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const ext = path.extname(entry.name).toLowerCase();
      const optimizable = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      if (sharp && optimizable) {
        try {
          let img = sharp(full).rotate(); // .rotate() honors phone EXIF orientation
          const meta = await img.metadata();
          if ((meta.width || 0) > MAX_IMAGE_WIDTH) img = img.resize({ width: MAX_IMAGE_WIDTH });
          if (ext === '.png') img = img.png({ compressionLevel: 9 });
          else if (ext === '.webp') img = img.webp({ quality: WEBP_QUALITY });
          else img = img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
          await img.toFile(dest);
          continue;
        } catch (err) {
          onWarning(`Could not optimize image "${rel}" (${err.message}) — copied as-is.`);
        }
      }
      fs.copyFileSync(full, dest);
    }
  };
  await walk(src);
}

// --- default favicon: student's initials on an accent-colored tile ---------

function defaultFaviconSvg(name, accentColor) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="${accentColor}"/>
  <text x="32" y="42" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle">${initials}</text>
</svg>`;
}

// ---------------------------------------------------------------------------

export async function build({ quiet = false } = {}) {
  const log = quiet ? () => {} : (msg) => console.log(msg);
  const warnings = [];
  const templates = availableTemplates();

  const { settings, warnings: settingsWarnings } = loadSettings(ROOT, templates);
  warnings.push(...settingsWarnings);

  const meta = readTemplateMeta(settings.template);

  // Merge template defaults with the student's overrides.
  const colors = { ...meta.colors, ...settings.colors };
  const fonts = {
    heading: settings.fonts.heading ? fontStack(settings.fonts.heading, meta.fontFallbacks?.heading || 'sans-serif') : meta.fonts.heading,
    body: settings.fonts.body ? fontStack(settings.fonts.body, meta.fontFallbacks?.body || 'sans-serif') : meta.fonts.body,
  };
  const fontsUrl = googleFontsUrl(meta, settings.fonts);

  fs.rmSync(path.join(OUT, 'index.html'), { force: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

  // Copy shared assets + this template's stylesheet
  for (const asset of ['bootstrap-grid.min.css', 'shared.css', 'site.js']) {
    fs.copyFileSync(path.join(ASSETS_DIR, asset), path.join(OUT, 'assets', asset));
  }
  fs.copyFileSync(path.join(TEMPLATES_DIR, settings.template, 'style.css'), path.join(OUT, 'assets', 'template.css'));

  // Favicon: student's own file, or a generated initials tile
  let faviconHref = settings.favicon;
  if (!faviconHref) {
    fs.writeFileSync(path.join(OUT, 'assets', 'favicon.svg'), defaultFaviconSvg(settings.name, colors.accent || '#333333'));
    faviconHref = 'assets/favicon.svg';
  }

  await copyMedia((w) => warnings.push(w));

  // Render
  const env = nunjucks.configure(TEMPLATES_DIR, { autoescape: true, throwOnUndefined: false });
  env.addFilter('slug', (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  // Splits a tagline into its sentences so a template can set each on its own
  // line. A tagline with no periods simply comes back as a single line.
  env.addFilter('sentences', (s) => String(s || '').split(/(?<=[.!?])\s+/).filter(Boolean));
  const iconCache = new Map();
  env.addGlobal('icon', (name) => {
    if (!iconCache.has(name)) {
      const file = path.join(ASSETS_DIR, 'icons', `${name}.svg`);
      const fallback = path.join(ASSETS_DIR, 'icons', 'website.svg');
      let svg = fs.readFileSync(fs.existsSync(file) ? file : fallback, 'utf8').trim();
      svg = svg.replace('<svg ', '<svg class="icon" fill="currentColor" aria-hidden="true" focusable="false" ');
      iconCache.set(name, svg);
    }
    return new nunjucks.runtime.SafeString(iconCache.get(name));
  });
  // Absolute site URL (known when building on GitHub Actions; blank locally)
  let siteUrl = '';
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    siteUrl = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? `https://${repo.toLowerCase()}/`
      : `https://${owner.toLowerCase()}.github.io/${repo}/`;
  }

  const html = env.render(path.join(settings.template, 'template.njk').split(path.sep).join('/'), {
    site: settings,
    meta,
    colors,
    fonts,
    fontsUrl,
    faviconHref,
    siteUrl,
    jsonld: buildJsonLd(settings, siteUrl),
  });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  // A .nojekyll file tells GitHub Pages not to run its own build system.
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  log(`✓ Built "${settings.name}" with the ${settings.template} template → _site/index.html`);
  for (const w of warnings) log(`  ⚠ ${w}`);
  return { settings, warnings };
}

// Run directly?
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    if (err instanceof SettingsError) {
      console.error('\n──────────────────────────────────────────────');
      console.error('  PROBLEM WITH YOUR SETTINGS FILE');
      console.error('──────────────────────────────────────────────\n');
      console.error(err.message);
      console.error('');
      // GitHub Actions annotation — shows the message prominently in the web UI
      if (process.env.GITHUB_ACTIONS) {
        console.error(`::error title=Problem with settings.toml::${err.message.replace(/\n/g, '%0A')}`);
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
