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

### Marks and logos

The official logo files have not been delivered (`// TODO(client)`: **O-12**).
Until they arrive every company carries a **provisional mark** built from the
tokens above, so that the header, the footer, the company cards, the switcher
and the favicon all show the same sign — and so that a replacement keeps the
sizes and the clear space.

| Mark | Tile | Glyph |
|---|---|---|
| `gruppe` | `--ink` | four dots in the four area hues — four companies, one house |
| `reinigung` | `--area-reinigung` | an arc wiping a surface clean, one highlight |
| `security` | `--area-security` | a shield with a check |
| `bau` | `--area-bau` | two building volumes on a baseline |
| `operations` | `--area-operations` | four nodes, one net |

**Geometry.** A `24×24` tile with radius `6` (25 %), the glyph drawn like the
icons (§5): stroke `2`, round caps and joins, `--white`, no fill. The mark is
never stretched, never recoloured, never placed on a background of its own hue.

| Size token | px | Where |
|---|---|---|
| `marke-sm` | 24 | portal header, switcher rows, table cells |
| `marke-md` | 32 | public header, company cards |
| `marke-lg` | 40 | footer, company profile hero |
| `marke-xl` | 56 | favicon source, print letterhead |

**Lockup.** Mark and name side by side, gap `s2`, the name in Inter
semibold at `base` (`h3` from `lg`, `h2` at `xl`), `tracking-tight`. The name
comes from `mandant.name` or `plattform_einstellung`, never from the component.
Clear space around the lockup is at least the tile's radius. On a phone header
the name may collapse to `sr-only` while the mark stays.

Component: `src/components/marke/Marke.tsx` (`Marke`, `Logo`, `MarkenLogo`).
The favicon `src/app/icon.svg` is the `gruppe` mark.

**Uploaded brand images (V-100, D-628).** Once a company uploads its own files
under *Einstellungen › Identität*, they replace the provisional mark — in the
same places, at the same sizes, with the same clear space. Nothing about the
layout changes when a logo arrives, and nothing is shown until the company's
identity is published (`oeffentlich_sichtbar`).

| Image | Replaces | Size | Shape |
|---|---|---|---|
| Avatar | the mark tile wherever that company's mark appears on the public site — card, footer, company picker, imprint, hero | the mark's size token (`marke-sm` … `marke-xl`) | circle, `object-cover` |
| Logo for dark surfaces | the lockup on the company hero (it sits on the §4.4 gradient) and next to the name in the profile header — the site is dark-first | height = `marke-lg` on the hero, `marke-sm` in the header; width follows the file | `object-contain`, never cropped or stretched |
| Logo for light surfaces | the letterhead of a printed offer when no print logo exists — paper is light | `marke-xl` height | as above |
| Logo for print | the letterhead of a printed offer (§11) | `marke-xl` height | as above |
| Cover | the photograph of the company card (§4.4) and of the company hero (§4.5) | the card's and the hero's aspect ratios | `object-cover`; the gradient stays mandatory |

The light-surface logo never appears on a dark surface, and the dark-surface
logo never on paper — each would disappear. A missing logo falls back to the
avatar or the provisional mark plus the name, never to the other logo. A cover
never replaces an image an editor assigned to one specific section.

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

**Standalone form pages max `608px`** (`max-w-form`). These are the pages that
carry nothing but a form and the sentences around it — sign-in, the one-time
code, a single-purpose request. They are not content pages: at `1280px` a
two-field form sits in the top-left corner of an empty screen, and at `72ch`
the label and its input drift apart far enough that the eye loses the pairing.
`608px` is `32rem` of field plus the page's own `--s6` gutter on both sides, so
the form keeps one measure on a phone and on a desktop.

