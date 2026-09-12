# CSE Platform — Design System

Authoritative. Do not invent colours, sizes or spacing — everything is defined
here. If something is missing, add it here first, then use it.

**Direction:** deep black, CSE red, large real photography, one handwritten
accent. Serious German trade group — confident, not futuristic. Nothing glows,
nothing floats in space, no neon gradients.

---

## 1. Colour

### Foundation — dark-first

The platform is dark by default: public site and portal both. A light theme is
out of scope for now.

```css
--ink:            #08080A;   /* page background */
--surface:        #101013;   /* cards, panels */
--surface-2:      #17171B;   /* raised: modals, dropdowns, hover */
--surface-3:      #1F1F24;   /* input fields, inactive pills */
--border:         #26262C;   /* default hairline */
--border-strong:  #34343C;   /* emphasised divider */

--text:           #FAFAFA;   /* primary */
--text-muted:     #A1A1AA;   /* secondary, labels */
--text-subtle:    #8B8B95;   /* meta, timestamps, placeholders */

--white:          #FFFFFF;
```

### Brand

```css
--red:            #E30613;   /* CSE red — primary action, brand accent */
--red-hover:      #C10510;
--red-press:      #A00409;
--red-soft:       rgba(227, 6, 19, 0.12);   /* tint backgrounds */
--red-ring:       rgba(227, 6, 19, 0.40);   /* focus rings */
```

`// TODO(client)`: replace `--red` with the exact value sampled from the
official CSE logo file. Everything else derives from it.

**Red is scarce.** Primary buttons, the active nav indicator, one accent word
in a headline, link arrows. Never a red card background, never red body text,
never two red buttons in one view.

### Business-area identity

Red is the group brand. Each area gets its own **identity hue**, used *only*
for identification — the switcher ring, the tenant strip, the area badge, chart
series. **Never for buttons.**

```css
--area-reinigung:  #E30613;   /* CSE Dienstleistung — red */
--area-security:   #2F6BFF;   /* SSE Security — steel blue */
--area-bau:        #F59E0B;   /* REALTIME Service — amber */
--area-operations: #8B5CF6;   /* CSE Operations — violet */
```

Reason: with a single red across four entities, a user working in three of them
cannot tell at a glance which one they are in — and that is exactly the mistake
that puts an invoice in the wrong GmbH.

### Semantic

```css
--success: #22C55E;   --success-soft: rgba(34,197,94,0.12);
--warning: #F59E0B;   --warning-soft: rgba(245,158,11,0.12);
--danger:  #F26A6A;   --danger-soft:  rgba(239,68,68,0.12);
--info:    #5895F7;   --info-soft:    rgba(59,130,246,0.12);

--danger-strong: #DC2626;   /* solid danger SURFACE, white text on it */
```

Status pills use `-soft` background + solid text. Never solid fills.

**Why `--danger` and `--info` are lighter than the `-soft` colour they sit on.**
The pill rule above says solid text on a `-soft` background. `-soft` is 12%
alpha, so the pill's real background is almost the surface beneath it — and a
pill sits on cards, not only on `--surface`. Measured against
`--surface-3`-backed soft, the original `#EF4444` and `#3B82F6` gave **3.86:1**
each and failed AA for the 13px pill text; on plain `--surface` they were
4.53 and 4.55, one rounding from the same failure. The values above are the
same hues lightened until the worst of the three surfaces clears **4.7:1**
(danger 4.88, info 4.77). `--success` (5.88) and `--warning` (6.16) already
did and are unchanged. The measurement is in DECISIONS.md.

**Why `--danger` has a second, darker value.** `--danger` is tuned to be read
*as text* on `--danger-soft` and on the dark surfaces — it has to be light. The
danger *button* is the opposite case: white text on a solid fill. White on
`--danger` is **2.98:1** and fails AA for body-sized text, so a solid danger
surface uses `--danger-strong` (**4.83:1**). One token cannot do both jobs, and
the button is the one where the failure is a legal problem rather than a
cosmetic one (§9, BFSG).

---

## 2. Typography

```css
--font-sans:   'Inter', system-ui, sans-serif;    /* everything */
--font-script: 'Caveat', cursive;                 /* accent only */
```

