/**
 * schema.js — builds the JSON-LD (schema.org) block injected into <head>.
 *
 * Why JSON-LD and not microdata: microdata means sprinkling attributes through
 * every template's markup, which would mean maintaining the same annotations in
 * eight different designs. JSON-LD lives in one <script> tag in the shared head
 * partial, so all templates get identical, correct structured data for free.
 *
 * What it is for: search engines and AI answer engines use this to work out that
 * the person on this page is the same person bylined elsewhere. The "sameAs"
 * list (the student's social links) is what ties those identities together.
 *
 * Design rules for this file:
 *   1. Never invent data. Every property is omitted unless we actually have it.
 *   2. Never emit a relative URL. Absolute ones require siteUrl, which is only
 *      known on GitHub Actions, so those properties drop out of local builds.
 *   3. Never guess a date. Free-text dates that don't parse are left out.
 */

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * Turns the friendly dates students write ("March 2026") into ISO 8601, which
 * is the only format schema.org consumers understand. Anything ambiguous
 * ("Fall 2025", "Summer") returns '' so the property is simply left off.
 */
export function isoDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';

  // Already ISO: 2026-03-15, 2026-03, 2026
  let m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    if (d) return `${y}-${pad(mo)}-${pad(d)}`;
    if (mo) return `${y}-${pad(mo)}`;
    return y;
  }

  // "March 15, 2026" / "15 March 2026" / "March 2026"
  m = /^([A-Za-z]+)\.?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mo = MONTHS[m[1].toLowerCase()];
    return m[2] ? `${m[3]}-${pad(mo)}-${pad(m[2])}` : `${m[3]}-${pad(mo)}`;
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  }

  // "3/15/2026" — read as US month/day/year, the format students here will use.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;

  return '';
}

// Media paths are stored relative ("media/x.jpg"); schema.org wants absolute.
function absolute(siteUrl, p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (!siteUrl) return '';
  return siteUrl.replace(/\/$/, '') + '/' + p.replace(/^\//, '');
}

function audioMimeType(p) {
  const ext = (p.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  return { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg' }[ext] || '';
}

// Drops keys whose value is empty, so no property is ever emitted as a blank.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// One node per portfolio item
// ---------------------------------------------------------------------------

function workNode(w, siteUrl, personRef) {
  const base = compact({
    '@id': `#${w.id}`,
    description: w.description,
    author: personRef,
    datePublished: isoDate(w.date),
    publisher: w.outlet ? { '@type': 'Organization', name: w.outlet } : '',
    image: absolute(siteUrl, w.image),
  });

  if (w.type === 'video') {
    return compact({
      '@type': 'VideoObject',
      ...base,
      name: w.title,
      url: w.video,
      embedUrl: w.videoEmbed,
      thumbnailUrl: base.image,
      uploadDate: base.datePublished,
    });
  }

  if (w.type === 'audio') {
    return compact({
      '@type': 'AudioObject',
      ...base,
      name: w.title,
      contentUrl: absolute(siteUrl, w.audio),
      encodingFormat: audioMimeType(w.audio),
    });
  }

  if (w.type === 'photo-essay') {
    return compact({
      '@type': 'ImageGallery',
      ...base,
      name: w.title,
      image: w.photos
        .map((p) => compact({
          '@type': 'ImageObject',
          contentUrl: absolute(siteUrl, p.src),
          caption: p.caption,
        }))
        .filter((p) => p.contentUrl),
    });
  }

  // Everything else is a published piece. "Article" rather than "NewsArticle":
  // categories here range from reporting to design to podcasts, and Article is
  // true of all of them. The authorship link is what matters, and both carry it.
  return compact({
    '@type': 'Article',
    ...base,
    headline: w.title,
    url: w.url,
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Returns the JSON-LD as a string ready to drop inside a <script> tag, or ''
 * if there is nothing worth saying.
 */
export function buildJsonLd(site, siteUrl = '') {
  if (!site.name) return '';

  const personRef = { '@id': '#person' };
  const graph = [];

  const person = compact({
    '@type': 'Person',
    '@id': '#person',
    name: site.name,
    description: site.tagline || site.bio[0] || '',
    jobTitle: site.jobTitle,
    worksFor: site.employer ? { '@type': 'Organization', name: site.employer } : '',
    image: absolute(siteUrl, site.banner),
    email: site.email,
    telephone: site.phone,
    url: siteUrl,
    // sameAs is the payoff: it tells search engines that this person and the
    // person behind each of these profiles are one and the same.
    sameAs: site.socials.filter((s) => s.platform !== 'email').map((s) => s.url),
  });

  const page = compact({
    '@type': 'ProfilePage',
    '@id': '#webpage',
    url: siteUrl,
    name: site.name + (site.tagline ? ` — ${site.tagline}` : ''),
    inLanguage: 'en',
    mainEntity: personRef,
    isPartOf: siteUrl ? { '@id': '#website' } : '',
    hasPart: site.works.map((w) => ({ '@id': `#${w.id}` })),
  });

  graph.push(page, person);

  if (siteUrl) {
    graph.push({
      '@type': 'WebSite',
      '@id': '#website',
      url: siteUrl,
      name: site.name,
      inLanguage: 'en',
    });
  }

  for (const w of site.works) graph.push(workNode(w, siteUrl, personRef));

  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);

  // A bio containing "</script>" would otherwise break out of the tag. These
  // escapes are legal JSON and legal JavaScript, so the payload is unchanged.
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