Set as a theme token, never as a one-off: a width written into a page file is a
width the next page gets slightly wrong.

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

   **1a. The owner may ask for a motif panel instead, and then it is a
   drawing — declared as one.** The empty panel is the correct default and
   stays the default. But a page of empty panels reads as an unfinished site
   to someone being shown the platform for the first time, and the owner has
   asked for surfaces that carry the trade. The permitted middle is a **motif
   panel**: a flat vector scene in the palette of §1 that evokes the trade —
   scaffolding and a crane for Hochbau, a lit corridor for Reinigung, a gate
   at night for Security — under four conditions, all of which must hold:

   - **It must read as a drawing at a glance.** Flat fills, no photographic
     gradients on surfaces, no texture, no depth-of-field. The point of rule 1
     was that clip-art pretending to be a photograph is worse than an empty
     panel; a drawing that is plainly a drawing makes no claim to be one.
   - **Figures are silhouettes, never faces.** Rule 2 is untouched: no person
     on this site may be read as a member of staff unless they are one. A
     silhouetted figure at a distance depicts *work*, not a worker.
   - **The panel is the drawing and nothing else — no overlay, no caption
     baked in.** It stands in for a photograph, so it behaves like one: a
     photograph brings neither a gradient nor a caption with it, and both
     belong to the surface that places it. This was learnt the expensive way.
     The panel baked in the §4.4 overlay while `Hero` and `MarkenKarte` apply
     it too, and two layers multiply — 0.55 in the middle became 0.80, 0.92 at
     the foot became 0.994, which is black. And the baked caption
     ("REALTIME SERVICE") landed directly under the page's own heading for the
     same company, a half-transparent double that read as a rendering fault.
     The placeholder is still declared, by the `Platzhalterbild` badge the
     page already renders — one marking, on the surface, where it can see what
     else is there. **D-382.**
   - **A real file under `public/bilder/` wins.** The panel is what the page
     falls back to, never what it prefers — `bildFuerMotiv()` already works
     this way, and the day the client's photographs arrive, nothing in the
     code changes.

   **1b. The panel has its own luminance ramp, and it is brighter than the UI
   ramp.** The first set of motif panels was drawn in the surface ramp of §1
   (`--surface` … `--surface-3`, topping out at `#1F1F24`) and was, in
   practice, invisible: the mandatory overlay in §4.4 is 55 % opaque at the
   middle of the panel and 92 % at the foot, so a backdrop at luminance 31 and
   a silhouette at luminance 11 arrived on screen five levels apart. The
   drawing was there. Nobody could see it, and a page of them read as a site
   with the images missing — which is exactly what the empty panel was
   supposed to avoid.

   The cause is a category error, not a taste dispute. **The §1 ramp is for UI
   chrome sitting ON the page background; a motif panel stands in for a
   photograph, and the overlay is calibrated for photographic range.** A photo
   carries mid-tones around luminance 90–140; the UI ramp never leaves the
   30s. Reusing it under an overlay built for a photograph is what made the
   panels vanish.

   So the panel — and only the panel — uses this ramp. It never appears in UI
   chrome, and `--bild-overlay` is untouched:

   ```css
   --tafel-himmel: #33333C;   /* backdrop behind everything */
   --tafel-fern:   #4A4A56;   /* distant volumes, hazier and lighter */
   --tafel-mitte:  #2C2C34;   /* mid-ground */
   --tafel-nah:    #14141A;   /* near silhouettes — figures live here */
   --tafel-grund:  #0C0C10;   /* foreground floor */
   ```

   Far is lighter than near, which is the whole depth effect and the reason no
   silhouette needs a gradient on it. The ordering matters more than the exact
   values: a figure must stay clearly darker than the band it stands in after
   the overlay has been applied, not before.

   Which of the two a surface gets is a **size** decision, not a taste one:
   large surfaces (hero, brand card, company page) take the motif panel,
   because that is where emptiness reads as breakage. Small ones (object and
   project thumbnails) keep the empty reserved area, because a drawing at
   180 px is a smudge. See **D-376**.
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

**An interactive card says so AT REST, not only on hover.** This rule exists
because of a user report with two screenshots: a KPI card labelled *Neue
Anfragen* opens a page when clicked, one labelled *Vorgänge* does nothing, and
the two were pixel-identical — same surface, same border, no cursor change
until the pointer was already on them. A card that leads somewhere must be
distinguishable from one that does not **before** the reader tries it; hover
is an answer that arrives too late, and on a touch screen it never arrives.

The resting signal is a **`pfeil-rechts` glyph in the top-right corner**, at
`icon-sm`, in `--text-subtle`. A glyph and not a colour, because §9 forbids
colour as the only signal; the arrow is already in the closed icon set, so no
new asset. On hover it inherits the card's transition and moves with it.