**Scale** — `rem`, 16px base:

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 56 / 60 | 700 | hero headline |
| `h1` | 40 / 46 | 700 | page title |
| `h2` | 30 / 38 | 600 | section |
| `h3` | 22 / 30 | 600 | card title |
| `lg` | 18 / 28 | 400 | lead paragraph |
| `base` | 16 / 26 | 400 | body |
| `sm` | 14 / 22 | 400 | table, secondary |
| `xs` | 13 / 18 | 500 | labels, meta |
| `micro` | 11 / 14 | 600 | uppercase eyebrow, `0.08em` tracking |

Mobile: `display` → 36/40, `h1` → 30/36, `h2` → 24/30.

**Headline rule:** one accent word in red per headline, no more.
*Eine Gruppe.* **Vier** *starke Marken.*

**The script face** appears at most **once per page**, rotated ~-6°, in
`--text-muted` or white — the pen-note on the hero, the sign-off in the footer.
Never in the portal. Never on a button. It is a signature, not a font choice.

---

## 3. Spacing, radius, elevation

```css
/* 4px base */
--s1:4px  --s2:8px   --s3:12px  --s4:16px  --s5:24px
--s6:32px --s7:48px  --s8:64px  --s9:96px  --s10:128px

--r-sm:6px  --r-md:10px  --r-lg:14px  --r-xl:20px  --r-full:9999px
```

Section padding: `--s9` desktop, `--s7` mobile. Card padding: `--s5`.
Grid gap: `--s4` compact, `--s5` default.

**Elevation on dark comes from borders and surface steps, not shadow.**
Shadow only on genuinely floating layers:

```css
--shadow-pop: 0 12px 32px rgba(0,0,0,0.55);   /* dropdown, modal */
```

Content max width `1280px`; long-form text max `72ch`.

---

## 4. Photography

The mockups are image-led and that is correct — this business is physical. Get
the images right and the design carries itself.

**Rules:**

1. **Real photographs of their own crews, sites and projects.** They have
   genuine references worth showing. Placeholder imagery only until the client
   supplies theirs — and marked as placeholder in the code.

   **What a placeholder looks like, and why it is not a drawing.** The first
   set were illustrated scenes — a cleaner with a cart, a guard at a barrier.
   They read as clip-art, and clip-art on a page selling physical work says
   the opposite of what rule 3 asks for: it looks like a company that has no
   photographs of itself. A placeholder therefore claims **nothing**. It is a
   reserved image area in the palette of §1: the surface ramp as a soft
   vertical fall, one thin accent line in the area colour, a low-contrast
   perspective grid so the panel has depth rather than flatness, the
   `--bild-overlay` token, and one line of caption type naming the motif that
   belongs there. No figures, no objects, no scene.

   That is also the honest answer to "make the placeholders realistic": a
   photograph cannot be invented. Either the client's own material arrives
   (§4.1) or a licensed set is bought — and a stock photo of somebody else's
   building on a page about this group's projects would be rule 3 broken with
   better lighting. **O-13.**
2. **Never publish AI-generated people as if they were staff.** For a company
   selling trust and physical presence, that backfires the moment anyone
   notices.
3. Documentary tone: real work, real light, no posed studio smiles.
4. **Overlay is mandatory** on any image carrying text, and it is a **token**,
   not a value typed at each call site:
   ```css
   --bild-overlay: linear-gradient(180deg,
     rgba(8,8,10,0.15) 0%, rgba(8,8,10,0.55) 55%, rgba(8,8,10,0.92) 100%);
   ```
   Written out per component it drifts — one card at 0.55, the next at 0.5 —
   and the heading's legibility then depends on which component someone
   copied. One token, used everywhere, is the only way "mandatory" survives
   contact with a second developer.
5. Aspect ratios: hero `21:9` desktop / `4:5` mobile · brand card `4:3` ·
   project card `3:2` · profile cover `3:1` · avatar `1:1`.
6. Always `next/image`, always `alt`, `priority` on the hero only.
7. Subtle scale on hover for interactive images: `scale(1.03)`, 400ms.

**Brand-card composition** (the four cards on the home page): logo top-left over
the image, image filling the card, gradient bottom, title + one-line claim,
`Mehr erfahren →` in red at the base. Identity hue as a 3px top border.

---

## 5. Components

### Buttons

