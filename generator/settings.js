/**
 * settings.js — loads and validates settings.toml, and normalizes it into
 * the data object the page templates consume.
 *
 * Design goal: be as forgiving as possible. Students are beginners editing
 * this file in the GitHub web editor, so we accept synonyms for key names,
 * fix letter-case mistakes in file paths, and turn parse failures into
 * plain-English error messages instead of stack traces.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export class SettingsError extends Error {}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[m][n];
}

function closest(word, candidates, maxDistance = 2) {
  let best = null, bestDist = maxDistance + 1;
  for (const c of candidates) {
    const dist = levenshtein(word.toLowerCase(), c.toLowerCase());
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return bestDist <= maxDistance ? best : null;
}

export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents for URL anchors
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function str(v) {
  if (isBlank(v)) return '';
  return String(v).trim();
}

// Lowercase every key recursively so Name, NAME, and name all work.
function lowercaseKeys(value) {
  if (Array.isArray(value)) return value.map(lowercaseKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k.toLowerCase().trim()] = lowercaseKeys(v);
    return out;
  }
  return value;
}

// Pick the first non-blank value among several possible key spellings.
function pick(obj, names) {
  for (const n of names) {
    if (!isBlank(obj[n])) return obj[n];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// TOML parsing with friendly errors
// ---------------------------------------------------------------------------

const COMMON_MISTAKES = `Common causes:
  - A missing quote mark: every piece of text needs quotes on BOTH sides, like  name = "Juan Pérez"
  - A missing equals sign between the setting name and the value
  - A quote inside your text: write \\" instead, like  "She said \\"hello\\" to me"
  - A [[work]] line that lost one of its brackets (it needs two on each side)`;

function friendlyTomlError(err, source) {
  const lines = source.split('\n');
  // smol-toml errors carry .line and .column properties
  let where = '';
  if (typeof err.line === 'number' && err.line >= 1) {
    const text = (lines[err.line - 1] || '').trim();
    where = `\n\nThe problem is on (or just before) line ${err.line}:\n\n    ${text}\n`;
  }
  return new SettingsError(
    `Your settings.toml file has a formatting mistake, so the site could not be built.${where}\n${COMMON_MISTAKES}\n\nOriginal error message (for the curious): ${String(err.message).split('\n')[0]}`
  );
}

// ---------------------------------------------------------------------------
// Media path fixing — forgive wrong letter-case and leading slashes
// ---------------------------------------------------------------------------

function buildMediaIndex(rootDir) {
  const index = new Map(); // lowercase relative path -> actual relative path
  const mediaDir = path.join(rootDir, 'media');
  if (!fs.existsSync(mediaDir)) return index;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        index.set(rel.toLowerCase(), rel);
      }
    }
  };
  walk(mediaDir);
  return index;
}

function resolveMediaPath(value, mediaIndex, warnings, context) {
  let p = str(value);
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p; // full web URL — leave alone
  p = p.replace(/^\.?\//, ''); // "./media/x.jpg" or "/media/x.jpg" -> "media/x.jpg"
  if (!p.toLowerCase().startsWith('media/')) p = 'media/' + p; // "photo.jpg" -> "media/photo.jpg"
  const actual = mediaIndex.get(p.toLowerCase());
  if (actual) return actual;
  warnings.push(`${context}: the file "${p}" was not found in the media folder. That item will appear without it.`);
  return '';
}

// ---------------------------------------------------------------------------
// Social link platform detection
// ---------------------------------------------------------------------------

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', match: /instagram\.com/i },
  { key: 'x', label: 'X (Twitter)', match: /(?:twitter\.com|(?:^|\/\/|\.)x\.com)/i },
  { key: 'linkedin', label: 'LinkedIn', match: /linkedin\.com/i },
  { key: 'facebook', label: 'Facebook', match: /facebook\.com|fb\.com/i },
  { key: 'youtube', label: 'YouTube', match: /youtube\.com|youtu\.be/i },
  { key: 'tiktok', label: 'TikTok', match: /tiktok\.com/i },
  { key: 'github', label: 'GitHub', match: /github\.com/i },
  { key: 'bluesky', label: 'Bluesky', match: /bsky\.app|bsky\.social/i },
  { key: 'threads', label: 'Threads', match: /threads\.(net|com)/i },
  { key: 'mastodon', label: 'Mastodon', match: /mastodon\./i },
  { key: 'medium', label: 'Medium', match: /medium\.com/i },
  { key: 'substack', label: 'Substack', match: /substack\.com/i },
  { key: 'vimeo', label: 'Vimeo', match: /vimeo\.com/i },
  { key: 'flickr', label: 'Flickr', match: /flickr\.com/i },
  { key: 'pinterest', label: 'Pinterest', match: /pinterest\./i },
  { key: 'reddit', label: 'Reddit', match: /reddit\.com/i },
  { key: 'twitch', label: 'Twitch', match: /twitch\.tv/i },
  { key: 'spotify', label: 'Spotify', match: /spotify\.com/i },
  { key: 'soundcloud', label: 'SoundCloud', match: /soundcloud\.com/i },
  { key: 'tumblr', label: 'Tumblr', match: /tumblr\.com/i },
  { key: 'snapchat', label: 'Snapchat', match: /snapchat\.com/i },
  { key: 'discord', label: 'Discord', match: /discord\.(gg|com)/i },
  { key: 'telegram', label: 'Telegram', match: /t\.me|telegram\./i },
  { key: 'whatsapp', label: 'WhatsApp', match: /wa\.me|whatsapp\.com/i },
];

function detectSocial(url) {
  const u = str(url);
  if (!u) return null;
  if (/^mailto:/i.test(u)) return { url: u, platform: 'email', label: 'Email' };
  if (/@/.test(u) && !/^https?:/i.test(u) && !u.includes('/')) {
    // Someone typed a bare email address in the socials list — make it work.
    return { url: `mailto:${u}`, platform: 'email', label: 'Email' };
  }
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  for (const p of PLATFORMS) {
    if (p.match.test(withScheme)) return { url: withScheme, platform: p.key, label: p.label };
  }
  return { url: withScheme, platform: 'website', label: 'Website' };
}

// ---------------------------------------------------------------------------
// Video URL -> embed URL
// ---------------------------------------------------------------------------

export function videoEmbedUrl(url) {
  const u = str(url);
  if (!u) return null;
  let m;
  if ((m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i.exec(u))) {
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }
  if ((m = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(u))) {
    return `https://player.vimeo.com/video/${m[1]}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Work item normalization
// ---------------------------------------------------------------------------

function normalizeWork(raw, i, mediaIndex, warnings) {
  if (typeof raw !== 'object' || raw === null) return null;
  const label = `Work item #${i + 1}` + (raw.title ? ` ("${str(raw.title)}")` : '');

  const knownKeys = ['title', 'description', 'url', 'image', 'date', 'category', 'photos', 'audio', 'video', 'link', 'photo', 'thumbnail', 'summary', 'text', 'caption', 'section', 'type', 'name', 'headline', 'outlet', 'publisher', 'publication'];
  for (const k of Object.keys(raw)) {
    if (!knownKeys.includes(k)) {
      const suggestion = closest(k, knownKeys);
      warnings.push(`${label}: "${k}" is not a setting I recognize${suggestion ? ` — did you mean "${suggestion}"?` : ''}. It was ignored.`);
    }
  }

  const work = {
    title: str(pick(raw, ['title', 'headline', 'name'])),
    description: str(pick(raw, ['description', 'summary', 'text', 'caption'])),
    url: str(pick(raw, ['url', 'link'])),
    date: str(raw.date),
    category: str(pick(raw, ['category', 'section'])),
    // Never rendered on the page — it only feeds the structured data in <head>.
    outlet: str(pick(raw, ['outlet', 'publisher', 'publication'])),
    image: resolveMediaPath(pick(raw, ['image', 'photo', 'thumbnail']), mediaIndex, warnings, label),
    photos: [],
    audio: '',
    video: '',
    videoEmbed: null,
    type: 'plain',
  };

  // Photo essay: photos = ["media/a.jpg | caption", ...] or [[work.photos]] tables
  const rawPhotos = raw.photos;
  if (Array.isArray(rawPhotos)) {
    for (const item of rawPhotos) {
      let src = '', caption = '';
      if (typeof item === 'string') {
        const parts = item.split('|');
        src = parts.shift();
        caption = parts.join('|');
      } else if (item && typeof item === 'object') {
        src = pick(item, ['image', 'photo', 'src', 'file']) || '';
        caption = str(pick(item, ['caption', 'text', 'description']));
      }
      src = resolveMediaPath(src, mediaIndex, warnings, `${label} (photo essay)`);
      if (src) work.photos.push({ src, caption: str(caption) });
    }
  }

  if (!isBlank(raw.audio)) work.audio = resolveMediaPath(raw.audio, mediaIndex, warnings, label);

  if (!isBlank(raw.video)) {
    work.video = str(raw.video);
    work.videoEmbed = videoEmbedUrl(work.video);
    if (!work.videoEmbed) {
      warnings.push(`${label}: I couldn't recognize "${work.video}" as a YouTube or Vimeo link, so clicking this item will open the link directly instead of playing in a pop-up.`);
      if (!work.url) work.url = work.video;
      work.video = '';
    }
  }

  // Decide what happens when a visitor clicks this item.
  if (work.videoEmbed) work.type = 'video';
  else if (work.audio) work.type = 'audio';
  else if (work.photos.length > 0) work.type = 'photo-essay';
  else if (work.url) work.type = 'link';

  // If the item is a photo essay with no thumbnail, borrow the first photo.
  if (!work.image && work.photos.length > 0) work.image = work.photos[0].src;

  // A completely empty [[work]] block gets skipped quietly.
  if (!work.title && !work.description && !work.image && work.type === 'plain') return null;

  return work;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function loadSettings(rootDir, availableTemplates) {
  const warnings = [];
  const settingsPath = path.join(rootDir, 'settings.toml');
  if (!fs.existsSync(settingsPath)) {
    throw new SettingsError('I could not find the settings.toml file. It should be in the main folder of your repository, named exactly "settings.toml".');
  }

  const source = fs.readFileSync(settingsPath, 'utf8');
  let raw;
  try {
    raw = parseToml(source);
  } catch (err) {
    throw friendlyTomlError(err, source);
  }
  raw = lowercaseKeys(raw);

  const mediaIndex = buildMediaIndex(rootDir);

  // --- warn about unknown top-level keys (typo protection) -----------------
  const topLevelKeys = [
    'name', 'tagline', 'bio', 'location', 'email', 'phone', 'socials', 'social',
    'banner_photo', 'banner', 'photo', 'portrait', 'resume', 'cv', 'favicon',
    'footer', 'template', 'work', 'works', 'portfolio', 'colors', 'fonts',
    'job_title', 'jobtitle', 'job', 'role', 'employer', 'organization', 'affiliation',
    'title', 'description', 'intro', 'introduction', 'about',
  ];
  for (const k of Object.keys(raw)) {
    if (!topLevelKeys.includes(k)) {
      const suggestion = closest(k, topLevelKeys);
      warnings.push(`"${k}" is not a setting I recognize${suggestion ? ` — did you mean "${suggestion}"?` : ''}. It was ignored.`);
    }
  }

  // --- required: name ------------------------------------------------------
  const name = str(pick(raw, ['name', 'title']));
  if (!name) {
    throw new SettingsError('Your settings.toml file is missing a name. Near the top of the file, make sure there is a line like:\n\n    name = "Your Full Name"');
  }

  // --- template ------------------------------------------------------------
  let template = str(raw.template) || availableTemplates[0];
  const exact = availableTemplates.find((t) => t.toLowerCase() === template.toLowerCase());
  if (exact) {
    template = exact;
  } else {
    const guess = closest(template, availableTemplates);
    if (guess) {
      warnings.push(`Template "${template}" doesn't exist — I assumed you meant "${guess}".`);
      template = guess;
    } else {
      throw new SettingsError(`Template "${template}" doesn't exist. Choose one of: ${availableTemplates.join(', ')}.\n\nIn settings.toml the line should look like:\n\n    template = "${availableTemplates[0]}"`);
    }
  }

  // --- bio -> paragraphs ---------------------------------------------------
  const bioRaw = str(pick(raw, ['bio', 'about']));
  const bio = bioRaw
    ? bioRaw.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
    : [];

  // --- socials -------------------------------------------------------------
  let socialsRaw = pick(raw, ['socials', 'social']) || [];
  if (typeof socialsRaw === 'string') socialsRaw = [socialsRaw];
  const socials = [];
  if (Array.isArray(socialsRaw)) {
    for (const s of socialsRaw) {
      const detected = detectSocial(typeof s === 'object' && s !== null ? pick(s, ['url', 'link']) : s);
      if (detected) {
        if (typeof s === 'object' && s !== null && !isBlank(s.label)) detected.label = str(s.label);
        socials.push(detected);
      }
    }
  } else {
    warnings.push('The "socials" setting should be a list inside square brackets — see the example in the README. It was ignored.');
  }

  // --- simple fields -------------------------------------------------------
  const email = str(raw.email);
  const phone = str(raw.phone);
  const location = str(raw.location);
  const tagline = str(pick(raw, ['tagline', 'description', 'intro', 'introduction']));
  // Search-engine only: these two never appear anywhere on the rendered page.
  const jobTitle = str(pick(raw, ['job_title', 'jobtitle', 'job', 'role']));
  const employer = str(pick(raw, ['employer', 'organization', 'affiliation']));
  const banner = resolveMediaPath(pick(raw, ['banner_photo', 'banner', 'photo', 'portrait']), mediaIndex, warnings, 'Banner photo');
  const resume = resolveMediaPath(pick(raw, ['resume', 'cv']), mediaIndex, warnings, 'Resume');
  const favicon = resolveMediaPath(raw.favicon, mediaIndex, warnings, 'Favicon');
  const footer = str(raw.footer);

  // --- colors & fonts (optional overrides) ---------------------------------
  const colors = {};
  if (raw.colors && typeof raw.colors === 'object') {
    for (const key of ['accent', 'background', 'text']) {
      const v = str(raw.colors[key]);
      if (v) colors[key] = v;
    }
    for (const k of Object.keys(raw.colors)) {
      if (!['accent', 'background', 'text'].includes(k)) {
        const suggestion = closest(k, ['accent', 'background', 'text']);
        warnings.push(`[colors]: "${k}" is not a color I recognize${suggestion ? ` — did you mean "${suggestion}"?` : ''}. The options are accent, background, and text.`);
      }
    }
  }
  const fonts = {};
  if (raw.fonts && typeof raw.fonts === 'object') {
    for (const key of ['heading', 'body']) {
      const v = str(raw.fonts[key]);
      if (v) fonts[key] = v;
    }
  }

  // --- works, grouped by category -----------------------------------------
  let worksRaw = pick(raw, ['work', 'works', 'portfolio']) || [];
  if (!Array.isArray(worksRaw)) worksRaw = [worksRaw];
  const works = [];
  worksRaw.forEach((w, i) => {
    const normalized = normalizeWork(w, i, mediaIndex, warnings);
    if (normalized) works.push(normalized);
  });
  works.forEach((w, i) => { w.id = `work-${i + 1}`; });

  const categories = [];
  const catMap = new Map();
  for (const w of works) {
    const catName = w.category || 'Works';
    const key = catName.toLowerCase();
    if (!catMap.has(key)) {
      const cat = { name: catName, slug: 'work-' + slugify(catName), works: [] };
      catMap.set(key, cat);
      categories.push(cat);
    }
    catMap.get(key).works.push(w);
  }

  // --- navigation ----------------------------------------------------------
  const hasAbout = bio.length > 0;
  const hasContact = Boolean(email || phone || socials.length > 0);
  const nav = [];
  if (hasAbout) nav.push({ label: 'About', href: '#about' });
  for (const cat of categories) nav.push({ label: cat.name, href: `#${cat.slug}` });
  if (hasContact) nav.push({ label: 'Contact', href: '#contact' });

  return {
    settings: {
      name, tagline, bio, location, email, phone, socials,
      jobTitle, employer,
      banner, resume, favicon, footer, template, colors, fonts,
      works, categories, nav,
      hasAbout, hasContact,
      hasWork: works.length > 0,
      hasModals: works.some((w) => ['video', 'audio', 'photo-essay'].includes(w.type)),
      year: new Date().getFullYear(),
    },
    warnings,
  };
}