Non-interactive cards carry no arrow — the absence is the other half of the
signal, and it is only readable if the presence is consistent.

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
glocke · suche · filter · plus · export · import · pfeil-rechts · pfeil-runter ·
chevron-rechts · menue · schliessen · schloss · auge · stift · papierkorb ·
warnung · ok · fehler · info · gruppe · person · euro · reinigung · security ·
qualitaet · eingang · buch · bank · social`

`glocke` is the notification inbox (NOT-01) and **not** `mail`: the two sit in
the same header and mean different things — `mail` is a message a person
wrote, `glocke` is what the system noticed. Two items on the same envelope
read as one item, which is the rule right below.

`social` (SOC-01) is a **node graph** — one point branching to two — and
deliberately neither `export` nor `mail`. `export` is a file leaving for a
machine; `mail` is one message to one named recipient; `social` is the same
text going to several audiences at once, which is exactly what makes it worth
its own approval step. No platform logo is ever used: a Meta or LinkedIn mark
is someone else's trademark, it cannot take `currentColor`, and it would claim
a connection the platform does not have (SOC-07).

**No two navigation items share a glyph.** A sidebar is scanned by shape;
four items on the same export arrow read as one item. `reinigung`,
`security`, `qualitaet`, `eingang`, `buch` and `bank` exist for that reason.

### KPI stat card

Icon tile `40×40` `--r-md` on a `-soft` tint · `micro` uppercase label in
`--text-muted` · value at `h2` · delta below in `--success` / `--danger` with
arrow. Grid: 4 up desktop, 2 tablet, 1 mobile.

### Source preview

A scrolling panel for generated machine-readable text — today the XRechnung
UBL (FIN-11), tomorrow the same for ZUGFeRD and the DATEV export. Card
surface, `border-line`, `text-xs`, monospace inherited from `pre`, and
`max-h-quelltext` (`32rem`) with `overflow-auto`.

The height is a token, not a number in a page file. `32rem` shows roughly
forty lines — enough to recognise the document and see that the totals are
where they belong, short enough that the page still scrolls as a page. A
preview that grows with its content pushes every control below it off the
screen, and the one control that matters here is the download.

### Machine words in a sentence

A sentence addressed to a person never carries a machine word raw. Three
things kept appearing in body copy and are now each rendered, never printed:

| What | Component | Reads as |
|---|---|---|
| A permission key | `<Recht schluessel="kalkulation.lesen" />` | „Kalkulationen lesen“ / “read costings” |
| A stored payload | `<Nutzlastblatt nutzlast={…} />` | a definition list — labels, Berlin timestamps, shortened ids |
| A generated letter or mail | `<pre class="font-sans …">` | the letter, in the page's own face |

Monospace is a claim: *this is machine text, copy it exactly.* It is right
for the **Source preview** above (UBL, ZUGFeRD, DATEV — text a person really
does hand to a machine) and wrong for everything a person only has to
understand. „Ihnen fehlt `kalkulation.lesen`“ tells the reader that something
is missing but not **what**, so they cannot even ask for it; a VOB letter set
in monospace reads like a log file, not like the letter it is.

The machine word does not disappear — it moves to `title` and a `data-`
attribute. Administration grants a permission by its exact key, and the
browser runs must not hang on a word that changes with the language.

### Status pills

`--r-full`, `4px 12px`, `xs` 500, `-soft` background, solid semantic text.
Fixed vocabulary:

| State (de) | State (en) | Colour |
|---|---|---|
| In Arbeit | In progress | success |
| Aktiv | Active | success |
| Bereit | Ready | success |
| Geplant | Scheduled | info |
| In Prüfung | Under review | info |
| Entwurf | Draft | info |
| Angebot | Quoted | warning |
| Offen | Open | warning |
| Wartet | Waiting | warning |
| Nur Lesen | Read only | warning |
| Überfällig | Overdue | danger |
| Abgelehnt | Rejected | danger |
| Fehler | Error | danger |
| Abgeschlossen | Closed | muted on `--surface-3` |
| Archiviert | Archived | muted on `--surface-3` |
| Inaktiv | Inactive | muted on `--surface-3` |

**The German column is the KEY, the English one is only the label.** A pill is
addressed in code by its German state — `zustand="Überfällig"` — and the type
makes an unlisted one unrepresentable. The English column is what a reader
sees when the session runs in English; it never becomes an identifier, and a
screen can never reach a colour by writing `zustand="Overdue"`. Two spellings
of one state would be two states in every `Record` in the codebase, and the
second one would quietly have no colour.

**These sixteen are labels, not terms of art** — unlike `Mandant`,
`Leistungsnachweis` or `Aufmass`, which stay German in both languages because
they carry legal meaning (VOB, GoBD, UStG). `Überfällig` carries none: it is
the word on a coloured dot, and a reader who cannot read German needs it in
a language they can read, because §9 says colour is never the only signal —
and a signal in an unreadable language is colour alone.

**`Inaktiv` is muted and not `danger`, and that distinction is the whole
point.** An agent that is switched off is not broken and not overdue — it is
simply not running, by someone's decision. A red pill would send whoever sees
the agent centre looking for a fault; a grey one says "nothing is happening
here, and that is the current setting". It is the resting state of a switch
(`agent.ist_aktiv`), which is why it sits beside `Archiviert` rather than
beside `Fehler`. Nothing else in the vocabulary covers it: `Wartet` promises
that something will happen next, and it will not.

**`Nur Lesen` is here because §6 already requires it** — the `Gruppenübersicht`
row and the header both carry it as a warning pill. It was used there and
absent from this table, which makes the vocabulary "fixed" only until someone
reads §6. A pill the switcher must show and the type system cannot express is
either an invented label at the call site or a missing screen; both are worse
than one more row here. It is a *mode*, not a record state — the only one — and
that is why it stands alone.

### Calendar (CAL-01, CAL-02)

**No new colours.** A calendar with six colours for six sources is decoration:
nobody learns which shade means "tender deadline", and the one that matters —
today — competes with five others. Sources are named by a pill from the status
vocabulary above, and the vocabulary already fits, because the question a
calendar entry answers is always one of three:

| Source | Pill | Why |
|---|---|---|
| Termin (meeting, customer, follow-up, interview) | info | someone planned it |
| Einsatz (shift from the roster) | muted on `--surface-3` | it is the resting state of the week |
| Frist (project, tender, approval, lead) | warning | it runs out |
| Abgesagt | danger | struck through, and it stays visible |

**Today is the only emphasis.** `2px solid --brand` on the day cell, and the
day number in **`--text` on `--brand`**. Nothing else in the grid gets a
border.

**Why `--text` and not `--ink` on that one chip.** `--ink` on `--brand` is
**4.09:1** — measured by axe on the built page, and below AA for the 13px day
number (§9, BFSG). `--text` (`#FAFAFA`) on the same red is **4.89:1** and
clears it. This is the same case DESIGN already resolves for the danger
button: a solid brand *surface* wants a light foreground, and the token that
reads well *as text on dark* is not the one that reads well *on the brand
red*. The first draft of this section specified `--ink`, and the
accessibility test caught it before anyone saw the screen — which is the
argument for having the test, not against writing the section first.