| Variant | Style |
|---|---|
| `primary` | `--red` bg, white text, `--r-md`, `12px 20px`, 600 |
| `secondary` | transparent, `1px solid --border-strong`, `--text` |
| `ghost` | transparent, `--text-muted`, hover `--surface-2` |
| `danger` | `--danger-strong` bg, white text — **not `--danger`**, which fails AA under white (§1) |

Hover 150ms. Focus: `0 0 0 3px var(--red-ring)` — **never remove focus rings**.
Disabled: 40% opacity, `cursor: not-allowed`.
One primary button per view.

### Cards

`--surface` bg, `1px solid --border`, `--r-lg`, padding `--s5`.
Hover on interactive cards: border → `--border-strong`, `translateY(-2px)`,
200ms. No shadow.

### Icons

One set, drawn in the repo, no icon dependency. `24×24` viewBox, stroke
`1.75`, `currentColor`, round caps and joins, **no fill** — an icon takes the
colour of the text beside it, which is why a nav item, a `-soft` tile and a
danger pill can all use the same glyph without a second asset.

| Size token | px | Where |
|---|---|---|
| `icon-sm` | 16 | inside pills, table cells, buttons at `sm` |
| `icon-md` | 18 | portal sidebar and tab bar (§5 Navigation) |
| `icon-lg` | 24 | default, KPI tile, empty states |
| `icon-xl` | 32 | section headers, `NochNichtGebaut` |

**Always decorative unless it is the only label.** An icon next to text is
`aria-hidden`; an icon-only control carries an accessible name. Never colour
alone: §9 forbids it, so an icon that carries state carries a shape too
(check, cross, clock), not just a hue.

The set is closed and lives in `src/lib/design/icons.ts`. Adding a glyph means
adding it there and to this table — a one-off `<svg>` in a page file is the
same failure as a one-off hex code. Emoji and Unicode dingbats (`▤ ⛓ ☺`) are
**not** icons: they render as the operating system decides, they carry another
culture's metaphor, and they cannot take `currentColor`.

**Vocabulary** — the name is the domain word, not the drawing:

`uebersicht · crm · objekt · dienstplan · zeit · personal · angebot · auftrag ·
rechnung · dokument · einstellungen · freigabe · wachbuch · aufmass ·
ausschreibung · ki · heute · kalender · uhr · standort · telefon · mail ·
suche · filter · plus · export · import · pfeil-rechts · pfeil-runter ·
chevron-rechts · menue · schliessen · schloss · auge · stift · papierkorb ·
warnung · ok · fehler · info · gruppe · person · euro`

### KPI stat card

Icon tile `40×40` `--r-md` on a `-soft` tint · `micro` uppercase label in
`--text-muted` · value at `h2` · delta below in `--success` / `--danger` with
arrow. Grid: 4 up desktop, 2 tablet, 1 mobile.

### Status pills

`--r-full`, `4px 12px`, `xs` 500, `-soft` background, solid semantic text.
Fixed vocabulary:

| State | Colour |
|---|---|
| In Arbeit · Aktiv · Bereit | success |
| Geplant · In Prüfung · Entwurf | info |
| Angebot · Offen · Wartet | warning |
| Nur Lesen | warning |
| Überfällig · Abgelehnt · Fehler | danger |
| Abgeschlossen · Archiviert | muted on `--surface-3` |

**`Nur Lesen` is here because §6 already requires it** — the `Gruppenübersicht`
row and the header both carry it as a warning pill. It was used there and
absent from this table, which makes the vocabulary "fixed" only until someone
reads §6. A pill the switcher must show and the type system cannot express is
either an invented label at the call site or a missing screen; both are worse
than one more row here. It is a *mode*, not a record state — the only one — and
that is why it stands alone.

### Filter pills

Inactive `--surface-3` + `--text-muted`; active white bg + `--ink` text.
Horizontally scrollable on mobile, no wrap.

### Tables

Header row `micro` uppercase `--text-subtle`, `1px solid --border` beneath.
Rows `56px`, hover `--surface-2`. Numbers **right-aligned, tabular figures**:

```css
font-variant-numeric: tabular-nums;
```

Money always `1.234,56 €` — German format, non-breaking space before `€`.

**Mobile:** tables become stacked cards below `768px`. Never a horizontal
scrollbar on a data table on a phone.

### Forms

