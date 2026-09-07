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
--text-subtle:    #71717A;   /* meta, timestamps, placeholders */

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
--danger:  #EF4444;   --danger-soft:  rgba(239,68,68,0.12);
--info:    #3B82F6;   --info-soft:    rgba(59,130,246,0.12);
```

Status pills use `-soft` background + solid text. Never solid fills.

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
2. **Never publish AI-generated people as if they were staff.** For a company
   selling trust and physical presence, that backfires the moment anyone
   notices.
3. Documentary tone: real work, real light, no posed studio smiles.
4. **Overlay is mandatory** on any image carrying text:
   ```css
   background: linear-gradient(180deg,
     rgba(8,8,10,0.15) 0%, rgba(8,8,10,0.55) 55%, rgba(8,8,10,0.92) 100%);
   ```
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
| `danger` | `--danger` bg, white text |

Hover 150ms. Focus: `0 0 0 3px var(--red-ring)` — **never remove focus rings**.
Disabled: 40% opacity, `cursor: not-allowed`.
One primary button per view.

### Cards

`--surface` bg, `1px solid --border`, `--r-lg`, padding `--s5`.
Hover on interactive cards: border → `--border-strong`, `translateY(-2px)`,
200ms. No shadow.

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
| Überfällig · Abgelehnt · Fehler | danger |
| Abgeschlossen · Archiviert | muted on `--surface-3` |

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
- `--text-muted` on `--surface` passes; `--text-subtle` is for `xs` meta only —
  never body copy
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