**Month grid.** Seven columns, `min-height: 120px` per cell, `1px solid
--border` between cells, `--surface` behind, `--surface-2` behind days outside
the shown month. At most three entries per cell, then `+n weitere` as a link
to that day — a cell that grows with its content turns one busy Tuesday into a
month that needs scrolling in both directions.

**Below `768px` there is no grid.** Seven columns on a phone are 50px wide and
show nothing; the month view becomes the *agenda*: one day per row, days
without entries omitted, the date sticky at the top of its group. This is the
one place where the mobile layout is not the desktop layout rearranged — it is
a different answer to the same question, and §8's "never a horizontal
scrollbar" is why.

**Week and day** are the agenda with a narrower window, not a time-grid with
hour rows. An hour grid is only worth its complexity when entries overlap and
their overlap matters; here a shift and a deadline on the same day do not
compete for a slot.

### Filter pills

Inactive `--surface-3` + `--text-muted`; active white bg + `--ink` text.
Horizontally scrollable on mobile, no wrap.

**The same pill shape carries a navigation row**, not only a filter — the
sub-tab bar under a company profile cover (§4, site map §2.2) is a row of
links in exactly these values. Two differences, both required and neither
cosmetic: the element is an `<a>`, because it changes the address and must
survive a middle-click and a copied link; and the current one carries
`aria-current="page"` rather than `aria-pressed`, because it marks where the
reader **is**, not what they have switched on. Colour alone never marks it
(§9) — `aria-current` is the second signal.

### Filter line