Input: `--surface-3` bg, `1px solid --border`, `--r-md`, `12px 14px`, min
height `44px`. Focus: border `--red` + ring. Error: border `--danger`, message
below in `--danger` at `xs`. Label above, always — never placeholder-as-label.

### Navigation

**Public header:** height `72px`, `--ink` at `rgba(8,8,10,0.85)` with
`backdrop-filter: blur(12px)` once scrolled. Logo left, nav centre, red
*Angebot anfragen* + ghost *Login* right. Mobile: full-screen overlay menu.

**Portal sidebar:** width `248px`, `--surface`. Active item: `--surface-2` bg +
3px left bar in the **current area's identity hue**. Icons `18px`, label `sm`.
Collapsible to `64px`. Mobile: bottom tab bar with the five main destinations.

---

## 6. Business-area switcher

The signature interaction. Instagram-inspired in *form*, professional in tone.

**Placement:** top-left of the portal header, replacing a static logo.

**Trigger:**
```
[◉ avatar] CSE Dienstleistung  ⌄
```
Circular brand avatar `32px` with a 2px ring in the area's identity hue · name
in `sm` 600 · chevron in `--text-muted`. Whole control is one button, `44px`
tall, hover `--surface-2`.

**Dropdown:** `--surface-2`, `--r-lg`, `--shadow-pop`, width `320px`,
enters with `opacity 0→1` + `translateY(-4px→0)` over 180ms.

```
┌──────────────────────────────────────┐
│  BEREICH WECHSELN                    │  micro, --text-subtle
├──────────────────────────────────────┤
│ ◉  CSE Dienstleistung        ✓       │  active: red ring, --surface-3
│    Reinigung · 24 Aufträge           │
│                                      │
│ ◉  SSE Security                      │  blue ring
│    Sicherheit · 8 Aufträge           │
│                                      │
│ ◉  REALTIME Service GmbH             │  amber ring
│    Bau · 12 Projekte                 │
│                                      │
│ ◉  CSE Operations                    │  violet ring
│    Digital & KI                      │
├──────────────────────────────────────┤
│ ⊞  Gruppenübersicht      NUR LESEN   │  --text-muted + warning pill
└──────────────────────────────────────┘
```

**Rules:**

1. **Only rendered when the user has more than one area.** One area = a static
   logo, no chevron, no dropdown.
2. Each row shows a live counter — the switcher is informative, not decorative.
3. **Group view carries a visible `NUR LESEN` pill**, here and in the header
   once active. It is never a place where records are created.
4. **A 3px bar in the active area's hue runs across the very top of the app**
   at all times. When someone has ten tabs open, that bar is how they know
   where they are before they click anything.
5. Keyboard: `⌘K` opens it; arrows navigate; `Enter` switches; `Esc` closes.
6. Switching writes to `audit_log` and lands on the new area's dashboard.

**Public site** uses the same circular-avatar row — four brand avatars under
the hero, tapping one opens that company's profile. Same visual language,
public intent.

---

## 7. Motion

```css
--ease: cubic-bezier(0.22, 1, 0.36, 1);
--fast: 150ms;   --base: 220ms;   --slow: 400ms;
```

Hover `--fast` · dropdowns and modals `--base` · image scale `--slow`.
Page sections: fade + `translateY(12px→0)`, once, on first view only.

**Never:** parallax, autoplay carousels, looping background video, particles,
typewriter text, counters that re-animate on every scroll.

**Always:** honour `prefers-reduced-motion` — disable transforms, keep opacity.

---

## 8. Responsive

```
sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536
```

Mobile-first. Rules that are not negotiable:

- Tap targets ≥ `44×44px`
- Body text never below `16px` — iOS zooms on focus otherwise
- Data tables → stacked cards under `768px`
- Portal navigation → bottom tab bar on phones
- The employee check-in screen is **phone-only in practice**: one screen, one
  primary button, no scrolling, usable with gloves on and one hand

---

## 9. Accessibility — BFSG applies

- WCAG 2.1 AA. Body text contrast ≥ 4.5:1, large text ≥ 3:1
- **All three text tokens pass AA on every surface**, and that is deliberate:
  `--text` 18.2:1, `--text-muted` 7.4:1, `--text-subtle` 5.6:1 on `--surface`,
  and the worst surface (`--surface-3`) still gives `--text-subtle` 4.86:1.
  `--text-subtle` was `#71717A` (3.93:1) on the reasoning that it is "for `xs`
  meta only". That reasoning does not hold under WCAG: 11px and 13px meta is
  still text, and AA has no small-text exemption — only a *large*-text one at
  18.66px bold or 24px. A token that cannot meet AA on a platform where BFSG
  applies is a defect, not a deliberate step. The three-level hierarchy
  survives; all three levels are now legible
