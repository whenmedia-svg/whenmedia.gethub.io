# Adding a new template

This guide is for instructors/maintainers, not students.

Each template is a folder inside `generator/templates/` containing exactly
three files. The folder's name is what students type in `settings.toml`
(`template = "yourname"`), so keep it short and lowercase.

```
generator/templates/
  yourname/
    template.json   ← metadata: fonts, default colors
    template.njk    ← page structure (Nunjucks)
    style.css       ← the template's look
```

Folders starting with `_` are ignored (that's where the shared partials live).
Drop in a new folder and it's instantly available — the build discovers
templates automatically, and the settings validator accepts the new name.

## 1. template.json

```json
{
  "displayName": "Your Name",
  "description": "One sentence used in docs.",
  "fonts": {
    "heading": "'Some Font', Georgia, serif",
    "body": "'Other Font', Georgia, serif"
  },
  "fontFallbacks": { "heading": "serif", "body": "serif" },
  "googleFonts": ["Some+Font:wght@400;700", "Other+Font:ital,wght@0,400;1,400"],
  "colors": { "accent": "#8f2d1e", "background": "#faf3e7", "text": "#2e2a24" }
}
```

- `googleFonts` entries are the `family=` values of a Google Fonts CSS2 URL.
  Test the final URL in a browser — a wrong weight makes Google return a 400
  error for the *entire* request.
- `colors` are the template defaults; students can override any of them from
  `settings.toml`, so **your CSS must use the variables** (see below), never
  hard-coded colors for accent/background/text.

## 2. template.njk

Extend the shared base and compose from the shared macros:

```njk
{% extends "_shared/base.njk" %}
{% import "_shared/social.njk" as social %}
{% import "_shared/work.njk" as work %}
{% import "_shared/footer.njk" as footer %}

{% block page %}
  <header> ... your masthead ... </header>

  {% if site.hasAbout %} ... bio section with id="about" ... {% endif %}

  {% if site.hasWork %}
    {{ work.cardSections(site.categories, cols=3) }}   {# card grid #}
    {# or: {{ work.rowSections(site.categories) }}      full-width rows #}
  {% endif %}

  {{ footer.contactSection(site) }}
  {{ footer.siteFooter(site) }}
{% endblock %}
```

The base template automatically injects `<head>` (fonts, CSS, meta tags), the
modal pop-ups for photo essays / audio / video, and `site.js`. You never write
modal markup yourself — any work item with local media gets a working modal as
long as you render it through the shared `work.*` macros.

### The data you can use

`site.` fields: `name`, `tagline`, `location`, `bio` (array of paragraphs),
`email`, `phone`, `socials`, `banner`, `resume`, `favicon`, `footer`,
`categories` (each: `name`, `slug`, `works`), `nav` (each: `label`, `href`),
plus booleans `hasAbout`, `hasContact`, `hasWork`. Every field can be empty —
guard sections with `{% if %}` so the template degrades gracefully.

`site.jobTitle`, `site.employer` and each work's `outlet` are deliberately
**not** rendered by any template. They exist only to feed the JSON-LD block
that `generator/schema.js` builds and `_shared/head.njk` injects, and the
README promises students they stay invisible. Leave them out of your markup.

Section `id`s must match the nav: use `id="about"`, `id="contact"`, and let
`work.cardSections`/`rowSections` handle the category ids.

## 3. style.css

It's loaded after `shared.css` (base styles, social icons, modal styling) and
Bootstrap's grid. Honor the CSS variables — they're how student overrides
work:

```css
body { background: var(--color-bg); color: var(--color-text); }
h1   { font-family: var(--font-heading); }
a    { color: var(--color-accent); }
```

Style the shared class names the macros emit: `.section-heading`,
`.work-card`, `.work-card-media`, `.work-card-body`, `.work-kicker`,
`.work-title`, `.work-desc`, `.media-badge`, `.contact-section`,
`.social-links`, `.site-footer` (and `.work-row`, `.work-row-body` if you use
the rows layout).

## 4. Test it

```bash
npm run dev                 # then set template = "yourname" in settings.toml
```

Check: a work item with no image, no title, or no description; a settings
file with no bio/banner/socials; a phone-width window; and each modal type.