A list that opens **already filtered** — from a dashboard figure (DSH-04) or a
month selection — says so in one line above the list: `text-sm` in
`--text-muted`, the filter value in `<strong>` with `--text`, then ` · ` and
an `<a>` back to the unfiltered list („Alle anzeigen" / "Show all"),
underlined with a 2px offset, `--text` on hover; `--s5` below. It is a
sentence, not a pill: it states what the reader is looking at, it does not
switch anything on. Without it a filtered list looks like the whole list, and
a figure of fourteen reads as "all there are". Component:
`components/portal/Listenfilter.tsx` (`data-cse="listen-filter"`); the month
filters of the invoice lists (`monat-filter`) have the same form.

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

### Notices

A notice is one sentence with weight, in a frame: `--r-lg`, `1px` border,
`--s5` padding, `sm` type. Three kinds, three semantic tones (§1):
`hinweis` on `--surface` with `--border`, `warnung` on `--warning-soft` with
`--warning`, `erfolg` on `--success-soft` with `--success`. There is no
`danger` notice: an error belongs at the field (Forms) or in a status pill.
The first words carry the meaning in bold, so the colour never carries it
alone (§9). Component: `components/ui/Hinweis.tsx`; every notice carries a
`data-cse` anchor.

### Status pages — 404 and error

Two pages the platform had none of, while 232 call sites led to them. Next.js
answers a missing `not-found.tsx` with its own English default: black on white,
Inter nowhere, no way back. That page is the one a visitor sees at the moment
they are already lost.

Both share **one component**, `components/ui/Zustandsseite.tsx`, because they
differ only in what they say — a layout written twice drifts two ways. It is a centred column, `max-w-form` (§3), vertically centred in the
viewport with `--s9` of section padding:

| Slot | Type (§2) | Colour (§1) |
|---|---|---|
| eyebrow — the code (`404`, `500`) | `micro`, uppercase | `--text-subtle` |
| headline — what happened, in German | `h1` | `--text` |
| explanation — one or two sentences | `base`, max `72ch` | `--text-muted` |
| actions — at most two | Buttons (§5) | primary + ghost |

**Rules, and each one is a decision, not a preference:**

1. **Say what happened, never what the visitor did wrong.** „Diese Seite gibt
   es nicht" — not „Ungültige Anfrage". The portal answers a missing *right*
   with the same 404 as a missing *page* (AUT-06), so this text must be true
   for both and must not hint which it was.
2. **Always a way onward.** A status page with no link is a dead end. Primary
   goes to the surface the visitor is on (public: `/`, portal:
   `/portal/[mandant]`); ghost goes back.
3. **No error detail on screen.** A stack trace, an SQL fragment, a table name
   — those go to the log. `error.tsx` shows the `digest`, and only that: it is
   the string that connects this screen to that log line.
4. **No illustration, no number set in `display`.** A 404 drawn large is a joke
   at the reader's expense; this is a working tool.
5. **There is no `loading.tsx`, and that is a hard rule.** A `loading.tsx`
   wraps its segment in a Suspense boundary, so the shell goes out **before the
   page has decided anything** — with status `200`. At the root that silently
   turns every `404` in the application into a `200`, including the one AUT-06
   depends on: a request for another company's data would answer *found*. It
   was written, it looked harmless, and it broke every status code in the app
   until a browser check caught it. The same applies to any segment whose pages
   can call `notFound()` — which is all of them. A slow screen shows its own
   skeleton inside the page, where the status code is already settled.

**These pages do not carry the portal frame, and that is a constraint, not a
preference.** Next.js passes `not-found.tsx` no params, so a tenant-scoped page
cannot know which company it is in; and the loader that would tell it
(`mandantTor`) calls `notFound()` itself, which on a not-found page is a render
loop on the one screen that must never fail. Instead the page reads the request
path from the middleware header and offers the portal root as its primary
action, so the navigation is one click away rather than gone.

### Navigation

**Public header:** height `72px`, `--ink` at `rgba(8,8,10,0.85)` with
`backdrop-filter: blur(12px)` once scrolled. Logo left, nav centre, red
*Angebot anfragen* + ghost *Login* right. Mobile: full-screen overlay menu.

**The header has three tiers, and the full row starts at `xl`, not `md`.**
Measured, the full row — wordmark, four links, company switcher, red button,
sign-in, two language links — needs about **1130px**. Switched on at `md` it
overflowed on every public page from 768px to roughly 1090px: the wordmark
collapsed to 0px (`min-w-0` + `truncate`), the red button wrapped onto two
lines and the language switch stood outside the window. Every tablet and
every small laptop saw that, and neither the 375px nor the 1280px check did.

| Width | In the 72px row | In the overlay menu |
|---|---|---|
| below `lg` (1024) | wordmark, menu button | everything |
| `lg` – `xl` | wordmark, four links, red button, menu button (~745px) | companies, sign-in, language |
| from `xl` (1280) | the full row | — |

**The wordmark is never truncated at any width for the configured name**
(„CSE Gruppe", 146px); `truncate` stays the emergency brake for an over-long
name in `plattform_einstellung`, exactly as the paragraph below says. The
testable rule below applies to every tier, not only to phones. **D-417.**

**On a phone the header carries the wordmark and the menu button — nothing
else.** The language switch goes into the overlay menu, for the same reason
§6 gives for the company switcher: a 72px row has no width for a second
control beside the menu button. It was in the header, it took 96px of it, and
what gave way was the name: at every phone width from `360px` to `414px` the
wordmark rendered as *CSE Gr…*. Nothing looked broken — `text-overflow` is
tidy, and the 375px overflow test stayed green precisely BECAUSE the name was
being cut. **The wordmark is never truncated at `360px` or wider**; that is the
testable half of this rule.

**The four header links are not the whole site — the group pages live in the
footer and the overlay menu.** *Über uns*, *Aktuelles* (`/news`) and *Karriere*
are built, filled and in the sitemap, and with four header links and nowhere
else to go they were reachable only by typing the address (V-155). They do not
join the header row — five to seven links break the `lg` tier measured above.
Instead they stand (1) in the overlay menu directly after the four links, same
row style, before the companies and *Angebot anfragen*; and (2) in the footer as
their own `nav` headed *Die Gruppe* / *The group*, stacked above *Rechtliches*
in the third column, same link style as the legal trio (`min-h-11`, `sm`,
`--text-muted`). A page that exists only in German (`/karriere`, `NUR_DEUTSCH`)
is linked from an English page to its German address with `hreflang="de"` and
the visible suffix *(in German)* — never to an `/en/…` address that 404s.
**D-649.**

**Portal sidebar:** width `248px`, `--surface`. Active item: `--surface-2` bg +
3px left bar in the **current area's identity hue**. Icons `18px`, label `sm`.
Collapsible to `64px`. Mobile: bottom tab bar with the five main destinations.

### The way back

**Every page below a portal root carries one back link, in the same place, as
the first element inside `<main>`.**

| Property | Value |
|---|---|
| Mark | `←` then the label, one text node |
| Type | `sm`, `--text-muted`, underlined; hover `--text` |
| Spacing | `mb-s4` below it, nothing above |
| Semantics | `<nav aria-label="Zurück">` wrapping one `<a>` |
| Target | the **list the page came from**, never `history.back()` |
| Touch target | the whole row, min `44px` tall (§9) |

**Why a link and not the browser's back button.** The browser's back is a
history step, not a place: after a form post it re-asks, after a redirect it
lands two pages up, and on a phone in a saved-to-homescreen window there is
no chrome to press. A link to the list is the same destination every time, and
it survives being opened in a new tab — which is how a dispatcher opens six
objects at once.

**Why the list and never `history.back()`.** Two people reach
`personal/anstellungen/[id]` from different places; the one thing they share is
where the record *lives*. A back that depends on how you arrived sends the
same button to two destinations, and neither is predictable.

**On `/auth`, the shell carries it, not the page.** `AuthSchale` renders
`← CSE Gruppe` as its first element, so every screen built on it has the way
back for free. A sign-in page that renders its own `<main>` is therefore not a
style choice but a **missing back link** — which is exactly how the employee
sign-in lost one: it copied the shell's classes without its head. Build every
`/auth` screen on `AuthSchale`; the two exceptions are `/auth/bereich`, which
carries its own footer navigation, and `/auth/einladung/[token]`, which is a
bare redirect.

**Measured, this is a rule about 350 pages, not a detail.** When it was
written, the component existed and was typed to nine paths in one portal: it
stood on 2 of 309 admin pages, 2 of 27 worker pages and 0 of 26 group pages.
**D-613.**


### Standalone pages — sign-in, choosers, decisions

Three kinds of screen stand alone: **sign-in** (`/auth/*`), a **chooser**
(pick an account, pick an area) and a **decision** (confirm before something
changes). They share one problem the rest of the platform does not have:
there is no navigation, no sidebar, no table — so if the page does not build
its own centre of gravity, the content floats in the top-left of a black
rectangle and reads as unfinished.

Measured on a 1080p screen, the area-switch sheet used **9 %** of the viewport
and left the rest empty.

**The frame.**

| Property | Value |
|---|---|
| Page | `min-h-dvh`, flex column, **centred on both axes** at `≥640px`; top-aligned below that so the keyboard does not push the panel off-screen |
| Gutter | `--s6`; `--s5` below `640px` |
| Panel width | `max-w-form` (608px) for forms · `max-w-[44rem]` for choosers with rows |
| Panel | `--surface` bg, `1px solid --border`, `--r-xl`, padding `--s6` |
| Lockup | brand mark `marke-lg` + wordmark, above the panel, `--s5` below it |
| Ambient | one radial brand wash behind the panel (below) |

**The ambient wash.** §3 says elevation on dark comes from borders, not
shadow — that rule is about *stacking*. A standalone page has nothing to stack
against, so it gets one wash instead: a single radial gradient in `--red-soft`,
behind everything, `pointer-events: none`, `aria-hidden`. It never moves, never
animates, and there is exactly one per page.

```css
--wash-brand: radial-gradient(
  60rem 40rem at 50% -10%,
  rgba(227, 6, 19, 0.10) 0%,
  rgba(227, 6, 19, 0.04) 35%,
  transparent 70%
);
```

Reason: a flat `--ink` field behind a single card reads as a page that failed
to load. The wash costs nothing, carries the brand, and gives the eye a top.

**Chooser rows.** A list where every row is an action — accounts, areas,
entities.

| Property | Value |
|---|---|
| Row | `--surface-2` bg, `1px solid --border`, `--r-lg`, padding `--s4`, min-height `64px` |
| Hover | border → `--border-strong`, `translateY(-1px)`, 200ms |
| Identity | area hue as a `3px` left bar (`AreaBadge`), never as a fill |
| Action | the **whole row** is the button. No trailing button per row. |
| Type | name `base`/600, meta `sm`/`--text-muted` |

> **No primary button in a chooser.** §5 says one primary per view, and a
> chooser has *no* primary: every row is equally the point. Nine red buttons
> in a column do not make nine primaries — they make none, and the eye has
> nowhere to rest. The row itself is the target, which is also the larger
> touch area (§9).

**Decision pages** — "you are in A, switch to B?" — show **both sides**, each
with its identity hue, and an arrow between them. A sentence alone makes the
reader reconstruct what they are leaving; two labelled chips do not.

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

**In the portal header the name appears from `lg`.** Below `lg` the trigger
carries avatar and chevron only; the page title beside it names the area, and
the button's accessible name always does. Between `sm` and `lg` the whole
session navigation stands on the right of the same row, and a full company
name on the left pushed the row off the edge (§8). A name that is still too
long at `lg` is truncated, never allowed to push (a fifth area, TEN-08).

**Dropdown:** `--surface-2`, `--r-lg`, `--shadow-pop`, width `320px`,
enters with `opacity 0→1` + `translateY(-4px→0)` over `--base` with `--ease`
— §7: dropdowns and modals move at `--base`. (This line said 180ms before;
that is not a token, and §7 is the table the durations come from.) Under
`prefers-reduced-motion` the offset is dropped (§7). The class is
`.cse-klappmenue` in `globals.css`, the sibling of `.cse-auftritt`.

```
┌──────────────────────────────────────┐
│  BEREICH WECHSELN                    │  micro, --text-subtle
├──────────────────────────────────────┤
│ ◉  CSE Dienstleistung        ✓       │  active: red ring, --surface-3
│    Reinigung · 24 laufende Aufträge  │
│                                      │
│ ◉  SSE Security                      │  blue ring
│    Security · 8 laufende Aufträge    │
│                                      │
│ ◉  REALTIME Service GmbH             │  amber ring
│    Bau · 12 laufende Projekte        │
│                                      │
│ ◉  CSE Operations                    │  violet ring
│                                      │  no second line: no trade, no count
├──────────────────────────────────────┤
│ ⊞  Gruppenübersicht      NUR LESEN   │  --text-muted + warning pill
└──────────────────────────────────────┘
```

**The second line is data, not copy.** It is the area's booked trades
(`mandant.module`) under their module names — the same words the module
assignment uses (`Reinigung`, `Security`, `Bau`), because a trade that is
called one thing in the switcher and another on the user sheet reads as two
trades — followed by the live counter: running projects where `bau` is booked,
active orders otherwise. **CSE Operations books no trade**, so its row has no
second line: „Digital & KI", which this mockup showed before, was a label no
booking carries, and a zero counter would be decoration, not information
(D-659 Nr. 3). An area whose booking was never maintained shows no trade word,
only the counter — unknown is not empty, and not a trade either (O-355).
D-731.

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

**Public site** puts the four companies in a **dropdown in the header**, next
to the language switcher: the summary shows the company whose page you are on
(avatar + name), the panel lists all four, and picking one opens that company's
profile. Same visual language as the portal switcher, public intent.

**Why not the avatar row under the hero, which this section asked for before.**
The row was built and it was wrong in practice, for two reasons the mockup
could not show. It sat directly under the hero image, where the hero's own
oversized ghost heading bleeds through — the four names landed on top of that
type and read as a collision rather than a control. And it consumed a full band
of vertical space immediately below the fold on exactly the surface where the
first impression is decided. The owner asked for the dropdown after seeing it
on the running site; that is the better evidence than the mockup, and this
section follows it. **D-381.**

The row lives on only in the **footer**, where the four companies are text
links beside their addresses — that was always separate and stays.

On phones the header has no room for a second control beside the menu button,
so the four companies are a section **inside the full-screen menu** rather than
a dropdown of their own.

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

### Safe area — the phone is not a rectangle

Reported from a real device: the bottom tab bar sat flush against the screen
edge, its labels a millimetre above the home indicator. On a phone with rounded
corners, a notch or a home indicator, part of the viewport is **not reachable**
— a tap there is swallowed by the system gesture, and text there is cut by the
curve.

Two things are needed together, and one without the other does nothing:

1. `viewport-fit=cover` in the viewport meta. **Without it iOS reports every
   `env(safe-area-inset-*)` as `0px`**, so padding written against those
   variables silently does nothing.
2. The inset carried by a **transparent border** on everything that touches an
   edge — never by padding. The reason is below, and it is not a detail.

| Where | Rule |
|---|---|
| Bottom tab bar | the bottom inset is added **below** the `44px` cell, never taken out of the tap target |
| Content above the tab bar | clears `44px + 8px + inset` **in addition to** its own padding; the bar is `fixed` and covers whatever sits under it |
| The `Mehr` sheet | ends at the top edge of the bar, so its `bottom` is `44px + inset` |
| Every fixed left/right edge | the left/right inset — zero in portrait, non-zero in landscape on a notched phone |
| Fixed headers | the top inset — zero in a browser tab, non-zero in standalone mode |

The utilities live in `globals.css` as `.sicher-unten`, `.sicher-seiten`,
`.sicher-oben` and `.ueber-tableiste`, because `env()` is not a Tailwind value
and a hand-written `pb-[calc(...)]` in twelve files is twelve chances to write
a different number.

**Why a transparent border and not padding.** It was padding once, and it cost
every page in the portal its margins. `globals.css` is loaded *after* Tailwind's
generated utilities, so `.sicher-seiten` and `p-s5` are two declarations of the
same property at the same specificity — and the later one wins. On a desktop,
where every inset is `0px`, `.sicher-seiten` therefore meant
`padding-left: 0px`: the cards sat flush against the window edge on every single
page, on every screen size, and nothing in lint, typecheck or the test suite
said a word, because no rule was broken — two correct rules simply met.

A transparent border cannot have that fight. With `box-sizing: border-box`
(Tailwind's default on every element) it grows the box inward exactly like
padding, the background still paints under it (`background-clip: border-box` is
the default, so the bar's surface reaches the physical edge while its labels do
not), and it **composes** with whatever padding the element already carries
instead of replacing it.

Written as **physical** longhands — `border-left-width`, not
`border-inline-start-width`. `safe-area-inset-left` is the physical left of the
device and does not flip; the worker screens run in Arabic under `dir="rtl"`
(SPEC §10), and a logical property there would put the notch inset on the wrong
side of the screen.

> **The rule this leaves behind:** a utility in `globals.css` never declares a
> property that a Tailwind utility on the same element also declares. Where the
> two would meet — padding, margin, colour — the custom rule takes a different
> property. `tests/design/sichere-flaeche.test.ts` holds this.

**`44px` stays `44px`.** The inset is space the system takes, not space the
button gives up: a bar that shrinks its cells to fit the indicator fails the
tap-target rule above on exactly the devices that need it most.

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