- `--text-subtle` stays confined to meta, timestamps and placeholders by
  **role**, not by contrast
- **Colour is never the only signal.** Status pills carry text; area identity
  carries a name, not only a hue
- Full keyboard operation; visible focus everywhere
- Semantic HTML; ARIA only where semantics run out
- Every image has `alt`; decorative images `alt=""`
- Forms: `<label>` bound to every input; errors announced via `aria-live`

---

## 10. Tailwind config

```js
// tailwind.config.ts — theme.extend
colors: {
  ink: '#08080A',
  surface: { DEFAULT: '#101013', 2: '#17171B', 3: '#1F1F24' },
  line:   { DEFAULT: '#26262C', strong: '#34343C' },
  brand:  { DEFAULT: '#E30613', hover: '#C10510', press: '#A00409' },
  area:   { reinigung: '#E30613', security: '#2F6BFF',
            bau: '#F59E0B', operations: '#8B5CF6' },
},
fontFamily: {
  sans:   ['Inter', 'system-ui', 'sans-serif'],
  script: ['Caveat', 'cursive'],
},
borderRadius: { sm:'6px', md:'10px', lg:'14px', xl:'20px' },
transitionTimingFunction: { brand: 'cubic-bezier(0.22,1,0.36,1)' },
```

Define these as CSS variables in `globals.css` as well, so non-Tailwind
surfaces (email templates, PDF stylesheets) share the same values.

---

## 11. Invoice and offer PDFs

Print is not the app. **White background, black text** — a red-on-black invoice
is unreadable and unprofessional.

- White page, `#111` text, CSE red only in the logo and the header rule
- Each entity prints its **own** logo, address, tax number, bank details
- Tabular figures, right-aligned amounts, German number format
- Fixed footer: entity name, register court, HRB number, managing director
- A4, `20mm` margins, `10pt` body

**The print palette is its own set of tokens.** The screen palette is
dark-first; the page is not. Reusing `--surface` on paper would print a black
rectangle, and reusing `--text` would print near-white on white. These five
carry the rule above, and nothing outside a printed document may use them:

| Token | Value | Use |
|---|---|---|
| `--druck-papier` | `#ffffff` | the sheet |
| `--druck-text` | `#111111` | body text |
| `--druck-text-leise` | `#444444` | long text under a position, footer |
| `--druck-linie` | `#dddddd` | the footer rule |
| `--druck-linie-leicht` | `#eeeeee` | row separators in the position table |

**Print metrics are tokens too.** The screen scale of §2 and §3 is built for a
72 dpi viewport and a 16px root; paper is neither. A table row that reads well
on screen wastes a third of an A4 sheet, and `--s3` between two figures is a
column that no longer looks like a column. These are the values a printed
document uses, and — like the palette above — nothing outside one may use them:

| Token | Value | Use |
|---|---|---|
| `--druck-zelle-y` | `6pt` | cell padding, block axis |
| `--druck-zelle-x` | `4pt` | cell padding, inline axis |
| `--druck-kopf-groesse` | `8pt` | table header, uppercase |
| `--druck-kopf-sperrung` | `0.08em` | its letter-spacing — same as `micro` in §2 |
| `--druck-meta-groesse` | `9pt` | footer, long text under a position |
| `--druck-block` | `12pt` | gap between two blocks on the sheet |

Points, not pixels: a PDF is laid out in points, and `10pt` body from the list
above only means anything if what sits next to it is measured the same way.

The header rule is `--red` from §1 — the one place CSE red appears on paper.

---

## 12. Do not

- No neon, no glow, no dark-mode-with-purple-gradient SaaS look
- No 3D renders, no abstract network graphics, no robot imagery for the AI
  features — use plain iconography and real screenshots
- No red backgrounds behind body text
- No more than one script-font element per page
- No stock photos of generic offices when their own sites are available
- No animation that repeats while the user reads
- No component invented ad hoc — extend this file first
