# Decisions

Two sections: **Decided** (with reasoning — do not silently reverse) and
**Open** (must be answered by the client — never guessed).

Claude Code: append here whenever you assume something.

---

## Decided

### D-01 · Removed: cold outreach to scraped contacts

The client spec listed an AI Sales Agent that finds companies and sends them
personalised messages. **Removed.**

German **§7 UWG** treats unsolicited electronic advertising without prior
express consent as an unreasonable nuisance — and unlike some jurisdictions,
this applies to **B2B** as well. Exposure: cease-and-desist letters
(Abmahnung), costs, injunctions. Building contact lists by scraping adds a
DSGVO problem on top.

**Replaced by** a lead engine with the same business outcome and no legal risk:
inbound website forms, the tender radar, referrals, and manual CRM entry.
Outbound messaging still exists, but only to contacts carrying a recorded
`rechtsgrundlage` (CRM-08): consent, existing customer, or an enquiry they sent.

If the client wants outbound to cold contacts, that is a decision for their
lawyer, not for this codebase.

### D-02 · Removed: scraping job boards

Automated extraction from Indeed, StepStone and similar violates their terms of
service and creates DSGVO exposure over candidate data. Recruiting works on
**inbound** applications. Posting to a board happens only through a real API
with real credentials.

### D-03 · Eight agents consolidated to four

CEO Assistant · Acquisition · Back-office · Finance. The client's Operations,
Analytics, Social and Support agents were the same machinery under different
labels. Four agents with clear tool sets are easier to reason about, permission
and audit than eight overlapping ones.

### D-04 · Stack accepted, EU regions mandatory

Supabase, Vercel and OpenAI accepted as specified. Every service pinned to an
**EU region** with a signed DPA, because the platform holds employee time
records, absence data and financial records for German legal entities.

Note the tension worth raising with the client: earlier documentation promised
*"Server, Daten und Programmcode liegen bei Ihnen"* on a German server. A
managed US-headquartered cloud is a different arrangement — legal with EU
regions and DPAs, but not the same promise. **Confirm which one they want.**

### D-05 · Compliance is not a phase

GoBD, MiLoG, ArbZG, §34a, §14 UStG and BFSG are built into the phases that
touch them, not deferred. An invoice module without §14 UStG validation cannot
issue a legal invoice; a scheduling module without §34a enforcement can produce
an unlawful assignment.

### D-06 · Not built: payroll, annual accounts, tax filing

Three sector wage agreements plus SOKA-Bau make payroll a specialist system.
Jahresabschluss and E-Bilanz belong to the tax advisor. The platform prepares,
exports and hands over.

### D-07 · Procurement submission stays manual

German procurement platforms deliberately expose no submission API; accounts
are tied to natural persons and some require electronic signature. The agent
prepares the complete bid folder; a human uploads it.

This is not a limitation to apologise for. Procurement law is formalistic —
a missing document or wrong form means exclusion without review. The agent's
value is guaranteeing completeness before a human presses send.

### D-09 · `person` is split from employment — CONFIRMED BY CLIENT

**The client has confirmed that the same individual works for more than one of
the four entities.** A guard covering cleaning shifts is normal here.

Therefore an employee is not one row. The model is:

```
person                     the human — identity, contact, language
  id, vorname, nachname, geburtsdatum, telefon, sprache

anstellung             M   one employment per entity
  person_id, mandant_id, personalnummer, eintritt, austritt,
  arbeitszeitmodell, wochenstunden, stundensatz_intern
```

**Foreign keys — get these right the first time:**

| Attaches to `anstellung_id` | Attaches to `person_id` |
|---|---|
| `einsatz` | `nachweis` (certificates) |
| `zeiteintrag` | `bewacher_eintrag` |
| `stundenkonto` | `mitarbeiter_zugang` (login) |
| `urlaubskonto` | |
| `abwesenheit` | |

Rule: **anything costed or invoiced hangs off the employment** (it belongs to
one entity and one rate). **Anything true of the human hangs off the person.**

A §34a certificate belongs to the human, not to a job. Storing it per
employment produces one valid and one expired copy of the same certificate —
and a scheduler that passes its own check while assigning an unqualified guard.

**Consequences that must be implemented, not just noted:**

1. **ArbZG limits aggregate across all employments of one person.**
   6h cleaning + 5h security = 11h — a breach. Checking each employment
   separately hides it. The conflict detector queries by `person_id`.
2. **Rest-period check (11h) spans entities**, including a shift that ends in
   one entity and starts in another the next morning.
3. `stundenkonto` stays **per employment** — different rates and agreements —
   while the employee portal shows a combined view.
4. One login per person; the portal shows shifts from all employments, each
   labelled with its entity.
5. Time never crosses invoice circles: every entry hangs off exactly one
   employment, which belongs to exactly one mandant.
6. RLS: `person` rows are visible to any mandant the person has an employment
   with. `anstellung` and everything below it stay strictly tenant-scoped.
   **A manager in cleaning must not see security wage rates.**

### D-10 · Design system is a document, not a habit

`docs/DESIGN.md` is authoritative: colours, type scale, spacing, components,
motion, the switcher, responsive and accessibility rules. Derived from the
client's mockups.

Two decisions worth stating, because they were not in the mockups:

**Identity hues per area.** The mockups use CSE red across all four brands.
That works for marketing and fails inside the portal: a user working in three
entities cannot tell at a glance which one they are in — and that is exactly
how an invoice lands in the wrong GmbH. So red remains the group action colour,
and each area gets an identity hue used only for the switcher ring, the top
bar, the area badge and chart series. Never for buttons.

**Photography must be real.** The mockups use AI-generated people. Shipping
those as "our team" on a site selling physical trust fails the moment anyone
looks closely. Placeholders are marked as such in code and must be replaced
before launch. The group has genuine references worth photographing.

### D-11 · SSE Security confirmed as a separate brand

The client's mockups show **SSE Security**, not "CSE Security" — matching
*Select-Security Event GmbH* from the original documentation. It has its own
logo and identity. O-02 is answered: separate entity, own tax number, own
invoice circle.

### D-08 · Money, time and tenancy invariants

See `CLAUDE.md`. Integer cents; `TIMESTAMPTZ` in UTC; RLS everywhere;
draft → finalized one-way with numbers assigned at finalization; server clock
authoritative; the AI never computes a number.

---

## Decided in Phase 0 (architecture) — `docs/architecture/`

The nine documents of Phase 0 record their reasoning in full; the entries below are
the decisions a later change would otherwise reverse by accident, each one costly
to rediscover. `docs/architecture/00-KONVENTIONEN.md` is the binding form of all of
them and wins over any domain document.

### D-12 · The ArbZG check crosses entity boundaries through exactly one door (K-06)

Invariant 9 and D-09 require working-time limits to aggregate **per human, across
entities**. Strict tenant RLS makes that impossible, and it fails *silently*: the
check returns "no conflict" and a 6 h + 5 h day is scheduled as lawful.

One sanctioned crossing exists and no other: `app.arbzg_belastung(...)`, a
`SECURITY DEFINER` function over `zeit_intern.arbeitszeit_fenster` — a schema
PostgREST does not expose — which returns **durations and interval boundaries and
nothing else**. Never the other entity's name, `objekt`, `kunde` or wage rate. Every
call is audit-logged, and an isolation test asserts that nothing identifying leaks.
The window row is keyed on `person_id`; resolving person → `anstellung` →
`einsatz_zuordnung` inside the function instead cannot reach an actual-time window
projected from a `zeiteintrag`, so it under-counts worked time — the same silent
failure one layer down.

### D-13 · Wage confidentiality is a column grant, not a masking view (K-05)

D-09 rule 6 says a manager in cleaning must not see security wage rates. The first
draft used a view that did `select a.*` and then added a masked copy of the rate
beside it. Both repairs fail: `security_invoker` needs privileges that were just
revoked, and without it the view runs as an owner that ignores the tenant predicate.

So `anstellung.stundensatz_intern` is **revoked at column level** from the
application role and read through a `SECURITY DEFINER` accessor that re-checks the
right. The same construction protects `agent_schritt.eingabe`/`ausgabe`,
`agent_artefakt.inhalt` and `freigabe_snapshot.pruefdauer_sek`.

### D-14 · Four read scopes, and every accessor resolves in all four (K-18, K-20)

The employee portal and the customer portal span tenants **as a subject**, not as a
manager. Routing them through group scope means the group policy demands a
`gruppe.*` right they never hold, and both portals read zero rows; widening that
right hands every cleaner a group-level read.

The scopes are `mandant · gruppe · person · kunde`. Group scope is read-only
(invariant 10) and is entered only with an `intern` membership plus a
`gruppe.<modul>.lesen` right. Every `app.*` accessor states its value in all four
scopes; one that is undefined — or defined but not usable — in a scope may not be
named by any policy reachable from it.

### D-15 · The portal lives under `/portal` (K-07)

Without the prefix, `/reinigung` is simultaneously a public marketing page and a
tenant dashboard, and one of the two silently wins: either every tenant switch lands
a manager on a marketing page, or the four short marketing URLs 404. There is no
configuration in which both work. The prefix also shrinks the reserved-slug problem
to five values — `gruppe`, `mein`, `kunde`, `konto`, `api` — held as **one list**, with
a CI test that walks the App Router tree and fails on a new static segment that is
not in the constraint.

### D-16 · The AI supplies no number, and no input that determines one (K-10)

Invariant 6 says the AI never computes money, quantities or deadlines. Phase 0
tightens it: a model may not supply an **argument that decides a number** either.
Choosing the surcharge profile is choosing the margin, which is setting a price; a
free date string decides a billing period. Tool arguments are handles and register
tokens, never amounts, rates or formulas, and every figure comes from a tested
function in `src/server/services/`.

### D-17 · An unregistered right key is permanent, silent denial (K-19)

`app.hat_recht()` returns **false** for a key it does not know — no exception, no log
line, only a screen that is always empty. So the permission catalogue is closed and
owned by one document, and CI checks it in three directions: no code may name a key
absent from the catalogue, no catalogue key may go unused, and **no catalogue key may
be unwritable** — its module must be one of the 47 and its action one of the 42. The
third check exists because 25 keys once used actions the enum did not have; the first
two compare code against the catalogue and back, so a key wrong in both places passes
both.

### D-18 · The DST reference cases, with the values verified

The transition **night begins the evening before** the transition day. A drafted plan
named `2026-03-29` and `2026-10-25` and asserted 420 and 540 minutes against shifts
that are ordinarily 480. Correct:

| Case | Interval (Berlin) | Duration |
|---|---|---|
| Ordinary night | `22:00 → 06:00` | **480 min** |
| Spring forward | `2026-03-28 22:00 → 03-29 06:00` | **420 min** |
| Fall back | `2026-10-24 22:00 → 10-25 06:00` | **540 min** |
| Control: a shift starting 22:00 **on** a transition day | | **480 min** |

The control is asserted so an off-by-one fixture cannot pass. These are the first
tests of the first code PR, before any table and any UI.

---

## Decided in Phase 1 (implementation)

### D-19 · A solid danger surface uses `--danger-strong`, and every text token passes AA

The axe run over the whole design system found two failures, and both lived in
`docs/DESIGN.md` rather than in the code implementing it:

| Pair | Was | Required |
|---|---|---|
| White on `--danger` `#EF4444` (danger button) | 3.76:1 | 4.5:1 |
| `--text-subtle` `#71717A` on `--surface` | 3.93:1 | 4.5:1 |

Both were corrected in DESIGN.md **first**, then mirrored into the code, because
CLAUDE.md makes DESIGN.md the source and not the record of what was built.

**Nachtrag: die Pille selbst war der dritte Fall.** D-19 prüfte `--danger` als
Text auf `--danger-soft` über `--surface` und liess es stehen. Eine Pille sitzt
aber auf Karten, und `-soft` sind 12 % Alpha — der wirkliche Hintergrund ist
fast der Untergrund darunter. Gemessen:

| Text auf `-soft` über … | `--surface` | `--surface-2` | `--surface-3` |
|---|---|---|---|
| `--danger` `#EF4444` (alt) | 4.53 | 4.22 | **3.86** |
| `--info` `#3B82F6` (alt) | 4.55 | 4.23 | **3.86** |
| `--danger` `#F26A6A` (neu) | 5.72 | 5.33 | 4.88 |
| `--info` `#5895F7` (neu) | 5.63 | 5.23 | 4.77 |

`--success` (5.88 im schlechtesten Fall) und `--warning` (6.16) bestanden schon
und bleiben unverändert. Gefunden hat es nicht die Prüfung, sondern der Seed:
`/portal/mein` trug erstmals eine Schicht im Zustand „Geplant", und mit der
ersten Pille erschien der Verstoss, der seit D-19 dort lag. Eine Tabelle ohne
Zeilen verbirgt den Fehler, den die erste echte Zeile findet.

1. **`--danger-strong: #DC2626` is a new token, not a replacement.** `--danger`
   must stay light: it is read *as text* on `--danger-soft` and on the dark
   surfaces. The danger *button* is the inverse case — white on a solid fill.
   One token cannot satisfy both, so a solid danger surface takes
   `--danger-strong` (4.83:1 under white) and everything else keeps `--danger`.

2. **`--text-subtle` moved `#71717A` → `#8B8B95`** (5.63:1 on `--surface`,
   5.93 on `--ink`, 4.86 on `--surface-3`). The old value carried the reasoning
   that it is "for `xs` meta only". That does not survive WCAG: 11px and 13px
   meta is still text, and AA grants no small-text exemption — only a *large*-text
   one at 18.66px bold or 24px. The three-level hierarchy survives the change;
   `--text-subtle` is now confined to meta, timestamps and placeholders by
   **role**, not by being hard to read.

BFSG applies to this platform, so a token that cannot meet AA is a defect and
not a deliberate step. `tests/design/tokens.test.ts` now asserts all three text
tokens pass on all three surfaces, and asserts the hierarchy still descends.

### D-20 · `/dev/**` is a 404 in production, not merely a `robots.txt` line

`/dev/kitchensink` renders every component, token and placeholder the platform is
built from. `robots.txt` asks crawlers not to index it; it does not stop anyone
typing the URL, and the page is unauthenticated by design so it can be
axe-tested. The gate is therefore in the page: `src/lib/dev-flaechen.ts` decides
at build time, and the route calls `notFound()` when the answer is no.

- `pnpm dev` → on, so the design system stays reviewable while working
- a production build → **off**, unless `CSE_DEV_FLAECHEN=1` is set deliberately
- the Playwright suite sets that flag, because it must test the real production
  build rather than a development render with its overlays

Verified against a production build with no flag: `/dev/kitchensink` answers 404
while `/healthz` answers 200. Both the flag logic and the `robots.txt` rule are
tested — the two are belt and braces, not alternatives.

### D-21 · Invariant 8 covers `TRUNCATE`, not only `DELETE`

The `BEFORE DELETE` trigger of K-16 is a **row** trigger. `TRUNCATE` empties a
table without producing rows, fires no row trigger, and is therefore a hard
delete of everything that walks straight past the protection written to stop
one. Every delete-locked table carries a second, statement-level
`BEFORE TRUNCATE` trigger on the same function.

Two consequences worth stating rather than discovering:

- A `BEFORE DELETE` trigger has nothing to fire on in an **empty** table, so
  `DELETE FROM audit_log` there succeeds having deleted nothing. That is not a
  hole, but it does mean the acceptance test has to write a row first — a test
  against an empty table would have passed with no trigger at all.
- The test harness can no longer reset by emptying tables. It uses
  `session_replication_role = replica`, which is superuser-only (no application
  role can reach it) and explicit. It must be set with `SET LOCAL` inside one
  transaction: on a pooled connection a plain `SET` and its `RESET` can land on
  two different connections and leave one in replica mode for the rest of the
  run, at which point triggers silently stop firing on whichever queries happen
  to pick it. That is how this was found — as a missing audit row and a
  `geaendert_am` the caller was allowed to keep.

### D-22 · The audit payload is restricted by column grant, exactly as the wage rate is

`0004` granted `SELECT` on `audit_log` table-wide. Until PR 4 that leaked
nothing, because no trigger wrote a payload. From PR 4 on, `vorher`/`nachher`
carry the changed values themselves — including `stundensatz_intern`, the one
column K-05 spends an explicit column-list grant on `anstellung` to withhold.
A table-wide grant on `audit_log` hands the same number back one statement
later, and every K-05 test still passes while it does.

`05-API-KARTE.md` §B settles the direction: **sensitive values are restricted,
not omitted** — omitting them makes a wage-rate change unreconstructable, which
is the opposite of what SEC-A9 and a wage dispute need. So the values are
written and the *read* is gated:

- `cse_app` holds an explicit column-list `SELECT` on `audit_log` that omits
  `vorher` and `nachher`. `geaendert_felder` stays granted: *that* a rate
  changed is not the secret.
- `app.audit_nutzlast_lesen(bigint)` returns the payload behind
  `system.audit_sensitiv_lesen`, re-checking the tenant because a definer is
  not subject to the policy.
- The same Postgres fact as K-05 applies and is why this is a grant and not a
  revoke: a table-wide `GRANT SELECT` followed by `REVOKE SELECT (spalte)`
  changes nothing at all.

### D-23 · `app.hat_recht` exists now and answers `false` to everything

The rights catalogue lands with PR 6, but two accessors need the gate before
then. `app.hat_recht(text)` is created in `0005` returning `false` for every
key. That is not a stub standing in for the real answer — it **is** the answer
D-17 requires: an unregistered right key is permanent, silent denial. A version
returning `true` while the catalogue is missing would leave every accessor
behind it open, and the day the catalogue arrived would be the day the platform
quietly narrowed. Failing closed makes the missing catalogue visible as an
empty screen instead.

### D-24 · `app.hat_recht` braucht die Mandanten-Signatur, und der Trigger beweist es

`05-FINANZEN.md` §3.3 ruft im `nummernkreis`-Trigger
`app.hat_recht('nummernkreis.verwalten', new.mandant_id)` auf — mit **zwei**
Argumenten. PR 4 legte nur die einstellige Form an; ohne die zweite liess sich
`0006` nicht einmal anwenden. Das zweite Argument ist keine Kosmetik: ein Recht
gilt je Gesellschaft, ein `leitung` in der Reinigung hält
`nummernkreis.verwalten` dort und nirgends sonst, und die einstellige Form kann
diese Frage gar nicht stellen. Beide antworten bis PR 6 `false` (D-23).

**Folge, die hier festgehalten wird, damit sie später nicht als Fehler gesucht
wird:** solange `hat_recht` fail-closed antwortet, kann niemand einen
Nummernkreis **bestätigen** (`ist_platzhalter` auf false setzen), und damit wird
bis PR 6 keine Rechnung festgeschrieben. Ein Test hält genau das fest.

### D-25 · Die TEN-02-Bedingung gilt für die abrechnenden Kreistypen

§3.3 verlangt einen Trigger, der `mandant.eigener_nummernkreis = true` fordert,
und begründet ihn wörtlich damit, dass sonst **nichts eine Abteilung davon
abhält, Rechnungen auszustellen**. Wörtlich auf alle neun Kreistypen angewandt
wäre die Bedingung falsch: `wachbuch` und `leistungsnachweis` sind keine
Rechnungen, und eine Gesellschaft ohne eigenen Rechnungskreis könnte dann kein
Wachbuch führen — was Phase 5 bricht. Die Bedingung gilt deshalb für
`ausgangsrechnung` und `gutschrift`, also für genau die Population, über die die
Begründung spricht. Die Liste steht als Konstante im Trigger, damit ein
zehnter Typ eine Entscheidung erfordert statt stillschweigend durchzurutschen.

### D-26 · Die Anwendung hält auf den Rechnungskreisen keine UPDATE-Policy

§1.1 beschreibt `d_kreis_ziehen` als den Weg, den fünf der neun Kreistypen
nehmen; die abrechnenden gehen durch `fin.rechnung_nummer_ziehen`
(SECURITY DEFINER, PR 46), der die Kette **in derselben Transaktion**
mitschreibt. Eine Policy ohne diese Einschränkung war weiter als die Vorgabe:
`cse_app` konnte den Rechnungszähler bewegen, **ohne** den Kettensatz zu
schreiben — eine vergebene Nummer ohne Kettenglied, die erst dem nächtlichen
Prüflauf auffiele. `kreis_typ NOT IN ('ausgangsrechnung','gutschrift')` steht
jetzt in `USING` und in `WITH CHECK`, und `vergebeNummer` verweigert dieselben
Typen mit benanntem Grund, statt geräuschlos null Zeilen zu treffen.

### D-27 · Diagnose vor Sperre — warum `d_kreis_lesen` unbeschränkt ist

Ein `SELECT … FOR UPDATE` unter der Zugriffs-Policy findet einen Platzhalter
oder einen geschlossenen Kreis gar nicht, und der Aufrufer bekommt "kein Kreis"
statt "dieser Kreis ist noch nicht bestätigt". Das ist der Grund, aus dem §1.1
`_lesen` innerhalb des Mandanten ausdrücklich **unbeschränkt** lässt.
`vergebeNummer` liest deshalb zuerst zur Diagnose und sperrt erst danach, und
liest den Zustand nach der Sperre erneut — zwischen beiden Schritten kann eine
andere Transaktion den Zähler bewegt haben, und die gesperrte Zeile ist die
massgebliche. Aus der Reinigung heraus bleibt der Kreis der Security dabei
`kein_kreis` und nie `geschlossen`: die Fehlermeldung darf seine Existenz nicht
verraten (Invariante 3).

Ein Datum in einer solchen Meldung kommt als `to_char(…, 'YYYY-MM-DD')` aus SQL
und nicht als JS-`Date`, dessen Textform von der Zeitzone der Maschine abhängt.

### D-28 · Der Zähler ist eine Zeile, keine Sequenz — und das ist prüfbar

`nextval` rollt nicht zurück: wer eine Nummer zieht und die Transaktion
abbricht, hinterlässt eine Lücke, und §14 UStG duldet keine. Der Zähler ist
deshalb eine Spalte unter `SELECT … FOR UPDATE`. Der Preis ist Serialisierung,
und der Preis ist der Zweck. Zwei Tests trennen "Lücken sind unwahrscheinlich"
von "Lücken sind unmöglich": 200 gleichzeitige Transaktionen ergeben 200
Nummern mit `max − min + 1 === count`, und eine abgebrochene Transaktion lässt
den Zähler stehen, so dass die nächste erfolgreiche Vergabe **dieselbe** Nummer
bekommt.

Die Suche läuft auf dem **offenen** Schlüssel
`(mandant_id, kreis_typ, kontext_id) WHERE geschlossen_am IS NULL`, nie über
das heutige Jahr. Ein Kreis mit `zuruecksetzung = 'nie'` trägt `jahr = 0`; eine
Suche nach dem laufenden Jahr findet ihn nicht, und die Festschreibung scheitert
dann dauerhaft für genau die Gesellschaften, die über Jahre durchnummerieren.
Ein Test führt beide Suchen nebeneinander aus und zeigt, dass die zweite null
Zeilen liefert.

### D-29 · Trenner und Genesis sind Teil des Digests, nicht Konvention

`hash = SHA256(canonical_bytes ‖ 0x1E ‖ vorheriger_bytes)`, wobei
`vorheriger_bytes` die **32 rohen Bytes** des Vorgängers sind und der Genesis
32 Nullbytes. Beide Entscheidungen sind unsichtbar, solange nur eine
Implementierung existiert — und die zweite läuft in SQL
(`fin.rechnung_kette_schreiben`), absichtlich getrennt, damit der nächtliche
Lauf eine unabhängige Neuberechnung ist statt einer Tautologie. Ein
Golden-Vector-Test schreibt den Digest des ersten Satzes aus und zeigt, dass
ohne Trenner, gegen einen leeren Vorgänger oder gegen den Hex-**Text** statt der
rohen Bytes jeweils ein **anderer** Digest entsteht.

Die Kette ist über die Jahresgrenze hinweg **eine Linie**: ein Folgekreis setzt
mit `genesis_hash` fort. Der Entwurf begann jedes Jahr neu bei 32 Nullbytes,
womit ein ganzes Geschäftsjahr unverkettet danebengelegen hätte. Der Prüfer
meldet das **erste** kaputte Glied und repariert nie — ein Prüfer, der
repariert, kann nicht mehr bezeugen, dass nichts geändert wurde.

### D-30 · Jede Tabelle bekommt ihre Sperren in der Migration, die sie anlegt

Der Generator aus PR 4 schrieb einen einzigen Block nach `0005`. Beim ersten
Tisch, der später kommt, ist das falsch: `nummernkreis` entsteht in `0006`, und
ein Trigger lässt sich nicht vor seiner Tabelle anlegen. Jeder Registry-Eintrag
trägt jetzt seine Migration, der Generator schreibt einen Block je Migration,
und ein Test prüft für jede Tabelle, dass ihre Sperren in **ihrer** Migration
stehen und in keiner anderen.

### D-31 · Es gibt eine plattformweite Einstellungstabelle, weil beide Vorgaben zusammen sie erzwingen

`03-AUTH-BERECHTIGUNGEN.md` §10 legt jede AUT-07-Schwelle in `einstellung` ab.
Deren Eigentümertabelle `mandant_einstellung` (`01-KERN.md` §6.30) trägt
`mandant_id NOT NULL` und sagt ausdrücklich: **es gibt keine plattformweite
Zeile**, damit ein Default nie unbemerkt für alle vier Gesellschaften gilt. Ein
Anmeldeversuch findet aber statt, bevor irgendein Mandant bekannt ist — es gibt
in diesem Moment keine Einstellung zu lesen.

`plattform_einstellung` ist das, was übrig bleibt, wenn beide Sätze gelten. Der
Namensraum ist bewusst getrennt, damit niemand eine Betriebseinstellung dorthin
legt und sie versehentlich für die ganze Gruppe setzt. Alle Werte tragen
`ist_vorlaeufig = true` und stehen unter O-80 bzw. O-92 (K-17).

### D-32 · 404 statt 403 hat genau zwei Ausnahmen, und beide sind begründet

AUT-06: ein fremder oder unerlaubter Datensatz antwortet **404**, mit einem
Körper, der dem eines wirklich fehlenden gleicht — ein 403 sagt "das gibt es,
du darfst nur nicht", und das ist die Auskunft, die eine Aufzählungsattacke
braucht. Deshalb gibt es keinen `ForbiddenError` für Ressourcen, und der
404-Körper ist **eine** eingefrorene Konstante: zwei Stellen, die ihn je selbst
zusammensetzen, weichen irgendwann in einem Leerzeichen voneinander ab, und ein
Leerzeichen ist ein Orakel.

403 bleibt den zwei Fällen, in denen die Existenz ohnehin bekannt ist: das
eigene gesperrte Konto (AUT-07) und die fehlende zweite Stufe (AUT-02) — dort
hiesse ein 404 "melde dich neu an" statt "zeig den zweiten Faktor".

Ein Test prüft nicht nur, dass beide Fälle 404 sind, sondern dass ihre
**Meldungen identisch** sind: von aussen unterscheidbar zu sein ist der Defekt,
nicht der falsche Statuscode.

### D-33 · Der zweite Faktor ist eine Eigenschaft der Anmeldung, nicht des Kontos

`app.hat_zweiten_faktor()` liest `auth.mfa_factors` **live** statt einer
Spiegelspalte auf `benutzer` (review B18): eine gespiegelte Spalte ohne
Abgleichspfad ist genau dann falsch, wenn es darauf ankommt — der Faktor wurde
entfernt, die Spalte sagt weiterhin ja.

Und `app.ist_super_admin()` verlangt zusätzlich `app.aal() = 'aal2'`. Ein Konto,
das einen Faktor besitzt, ihn in dieser Sitzung aber nicht vorgezeigt hat, ist
`aal1` und damit kein Super-Admin. Der Datenbank-Trigger `benutzer_2fa_pflicht`
ist die **zweite** Linie, nicht die einzige: eine Prüfung nur dort hiesse, wer
den Faktor nach dem Aktivieren entfernt, behält alles.

Auf dem `SELECT` von `benutzer_mandant` liegt bewusst **kein** aal2-Gate
(K-15): eine restriktive aal2-Policy dort gäbe jedem `leitung`, `mitarbeiter`
und `kunde` null Zeilen, `sichtbare_mandanten()` wäre leer, jede darauf gebaute
Policy false — und die Plattform ginge für alle Nicht-Admins schwarz,
einschliesslich Check-in und Kundenportal. Das Gate sitzt auf dem Schreibpfad.

### D-34 · Die Sitzungstabelle wird nicht allgemein auditiert

`benutzer_sitzung` steht bewusst nicht in `AUDITIERT`.
`app.sitzung_aufloesen` stempelt bei **jeder Anfrage** `letzte_aktivitaet_am`;
ein allgemeiner Audit-Trigger schriebe eine `audit_log`-Zeile pro Seitenaufruf
und ertränke den Trail, den er führen soll — in einer Tabelle, die zudem
hash-verkettet ist und dann jede Anfrage hinter dem Kettenkopf serialisierte.
Was zählt, schreibt `kern.sitzung_wechsel_audit` gezielt: jeder Bereichs- und
Ansichtswechsel, mit dem Paar in `vorher`/`nachher` statt in eigenen Spalten
(TEN-09, §4.4).

Aus demselben Grund ist `kern.anmeldeversuch` eine eigene Tabelle und nicht
`audit_log`: die Sperrabfrage lautet "Fehlversuche von dieser IP und für diese
Kennung im Fenster", ein Zähler je Benutzer kann Versuche gegen **nicht
existierende** Konten nicht bremsen — und genau das ist der Enumerationsfall,
für den AUT-07 existiert. Eine zusammenfassende `audit_log`-Zeile je Sperrung
genügt AUT-08.

### D-35 · Die Routenprüfung scannt `src/app/**`, nicht `src/app/api/**`

Der Plan nennt `app/api/**`. `healthz` liegt aber schon heute als
`src/app/healthz` daneben: eine Prüfung auf `api/` allein hätte diese Route —
und jede künftige ausserhalb von `api/` — nicht abgedeckt, **während sie
meldet, alles sei abgedeckt**. Gescannt wird das Dateisystem, nicht eine
gepflegte Liste, damit eine neue Route automatisch erfasst ist; das Manifest
sagt, welches Recht gilt, und ein zweiter Test prüft, dass der Handler
`authorize()` auch wirklich aufruft. Server Actions (`'use server'`) werden
mitgeprüft: eine Prüfung, die nur Route Handler kennt, deckt den halben Eingang
ab.

Eine absichtlich offene Route steht mit `recht: null` **und einer Begründung**
im Manifest. Sie fehlt dann nicht — sie ist eine Entscheidung, die jemand
getroffen hat.

### D-36 · Der Rechtekatalog wird aus dem Dokument ERZEUGT, nicht abgetippt

Der Katalog gehört `03-AUTH-BERECHTIGUNGEN.md` §12 und nur ihm (K-19).
`scripts/katalog/extrahiere.ts` liest die Matrix — dieselben Glyphen, die ein
Mensch dort liest — und schreibt daraus die TypeScript-Fassung und den
Seed-Block von `0008`. Eine abgetippte zweite Fassung gewinnt beim ersten
Widerspruch mit dem Dokument, ohne dass jemand den Widerspruch sieht, und ein
falscher Schlüssel ist unter K-19 kein Fehler, sondern ein dauerhaft leerer
Bildschirm.

**`gruppe.*.lesen` ist eine Sammelzeile und wird entfaltet.** §12.1 sagt
wörtlich "mechanisch eine Zeile je Modul aus §7.4". Der erste Lauf des
Extraktors übersprang sie stillschweigend, weil sein Muster `[a-z_]` verlangte
und die Zeile ein `*` trägt — und damit fehlte **jeder** Gruppenlese-Schlüssel:
genau der K-19-Ausfall, den derselbe Abschnitt beschreibt. 159 Matrixzeilen
werden so zu **207** Katalogschlüsseln (46 Module plus die zwei mit Objektsilbe,
`gruppe.system.audit_lesen` und `gruppe.dienstplan.arbzg_lesen`; `gruppe`
selbst wird nicht entfaltet, `gruppe.gruppe.lesen` benennt nichts).

### D-37 · Die K-19-Prüfung braucht zwei Detektoren, nicht einen

Die naheliegende Prüfung sucht Schlüssel an ihrem **Modul**. Sie ist blind für
genau den Fall, den die Vorgabe als Fixture nennt: `rechnung.lesen`. Das Modul
`rechnung` gibt es nicht (der Schlüssel heisst `finanzen.lesen`), der
Modulfilter greift nicht, und ein erfundener Schlüssel käme durch. Der zweite
Detektor sucht deshalb die **Stelle**: was in `hat_recht(…)` steht oder unter
`recht:` im Routenmanifest, ist ein Rechteschlüssel, egal wie sein erstes
Segment heisst. Ein Fixture mit `rechnung.lesen` bricht den Build, verifiziert.

Zwei falsch-positive Quellen mussten weg, und beide hatten die Prüfung
zunächst wertlos gemacht:

- Der erzeugte Seed-Block enthält naturgemäss jeden Schlüssel. Mitgezählt war
  jeder Schlüssel immer "benutzt" — die Prüfung eine Tautologie, im ersten Lauf
  mit dem Ergebnis "0 unbenutzt von 207".
- Kommentare. Zwei Erwähnungen in Prosa (`` `nummernkreis.letzter_hash` ``,
  `` `system.rechte_verwalten` ``) zählten als Benutzung. Ein Schlüssel, der
  erwähnt wird, wird nicht geprüft.

Die Gegenrichtung — "keine Katalogzeile ohne Zweck" — läuft gegen eine
**eingefrorene** Warteliste (202 von 207). Die Zusage ist Teilmengenschaft: die
Menge der unbenutzten Schlüssel darf nur schrumpfen. Ein neu erfundener
Schlüssel, den niemand prüft, steht nicht darauf und bricht den Build; ein
Modul, das landet, streicht seine Zeilen. Die Prüfung abzuschalten, weil die
Plattform erst zu 7 % gebaut ist, hätte sie für den Rest des Projekts
abgeschaltet.

### D-38 · `system.rechte_verwalten` gibt es nicht — der Schlüssel heisst `system.rolle_verwalten`

Beim Schreiben des Editor-Triggers habe ich `system.rechte_verwalten`
verwendet. Der Katalog kennt ihn nicht. Unter K-19 wäre das kein Fehler
gewesen, sondern ein Rechte-Editor, der für **jeden** Benutzer dauerhaft
"fehlende Berechtigung" meldet — die Sorte Defekt, die man in der Produktion
sucht und nicht findet. Genau dafür ist die Prüfung aus D-37 da; sie hat ihn
gefunden.

`system.rolle_verwalten` ist für `admin` ausserdem nur **bindbar** (`○`), nicht
gebunden (`✔`): den Rechte-Editor bekommt ein Bereichsadmin, wenn jemand ihn
ihm gibt. Ein Test, der stillschweigend annahm, ein `admin` habe ihn, war
falsch — nicht die Matrix.

### D-39 · Dreiwertige Logik im Aussperrschutz, und die Reihenfolge der Prüfungen

Der Trigger, der den letzten `super_admin` schützt, begann mit
`if not (old.globale_rolle_id = v_sa and …)`. Ist die Spalte NULL, ist der
Vergleich NULL, `not NULL` ist NULL, das `if` greift nicht — und der Schutz
schlug bei einem Konto zu, das mit Super-Admin nie etwas zu tun hatte. Gefunden
hat es die Sperrprüfung aus PR 6, die ein gewöhnliches Konto sperrte und daran
scheiterte. `is distinct from` kennt kein NULL; der Vergleich steht jetzt so da.

Im Editor-Trigger kommt der Aussperrschutz **vor** der Rechteprüfung und gilt
auf jedem Weg, auch dem einer Migration: `super_admin` ist die Rolle, über die
Rechte überhaupt vergeben werden, und ihr eines zu entziehen ist dieselbe
Aussperrung wie das Konto zu deaktivieren, nur durch die andere Tür. Die
Rechteprüfung dagegen gilt nur für Handelnde — ohne angemeldeten Benutzer läuft
kein Editor, sondern ein Seed, der keine Rolle hat, deren Rechte man prüfen
könnte.

### D-40 · Bekannte Lücke: 24 Module ohne `<modul>.schreiben` im Katalog

K-03 fixiert die Standardpolicy jeder Mandantentabelle mit
`app.hat_recht('<modul>.schreiben', mandant_id)` in der `WITH CHECK`. Die
Matrix in §12 führt für **24** der 47 Module keine `.schreiben`-Zeile (und für
15 keine `.lesen`-Zeile). Wo diese Module Tabellen bekommen, würde die Policy
einen Schlüssel nennen, den der Katalog nicht hat — und unter K-19 hiesse das:
die Tabelle liest und schreibt nichts, dauerhaft, ohne Fehlermeldung.

Hier wird **nichts erfunden**: die betroffenen Module haben heute keine
Tabellen (sie landen in Phase 4 bis 9), und ein Schlüssel, den niemand
entschieden hat, gehört nicht in den Katalog. Stattdessen greift der Mechanismus
aus D-37 zum richtigen Zeitpunkt: sobald eine Policy `crm.schreiben` nennt,
bricht die K-19-Prüfung den Build, und jemand fügt die Katalogzeile bewusst
hinzu — oder stellt fest, dass der Schlüssel anders heisst. Die Lücke ist damit
nicht geschlossen, aber sie kann nicht mehr stillschweigend passiert werden.

### D-41 · Die Gruppenansicht hat keine Schreibmethode — als TYP, nicht als Prüfung

`withGroupScope` gibt `LeseKontext` zurück, `withTenant` gibt `SchreibKontext`
zurück, und `schreibe` steht nur auf dem zweiten. Ein Schreibversuch in der
Gruppenansicht ist damit ein **Compilerfehler**, nicht eine Laufzeitentscheidung
— Invariante 10 wird von niemandem vergessen, weil sie sich nicht formulieren
lässt. Ein Test führt `tsc` gegen ein Fixture, das es trotzdem versucht.

Die zweite Linie steht daneben und ist die, auf die es ankommt, wenn jemand am
Code vorbei arbeitet: kein `INSERT`/`UPDATE`-Policy irgendwo nennt den
Gruppen-Scope, also trifft ein direkter Schreibversuch keine Policy. Die
Datenbank weist ihn **benannt** ab (`KeinAktiverMandant` aus
`app.assert_genau_ein_mandant`) statt lautlos null Zeilen zu treffen — beides
wäre sicher, nur eines sagt warum.

Das Dienstregister (`server/registry/dienste.ts`) wird vom Gruppentest
**iteriert**, und ein Gegentest verlangt, dass jeder Dienst unter `services/`
darin steht. Ein Modul, das in Phase 5 landet, ist damit automatisch
mitgeprüft — statt in einer Liste zu fehlen, die jemand hätte pflegen müssen.

### D-42 · `Nur Lesen` fehlte in DESIGN §5, obwohl §6 es verlangt

§6 lässt die `Gruppenübersicht`-Zeile und den Header eine `NUR LESEN`-Pille
tragen. Die feste Pillen-Liste in §5 kannte sie nicht — "fest" also nur, bis
jemand §6 liest. Eine Pille, die der Umschalter zeigen muss und das Typsystem
nicht ausdrücken kann, wird entweder am Aufrufort erfunden oder der Screen
fehlt; beides ist schlechter als eine Zeile mehr in der Tabelle. Sie steht
jetzt dort, als `warning`, mit dem Vermerk, dass sie ein **Modus** ist und kein
Datensatzzustand — der einzige, und deshalb allein stehend.

Der runde Markenavatar (32px, 2px Ring im Identitäts-Hue) stand dagegen bereits
in §6 und musste nur gebaut werden. Ohne Bild: O-12 ist offen, und ein
erfundenes Logo sähe fertig aus.

### D-43 · Bei einem Bereich wird der Umschalter NICHT gerendert

DESIGN §6 Regel 1 sagt "ein Bereich = ein statisches Logo, kein Chevron, kein
Dropdown". Umgesetzt als früher `return`, nicht als `hidden` oder
`display:none`: ein Auslöser, den man nicht sieht, aber im Quelltext findet,
ist eine Einladung an jeden, der die Seite liest. Ein Test prüft, dass im frühen
Zweig weder `chevron` noch `umschalter-menue` vorkommt.

Der 3px-Identitätsstreifen ist das **erste** Element im Dokument und trägt in
der Gruppenansicht `--border-strong` statt eines Bereichs-Hues: dort ist kein
Bereich aktiv, und einen zu zeigen wäre eine Aussage über den Arbeitskontext,
die nicht stimmt. Der e2e-Test vergleicht die **berechnete** Farbe vor und nach
einem Wechsel — ein Token, das nicht auflöst, sähe im Markup richtig aus und
auf dem Schirm grau.

### D-44 · Gruppenrechte werden mit dem Mandanten der ZEILE geprüft

K-03s Gruppenpolicy lautet
`app.hat_recht('gruppe.<modul>.lesen', mandant_id)` — der Mandant der **Zeile**,
nicht der aktive, denn in dieser Ansicht gibt es keinen. `app.hat_recht` gibt
für `p_mandant IS NULL` folgerichtig `false` zurück; ein Test, der in der
Gruppenansicht `null` übergab, prüfte deshalb etwas anderes als er behauptete.

Zweitens: §12.1 bindet `gruppe.*.lesen` per Vorgabe nur an `super_admin`; für
`admin` und `leitung` ist es `○` — bindbar. Die Gruppenansicht ist eine
Funktion, die jemand vergibt, nicht eine, die jeder Bereichsleiter mitbringt.
Der Test prüft jetzt beide Zustände statt den zweiten anzunehmen.

Und `app.portal()` ist in dieser Ansicht die Konstante `intern`, beim Betreten
gebunden (K-20) — aus `aktiver_mandant` neu berechnet ergäbe es das
fail-closed `mitarbeiter`, was jede K-04-Mitarbeiterdecke **innerhalb** der
Gruppenansicht auslöst und sie für genau das Management leert, für das TEN-05
sie gebaut hat.

### D-45 · Die Reihenfolge im Upload-Pfad IST die Sicherheit

Groesse, dann Typ aus Magic Bytes, dann Metadaten entfernen, dann Aufbewahrung
aufloesen, dann speichern. Wer die Bereinigung nach dem Speichern macht, hat
das Foto mit GPS bereits im Bucket; wer die Typpruefung nach dem Speichern
macht, hat die `.exe` dort. Ein Test prueft deshalb nicht nur, dass ein
verkleideter Upload abgelehnt wird, sondern dass der Speicher danach **leer**
ist.

`exif_entfernt` heisst "durch die Bereinigung gegangen", nicht "hatte welches"
— sonst waere ein JPEG ohne EXIF nicht speicherbar. Der SHA-256 deckt die
**gespeicherten** Bytes, nicht die eingereichten.

### D-46 · PDF-Metadaten werden ueberschrieben, nicht herausgeschnitten

Ein PDF ist eine Objekttabelle mit Byte-Offsets in der `xref`. Ein Segment
herauszuschneiden verschiebt jeden Offset dahinter und macht die Datei kaputt —
beim Rechnungsarchiv der teuerste denkbare Weg, Metadaten loszuwerden. `/Info`
und der XMP-Block werden deshalb **gleich lang** mit Leerzeichen ueberschrieben:
alle Offsets bleiben gueltig, das Dokument oeffnet sich unveraendert, Autor,
Geraet und Zeitstempel sind weg. Ein Test prueft die unveraenderte Bytezahl.

Der erste Entwurf lehnte PDFs schlicht ab, weil es keinen Bereiniger gab — und
machte damit **Rechnungen unspeicherbar**, den haeufigsten Dokumenttyp der
Plattform. Verschluesselte PDFs werden weiterhin abgelehnt: ihre Metadaten sind
auf diesem Weg nicht erreichbar, und ein "scheinbar bereinigt" waere schlimmer
als ein benannter Fehler beim Upload. Fuer Video gilt dasselbe (O-25).

Bei JPEG wird bewusst **nicht neu codiert**: ein Re-Encode entfernt Metadaten
zuverlaessig und veraendert die Pixel — womit das Foto als Beweis in einer
Reklamation an Wert verliert. Die Bilddaten ab `SOS` bleiben Byte fuer Byte.

### D-47 · Die Uhr der signierten URL wird uebergeben, nicht gelesen

Invariante 5 gilt auch hier: ein Ablauf, der von der Uhr des Aufrufers
abhaengt, laeuft nie ab, wenn der Aufrufer seine Uhr stellt. Und ein Test
koennte den Minute-16-Fall gar nicht pruefen, ohne 16 Minuten zu warten.

Die Pruefreihenfolge ist Absicht: Signatur, dann **Ablauf**, dann Mandant. Eine
abgelaufene URL aus einem fremden Bereich meldet "abgelaufen" — die
Fehlermeldung soll nicht verraten, ob sie zu einem Bereich gehoerte, den es
gibt. Der Vergleich laeuft in konstanter Zeit; einer, der beim ersten falschen
Zeichen abbricht, verraet die Signatur zeichenweise.

### D-48 · Eine restriktive Decke gewaehrt nichts — sie braucht ihre Policy daneben

`p_ma_ceiling` auf `dokument` schneidet weg, was das Mitarbeiterportal nicht
sehen darf. Sie **gewaehrt nichts**: `t_mandant` verlangt `dokument.lesen`, und
das haelt die Rolle `mitarbeiter` nicht — was richtig ist, denn sie soll nicht
die Rechnungsablage sehen, sondern ihre Dienstanweisung. Mit nur der Decke las
das Mitarbeiterportal **null** Dokumente, auch die ausdruecklich freigegebenen.

Die gewaehrende `t_person`-Policy steht jetzt daneben, und ihr Zugang ist kein
Recht, sondern ein Subjektpraedikat: freigegeben und nicht geloescht. Beide
muessen passen (K-18). Dieselbe Lektion, die `05-FINANZEN` fuer `t_kunde`
ausdruecklich aufschreibt — hier fiel sie mir beim Bauen erneut zu.

Nebenbei: ein CHECK bekommt einen NAMEN. Ein anonymer meldet nur, dass
irgendeiner verletzt wurde; `dokument_exif_entfernt` sagt welcher.

### D-49 · Eine unbekannte Aufbewahrungsfrist ist eine Pflicht, keine Abwesenheit

`app.aufbewahrung_regel` ist ein `SECURITY DEFINER`, und der Grund ist konkret:
der Trigger laeuft als der Aufrufer, und der darf `dokument.schreiben` halten
ohne `dokument.lesen` — das Eingangsprinzip fuer Formular-Uploads ist genau
das. Ein direkter Lesezugriff auf `dokument_aufbewahrung` traefe dann null
Zeilen, und das Dokument laege ohne Aufbewahrungsdatum und ohne Loeschsperre
im Bucket. Still.

Findet sich keine Regel, gilt `aufbewahrung_bis = NULL` **und
`loeschsperre = true`**. Drei Kategorien (`mitarbeiter`, `projekt`,
`unternehmen`) tragen das dauerhaft, weil ihre Fristen je Unterlage
verschieden sind und niemand sie entschieden hat (O-25). Eine gesetzte Sperre
laesst sich nicht wieder loesen.

### D-50 · Die wichtigste Eigenschaft von `job_lauf` ist eine Abwesenheit

`job_lauf` hat **kein** `mandant_id`, und das ist der Entwurf, nicht eine
Auslassung. K-16(d) laesst genau eine mandantennahe Tabelle mit nullbarem
`mandant_id` zu — `audit_log` —, und ein naechtlicher Lauf ueber alle vier
Gesellschaften hat keinen einzelnen zu nennen. Schwerer wiegt: eine Zeile mit
`mandant_id IS NULL` in einer Tabelle, deren Policy darauf keyt, ist von jedem
Mandanten aus unsichtbar ODER fuer alle sichtbar, je nach Praedikat — und
beides ist falsch.

Das Ergebnis je Mandant lebt in `job_lauf_mandant`, dort mit `mandant_id NOT
NULL`. Ein Schema-Test prueft die Abwesenheit der Spalte, die Anwesenheit der
anderen, und dass die Entwurfsnamen (`job_schluessel`, `begonnen_am`,
`befund`, `status`) nirgends auftauchen.

### D-51 · Ein Job scheitert beim REGISTRIEREN, nicht um drei Uhr nachts

`bereich` (`je_mandant` | `uebergreifend` | `plattform`) ist Pflicht, und
`uebergreifend` muss man hinschreiben: ein Job ohne erklaerten Mandantenbezug
ist einer, bei dem niemand entschieden hat, ob er Mandantengrenzen
ueberschreitet. Ebenso abgewiesen werden ein Zeitplan, der kein 5-Feld-Cron
ist, ein doppelter Schluessel und `versuche > 10` — ein Job, der ewig
wiederholt, stirbt nicht, er faellt nur nie auf.

Die Idempotenz liegt auf einem **eindeutigen Index**, nicht in einer Variablen
im Prozess: zwei gleichzeitig ausgeloeste Laeufe treffen denselben Index, einer
gewinnt, der andere sieht das. Ohne sie erzeugt ein doppelt ausgeloester
naechtlicher Lauf zwei Mahnungen an denselben Kunden.

Bei `je_mandant` beendet ein scheiternder Mandant den Lauf fuer die anderen
nicht — er wird als eigenes Ergebnis vermerkt, und der Lauf ist `teilweise`.
Ein Alarm geht in beiden Faellen raus: ein Job, der scheitert und niemanden
erreicht, ist ein Job, der nicht laeuft, und das faellt erst auf, wenn jemand
die Zahlen vermisst.

### D-52 · Ein jsonb-Parameter wird nicht vorserialisiert

`JSON.stringify(kennzahlen)` als Parameter mit `::jsonb` sieht richtig aus und
schreibt einen jsonb-**String** statt eines Objekts: der Treiber serialisiert
json-Parameter selbst, und ein bereits serialisierter String wird ein zweites
Mal codiert. Jeder Lesezugriff auf ein Feld liefert danach `undefined` — die
Spalte ist nicht leer, sondern falsch geformt, was beim Lesen wie ein
fehlender Wert aussieht. Der Test vergleicht deshalb das ganze Objekt statt
eines Feldes.

`src/server/jobs/**` steht bewusst **nicht** im Dienstregister von PR 8: Jobs
laufen als `cse_job`, ausserhalb jeder Benutzersitzung, und die Frage "ist
dieser Dienst in der Gruppenansicht erreichbar" hat fuer sie keine Bedeutung.

### D-53 · Eine Benachrichtigung ohne Ziel entsteht gar nicht

NOT-03 sagt, jede Benachrichtigung fuehrt irgendwohin. Durchgesetzt wird das
bei der **Erzeugung**, nicht beim Klick: eine Mitteilung ueber ein Problem, das
man nicht ansehen kann, ist schlimmer als keine. Die Registrierung einer Art
verlangt deshalb Titel, Text und einen Zielaufloeser — und die Spalte `ziel`
ist `NOT NULL` mit `length > 1`, damit auch ein Weg an der Anwendung vorbei
nichts Leeres hinterlaesst.

**Der In-App-Posteingang laesst sich nicht abschalten.** Er ist das Protokoll
dessen, was jemandem mitgeteilt wurde; abgeschaltet wird der Push nach draussen.
Ein `CHECK` haelt `'app'` in jeder Praeferenzzeile.

**Eine Freigabeanfrage geht nie in eine Zusammenfassung.** Sammelbarkeit ist
eine Eigenschaft der ART und beim Erzeugen nicht uebersteuerbar — es gibt keinen
Weg, eine Freigabe doch noch in die Tagessammlung zu schieben. Invariante 7
haengt daran, dass jemand sie sieht, solange sie noch etwas aendert; Warten
haette dort dieselbe Wirkung wie Nichtstun.

### D-54 · Der Posteingang folgt dem Arbeitskontext

`app.sichtbare_mandanten()` liefert in `mandant`-Scope genau den aktiven
Bereich (K-18/K-20). Eine Benachrichtigung aus `bau` ist damit sichtbar,
waehrend man in `bau` arbeitet, und nicht, waehrend man in `reinigung`
arbeitet. Das ist die ENGE Auslegung und bewusst dieselbe wie bei jeder anderen
Tabelle. Ein bereichsuebergreifender Posteingang waere eine Erweiterung, die
jemand entscheidet — nicht eine, die aus einer Policy herausfaellt.

Was die Zeilenpolicy **nicht** prueft: ob die Mitgliedschaft noch besteht. Sie
liest `app.aktiver_mandant()` aus der Sitzung und vertraut ihm — zu Recht, denn
K-02 setzt den Wert serverseitig und `sitzung_mandant_pruefen` weist beim Setzen
jeden Bereich ab, zu dem keine lebende Mitgliedschaft besteht (PR 6). Die
Durchsetzung sitzt an der Sitzungsgrenze, nicht in jeder einzelnen Policy —
sonst muesste jede Tabelle der Plattform dieselbe Pruefung wiederholen. Ein
Test, der das an der falschen Stelle suchte, hat mich genau darauf gestossen.

### D-55 · Ein Angebot geht nie automatisch raus — im Code UND in der Datenbank

Ein Angebot ist ein bindendes Vertragsangebot (§ 145 BGB). Der Betrag ist
dabei **nicht** das Kriterium: eine Schwelle laedt dazu ein, sie zu erhoehen,
bis sie nichts mehr bedeutet. Die Sperre steht deshalb im Gate als Code und
zusaetzlich als `CHECK` auf `agent_richtlinie` — ein Skript, das die Zeile
direkt setzt, kommt auch nicht durch.

Der Aufzaehlungstest laeuft ueber den **ganzen** Konfigurationsraum: sechs
Aktionen × vier Rechtsgrundlagen × auto an/aus × sechs Limits × sechs Betraege
× aktiv/inaktiv = 2.304 Kombinationen, und `angebot_senden` ist in keiner
davon automatisch erlaubt. Ein Beispieltest haette gezeigt, dass die eine
Konfiguration, an die jemand gedacht hat, es nicht tut.

Mit menschlicher Freigabe geht das Angebot sehr wohl raus — die Sperre trifft
die Automatik, nicht die Sache. Auch das ist geprueft, sonst hiesse die Zusage
nur "Angebote gehen nie raus".

### D-56 · Drei Tore, in dieser Reihenfolge

**LEG-08 zuerst**, weil es durch nichts aufgehoben wird: ein Kontakt ohne
aufgezeichnete Rechtsgrundlage wird abgewiesen, ungeachtet jeder Freigabe.
§ 7 UWG ist nicht etwas, das ein Mensch per Klick ausser Kraft setzt.

**Dann die Freigabe.** Sie muss genehmigt sein, einen benannten Menschen
tragen (`CHECK` auf der Tabelle: Invariante 7 verlangt einen Menschen, nicht
einen Zustand) und per Hash zu **dieser** Nutzlast gehoeren. Wer nach der
Freigabe den Text aendert, hat keine Freigabe mehr fuer das, was er sendet.
Der Hash sortiert die Schluessel, sonst waere jede Freigabe zufaellig
ungueltig, je nachdem in welcher Reihenfolge jemand die Felder gesetzt hat.

**Zuletzt die Richtlinie**, und ohne sie: nein. Eine fehlende Regel ist keine
Erlaubnis — sonst waere der Tag, an dem jemand die Konfiguration loescht, der
Tag mit den meisten automatischen Mails. `auto_erlaubt` hat kein `DEFAULT
true`: eine Zeile, die versehentlich angelegt wird, erlaubt nichts.

Die Freigabekette zieht ihre Nummer unter `SELECT … FOR UPDATE` auf einem
Kopf je Mandant — dieselbe Mechanik wie `nummernkreis` und aus demselben
Grund: ohne serialisierte Gesamtordnung gabeln zwei gleichzeitige Freigebende
die Kette, und die naechtliche Verifikation meldet an jedem geschaeftigen Tag
einen Bruch. Verkettet wird nur der **Snapshot** (K-13): die `freigabe` aendert
ihren Status, und eine Kette ueber eine veraenderliche Zeile bewiese nichts.

### D-57 · Der eine Ausgang ist ein Waechter, nicht ein Vorsatz

Ein Mailtransport oder HTTP-Sender ausserhalb von `server/versand` bricht den
Build. Der Unterschied ist der zwischen "wir schicken alles ueber das Gate" als
Vorsatz und als Eigenschaft: der Vorsatz haelt, bis jemand unter Zeitdruck ein
`nodemailer` importiert, und danach faellt es niemandem mehr auf. Der Waechter
ist gegen ein Fixture verifiziert, das genau das tut.

### D-58 · Rechteschluessel werden nicht erfunden — auch nicht fuer eigene Tabellen

Fuer die Policies auf `freigabe` griff ich zu `freigabe.lesen`,
`freigabe.entscheiden` und `freigabe.richtlinie_verwalten`. Das Modul
`freigabe` steht in §7.4, aber die Matrix in §12 fuehrt fuer es **keine
Zeile**: die Schluessel des Posteingangs kommen mit PR 62, der ihn baut. Unter
K-19 waeren die drei dauerhaft `false` gewesen — der Freigabe-Posteingang
haette fuer immer null Zeilen gelesen, still. Die K-19-Pruefung aus D-37 hat
sie gefunden.

Die Policies stehen jetzt auf `versand.lesen` und `versand.freigeben`, die es
gibt und die genau das benennen, worum es geht: den Ausgang und seine
Freigabe. Wenn PR 62 die `freigabe.*`-Zeilen in den Katalog bringt, wandern sie
darauf.

### D-59 · Eine Tabelle ohne Policy muss eine REGISTRIERTE Ausnahme sein

`freigabe_kette` traegt `mandant_id` und bewusst keine `cse_app`-Policy: der
Kettenkopf wird ausschliesslich durch `app.freigabe_kette_ziehen` bewegt, und
eine Policy, die `cse_app` an die Zeile liesse, machte den Zaehler von aussen
verstellbar — eine Kette, deren Kopf jemand verstellen kann, bezeugt nichts.

Der Meta-Test aus PR 3 hat das zu Recht als Luecke gemeldet. Statt die Prüfung
aufzuweichen steht die Ausnahme jetzt in `NUR_UEBER_DEFINER`, mit Zugangsweg
und Begruendung, und der Test verlangt fuer registrierte Tabellen **genau
null** Policies. Eine Tabelle, die einfach keine hat, sieht sonst genauso aus
wie eine, bei der jemand sie vergessen hat — und der Unterschied ist der ganze
Punkt.

### D-60 · Der Bild-Overlay ist ein TOKEN, nicht ein Wert je Komponente

DESIGN §4.4 nennt den Pflicht-Gradient auf jedem Bild, das Text traegt. Ich
hatte ihn als Literal in die Markenkarte geschrieben — und die
`no-raw-color`-Regel hat es abgefangen, zu Recht: ausgeschrieben driftet er.
Eine Karte bei `0.55`, die naechste bei `0.5`, und die Lesbarkeit der
Ueberschrift haengt davon ab, welche Komponente jemand kopiert hat. DESIGN.md
fuehrt ihn jetzt als `--bild-overlay`, `theme.ts` und `globals.css` tragen ihn
unter demselben Namen, und der Drift-Test prueft beide Richtungen.

### D-61 · Kein Drittanbieter heisst: kein Cookie-Banner

PUB-13 verbietet Tracker. Daraus folgt, dass es nichts zu erlauben gibt — kein
Banner, keine Einwilligungsverwaltung, keine zweite Rechtsgrundlage. Der
Playwright-Test faengt **jede** Anfrage ab und zaehlt, was nicht auf den
eigenen Host geht: Schriften, Analytik, Karten. Null. Eine Zusage, die nur im
Kopf steht, haelt bis zum ersten `<script src="https://…">`.

### D-62 · Platzhalterbilder tragen ihren Zustand SICHTBAR

DESIGN §4.1 verlangt echte Aufnahmen und §4.2 verbietet KI-erzeugte Menschen
als Belegschaft — fuer ein Unternehmen, das Vertrauen und physische Praesenz
verkauft, faellt das in dem Moment auf die Fuesse, in dem es jemand bemerkt.
Bis der Mandant sein Material liefert (O-13), steht ein sichtbar leeres Bild
mit einer Marke daneben. Kein Stockfoto, das nach Belegschaft aussieht: ein
unauffaelliger Platzhalter ist einer, der in Produktion landet.

### D-377 · Der Modulriegel ist eine SCHNITTMENGE aus Recht und Buchung

Der Mandant hat es selbst gemeldet: „Ich klicke `admin` und `leitung` an und
sehe ueberall dasselbe." Er hatte recht, und die Rolle war nicht der Grund.
`navigation.ts` filterte ausschliesslich nach RECHT, und die Plattformrollen
`admin`, `leitung` und `super_admin` halten `reinigung.lesen`,
`security.lesen`, `wachbuch.lesen` und `schluessel.lesen` mit
`rolle.mandant_id is null` — also in JEDEM Bereich. Der Hochbau-Admin bekam
damit Sidebar-Punkte „Reinigung" und „Security" und erreichte
`/portal/bau/reinigung/reviere` mit 200, obwohl REALTIME Service nicht
reinigt. SEITENKARTE §1.7 versprach an dieser Stelle `notFound()`.

`mandant.module` gibt es seit 0001 und wurde im ganzen Baum nirgends gelesen
— eine Absicht ohne Umsetzung. Das Vokabular war schon da: 0008 schneidet die
Rechte einer Mitgliedschaft ueber `split_part(schluessel, '.', 1)` zu, ein
Modul ist also der erste Abschnitt eines Rechteschluessels. Dieselbe Regel
gilt jetzt fuer die Gesellschaft.

**Drei Stellen, oder keine.** Ein ausgeblendeter Menuepunkt ist keine Sperre
— die Adresse tippen kann jeder. Gesperrt wird deshalb in der Sidebar, in der
Tab-Leiste UND auf der Seite selbst (404, nicht 403: ein 403 bestaetigt, dass
es die Seite gibt, AUT-06). Wer nur eines davon baut, hat die Luecke
unsichtbar gemacht statt geschlossen.

**Die Sperre trifft auch den Super-Admin.** Sonst haengt die Antwort auf „wer
sieht das Reinigungsmodul der Bau-GmbH" an der Rolle statt an der Buchung,
und genau das war der Fehler.

**Im Gruppen-Scope gilt sie nicht.** Die Ansicht umfasst mehrere
Gesellschaften mit verschiedenen Buchungen; es gaebe keine, die entscheiden
koennte. Was dort steht, ist ohnehin lesend (Invariante 10) und je Zeile
mandantengebunden.

**„Kein Gewerk" und „nicht eingetragen" sind zwei Aussagen** — und eine leere
Liste konnte nur eine davon machen. Die erste Fassung las leer als „nicht
hinterlegt" und filterte nicht; die Begruendung dafuer bleibt richtig (ein
vergessener Eintrag beim Anlegen einer Gesellschaft darf kein Totalausfall
werden). Nur passte sie nicht auf CSE Operations, deren leere Liste die
Aussage IST: ihr Verwalter sah genau die drei Gewerke, die sie nicht hat —
derselbe Befund wie beim Hochbau, eine Gesellschaft weiter. `0103` trennt die
Faelle ueber `mandant.module_gepflegt`: `false` filtert nicht, `true` laesst
die Liste gelten, und leer heisst dann kein Gewerk. Kein Sentinelwert in der
Liste — ein Wert, der kein Modul ist und in einer Modulliste steht, faellt
beim ersten Vergleich um, den jemand ohne diesen Absatz schreibt.

Offen bleiben zwei Fragen, die niemand hier beantworten darf: wer das
Kennzeichen pflegt (**O-355**) und ob eine Gesellschaft mehr als ein Gewerk
bucht (**O-356**).

### D-376 · Grosse Flaechen bekommen eine Motivtafel, kleine bleiben leer

D-62 bleibt richtig und bleibt stehen: ein Platzhalter, der wie ein Foto
aussieht, ist ein Platzhalter, der in Produktion landet. Der Mandant hat
jedoch ausdruecklich um Flaechen gebeten, die das Gewerk zeigen, damit die
Seite jemandem vorgefuehrt werden kann, bevor eigene Aufnahmen existieren —
zweimal gefragt, beim zweiten Mal mit Beispiel („Bauarbeiter").

**Die Aufloesung ist keine Abschwaechung, sondern eine Unterscheidung.** Ein
Bild, das vorgibt eine Aufnahme zu sein, ist verboten wie zuvor. Eine
**Zeichnung, die sichtbar eine Zeichnung ist**, behauptet nichts: flache
Flaechen, keine Fototiefe, Figuren nur als Silhouette und nie mit Gesicht,
und daneben dieselbe Platzhalterzeile wie bisher. Sie ersetzt kein Foto, sie
haelt den Platz sichtbarer frei.

Wo welche steht, entscheidet die **Groesse**: Kopfbild, Markenkarte und
Gesellschaftsseite tragen die Motivtafel, weil dort Leere wie ein Defekt
aussieht; Objekt- und Projektkacheln bleiben leer, weil eine Zeichnung auf
180 px ein Fleck ist.

Die Reihenfolge bleibt unveraendert: liegt eine Datei unter `public/bilder/`,
gewinnt sie — `bildFuerMotiv()` fragt zuerst dort. Am Tag, an dem die echten
Aufnahmen kommen, aendert sich kein Codepfad. **O-13** bleibt offen, und zwar
als das, was es ist: eine Lieferung, die aussteht, und nicht eine Frage, die
diese Tafeln beantworten.

### D-63 · DESIGN §2 wird beim Rendern durchgesetzt, nicht gehofft

Die Schreibschrift und das rote Akzentwort erscheinen **einmal je Seite**.
Zweimal ist kein Akzent mehr, sondern ein Stil — und das faellt niemandem auf,
der die Seite baut, sondern erst dem, der sie sieht. `pruefeSeite()` wirft bei
zwei Hero-Abschnitten und bei zwei Akzentwoertern, und der Browser-Test zaehlt
die Knoten.

Das Akzentwort ist ein eigenes Feld in `abschnitt` und kein Markup im
Fliesstext: als `<span>` im Text landet es beim naechsten Copy-Paste zweimal
in derselben Seite, und niemand sieht warum.

### D-64 · O-08 bleibt offen, und der Pfadmodus ist die umkehrbare Wahl

Ob jeder Bereich eine eigene Domain bekommt oder alle als Pfad unter einer
Gruppendomain liegen, ist nicht kosmetisch: eigene Domains bedeuten eigene
SEO-Autoritaet und eigene Zertifikate. `lib/domains.ts` ist deshalb **leer** —
ein erfundener Eintrag saehe entschieden aus — und bis zur Antwort gilt der
Pfad. Er funktioniert ohne DNS-Arbeit und laesst sich spaeter auf Domains
umlegen; umgekehrt gilt das nicht.

### D-65 · Der Import vergleicht VOR dem Schreiben

Ein `update` mit identischen Werten stempelt `geaendert_am`, schreibt eine
Audit-Zeile und behauptet damit eine Aenderung, die nicht stattgefunden hat.
Der Import liest deshalb erst und schreibt nur bei echter Abweichung — und der
Test prueft nicht nur "null angelegt", sondern dass **kein** `geaendert_am`
gesetzt wurde.

Die Zusage dahinter ist groesser als sie klingt: ein Import, der beim zweiten
Lauf Duplikate erzeugt, wird genau einmal ausgefuehrt und danach nie wieder
angefasst — und dann veraltet der Inhalt, weil niemand sich traut.

### D-66 · Der NAP-Block wird an EINER Stelle formatiert

Fuer lokale Suche zaehlt, dass Name, Anschrift und Telefonnummer ueberall
**zeichengleich** stehen. Zwei Schreibweisen derselben Adresse — einmal "Str.",
einmal "Straße" — sind fuer eine Suchmaschine zwei Unternehmen, und die
Autoritaet verteilt sich auf beide. `napAus()` formatiert, die Seiten setzen
nichts selbst zusammen, und eine halbe Adresse ist ein **Fehler**, keine halbe
Ausgabe: sie erzeugt sonst einen zweiten, schwaecheren Eintrag.

Jede Gesellschaft bekommt ihr eigenes `LocalBusiness`-JSON-LD mit ihrer NAP und
ihrer URL. Vier eigene Eintraege — sonst konkurrieren die Gesellschaften in der
lokalen Suche miteinander.

Alt-URLs gehen per **301**, nicht 302: bei einem 302 behaelt die Suchmaschine
den alten Eintrag, und die Autoritaet der alten Adresse geht nicht ueber. Ein
Test prueft, dass jedes Ziel eine bekannte Route ist — eine Weiterleitung ins
Leere kostet genau die Autoritaet, die sie retten sollte.

### D-67 · Eine Referenz ohne Kundenfreigabe ist an ZWEI Stellen abwesend

`freigegeben_vom_kunden` hat kein `DEFAULT true`, die Policy traegt die
Bedingung selbst, und der Dienst filtert noch einmal. Das ist keine Doppelung
aus Unsicherheit: ein Kundenname auf einer Website ohne dessen Zustimmung ist
ein Problem, das man nicht durch Loeschen ungeschehen macht, und eine
vergessene `where`-Bedingung im Code ist der wahrscheinlichste Weg dorthin.

Eine Freigabe ohne Datum ist nicht speicherbar. Wer sie erteilt hat und wann,
ist bei einem Kundennamen auf einer Website keine Nebensache.

`ReferenzQuelle` ist eine Schnittstelle: die echte, `auftrag`-gestuetzte
Implementierung kommt mit PR 27, und beide geben ausschliesslich freigegebene
Eintraege zurueck.

### D-68 · Die oeffentliche Website liest als Dienstprinzipal, nicht als Niemand

`mandant` traegt RLS: `t_mandant_lesen` gibt frei, was `app.sichtbare_mandanten()`
nennt. Eine Verbindung ohne Sitzung liest `seite` und `abschnitt` anstandslos —
deren `t_*_oeffentlich`-Policies fragen nur nach `status = 'veroeffentlicht'` —
und `mandant` **gar nicht**. Der erste Entwurf tat genau das und lieferte eine
Seite ohne Firma, Anschrift und Telefon aus: nicht kaputt, sondern leer. Leer
sieht aus wie "noch nicht gepflegt" und faellt beim Entwickeln niemandem auf.

Der Renderer laeuft deshalb als der Dienstprinzipal aus `03-AUTH-BERECHTIGUNGEN.md`
§14.3 — `benutzer_mandant`-Zeilen in den vier Bereichen, `ist_dienstkonto = true`,
keine globale Rolle, genau zwei Rechte (`oeffentlich.lesen`,
`gruppe.oeffentlich.lesen`), `app.readonly = 'on'`, Gruppenansicht ohne aktiven
Mandanten. Damit gibt es drei unabhaengige Gruende, warum er nicht schreiben
kann: der Rueckgabetyp hat kein `schreibe`, K-03 verlangt `not app.ist_readonly()`
in jeder `WITH CHECK`, und er haelt kein Schreibrecht.

Die Formularannahme (REQ-01, PR 17) ist ein **zweiter** Prinzipal mit anderen
Rechten. Zwei und nicht einer: wer die Website rendert, ist die zum Internet
offene Haelfte, und eine Uebernahme dieser Haelfte soll keinen Schreibpfad
ergeben.

### D-69 · Strukturierte Daten entstehen nur aus gepflegten Daten

`Service` und `FAQPage` werden **nicht** ausgegeben, wenn es keine Leistungen
und keine Fragen gibt. Ein `FAQPage` ohne Fragen ist fuer eine Suchmaschine
kein Angebot, sondern ein Fehler im Markup; ein `Service` mit ausgedachten
Namen ist eine Aussage des Unternehmens, die niemand getroffen hat. Beide
kommen aus `abschnitt.daten` (`leistungen`, `faq`) — vorhandenes `jsonb`, keine
Migration.

`Organization` entsteht nur, wenn `website.rechtstraeger` gepflegt ist. Ein
`Organization`-Block traegt eine Anschrift und behauptet damit, an dieser
Adresse gebe es ein Unternehmen dieses Namens. Ob "CSE Gruppe" ein
Rechtstraeger ist, ist offen (O-206); den ersten Mandanten dafuer einzusetzen
hiesse, die Gruppe sei die CSE Dienstleistungen GmbH und deren Tochter zugleich.
Bis zur Antwort: vier vollstaendige `LocalBusiness`-Eintraege und kein Dach.

`pruefeJsonLd` laeuft beim Rendern und nicht nur im Test. Ein fehlerhafter Block
wird von der Suchmaschine stillschweigend verworfen — die Seite sieht
ausgezeichnet aus und ist es nicht. Lieber laut beim Bauen als still in der
Suche.

### D-70 · Der kanonische Host wird nicht geraten (O-08)

`CSE_KANONISCHE_BASIS` nennt ihn; ohne sie gilt der Host der Anfrage. Eine im
Code eingetragene Domain waere geraten und wanderte als kanonische URL in jede
Sitemap und jeden JSON-LD-`@id`; ein spaeterer Wechsel entwertet genau die
Autoritaet, die diese Angaben aufbauen sollen. Ein falscher kanonischer Host ist
schlimmer als keiner — er sagt der Suchmaschine, die echte Seite stehe anderswo.

### D-71 · Einstellungsschluessel liegen nicht im Rechte-Namensraum

`gruppe.anzeigename` als `plattform_einstellung`-Schluessel wurde von der
K-19-Pruefung als unregistriertes Recht gemeldet — zu Recht: `gruppe` ist der
Modulname der Gruppenansicht im Rechtekatalog, und ein Schluessel, der wie ein
Rechteschluessel aussieht, ist von der Pruefung nicht davon zu unterscheiden.
Die Einstellungen heissen deshalb `website.gruppenname` und
`website.rechtstraeger`, wie `website.renderer_benutzer` daneben.

### D-72 · axe und Lighthouse sind Pflicht-Jobs, kein Bericht

`.github/workflows/a11y.yml` prueft axe auf **jeder** oeffentlichen Route — die
Liste kommt aus `OEFFENTLICHE_ROUTEN`, eine neue Route ist damit automatisch
abgedeckt — und faellt bei einem einzigen AA-Verstoss. BFSG gilt fuer das
Angebot, nicht fuer die Startseite; eine Stichprobe misst, wie sorgfaeltig die
geprueften Seiten gebaut wurden, und sagt ueber die uebrigen nichts.

Das Lighthouse-Budget (`lighthouserc.json`, begruendet in `docs/LIGHTHOUSE.md`)
faellt, sobald eine Seite schlechter wird: Barrierefreiheit 1,00, Leistung 0,90
mobil. `best-practices` warnt nur — seine Regeln aendern sich mit jeder
Lighthouse-Version, und ein rotes CI durch ein Versionsupdate wird abgeschaltet
statt behoben.

### D-73 · Der Rechtekatalog verlor 19 Schluessel an eine Regex

`03-AUTH-BERECHTIGUNGEN.md` §12 schreibt Zeilen wie `` `crm.lesen` / `crm.schreiben` ``,
wenn dieselbe Rollenzeile fuer beide gilt. Der Extraktor verlangte GENAU EINEN
Schluessel je Zeile und uebersprang jede andere stillschweigend — neun Zeilen,
19 Schluessel, darunter `crm.lesen`, `crm.schreiben`, `formular.lesen` und
`formular.schreiben`.

`app.hat_recht` antwortet auf einen fehlenden Schluessel mit `false`. Jede
Policy, die einen davon genannt haette, waere fuer jede Rolle falsch gewesen —
also genau der K-19-Ausfall, den dieser Extraktor verhindern soll, erzeugt vom
Extraktor selbst. Sichtbar geworden waere er als dauerhaft leerer Bildschirm im
CRM, ohne Fehlermeldung.

Der Extraktor liest jetzt alle Schluessel einer Zelle, mit der Kurzform
`` `personal.erstellen` / `.aendern` `` (der Modulname wird ergaenzt). 207 → 226
Schluessel; vier benutzt PR 17 sofort, 15 stehen auf der eingefrorenen
Warteliste.

### D-74 · Zwei Prinzipale fuer die oeffentliche Seite, und der zweite liest nicht

Der Renderer (D-68) laeuft mit `app.readonly = 'on'` und koennte eine
Einsendung nicht speichern. Die Formularannahme ist deshalb ein ZWEITER
Prinzipal: `oeffentlich.lesen` + `formular.schreiben` + `dokument.schreiben` +
`crm.schreiben` + `crm.kommunikation_versenden`, in `mandant`-Scope mit genau
einem Bereich.

**Er haelt weder `formular.lesen` noch `crm.lesen`.** Das ist keine
Feinheit — es hat den Code geformt:

- Die Annahme schreibt **ohne `RETURNING`** und erzeugt ihre UUIDs selbst.
  `INSERT … RETURNING` verlangt, dass die Zeile die SELECT-Policy besteht; ein
  `RETURNING` haette den Prinzipal gezwungen, Leserechte zu bekommen, und damit
  waere die Trennung hinfaellig gewesen.
- Eingang und Lead verweisen aufeinander, also ist die Fremdschluesselbedingung
  `DEFERRABLE INITIALLY DEFERRED`. Die Alternative — erst einfuegen, dann per
  UPDATE verknuepfen — braeuchte `formular.lesen` fuer die `USING`-Bedingung.
- Frist und Besitzer kommen aus `app.formular_zustaendigkeit()`, das Ratenlimit
  aus `app.formular_eingang_zaehlen()`: zwei `SECURITY DEFINER`-Funktionen, die
  je zwei Werte beziehungsweise eine Zahl herausgeben und keine Zeile.

Das Ratenlimit zaehlte im ersten Entwurf mit einem gewoehnlichen
`select count(*)` und ergab deshalb IMMER 0 — eingebaut und wirkungslos, und
nichts daran war zu sehen. Der Isolationstest hat es gefunden.

### D-75 · Was PR 17 bewusst NICHT entscheidet

- **Die SLA-Frist** ist 24 Stunden, als Zeile in `formular_zustaendigkeit` und
  nicht als Spalten-DEFAULT — und die Oberflaeche weist sie als *vorlaeufig*
  aus. Ob in Kalender- oder Werktagsstunden und wann sie an einem Freitagabend
  anlaeuft, ist O-14. `sla_stunden` ist nullable: ein manueller Lead hat nichts
  zu erben, und `NOT NULL` haette den Aufnahmedienst gezwungen, eine Frist zu
  erfinden.
- **Die Auswahllisten** fuer `gebaeudetyp`, `frequenz` und `gewerk` sind als
  "(vorläufig)" beschriftete Platzhalter (O-62).
- **CSE Operations hat kein Formular** (O-61). REQ-01 verlangt eines je Bereich,
  REQ-02/03/04 definieren drei Feldmengen. `/anfrage/operations` ist 404 und
  kein leeres Formular — ein Formular ohne Felder saehe aus wie ein Ladefehler
  und wuerde abgeschickt, ohne dass jemand anbieten koennte.
- **Die Leadnummer benutzt keinen Nummernkreis.** K-12s lueckenlose Kette
  gehoert Rechnungen, wo eine Luecke ein GoBD-Befund ist. Den Zaehler von aussen
  ausloesbar zu machen waere der teuerste Weg zu einer Leadnummer.
- **Das Datenschutz-Haekchen ist eine BESTAETIGUNG**, keine Einwilligung: eine
  Anfrage zu bearbeiten stuetzt sich auf Art. 6(1)(b)/(f) DSGVO, und eine
  Einwilligung, die man nicht verweigern kann, ist keine (O-63). Die einzige
  echte Einwilligung ist die freiwillige fuer Werbung, und nur sie hebt
  `rechtsgrundlage` von `anfrage` auf `einwilligung` (CRM-08).

### D-76 · Die Eingangsbestaetigung geht durch dasselbe Tor wie alles andere

Sie fuehlt sich harmlos an — eine Antwort auf eine Anfrage, kein Werbebrief.
Genau deshalb waere sie die naheliegende Stelle fuer eine Ausnahme, und eine
Ausnahme im Tor ist kein Tor mehr (Invariante 7). Sie wird als Nutzlast gebaut,
durch `gate()` geschickt und als `versand` protokolliert — **auch wenn nichts
hinausgeht**: `gesendet_am` bleibt dann NULL und `ergebnis` sagt warum. Das Tor
ist fail-closed, ohne `agent_richtlinie`-Zeile fuer `email_senden` bleibt die
Bestaetigung also liegen. Das ist die richtige Vorgabe: lieber keine
Bestaetigung als eine automatische Mail, die niemand vorgesehen hat.

0012 gab `versand` nur `cse_job` einen INSERT. Die Bestaetigung entsteht aber
auf dem Anfragepfad, nicht in einem Job — 0017 ergaenzt deshalb eine
INSERT-Policy fuer `cse_app` unter `crm.kommunikation_versenden`. Sie ist keine
Erlaubnis zu senden; `agent/policy.ts` entscheidet weiterhin, und die Zeile
bezeugt nur, dass entschieden wurde.

### D-77 · Eine Kennzahl entsteht im Register oder gar nicht

`registriereKachel()` nimmt eine Kachel nur an, wenn sie vollstaendig ist:
Schluessel, Label, Modul, **Recht**, Zaehlabfrage, Zeilenabfrage und ein
Linkziel, das mit `/` beginnt. Fehlt eines davon, wirft die Registrierung — und
weil die Kacheln beim Rendern registriert werden, faellt die Seite und nicht
erst der Leser auf.

Das klingt nach Zeremonie fuer sieben Zahlen. Es ist die Alternative zu einer
Kachel, die in einer JSX-Datei entsteht: die haette eine Zahl und kein Recht,
und sie wuerde jedem angezeigt, der die Seite oeffnet.

### D-78 · Eine Kachel ohne Modul ist ABWESEND, nicht null

Es waere leicht, heute schon "Offene Rechnungen" zu registrieren; die Abfrage
ist zwei Zeilen und die Antwort ist `0`. Aber `0` heisst in einer Uebersicht
"es gibt keine", nicht "das Modul kommt in Phase 6". Wer die beiden
verwechselt, plant auf einer Zahl, die es nicht gibt.

Das Register waechst deshalb **mit** den Modulen und nicht vor ihnen. Jeder
spaetere PR registriert seine eigenen Kacheln.

### D-79 · Zahl und Zeilen stammen aus einem Praedikat und einem Schnappschuss

DSH-04 verlangt, dass eine Kennzahl zu den Zeilen fuehrt, die sie zaehlt. Zwei
Mechanismen sichern das, und beide sind noetig:

1. **Ein Praedikat.** `zaehlung` und `zeilen` derselben Kachel tragen dieselbe
   `where`-Bedingung, und die generische Kennzahlseite rendert genau `zeilen`.
   Zwei getrennt gepflegte Abfragen liefen frueher oder spaeter auseinander —
   und zwar unbemerkt, weil beide plausibel aussaehen.
2. **Ein Schnappschuss.** Beide laufen in einer Transaktion mit
   `isolation level repeatable read` (`SCHNAPPSCHUSS` in `server/db/pool.ts`).
   Unter dem Vorgabewert `read committed` sieht die zweite Abfrage einen
   neueren Stand als die erste: eine Anfrage, die zwischen `count` und
   `select` eintrifft, macht aus 14 und 14 ein 14 und 15. Selten,
   unreproduzierbar — und genau die Art Abweichung, nach der niemand der Zahl
   mehr glaubt.

### D-80 · Der Bereichsfilter ist ein Argument und steht in der URL

Jede Kachelabfrage nimmt `$1 = mandant_ids::uuid[]`; der Filter setzt dieses
eine Argument fuer alle. Waere er je Kachel gebaut, zeigte nach einem Wechsel
die eine den neuen Bereich und die andere noch den alten — beide plausibel.

Dass er in der URL steht und nicht im Zustand der Seite, macht eine gefilterte
Uebersicht zitierbar: ein Link in einer Mail zeigt dem Empfaenger dasselbe.
Der aktive Mandant der **Sitzung** bleibt davon unberuehrt (Invariante 3) — die
URL waehlt hier nur aus, was die Sitzung ohnehin sehen darf, und die
Isolationssuite prueft das gegen einen erfundenen Bereichsparameter.

### D-81 · Die Dashboards liegen vorerst unter `/dev`

Es gibt noch keine Anmeldung (PR 20). Ein Dashboard braucht aber einen
Benutzer, sonst prueft es seine Rechte gegen niemanden. `withDevAdmin()`
bindet deshalb den Seed-Super-Admin — und wirft, wenn `CSE_DEV_FLAECHEN`
nicht gesetzt ist, sodass ein Deployment eine 404 ausliefert und keinen
Zugang.

Der Pfad, auf den eine Kachel zeigt, entsteht an **einer** Stelle
(`kennzahlPfad()`). Wenn die angemeldete Portal-Shell da ist, aendert sich
diese Funktion — nicht sieben Kacheln, von denen man sechs findet.

### D-82 · Die oeffentliche Website erscheint deutsch UND englisch

Eine Mandantenentscheidung, keine technische. `CLAUDE.md` schrieb bisher
"UI-Texte: Deutsch", mit Uebersetzung nur fuer die Arbeiterbildschirme
(de/en/ar/tr, SPEC §10). Fuer die **oeffentliche** Website gilt ab jetzt:
Deutsch und Englisch. Das interne Portal bleibt deutsch — die Fachbegriffe
tragen dort Rechtsbedeutung (VOB, GoBD, UStG, GewO), und sie zu uebersetzen
verliert Praezision.

**Deutsch behaelt `/`, Englisch bekommt `/en`.** Die deutschen Adressen sind
im Umlauf und in der Sitemap; ein nachtraegliches `/de` davor waere eine
Umleitung fuer jede einzelne und eine unnoetige Ansage an die Suchmaschinen,
die Startseite sei umgezogen.

**Die Datenbank war vorbereitet.** `seite` traegt `sprache` und einen
eindeutigen Index auf `(pfad, sprache)`; eine englische Seite ist eine eigene
Zeile mit eigenen `abschnitt`-Zeilen. Keine Migration, keine
Uebersetzungstabelle daneben. Der Filter `sprache = 'de'` stand an drei
Stellen im Leseweg und ist dort jetzt ein Argument.

**Der Pfad ist derselbe, nur der Praefix wechselt.** `/en/leistungen`, nicht
`/en/services`. Ein zweiter Slug waere eine zweite Adresse fuer dieselbe Seite
— und damit ein zweiter Eintrag in jeder Sitemap, jeder Pruefliste und jedem
Verweis, der irgendwann auseinanderlaeuft.

### D-83 · Die Formularfelder werden UEBERLAGERT, nicht verdoppelt

`formular_definition` bleibt die eine Quelle: sie bestimmt, welche Felder es
gibt, welche Pflicht sind, was validiert wird und was in `formular_eingang`
landet. `src/lib/i18n/formular-en.ts` uebersetzt ausschliesslich, was ein
Mensch liest.

Zwei Definitionen je Formular waeren zwei Feldlisten, und die zweite liefe der
ersten hinterher: ein Feld, das jemand deutsch ergaenzt, fehlte englisch — und
dann validierte die Annahme gegen eine Liste, die der Besucher nie gesehen
hat. Eine Auflage kann das nicht. `tests/kern/i18n.test.ts` verlangt fuer
JEDES Feld JEDER Vorlage einen vollstaendigen englischen Eintrag samt jeder
Auswahloption; ein neues deutsches Feld bricht damit den Build, statt still
deutsch auszuliefern.

**Die Optionswerte werden nie uebersetzt.** `buero` bleibt `buero`; nur seine
Bezeichnung wird englisch. Uebersetzte Werte hiessen, dass in
`formular_eingang` je nach Sprache etwas anderes steht — und keine Auswertung
mehr ueber beide ginge.

### D-84 · Impressum und Datenschutz gelten auf Deutsch

§5 TMG und DSGVO Art. 13 verlangen die Pflichtangaben eines deutschen
Anbieters auf Deutsch. Die englische Fassung ist eine Lesehilfe, und sie sagt
das auch: der Fussbereich der englischen Seiten traegt den Satz, dass die
deutsche Fassung die rechtsverbindliche ist. Ihn wegzulassen hiesse, die
Uebersetzung als geltende Fassung auszugeben — bei einer Pflichtangabe kein
Schoenheitsfehler.

Die Barrierefreiheitserklaerung gibt es aus demselben Grund in beiden
Sprachen, aus EINER Komponente mit zwei Textsaetzen: zwei Komponenten
nebeneinander bekaemen den naechsten Absatz nur einmal, und dann sagte die
englische Erklaerung etwas anderes als die deutsche.

### D-85 · `<html lang>` kommt aus der Middleware

Ein Wurzel-Layout kennt in Next.js den Pfad nicht — es bekommt `children` und
sonst nichts. Ohne Umweg traegt eine englische Seite `lang="de-DE"`, und ein
Screenreader liest englischen Text mit deutscher Aussprache vor: WCAG 3.1.1,
und BFSG gilt fuer dieses Angebot.

`src/middleware.ts` setzt deshalb zwei ANFRAGE-Koepfe — die Sprache und den
Pfad ohne Praefix. Das Wurzel-Layout liest den ersten fuer `<html lang>`, die
oeffentliche Huelle den zweiten, damit die Sprachwahl auf DIESELBE Seite
zeigt und nicht auf die Startseite. Wer beim Sprachwechsel seinen Platz
verliert, wechselt kein zweites Mal.

Preis: das Wurzel-Layout liest `headers()` und ist damit dynamisch. Die
oeffentlichen Seiten waren es ohnehin (PUB-07); die zwei statischen
Dev-Flaechen verlieren ihr Vorrendern. Ein falsches `lang` ist der teurere
Fehler.

### D-86 · Ein Recht im mandantenuebergreifenden Scope gilt, wenn es in EINEM Bereich gilt

`app.hat_recht(schluessel, p_mandant)` gibt `false` zurueck, sobald `p_mandant`
NULL ist und die globale Rolle nicht traegt — der Rumpf sagt es in einer Zeile:
`if p_mandant is null then return false; end if;`. In `GRP`, `KDN` und `PER→M1`
ist der aktive Mandant per Konstruktion NULL (K-20). Das Routen-Tor fragte
genau so, und damit waren 45 Routen fuer jeden 404, der kein `super_admin` ist:
die Gruppenansicht war leer fuer das Publikum, fuer das TEN-05 sie gebaut hat.

**Entschieden:** in diesen Scopes wird ueber `app.sichtbare_mandanten()`
gefragt. Das Recht gilt, wenn es in mindestens einem sichtbaren Bereich gilt.

Das oeffnet die SEITE, nicht die Zeilen. Welche Zeilen erscheinen, entscheidet
weiter die Policy je Zeile, und die fragt mit dem `mandant_id` DER ZEILE — so
steht es in `0009_dokument.sql` und so meint es `04-SEITENKARTE.md` §1.3 mit
*"gated on `gruppe.<modul>.lesen` per mandant"*. Eine `leitung` der Reinigung
sieht die Gruppenseite und darauf ihre Reinigungszeilen.

Die Gegenprobe waere gewesen, jede Gruppenroute auf ein `nur_global`-Recht zu
legen. Dann haette sie nur, wer eine Plattformrolle traegt — und die
Gruppenansicht waere eine Super-Admin-Funktion statt einer Leitungsfunktion.
§4.5 sagt das Gegenteil: sie verlangt eine `intern`-Mitgliedschaft, keine
globale Rolle.

### D-87 · Das Unternehmensprofil traegt eine Sprache, wie `seite`

Die Markenkarten unter `/en` zeigten die deutsche `kurzbeschreibung`, weil
`unternehmensprofil` keine Sprache hatte und `unique (mandant_id)` auch keine
zuliess.

**Entschieden:** `sprache` in der Zeile, Eindeutigkeit ueber
`(mandant_id, sprache)` — dasselbe Muster wie `seite` seit 0014 (D-82).

Nicht `kurzbeschreibung_en` neben `kurzbeschreibung`: ein Spaltenpaar haette
bei jeder weiteren Sprache eine Migration verlangt, und `status` liesse sich
nicht je Sprache setzen — eine Uebersetzung, die noch geprueft wird, waere
veroeffentlicht, sobald die deutsche es ist.

Fehlt die Uebersetzung, kommt der deutsche Satz. Ein deutscher Satz auf einer
englischen Seite ist die schlechtere von zwei Auskuenften; eine LEERE Karte ist
die schlechteste — sie liest sich wie "ueber diese Gesellschaft gibt es nichts
zu sagen".

### D-88 · Eine Route mit Manifestzeile und ohne Modul sagt das, statt 404 zu liefern

`04-SEITENKARTE.md` fuehrt 432 Routen; gebaut sind die von Phase 3. §11.2
verlangt fuenf Tab-Ziele je Portal, und darunter sind Module aus Phase 4 bis 9.

**Entschieden:** Routen, die im Manifest stehen und deren Seite noch nicht
existiert, beantworten das ausdruecklich — im Portalrahmen, mit der Phase aus
dem Manifest.

Die Wache bleibt unveraendert: keine Manifestzeile heisst weiterhin 404, ein
fehlendes Recht ebenso, ein fremdes Portal die K-04-Decke. Es kommt keine
Erreichbarkeit hinzu; es wird eine falsche Antwort durch die wahre ersetzt.
404 hiesse "diese Seite gibt es nicht" fuer eine Seite, die das Dokument fuehrt
und die Leiste anbietet, und eine leere Tabelle hiesse "hier ist nichts" statt
"das gibt es noch nicht" — derselbe Unterschied, aus dem
`KeinKundenzugangFehler` lieber wirft, als eine leere Liste zu zeigen.

### D-89 · Der Bereichswechsel ist ein POST und hinterlaesst zwei Spuren

Bis PR 19 betrat `/portal/gruppe` die Gruppenansicht dadurch, dass die Seite
`withGroupScope` rief — unabhaengig von `benutzer_sitzung.ansicht`. Damit WAR
die URL der Ansichtszustand.

**Entschieden:** `POST /api/sitzung/mandant` ist der einzige Schreiber des
aktiven Bereichs (03-AUTH §4.4). Ein GET wechselt nie; wo eine Adresse einen
anderen Bereich meint als die Sitzung, steht das Zwischenblatt mit Knopf.

Und der Auditausloeser schreibt eine Zeile je Seite, die es GIBT. Er schrieb
eine, gekeyt auf den NEUEN Mandanten; beim Eintritt in die Gruppenansicht ist
der NULL, und in der Spur der verlassenen Gesellschaft stand nichts.
Ausdruecklich KEINE NULL-Zeile daneben: `app.protokolliere` faellt bei NULL auf
`app.aktiver_mandant()` zurueck, im Anwendungspfad also auf den alten Bereich —
es stuenden zwei gleiche Eintraege in derselben Gesellschaft.

### D-90 · Zurueckgezogen wird nur, was als Weiterleitungsquelle eingetragen ist

Der Inhaltsimport legt an und aendert; er nahm nie etwas weg. Eine Datenbank,
in der `/reinigung` einmal veroeffentlicht wurde, behielt die Zeile auch,
nachdem die Adresse `/unternehmen/reinigung` geworden war.

**Entschieden:** der Import setzt `geloescht_am` auf genau die Pfade, die in
`WEITERLEITUNGEN` als Quelle stehen — nicht auf alles, was er nicht kennt.

Die zweite Fassung loeschte auch eine Seite, die jemand in der Anwendung
angelegt hat, und zwar beim naechsten Deployment, ohne dass jemand es
ausgeloest haette. Die Weiterleitungstabelle nennt dagegen genau die Adressen,
von denen jemand ENTSCHIEDEN hat, dass sie ersetzt sind.

Eine Adresse, die Seite UND Quelle waere, bricht den Import — vor dem ersten
Schreibvorgang. Sonst zoege er diese Seite bei jedem Lauf still zurueck.

### D-91 · Der natuerliche Schluessel des Raumbuchs traegt die Etage

`UNIQUE (objekt_id, raumnummer)` sieht richtig aus und ist der teuerste Fehler
dieser Phase: "101" im Untergeschoss und "101" im 1. OG sind zwei Raeume, und
in jedem Buerohaus gibt es beide.

**Entschieden:** der Schluessel ist `(objekt_id, coalesce(etage, ''),
raumnummer)`, teilweise auf nicht archivierte Zeilen mit Nummer. Das
`coalesce` gehoert dazu: ohne es waeren zwei nummerierte Raeume ohne Etage
fuer den Index verschieden, und derselbe Flur kaeme bei jedem Import erneut
herein.

Warum das keine Kleinigkeit ist: ein verschmolzener Raum verliert seine m²
aus `Σ m² ÷ Leistungswert`. Das Angebot wird dadurch zu billig, die Rechnung
dazu bleibt korrekt, und niemand sieht dem Ergebnis etwas an. Raeume OHNE
Nummer — Flur, Treppenhaus, Aufzugsvorraum — bleiben ausdruecklich erlaubt;
`NOT NULL` zwaenge den Importeur, eine Nummer zu erfinden, und eine erfundene
Nummer wird beim naechsten Import anders erfunden.

### D-92 · Der Leistungswert ist eine entzogene Spalte, kein Katalogfeld

`belagsart.leistungswert_qm_pro_stunde` ist die Marge in einer Spalte: aus ihr
und der Flaeche entsteht der Preis, und wer sie kennt, rechnet jedes Angebot
nach.

**Entschieden:** `SELECT` darauf ist `cse_app` entzogen (K-05). Gelesen wird
sie ueber `app.leistungswerte_lesen(stichtag)`, das Bereich und Recht selbst
prueft und den ganzen Katalog auf einmal gibt — ein Leser je Zeile waere N
Aufrufe fuer eine Antwort. `INSERT` und `UPDATE` bleiben erteilt: wer den
Katalog pflegen darf, setzt den Wert, und die Policy entscheidet, ob er das
darf. Ein `WHERE leistungswert > 3` scheitert ebenfalls — eine Bedingung ueber
eine Spalte braucht deren `SELECT`-Recht.

Anders als `app.rechtsgrundlage_lesen` schreibt dieser Leser NICHT ins Audit:
ein Leistungswert ist ein Geschaeftsgeheimnis, kein personenbezogenes Datum,
und ein Eintrag je Raumbuch-Ansicht ertraenkte genau das Protokoll, auf das
sich eine Auskunft nach LEG-08 stuetzt. Dieselbe Ueberlegung gilt fuer
`objekt.bemerkung`, `objekt.zutritt_hinweis` und `raum.bemerkung`: interne
Notizen an einem Ort, den der Kunde selbst im Portal sieht.

### D-93 · Eine Belagsart gilt fuer einen Zeitraum, und am Wechseltag genau einmal

Ein neuer Leistungswert ersetzt den alten nicht, er loest ihn ab — sonst
liesse sich ein bereits abgegebenes Angebot nicht mehr nachrechnen.

**Entschieden:** `belagsart` traegt `gueltig_ab`/`gueltig_bis` (EINSCHLIESSLICH,
§0.7) und einen GiST-Ausschluss ueber
`daterange(gueltig_ab, gueltig_bis + 1, '[)')`. Ohne ihn haette "der
Leistungswert am 1. Maerz" zwei Antworten, sobald jemand den neuen Satz am
selben Tag beginnen laesst, an dem der alte endet — und welche der beiden die
Kalkulation nimmt, entschiede die Sortierung.

Aenderungen an `belagsart` stehen im Audit, Aenderungen an `raum` nicht. Das
ist eine Entscheidung: ein geaenderter Leistungswert bepreist jedes offene
Angebot neu und aendert sich selten; ein Raumbuch kommt zu Tausenden aus einem
Import, und ein Eintrag je Raum ertraenkte das Protokoll.

### D-94 · Ein Objekt ist ein ORT; die kaufmaennische Beziehung haengt am Auftrag

`objekt.kunde_id` ist nullbar, und das ist keine Nachlaessigkeit.

**Entschieden:** dasselbe Gebaeude wird zu Recht von zwei Kunden derselben
Gesellschaft beauftragt (Eigentuemer und Mieter), und ein Veranstaltungsort
(REQ-03) existiert, bevor es einen Kundenstamm gibt. Ein Objekt OHNE
Kundenbezug ist damit im Kundenportal fuer niemanden sichtbar — `kunde_id =
any(app.aktuelle_kunden())` faellt bei NULL von selbst durch, und genau so
soll es sein. Der Ansprechpartner haengt am zusammengesetzten Schluessel
`(mandant_id, kunde_id, id)`: ein Vor-Ort-Kontakt eines ANDEREN Kunden ist
dadurch nicht einfuegbar, nicht nur unerwuenscht.

Offen bleibt O-70 (ein Gebaeude fuer zwei Kunden: ein Objekt oder zwei) — die
Nullbarkeit haelt beide Antworten offen, statt eine vorwegzunehmen.

### D-95 · Die Kalkulation rechnet ganzzahlig, rundet je Zeile und nennt ihre Platzhalter

`Σ (m² ÷ Leistungswert) × Frequenzfaktor` als Gleitkomma ergibt einen Preis,
der um Bruchteile daneben liegt — jedes Mal in dieselbe Richtung.

**Entschieden:** Flaechen und Leistungswerte sind ganzzahlige Tausendstel
(`menge.ts`, das Gegenstueck zu `geld.ts`), Zeit sind ganze Sekunden, Geld
sind ganze Cent. Die Einheiten kuerzen sich —
`Sekunden = 3600 × Milli-m² ÷ Milli-m²/h` —, also gibt es keinen Zwischenwert
mit Nachkommastellen. Gerundet wird JE ZEILE und dann summiert, damit die
angezeigten Zeilen die Summe ergeben; eine Liste, unter der eine andere Summe
steht, kostet Vertrauen an genau der Stelle, an der es zaehlt. Wagnis und
Gewinn rechnen auf die Zwischensumme, nicht auf den Lohn.

Stundensatz und Zuschlaege (O-16), die Umrechnung Turnus → Faktor (O-56) und
die Leistungswerte selbst (O-17) sind offen. Sie stehen hinter je einer
Schnittstelle mit einem sichtbaren Platzhalter, und JEDES Ergebnis traegt
`istPlatzhalter` samt O-Nummern bis in die Oberflaeche. Ein unbekannter Turnus
bekommt keinen Ersatzwert, sondern wirft — "dann eben monatlich" waere ein
Preis, den niemand entschieden hat.

Was nicht kalkulierbar ist, wird GENANNT: Flaeche ohne Belagsart und
Belagsarten ohne am Stichtag gueltigen Wert kommen als eigene Groesse zurueck
und stehen als Warnung ueber dem Betrag. Weggelassen ergaeben sie ein zu
billiges Angebot, dem man nichts ansieht.

### D-96 · Die Geld-Wache kennt zwei Wortklassen, und eine Ausnahme nennt ihre Einheit

`geld-nie-numeric` schlug auf `leistungswert_qm_pro_stunde` an, weil `wert`
in ihrer Wortliste stand. Der Wert ist m²/h, kein Betrag.

**Entschieden:** die Wache trennt eindeutige Geldwoerter (`betrag`, `preis`,
`summe`, `saldo`, `entgelt`, `kosten`, `honorar`, `einbehalt`) von
mehrdeutigen (`wert`, `satz`). Eine mehrdeutige Spalte darf `numeric` sein,
wenn die Zeile ihre EINHEIT nennt (`-- nicht-geld: m²/h`); eine geldbenannte
nie, egal wie sie kommentiert ist. Die Ausnahme ist damit eine Aussage, die
ein Pruefer nachlesen kann — kein Schalter, der die Wache stumm stellt. Drei
Fixtures pruefen genau diese drei Faelle.

### D-97 · Was nicht bepreisbar ist, wird nicht bepreist — und nicht weggelassen

Die Copilot-Durchsicht der Phase 4 fand drei Wege, auf denen ein Angebot zu
billig hinausgegangen waere, ohne dass irgendetwas daran falsch aussah:

1. Die Positionen trugen `lohnkosten` statt des Nettoanteils — Gemeinkosten,
   Wagnis und Gewinn fehlten im Dokument vollstaendig.
2. Zum Angebot wurde keine `kalkulation`-Zeile gespeichert. Damit fragte
   `kern.angebot_versand_pruefen` eine leere Sicht, und ein Preis auf den
   Platzhaltern O-16/O-56 passierte die Sperre, die genau dafuer gebaut war.
3. Flaeche ohne Belagsart und Belagsarten ohne am Stichtag gueltigen
   Leistungswert steckten in keiner Zeile und verschwanden aus dem Preis.

**Entschieden:** (1) `verteileNetto` verteilt den Nettopreis nach groesstem
Rest auf die Zeilen, sodass die Zeilensumme das Netto EXAKT trifft; wie die
Zuschlaege im Dokument erscheinen, ist O-208. (2) `uebernimmKalkulation`
schreibt Kalkulationskopf und -positionen mit, samt Schnappschuss jeder
Eingangsgroesse. (3) Ein Angebot ueber nicht bepreisbare Flaeche wird
ABGEWIESEN, mit einem Fehler, der die Luecke benennt — statt sie zu schaetzen
oder zu verschweigen. Ein Preis, den wir nicht rechnen koennen, ist keine Zahl,
die wir waehlen duerfen.

Dazu: `belagsart.ist_platzhalter` reist jetzt bis in `kalkuliere` (O-17). Ohne
das haette die Kalkulation nach der Antwort auf O-16 und O-56 einen Preis als
bestaetigt gemeldet, der auf einem geschaetzten Richtwert ruht.

---

### D-98 · Ein Datum aus dem Formular wird ein Berliner Zeitpunkt, nie ein UTC-Tag

Drei Stellen rechneten mit UTC, wo Europe/Berlin gemeint war: die
Wiedervorlage eines Leads mit festem `+01:00`, das Startdatum eines Auftrags
aus `toISOString()`, und der Stichtag, mit dem der Belagsart-Katalog gelesen
wird. Alle drei sind die halbe Jahreshaelfte richtig — und in den frueben
Stunden eines Berliner Tages beziehungsweise ueber die Sommerzeit hinweg
falsch, ohne dass die Oberflaeche etwas davon zeigt.

**Entschieden:** `berlinKalendertag` fuer jeden Kalendertag,
`berlinTagesZeitpunkt(datum, stunde)` fuer jedes Datum, das ein Zeitpunkt
wird. Beide liegen in `services/zeit/dauer.ts` neben den K-11-Faellen, und
beide sind mit einem Sommer-, einem Winter- und beiden Umstellungstagen
geprueft (Invariante 2).

### D-99 · Das UWG-Sendetor haengt jetzt wirklich — und zwei Umgehungen sind zu

`kern.uwg_sendetor()` war definiert, kommentiert (`BEFORE INSERT auf jeder
Ausgangsspur`) und an KEIN Ereignis gehaengt. Die Regel stand da, und jede
Zeile ging daran vorbei. Ein Test gegen `app.darf_kontaktiert_werden` blieb
dabei gruen, waehrend der Sendepfad offen stand — die teuerste Sorte
Sicherheit: eine, die man geprueft zu haben glaubt.

**Entschieden:** der Ausloeser haengt an `lead_aktivitaet`, und drei Dinge
kommen dazu.

1. **`zweck = 'intern'` ist kein Freibrief.** `app.darf_kontaktiert_werden`
   beantwortet `intern` mit `true` und ueberspringt Einwilligung, Widerspruch
   und Kundenstatus — richtig fuer eine Notiz an einen Kollegen, ein offenes
   Tor an einer ausgehenden E-Mail. Eine Mail an einen `ansprechpartner` geht
   per Definition nach draussen und wird abgewiesen.
2. **Ein fehlender Kanal ist eine Luecke, kein Freibrief.** `kanal not in (…)`
   ergibt bei NULL weder wahr noch falsch; welchen Zweig die Zeile nahm, war
   Zufall. Eine ausgehende E-Mail oder ein Anruf OHNE Kanal wird jetzt
   abgewiesen, sonst waere das Tor mit einer leeren Spalte zu umgehen.
3. **Der Beleg wird gezogen, nicht behauptet.** `rechtsgrundlage_snapshot`
   fuellt der Ausloeser aus dem lebenden Kontakt — ueber den schmalen Leser
   `app.rechtsgrundlage_von`, denn die Spalte bleibt `cse_app` entzogen
   (K-05). Ohne den Schnappschuss stuende in der Aufzeichnung, DASS gesendet
   wurde, aber nicht, warum es gedurft war — und genau das fragt eine
   Abmahnung.

Folge, sichtbar und gewollt: die Antwort auf eine Webanfrage braucht einen
aufgezeichneten Empfaenger. Die Formularannahme legt heute keinen
`ansprechpartner` an; bis sie es tut, verlangt die Datenbank, dass ihn jemand
anlegt. Das ist die richtige Reihenfolge — eine Antwort, von der niemand sagen
kann, an wen sie ging, belegt im Streitfall nichts.

---

### D-100 · Der Verantwortliche eines Auftrags gehoert zu dieser Gesellschaft

`auftrag.verantwortlich_benutzer_id` zeigt auf `benutzer` — global, also traegt
der Fremdschluessel den Mandanten nicht mit. Das Formular fuellt seine
Auswahlliste mandantengefiltert, aber eine Auswahlliste ist keine Grenze: ein
von Hand abgeschickter POST setzt jede id, und der Auftrag der Reinigung haette
einen Verantwortlichen, der nur bei der Security arbeitet.

**Entschieden:** die Grenze liegt in der DATENBANK, nicht in der Route — ein
Ausloeser auf INSERT und UPDATE gegen `app.ist_mitglied(benutzer, mandant)`,
`security definer`, weil `benutzer_mandant` unter RLS steht und der Aufrufer
dort die Mitgliedschaften seiner Kollegen nicht sieht. Entzogene und
abgelaufene Mitgliedschaften zaehlen nicht. Gleiches gilt fuer das Umhaengen:
ein spaeterer Wechsel auf ein fremdes Konto ist derselbe Fehler.

### D-101 · Wer den Versand sperrt, muss einen Weg heraus bauen

Die Sperre aus D-97 machte etwas sichtbar, das vorher niemandem auffiel: es
gab keinen Weg, die Werte zu bestaetigen. Ein Angebot aus dem Raumbuch stand
auf O-16 und O-17 und liess sich damit NIE versenden — die Seite
`/angebote/[id]/kalkulation` stand in der Seitenkarte und war nie gebaut.

**Entschieden:** sie ist jetzt gebaut, und sie ist ausdruecklich kein
Schalter. Sie zeigt zuerst den Rechenweg — Flaeche, Leistungswert, Stunden,
Stundensatz, je Zeile — und fragt erst dann nach den Zahlen. Wer bestaetigt,
ohne den Rechenweg gesehen zu haben, bestaetigt eine Ueberschrift.

Zwei Aussagen bleiben dabei getrennt: die Zuschlaege gelten fuer DIESES
Angebot; die Reinigungsrichtwerte (O-17) gelten fuer den Katalog und damit
fuer jedes kuenftige Angebot. Beides in einem Haekchen zusammenzufassen
hiesse, eine Katalogentscheidung als Angebotsdetail zu tarnen. Und was
gruppenweit gilt, bleibt offen (O-16) — bis der Mandant es beantwortet,
statt dass eine Vorgabe im Code es fuer ihn tut.

Beide Eingaben gehen durch geprueft Funktionen: `prozentInBasispunkte`
rechnet `15,5 %` ohne Gleitkomma auf 1550, `stundensatzInCent` ueber
`parseGeld`. Was keine Zahl ist, wird abgewiesen statt gerundet.

---

### D-102 · Im App Router setzt `Link` die dynamischen Segmente eines Objektziels NICHT ein

`href={{ pathname: '/portal/[mandant]/…', query: { mandant, id } }}` ist die
Form, die im Pages Router die Segmente einsetzt. Im App Router bleibt der
Pfad woertlich stehen: der Klick landet auf einer Adresse mit eckigen
Klammern, also auf 404. `typedRoutes` merkt es nicht — das Muster IST eine
gueltige Route.

**Entschieden:** Ziele mit dynamischen Segmenten werden als Zeichenkette
geschrieben (`` href={`/portal/${mandant}/angebote/${id}`} ``), so wie es das
uebrige Portal bereits tut. Die Objektform bleibt richtig fuer einen
FERTIGEN Pfad mit Abfrageparametern — dort setzt sie nichts ein und muss es
auch nicht.

### D-103 · Der Raum ohne Nummer bekommt einen Schluessel, und die Uebernahme prueft ihre eigene Entscheidung nach

Die Sperre auf dem Importkopf (D-97-Umfeld) serialisiert zwei Uebernahmen
DESSELBEN Imports. Sie hilft nicht gegen zwei getrennte Vorschauen derselben
Datei: beide sehen ein leeres Raumbuch, beide entscheiden `anlegen`, und die
zweite Uebernahme legt den Raum ein zweites Mal an. Fuer Raeume mit Nummer
faengt `raum_natuerlich_uk` das ab; fuer einen Flur ohne Nummer griff KEIN
Schluessel — `raum_quelle_uk` verlangt einen Quellschluessel, den die Datei
nicht mitbringt. Ab dann zaehlt die Flaeche dieses Flurs doppelt in jede
Kalkulation.

**Entschieden — zwei Linien, und beide sind noetig:**

1. `raum_bezeichnung_uk`: eindeutig ueber (Objekt, Etage, kleingeschriebene
   Bezeichnung), wo keine Raumnummer steht. Damit ist die Zusage aus
   08-PR-PLAN §288 (2) — „committing the same file twice produces zero
   duplicates“ — auch fuer den unnummerierten Raum eine Eigenschaft der
   DATEN und nicht eine des Ablaufs.
2. Die Uebernahme gleicht ihre gespeicherte Entscheidung gegen das LEBENDE
   Raumbuch ab. Existiert der Raum inzwischen doch, wird aktualisiert statt
   ein zweiter angelegt.

Warum beides: ohne (2) haelt (1) zwar die Regel, meldet aber `23505` und
reisst die uebrigen Zeilen der Datei mit — beides in einem Mutationstest
gezeigt. Ohne (1) haelt (2) nur, solange jeder Schreiber durch diesen Dienst
geht.

Der Grundsatz „was der Mensch in der Vorschau gesehen hat, ist das, was
passiert“ bleibt gewahrt: freigegeben wurde „dieser Raum soll mit diesen
Werten dastehen“. Ein Duplikat war nie Teil dieser Freigabe.

---

### D-104 · Das Ursprungstor vergleicht das Schema mit, und steht nur noch einmal da

`istGleicherUrsprung` verglich `URL.host`. `host` ist Rechnername plus Port und
traegt das Schema NICHT: `http://cse.example` und `https://cse.example` haben
denselben `host`. Eine Seite unter `http` auf demselben Namen kam damit durch
das Tor einer `https`-Anfrage — die CSRF-Schranke war offen fuer genau den
Angriff, gegen den sie steht. Sie stand ausserdem sechsmal fast gleich in sechs
Route-Dateien.

**Entschieden:** ein Modul, `server/auth/ursprung.ts`, und verglichen wird der
ganze Ursprung.

**Nicht gegen `nextUrl.origin`,** und das ist der Teil, den der Befund offen
liess. Hinter einem TLS-beendenden Proxy sieht die Anwendung `http`, waehrend
der Browser `https` gesprochen hat; ein strenger Vergleich haette dann jede
ECHTE Anfrage abgewiesen — das Tor waere zu gewesen, aber fuer die Falschen.
Das Schema kommt darum aus `x-forwarded-proto`, wenn ein Proxy es setzt, sonst
aus der Anfrage. `x-forwarded-host` wird bewusst nicht gelesen: er ist vom
Aufrufer setzbar und liesse den erwarteten Ursprung selbst bestimmen.

### D-105 · Der Platzhalter-Stand gehoert zur Kalkulation, nicht zum Katalog

Die Bestaetigung eines Angebots schrieb `belagsart.ist_platzhalter = false` —
in den GETEILTEN Katalog — und die Sperre `kalkulation_platzhalter` las den
Katalog live. Wer O-17 fuer EIN Angebot bestaetigte, raeumte damit im selben
Moment jedes ANDERE Angebot auf derselben Belagsart aus der Sperre. Preise, die
auf dem Platzhalterwert gerechnet worden waren, durften anschliessend hinaus,
ohne dass jemand sie angesehen hatte. Kein Fehler wurde sichtbar: die Sperre
hoerte einfach auf, fuer sie zu gelten.

Dieselbe Raute trug ausserdem DREI Fragen — Tarif (O-16), Frequenzfaktor
(O-56) und Leistungswert (O-17) — und die Bestaetigung kannte nur die erste,
loeschte aber alle drei. O-56 hatte nicht einmal ein Eingabefeld.

**Entschieden (Migration 0027):** drei Fragen, drei Spalten.
`kalkulation.ist_platzhalter` heisst nur noch „Tarif unbestaetigt“,
`kalkulation.frequenz_ist_platzhalter` traegt O-56, und
`kalkulation_position.leistungswert_ist_platzhalter` traegt O-17 je Zeile — als
SCHNAPPSCHUSS. Die Sicht liest ausschliesslich Schnappschuesse; eine
Katalogpflege raeumt dort nichts mehr ab, weil sie den laengst gerechneten
Preis auch nicht aendert. Die Bestaetigung fragt nach dem Frequenzfaktor und
laesst O-56 offen, wenn er fehlt; der Katalog bleibt unberuehrt.

Die Bestandsdaten wurden nur in die vorsichtige Richtung gesetzt: was offen
war, bleibt offen, nichts wurde freigegeben. Wer zu wenig freigibt, verlangt
einen Blick zu viel; wer zu viel freigibt, verschickt einen ungeprueften Preis.

### D-106 · Die Bestaetigung rechnet nach — sonst bestaetigt sie nur sich selbst

Die Bestaetigung schrieb die neuen Tarifzahlen in den Kalkulationskopf und
raeumte die Sperre ab. Die Betraege in `kalkulation_position` und die Preise in
`angebotsposition` blieben stehen — gerechnet auf dem PLATZHALTER-Satz. Die
Seite meldete „bestaetigt“, die Sperre liess das Angebot hinaus, und
hinausgegangen waeren Cent aus dem geschaetzten Satz. Das ist die
gefaehrlichste Sorte falscher Zahl: sie sieht geprueft aus.

**Entschieden:** die Bestaetigung ruft `kalkuliere` erneut — dieselbe Funktion
mit denselben Tests — auf den SCHNAPPSCHUESSEN der Zeilen (Flaeche,
Leistungswert), nicht auf dem heutigen Raumbuch. Wer einen Stundensatz
bestaetigt, bestaetigt keinen zwischenzeitlich geaenderten Raumbestand mit.
Danach werden Kalkulations- und Angebotspositionen aktualisiert.

Dabei faellt der zweite Befund derselben Runde mit weg: Gemeinkosten und
Wagnis/Gewinn bekommen EIGENE Kalkulationszeilen. Vorher summierte
`kalkulation.angebotssumme_netto_cent` nur Lohnzeilen, waehrend
`angebot.netto_cent` den vollen Netto trug — dieselbe Kalkulation nannte zwei
Betraege, und beide sahen richtig aus.

Ein Nebeneffekt ist gewollt und im Test festgehalten: der Preis aendert sich
bei der Bestaetigung geringfuegig (im Abnahmefall 72,14 € → 72,04 €). Der
Platzhalter traegt Wagnis und Gewinn als ZWEI aufeinander rechnende Saetze
(1,03 × 1,05), bestaetigt wird EIN Satz von 8 %. Die zehn Cent sind genau der
Punkt: seit die Bestaetigung nachrechnet, steht im Angebot der Preis aus den
bestaetigten Zahlen.

Geloescht wird dabei nichts: `kalkulation_position` traegt die Loeschsperre
(Invariante 8), Zuschlagszeilen werden geaendert oder angelegt. Eine
Kalkulationszeile ist ein Beleg dafuer, wie ein Preis entstand, und ein Beleg
verschwindet nicht, weil sich der Preis geaendert hat.

### D-107 · Ein Stundensatz ist kein Geldbetrag mit Vorzeichen

`parseGeld` nimmt negative Betraege an, und das ist dort richtig: eine
Gutschrift und ein Storno sind negatives Geld. `stundensatzInCent` reichte das
durch, `lohnkostenAusSekunden` multipliziert ohne Vorzeichenpruefung — ein
negativer Satz haette negative Lohnkosten ergeben und darauf ein Angebot, das
dem Kunden Geld verspricht.

**Entschieden:** die Schranke steht am Rand, nicht in `parseGeld`. Ein
Stundenverrechnungssatz muss groesser als null sein; 0,00 € ist keine
Bestaetigung, sondern eine leere Eingabe mit einem Komma.



### D-108 · Jede Handlung des Angebots prueft ihr eigenes Recht

`POST /api/angebot` traegt drei Handlungen — kalkulieren, versenden, in einen
Auftrag wandeln — und prueft vor der Verzweigung EIN Recht: `angebot.versenden`.
Der Katalog fuehrt `angebot.annahme_erfassen` als eigenes Recht, und
`04-SEITENKARTE.md` haengt die Annahme daran. Eine Rolle, die versenden durfte,
konnte damit ein Angebot als angenommen buchen und einen Auftrag anlegen — eine
kaufmaennische Zusage, fuer die sie nie berechtigt wurde.

**Entschieden:** `rechtFuer(aktion)` — `angebot.schreiben` fuers Kalkulieren,
`angebot.versenden` fuers Versenden, `angebot.annahme_erfassen` fuer die
Annahme. Ein unbekannter Wert bekommt das ENGSTE Recht, nicht das weiteste: er
faellt ohnehin gleich auf `ungueltig`, aber die Reihenfolge der Pruefungen soll
nicht darueber entscheiden, ob das auffaellt.

### D-109 · Das Rueckkehrziel muss im eigenen Ursprung liegen

`new URL(zurueck, basis)` ignoriert die Basis, sobald `zurueck` ABSOLUT ist:
`new URL('https://boese.example', 'https://cse.example')` ergibt
`https://boese.example`. Das Feld kommt aus dem Formular, also vom Aufrufer.
Ein praeparierter POST schickte den angemeldeten Benutzer nach dem
Raumbuch-Import auf eine fremde Seite — und der Weg dorthin begann sichtbar im
eigenen Portal, was genau die Gutglaeubigkeit ist, auf die es ankommt.

**Entschieden:** `internesZiel()` nimmt nur Pfad, Abfrage und Anker, und nur,
wenn das aufgeloeste Ziel im eigenen Ursprung liegt; alles andere faellt still
auf das Standardziel zurueck. Still, weil eine Fehlermeldung hier dem
Angreifer mehr saegte als dem Benutzer.

### D-110 · Eine Zusicherung ist keine Pruefung — `art` bekommt einen Waechter

Der Befund lautete, `art: art as 'einzelauftrag'` speichere jeden Auftrag mit
der falschen Art. Das stimmt nicht: `as` ist eine Zusicherung an den
Uebersetzer und aendert den Laufzeitwert nicht — gespeichert wurde die
richtige Art. Nachgeprueft und nicht uebernommen.

Falsch war trotzdem die Zusage: sie schaltete genau die Pruefung ab, die
`AuftragAnlegen` traegt, und haette jede spaetere Aenderung an der Aufzaehlung
stillschweigend durchgelassen.

**Entschieden:** `ARTEN` ist eine `as const`-Liste mit einem Typwaechter
`istAuftragsart`. Dieselbe Aussage, nur ueberpruefbar — und `Set<string>` plus
`as` verschwindet.



### D-111 · Ein Datum muss der Kalender kennen, nicht nur die Form

`berlinTagesZeitpunkt` prueft `\d{4}-\d{2}-\d{2}` und rief dann `Date.UTC`.
`Date.UTC(2026, 1, 30)` wirft nicht — es rutscht auf den 2. Maerz weiter. Ein
Tippfehler legte damit eine Wiedervorlage auf einen Tag, den niemand gewaehlt
hat, und die Oberflaeche zeigte danach brav das verschobene Datum.

**Entschieden:** `istKalendertag()` prueft ueber Tag 0 des Folgemonats, damit
die Schaltjahrregel nicht ein zweites Mal abgeschrieben dasteht. `2026-02-29`
faellt, `2028-02-29` geht.

### D-112 · Eine verschobene CSV ist ein Fehler, kein Rest

Drei Wege, auf denen eine verschobene Datei als sauber durchging — alle drei
treffen dieselben zwei Spalten, Flaeche und Belag, und keiner meldete etwas:

1. Ein **nicht geschlossenes Anfuehrungszeichen** zog alles ab dem offenen
   Zeichen in EIN Feld; die restlichen Zeilen verschwanden in einer Zelle.
2. Eine Zeile mit **anderer Feldzahl** wurde still aufgefuellt oder
   abgeschnitten. Ein aufgefuellter Raum bekam die Flaeche des Nachbarn.
3. **`12,`** wurde als 12,000 gelesen. Eine abgeschnittene Flaeche als
   vollstaendig auszugeben ist der teure Fall: sie sieht eingetragen aus.

**Entschieden:** alle drei werfen `TabellenFehler` mit eigenem Grund
(`anfuehrung`, `feldzahl`) und nennen die Zeilennummer.

Nicht uebernommen: der Befund, `12.50` werde still als Dezimalzahl gelesen.
`leseZahl` gibt dafuer `mehrdeutig: true` zurueck, und die Vorschau zeigt es —
nachgeprueft, die Kennzeichnung ist da.

### D-113 · Der Import sagt, woran er erkannt hat — und liest nur den heute gueltigen Katalog

`schluessel_spalte` blieb leer. Laut 0026 bedeutet NULL den natuerlichen
Rueckfall ueber (Etage, Raumnummer) — nicht gefuellt zu werden war also keine
fehlende Angabe, sondern eine falsche: jeder Import behauptete den Rueckfall,
auch wenn er eine stabile Quellspalte hatte.

Und die Katalogsuche prueft jetzt BEIDE Grenzen. Ohne `gueltig_ab` waehlte die
Uebernahme auch eine kuenftig gueltige Zeile und konnte die heute gueltige
ueberschreiben — der Kalkulationsleser weist dieselbe Zeile korrekt ab, der
Import haette den Raum trotzdem daran gehaengt.

### D-114 · Die Kalkulationszeile zeigt auf ihre Angebotsposition

`angebotsposition_id` blieb null, obwohl 0024 den zusammengesetzten
Fremdschluessel dafuer traegt. Preis und Kosten liessen sich nur ueber die
Positionsnummer zusammenbringen — die einzige Verbindung war eine Konvention.
`insert … returning id` schreibt sie jetzt mit.

### D-115 · Druckmasse sind Marken, keine Zahlen im Seitencode

Die PDF-Seite trug `6px 4px`, `8pt`, `0.08em`, `8.5pt`, `32px` als Literale.
DESIGN.md §11 nennt A4, 20 mm und 10 pt und schwieg zum Rest; die Regel
„Designwerte kommen nur aus DESIGN.md" war damit fuer alles darunter nicht
erfuellbar.

**Entschieden:** §11 traegt jetzt sechs Massmarken, `theme.ts` spiegelt sie als
`MASSE_DRUCK`, und die Seite liest sie. In PUNKT, nicht in Pixel: ein PDF wird
in Punkt gesetzt, und die 10 pt Grundschrift bedeuten nur etwas, wenn daneben
dasselbe Mass steht.



### D-116 · Ein Platzhalter je Motiv, gezeichnet statt fotografiert

Der erste Entwurf hatte EIN graues Rechteck fuer jedes Bild der Website:
sichtbar leer, ehrlich — und unbrauchbar, um dem Mandanten zu zeigen, wie die
Seite aussehen wird. Wer eine Reinigungsseite beurteilt, beurteilt sie mit
einem Bild darauf.

**Entschieden:** acht gezeichnete Szenen — Gruppe, Reinigung, Security, Bau,
Operations, Objekt, Projekt, Team. Die Bereichsseite und die Markenkarte
waehlen ihre eigene; das Motiv kommt aus dem Pfad, nicht aus einem zweiten
Feld, das jemand pflegen muesste.

**Es sind ILLUSTRATIONEN, und darin liegt die Grenze, die DESIGN §4.2 zieht.**
Verboten sind erfundene Menschen, die als Belegschaft gelesen werden — nicht
Bilder ueberhaupt. Eine gezeichnete Nachtszene behauptet nicht, ein Objekt der
Gruppe zu sein; ein Stockfoto von Menschen in Warnwesten tut genau das. Das
Team-Motiv bleibt deshalb bewusst abstrakt: Silhouetten in den vier
Kennfarben, kein einziges Gesicht.

Die Kennzeichnung liegt bei der SEITE, nicht im Bild. Der erste Entwurf trug
sie doppelt — als Chip im SVG und als Marke der Seite — und die beiden
ueberlagerten im Hero den Text. Eine sichtbare Marke genuegt; sie steht in
`PLATZHALTER` und blockiert weiterhin den Produktionsbau.


### D-117 · Der Bereich gehoert in den Handler, nicht nur in die Datenbank

`auftrag_personalbedarf_bereich` (0..5000) und `auftrag_wochenstunden_bereich`
(0..10000) fangen jeden Ausreisser — aber erst beim Schreiben, nachdem der
Handler schon eine Auftragsnummer gezogen hat. Der Verstoss kam als roher
Datenbankfehler heraus und verliess die Route als 500: der Aufrufer erfuhr
„Serverfehler", wo „dieses Feld ist zu gross" richtig gewesen waere. Und eine
gezogene Nummer ist eine gezogene Nummer.

**Entschieden:** Bereich UND Ganzzahligkeit werden vor der Nummernvergabe
geprueft und als `ausserhalb_bereich` mit Feldnamen als 400 beantwortet. Die
Datenbankbedingung bleibt — sie ist die zweite Linie, nicht die einzige.

### D-118 · Ein Blatt darf den Knopf nicht verdecken, der es schliesst

Das „Mehr"-Blatt der mobilen Tab-Leiste lag als `fixed inset-0` ueber der
ganzen Ansicht — und damit ueber der Leiste, in der sein eigenes `<summary>`
steckt. Ohne JavaScript schliesst ein `<details>` nur ueber sein `<summary>`:
verdeckt man das, gibt es keinen Weg zurueck, und der Fokus bleibt gefangen.

**Entschieden:** `bottom-11` statt `inset-0`. Die Leiste ist `min-h-[44px]`
hoch; das Blatt endet darueber und laesst genau den Knopf frei, der es wieder
zumacht.

### D-119 · Ein Kommentar, der die Ausgabe falsch nennt, ist schlimmer als keiner

Zwei Stellen sagten etwas anderes als der Code: `formatiereMenge` versprach
`25_500n → "25,5"`, liefert aber `"25,50"` (`minimumFractionDigits: 2`); und in
`richtzeit.ts` hingen zwei JSDoc-Bloecke an den falschen Funktionen —
`alsStundenText` stand ohne, `stundenNachPostgres` trug die Beschreibung des
anderen. Wer bei der Fehlersuche dem Kommentar glaubt, sucht an der falschen
Stelle. Beides berichtigt.

Und `internesZiel` nimmt jetzt `erwarteterUrsprung()` statt `nextUrl.origin`:
hinter einem TLS-beendenden Proxy zeigte sonst jeder interne Redirect auf
`http://…` — ein Downgrade, ausgeloest von der Funktion, die Ziele absichern
soll. Derselbe Befund wie D-104, eine Ebene tiefer.


### D-120 · Die Berliner Anzeige bekommt eine Wache

Invariante 2 sagt: gespeichert UTC, angezeigt `Europe/Berlin`. Der
Speicherteil war gedeckt — `wacheZeitstempel` und die Spaltentypen lassen kein
`timestamp without time zone` durch. Der ANZEIGETEIL hing an der Disziplin.

Und er faellt leise. `new Date(x).toLocaleDateString('de-DE')` nimmt die Zone
des SERVERS; auf Vercel ist das UTC. Eine Schicht, die am 3. um 00:30 Berliner
Zeit beginnt, erscheint dann als der 2.; im Sommer verschiebt sich jede
Uhrzeit um zwei Stunden. Nichts wirft, nichts faellt rot — es steht ein
plausibles Datum da, und es ist das falsche. Genau die Sorte Fehler, die erst
im Streit ueber einen Stundennachweis auffaellt, wo sie am teuersten ist.

**Entschieden:** `wacheAnzeigeZeitzone` weist jeden `toLocale*String`- und
`Intl.DateTimeFormat`-Aufruf ab, der seine Zone nicht im selben Aufruf nennt.
`toLocaleString('de-DE')` auf einer ZAHL (Prozente) ist ausgenommen — eine Zahl
traegt keine Zone.

Geprueft wurde die Wache gegen sich selbst: eine Sonde mit
`toLocaleDateString('de-DE')` faellt, dieselbe Sonde mit
`{ timeZone: 'Europe/Berlin' }` geht durch. Der Bestand war bereits sauber —
alle drei Formatierer nannten Berlin schon; ab jetzt bleibt das so, ohne dass
jemand daran denken muss.


### D-121 · `qualifikationsanforderung` ist eine Funktion; die Tabelle heisst `einsatzanforderung`

Der PR-Plan nennt als vierte Tabelle von PR 31 `qualifikationsanforderung`.
Eine Tabelle dieses Namens gibt es in keinem Datenmodell-Dokument.
`app.qualifikationsanforderung(p_einsatz)` ist der **Aufloeser** aus
`03-GEWERKE.md` §9.2, und die Tabelle, die er liest, heisst
`einsatzanforderung` (§6.6) — sie ersetzt den `posten_qualifikation` des
Entwurfs und ist die strukturelle Antwort darauf, dass §34a Abs. 1a GewO am
EINSATZ eines Menschen haengt und nicht an der Existenz einer `posten`-Zeile.

**Entschieden:** die Tabelle heisst `einsatzanforderung`, die Funktion
`app.qualifikationsanforderung`. Der Plan benennt an dieser Stelle die
Funktion, nicht eine Tabelle; K-21 (Eigentuemer gewinnt) entscheidet den Rest.
`04-PLANUNG-ZEIT.md` §11 definiert die Funktion nicht, sondern uebernimmt sie
namentlich — der Vertrag ist §9.2/§9.3 in `03-GEWERKE.md`.


### D-122 · `nachweis_art.schluessel` laesst eine fuehrende Ziffer zu

`01-KERN.md` §6.33 schreibt `CHECK (schluessel ~ '^[a-z][a-z0-9_]{2,49}$')` und
seedet im selben Abschnitt `34a_sachkunde` und `34a_unterrichtung` — beide
scheitern an ihrem eigenen Muster. Die Migration fiel darauf beim ersten Lauf.

**Entschieden:** die Schluessel gewinnen. Sie stehen so in SEC-02 und ebenso
als Beispiel in `§6.16`; das Muster ist eine Formregel desselben Dokuments und
nicht aus der SPEC abgeleitet. Das Muster lautet daher
`^[a-z0-9][a-z0-9_]{2,49}$` — die Ziffer nur an erster Stelle zugelassen,
alles Uebrige unveraendert.


### D-123 · Ein Sprachschluessel-CHECK darf keine Unterabfrage enthalten

`01-KERN.md` §4 schreibt den `bezeichnung_i18n`-CHECK als
`(select bool_and(k in ('de','en','ar','tr')) from jsonb_object_keys(...) k)`.
Postgres nimmt das nicht an: ein `CHECK` darf keine Unterabfrage tragen, und
`jsonb_object_keys` ist mengenliefernd. Der vorangestellte Disjunkt
`i18n ?& array[]::text[]` war ausserdem IMMER wahr — jede Menge enthaelt die
leere —, der ganze Ausdruck also eine Tautologie, die wie eine Pruefung aussah.

**Entschieden:** dieselbe Aussage, unveraenderlich und wirksam:
`check (bezeichnung_i18n - array['de','en','ar','tr'] = '{}'::jsonb)`. Nach
Abzug der vier erlaubten Schluessel bleibt nichts uebrig. Gilt fuer
`nachweis_art` und `qualifikation`; jeder weitere uebersetzte Katalog uebernimmt
die Form.


### D-124 · Die 60/30/7-Zusage braucht einen Traeger: `nachweis_warnung`

SPEC §14 verlangt die eskalierende Ablaufwarnung, und PR 31 verlangt, dass sie
**je Stufe genau einmal** feuert. Kein Datenmodell-Dokument nennt eine Tabelle,
die das traegt. Ohne sie ist die Zusage eine Absichtserklaerung: ein taeglicher
Waechter sieht denselben Nachweis an sechzig Tagen und meldet ihn sechzigmal,
und wer sechzig Meldungen bekommt, liest keine. Sich die Stufe im
Anwendungscode zu merken — lesen, vergleichen, schreiben — waere ein Wettlauf
(K-09).

**Entschieden:** `nachweis_warnung (nachweis_id, person_id, stufe_tage,
gueltig_bis, ausgeloest_am)` mit
`unique (nachweis_id, gueltig_bis, stufe_tage)`, append-only, kein Hard Delete.
Der eindeutige Schluessel IST die Zusage; `on conflict do nothing` mit null
betroffenen Zeilen ist die Antwort „schon gemeldet".

**`gueltig_bis` steht IM Schluessel**, nicht daneben: wird ein Nachweis
verlaengert, ist die 30-Tage-Warnung zum neuen Ablaufdatum eine andere Tatsache
als die zum alten. Ohne die Spalte im Schluessel bliebe sie fuer immer aus, und
der verlaengerte Nachweis liefe beim zweiten Mal unbemerkt ab.

Ein verpasster Lauf holt nach: faellig ist jede Stufe, deren Schwelle
unterschritten ist und die noch nicht quittiert wurde — nicht nur die, deren
Schwelle genau heute erreicht wird. Ein bereits ABGELAUFENER Nachweis wird
dagegen nicht gewarnt; „laeuft in 7 Tagen ab" ueber ein seit gestern
ungueltiges Dokument waere eine falsche Aussage, und ab dem Ablauf ist die
Hartsperre zustaendig.


### D-125 · Der SEC-04-Dienst liegt unter `services/nachweis/`, nicht unter `services/dienstplan/`

`03-GEWERKE.md` §9.2 nennt als Ort des Dienstes
`src/server/services/dienstplan/assertQualifikation.ts`, und
`04-PLANUNG-ZEIT.md` §11.1 nennt `services/dienstplan/zuordnen.ts` als
Hauptaufrufer. Beide Pfade gehoeren dem parallel laufenden PR 30.

**Entschieden:** das Tor steht in `src/server/services/nachweis/tor.ts` — bei
den Tabellen, die es liest, und in dem PR, der sie anlegt. Der
Dienstplandienst RUFT es auf; das ist ohnehin die richtige Richtung, denn die
Sperre gehoert der Nachweisdomaene und wird von PR 41 (Posten) ein zweites Mal
gebraucht. Der Pfad aus §9.2 ist eine Ortsangabe, kein Vertrag; der Vertrag ist
die Funktion `app.einsatz_qualifikation_erfuellt` und ihre Signatur.


### D-126 · `app.person_sichtbar` kommt ohne zwei ihrer fuenf Disjunkte

`01-KERN.md` §3.2 definiert die Funktion mit fuenf Disjunkten. Zwei davon
lesen Spalten, die es in `0002` nicht gibt:
`anstellung.vorgesetzter_anstellung_id` (Vorgesetztenzweig) und
`person.erfasst_von_mandant_id` (Bootstrap-Anker, O-141).

**Entschieden:** die Funktion entsteht in `0030` mit den drei heute
umsetzbaren Disjunkten — eigene Person, Super-Admin, bestehende Anstellung —
und `SECURITY INVOKER`, so wie §3.2 es korrigiert hat. Die zwei fehlenden
kommen mit ihren Spalten; die Migration benennt sie an ihrem Platz, damit
niemand sie fuer eine Auslassung haelt. Wirkung heute: eine frisch erfasste
`person` ohne Anstellung ist fuer niemanden ausser sich selbst sichtbar — die
engere, fehlschliessende Richtung.


### D-127 · Bewacherregister: der Status traegt seine Herkunft in einer Spalte

CLAUDE.md verbietet vorgetaeuschte Integrationen, und fuer das Bewacherregister
gibt es keine Schnittstelle. Ein handerfasster Status sieht in einer Zeile aber
genauso aus wie ein abgefragter — und jede spaetere Oberflaeche, jeder Bericht
und jeder Agentenlauf laese ihn als geprueft.

**Entschieden:** `bewacher_eintrag.quelle text not null default 'manuell'
check (quelle in ('manuell'))`. Der `CHECK` mit genau einem zugelassenen Wert
ist Absicht: eine zweite Quelle einzutragen erfordert eine Migration, also eine
Entscheidung, die jemand trifft. Der Dienst gibt das Feld als
`quelle: 'manuell'` und `verbindung: 'nicht_verbunden'` weiter, damit die
Oberflaeche es sagen MUSS und nicht sagen KANN.

### D-128 · `qualifikation` ist der eine Katalog mit nullbarer Mandantenspalte — und ohne Rechtekonjunkt

Zwei Konventionen sprechen hier gegen das Datenmodell, und beide Male gewinnt
das Datenmodell — mit Grund, nicht aus Bequemlichkeit.

**K-16 („Catalogues are never nullable-tenant") gegen `qualifikation.mandant_id`.**
K-16 verbietet die Mittelform generisch, weil „manchmal geteilt, manchmal nicht"
sich in keinem RLS-Praedikat ohne Zweig ausdruecken laesst, der die geteilten
Zeilen in jeden Mandanten hineinschreiben laesst. `01-KERN.md` §6.16 und
`03-GEWERKE.md` §2.1 verlangen sie trotzdem, dreimal und mit derselben
Begruendung: eine §34a-Sachkunde gehoert dem MENSCHEN, und Fatima Yildiz
arbeitet fuer die Reinigung und fuer die Security. Waere der Katalog je Mandant,
gaebe es §34a zweimal — und `nachweis.qualifikation_id` zeigte je nach Erfasser
auf eine andere Zeile, womit die Zusage aus D-09 („ein Nachweis, beide
Anstellungen") an der einen Stelle brechen wuerde, an der sie zaehlt.

**Entschieden:** nullbar, NULL = plattformweit. Der Zweig, den K-16 fuerchtet,
wird ausgeschrieben statt vermieden: `q_lesen` liest `mandant_id is null or
mandant_id = any (app.sichtbare_mandanten())`, `q_schreiben`/`q_aendern`
verlangen fuer die plattformweite Zeile ausdruecklich `app.ist_super_admin()`.
`einsatzanforderung.qualifikation_id` ist deshalb ein EINSPALTIGER
Fremdschluessel — ein zusammengesetzter koennte eine plattformweite Zeile gar
nicht referenzieren —, und das mandantenfremde Loch schliesst der Ausloeser
`kern.pruefe_qualifikation_mandant()`.

**K-03 („eine Policy ohne `hat_recht`-Konjunkt ist ein Defekt") gegen `q_lesen`.**
K-03s Sorge ist benannt: sonst liest ein `kunde`-Login das Personalverzeichnis.
Ein Katalog von Qualifikationsnamen ist ueber niemanden eine Aussage — die
Personentatsache steht in `nachweis`, und die ist rechtegebunden. Und der
Konjunkt waere aktiv schaedlich: `mitarbeiter` haelt laut
`03-GEWERKE.md` §1.7 **kein einziges Modul-Leserecht**, also zeigte die
EMP-08-Seite „meine Zertifikate" dem Wachmann eine Liste von UUIDs. §6.16 laesst
den Konjunkt deshalb weg; die Auslassung ist tragend und steht als Kommentar in
`0030`, damit sie beim naechsten Durchgang nicht als Versehen berichtigt wird.

### D-129 · `mandant_einstellung` entsteht in PR 34, obwohl sie `01-KERN` gehoert

Vier Dokumente lesen `app.einstellung(...)` — `03-GEWERKE.md` §1.16,
`04-PLANUNG-ZEIT.md` §17.2, `05-FINANZEN.md` §3 und `03-AUTH-BERECHTIGUNGEN.md` —
und **keine Migration legte die Tabelle an**. PR 34 ist der erste Schreiber, der
sie wirklich braucht: LEG-10 haengt an `zeit.geolokalisierung`, und das
Abnahmekriterium (5) nennt sie woertlich.

Die Luecke faellt nicht auf, und das ist der Grund, sie hier zu schliessen: ohne
Tabelle gaebe es die Funktion nicht, jeder Aufrufer fiele auf seinen eigenen
Vorgabewert zurueck, und JEDE dieser Einstellungen waere dauerhaft
unkonfigurierbar — ohne Fehlermeldung. Der Tag, an dem jemand einen Schalter
umlegt, waere der Tag, an dem niemand versteht, warum nichts geschieht.

**Entschieden:** `0033_mandant_einstellung.sql` legt sie in der kanonischen Form
aus K-21 an (`id, mandant_id, schluessel, wert jsonb`, `unique (mandant_id,
schluessel)`), dazu beide Signaturen von `app.einstellung`, die §3.5-Definer-
Lesepolicy und die sieben O-06-Schalter auf ihrem restriktiven Wert. Wandert die
Tabelle spaeter in eine KERN-Migration, ist das ein Umzug und kein Neubau.

### D-130 · `z_geo_gate` liest die ZWEIARGUMENTIGE `app.einstellung`

`04-PLANUNG-ZEIT.md` §5.6 schreibt `app.einstellung('zeit.geolokalisierung')`.
`01-KERN.md` §3.2 — der Eigentuemer der Funktion — verbietet die einargumentige
Form ausdruecklich in Ausloesern und mandantenlosen Kontexten, weil sie dort ueber
`app.aktiver_mandant()` auf NULL auflöst.

Der Check-in-Pfad ist genau so ein Kontext: er hat keine Sitzung (K-08). Die
einargumentige Form lieferte dort NULL, die Einstellung waere fuer den EINZIGEN
Pfad unwirksam, der ueberhaupt Punkte erfassen kann — und zwar fail-*closed*,
also unauffaellig richtig, solange O-06 offen ist, und unauffaellig falsch am Tag
danach.

**Entschieden:** `kern.zeiteintrag_geo_tor()` ruft
`app.einstellung(new.mandant_id, 'zeit.geolokalisierung')`. Wo Dokument und
Konvention auseinandergehen, gilt die Konvention (04-PLANUNG-ZEIT §0).

### D-131 · Jede Check-in-Ablehnung ist 409 `ungueltiger_zustand` — alle, mit demselben Text

`08-PR-PLAN.md` PR 34 nennt fuer die zweite Einloesung woertlich **409
`ungueltiger_zustand`**; `05-API-KARTE.md` §C schreibt an derselben Stelle
**404**, mit der Begruendung, eine verbrauchte Marke duerfe von einer falschen
nicht unterscheidbar sein.

Beide Anliegen sind vereinbar, und nur die Vereinbarung zaehlt: entscheidend ist
nicht die Zahl, sondern dass EINE Antwort fuer ALLE Gruende gilt — unbekannt,
abgelaufen, zu frueh, widerrufen, schon benutzt (AUT-06, §9.2). Eine Antwort, die
sie unterscheidet, macht das Durchprobieren lohnend.

**Entschieden:** 409 `ungueltiger_zustand` mit derselben Meldung fuer jede
Ablehnung, wie PR 34 es nennt. `05-API-KARTE.md` §C weicht ab und ist hiermit
korrigiert.

### D-132 · „Eingeloest heisst: es gibt einen Zeiteintrag" ist ein AUFGESCHOBENER Ausloeser

`04-PLANUNG-ZEIT.md` §5.5 fuehrt `check ((eingeloest_am is null) =
(eingeloest_zeiteintrag_id is null))`. Als `CHECK` widerspricht die Regel K-09:
der bedingte Schreibvorgang setzt `eingeloest_am` und erfaehrt die Eintrags-id
erst danach — sie entsteht ja aus seinem Rueckgabewert. Der `CHECK` schluege
dazwischen an, und der einzige Ausweg waere, vorher zu lesen und danach zu
schreiben: genau der Wettlauf, den K-09 entfernt.

**Entschieden:** ein `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`
(`CHECK`-Bedingungen sind in Postgres nicht aufschiebbar). Er liest die Zeile
beim Commit NEU, statt `new` zu benutzen — ein aufgeschobener Ausloeser bekommt
sonst den Zwischenstand seiner eigenen Anweisung — und er ist `SECURITY DEFINER`,
weil er unter `cse_checkin` feuert, einer Rolle mit null Tabellenrechten. Die
Zusage bleibt: am Ende der Transaktion gibt es keine verbrannte Marke ohne
§ 17-Nachweis.

### D-133 · Die Serveruhr stempelt nur die ERSTE Fassung einer Kette

`kern.stempel_feldzeit()` ersetzt bei `quelle = 'server_uhr'` den mitgelieferten
Zeitpunkt durch `now()` — sonst schriebe ein INSERT mit eigenem Wert einen
beliebigen Zeitpunkt, und die Unveraenderlichkeitsregel machte ihn dauerhaft
(§1.8).

Eine Korrektur ist aber kein zweites Ereignis, sondern eine Kopie mit geaenderten
Feldern. Die zweite Fassung einer Zeile, an der nur die Pause richtig gestellt
wurde, traegt denselben Beginn wie die erste — und der kam damals von der
Serveruhr; die Korrektur aendert das nicht. Ohne Unterscheidung zoege jede
Pausenkorrektur den Schichtbeginn auf den Zeitpunkt der Korrektur, womoeglich
Wochen nach vorn: der § 17-Nachweis waere danach falsch, und beide Werte saehen
plausibel aus.

**Entschieden:** gestempelt wird bei `version = 1`. Ab Fassung 2 erbt die Zeile
den Zeitpunkt der Fassung, die sie ersetzt; woher er stammt, belegt
`zeiteintrag_korrektur`.

### D-134 · `zeitabweichung_sek` ist zwei Spalten, je Ereignis eine

Invariante 5 nennt EINE Spalte. `04-PLANUNG-ZEIT.md` §5.6 teilt sie in
`zeitabweichung_beginn_sek` und `zeitabweichung_ende_sek`, und das ist richtig:
Beginn und Ende werden Stunden auseinander erfasst, oft auf verschiedenen
Geraeten. Eine gemeinsame Spalte ueberschriebe die erste Messung mit der zweiten,
und die Abweichung beim Einstempeln waere nicht mehr feststellbar.

**Entschieden:** zwei Spalten, hier aufgeschrieben, damit eine Konformitaets-
pruefung, die den woertlichen Namen sucht, den Grund findet. Das Vorzeichen ist
GERAET MINUS SERVER: ein nachgehendes Telefon ergibt eine negative Zahl.

### D-135 · `/check-in/[token]` loest die Marke beim Rendern NICHT auf

Der naheliegende Entwurf zeigt Objekt, Schichtfenster und Namen an, bevor jemand
tippt. Er waere ein Orakel: eine Seite, die fuer eine gueltige Marke „Objekt
Musterstrasse 3, 22:00–06:00" zeigt und fuer eine ungueltige nichts, beantwortet
jedem Durchprobierenden genau die Frage, die er stellt (AUT-06). Und er
braeuchte eine sechste Zeile im GESCHLOSSENEN K-08-Register — ein Register in
einem PR zu erweitern, der es nicht muss, ist der Anfang davon, dass es keins
mehr ist.

**Entschieden:** ein Knopf, ein Bildschirm, kein Vorabblick. Was passiert ist,
sagt die Antwort auf das Antippen: Serverzeit in Berliner Anzeige, Objekt,
Ergebnis. `05-API-KARTE.md` §C sieht `GET /check-in/[token]` als aufloesende
Seite vor und weicht damit ab.

### D-136 · Der K-19-Scanner kennt drei SQL-Register, die keine Rechte sind

`'zeit.geolokalisierung'` (eine Einstellung), `'zeit.eingestempelt'` (eine
Auditaktion) und `'zeit.lesen'` (ein Rechteschluessel) sehen fuer einen
Textscanner gleich aus. Bis PR 34 fiel das nicht auf, weil die vorhandenen
Einstellungs- und Auditkennungen mit Praefixen begannen, die keine Modulnamen
sind (`auth.`, `website.`).

Ohne Schnitt meldete `tests/kern/katalog.test.ts` jede Einstellung und jede
Auditaktion als unregistriertes Recht — und wer die Pruefung kennt, benennt seine
Einstellungen um, statt den echten Fund zu suchen. Das ist genau die Erosion, vor
der `ohneRegisterKennungen` schon fuer die TypeScript-Seite warnt.

**Entschieden:** `scripts/katalog/benutzung.ts` uebergeht in SQL drei Formen —
`app.einstellung(...)`, den ganzen Aufruf `app.protokolliere(...);` und die
`insert into mandant_einstellung … ;`-Anweisung. Was ein Rechteschluessel ist,
bleibt unberuehrt: `app.hat_recht('…')` findet der Scanner weiter, und ein
Tippfehler dort bricht den Build wie zuvor. Kennungen dieser Register stehen
deshalb IM Aufruf und nicht vorher in einer Variablen — ausserhalb sieht der
Scanner sie wieder als Recht.

### D-150 · `auftrag_leistung` entsteht in PR 36, obwohl sie `02-CRM-OPERATIONS` gehoert

PR 27 legte `auftrag` an und liess die Leistungszeilen darunter aus. Vier
Migrationen tragen seither Spalten, die auf sie zeigen, ohne Fremdschluessel —
`einsatz` (0028), `revier` und `turnus` (0029), `zeiteintrag` (0034) —, und
jede hat ihre Anweisung woertlich als Kommentar hinterlegt.

Der naheliegende Weg waere gewesen, PR 36 ohne den Elternteil zu bauen: die
Spalte ist ja da. Das Ergebnis waere ein Abrechnungsanker, den niemand prueft.
Ein `zeiteintrag.auftrag_leistung_id`, der auf nichts zeigt, faellt nicht auf —
er erzeugt eine Abrechnungsabfrage, die still null Stunden liefert, und TIM-12
("keine manuelle Uebertragung") waere eine Zusage ueber eine Kette mit einem
fehlenden Glied.

**Entschieden:** `0050_auftrag_leistung.sql` legt die Tabelle nach der Form von
`02-CRM-OPERATIONS.md` §3.2 an — deren Eigentum sie bleibt — und loest in
derselben Migration alle vier aufgeschobenen Fremdschluessel ein, jeden mit der
Zeile, warum er dort stand. `0051` loest zusaetzlich die drei ein, die 0040
gegen `zeiteintrag` (PR 34) und `qualifikation` (PR 31) offen liess, obwohl
beide Elternteile schon standen.

### D-151 · Der Monatssplit ist eine Sicht, und der Nettoanteil wird nicht in SQL gerundet

Eine Schicht 31.10. 22:00 → 01.11. 06:00 gehoert zwei Monaten an. Sie in zwei
Zeilen zu schreiben ist der naheliegende Entwurf und faelscht genau das, was
§ 17 Abs. 1 MiLoG verlangt: Beginn, Ende und Dauer, EINMAL und so, wie sie
waren.

**Entschieden:** `zeiteintrag_monatsanteil` ist eine Sicht (04-PLANUNG-ZEIT
§7.3, woertlich uebernommen); der Datensatz bleibt ungeteilt. Die Sicht liefert
BRUTTOMINUTEN je Anteil — eine Differenz zweier Zeitpunkte, damit DST-richtig
ohne Sonderfall —, und die aufgezeichnete Pause verteilt
`services/zeit/monatsanteil.ts` nach groesstem Rest (§7.4). Jeden Anteil
einzeln zu runden erzeugt oder vernichtet an jedem Monatsende eine Minute, die
spaeter als Centdifferenz auf einer Rechnung auftaucht; eine Rundungsregel in
einer DDL-Anweisung erreicht ausserdem kein Test.

Die Gegenprobe laeuft immer: `pruefeAnteileGegenSchicht` rechnet den Split ein
zweites Mal mit `splitteNachMonat` und wirft bei Abweichung. Zwei unabhaengige
Umsetzungen derselben Regel, gegeneinander gehalten — die SQL-Sicht und die
TypeScript-Funktion.

### D-152 · Ein gesperrter Monat bekommt ein Artefakt mit Digest — `zeitnachweis`

§7.3 verlangt, dass ein gesperrter Monat einmal rendert und danach nie wieder:
eine Korrektur im Mai praegt eine neue Fassung mit Maerz-Zeitpunkten (§15.6),
und wer den Maerz danach aus der lebenden Sicht neu rendert, erzeugt ein
Dokument, das von dem abweicht, das die Arbeiterin bekommen hat. Beide sehen
richtig aus.

Kein Dokument der Phase 0 benennt einen Traeger fuer dieses Artefakt.
`stundenkonto.abrechnung_dokument_id` (01-KERN §6.24, PR 37) zeigt auf das
gerenderte PDF — das ist nicht dasselbe und darf auch keine zweite Quelle sein.

**Entschieden:** `zeitnachweis` (0051) traegt die kanonische DATENFASSUNG je
Beschaeftigung und Monat mit ihrem SHA-256, anfuegend, mit einem Ausloeser, der
jedes UPDATE abweist — auch das des Eigentuemers. Das PDF von PR 37/39 entsteht
AUS dieser Zeile; zwei Renderer aus einer Quelle koennen nicht auseinanderlaufen,
zwei Quellen fuer ein Dokument tun es zwangslaeufig. Der Digest wird beim Lesen
NACHGERECHNET und nicht geglaubt: ein gespeicherter Hash neben gespeicherten
Zeilen beweist nichts, solange niemand die beiden gegeneinander haelt.

Ein gesperrter Monat ohne Artefakt wird als `ungepraegt` gemeldet und
ausdruecklich NICHT still aus der lebenden Sicht beantwortet — genau der
Fallback waere der Fehler, den §7.3 beschreibt. Die Tabelle gehoert fachlich zu
`04-PLANUNG-ZEIT.md` §7.3; sie ist dort nachzutragen (K-21).

### D-153 · EMP-07 ist eine RESTRIKTIVE Policy, nicht eine Zusage der Oberflaeche

0034 gibt `zeiteintrag` eine nur lesende `t_person`-Policy und die Decke
`p_ma_decke`. Beides genuegt nicht: `t_mandant` ist `for all`, und ein Mandant,
der der Rolle `mitarbeiter` einmal `zeit.schreiben` bindet — versehentlich oder
mit einer gut gemeinten Begruendung —, oeffnet damit den UPDATE-Weg auf die
eigenen Zeilen. Danach steht in der Datenbank ein § 17-Nachweis, den die
betroffene Person selbst bewegt hat, und niemandem faellt es auf.

**Entschieden:** `p_ma_kein_update` (0052) ist eine RESTRIKTIVE Policy auf
`zeiteintrag` fuer `UPDATE`: restriktive Policies werden UND-verknuepft, ein
zusaetzliches Recht kann sie nicht ueberstimmen. INSERT bleibt bewusst aussen
vor — der Check-in schreibt ueber `cse_definer` (K-08), nicht ueber `cse_app`,
und ein zweites Verbot verdeckte, dass genau EIN Weg gemeint ist. Der Test
bindet der Mitarbeiterrolle `zeit.schreiben`, weist nach, dass das Recht
tatsaechlich greift, und zeigt, dass das UPDATE trotzdem null Zeilen trifft.

### D-154 · `zeit_einwand` bekommt eine Selbstlese-Policy im Mandanten-Scope

01-KERN §6.27 gibt dem Mitarbeitenden eine INSERT-Policy und laesst ihn ueber
`t_person` lesen — also im Personen-Scope. Der Einwand wird aber im
MANDANTEN-Scope geschrieben (§12.1: der Dienst betritt `withTenant` mit dem
aufgeloesten Mandanten neu), und dort trifft keine Lesepolicy zu.

Das ist kein theoretisches Loch: Postgres verlangt fuer `INSERT … RETURNING`
zusaetzlich eine SELECT-Policy. Ohne sie scheitert der eine Schreibweg, den
EMP-07 dieser Person zusagt, mit `new row violates row-level security policy` —
also mit der Auskunft „du darfst das nicht" fuer genau die Handlung, die ihr
zusteht.

**Entschieden:** `t_selbst_lesen` (0052) mit demselben Subjektpraedikat wie
`t_selbst_einreichen`. Es werden keine anderen Zeilen sichtbar als in
`t_person` — dieselben eigenen Einwaende, nur im anderen Scope. Die Alternative
waere gewesen, der Mitarbeiterrolle `zeit.lesen` zu binden; das oeffnete die
Einwaende ALLER Kollegen.

### D-155 · Ueber den eigenen Einwand entscheidet niemand selbst

`zk_nicht_selbst` (0036) verhindert, dass jemand seine eigene KORREKTUR
schreibt. Das genuegt nicht: ein Einwand, den die betroffene Person selbst
ABLEHNT, erzeugt gar keine Korrektur — also feuert `zk_nicht_selbst` nie, und
im Eingang der Planung ist die Karte verschwunden.

**Entschieden:** `einwand_status_maschine` (0052) weist eine Entscheidung ab,
deren Konto zur betroffenen Person gehoert. Das ist das Geschwister von
`zk_nicht_selbst` und nicht dieselbe Regel an zweiter Stelle: der eine schuetzt
die Korrektur, der andere den Vorgang, der zu ihr fuehrt.

### D-140 · Die Schichtmedien heissen `einsatz_medien`, nicht `medien`

`04-PLANUNG-ZEIT.md` §5.8 nennt die Tabelle `medien`. Diesen Namen traegt in
`public` aber seit `0014` schon die Bildablage der Website — mit
`abschnitt.medien_id`, `referenz.medien_id` und zwei laufenden Diensten daran.
Zwei Dokumente haben denselben Namen fuer zwei verschiedene Dinge vergeben; nur
eines kann ihn haben, und die Migration meldet es als `relation "medien" already
exists`. Das ist ein K-21-Fund: „jede Tabelle wird genau einmal deklariert" ist
hier von zwei Eigentuemern gleichzeitig in Anspruch genommen worden.

**Entschieden:** die Schichtmedien heissen `einsatz_medien`, ihr Register
`einsatz_medien_bezug`. Der Name ist nicht erfunden — dieselbe Domaene benutzt
ihn bereits: `einsatz_medien` ist ihr Aufbewahrungsklassenschluessel (§13) und,
mit Bindestrich, ihr Bucket (`07-INTEGRATIONEN.md` §6.4). Umbenannt wird nichts
Bestehendes; die Website-Ablage bleibt `medien`. Die fuenf Domaenen, die spaeter
Medien anhaengen (PR 40, 41, 43, 45), adressieren die Tabelle ohnehin ueber ihr
Register und nicht ueber einen Fremdschluessel, tragen den Namen also an genau
einer Stelle. **Offen fuer die Gruppe:** ob `medien` mittelfristig in
`inhalt_medien` umbenannt wird, damit die Domaene mit den mehr Referenzen den
kuerzeren Namen bekommt. Das ist eine Migration mit Diensten und Seed daran und
gehoert nicht in PR 35.

### D-141 · Die Medienerfassung faehrt auf K-08-Registerzeile VIER, nicht auf einer sechsten

`05-API-KARTE.md` §C.3 fuehrt `POST /api/check-in/[token]/medien` mit Prinzipal
`cse_checkin`. K-08 fuehrt fuer diese Rolle genau zwei Funktionen —
`checkin_verbrauchen` und `offline_ereignis_annehmen` — und nennt das Register
ausdruecklich geschlossen. Beides zusammen geht nicht: eine Medienroute unter
`cse_checkin` braucht eine Funktion, und eine neue waere die sechste Zeile.

**Entschieden:** keine sechste Zeile. Die Aufnahme faehrt als das, was sie
ohnehin ist — ein Ereignis der Warteschlange mit `art = 'foto'`, ein Wert, den
`offline_ereignis_art` von Anfang an fuehrt. Die Route legt das Objekt in den
privaten Bucket (Groesse, Magic Bytes, Metadaten entfernt) und uebergibt der
vorhandenen Funktion die Koordinaten des abgelegten Objekts; die schreibt
`einsatz_medien` unter `me_definer_insert` mit dem Menschen, den sie aus der
Marke aufgeloest hat. Eine Zeile, deren Objekt nicht in den Bucket gekommen ist,
entsteht damit nie — und ein Objekt ohne Zeile raeumt die Route wieder weg. D-135
hat denselben Satz fuer die Check-in-Seite geschrieben: ein Register in einem PR
zu erweitern, der es nicht muss, ist der Anfang davon, dass es keins mehr ist.

### D-142 · Die Doppelerkennung haengt an `client_ereignis_id` allein, nicht am Paar

`04-PLANUNG-ZEIT.md` §5.9 nennt `oe_idem_uk unique (geraet_id,
client_ereignis_id)` als den Schluessel, der eine mehrfach gesendete
Warteschlange auf eine Zeile zusammenfallen laesst. §1.15 desselben Dokuments
sagt aber: solange `zeit.geraetekennung` aus ist, ist `geraet_id` **ein
Zufallswert je Uebermittlung** — und aus ist die AUSGELIEFERTE Einstellung, weil
O-06 offen ist. Damit ist das Paar bei jeder Wiedergabe ein anderes, die
Doppelerkennung greift nie, und dieselbe Nachtschicht steht zweimal in der
Warteschlange: zwei Ansprueche auf eine Stunde, beide plausibel, keiner
auffaellig.

**Entschieden:** beide Indizes. `oe_idem_uk` steht woertlich wie §5.9 ihn
schreibt, und daneben `oe_client_uk unique (client_ereignis_id)` — die vom
Geraet gepraegte UUID, die den Schluessel unter der ausgelieferten Einstellung
ueberhaupt erst wirksam macht. Dasselbe Paar in `zeit_intern.offline_eingang`.
`tests/isolation/offline-warteschlange.test.ts` (2) sendet dasselbe Ereignis
zweimal mit VERSCHIEDENEN Geraetekennungen und faellt ohne den zweiten Index.

### D-143 · Eine Nacherfassung nennt sich selbst als Ursprung UND als Ersatz

§9.4 verlangt, dass die Uebernahme einer Offline-Behauptung in derselben
Transaktion eine `zeiteintrag_korrektur`-Zeile mit `art = 'nacherfassung'`
schreibt — sie ist der Beleg, ohne den `quelle_beginn = 'planer_entscheidung'`
nach §1.8 nicht rechtmaessig ist. §5.7 gibt derselben Tabelle aber
`ursprung_zeiteintrag_id NOT NULL`, `check (art = 'storno' or
ersatz_zeiteintrag_id is not null)` und eine Kettenpruefung, die eine
VORGAENGERFASSUNG voraussetzt und den Ursprung als abgeloest markiert. Eine
Nacherfassung hat keinen Vorgaenger: sie legt den Datensatz erst an. Beide
Regeln zusammen machen TIM-09s einzigen rechtmaessigen Weg unbaubar — und zwar
nicht sichtbar, sondern als `check_violation` tief in einem Ausloeser.

**Entschieden:** der minimale Schnitt. Die Korrekturzeile nennt den neu
entstandenen Eintrag als Ursprung UND als Ersatz; damit ist die
`CHECK`-Bedingung erfuellt, ohne dass eine Spalte nullbar wird.
`kern.korrektur_kette_pruefen` bekommt in `0042` genau einen zusaetzlichen
Zweig — `art = 'nacherfassung'`, Ursprung gleich Ersatz, Fassung 1,
`nacherfasst` gesetzt —, der das Ablosen ueberspringt; jeder bestehende Pfad
laeuft Zeichen fuer Zeichen unveraendert weiter. `vorher` traegt die Behauptung
des Geraets, `nachher` den angelegten Datensatz: die Zeile beantwortet damit
genau die Frage, um die es in §1.8 geht — worin unterscheidet sich, was das
Telefon gemeldet hat, von dem, was ein Mensch aufgeschrieben hat.

### D-144 · Die Aufnahme antwortet EINMAL fuer jeden Fall — und ihre Spalten heissen anders

Zwei Entscheidungen an `app.offline_ereignis_annehmen`, beide klein und beide
mit teurer Kehrseite.

**Ein Ergebnis, kein Orakel.** Eine Einreichung, deren Marke aufloest, landet in
`offline_ereignis`; eine, deren Marke nicht aufloest, in
`zeit_intern.offline_eingang`. Die Antwort unterscheidet die Faelle NICHT: sie
nennt eine `vorgang_id` und `empfangen`, und welches Buch das war, geht den
Absender nichts an (AUT-06, §9.2). `05-API-KARTE.md` §C.3 schreibt hier
`{ offline_ereignis_id, status: 'empfangen' }`; das Feld heisst `vorgang_id`,
weil `offline_ereignis_id` fuer eine Zeile des Vorbereichs schlicht falsch waere
— ein Name, der luegt, ist schlimmer als einer, der abweicht.

**Und die Rueckgabespalten heissen `ereignis_kennung` und `ergebnis`.** In
plpgsql sind OUT-Parameter Variablen, und Postgres setzt sie ueberall dort ein,
wo ein Bezeichner sonst eine Spalte waere. Hiessen sie wie die Spalten, schluege
`on conflict (client_ereignis_id)` mit „column reference is ambiguous" fehl —
zur Laufzeit, beim ersten Wiedereinspielen, also genau an der Stelle, die die
Funktion absichert. Der Test hat es gefunden.

### D-145 · Videometadaten werden ueberschrieben, nicht herausgeschnitten

`src/server/storage/exif.ts` lehnte `video/*` ab, weil es kein Verfahren gab —
richtig, solange keines da war, aber TIM-10 verlangt „Photo **and video**
capture, EXIF stripped". Der naheliegende Entwurf schneidet `moov/udta` heraus
(dort steht Apples `©xyz`, die GPS-Koordinate der Aufnahme). Er macht die Datei
kaputt: `stco`/`co64` im `stbl` sind ABSOLUTE Byteoffsets in `mdat`, und wenn
`moov` davor liegt — der Normalfall bei allem, was auf einem Telefon aufgenommen
wird —, verschiebt jede Verkuerzung jeden dieser Offsets. Nicht sichtbar kaputt:
die Datei oeffnet sich und springt, und das faellt erst auf, wenn jemand das
Video als Beweis braucht.

**Entschieden:** gleiche Laenge. Der Boxtyp wird zu `free` (ISO/IEC 14496-12
nennt `free`/`skip` ausdruecklich ignorierbar), der Inhalt zu Nullbytes. Kein
Offset bewegt sich. Derselbe Kunstgriff wie beim PDF, aus demselben Grund.
Abgelehnt wird jetzt, was **keine `ftyp`-Box** hat: eine Datei, deren Boxlaengen
wir nicht kennen, laesst sich nicht ueberschreiben, ohne zu raten.

Dabei gefunden und mitbehoben: in `SIGNATUREN` stand `video/mp4` (Signatur
`ftyp`) VOR `video/quicktime` (`ftypqt`), und `find` nimmt den ersten Treffer.
Jede `.mov` und jedes iPhone-Foto wurde damit als `video/mp4` erkannt, und
`pruefeUpload` wies den Upload als „Widerspruch" ab, obwohl Inhalt und
Deklaration uebereinstimmten — die unangenehme Sorte Fehler: die Datei ist in
Ordnung, die Meldung beschuldigt sie, und niemand sucht in der Reihenfolge einer
Liste. `image/heic` kam neu dazu und steht als spezifischste zuerst.

### D-146 · `z_fenster_projizieren` wird in `0042` nachgezogen

`0040` hat den dritten K-06-Projektionsausloeser als auskommentierten Block
hinterlassen, weil `zeiteintrag` damals nicht existierte, und die Migration
benannt, die ihn nachtraegt: „die, die `zeiteintrag` anlegt; ist die bereits
angewendet, in die naechste danach." PR 34 hat ihn nicht nachgezogen.

**Entschieden:** er steht in `0042`, woertlich mit dem Koerper aus `0040`
Abschnitt 6 — und er gehoert ohnehin hierher, denn erst mit der
Offline-Uebernahme entstehen `ist`-Fenster in Menge. Ohne ihn traegt
`zeit_intern.arbeitszeit_fenster` nur `plan`-Zeilen: der ArbZG-Detektor prueft
dann die GEPLANTE Belastung und nie die tatsaechliche, eine Kraft, die sechs
Stunden laenger geblieben ist, bleibt unauffaellig, und eine gesetzlich
vorgeschriebene Pruefung, die immer still besteht, ist schlimmer als keine
(§15.1). **Weiterhin offen und NICHT in diesem PR:** `0040` §16 nennt zwei
Fremdschluessel, die dieselbe Voraussetzung hatten und ebenfalls fehlen —
`pk_zeiteintrag_fk` auf `planungs_konflikt` und `av_zeiteintrag_fk` auf
`arbeitszeit_verstoss`. Beide Tabellen gehoeren der parallel laufenden
ArbZG-Arbeit; sie hier anzufassen waere ein Konflikt mit ihr.


### D-160 · Das Stundenkonto ist eine Buchungsreihe; `ist_minuten` wird abgewiesen, nicht geheilt

`01-KERN.md` §6.24 fuehrt `ist_minuten` als „Summe der `stundenkonto_bewegung`;
per Trigger gepflegt" und nennt daneben `job:stundenkonto_abgleich`, der
naechtlich gegenrechnet. „Gepflegt" laesst zwei Umsetzungen zu, und die
naheliegende ist die falsche: ein Ausloeser, der die Spalte bei jedem
Schreibvorgang aus dem Journal UEBERSCHREIBT. Dann verschwindet jede Abweichung
in dem Moment, in dem sie entsteht — samt der Auskunft, dass etwas am Konto
vorbei gebucht hat. Der naechtliche Abgleich meldete danach fuer immer „alles
sauber".

**Entschieden:** `stundenkonto_summe` (0060) WEIST AB. Wer eine Summe schreibt,
die das Journal nicht hergibt, bekommt einen Fehler und keine korrigierte Zahl;
geschrieben werden `ist_minuten` und `korrektur_minuten` an genau einer Stelle,
naemlich von `bewegung_summe` unmittelbar nach dem Einfuegen einer Buchung, und
zwar durch Neuberechnung statt durch `+= new.minuten` — ein Aufaddieren ist
einen Rollback oder eine Nebenlaeufigkeit von der Drift entfernt.
`pruefeAbgleich` (`services/zeit/stundenkonto.ts`) MELDET Befunde und heilt
nichts; der Test erzeugt die Drift mit `session_replication_role = replica`,
also so, wie ein Wartungszugang sie erzeugen wuerde.

### D-161 · Der Ausgleich geht in den ersten OFFENEN Monat, und der Dienst waehlt ihn

EMP-04 sagt „corrections flow into the next month". Woertlich genommen waere das
der Folgemonat — und der ist oft selbst schon gesperrt oder existiert noch gar
nicht. `04-PLANUNG-ZEIT.md` §12.2 sagt praeziser „first open month".

**Entschieden:** `bucheKorrektur` sucht das frueheste Konto mit
`status <> 'gesperrt'` ab dem betroffenen Monat, sortiert nach `(jahr, monat)`
und nicht nach `erstellt_am` — „der erste offene" ist eine Aussage ueber den
Kalender, und Konten entstehen nicht zwingend in der Reihenfolge ihrer Monate.
Gibt es keinen, wirft der Dienst (`KeinOffenerMonatFehler`) und legt KEINEN an:
welcher Monat als naechster aufgemacht wird, entscheidet
`job:konten_rollover`, und ein Korrekturlauf, der sich selbst einen Monat
anlegt, verschoebe die Differenz in einen Zeitraum, den niemand geplant hat.
`bewegung_sperre_pruefen` (0060) leitet ausdruecklich NICHT selbst um: ein
Ausloeser, der Zeilen woandershin schreibt als der Aufrufer gesagt hat, faellt
erst auf, wenn die Zahlen nicht mehr zusammenpassen. `wirksam_am` der
Ausgleichsbuchung ist der erste Tag des ZIELmonats, nicht der Tag der
korrigierten Schicht — sonst stuende im Mai-Auszug eine Buchung mit
Maerz-Datum, und der Auszug erzaehlte, der Maerz sei doch bewegt worden.

### D-162 · Der Monatsabschluss verweigert, solange Zeiten unfreigegeben sind

EMP-04 verlangt, dass nur Freigegebenes ins Konto fliesst (§7.3), und dass ein
gesperrter Monat keine Buchung mehr annimmt. Beides zusammen hat eine Folge,
die keines der Dokumente ausspricht: eine beim Sperren noch unfreigegebene Zeit
kann DANACH nie mehr gebucht werden. Ihre Minuten waeren aus dem Lohnmonat
verschwunden — ohne Fehler, ohne Meldung, mit einer plausiblen Zahl auf dem
Nachweis.

**Entschieden:** `schliesseMonatAb` wirft `UnfreigegebeneZeitenFehler` und
nennt die Anzahl. Die Alternative — trotzdem sperren — ist die einzige, die
still falsch ist; die dritte (die Zeiten beim Sperren mitfreigeben) waere eine
Freigabe ohne Pruefung und machte O-39 zur Attrappe. Die Reihenfolge des
Abschlusses ist damit: verweigern · buchen · sperren · praegen. Wer das Praegen
vor das Sperren zoege, praegte ein Artefakt ueber einen offenen Monat, also
eine Zusage „so und nicht anders" ueber Zahlen, die sich morgen noch aendern.

### D-163 · `stundenkonto` liest mit `zeit.konto_lesen`, nicht mit `zeit.lesen`

`01-KERN.md` §6.24 nennt fuer beide Kontotabellen die „K-03-Standardpolicy,
Modul `zeit`" — das waere `zeit.lesen`/`zeit.schreiben`. Der Katalog
(`03-AUTH-BERECHTIGUNGEN.md` §12) macht `zeit.lesen` aber fuer die Rolle
`kunde` BINDBAR, damit ein Auftraggeber Leistungsnachweise sehen kann. Unter
demselben Schluessel saehe dieser Kunde die Arbeitszeitkonten der Menschen, die
bei ihm putzen — mit Sollzeit, Saldo und Ueberstunden. Das ist die Vermischung,
die EMP-13 verbietet, und sie faellt nicht auf, weil sie wie eine gewaehrte
Berechtigung aussieht.

**Entschieden:** `SELECT` verlangt `zeit.konto_lesen`, `INSERT`/`UPDATE`
`zeit.schreiben` (K-03), der Uebergang nach `gesperrt` zusaetzlich
`zeit.konto_abschliessen` und eine Bewegung mit `art = 'korrektur'`
zusaetzlich `zeit.konto_korrigieren` — alle drei stehen im Katalog und sind
damit keine Erfindung, sondern die Schluessel, die `04-SEITENKARTE.md` §5.12
den Stundenkonto-Routen ohnehin schon zuweist. Die beiden zusaetzlichen
Bedingungen stehen in der `WITH CHECK` derselben Policy und nicht in einem
Dienst: ein Recht, das nur ein Dienst prueft, ist an einer zweiten Route
weg. Dieselbe Aufteilung traegt `urlaubskonto` (0061).

### D-164 · Eine reine Pausenkorrektur war nicht aufschreibbar — die Bedingung wird geweitet

Der Bericht zu PR 36 hat es benannt: `korrigiereZeiteintrag` schreibt jede
Ersatzfassung mit `quelle_* = 'planer_entscheidung'`, `z_quelle_*_belegt`
verlangt dafuer `nacherfasst`, und `z_anspruch_je_ereignis` (0034) verlangt bei
`nacherfasst` mindestens einen behaupteten ZEITPUNKT — den eine Pausenkorrektur
nicht hat. `einwand_art = 'pause_falsch'` (0052) und
`korrektur_art = 'pause_korrektur'` (0036) existieren beide; der Weg zwischen
ihnen endete in einer `check_violation`.

**Warum in PR 37:** das Stundenkonto bucht NETTOminuten. Eine Pausenkorrektur
ist damit die haeufigste Differenz, die als Ausgleichsbuchung in den ersten
offenen Monat laufen muss — ohne die Reparatur haette ein ganzer Zweig der
Korrekturen keinen Weg auf das Konto.

**Entschieden:** `0062` weitet die Bedingung um einen dritten Zweig —
`ersetzt_zeiteintrag_id is not null`. Eine Fassung, die eine andere abloest,
traegt ihren Beleg nicht in einer `behauptet_*`-Spalte, sondern in
`zeiteintrag_korrektur`: Urheber, Zeitpunkt, Grund, Vorher und Nachher,
unveraenderlich, und ohne sie darf die Ersatzfassung gar nicht entstehen. Das
ist der staerkere Beleg. Was die Bedingung schuetzen sollte, schuetzt sie
unveraendert: die ERSTFASSUNG einer Nacherfassung traegt
`ersetzt_zeiteintrag_id is null` (D-143 setzt Ursprung = Ersatz auf der
KORREKTURZEILE, nicht am Eintrag) und muss weiterhin sagen, was behauptet
wurde. Beide Faelle haben einen Test. **Nicht repariert:** dass die
Ersatzfassung einer reinen Pausenkorrektur `quelle_beginn =
'planer_entscheidung'` traegt, obwohl der Planer diesen Zeitpunkt nicht
entschieden hat. Das ist ein Befund an `services/zeit/korrektur.ts`, einer
Datei, die dieser PR nicht anfassen darf.

### D-165 · `zk_ausgleich_fk` macht eine Platzhalter-UUID in einem PR-36-Test ungueltig

`0036` §5 hat den Fremdschluessel woertlich hinterlegt und auf PR 37 gewartet;
`04-PLANUNG-ZEIT.md` §12.2 Punkt 4 verlangt ihn ausdruecklich, damit „die
Differenz ist im offenen Monat angekommen" aus der Korrekturzeile BEWEISBAR ist
und nicht von einem Dienst behauptet wird. `tests/isolation/zeit-auftrag.test.ts`
hat, solange es die Elterntabelle nicht gab, eine erfundene UUID uebergeben.

**Entschieden:** der Fremdschluessel kommt (0060), und der eine Test bekommt
statt der Platzhalter-UUID eine echte Buchung — die kleinste Aenderung, die ihn
gruen haelt, in genau einem `it`-Block. Die Alternativen waren beide
schlechter: den Fremdschluessel weglassen hiesse, die Zusage von §12.2 nicht
einzuloesen, und die Suite rot zu lassen verschoebe die Arbeit auf jemanden,
der den Zusammenhang nicht mehr kennt.

## Carried over from the Phase 0 review — not client questions

Three items the review surfaced that are ours to do, recorded here so they are not
lost between phases:

1. **`docs/DESIGN.md` needs two additions before any Dienstplan screen renders.**
   Both are ours, not the client's, and CLAUDE.md's order is DESIGN.md first, then use:
   - an **absence colour palette**. `01-KERN.md` §6.22 `CHECK`s
     `abwesenheitsart.farbe_token` to the five semantic tokens of DESIGN §1
     (`success · warning · danger · info · neutral`), which cannot distinguish leave from
     sickness from training; the `// TODO(design)` marker sits at `01-KERN.md` §6.22, not
     in DESIGN.md itself.
   - the **status-pill labels** of `04-PLANUNG-ZEIT.md` §3.6. DESIGN §5 fixes five pill
     classes and their German labels; most of the Dienstplan's values have no label there,
     and that section is both the mapping and the change request.
2. **`app.mandant_kennzahlen()`** is defined in `01-KERN.md` §6.3 as counts-only over
   `app.switcher_mandanten()`, and is silent on whether the counts respect the caller's
   per-module rights — a `leitung` with no `finanzen` module would still see a finance
   counter in the switcher. Settle it before the switcher ships (TEN-10).

The third item recorded here in an earlier pass — that `02-CRM-OPERATIONS.md` must add
`dokument.sichtbar_fuer_mitarbeiter` — was **wrong and is withdrawn**. The column is
declared at `02-CRM-OPERATIONS.md` §4.7 (`boolean not null default false`) and is already
the subject predicate of that document's `t_person` policy and of the form-C worker
ceiling of `03-AUTH-BERECHTIGUNGEN.md` §8.5. It was carried forward from the review notes
without being checked against the file.

---

## Open — ask, do not guess

**This table is the register. A number is assigned here and nowhere else.**

`docs/architecture/**` carries every one of these as a `// TODO(client)` at its point
of use with its `O-nn` inline, so `pnpm lint:todo` can match a marker to a row. A
marker with no row, or a row no marker uses, fails the build.

The register was rebuilt by extracting every `O-nn` occurrence from the thirteen
architecture documents and resolving each to the **question** it names rather than to
the number. That is what found the collisions: six documents had each minted a local
`O-30 … O-4x` block beside the coordinated chain, so `O-33` alone carried six
different questions and the client would have answered a number whose answer landed
on the wrong feature. Fourteen questions turned out to be duplicates and were folded
into the number that already asks them. `docs/architecture/_review/o-nummern.md`
records the derivation. `O-02` and `O-03` are answered — see **D-11** and **D-09**.

### The client's own questions

| # | Question | Blocks |
|---|---|---|
| O-01 | Is **CSE Operations** a GmbH or a department? | invoice circle, Phase 1 |
| O-04 | The exact five billing types, and their rules — rounding, minimum unit, night and Sunday surcharges, call-off versus monthly flat | Phase 6 |
| O-05 | DATEV: Beraternummer, Mandantennummer per entity, SKR03/04, Sachkontenlänge, Steuerschlüssel, fiscal year start — **plus a real sample EXTF export** | Phase 7 |
| O-06 | Is there a **Betriebsrat**? §87 Abs. 1 Nr. 6 BetrVG governs geolocation, check-in audit trails, the APR-08 review-duration measurement and login metadata | geolocation capture, LEG-10 |
| O-07 | Which procurement platforms is the group registered on, under which identifier? | RAD-09 |
| O-08 | Separate domains per area, or one group domain? | Phase 2 |
| O-09 | Data volumes: objects, rooms, contracts, employees | migration planning |
| O-10 | Which social and job-board accounts exist, and who owns them? | Phase 9 |
| O-11 | Hosting promise: managed EU cloud, or self-hosted German server? | D-04 |
| O-12 | **Exact CSE red** from the official logo; SVG logos for all four brands | DESIGN §1 |
| O-13 | **Real photography** — crews, sites, completed projects, with releases | DESIGN §4, launch blocker |

### Raised by the PR plan · `08-PR-PLAN.md`

| # | Question | PRs |
|---|---|---|
| O-14 | Lead SLA: response deadline per area and channel, and the escalation target when it passes | 17, 82 |
| O-15 | Lead-scoring criteria and weights; tender-scoring weights and the RAD-08 notification threshold | 21, 70, 71 |
| O-16 | Gemeinkosten-, Wagnis- and Gewinnzuschlag per area; hourly charge-out rates per trade | 25 |
| O-17 | Leistungswerte per Belagsart — source, and who approves them | 23, 25 |
| O-18 | Arbeitszeitmodelle and their SV categories, Sollstunden basis, leave entitlement, overtime cap and expiry; the ArbZG 10-hour exception and its balancing period | 1, 32, 37, 38, 39, 67 |
| O-19 | Dunning: days overdue that start a run, number of levels and intervals, fee per level, interest basis (§288 BGB), and when Verzug begins | 55 |
| O-20 | Abschlagszahlungen: which VOB/B §16 terms apply; Sicherheits-/Gewährleistungseinbehalt percentage, release date, and replacement by a Bürgschaft | 50 |
| O-21 | §48 EStG: which Bagatellgrenze, at which date (Leistungsdatum or payment), and which customers count as Leistungsempfänger | 51 |
| O-22 | Leitweg-IDs per public client and the required transmission route (OZG-RE / ZRE / Landesportal / Peppol / e-mail) | 52 |
| O-23 | The §2 VOB/B basis list; VOB/C deduction and Übermessung rules per trade — automatic or manual | 43, 44 |
| O-24 | Handelsregister data, USt-IdNr. and bank details per entity | 26, 47 |
| O-25 | Retention period and legal basis per document category, beyond the GoBD ten years; and how long applicant documents are kept after a rejection | 9, 85 |
| O-26 | Monthly AI budget per entity and per agent | 74 |
| O-27 | Payroll export target system and format, per entity | 67 |
| O-28 | Which application mailbox is monitored, and who owns it | 85 |
| O-29 | Reklamation and Qualitätsprüfung: trigger, scale, pass threshold, and consequence | 40 |

### Raised by the architecture · one block per document

**`01-ORDNERSTRUKTUR.md`**

| # | Question | Where it bites |
|---|---|---|
| O-30 | Nachträge: how many days may an announced Nachtrag stay unsubmitted before the watchdog escalates, and to whom? | BAU-04 watchdog |
| O-31 | Certificates: at what intervals before a §34a / Sachkunde expiry does the warning escalate, and to whom at each step? | SEC-02, SEC-04 |
| O-32 | Sector minimum wage: which MiLoG / sector rates apply per area, and from which date? | LEG-02, TIM-13 |
| O-134 | `nummernkreis`: one circle per legal entity, or per entity **and** document type? Does the number run on or restart on 1 January, and what is the exact mask? | FIN-03, TEN-02, LEG-01 — **no invoice may be finalised anywhere until this is answered** |
| O-135 | Which processor extracts data from incoming invoices (OCR), in which region, under which DPA? | ACC-05, LEG-09, D-04 |

**`02-datenmodell/01-KERN.md`**

| # | Question | Where it bites |
|---|---|---|
| O-136 | Which sector wage agreement applies per entity (Gebäudereinigung RTV, Sicherheitsgewerbe Berlin, Bau), and is it tracked in the platform at all? | `anstellung.tarifvertrag` |
| O-137 | May one person hold two concurrent employments with the **same** entity — a main contract plus a marginal one? | `anstellung` uniqueness |
| O-138 | Are sick days during approved leave credited back to the Urlaubskonto automatically (§9 BUrlG), or only on presentation of the AU certificate? | `abwesenheit`, `urlaubskonto` |
| O-139 | Paid/unpaid status per absence type, the proof-required-from-day-N rule, and the payroll wage-type mapping for every `abwesenheitsart` and `bewegung_art` | ACC-12 export |
| O-140 | Is the §34a Unterrichtung/Sachkunde unbefristet, and what triggers a re-check — only the reliability-check interval? | the SEC-02 watchdog has nothing to warn on until this is answered |
| O-141 | Does the entity that first recorded a person keep read access once the person works exclusively for another entity, or does the anchor lapse? | `app.person_sichtbar()` |
| O-142 | Which further request types does the group run — unpaid leave, time off in lieu, shift handover, master-data change? | `antragsart` |
| O-143 | Is there a provisional state between open and locked on the Stundenkonto, and may a Zeit-Einwand be partially upheld? | both placeholder enum values |
| O-144 | Confirm the categories used for certificate reporting | `qualifikation_kategorie` |

**`02-datenmodell/02-CRM-OPERATIONS.md`**

| # | Question |
|---|---|
| O-53 | May one order carry positions billed in different ways at the same time? |
| O-54 | How is the service period derived per billing type — calendar month, per Leistungsnachweis, per Aufmaß? |
| O-55 | Which cleaning classes are used (DIN 77400, own scheme, per customer), and do they drive frequency, price or quality? |
| O-56 | How is a Turnus converted into a frequency factor? |
| O-57 | Is subcontracted work a cost type of its own beside the five of OPS-07? |
| O-58 | Must a Kalkulation exist before every offer is sent, or may catalogue and small orders go out without one? |
| O-59 | Time values and list prices per service — confirm or supply |
| O-60 | Do intra-Community supplies (§4 Nr. 1b UStG) or the §19 UStG small-business rule occur in any entity? |
| O-61 | Which fields does the offer-request form need for CSE Operations to be able to quote at all? |
| O-62 | Value lists for `gebaeudetyp`, `frequenz` and `gewerk` |
| O-63 | Is the privacy notice confirmed as a notice (Art. 6(1)(b)/(f)) or as consent? |
| O-64 | Does the lead score trigger any automatic decision (Art. 22 DSGVO)? |
| O-65 | Which communication counts as contractually necessary rather than advertising (§7 UWG)? |
| O-66 | Standard payment term per entity, and does it also apply to public clients? |
| O-67 | Is the §48b certificate held per customer, per order or per subcontractor — who records it, who checks it? |
| O-68 | Which warranty period is agreed — VOB/B §13 or BGB §634a — and from which event does it run? Does it vary per order? |
| O-69 | Controlled vocabulary for `gebaeudetyp`, or does it stay free text? |
| O-70 | A building served for two customers of the same entity: one `objekt` or two? |
| O-71 | Erasure concept (Art. 17): which personal data is anonymised, on which trigger? |
| O-72 | Are there projects without an order — internal or acquisition projects? |
| O-73 | Confirm the working vocabularies: `lead_status`, `lead_prioritaet`, `angebot_status`, `angebotsposition_typ`, `auftrag_art` and the rest |

**`02-datenmodell/03-GEWERKE.md`**

| # | Question |
|---|---|
| O-145 | A Turnus missed on a public holiday: brought forward, made up, or dropped? |
| O-146 | Is a missed Turnus credited against a monthly flat, and at what amount? |
| O-147 | Are Leistungsnachweise numbered gaplessly and sequentially, and from which step is the number assigned? |
| O-148 | Which Postenarten and which Schlüsselarten are kept? |
| O-149 | Which qualification is required for guard duties with no fixed post — events, floaters, short-notice cover? |
| O-150 | May a started night shift be finished when the §34a certificate expires at midnight? |
| O-151 | Which Wachbuch entries may the following shift see for the handover, and for what period? |
| O-152 | Does any client contract require presence proof per patrol, and in what form (NFC, QR, barcode)? |
| O-153 | Must a new version of a Dienstanweisung be re-acknowledged by everyone, or only on a material change — and who decides that? |
| O-154 | Do BGB construction contracts occur, or VOB/B only — and how does the site manager tell which regime applies? |
| O-155 | Which LV position types occur, and how does each enter the order total? |
| O-156 | Under what conditions is a one-sided Aufmaß billed (§14 Abs. 2 VOB/B)? |
| O-157 | Is a Bautagebuch kept per site or per construction section? |
| O-158 | From what threshold does weather count as work-impeding, per trade? |
| O-159 | Which trades are recorded in the Bautagebuch (STLB-Bau Leistungsbereiche)? |
| O-160 | Which table records material consumption, so FIN-07 gets its fourth source? |
| O-161 | Does recovering a key close the liability case once the lock change has been ordered? |

**`02-datenmodell/04-PLANUNG-ZEIT.md`**

| # | Slug | Question |
|---|---|---|
| O-39 | `zeit-freigabeschritt` | Is there a professional release of recorded time before the Stundenkonto and billing at all, and who grants it? **Until answered, `zeit.abrechnung_freigeben` is not seeded and the screen does not ship.** |
| O-93 | `zeit-checkin-kanal` | How does the check-in link reach the worker — SMS, e-mail, a QR code posted at the object, or a portal link — and who bears the SMS cost? |
| O-162 | `zeit-milog-aufbewahrungsbeginn` | When does the two-year retention of §17 Abs. 1 MiLoG start — the day worked, the day the record was created, or a month/year end? |
| O-163 | `zeit-dst-verguetung` | How are the two transition nights paid — by time actually worked (7 h / 9 h) or by planned shift length? |
| O-164 | `zeit-checkout-toleranz` | How long after the shift ends does the check-out link stay valid, and what happens when someone works substantially longer than planned? |
| O-165 | `zeit-nacherfassungsfrist` | Which internal deadline applies to late entry, below the statutory seven days (§17 Abs. 1 MiLoG), and who is notified when it passes? |
| O-166 | `zeit-konflikt-blockiert` | Which conflicts prevent saving and which only warn — overlap, ArbZG, qualification? |
| O-167 | `zeit-feiertage-bundesland` | Are shift posts and event duties staffed normally on public holidays, and does the group work at objects outside Berlin — in which Länder? Which source supplies the holiday list — and are 24 and 31 December treated as holidays by agreement? `src/lib/datum/feiertage-berlin.ts` records them with `gesetzlich = false` (§5.1) and skips no shift on them, because silently removing a planned shift is the direction §8.5 rules out |
| O-168 | `zeit-pausenerfassung` | Are breaks stamped (start/end) or entered as a per-shift total? |
| O-169 | `zeit-ohne-auftragsbezug` | Is there time without an order behind it — internal work, training, standby, travel — and how is it costed? |
| O-170 | `zeit-schichtfunktionen` | Which functions exist on a shift (Objektleiter, Vorarbeiter, Springer), and which states does an assignment need? |
| O-171 | `zeit-sonntagsarbeit` | Should the platform evidence Sunday and holiday work under §§9–13 ArbZG — the exemption per area and the substitute rest day? |
| O-172 | `zeit-betriebsrat-erweiterung` | **Extends O-06:** does §87 Abs. 1 Nr. 6 BetrVG cover device deviation, device fingerprint, no-show evaluation and correction statistics as well as geolocation? |
| O-173 | `zeit-korrekturgruende` | Which correction reasons should the evaluation distinguish? |

**`02-datenmodell/05-FINANZEN.md`**

| # | Question |
|---|---|
| O-174 | Confirm the mapping of your units of measure to the UN/ECE Rec 20 codes (BT-130) — `Stk` (H87 or C62), `pauschal` (LS), `Einsatz` |
| O-175 | Should §33 UStDV small-amount invoices be issued at all? Many commercial customers reject them |
| O-176 | §48 Abs. 2 EStG: which Bagatellgrenze per entity, how is the annual sum per supplier forecast, and who releases the withholding? |
| O-177 | Is Skonto granted, at what rate and term, and from what difference does an underpayment count as a Skonto deduction? |
| O-178 | Is a partial Storno admissible, or is every correction a full Storno with re-issue? |
| O-179 | May one time entry be split across two invoices (a month boundary inside a night shift), or does the shift's start period govern? |
| O-180 | Is material taken from stock and on-charged, or bought per order only? |
| O-181 | Who may release a collection handover or a Mahnbescheid, and from which level or amount? |
| O-182 | May a customer credit be set off against a liability to the same company as a supplier (§387 BGB), and who authorises it? |
| O-183 | Is a four-eyes release required for incoming invoices, from what amount, and who deputises? |
| O-184 | Does the construction entity self-bill subcontractors by Gutschrift (§14 Abs. 2 UStG) — generally or per contract? |
| O-185 | Are there expenses that may be booked without a receipt (Eigenbeleg), and up to what amount? |
| O-186 | Is an electronic register with TSE (§146a AO) used, or an open cash box with a Kassenbuch? |
| O-187 | Who files the §48a EStG Bauabzugsteuer return — accounting or the tax adviser — and should the platform only prepare, or also keep the deadline calendar? |
| O-188 | Who signs the Verfahrensdokumentation per entity, and at what interval is it reviewed? |
| O-189 | Will any of the three entities ever invoice, or receive invoices, in a currency other than EUR? |
| O-190 | Is the counter-signed Leistungsnachweis (CLN-04) kept as evidence behind a cleaning invoice line, in addition to the time entries? |
| O-358 | Who maintains the §247 BGB Basiszinssatz — accounting per entity or the group centrally — and should the watchdog notify a named person instead of only failing the run? |

**`02-datenmodell/06-RADAR-KI-INHALT.md`**

| # | Question |
|---|---|
| O-191 | Does a negative keyword or an excluding CPV drop the notice, or only cost it points? From what residual deadline is a notice not workable? |
| O-192 | By which features do a national and a TED notice count as the same procurement, and from what match may they be merged automatically? |
| O-193 | Are lots evaluated and bid individually, or always the whole notice? |
| O-194 | Catalogue of the documents required, per platform and procedure type |
| O-195 | From what share of the monthly budget should a warning fire; in which currency is the agent budget kept; and which source supplies the rate when the provider bills in USD? |
| O-196 | How many tool steps may an agent take per task before it stops and hands the case to a human? |
| O-197 | Below what confidence does an extracted field count as uncertain and force individual review? |
| O-198 | How long may an agent run's model inputs and outputs be kept, outside the GoBD-relevant finance area, before redaction? |
| O-199 | Which applicant details are collected — address, date of birth, nationality, driving licence — and which are necessary for the advertised work (Art. 5 DSGVO)? |
| O-200 | Binding status stages of the application process, employment types, and the status stages of a vacancy |
| O-201 | How are job requirements weighted against each other, on what scale? |
| O-202 | Which notifications go out by e-mail as well, by default? |
| O-203 | From what amount and what effect does a case count as *hoch*? The three risk levels depend on it |

**`03-AUTH-BERECHTIGUNGEN.md`**

| # | Slug | Question |
|---|---|---|
| O-74 | `auth-kunde-schreibrechte` | May a customer write in the portal at all — accept an offer with legal effect (OPS-09), report a Reklamation, send a message, upload a document? **Every customer write route is withheld until answered.** |
| O-75 | `auth-entgelt-leitung` | May a Leitung read the internal hourly cost rates of their own area, or is that reserved to Geschäftsführung and Buchhaltung? |
| O-76 | `auth-leitung-freigaben` | Which approvals and administrative acts may a Leitung or an Admin hold — releasing an incoming invoice, approving a booking, closing a period? |
| O-77 | `auth-storno-berechtigung` | Who may issue a Storno? Invariant 4 fixes the mechanism and says nothing about the authority |
| O-78 | `auth-wachbuch-kundensicht` | May a Wachbuch or Bautagebuch entry ever be shown to a customer? |
| O-79 | `auth-sitzungsdauer` | Session lifetimes per portal — idle and absolute — and the device-loss revocation process for worker phones |
| O-80 | `auth-sperrschwellen` | AUT-07: attempts per identity and per IP, the window, the lockout duration, automatic expiry or manual unlock, and whether the user is told |
| O-81 | `auth-missbrauchsschutz` | Anti-abuse on the public login and OTP endpoints without a third-party CAPTCHA (PUB-13) |
| O-82 | `auth-sms-anbieter` | Which EU-hosted SMS gateway delivers the OTP and the check-in link (DPA, D-04), and what monthly spend cap triggers a hard stop? |
| O-83 | `auth-2fa-wiederherstellung` | 2FA recovery: how many super_admin accounts, who holds each second factor, and what is the break-glass procedure? |
| O-84 | `auth-2fa-uebergangsfrist` | Grace period for 2FA enrolment on existing admin accounts, and what happens on expiry |
| O-85 | `auth-rollen-delegation` | Are roles beyond the five required, and may an Admin appoint another Admin, a Leitung a deputy? |
| O-86 | `auth-mobilnummer-vieraugen` | Should a second approver be required to re-bind a worker's mobile number? |
| O-87 | `auth-austritt-login` | On `austritt`, is the worker login disabled at once or kept for N days so the person can download their Stundennachweise (EMP-06)? |
| O-88 | `auth-doppelrolle-login` | Confirm the dual-role login path for someone who is both a manager and employed |
| O-89 | `auth-nachweis-gegenzeichnung` | Does the customer portal need a counter-signature flow for the Leistungsnachweis (CLN-04)? |
| O-90 | `auth-zweitfaktor-festschreibung` | Should finalisation, Storno or DATEV export require a second factor at the moment of the act? |
| O-91 | `auth-entwurf-kundensicht` | Do customers see finalised invoices only, or may a draft ever be visible? |
| O-92 | `auth-aufbewahrung-telemetrie` | Retention **and legal basis per data class**: auth events, the `audit_log` deletion concept, `anmeldeversuch` (30 days proposed), `sicherheitsvorfall`, and the `job_lauf` operations log |

**`04-SEITENKARTE.md`**

| # | Question |
|---|---|
| O-33 | Does CSE Operations sell to external customers at all? |
| O-34 | Legal review of the outbound matrix: which message classes may be sent on `anfrage`, on `bestandskunde` and on `einwilligung`; the exact §7 Abs. 3 Nr. 4 UWG opt-out wording |
| O-35 | Which mailbox receives security reports, and who monitors it? |
| O-36 | Which EU-hosted transactional e-mail sender delivers invitations, resets, offers, dunning and NOT-02 mail, under which DPA? |
| O-37 | Which wage basis applies per area and per activity — Gebäudereiniger tariff groups, Bau-Mindestlohn, the security agreement — and from which dates? |
| O-38 | One group career page with an area filter, or one per area? |
| O-40 | The Bewacherregister: exact Bewacher-ID format and check digit, the fields it requires, its status vocabulary, its notification events, and the binding list of §34a activity types |
| O-41 | In which format do Leistungsverzeichnisse arrive — GAEB DA XML (X83/X84), GAEB D8x, Excel, PDF? |
| O-42 | May an ArbZG conflict card name the other entity, given §87 BetrVG and data minimisation? |
| O-43 | When two entities employ one person, does one own certificate maintenance and the worker login, or may every employing entity edit them? |
| O-44 | Dunning presentation: how many levels, at what day offsets, with what fee and interest basis (§288 BGB)? |
| O-45 | Does the tax audit expect Z1 or Z2 access as well as Z3? |
| O-46 | Retention period and legal basis per data class where SPEC states none: planning data, shift media, check-in tokens, offline claims, discarded import rows, unused form submissions |
| O-47 | Which FX source and date apply to a foreign-currency tender value? |
| O-48 | Which FX source and date convert the provider's USD model billing into the EUR budget of AGT-05? |
| O-49 | Confirm that CSE Operations owns the group-level public pages |
| O-50 | Does a collective agreement impose break or rest rules stricter than the ArbZG for any trade, and from when? |
| O-51 | Must the EMP-06 monthly statement be issued in the employee's language, or is German the required form for a §17 MiLoG record? |
| O-52 | Does a company buying from two entities get one login with an entity filter, or one login per entity? |
| O-132 | `seiten-geo-anbieter` — which EU-hosted map tile and geocoding provider, under which DPA? |

**`05-API-KARTE.md`**

| # | Question |
|---|---|
| O-94 | Is a newsletter wanted at all? It needs a documented double opt-in and `rechtsgrundlage = 'einwilligung'` — no endpoint exists until then |
| O-95 | Were `bestandskunde` addresses obtained in a sale, and what counts as a "similar own service" (§7 Abs. 3 UWG)? |
| O-96 | May a customer accept an offer, counter-sign a Leistungsnachweis or open a complaint in the portal? |
| O-97 | Which LV exchange format do your clients send — GAEB DA XML 3.2, GAEB D83/D84, or Excel? |
| O-98 | Confirm the cleaning, security and construction CPV code lists against the official CPV list |
| O-99 | Unit-price precision below one cent — cleaning is routinely quoted in fractions of a cent per m² |
| O-100 | Which night-hours window and which surcharge apply per business area? |
| O-101 | For a 22:00–06:00 shift, are the hours attributed to the day the shift starts or split across both calendar days? |
| O-102 | Does any area apply the §5 Abs. 2 reduction of the rest period to 10 hours? |
| O-103 | §6 ArbZG night work with its own balancing period, and §9/§11 Sunday and holiday work |
| O-104 | Which §13b Abs. 2 categories does the group supply and receive, and how is a customer's status as a nachhaltig bauleistungserbringender Unternehmer evidenced (USt 1 TG)? |

**`06-AGENTEN-FREIGABEN.md`**

| # | Question |
|---|---|
| O-105 | Should an appointment confirmation to a customer be drafted automatically for approval, or only the internal calendar entry with no message? |
| O-106 | Which role or right must approve an offer above €20,000 — Geschäftsführung, Bereichsleitung, or both under four eyes? |
| O-107 | Which suitability and personnel certificates do the procurement bodies demand, and which certificate types does the group keep internally? |
| O-108 | How long should the objection window (APR-05) and the undo window (APR-06) be, per case type? |
| O-109 | Up to what absolute and relative deviation from the comparison document does a position count as routine and may be approved in a batch? |
| O-110 | May photographs of work sites — downscaled, faces obscured — be sent to an EU image endpoint, or does `motiv_plausibel` stay off permanently? |
| O-111 | From what median review duration, what approval rate and over how many decisions does a pattern count as rubber-stamping; from what open queue per role and what daily volume of new approvals should a warning fire; and who is told? |
| O-112 | How many working days of internal lead time does a Vergabemappe need before the official deadline? |
| O-113 | How is an Art. 15 / Art. 17 DSGVO request applied to agent protocols, knowledge chunks and approval snapshots when GoBD / §147 AO require retention? |
| O-114 | Does the tariff or surcharge group belong to the *identity* of an invoice line, or is it an attribute of the same line? |
| O-115 | Which sender mailboxes and which signature apply per entity for outgoing agent drafts? |
| O-133 | How many photographs, and of what, are mandatory per evidence type — Leistungsnachweis (CLN-04), Wachbuch entry (SEC-07), Bautagebuch (BAU-07), receipt (ACC-05), reference (PRO-05) — and from when does evidence count as incomplete? |
| O-204 | **Which of AGT-02's nine tools writes the REC-05 `shortlist` artefact?** No document of the set settles it. The ranking itself is deterministic code (`kandidat_bewertung.verfahren` is `CHECK`ed to `'deterministisch'`), so whatever writes the artefact renders a computed result and supplies no number of its own (K-10) — but the writer has no home in the tool surface today |

**`07-INTEGRATIONEN.md`**

| # | Slug | Question |
|---|---|---|
| O-116 | `int-mail-versanddienst` | Which EU-hosted e-mail service sends transactional messages, and which verified sender domain and address apply per entity? |
| O-117 | `int-postfach-loeschrecht` | Who triages an application sent to none of the four addresses, and may the platform delete messages from the mailbox after intake? |
| O-118 | `int-betriebsueberwachung` | Which error-tracking, uptime-monitoring and log-forwarding services are approved (EU region, DPA), or should self-hosted alternatives be run? |
| O-119 | `int-sicherungsziel` | Where do the independent encrypted backups live, what retention applies, who holds the private key, and who supplies it for the monthly restore test? |
| O-120 | `int-camt-bezugsweg` | How do CAMT.053 files reach the platform — upload or SFTP — which banks, and which IBAN per entity? |
| O-121 | `int-ki-eu-ersatz` | When no model with EU processing and zero retention is offered for a needed capability: leave it switched off, or add an alternative EU-hosted provider to the stack? |
| O-122 | `int-geokodierung` | Should an object's address be resolved to coordinates automatically, and with which EU-hosted or self-run service? |
| O-123 | `int-n8n-betrieb` | Is n8n self-hosted (where, by whom) or run as an EU cloud instance, is there a DPA, and which external tools should be connected? |
| O-124 | `int-belegtransfer` | How should receipts reach the tax adviser — DATEV Unternehmen online / Belegtransfer, or a ZIP beside the EXTF file? |
| O-125 | `int-systemnachricht-vorabfreigabe` | System messages go out over a mechanism separate from the agent path — confirm the wording and the pre-approval |
| O-126 | `int-aufrufprotokoll-aufbewahrung` | How long may the integrations' call logs be kept before automatic deletion? |
| O-127 | `int-anhang-schadsoftware` | Should incoming attachments be scanned for malware, and with which EU-hosted service? |
| O-128 | `int-altsystem-export` | In which format can Aplano, Lexware and the existing Excel files be exported, which period is migrated, and must the historical data be archived GoBD-compliant? |
| O-129 | `int-datev-periodensperre` | Does a completed DATEV export lock the period against new bookings, or do late entries go into the next open period? |
| O-130 | `int-48b-bescheinigung` | Does each entity hold a valid §48b EStG exemption certificate, for what term, and who renews it? |
| O-131 | `int-kundenpostfach` | Should incoming customer correspondence be taken into the history automatically, from a mailbox per entity, or does capture stay manual? |

### Raised while building · Phase 2

| # | Question | Blocks |
|---|---|---|
| O-205 | **Barrierefreiheitserklärung (BFSG):** which conformity status may be declared — fully, partially or not conformant — on the basis of which audit and dated when; which body is named as the enforcement authority; and which mailbox receives accessibility feedback? Until these three are answered the statement at `/barrierefreiheit` carries a visible "not yet issued" block rather than an invented claim. | LEG-07, launch |
| O-207 | **Seitentexte:** every page currently carries scaffold copy — a factual description of what each company does, drawn from the trade names already recorded in `CLAUDE.md`, with no figures, awards, customer names or promises. The client must read and correct it, in particular anything that reads as a commitment to a customer: a marketing sentence nobody checked ends up quoted in an offer. | all 14 public pages, launch |
| O-208 | **Gemeinkosten, Wagnis und Gewinn im Angebot: eigene Positionen oder im Einzelpreis?** Die Kalkulation rechnet Lohn → Gemeinkosten → Wagnis → Gewinn; der Nettopreis ist die Summe der vier. Was der Kunde im Dokument liest, ist damit noch nicht entschieden: entweder drei zusaetzliche Zeilen, die die Zuschlaege offenlegen, oder — wie derzeit — Leistungszeilen, deren Einzelpreis den Anteil bereits enthaelt und deren Langtext ihn benennt. Beides ist in der Gebaeudereinigung ueblich; die Wahl ist eine kaufmaennische und keine technische. Die Verteilung selbst liegt in `verteileNetto` an EINER Stelle, damit ein Wechsel eine Aenderung bleibt und keine Umbauaktion. | OPS-07, OPS-08, jedes Angebot |
| O-209 | **Macht eine Abwesenheit in einer Gesellschaft die Person auch in der anderen unverfügbar?** Ein Mensch mit zwei Beschäftigungen (D-09) meldet sich heute zweimal ab — zwei Vorgesetzte, zwei Entscheidungen, zwei Lohnwirkungen. Ob die Planung der einen Gesellschaft sehen soll, dass die Person in der anderen abgemeldet ist, ist damit **nicht** entschieden: es wäre eine zweite Durchlässigkeit in der Mandantenwand, und K-06 lässt ausdrücklich genau eine zu (die ArbZG-Belastung). Technisch wäre der Weg derselbe — eine Definer-Funktion, die nur Zeiträume und ein „nicht verfügbar" zurückgibt, nie den Grund. Die Frage ist keine technische: sie braucht eine Rechtsgrundlage und die Zustimmung der Betroffenen, weil eine Krankmeldung ein Gesundheitsdatum ist (Art. 9 DSGVO). Bis dahin gilt: jede Gesellschaft sieht nur ihre eigenen Abwesenheiten. | EMP-10, K-06, LEG-09, `abwesenheit` |
| O-220 | **Darf die Personalstelle einer Gesellschaft sehen, dass ein Mensch zusätzlich bei einer Schwestergesellschaft beschäftigt ist?** Die Seitenkarte führt auf `personal/personen/[id]` „die Liste der Beschäftigungen nach Gesellschaftsnamen“; technisch ginge das nur über eine zweite Definer-Funktion durch die Mandantenwand, und K-06 lässt ausdrücklich genau eine zu (die ArbZG-Belastung). Die Frage ist dieselbe wie in O-209 und ebenso wenig technisch: sie braucht eine Rechtsgrundlage (§ 26 BDSG, gemeinsame Verantwortlichkeit) und eine Entscheidung darüber, ob der bloße Name der Gesellschaft genügt oder ob Zeitraum und Umfang dazugehören. Bis dahin zeigt die Seite nur die Beschäftigungen des aktiven Bereichs — und sagt hin, dass sie es tut. | D-09, K-06, `personal/personen/[id]` |
| O-213 | **Welche drei Beobachtungszeitpunkte gelten im Bautagebuch als früh, mittag und abend — und welches DWD-Produkt ist dafür maßgeblich (Zehnminuten-, Stunden- oder Tageswerte)?** Ein Bautagebuch hält das Wetter üblicherweise dreimal am Tag fest; welche Uhrzeiten das sind, ist eine Frage der Bauleitung und keine des Adapters. Bis zur Antwort heftet der Dienst an, was er von DWD Open Data bekommt — mit Beobachtungszeit und Station — und ordnet **keine** Messung einer Tageszeit zu. Eine geratene Zuordnung stünde später in einem Bautagebuch, das vor Gericht als Beweismittel dient. | BAU-07, BAU-08, `bautagebuch`, `wetter_beobachtung` |
| O-210 | **Gilt bei einem Veranstaltungsdienst die vereinbarte Stärke zugleich als Mindestbesetzung?** SEC-08 nennt für einen Eventdienst eine Sollbesetzung (`veranstaltung.soll_besetzung`) und keine Untergrenze. Der Posten hat beides, und der Unterschied ist folgenreich: die Mindestbesetzung ist die Zahl, an der die Dringlichkeitsmeldung und die Veröffentlichungssperre hängen. Eine Veranstaltung mit `min = soll` meldet jede unvollständig besetzte Feier als dringend; mit `min = 1` meldet sie keine. Die Eventschicht entsteht deshalb mit dem Spaltenvorgabewert 1, und kein Dienst leitet daraus etwas ab, bis die Frage beantwortet ist (K-17). | SEC-08, `posten_unterbesetzung`, SPEC §14 |
| O-211 | **Wie weit im Voraus sieht eine Wache die Kontrollpunkte und die Dienstanweisung ihres nächsten Objekts — und wie lange nach der letzten Schicht noch?** `03-GEWERKE.md` §1.10 nennt ein „SEC-06 lookahead window", und kein Dokument nennt seine Länge. `app.eigene_einsatz_objekte()` zieht die Grenze deshalb aus den Daten statt aus einer erfundenen Zahl: ein Einsatz, der noch nicht zu Ende ist. Die Wache sieht damit ihr laufendes und ihr kommendes Objekt und verliert den Zugriff, sobald die letzte Schicht vorbei ist. Eine Antwort verschiebt genau eine Bedingung in dieser Funktion. | SEC-05, SEC-06, EMP-09, `kontrollpunkt`, `posten` |
| O-206 | **Is "CSE Gruppe" a legal entity?** Does a group-level Rechtsträger (holding) exist — under which name, address and register entry — or is the group only a brand over four independent companies? A structured-data `Organization` block carries an address and therefore asserts that such a company exists; until this is answered the site emits four complete `LocalBusiness` entries and no umbrella. | PUB-11, `/impressum`, footer |
| O-280 | **Ab welcher Abweichung gilt der Mannstundenabgleich als auffällig — und ist überhaupt eine Toleranz gewollt?** BAU-07 verlangt, dass die Mannstunden je Gewerk gegen `zeiteintrag` desselben Tages und derselben Baustelle gehalten werden und eine Abweichung **gemeldet** wird. Wie groß eine Differenz sein darf, bevor jemand ihr nachgeht, ist eine Entscheidung der Bauleitung und keine technische: eine Toleranz, die niemand beschlossen hat, verschweigt ab dem ersten Tag genau die Fälle, wegen derer der Abgleich existiert. Bis zur Antwort meldet `gleicheMannstundenAb` **jede** Differenz ab einer Minute und glättet keine; ein Schwellenwert wäre eine Zeile in genau dieser Funktion. | BAU-07, TIM-12, `bautagebuch_mannstunden`, `zeiteintrag` |
| O-281 | **Zählen die Mannstunden im Bautagebuch die Anwesenheit auf der Baustelle (brutto) oder die Arbeitszeit ohne Pausen (netto)?** `bautagebuch_mannstunden.dauer_minuten` ist laut `03-GEWERKE.md` §7.13 eine *gemessene* Dauer und sagt nicht, ob die Pause darin steckt; `zeiteintrag` führt beides getrennt (`dauer_brutto_minuten`, `dauer_netto_minuten`). Solange die Frage offen ist, ist jeder Abgleich um die Pausenzeit einer Kolonne verschoben — bei acht Leuten und 30 Minuten sind das vier Mannstunden am Tag, also genau die Größenordnung, die der Abgleich finden soll. Verglichen wird derzeit gegen `dauer_netto_minuten`, und die Tagesseite sagt es sichtbar dazu. | BAU-07, TIM-12, `bautagebuch_mannstunden`, `zeiteintrag` |
| O-282 | **Soll die Zeiterfassung das Gewerk mitführen, damit der Abgleich je Gewerk statt nur in der Tagessumme laufen kann?** `zeiteintrag` trägt `objekt_id`, `revier_id`, `posten_id` und `projekt_id`, aber kein `gewerk_id` — ein Abgleich je Gewerk ist damit heute unmöglich, und die Seite hält die Summe der eigenen Stunden gegen die Tagesnettozeit der Baustelle. Das ist ehrlich, aber gröber, als BAU-07 („Mannstunden per trade") nahelegt: eine Verschiebung zwischen zwei Gewerken desselben Tages fällt nicht auf. Die Antwort ist keine technische — sie entscheidet, ob die Kolonne beim Einstempeln ein Gewerk wählen muss. | BAU-07, TIM-12, `zeiteintrag`, `gewerk` |

---

O-02 has been answered — see **D-11**. O-03 has been answered — see **D-09**; the
`person` / `anstellung` split is confirmed and must be in the schema from the first
migration.

---

## Entschieden in PR 41 — Security A (Posten, Wachbuch, Eventbesetzung)

Diese sechs Entscheidungen loesen Widersprueche zwischen den Vorgabedokumenten
oder halten eine Stelle fest, an der die Umsetzung vom Wortlaut abweicht. Sie
stehen hier, weil die naechste Person sonst dieselbe Stelle noch einmal
entscheidet — und moeglicherweise anders.

### D-166 · `posten` bekommt die Einsatzdecke, nicht die Interndecke

`03-GEWERKE.md` §1.8 widerspricht sich: die Deckentabelle gibt `posten` die
reine `p_intern_ceiling`, die Tabelle der Subjektumfaenge zwei Absaetze weiter
fuehrt `posten` unter `t_person` mit `ist_eingesetzt_auf_objekt(objekt_id)`.
Beides zusammen ist unmoeglich — `portal() = 'intern'` ist RESTRICTIVE, wird
also mit der `t_person`-Policy UND-verknuepft, und die Wache laese im eigenen
Portal null Zeilen, ohne Fehler.

Aufgeloest gilt die vierte Variante, `p_intern_einsatz_ceiling`, wie bei
`kontrollpunkt`. §1.8 nennt die Regel selbst, an der das zu entscheiden ist
(die Bauprobe verlangt, dass Deckenliste und `t_person`-Liste Tabelle fuer
Tabelle uebereinstimmen), und §6.1 traegt nur diese Lesart: dass eine Wache
„die Art ihres eigenen Postens" sieht, ist wertlos, wenn ihr der Posten selbst
verschlossen ist. Umgesetzt in `0069`.

### D-167 · Die kanonische Wachbuch-Nutzlast ist ein ARRAY, kein JCS-Objekt

`03-GEWERKE.md` §6.12 verlangt „JCS-canonical JSON" ueber achtzehn benannte
Felder. JCS ordnet Objektschluessel nach UTF-16-Codeeinheiten; PostgreSQLs
`jsonb` ordnet sie nach LAENGE und dann nach Bytes. Ein `jsonb_build_object`
liefert also nicht JCS — und die Abweichung faellt niemandem auf, weil beide
Fassungen wie kanonisches JSON aussehen, bis zwei Implementierungen verglichen
werden.

`kern.wachbuch_nutzlast` baut deshalb ein `json_build_array` in der vom
Dokument aufgezaehlten REIHENFOLGE: ein Array hat keine Schluessel, die jemand
sortieren koennte. Dieselbe Eigenschaft, ohne die Falle. Sie ist die EINZIGE
Fassung — der Einfuegeausloeser und `app.wachbuch_kette_pruefen` rufen beide
sie, und der Dienst rechnet nichts nach.

### D-168 · Der Wachbuchzaehler entsteht im Ausloeser, und er ist kein Platzhalter

`wachbuch_eintrag.laufnummer` kommt aus `nummernkreis` je
`(mandant, 'wachbuch', objekt, jahr)` (§2.3 Nr. 4). Auf `nummernkreis` haelt
`cse_app` weder ein INSERT-Recht noch eine INSERT-Policy (`0006`), und der Seed
legt Wachbuchkreise nicht an — ein neues Objekt haette also nie einen ersten
Wachbucheintrag. `kern.wachbuch_eintrag_vorbereiten` ist deshalb
`security definer` und legt den fehlenden Kreis an; was der Definer darf, steht
als Policy und Spalten-Grant in `0070` und ist auf `kreis_typ = 'wachbuch'`
begrenzt.

Der Kreis traegt `ist_platzhalter = false`, und das ist keine Umgehung von
O-134: bestaetigt wird nur, was ohnehin feststeht — der Geltungsbereich und die
jaehrliche Ruecksetzung, beide von §6.12 vorgegeben. Die `format_maske` ist die
einzige geratene Angabe, und sie rendert nirgends: `wachbuch_eintrag` speichert
`jahr` und `laufnummer` als Zahlen, und die Anzeige `2026/0001` bildet der
Dienst an einer Stelle. O-134 betrifft die RECHNUNGSnummer und bleibt offen.

### D-169 · Der Kettenpruefindex traegt `jahr` vor `laufnummer`

§6.12 nennt `wachbuch_kettenpruef_idx on (mandant_id, objekt_id, laufnummer desc)`
— das kann die Kette nicht ordnen. Dieselbe Stelle sagt zwei Absaetze weiter
oben, dass die Kette am 1. Januar ausdruecklich DURCHLAEUFT, waehrend
`laufnummer` wieder bei 1 beginnt. Nach Laufnummer allein sortiert stuende der
erste Eintrag des neuen Jahres vor dem letzten des alten, und der Pruefer
meldete jeden Jahreswechsel als Bruch. Der Index heisst deshalb
`(mandant_id, objekt_id, jahr desc, laufnummer desc)`.

### D-170 · Der `veranstaltung`-Zweig von `app.planungsbedarf` bleibt leer

`0029` hat fuer PR 41 zwei `where false`-Zweige hinterlassen. Gefuellt wird nur
`posten`. Eine Veranstaltung ist EIN Fenster ohne RRULE, und der Generator
zaehlt Regeln auf; sie in den Nachtlauf zu haengen hiesse, ihm eine Zeile ohne
Regel zu geben und zu hoffen, dass er sie versteht. SEC-08 laeuft stattdessen
ueber `services/security/eventbesetzung.ts`, der die Schicht SOFORT anlegt —
kurzfristig heisst kurzfristig, nicht „heute Nacht um drei".

### D-171 · Ein Eventdienst ohne hinterlegtes Objekt laesst sich nicht besetzen

`veranstaltung.objekt_id` ist nullbar (§6.5: ein Veranstaltungsort existiert
oft, bevor es eine Objektakte gibt), `einsatz.objekt_id` dagegen NOT NULL
(`0028`) — die Kundendecke, der Check-in und die Medien haengen daran. Der
Dienst weist die Besetzung deshalb mit einer benannten Meldung ab, statt eine
Objektzeile zu erfinden. Die Oberflaeche sagt, was zu tun ist: den Ort als
Objekt anlegen und der Veranstaltung zuordnen.

### D-180 · `Σ revier_raum.sollzeit_minuten` ist kein Vergleich, sondern eine Konstruktion

K-16(c) erlaubt zwei Träger derselben Zielzeit auf derselben Skala, damit die
OPS-07-Rechnung zwischen ihnen nicht zweimal rundet. „Nicht zweimal runden" ist
aber keine Prüfung, die man nachträglich anstellt — es ist eine Reihenfolge:

 1. Die Räume werden nach BELAGSART gruppiert, weil PR 25 so gruppiert.
 2. Je Gruppe EINMAL `sekundenJeDurchgang` aus `kalkulation/richtzeit.ts` —
    das ist die einzige Rundung des ganzen Wegs.
 3. Die Summe wird EINMAL in Hundertstelminuten umgerechnet; das ist die
    Speichergenauigkeit von `numeric(8,2)`.
 4. Die Räume bekommen ihre Anteile durch VERTEILUNG dieser Summe nach
    grösstem Rest — nicht durch eine eigene Rundung.

Damit gilt `Σ Räume = Kopf` exakt und konstruktiv. Die naive Fassung — jeden
Raum einzeln runden und summieren — liegt regelmässig daneben, und
`tests/kern/reinigung-sollzeit.test.ts` weist beide Wege gegeneinander nach,
damit die Zusage nicht leer ist.

### D-181 · Der Schnappschuss wird kanonisiert, und Zahlen sind darin verboten

`snapshot_hash` soll sich NACH dem Zurücklesen aus `jsonb` nachrechnen lassen —
sonst beweist er nichts. `jsonb` sortiert Schlüssel um, also läuft der Digest
über eine kanonische Form: Schlüssel nach Codepunkten sortiert, kein Whitespace.

Das ist ausdrücklich NICHT RFC 8785: JCS schreibt für Zahlen die
Double-Ausgabe nach ECMAScript vor, und damit liefe jeder Cent-Betrag durch
eine Gleitkommazahl — Invariante 1, gebrochen an der Stelle, an der es niemand
sucht. Im Abzug sind deshalb alle Werte Zeichenketten, und `kanonischesJson`
wirft bei einer `number`, statt sie stillschweigend zu formatieren.

Zusatz aus dem Betrieb: `postgres.js` liefert eine `jsonb`-Spalte je nach
Abfrageweg als geparstes Objekt ODER als rohen Text. `alsSchnappschuss()` fängt
beides ab; ohne diese Stelle ergaben zwei Lesewege zwei Digests für dieselben
Daten.

### D-182 · Unterschrieben wird gegen eine Prüfsumme, nicht gegen einen Zeitpunkt

CLN-04 verlangt „einen Schnappschuss der Positionen genau wie angezeigt".
Zwischen dem Aufbau des Bildschirms und dem Fingerdruck auf dem Tablet liegen
Minuten, in denen das Büro eine Zeile korrigieren kann. Der Ablauf ist deshalb
zweistufig: `bereiteUnterschriftVor` liefert den Abzug samt Digest,
`signiere` baut ihn neu und schreibt nur bei Gleichheit. Weicht er ab, wird
NICHTS geschrieben (`AnzeigeVeraltet`, HTTP 409).

### D-183 · Eine Revierzuordnung lässt sich nicht lösen — und das ist eine offene Frage

`03-GEWERKE.md` §5.2 gibt `revier_raum` weder `archiviert_am` noch
`storniert_am` und §13.1 legt `kern.verhindere_loeschung()` auf **jede** Tabelle
der Domäne. Zusammen heisst das: ein einmal zugeordneter Raum bleibt in seiner
Zone. `setzeRaeume` ist deshalb ADDITIV und wirft `RaumNichtEntfernbar`, statt
eine Spalte zu erfinden, die kein Dokument beschreibt (K-17); die Oberfläche
zeigt bereits zugeordnete Räume gesetzt und gesperrt.

Wie eine Zone im Betrieb neu zugeschnitten wird, beantwortet keine Quelle. Der
einzige beschriebene Weg ist: Revier archivieren, neues anlegen. Das gehört in
die nächste DECISIONS-Runde — als erfundene Spalte wäre es schlechter.

### D-184 · `kern.ln_kopfstatus_fortschreiben()` ist `security definer`

`leistungsnachweis_signatur` hält für `cse_app` keinen UPDATE-Grant und keine
UPDATE-Policy: §5.8 macht sie anfügend, und das ist die Zusage. Der Auslöser,
der den Kopfzustand auf die Kinder fortschreibt, lief damit unter der Rolle des
Schreibenden in „permission denied" — bei JEDER Unterschrift, weil die Sperre
des Kopfes die Fortschreibung auslöst. Er ist deshalb `security definer` mit
wörtlichem `search_path` (dieselbe Bauart wie
`kern.einsatz_medien_bezug_pruefen()` in 0041) und schreibt ausschliesslich die
drei Kopfzustandsspalten auf Kinder desselben Kopfes.

### D-185 · `reklamation.nummer` und `qualitaetspruefung.nummer` kommen aus keinem Nummernkreis

`nummernkreis_typ` (0006) ist ein geschlossener Aufzählungstyp und führt beide
nicht; `03-GEWERKE.md` §8.2/§8.3 verlangt `nummer text not null unique`, mehr
nicht. Den Typ zu erweitern hiesse, eine Lückenlosigkeit zu behaupten, die
niemand verlangt — FIN-03 fordert sie für Rechnungen. Vergeben wird deshalb
`RK-<Jahr>-<0001>` bzw. `QP-<Jahr>-<0001>` im Dienst, mit dem eindeutigen Index
als Schranke. Das Jahr kommt als Berliner Kalenderjahr aus der Datenbank, nicht
aus `new Date()` im Node-Prozess (K-11).

### D-186 · Fünf Statuspillen fehlen DESIGN §5 — abgebildet statt erfunden

`03-GEWERKE.md` §3.5 beantragt für DESIGN §5 fünf neue Pillen: **Signiert**,
**Storniert**, **Behoben**, **Geschlossen** und **Unbestätigter Wert**. Weder
`docs/DESIGN.md` noch `src/components/ui/StatusPill.tsx` gehören zum
Änderungsbereich dieses PRs, und eine halbe Umsetzung (DESIGN geändert, Code
nicht) liesse beide auseinanderlaufen.

Die Reinigungs- und Qualitätsbildschirme bilden deshalb auf das vorhandene
geschlossene Vokabular ab: `signiert` → *Abgeschlossen*, `storniert` →
*Archiviert*, `behoben` → *Bereit*, `geschlossen` → *Abgeschlossen*. Der Antrag
aus §3.5 bleibt offen und ist mit DESIGN.md und `StatusPill.tsx` in EINEM
Schritt nachzuholen.

### D-190 · Das Aufmaß-Ergebnis ist eine ganze Zahl, `menge` ist ihre Projektion

`03-GEWERKE.md` §7.7 führt `aufmass_zeile.menge` als `numeric(12,3)`. PR 43
verlangt zusätzlich, das Ergebnis **in fester Skala als ganze Zahl** zu
speichern. Beides nebeneinander wäre zweimal dieselbe Zahl mit zwei
Rundungen — und im Streitfall zwei Antworten auf die Frage, was abgerechnet
wurde.

Entschieden: `ergebnis_skaliert bigint` in **10⁻⁴ der Einheit** (bei m²
Quadratzentimeter, `30,87 m² = 308700`) ist der massgebliche Wert. Der Parser
rundet **genau einmal**, aus dem exakten Ergebnis, kaufmännisch. `menge` ist
die **Projektion** dieser Zahl auf drei Stellen, und die Datenbank rechnet das
nach (`az_menge_projektion`). Eine zweite, unabhängige Rundung aus der Formel
gibt es nicht.

### D-191 · `projekt` entsteht in PR 43, nicht in PR 27

Der PR-Plan legt `projekt` in PR 27 an (`0032_auftrag_projekt`). Im Baum steht
`auftrag` (0025) mit Bauspalten, die Erweiterungstabelle fehlt — und mit ihr
die zwei Fremdschlüssel, die `0028` und `0034` wörtlich hinterlegt und auf sie
vertagt haben (`einsatz_projekt_fk`, `z_projekt_fk`).

`lv_position` und `aufmass` hängen beide an `projekt_id`; ohne die Tabelle
bliebe es eine Spalte ohne Fremdschlüssel, also genau die Lücke, durch die eine
Schicht der Reinigung an einem Bauprojekt der Security hängt. `0071` legt
`projekt` nach §7.1 an (`auftrag_id NOT NULL UNIQUE` — das Projekt IST der
Auftrag) und trägt beide aufgeschobenen Fremdschlüssel nach.

### D-192 · Messfotos fahren im vorhandenen privaten Bucket, mit eigener Bezugsart

`03-GEWERKE.md` §7.8 lässt `aufmass_foto.medien_id` auf `medien` zeigen. In
diesem Baum ist `medien` die **Website-Ablage** (Alt-Text, Platzhalterflag);
der private Bucket mit Magic-Byte-Prüfung, EXIF-Entfernung und ausschliesslich
signierten Adressen ist `einsatz_medien` (0041) — dieselbe Tabelle, die PR 40
für die Unterschrift des Leistungsnachweises benutzt.

`0072` erweitert deshalb das geschlossene Bezugsregister von 0041 um
`aufmass` (Modul `bau`, `kunde_pfad = 'kunde_id'`) — die Erweiterung, die 0041
§14 ausdrücklich vorsieht — und legt zwei **permissive** Policies auf
`einsatz_medien` an, eingeschnürt auf `bezug_tabelle = 'aufmass'`. Ohne sie
scheiterte das Anhängen eines Messfotos daran, dass `t_mandant` dort
`zeit.schreiben` verlangt, und eine Bauleitung hält kein Zeitrecht: BAU-03 wäre
nicht erfüllbar. Die restriktiven Decken von 0041 gelten unverändert darüber.

### D-193 · Die OZ-Ordnung steht zweimal — und wird deshalb verglichen

Die Datenbank sortiert (`order by sortier_pfad`), die Oberfläche gruppiert
(`baueOzBaum`). Beide brauchen dieselbe Normierung von `1.2.10` zu
`000001.000002.000010`, und eine gemeinsame Umsetzung gibt es nicht: die eine
ist SQL, die andere TypeScript.

Statt die Doppelung zu verstecken, wird sie geprüft:
`tests/isolation/bau-lv.test.ts` vergleicht `kern.oz_sortierschluessel` mit
`ozSortierSchluessel` zeichenweise an vierzehn Eingaben. Die erste Fassung ging
bei der leeren OZ auseinander (`string_to_array('', '.')` ist in Postgres ein
leeres Feld, `''.split('.')` in JavaScript ein Segment) — gefunden hat es genau
dieser Vergleich.

### D-194 · Stufenbreite 6 im Sortierpfad

`sortier_pfad` füllt jede OZ-Stufe auf sechs Stellen. GAEB-Ordnungszahlmasken
sind in der Praxis zwei- bis vierstellig je Stufe; sechs lässt Luft, ohne den
Pfad unlesbar zu machen. Eine Stufe über 999.999 sortiert hinter alles andere —
das fällt auf, statt still falsch zu sein. Die Zahl steht an zwei Stellen
(`OZ_BREITE`, `kern.oz_sortierschluessel`) und wird von D-193 verglichen.


---

## Befund aus der Integration — D-300

### D-300 · 95 von 98 `SECURITY DEFINER`-Funktionen gehören dem Superuser, nicht `cse_definer`

**Gemessen, nicht vermutet.** `00-KONVENTIONEN.md` K-01 sagt zwei Dinge:
„`SECURITY DEFINER` functions are owned by `cse_definer`" und „no application
role holds `BYPASSRLS`". Das zweite stimmt — keine der sechs Anwendungsrollen
hält es. Das erste stimmte für **drei** von 98 Funktionen
(`app.abwesenheit_grund_lesen`, `fin.rechnung_nummer_ziehen`,
`fin.rechnung_kette_schreiben`); die übrigen 95 gehören `postgres`, dem Konto,
das die Migrationen ausführt — Superuser, `BYPASSRLS`.

Eine `SECURITY DEFINER`-Funktion läuft mit den Rechten **ihres Eigentümers**.
Diese 95 laufen damit an jeder RLS vorbei und mit vollem Zugriff auf jede
Tabelle. Die sorgfältig geschriebenen `cse_definer`-Policies — `n_definer`,
`q_definer`, `aa_definer`, `sk_definer_lesen`, `z_definer_insert` und ein
Dutzend weitere — werden nie erreicht. Sie stehen da wie eine zweite
Verteidigungslinie, und es gibt sie nicht.

**Warum es nicht auffiel:** es geht nichts kaputt. Es funktioniert genau so
lange gut, bis eine vergessene `mandant_id` in einer `where`-Klausel nicht an
einer Policy scheitert, sondern liest, was sie greifen kann.

**Warum die Reparatur nicht in diesem Commit steht.** Sie wurde ausprobiert:
`alter function … owner to cse_definer` über alle 98 ist eine Schleife und
läuft sauber durch. Danach fehlen `cse_definer` Schreibrechte auf **32
Tabellen** (der Seed bricht an der ersten ab: `permission denied for table
audit_log`), und das ist die leichtere Hälfte. Die teurere: jede **lesende**
Stelle in einer Definer-Funktion braucht eine `cse_definer`-Policy auf der
gelesenen Tabelle — sonst liest die Funktion unter FORCE RLS stillschweigend
null Zeilen und schreibt einen falschen Wert, **ohne Fehlermeldung**. Das ist
Arbeit je Funktion, mit Urteil je Funktion, und sie gehört in eine eigene
Prüfrunde mit eigener Abnahme — nicht zwischen zwei Gewerke-PRs, wo sie den
Baum tagelang rot hielte.

**Was stattdessen jetzt gilt (Sperrklinke):**
`tests/isolation/definer-eigentum.test.ts` friert die 95 als benannte Altlast
ein. Jede **neue** Definer-Funktion muss `alter function … owner to
cse_definer` in ihrer Migration mitbringen, sonst fällt der Test. Und die
Liste veraltet nicht still: wer eine alte repariert und sie stehen lässt,
bringt den Test ebenfalls zu Fall. Die Schuld ist damit benannt, gedeckelt und
sichtbar — statt in einer Konvention zu stehen, die nicht gilt.

Die zweite Hälfte von K-01 ist übrigens erfüllt: **alle 98** Funktionen setzen
ihren `search_path`. Auch das prüft die Datei jetzt.

**Nachtrag, Phase-5-Abschluss: die Zahl „95 von 98" ist der Stand des Befundes
und nicht mehr der Stand der Datenbank.** In `cse_p5` (migriert bis `0091`)
tragen **94 von 99** Definer-Funktionen `postgres` als Eigentümer, fünf
gehören `cse_definer`; mit `0095` sind es 94 von 100 und sechs. Die Altlast ist
um genau eine geschrumpft — `kern.checkin_token_widerrufen`, die `0091`
umgehängt hat —, und `ALTLAST` in `tests/isolation/definer-eigentum.test.ts`
führt sie seither nicht mehr. Wer eine Zahl braucht, nimmt sie aus dieser
Datei und nicht von hier: sie ist die Sperrklinke, dieser Absatz ist die
Begründung. Ein Text, der die Zahl mitführt, wird bei jeder reparierten
Funktion falsch — und eine falsche Zahl an dieser Stelle liest sich wie eine
zweite Messung, die der ersten widerspricht.

---

## Entschieden in PR 39 — Mitarbeiterportal (Stunden, Monatsnachweis, Nachweise, Anträge, vier Sprachen)

Die Nummern beginnen bei **D-200** und nicht bei D-195: an diesem Branch
arbeiten mehrere Sitzungen gleichzeitig, und eine Lücke im Register ist
harmloser als zwei Entscheidungen unter derselben Nummer.

### D-200 · Die Kopfzahl des Portals folgt der Regel des Stundenkontos, nicht einer eigenen

EMP-03 verlangt „Hours today · this week · **month total**". Die naheliegende
Rechnung ist „ein Zeiteintrag zählt ganz auf den Tag seines Beginns". Sie ist
eine Zeile kürzer und erzeugt für die Nacht vom 31.10. auf den 01.11. eine
andere Zahl als das Stundenkonto — das teilt an der **Berliner** Monatsgrenze
(`zeiteintrag_monatsanteil`, K-11) und verteilt die erfasste Pause nach größtem
Rest auf die Anteile (`verteilePauseAufAnteile`, §7.4).

Zwei plausible Zahlen für dieselbe Schicht sind schlimmer als eine unbequeme
Rechnung: die Kraft liest oben `8:00 h`, im Stundenkonto `4:00 h` und hat keine
Möglichkeit, zu erkennen, welche stimmt. `leseStundenFenster` benutzt deshalb
dieselben zwei Funktionen wie `bucheFreigegebeneZeiten` und zählt jeden Anteil
auf den Berliner Kalendertag, an dem er **beginnt** — genau so, wie die Buchung
ihr `wirksam_am` setzt. Damit ist die Summe der Tage eines Monats gleich der
Summe des Monats, und die Woche über eine Monatsgrenze zählt beide Anteile.

**Der verbleibende Unterschied ist sichtbar und gewollt:** die Kopfzahl zählt
ERFASSTE Zeit, das Stundenkonto nur FREIGEGEBENE (§7.3). Das ist der
Unterschied zwischen „was ich gearbeitet habe" und „was verbucht ist"; er wird
angezeigt (der Monatsnachweis nennt beide Zahlen nebeneinander) und nicht
weggerechnet.

### D-201 · `dir="rtl"` sitzt auf der Portalhülle, nicht auf `<html>` — vorläufig

`04-SEITENKARTE.md` §12 sagt „`dir="rtl"` on the document". Das Wurzel-Layout
(`src/app/layout.tsx`) kennt aber nur die **zwei** Sprachen der öffentlichen
Website (`src/lib/sprache.ts`, D-82) und bekommt sie aus einem Kopf, den
`src/middleware.ts` setzt; beide Dateien gehören nicht zu diesem PR, und die
Middleware handelt für `/portal/mein` heute gar keine Sprache aus.

`MeinRahmen` setzt `dir` und `lang` deshalb auf einem Element **um** die Seite.
`dir` ist ein globales HTML-Attribut und wirkt auf jedem Element: die
Spiegelung der Oberfläche, die Laufrichtung der Tab-Leiste und die Ausrichtung
jedes Textes darin folgen ihm; logische Abstände (`ms-*`/`me-*`) spiegeln mit.
Was fehlt, ist ausschließlich das Feld **außerhalb** der Hülle — Bildlaufleiste
und Seitenrand des Browsers. Die vollständige Erfüllung von §12 braucht drei
Zeilen in zwei gesperrten Dateien: `person.sprache` in den Sprachkopf der
Middleware und `dir={…}` auf `<html>`. Bis dahin ist die Abweichung benannt
statt behauptet.

### D-202 · Das Mitarbeiterportal LIEST; jeder Schreibweg bleibt im Fachdienst

`src/server/services/mitarbeiter/**` enthält sieben Dienste, und alle sieben
sind im Register `schreibend: false`. Die drei Schreibwege, die ein Mensch in
diesem Portal hat, stehen weiter dort, wo sie entstanden sind:
`reicheEinwandEin` (`zeit/einwand.ts`, EMP-07), `reicheAntragEin`
(`abwesenheit/antrag.ts`, EMP-10) und `meldeAbwesenheit`
(`abwesenheit/index.ts`, EMP-10).

Der Grund ist K-18: im Personen-Scope ist `app.aktiver_mandant()` NULL, und
keine Schreibpolicy trifft zu. Jeder Schreibweg muss den Mandanten aus der
betroffenen **Beschäftigung** auflösen und `withTenant` neu betreten. Ein
vierter, im Portaldienst angelegter Schreibpfad wäre genau der, der an dieser
Auflösung vorbeiführte — und er sähe aus wie eine Abkürzung.

### D-203 · Auch der EIGENE Lohnsatz steht nicht im Portal

K-05 nimmt `cse_app` die Spalten `anstellung.stundensatz_intern` und
`tarifgruppe` per `GRANT` weg; der einzige Weg dorthin ist
`app.anstellung_entgelt_lesen`, die `personal.entgelt_lesen` verlangt und eine
Auditzeile schreibt. Die Rolle `mitarbeiter` hält dieses Recht nicht.

Damit zeigt das Portal **gar keinen** Stundensatz — auch nicht den der
angemeldeten Person. Das ist eine Entscheidung und keine Lücke: der eigene Satz
steht im Arbeitsvertrag und in der Lohnabrechnung, die ein Lohnsystem erzeugt
(D-06). Ihn hier zu zeigen verlangte, `cse_app` die Spalte zu öffnen — und
damit dieselbe Linie zu durchbrechen, die verhindert, dass eine Planerin der
Reinigung den Satz der Security sieht (D-09 §6).

### D-204 · Der Monatsnachweis ist eine druckbare Seite, keine erzeugte Datei

Dieselbe Entscheidung wie beim Angebotsdokument (`/portal/[mandant]/angebote/
[id]/pdf`): ein serverseitiger PDF-Renderer ist eine eigene Abhängigkeit mit
eigener Laufzeit, und solange keine eingerichtet ist, wäre ein Knopf „PDF" ohne
Datei eine vorgetäuschte Funktion. `/portal/mein/monatsnachweis` IST das
Dokument — A4, 20 mm Rand, 10 pt, weißes Blatt mit `#111` Text aus den fünf
Drucktoken von DESIGN §11.

**Die „signed-URL only"-Zusage des PR-Plans greift damit noch nicht**, weil es
kein Speicherobjekt gibt, das eine signierte Adresse tragen könnte. Was den
Zugriff heute begrenzt, ist die Sitzung plus die Personen-RLS: die Seite liest
ausschließlich Beschäftigungen der angemeldeten Person, eine fremde
`anstellung`-id liefert null Zeilen und damit 404. Sobald ein Renderer
feststeht, schreibt er genau dieses Layout nach `dokument`, und erst dann ist
die signierte Adresse die richtige Frage.

### D-205 · Der Zurückzieh-Knopf fehlt, weil die Policy fehlt — gemeldet, nicht gebaut

`zieheAntragZurueck` steht in `abwesenheit/antrag.ts` und ist für genau diesen
Fall geschrieben („Zieht einen **eigenen** Antrag zurück"). `antrag` trägt aber
keine permissive UPDATE-Policy für `app.aktuelle_person()`: die einzige ist
`t_mandant_entscheiden`, und die verlangt `zeit.antrag_entscheiden` — ein Recht
der Planung. Der Aufruf träfe null Zeilen und antwortete `AntragNichtGefunden`,
also 404.

`/portal/mein/antraege` bietet das Zurückziehen deshalb **nicht** an. Ein Knopf,
der 404 ergibt, ist schlechter als keiner: er verspricht eine Handlung, die es
nicht gibt. Die fehlende Policy (`t_selbst_zurueckziehen`, UPDATE, `status in
('eingereicht','in_pruefung')`) braucht eine Migration; PR 39 hat laut Plan
keine, und eine anzulegen wäre eine Planänderung und keine Umsetzung.

### D-206 · Statuspillen und Tabellenzellen bleiben, wie sie sind — mit zwei benannten Abweichungen

Zwei Regeln stoßen im Arbeiterportal aufeinander, und beide gehören Dateien,
die dieser PR nicht ändert:

1. `StatusPill` (`src/components/ui/StatusPill.tsx`) hat ein **festes
   deutsches** Vokabular. Das ist für die internen Bildschirme richtig (die
   Begriffe tragen dort fachliche Bedeutung) und steht gegen EMP-12, sobald
   dieselbe Pille auf einem arabischen Bildschirm steht. Die Seiten benutzen
   sie trotzdem — ein zweites, hier erfundenes Zustandsvokabular wäre der
   schlechtere Tausch (DESIGN §12: „No component invented ad hoc").
2. `DataTable` setzt Zellen auf `text-sm` (14 px). `04-SEITENKARTE.md` §13
   verlangt für `/portal/mein/**` mindestens 16 px Fließtext. Die Zeitliste
   benutzt `DataTable` — sie IST eine Datentabelle, und ihre Stapelansicht
   unter 768 px ist genau das, was DESIGN §8 verlangt.

Beide Abweichungen sind im Abschlussbericht mit ihrem konkreten Ort vermerkt;
keine davon wird hier durch eine Kopie der Komponente umgangen.

---

## Entschieden in PR 46 — Rechnungs-Lebenszyklus, Nummernvergabe, Kette, Storno

Diese Entscheidungen lösen Widersprüche zwischen den Vorgabedokumenten oder
halten eine Stelle fest, an der die Umsetzung vom Wortlaut abweicht. Sie stehen
hier, weil die nächste Person sonst dieselbe Stelle noch einmal entscheidet —
und möglicherweise anders.

### D-210 · Der Nachfolgekreis zum Jahreswechsel entsteht NICHT in der Festschreibung

`05-FINANZEN.md` §5.6 Schritt 2 schreibt, das Öffnen des Nachfolgekreises
geschehe „here" — also innerhalb von `fin.rechnung_nummer_ziehen`. Das ist mit
`0006` unvereinbar, und zwar nicht stilistisch: `fin.nummernkreis_pruefen()`
lässt jedem, der nur `nummernkreis.ziehen` hält, ausschliesslich
`naechste_nummer`, `letzter_hash` und die `geaendert_*`-Spalten. Den Vorgänger
zu schliessen heisst `geschlossen_am` zu setzen, und das verlangt
`nummernkreis.verwalten`. Die Definer-Funktion läuft zwar als `cse_definer`,
aber `app.hat_recht` fragt nach dem angemeldeten **Menschen** — und eine
Leitung, die festschreibt, hält `verwalten` nicht.

Die drei denkbaren Auswege sind schlechter: dem Festschreibenden `verwalten`
geben öffnet jedem Rechnungsschreiber die Maske seiner Gesellschaft; den
Auslöser aufweichen macht den Geltungsbereich eines Kreises nach der ersten
Nummer wieder beweglich (LEG-01); und es stillschweigend zu unterlassen
begänne am 2. Januar eine Kette, die an keiner hängt.

Gewählt: eine **benannte Ablehnung**, die den Verwaltungsakt nennt. Das Öffnen
eines Nachfolgekreises kopiert `letzter_hash` in `genesis_hash` und macht damit
die Kette über die Jahresgrenze zu **einer** Linie (§5.4) — das ist ein Akt mit
rechtlicher Wirkung, kein Nebenprodukt einer Festschreibung. Solange O-134 offen
ist und jeder Kreis ein Platzhalter, kann der Fall ohnehin nicht eintreten.

### D-211 · `d_kreis_lesen` / `d_kreis_ziehen` heissen auf `nummernkreis` anders

§1.1 vergibt diese zwei Namen an `cse_definer`-Policies. `0006` (PR 5) hat sie
bereits an die `cse_app`-Policies vergeben, und ein Policyname ist je Tabelle
eindeutig. Umbenannt wird nicht — der `cse_app`-Zug der fünf übrigen Kreistypen
hängt daran. Die Definer-Policies heissen deshalb `d_rechnungskreis_lesen` und
`d_rechnungskreis_ziehen`; Bedingungen und Spaltengrants sind die des §1.1.

### D-212 · `zuschlaege[]` trägt `gruppe_satz_bp` und `gruppe_kategorie`

Die Nutzlast in §5.3 führt im `zuschlaege`-Objekt **zweimal** den Schlüssel
`satz_bp` — einmal als BT-94/BT-101 und einmal als Satz der Steuergruppe. Ein
JSON-Objekt kann denselben Schlüssel nicht zweimal tragen; die zweite Nennung
überschriebe die erste, und welche das ist, entschiede die Reihenfolge im
Quelltext. Aufgelöst wie die Tabelle es auflöst (§4.3): `gruppe_satz_bp` und
`gruppe_kategorie`. Die Spaltennamen sind die eindeutige Fassung derselben
Aussage.

### D-213 · `rechnung_steuer` bekommt `geaendert_am`, und wird per UPSERT geschrieben

§4.5 nennt nur `erstellt_am`. Die Zeile ist während der Entwurfsbearbeitung aber
beweglich — `berechneSteuer()` läuft bei jeder Positionsänderung —, und K-16
verlangt für jede bewegliche Tabelle diese Spalte. Wo Kapitel und Konvention
auseinandergehen, gilt die Konvention.

Daraus folgt der Schreibweg: neu gerechnet wird per `INSERT … ON CONFLICT DO
UPDATE`, nie durch Löschen und Neuanlegen — in dieser Domäne gibt es keinen
Hard Delete (Invariante 8, §1.6). Eine Gruppe, die nicht mehr vorkommt, fällt
auf `netto_cent = 0` und damit aus jeder Summe heraus; sie verschwindet nicht,
sie wird leer.

### D-214 · Die aufgeschobene Summenprüfung liest die Zeile NEU, statt `NEW` zu benutzen

Ein aufgeschobener Constraint-Auslöser feuert beim COMMIT, aber `NEW` ist der
Stand **der auslösenden Anweisung**. Beim Anlegen eines Entwurfs ist das
`netto_gesamt_cent = 0`; kommt in derselben Transaktion eine Position hinzu,
meldete genau dieses eine Ereignis beim COMMIT „0 gegen 10000", obwohl der Kopf
längst stimmt. §4.9 meint den Stand **beim COMMIT**, und der steht in der
Tabelle, nicht im Ereignis. `fin.rechnung_summen_stimmig()` und
`fin.rechnung_verkettet()` lesen deshalb beide die Zeile über `new.id` neu.

### D-215 · Eine Rechnungsposition lässt sich korrigieren, aber nicht entfernen

§4.3 gibt `rechnungsposition` sowohl `fin.kind_unveraenderlich()` als auch
`kern.verhindere_loeschung()`. Zusammen heisst das: eine versehentlich erfasste
Zeile bleibt auch im Entwurf stehen. Das ist die Konsequenz von Invariante 8 und
keine Auslassung — die Oberfläche bietet deshalb **kein** „Position entfernen"
an, sondern den Weg, den das Modell vorsieht: den Entwurf verwerfen (er kostet
keine Nummer) und neu beginnen. Sollte sich das im Betrieb als untragbar
erweisen, ist die Antwort eine Zustandsspalte auf `rechnungsposition` und keine
Löschpolicy.

### D-216 · Die Statuspillen `Festgeschrieben`, `Storniert` und `Verworfen` fehlen DESIGN §5

`05-FINANZEN.md` §2.3 Nr. 8 verlangt elf Pillenbeschriftungen von `DESIGN.md`
§5; sechs davon fehlen dort. CLAUDE.md lässt nur einen Weg zu — erst DESIGN.md
ergänzen, dann benutzen —, und `DESIGN.md` gehört diesem PR nicht. Die
Rechnungsbildschirme bilden deshalb auf das **vorhandene** Vokabular ab:
`entwurf → Entwurf`, `festgeschrieben → Abgeschlossen`, `verworfen →
Archiviert`. Ob ein Beleg ein Storno ist, steht als eigene Spalte daneben — das
ist ohnehin die Rechnungsart und keine Zustandsfrage. Die Abbildung steht an
genau einer Stelle je Seite, damit das Ergänzen von DESIGN §5 eine Änderung
bleibt und keine Suche.

### D-217 · Der Pflichtfeldbericht von PR 46 behauptet nicht, geprüft zu haben

`rechnung_snapshot.pflichtfeld_pruefung` ist `NOT NULL`, und die
§14-UStG-Vorabprüfung kommt erst mit PR 47. Ein leerer Befund „keine Fehler"
wäre im Snapshot die Bezeugung, dass geprüft wurde. Abgelegt wird deshalb
`{ geprueft: false, grund: "…kommt mit PR 47" }` mit
`regelwerk_version = 'ustg14-nicht-gebaut'` — so ist später erkennbar, welche
Belege vor dem Validator entstanden sind.

### D-218 · `rechnung_snapshot` steht nicht im Audit-Register

Jede andere Tabelle dieser Domäne trägt `kern.protokolliere_aenderung()`. Der
Snapshot nicht: er **ist** das Protokoll. Ihn zusätzlich nach `audit_log` zu
spiegeln legte dasselbe Dokument ein zweites Mal ab — `nutzlast_bytes` als
Hextext, also mit doppeltem Volumen — und die zweite Kopie wäre die, die
niemand hasht. `rechnung_hash` steht dagegen im Register: eine Handvoll Spalten,
und die Zeile, an der eine Manipulation sichtbar würde.

### D-219 · `abrechnungsart` auf der Position ist `text` und nicht der CRM-Enum

§4.3 typisiert die Spalte als den `abrechnungsart`-Enum, den K-21
`02-CRM-OPERATIONS.md` §2 zuweist. Den Enum gibt es noch nicht (PR 48), und ihn
hier anzulegen schüfe einen zweiten Eigentümer für eine Liste, die niemand
bestätigt hat (**O-04**). Die Spalte ist deshalb `text` und nullable; die
Pflichtbedingung des Kapitels (`positionsart <> 'leistung' OR abrechnungsart IS
NOT NULL`) kommt mit dem Katalog, der sie erfüllbar macht.

### D-220 · Die Nummernmaske wird an zwei Stellen aufgelöst — und beide werden verglichen

Der Zug der Rechnungsnummer läuft in SQL (er braucht die Zeilensperre), die
übrigen fünf Kreistypen zieht die Anwendung. Es gibt deshalb
`fin.nummer_formatieren` **und** `formatiereNummer()`. Zwei Fassungen, die
niemand vergleicht, sind zwei Rechnungsnummernformate; also prüft
`tests/isolation/rechnung-kette.test.ts` beide gegen dieselben Vektoren. Der
Vergleich hat sofort einen echten Fehler gefunden: `lpad(…, 0, '0')` schneidet
auf null Zeichen, und `RE-{jahr}-{nr}` hätte `RE-2027-` ergeben.

### Offen, neu aufgeworfen in PR 46

| # | Question | Blocks |
|---|---|---|
| O-212 | **Darf eine Rechnungsposition im Entwurf entfernt werden?** Invariante 8 und §1.6 verbieten in dieser Domäne jeden Hard Delete, auch auf `rechnungsposition` — eine versehentlich erfasste Zeile bleibt damit im Entwurf stehen, und der einzige Ausweg ist, den ganzen Entwurf zu verwerfen. Wenn das im Alltag untragbar ist, braucht `rechnungsposition` eine Zustandsspalte (`entfernt_am` plus Grund), die aus jeder Summe herausfällt — nicht eine Löschpolicy. Die Entscheidung ist buchhalterisch, nicht technisch: ob eine nie ausgestellte Entwurfszeile überhaupt aufbewahrungspflichtig ist. | FIN-01, Invariante 8, `rechnungsposition` |

---

## Entschieden in PR 42 — Security B (versionierte Dienstanweisung mit Kenntnisnahme, Schlüsselverwaltung)

Sieben Entscheidungen. Jede löst einen Widerspruch zwischen zwei
Vorgabedokumenten oder hält eine Stelle fest, an der die Umsetzung vom
Wortlaut abweicht — damit die nächste Person sie nicht noch einmal entscheidet,
und möglicherweise anders.

### D-230 · Die Bestätigungsroute liegt unter `/api/mein/…`, nicht `/api/mitarbeiter/…`

`05-API-KARTE.md` §C.13 nennt sie
`POST /api/mitarbeiter/dienstanweisungen/[id]/kenntnisnahme`. Das Repository
führt die beiden bereits gebauten Schreibwege des Mitarbeiterportals aber unter
`/api/mein/antraege` und `/api/mein/abwesenheit` (PR 39) — obwohl die Karte
dort `…/antrag` und `…/krankmeldung` sagt. Zwei Präfixe für dasselbe Publikum
wären zwei Stellen, an denen jemand die Sitzungs- und Scope-Behandlung
nachbaut; und `tests/kern/mitarbeiter.test.ts` zählt die Schreibrouten des
Portals über genau dieses Präfix.

Gebaut ist deshalb
`POST /api/mein/dienstanweisungen/[id]/kenntnisnahme`. Die Abweichung ist eine
Namens- und keine Vertragsfrage: Aufrufer ist ausschliesslich das eigene
Formular derselben Anwendung, es gibt keinen externen Verbraucher dieser
Adresse. Wird die API-Karte je maßgeblich für ein fremdes System, wandern alle
drei Adressen zusammen — nicht diese eine allein.

### D-231 · Der „Diff" der Seitenkarte ist ein Nebeneinander, keine zeichenweise Gegenüberstellung

`04-SEITENKARTE.md` §5.8 schreibt zu `…/dienstanweisungen/[id]`: „versions with
a diff between them". Eine zeichenweise Gegenüberstellung ist ein eigenes
Bauteil; es steht nicht in `DESIGN.md`, und §12 verbietet ausdrücklich, ein
Bauteil in einer Seitendatei zu erfinden.

Gebaut sind deshalb die Fassungen untereinander — jede mit ihrem Text, ihrem
Gültigkeitsdatum, ihrem Digest und der Zahl ihrer Bestätigungen —, und an der
neueren steht der `aenderungshinweis`. Was die Gegenüberstellung beantworten
soll (was hat sich geändert), beantwortet der Hinweis genauer, weil ihn ein
Mensch geschrieben hat: eine markierte Zeile sagt, dass etwas anders ist, nicht
warum. Ein echter Diff bleibt möglich — er beginnt mit einem Eintrag in
`DESIGN.md`, nicht mit einer Seite.

### D-232 · Die Unterschrift auf der Schlüsselquittung ist heute ein Name; das Bild ist „nicht verbunden"

`0079` legt `schluessel_quittung.signatur_medien_id` an, und `05-API-KARTE.md`
§C.13 verlangt, dass Unterschriftsbilder Dateien sind und über
`POST /api/dokumente/upload-ticket` laufen. Beides ist heute nicht
zusammenführbar: ein Medium hängt nur an einer Elterntabelle, die im
geschlossenen Register `einsatz_medien_bezug` steht (0041 §5.8.1), und
`schluessel_quittung` steht dort nicht — es fehlt ausserdem die Schreibpolicy
auf `einsatz_medien` für diese Bezugsart.

Die Quittung trägt deshalb `unterzeichner_name` (Pflicht bei Ausgabe und
Rücknahme, `sq_unterzeichner`), und beide Bildschirme sagen „Unterschriftsbild:
nicht verbunden" statt eine Unterschriftsfläche zu zeigen, die nichts
speichert. Dieselbe Linie wie bei der Leistungsnachweis-Unterschrift (0066):
lieber eine ehrliche Lücke als ein vorgetäuschter Erfolg (CLAUDE.md, „No fake
integrations"). Die Bedingung `da_kenntnis_signatur_vorhanden` und
`sq_medien_fk` stehen bereits und halten von selbst, sobald der Uploadweg da
ist.

### D-233 · Der Quittungsabzug benutzt den EINEN Kanonisierer und die Serverzeit derselben Transaktion

`snapshot` und `snapshot_hash` schreibt kein Auslöser — sie sind der
Quittungstext, *wie angezeigt*, und die Anzeige kennt nur die Anwendung.
Gehasht wird mit `finanz/kanonisch.ts` (D-181), nicht mit einer zweiten
Fassung: zwei Kanonisierer melden beim ersten Umlaut einen Bruch, den es nicht
gibt.

Die Zeit im Abzug kommt aus `select now()` **derselben** Transaktion. Das ist
kein Zufall, sondern die Eigenschaft, auf der es ruht: `now()` ist in
PostgreSQL die Transaktionszeit und ändert sich innerhalb der Transaktion
nicht — der Wert im Abzug ist damit bitgleich der, den
`kern.schluessel_quittung_vorbereiten` gleich als `quittiert_am` stempelt. Eine
Zeit aus dem Node-Prozess wäre eine zweite Uhr (Invariante 5) und der Abzug
nennte eine andere Sekunde als die Zeile, die er beschreibt.

Der Abzug trägt ausschliesslich Zeichenketten, `null` und Wahrheitswerte: nur
so übersteht er die Rundreise durch `jsonb` unverändert, und
`pruefeQuittungen()` kann den Hash nachrechnen.

### D-234 · „Veraltet" wird beim LESEN abgeleitet — `neue_version_oeffnet_pflicht` steuert nur diese Ableitung

`0078` §8 sagt es, und die Umsetzung hält sich daran: Fassung 3 zu
veröffentlichen ändert **keine** `da_kenntnisnahme`. Ob eine Bestätigung noch
zählt, entscheidet der Vergleich mit `dienstanweisung.aktive_version_id`; bei
`neue_version_oeffnet_pflicht = false` zählt stattdessen die Bestätigung
irgendeiner veröffentlichten Fassung weiter (O-153).

Diese Bedingung steht in `security/dienstanweisung.ts` **einmal** (`ZAEHLT_NOCH`)
und wird von Liste, Kenntnisstand und Mitarbeiterportal benutzt. Sie beginnt
mit `k.id is not null`, und das ist tragend: ohne diese Hälfte wäre der
Ausdruck für einen Kopf mit `neue_version_oeffnet_pflicht = false` auch dann
wahr, wenn es gar keine Bestätigung gibt — die Liste meldete „alle bestätigt"
für eine Anweisung, die niemand gelesen hat.

### D-235 · Die Schlüsselseiten stehen nur im internen Portal

`0079` §7 gibt `schluessel` die vierte Deckenvariante
(`p_intern_einsatz_decke`) und begründet sie damit, dass die Wache den
Schlüssel ihres Objekts nimmt und dort zurückgibt; `03-AUTH` bindet
`schluessel.schreiben` tatsächlich an `mitarbeiter`. Die Seitenkarte kennt
dafür aber **keine** Route unter `/portal/mein` — nur `…/security/schluessel`,
`/[id]` und `/[id]/quittung`, alle drei im Mandantenportal.

Gebaut ist deshalb der interne Weg. Zwei Gründe, und der zweite wiegt schwerer:
die Seitenkarte schlägt jede andere Quelle für Seitenpfade, und im
Mandanten-Scope kann eine `mitarbeiter`-Anmeldung `schluessel` gar nicht lesen
— `schluessel.lesen` ist nicht an sie gebunden, und keine permissive Policy
greift dort. Ein Mitarbeiterweg wäre also nicht bloss eine Seite, sondern
derselbe Zwei-Scope-Umweg wie bei der Kenntnisnahme (Personen-Scope lesen,
Mandanten-Scope schreiben) — und ohne eine Route in der Karte wäre er
erfunden. Siehe **O-240**.

### D-236 · `bestaetigter_inhalt_hash` steht in keinem `INSERT`

Die Spalte ist `not null`, und der Dienst schickt sie trotzdem nicht mit.
PostgreSQL prüft NOT NULL und CHECK **nach** den BEFORE-Auslösern; 
`kern.da_kenntnisnahme_vorbereiten` setzt den Hash aus der Fassung. Ein
mitgeschickter Wert wäre die Antwort des Bestätigenden auf die Frage, was er
bestätigt hat — und ein Platzhalter („64 Nullen") wäre eine Zeile, die für
einen Moment eine falsche Prüfsumme trägt. Dasselbe gilt für `bestaetigt_am`,
`zeitabweichung_sek` und `da_pflicht_id`: was der Auslöser setzt, sendet der
Dienst nicht einmal.

### Offen, neu aufgeworfen in PR 42

| # | Question | Blocks |
|---|---|---|
| O-240 | **Darf die Wache vor Ort einen Schlüssel selbst quittieren — und auf welchem Bildschirm?** `03-AUTH` bindet `schluessel.schreiben` an die Rolle `mitarbeiter`, und `0079` gibt `schluessel` die Einsatzdecke; `04-SEITENKARTE.md` §7 kennt dafür aber keine Route unter `/portal/mein`. Beides zusammen ergibt ein Recht ohne Bildschirm. Die Frage ist organisatorisch und nicht technisch: quittiert die Objektleitung im Büro (dann ist die Bindung an `mitarbeiter` zu weit), oder die Wache am Objekt (dann fehlt eine Seite in der Karte, und sie braucht denselben Zwei-Scope-Umweg wie die Kenntnisnahme). Bis zur Antwort ist der Weg intern (**D-235**). | SEC-07, `schluessel_quittung`, `/portal/mein` |
| O-241 | **Sperrt eine unbestätigte Dienstanweisung die Einteilung?** SEC-06 verlangt die Kenntnisnahme, nennt aber keine Folge, wenn sie ausbleibt — anders als SEC-04, wo ein abgelaufener Nachweis die Einteilung hart sperrt. Die Plattform sperrt heute **nicht**: die Anweisung steht offen im Portal, die Leitung sieht „4 von 11", und niemand wird deshalb aus dem Plan genommen. Eine Sperre wäre eine erfundene Rechtsfolge (K-17); eine Frist („bis zum Schichtbeginn") ebenso. Gefragt ist beides: ab wann gilt eine Unterweisung als versäumt, und was folgt daraus — Warnung, Freigabepflicht der Leitung oder Einteilungssperre? | SEC-06, EMP-09, `da_pflicht`, `dienstplan/einteilung` |

---

## Entschieden in PR 44 — Bau B: Nachträge, Behinderungsanzeige, Warnung außerhalb des LV

Die Migrationen `0080`/`0081` und die drei Dienste standen; gefehlt haben die
Adressen, die Seiten und die Tests. Diese Entscheidungen halten fest, wo die
Umsetzung von einem Vorgabedokument abweicht oder eine Stelle klärt, die sonst
die nächste Person noch einmal — und möglicherweise anders — entscheidet.

### D-250 · PR 44 schreibt keine `freigabe`-Zeile; es prüft sie

Die API-Karte §C.15 nennt als Antwort von `POST /api/bau/behinderungen` ein
`{ freigabe_id }`. Umgesetzt ist es **nicht**, und zwar aus drei Gründen, die
zusammen eindeutig sind:

1. `0012` lässt einen `INSERT` auf `freigabe` nur mit `versand.freigeben` zu
   (`t_mandant … with check`). Im Katalog ist dieses Recht an `super_admin` und
   `admin` **gebunden** und für `leitung` nur *bindbar* — die Bauleitung, die
   `bau.behinderung_erstellen` hält, hält es also nicht von selbst. Eine
   Freigabe im Anlegepfad zu erzeugen liesse die Anzeige für genau die Rolle
   scheitern, für die sie gebaut ist.
2. **Kein Modul dieses Repositoriums erzeugt Freigaben.** Das durchgehende
   Muster ist `gate(nutzlast, freigabe, richtlinie)` mit einer Freigabe, die
   der Aufrufer mitbringt (`services/lead/bestaetigung.ts`, `api/anfrage`).
   Eine achte Stelle, die eigene Kettenglieder in `freigabe_snapshot` schreibt,
   wäre eine zweite Fassung der Kettenmechanik neben der, die PR 62 baut.
3. Der Freigabe-Posteingang **ist** PR 62 und im PR-Plan ausdrücklich nicht
   Teil dieses Scopes.

Umgesetzt ist deshalb: beide Ausgänge — die Nachtragseinreichung und der
Behinderungsversand — nehmen die **Kennung einer bereits genehmigten Freigabe**
entgegen und schicken die Nutzlast durch `server/agent/policy.ts`. Ohne
genehmigte Freigabe mit benanntem Menschen und mit einem Hash über *den* Text,
der in der Zeile steht, geht nichts hinaus; die Richtlinie wird bewusst als
`null` übergeben, damit das Tor fail-closed entscheidet. Das Kriterium „der
Versand läuft durch `policy.ts`" ist damit erfüllt; erzeugt wird die Freigabe
dort, wo sie hingehört. Siehe O-260.

### D-251 · Die Aufmaßzeile wird an den Nachtrag gehängt — sonst verschwindet die Warnung nie

`ladeAusserhalbLv` wählt genau `ausserhalb_lv and nachtrag_id is null`. Der
Nachtrag allein räumt die Warnung also **nicht** ab: für die Quelle „Zeit"
genügt `nachtrag.auftrag_leistung_id` (der Dienst nahm sie schon entgegen), für
die Quelle „Aufmaß" fehlte der Weg, `aufmass_zeile.nachtrag_id` zu setzen —
obwohl `0080` den Fremdschlüssel `az_nachtrag_fk` eigens dafür nachträgt und
`0071` vermerkt, der Schlüssel komme mit PR 44.

Neu ist deshalb `ordneAufmasszeileZu` in `services/bau/nachtrag.ts`. Sie setzt
`nachtrag_id` nur, wenn noch keine steht, und nur innerhalb desselben Projekts.
Dass das auch nach der Gegenzeichnung geht, ist kein Versehen von `0072`:
`kern.aufmass_zeile_einfrieren()` zählt `nachtrag_id` bewusst **nicht** zu den
eingefrorenen Spalten — Menge, Formel und Bezeichnung sind unveränderlich, aber
der Streit über die Vergütung beginnt regelmäßig, wenn die Menge längst
festgestellt ist.

Eine Warnung, die sich nicht abstellen lässt, liest nach drei Wochen niemand
mehr — und dann auch nicht die, die etwas kostet.

### D-252 · Sieben `POST`-Adressen statt der Methodenpaare der API-Karte

Die API-Karte führt `GET/POST /api/bau/nachtraege` und `GET/POST
/api/bau/behinderungen`. Gebaut sind die `POST`-Hälften; die `GET`-Hälften
nicht. Das ist keine Auslassung, sondern das Muster dieses Repositoriums:
**genau eine** der rund vierzig vorhandenen Routen hat einen `GET`-Handler
(`api/medien/[id]`, der eine signierte Adresse ausgibt). Gelesen wird auf den
Seiten, durch `withTenant` und den Fachdienst — eine JSON-Liste ohne Aufrufer
wäre toter Code mit eigener Rechteprüfung, also eine zweite Stelle, an der die
Mandantenbedingung fehlen kann.

Die eine Ausnahme ist `GET /api/bau/nachtrag-warnungen`: sie steht in der Karte
als reine `GET`-Route, sie liest, und sie hat mit `warnungsText` /
`nachtragTitelVorschlag` eine Antwort, die über die Zeilen hinausgeht.

`POST` statt `PATCH`/`PUT` bei `…/anmelden`, `…/einreichen`, `…/versenden` und
`…/wegfall`: der Aufrufer ist ein HTML-Formular, und ein Formular kennt nur
`GET` und `POST` — dieselbe Begründung wie bei `api/reinigung/reviere/[id]/raeume`.

`…/wegfall` steht in keinem Vorgabedokument. Sie ist trotzdem gebaut, weil
`zeigeWegfallAn` im Dienst steht, § 6 Abs. 3 VOB/B die Wegfallanzeige
ausdrücklich verlangt und `behinderung_laufend_idx` sonst eine Liste wäre, die
nur wächst: eine Bauzeitverlängerung stünde auf einer Behinderung, die seit
Monaten vorbei ist.

### D-253 · Zwei Fehler in den vorhandenen Diensten korrigiert, nicht umgangen

Beide fielen erst, als die Tests die Dienste zum ersten Mal gegen eine echte
Datenbank riefen — sie sind keine Stilfragen, sondern Abbrüche:

- **`meldeNachtragAn`**: das `INSERT` nannte 14 Spalten und lieferte 13
  Ausdrücke; `erstellt_von` blieb ohne Wert. Postgres antwortete mit
  *„INSERT has more target columns than expressions"* — **jeder** Nachtrag
  scheiterte. Ergänzt: `app.aktueller_benutzer()`, wie es `erstelleBehinderung`
  zwei Dateien weiter bereits tut.
- **`dokumentiereVersand`**: das `INSERT` auf `dokument` schrieb `dateiname` und
  `sha256`. Beide Spalten gibt es in `0009` nicht — der Digest lebt in
  `dokument_version`, der Dateiname steckt im `objekt_schluessel`. Der Versand
  brach damit **nach** dem Tor und **nach** dem Hochladen ab. Korrigiert auf die
  beiden Zeilen, die das Schema führt: `dokument` (Kopf, Aufbewahrung) und
  `dokument_version` (Fassung 1 mit SHA-256). Den Digest wegzulassen wäre hier
  besonders teuer — das Schreiben ist ein Beweisstück.

**Ausserhalb der Grenzen dieses PRs, aber derselbe Fehler:**
`src/app/api/anfrage/route.ts` schreibt beim LV-Anhang einer Angebotsanfrage
ebenfalls `dokument (… dateiname …, sha256 …)`. Dieser Pfad läuft nur, wenn
eine Datei mitgeschickt wird und der Speicher verbunden ist — deshalb ist er
bisher nicht aufgefallen. Er ist nicht angefasst worden; er gehört gemeldet.

### D-254 · Keine neuen Statuspillen — abgebildet statt erfunden

DESIGN §5 kennt „Angemeldet", „Eingereicht", „Beauftragt" und „Angezeigt"
nicht. Erfunden wird hier keine: `bau/nachtrag-anzeige.ts` bildet jeden Zustand
auf das nächstliegende Wort des geschlossenen Vokabulars ab und stellt die
**genaue** Bezeichnung mit ihrer Fundstelle daneben — dieselbe Lösung wie
D-186 und D-206, und §9 verlangt ohnehin, dass die Bedeutung im Wort steht und
nicht in der Farbe. Der Unterschied zwischen „angemeldet" und „eingereicht" ist
der zwischen Anspruch und Fälligkeit; eine Pille, die beides „Offen" nennt,
wäre die falsche Vereinfachung, und der Text daneben verhindert sie.

Der Platzhalterhinweis („unbestätigter Wert") ist ebenfalls **keine** Pille,
sondern ein `text-warning`-Vermerk mit `title` — so wie ihn
`finanzen/rechnungen/[id]` für O-174 schon führt.

### Offen, neu aufgeworfen in PR 44

| # | Question | Blocks |
|---|---|---|
| O-260 | **Wer gibt bei der Gruppe eine ausgehende Bau-Rechtserklärung frei — die Behinderungsanzeige nach § 6 Abs. 1 VOB/B und die Einreichung eines Nachtrags nach § 2 VOB/B?** Beides sind Erklärungen mit anspruchswahrender bzw. anspruchsbegründender Wirkung, und Invariante 7 verlangt dafür einen benannten Menschen. Der Rechtekatalog bindet `versand.freigeben` heute an `super_admin` und `admin` und macht es für `leitung` nur *bindbar* — die Bauleitung, die die Anzeige schreibt, darf sie also nicht selbst freigeben. Ob das so gewollt ist (Vier-Augen-Prinzip) oder ob die Bauleitung das Recht erhalten soll, ist eine Frage der Vollmachtsordnung und keine technische. Bis zur Antwort verlangen beide Formulare die Kennung einer bereits genehmigten Freigabe und erzeugen keine (D-250); der Freigabe-Posteingang entsteht ohnehin erst mit PR 62. | BAU-04, BAU-06, Invariante 7, `versand.freigeben` |

---

## Phase 6, noch nicht in `main` — die drei Abschnitte PR 49, PR 47 und PR 48

**Lesehinweis, bevor jemand nach den genannten Dateien sucht.** Die rund
dreissig Entscheidungen der naechsten drei Abschnitte (D-360 bis D-371,
D-320 bis D-326, D-340 bis D-350) sind getroffen und beschrieben — ihr Code
liegt aber auf dem Arbeitszweig `claude/phase-5-dienstplan-zeit` und ist in
diesem Zweig **nicht enthalten**. Hier steht die Rechnung auf dem Stand von
PR 46: `REGELWERK_VERSION` traegt woertlich `'ustg14-nicht-gebaut'`,
`services/finanz/ustg14.ts` gibt es nicht, `rechnungsposition_quelle` ist ein
Kommentar in `0075_rechnung.sql`, und `rechnungsposition.abrechnungsart` ist
eine freie `text`-Spalte ohne Katalog.

**Die Migrationsnummern der drei Abschnitte kollidieren, und das ist beim
Zusammenführen nicht harmlos.** Nachgezählt in `drizzle/` dieses Zweiges:
`0085` heisst hier `0085_arbzg_befund_zeitraum`, `0087` heisst
`0087_steuersatz_historie`, `0088` heisst `0088_arbzg_befund_ueberholen` — die
Abschnitte meinen mit denselben Nummern `0085_rechnung_pflichtfelder`,
`0086_abrechnungsart`, `0087_rechnungsposition_typ` und `0088_position_herkunft`
(D-340). `0086` dagegen ist hier **frei und muss frei bleiben**: die Nummer
liegt auf `claude/phase-5-dienstplan-zeit` und wäre nach dem Merge zweimal
vergeben. Drizzle nummeriert nicht, es sortiert nur — zwei Dateien mit
derselben Nummer sind keine Fehlermeldung, sondern zwei Migrationen in
unbestimmter Reihenfolge, und eine davon legt Spalten an, die die andere
braucht. Wer Phase 6 hereinholt, benennt die Doppelten vorher um (die neuen
Nummern ab der höchsten dann vergebenen) und fasst die Lücke bei `0086` nicht
mit einer eigenen Datei zu.

Die Abschnitte bleiben stehen und werden **nicht** geloescht: sie sind der
Beschluss, nicht der Bericht ueber den Bau. Wer sie liest, liest den Plan
fuer Phase 6 — und darf aus dem Wort „ist gebaut" in ihnen nicht schliessen,
dass es in diesem Zweig gebaut ist. Beim Zusammenfuehren von Phase 6 faellt
dieser Hinweis weg.

## Entschieden in PR 49 — Positionsherkunft und Warnung bei fehlender Zeiterfassung · PHASE 6, NICHT IN DIESEM ZWEIG

Die Zeilen liegen seit PR 46, aber keine trug einen Beleg. FIN-07 verlangt, dass
jede Rechnungszeile auf das zurückführt, woraus sie entstanden ist, und FIN-18,
dass ein abgeschlossener Auftrag ohne eine einzige erfasste Minute nicht
unbemerkt fakturiert wird. Beides ist gebaut, und beides liegt in der Datenbank
— nicht im Dienst.

### D-360 · Die Zeile ohne Beleg gibt es nicht — und zwar als aufgeschobener Auslöser

`rp_hat_quelle` (`0088`) ist ein `deferrable initially deferred`
Constraint-Trigger auf `rechnungsposition`. Er prüft beim COMMIT, also **nachdem**
die Quellzeilen geschrieben sind.

Sofort geprüft wiese er jede Position zurück, deren Beleg eine Anweisung später
folgt — also jede. Im Dienst geprüft wäre er eine Zusage, die jeder zweite
Schreibweg einzeln wiederholen müsste: `storniere()`, `korrigiere()` und jeder
spätere Import schreiben Positionen mit rohem SQL, und genau dort wird eine
Prüfung vergessen. Aufgeschoben in der Datenbank sagt er die Zusage einmal für
alle Schreibwege.

Er gilt nur für `positionsart = 'leistung'`. Eine `textzeile` trägt weder Menge
noch Betrag (0075) und eine `zwischensumme` ist reine Anzeige — von ihnen einen
Beleg zu verlangen hieße, für einen VOB-Verweis eine Quellzeile zu erfinden.

### D-361 · Er fragt nach der EXISTENZ eines Belegs, nicht nach einem lebenden Anspruch

Die erste Fassung prüfte `exists (… and q.wirksam)`. Das ist falsch, und zwar auf
die teure Art: die Stornorechnung übernimmt den Beleg des Originals ausdrücklich
**unwirksam** (D-363). Mit `wirksam` in der Bedingung wäre ausgerechnet die
Korrektur die eine Buchung, die sich nicht mehr schreiben lässt — die
Doppelabrechnungssperre verhinderte dann genau den Vorgang, mit dem man eine zu
Unrecht gestellte Rechnung wieder loswird.

### D-362 · `zeiteintrag` exklusiv, `aufmass` ausdrücklich nicht

Für die Stunde ist der partielle Unique-Index
`quelle_zeiteintrag_uk (zeiteintrag_id) where quelle_typ = 'zeiteintrag' and wirksam`
der Anspruch. Für das Aufmaßblatt wäre derselbe Index falsch: § 16 VOB/B rechnet
ein Blatt anteilig über aufeinanderfolgende Abschlagsrechnungen und noch einmal
in der Schlussrechnung ab. Ein Unique-Index machte die **zweite** Bezugnahme zu
einem Constraint-Bruch, FIN-08 auf gemessener Leistung unausführbar und
`menge_anteil` — das genau für die Teilentnahme existiert — unbenutzbar.

Der Schutz dort ist deshalb eine **Summe**: `fin.pruefe_aufmass_menge()`,
aufgeschoben, vergleicht Σ `menge_anteil` aller wirksamen Zeilen gegen die
gemessene Menge des Blattes und schreibt den Stand nach `aufmass.abgerechnet_menge`
zurück (§2.3 Punkt 5). Verglichen wird in **Beträgen**, nicht mit `>`: ein
Rückbaublatt misst negativ, und `−40 > −30` wäre dort die falsche Richtung.

**Die gemessene Menge ist Σ `aufmass_zeile.menge`, nicht `aufmass.menge`.**
`05-FINANZEN.md` §4.4 nennt eine Spalte `aufmass.menge`; `0072` legt sie nicht an,
und sie gehört auch nicht dorthin — gemessen wird auf der Zeile. Daraus folgt
eine offene Frage (O-340).

### D-363 · Der Storno übernimmt den Beleg unwirksam, die Neuausstellung wirksam

`uebernimmQuellen()` kopiert die Herkunftszeilen über `position_nr` (beide
Vorgänge legen die Zeilen mit derselben Nummer an, `rp_position_uk` macht sie
eindeutig).

* Das **Storno** übernimmt mit `wirksam = false` und gespiegeltem `menge_anteil`.
  Es bezeugt, *was* aufgehoben wurde, und beansprucht nichts — sonst stünden nach
  jedem Storno zwei wirksame Zeilen auf demselben Zeiteintrag.
* Das **Original** gibt seine Quellen im selben Vorgang frei (`gibQuellenFrei`):
  `wirksam` fällt, `zeiteintrag.abgerechnet_am` wird gelöscht, die aufgelaufene
  Aufmaßmenge sinkt.
* Die **Neuausstellung** übernimmt mit `wirksam = true` und beansprucht die
  Quellen neu. Das geht nur, weil die Freigabe vorher lief.

`fin.quelle_unveraenderlich()` lässt an einem festgeschriebenen Beleg genau diese
eine Bewegung zu: `wirksam` von `true` nach `false`. Alles andere — jede Spalte,
auch eine später hinzukommende, verglichen über `to_jsonb` — ist gesperrt, und
ein erloschener Anspruch lebt nicht wieder auf.

### D-364 · Der Index und `abgerechnet_am` sind kein Paar aus Original und Kopie

Beide existieren, und keiner ersetzt den anderen (§4.4):

* `zeiteintrag.abgerechnet_am` / `.abrechnung_referenz` beantworten „ist diese
  Stunde abgerechnet, und auf welchem Beleg?" **ohne Join** und treiben die
  Arbeitsliste, die entscheidet, was überhaupt in eine Rechnung kommt.
* Der partielle Unique-Index verhindert die zweite Abrechnung auch dann, wenn
  diese Liste falsch gelesen wurde.

Geschrieben wird der Spiegel von `markiereQuellenAbgerechnet()` **in der
Festschreibungstransaktion** (§5.6 Schritt 6), nie in einem Nachlauf: sonst gäbe
es festgeschriebene Rechnungen, deren Stunden weiter als offen gelten, der
nächste Lauf nähme sie ein zweites Mal auf, und der Index meldete den Fehler an
einer Stelle, an der niemand nach der Ursache sucht. Die Funktion zählt die
getroffenen Zeilen und wirft, wenn es weniger sind als erwartet — unter FORCE RLS
trifft ein UPDATE ohne passende Policy null Zeilen, **geräuschlos**.

### D-365 · `zeiteintrag` bekommt zwei schmale UPDATE-Policies aus der Finanzdomäne

`t_mandant` auf `zeiteintrag` verlangt im `WITH CHECK` `zeit.schreiben`. Eine
Buchhaltung hält das nicht und muss es nicht halten, um eine Rechnung
festzuschreiben. Ohne eigene Policy schriebe `markiereQuellenAbgerechnet()`
nichts — lautlos.

`0088` legt deshalb an, was `05-FINANZEN.md` §2.3 Punkt 6 von der Zeitdomäne
verlangt: `z_finanz_abrechnung` (`finanzen.festschreiben`, nur von *nicht
abgerechnet* nach *abgerechnet*) und `z_finanz_freigabe` (`finanzen.stornieren`,
nur die Gegenrichtung). Beide sind **schmaler** als der gewöhnliche Weg, nicht
breiter: ein UPDATE auf Beginn, Ende oder Zuordnung passt durch sie ebenso wenig
wie durch `kern.zeiteintrag_unveraenderlich()`. Dazu kommt der Fremdschlüssel,
den `0034` angekündigt hatte (`z_abrechnung_referenz_fk`).

### D-366 · FIN-18 fragt eine ZAHL, keine Zeile — über `fin.auftrag_erfasste_minuten`

Die naheliegende Prüfung liest `zeiteintrag_auftrag`. Diese Sicht läuft mit
`security_invoker` (0051), und eine Rolle ohne `zeit.lesen` bekäme dort **null
Minuten** — die Warnung schlüge dann bei jedem Auftrag an, auch bei denen mit
tausend erfassten Stunden. Eine Warnung, die immer kommt, wird nach dem dritten
Mal ungelesen weggeklickt, und dann ist die eine echte auch weg.

`fin.auftrag_erfasste_minuten(uuid)` ist deshalb `SECURITY DEFINER` (Eigentümer
`cse_definer`, K-01), prüft Mandant und `finanzen.festschreiben` ausdrücklich
gegen die Sitzungs-GUCs und gibt **eine Zahl** zurück: keinen Namen, keine
Schicht, keine Beschäftigung. Die Buchhaltung erfährt, *dass* Zeit erfasst wurde,
nicht von wem (EMP-13).

### D-367 · Die FIN-18-Warnung fällt VOR der Nummernvergabe, und ein Storno wird nie an ihr gehindert

Sie steht in `finalisiere()` als Schritt 2b — nach dem §14-Validator, vor
Definer-Aufruf A. Danach wäre sie wertlos: die Nummer ist gezogen, der Zähler
unwiderruflich weitergerückt, und der einzige Rückweg wäre ein Storno auf einen
Beleg, den niemand ausstellen wollte.

Übergehbar ist sie nur mit einer Begründung von mindestens zehn Zeichen, und die
steht danach an zwei unveränderlichen Stellen: im `audit_log`
(`rechnung.fin18_uebergangen`) und im Pflichtfeldbericht, der mit
`rechnung_snapshot` eingefroren wird. Eine `rechnungsart = 'storno'` ist von der
Prüfung ausgenommen — sie hebt einen Beleg auf, der schon draußen ist, und die
Warnung träfe sonst den, der den Fehler behebt, statt den, der ihn gemacht hat.

### D-368 · Der Cent-Anteil je Quelle entsteht durch Verteilung, nicht durch eine zweite Multiplikation

`verteileAufQuellen()` verteilt den **Zeilenbetrag** nach dem
Größter-Rest-Verfahren auf die Quellen; die Summe ist exakt der Zeilenbetrag.

Jede Quelle einzeln zu rechnen wäre der naheliegende Weg und falsch: 187 Minuten
× 42,50 €/h gerundet, dreimal addiert, ergibt nicht denselben Betrag wie 494
Minuten × 42,50 €/h gerundet. Der Unterschied sind ein bis zwei Cent — genug,
damit die Detailansicht einer Rechnungszeile ihrer eigenen Summe widerspricht,
und genau das verspricht DSH-04 nicht zu tun. Die Reihenfolge der Nachschläge ist
deterministisch (größter Rest, bei Gleichstand die frühere Quelle), weil zwei
Ausgaben derselben Rechnung sonst zwei verschiedene Aufteilungen zeigten.

Entsprechend rundet `fuegeZeitPositionHinzu()` die Menge **einmal**, am Ende:
Σ Minuten / 60 auf drei Stellen. Der `menge_anteil` je Quelle ist die gerundete
Einzelentnahme und damit ein Beleg, keine Rechengröße.

### D-369 · Die Herkunft steht in der kanonischen Nutzlast, `wirksam` nicht

`ladeRechnungVollstaendig()` füllt jetzt `positionen[].quellen` (§5.3) — bis
PR 49 stand dort ein leeres Array mit dem ehrlichen Vermerk „keine Quelle
hinterlegt". Damit steht der Beleg im **Hash**: wer später behauptet, eine andere
Stunde sei abgerechnet worden, widerspricht einem Dokument, das sich nicht mehr
ändern lässt.

`wirksam` steht ausdrücklich **nicht** in der Nutzlast. Es fällt beim Storno, also
nach der Festschreibung; im Hash machte es jede stornierte Rechnung
unverifizierbar — dieselbe Überlegung, die `versendet_am` von der Rechnungszeile
fernhält (K-12).

### D-370 · `PositionAnlegen.quellen` ist Pflicht, und es gibt keinen Vorgabewert

Die Signatur bildet ab, was die Datenbank ohnehin erzwingt. Ein Dienst, der bei
fehlender Angabe still eine `manuell`-Zeile mit einer erfundenen Begründung
schriebe, wäre genau die erfundene Angabe, gegen die FIN-07 steht. `vonHand(…)`
ist die Kurzform für den beleglosen Fall und verlangt den Grund als eigenen
Parameter, damit er an der Aufrufstelle steht.

Betroffen sind die drei vorhandenen Aufrufstellen (API-Route und zwei
Isolationsdateien aus PR 46); sie tragen jetzt eine benannte Herkunft.

### D-371 · `rechnungsposition_quelle` ist intern — ohne `t_kunde`, mit einzweigiger Decke

Sie nennt die `zeiteintrag`-Zeilen hinter einer Rechnungsposition, also wer welche
Stunden gearbeitet hat. DSH-04 („jede Zahl führt auf die Sätze dahinter") ist eine
Forderung an die **internen** Auswertungen; ein Kunde bekommt die Rechnungszeile,
den Leistungsnachweis und das Aufmaßblatt über seine eigenen Dokumente — nie den
Dienstplan (§1.4, EMP-13).

Das `WITH CHECK` von `t_mandant` nennt `finanzen.schreiben` **oder**
`finanzen.stornieren`: das Erlöschen von `wirksam` ist ein UPDATE, und die
Storno-Rolle hält Schreiben nicht zwingend. Ohne diesen zweiten Zweig ließe sich
eine Rechnung stornieren, ohne ihre Quellen freizugeben — die Stunden blieben für
immer gesperrt.

### Offen, neu aufgeworfen in PR 49

| # | Question | Blocks |
|---|---|---|
| O-340 | **Darf ein Aufmaßblatt Zeilen in verschiedenen Einheiten tragen — m², m und Stk auf demselben Blatt?** Der Schutz gegen die doppelte Abrechnung eines Aufmaßes ist nach § 16 VOB/B eine Summe und kein Unique-Index (D-362); die Obergrenze ist die gemessene Menge des Blattes. `aufmass_zeile` führt `einheit` je Zeile, `aufmass` selbst keine — eine Blattsumme über gemischte Einheiten addierte Äpfel und Birnen, und die Sperre säße dann an der falschen Zahl. Falls gemischte Blätter vorkommen, ist die Obergrenze je Einheit oder je LV-Position zu bilden; das ist eine Zeile in `fin.pruefe_aufmass_menge()`. Bis zur Antwort prüft der Auslöser gegen die Blattsumme, und `aufmass.abgerechnet_menge` trägt sie. | BAU-02, FIN-07, FIN-08, § 16 VOB/B, `aufmass`, `rechnungsposition_quelle` |

---

## Entschieden in PR 47 — §14-UStG-Pre-Flight-Validator, Leistungszeitraum, Kleinbetragsrechnung · PHASE 6, NICHT IN DIESEM ZWEIG

Sieben Entscheidungen. Zwei davon lösen einen Widerspruch zwischen zwei
Vorgabedokumenten, zwei halten fest, wo die Umsetzung vom Wortlaut eines
Kapitels abweicht, und drei benennen eine Stelle, an der ein plausibler Weg
still nichts geprüft hätte.

### D-320 · Der Validator ist ein reiner Dienst — und die Datenbank hält die Bedingung trotzdem

Die Abnahme verlangt beides, und es sind zwei verschiedene Aussagen. „Ein
reiner Dienst, den Festschreibung, Vorschau und API rufen" ist eine Aussage
über den Code: `src/server/services/finanz/ustg14.ts` führt die Regelliste als
**Daten** (`REGELN`), `pruefePflichtfelder()` ist eine Funktion von Daten auf
Daten, und die Wache `validator-nicht-uebersprungen` bricht den Build, wenn
`finalisiere()` den Aufruf verliert oder jemand eine zweite Fassung schreibt.

„Ein Aufrufer, der ihn überspringt, kann trotzdem nicht festschreiben" ist eine
Aussage über die Datenbank, und TypeScript kann sie nicht halten: `cse_app`
darf `fin.rechnung_nummer_ziehen` unmittelbar rufen. Deshalb trägt
`0085_rechnung_pflichtfelder.sql` einen **aufgeschobenen** Auslöser mit der
Teilmenge der Regeln, die sich ohne Auslegung prüfen lässt — beide Beteiligten
mit Name und Anschrift, Steuernummer oder USt-IdNr., mindestens eine
Leistungszeile, mindestens eine Steuerzeile. Der Validator ist das, was einem
Menschen **vorher** sagt, welches Feld fehlt; der Auslöser ist das, was
verhindert, dass es ohne ihn geht.

Regeln, die eine Auslegung brauchen — §14b-Aufbewahrungshinweis, §13b, §48
EStG —, stehen ausdrücklich **nicht** im Auslöser. Eine halb abgebildete
Rechtsregel in plpgsql ist eine Behauptung, die niemand liest.

### D-321 · Der Pflichtfeld-Auslöser ist `SECURITY DEFINER` — gemessen, nicht gewählt

Die erste Fassung war ein Invoker, mit Begründung: ein aufgeschobener Auslöser
feuert beim COMMIT, also lange nachdem die beiden Definer-Aufrufe des §5.6
zurückgekehrt sind, und sollte deshalb als `cse_app` laufen — mit genau den
Policies, unter denen Schritt 4 derselben Transaktion (`ladeRechnungVollstaendig`)
`mandant`, `kunde`, `rechnungsposition` und `rechnung_steuer` ohnehin schon
liest.

**Sie tat es nicht.** PostgreSQL feuert einen aufgeschobenen Auslöser im
Sicherheitskontext *der auslösenden Anweisung*, und die ist hier das `UPDATE`
in `fin.rechnung_nummer_ziehen` — also `cse_definer`. Der Auslöser scheiterte
an „permission denied for table rechnungsposition", und zwar bei **jeder**
Festschreibung; die Isolationsdatei hat es beim ersten Lauf gezeigt.

Also `security definer`, Eigentümer `cse_definer` (K-01), plus vier schmale
**Lese**policies. `0077` zählt sechs `cse_definer`-Policies auf und sagt „und
keine siebte" — diese vier sind keine Widerlegung, sondern die Fortschreibung
derselben Regel: jene sechs beschreiben, was die zwei **schreibenden**
Definer-Aufrufe dürfen; hier kommt eine **Prüfung** dazu, sie liest
ausschließlich, nur im aktiven Mandanten, und auf `kunde` nur die zehn Spalten
der Anschrift (K-05 — `zahlungsziel_tage`, `debitorennummer` und `mahnsperre_*`
stehen bewusst nicht dabei, und der Auslöser liest deshalb spaltenweise statt
mit `select *`).

Nebenbefund derselben Runde: `kleinbetrag_grenze` hatte seit `0075` einen
`grant select` an `cse_definer`, aber keine Policy für ihn. Unter FORCE RLS ist
das kein Lesezugriff — `fin.kleinbetrag_greift` hätte die Schwelle nie
gefunden und die Erleichterung wäre für den Auslöser immer „greift nicht"
gewesen. Die sichere Richtung, aber aus dem falschen Grund. `0085` ergänzt die
Policy.

### D-322 · §33 UStDV wird mit `<` gelesen — und `ist_kleinbetrag` bleibt, wie PR 46 es rechnet

Zwei Vorgaben widersprechen sich um einen Cent. **SPEC FIN-13** sagt
„Kleinbetragsrechnung **< €250**"; der **Verordnungstext des §33 UStDV** sagt
„deren Gesamtbetrag 250 Euro **nicht übersteigt**", also ≤ 250 €. Die Abnahme
von PR 47 verlangt ausdrücklich „249,99 € schreibt sich fest, 250,00 € nicht" —
sie folgt der SPEC.

Genommen wird die **strengere** Lesart (`<`): eine Rechnung mit vollständigen
Empfängerangaben ist nie rechtswidrig, eine zu Unrecht als Kleinbetrag
ausgestellte schon. Die Frage geht als **O-301** an den Steuerberater; die
Antwort ist ein Vergleichsoperator an genau zwei Stellen
(`fin.kleinbetrag_greift`, `kleinbetragLage`).

`fin.rechnung_nummer_ziehen` (PR 46) vergleicht mit `<=` und setzt
`ist_kleinbetrag` entsprechend. Diese Funktion wird **nicht** umgebaut — sie
ist festgeschriebener Bestand eines abgeschlossenen PRs. Stattdessen hängt die
Erleichterung nicht an der Spalte: `fin.kleinbetrag_greift` liest die Schwelle
selbst. Hinge sie an `ist_kleinbetrag`, unterschieden sich Auslöser und
Validator bei genau 250,00 € — der Validator blockierte, die Datenbank ließe
durch, und wer den Validator überginge, bekäme die Erleichterung geschenkt.
`ist_kleinbetrag` bleibt damit die **Tatsache** „auf oder unter der Schwelle",
und „die Erleichterung greift" ist eine zweite, engere Frage (sie nimmt
zusätzlich die Fälle des §13b und der innergemeinschaftlichen Lieferung aus —
Kategorie `AE` und `K`).

Und die Schwelle steht in `kleinbetrag_grenze`, nicht im Code: dieselbe
Rechnung mit einer anderen Zeile hat ein anderes Ergebnis, und genau das prüft
`tests/isolation/rechnung-pflichtfelder.test.ts`.

### D-323 · Der §14-Abs.-4-Nr.-9-Hinweis ist eine WARNUNG — Abweichung von §6

`02-datenmodell/05-FINANZEN.md` §6 führt den Aufbewahrungshinweis nach
§14 Abs. 4 Nr. 9 UStG / §14b Abs. 1 S. 5 als **fehler**. Er gilt bei einer
Leistung an einen Nichtunternehmer **im Zusammenhang mit einem Grundstück** —
und ob eine Leistung grundstücksbezogen ist, steht in keiner Spalte dieser
Plattform.

Beide naheliegenden Auswege sind falsch: „jede Leistung an einen Privatkunden"
wäre eine erfundene Rechtsregel (K-17), und ein blockierender Fehler ohne
erfüllbare Bedingung machte jede Privatkundenrechnung unausstellbar. Die
Prüfung meldet deshalb eine **Warnung**, die den Fall benennt und sagt, dass
der Hinweis bis zur Klärung von Hand in den Fußtext gehört (**O-300**).

### D-324 · Die Vorschau liegt unter `/api/rechnungen/pruefung` und verlangt `finanzen.lesen`

`05-API-KARTE.md` §C.9 schreibt `POST /api/finanzen/rechnungen/[id]/preflight`.
Dieses Modul führt seine vier vorhandenen Adressen flach unter
`/api/rechnungen/…` (D-252); eine fünfte in einem anderen Schema wäre zwei
Konventionen in einem Ordner. Der Pfad folgt deshalb den Geschwistern, die
Methode (`POST`) folgt der API-Karte.

Das Recht ist `finanzen.lesen` und **nicht** `finanzen.festschreiben`: der
Bericht sagt, welches Pflichtfeld fehlt, und stellt nichts aus. Mit dem engeren
Recht müsste die Buchhaltung jemanden mit Festschreibungsrecht fragen, um einen
Tippfehler in der Kundenanschrift zu finden. Die Seite
`/portal/[mandant]/finanzen/rechnungen/[id]/pruefung` steht so in
`04-SEITENKARTE.md` §5.14 — Seitenpfade schlagen jede andere Quelle — und
trägt dort dasselbe Recht.

### D-325 · `REGELWERK_VERSION` wandert nach `ustg14.ts`, die angewandte Grenze in den Snapshot

PR 46 legte `'ustg14-nicht-gebaut'` mit `geprueft: false` ab — die ehrliche
Aussage, solange es keinen Validator gab. Ab jetzt kommt die Fassung von dem
Dienst, der die Regeln führt (`ustg14.v1`); `rechnung.ts` exportiert sie nur
weiter, damit es keine zweite Konstante gibt, die niemand pflegt. Belege aus
der Zeit davor bleiben an ihrer alten Fassung erkennbar.

Zusätzlich trägt die kanonische Nutzlast jetzt `kleinbetrag_grenze_cent` — den
Wert, gegen den entschieden wurde (FIN-13). `ist_kleinbetrag` allein sagt „ja"
oder „nein"; ohne die Zahl ließe sich die Entscheidung nach der nächsten
Änderung des §33 UStDV nicht mehr begründen. Ist die Schwelle ein Platzhalter,
steht dort `null` — genau wie `ist_kleinbetrag` dann `false` ist.

### D-326 · Die fortlaufende Nummer wird vor dem Zug als „es gibt einen ziehbaren Kreis" geprüft

§6 Regel 5 verlangt „`nummer` drawn from the circle and unique per mandant".
Zum Zeitpunkt der Vorabprüfung gibt es die Nummer noch nicht — sie entsteht
erst in der Festschreibungstransaktion (§5.5), und das ist der Grund, warum
verworfene Entwürfe keine Lücke hinterlassen. Geprüft wird deshalb, ob eine
entstehen **kann**: ein offener, bestätigter, lückenloser Kreis auf dem OFFENEN
Schlüssel (nie über das heutige Jahr — ein `nie`-Kreis trägt `jahr = 0`).

Und die Regel entfällt bei der Kleinbetragsrechnung **nicht**. Sie hat keinen
empfängerbezogenen Teil, und die Lückenlosigkeit des §14 Abs. 4 Nr. 4 UStG gilt
für jeden ausgestellten Beleg — die ältere Lesart „Regeln 2 und 5 entfallen"
hätte sich als Erlaubnis lesen lassen, eine Rechnung ohne Nummer auszustellen.

### Offen, neu aufgeworfen in PR 47

| # | Question | Blocks |
|---|---|---|
| O-300 | **Erbringt die Gruppe Leistungen an Privatkunden im Zusammenhang mit einem Grundstück — und soll der §14b-Hinweis dann auf JEDER Privatkundenrechnung stehen oder nur auf den grundstücksbezogenen?** §14 Abs. 4 Nr. 9 UStG verlangt bei einer solchen Leistung an einen Nichtunternehmer den gedruckten Hinweis auf die zweijährige Aufbewahrungspflicht (§14b Abs. 1 S. 5 UStG); für Gebäudereinigung und Bau ist das der Regelfall und keine Lehrbuchecke. Ob eine Leistung grundstücksbezogen ist, führt die Plattform nirgends — im zweiten Fall braucht `auftrag` oder `leistungskatalog_position` ein Merkmal. Bis zur Antwort ist die Regel eine **Warnung** und kein blockierender Fehler (D-323). | FIN-04, LEG-05, `§14 Abs. 4 Nr. 9 UStG`, `services/finanz/ustg14.ts` |
| O-301 | **Gilt bei genau 250,00 € brutto die Erleichterung des §33 UStDV?** Der Verordnungstext („deren Gesamtbetrag 250 Euro nicht übersteigt") sagt ja, SPEC FIN-13 („Kleinbetragsrechnung < €250") sagt nein — die beiden gehen um einen Cent auseinander. PR 47 nimmt die strengere Lesart und verlangt bei genau 250,00 € die vollen Empfängerangaben (D-322). Die Antwort ist ein Vergleichsoperator an genau zwei Stellen: `fin.kleinbetrag_greift` (0085) und `kleinbetragLage()` in `services/finanz/ustg14.ts`. Sie hängt an O-175 — ob die Gruppe Kleinbetragsrechnungen überhaupt ausstellt. | FIN-13, `§33 UStDV`, `kleinbetrag_grenze` |

## Entschieden in PR 48 — Fünf Abrechnungsarten hinter einem Interface · PHASE 6, NICHT IN DIESEM ZWEIG

Diese Entscheidungen lösen Widersprüche zwischen den Vorgabedokumenten oder
halten eine Stelle fest, an der die Umsetzung vom Wortlaut abweicht. Sie stehen
hier, weil die nächste Person sonst dieselbe Stelle noch einmal entscheidet —
und möglicherweise anders.

### D-340 · Die Migrationen heissen `0086`/`0087`, nicht `0069`/`0070`

Der PR-Plan nennt `0069_abrechnungsart` und `0070_rechnungsposition_typ`. Beide
Nummern sind seit Phase 5 vergeben (`0069_posten`, `0070_wachbuch`), und `0085`
und `0088` sind in denselben Tagen von PR 47 und PR 49 belegt worden. Die
Nummern laufen weiter; die Migrationen tragen ihren Plannamen im Kopf, damit die
Zuordnung lesbar bleibt. Dieselbe Entscheidung hatten PR 42, 44 und 45 schon zu
treffen.

### D-341 · Der TypeScript-Schlüssel heisst `stundenbasiert`, nicht `stunden`

`05-API-KARTE.md` §D.7 schreibt `AbrechnungsartSchluessel = 'stunden' | …`, der
Eigentümer des Vokabulars (`02-CRM-OPERATIONS.md` §2, K-21) schreibt
`stundenbasiert`. Es gilt der Eigentümer — und zwar **wörtlich**, nicht
übersetzt.

Eine Übersetzungsschicht zwischen Aufzählungswert und Dienstschlüssel wäre zwei
Vokabulare für eine Sache. Sie hält genau so lange, bis jemand die eine Hälfte
pflegt und die andere nicht; danach schreibt eine Strategie eine Zeile, deren
eingefrorene `abrechnungsart` leer bleibt oder nicht castbar ist — und das
merkt niemand, weil die Beträge stimmen. Die vier übrigen Schlüssel sind in
beiden Dokumenten identisch.

### D-342 · Eine Abrechnungsart ist ein EINGABETYP, kein generischer Parameter

§D.7 entwirft `Abrechnungsart<E>` und ein Register
`Record<AbrechnungsartSchluessel, Abrechnungsart<never>>`. Das ist nicht
benutzbar: `never` macht jede Methode unaufrufbar, und ein generischer
Registereintrag zwingt jeden Aufrufer, den Eingabetyp vorher zu kennen — also
genau die Fallunterscheidung, die das Register beseitigen soll.

Umgesetzt ist deshalb **eine** `AbrechnungsEingabe` mit den optionalen Feldern,
die einzelne Arten brauchen (`aufmassIds`, `fertigstellungBp`). Das Register ist
eine `Map<string, Abrechnungsart>` und **nicht** auf die fünf Schlüssel getippt:
ein `Record<AbrechnungsartSchluessel, …>` verlangte für eine sechste Art eine
Typänderung — also genau die Änderung, die Abnahme (5) ausschliesst.

### D-343 · Eine Stundenlohnzeile führt MINUTEN, mit `preis_basismenge = 60`

Eine Menge ist `numeric(12,3)`. In Stunden ausgedrückt sind 100 Minuten
`1,667`, und `1,667 × 25,00 €` ist 41,68 €, während `100 × 25,00 € / 60`
41,67 € ergibt. Ein Cent, jeden Monat, auf einem Beleg, der sich nach der
Festschreibung nicht mehr ändern lässt — und die Zeile widerspräche sich
ausserdem selbst: §4.3 verlangt
`netto_cent = rundeCent(menge / preis_basismenge × einzelpreis_cent)`.

Die Zeile trägt deshalb die Minuten als Menge und den Stundensatz über
`preis_basismenge = 60` — genau der Fall, für den BT-149/150 existiert. Dafür
kommen zwei Mengeneinheiten als PLATZHALTER hinzu: `min` (UN/ECE `MIN`) und
`tag` (`DAY`, für den angebrochenen Monat). Beide unter O-174 wie die sechs aus
`0075`.

Die Alternative — den Nettobetrag exakt aus Minuten rechnen und eine gerundete
Stundenzahl daneben drucken — wurde verworfen: dann steht auf der Rechnung eine
Menge, mit der der Betrag nicht nachrechenbar ist, und genau das prüft ein
Betriebsprüfer.

### D-344 · `rechnungsposition.abrechnungsart` wird NICHT verpflichtend

`05-FINANZEN.md` §4.3 nennt
`CHECK (positionsart <> 'leistung' OR abrechnungsart IS NOT NULL)`, und `0075`
hat die Bedingung ausdrücklich diesem PR überlassen — „sie kommt mit dem
Katalog, der sie erfüllbar macht".

Erfüllbar macht der Katalog sie trotzdem nicht überall. Eine von Hand erfasste
Zeile auf einer einmaligen Rechnung an einen Kunden, zu dem es keinen `auftrag`
gibt, hat keine Abrechnungsart — und welche der fünf das wäre, hat niemand
entschieden (O-04). Die Bedingung zu übernehmen hiesse, dass `fuegePosition
Hinzu()` eine setzen muss, und jeder Wert dort wäre ein erfundener
Produktionswert (K-17).

Umgesetzt ist die Hälfte, die entscheidbar ist und die eigentliche Gefahr
abdeckt: `CHECK (vertrag_abrechnung_id IS NULL OR abrechnungsart IS NOT NULL)`.
Eine Zeile, die eine Abrechnungskonfiguration NENNT, muss sagen, welche Art
daraus angewandt wurde — sonst verweist der Beleg auf eine Konfiguration, deren
Art sich seither geändert haben kann, während die eingefrorene Kopie leer ist.
Mit der Antwort auf O-04 wird die Bedingung auf die Fassung des §4.3
verschärft; der Marker steht an der Bedingung.

### D-345 · Die offenen Regeln der fünf Arten sind PARAMETER, keine Vorgabewerte

O-04 fragt nach den Regeln, nicht nach den Namen: Minutenrundung,
Teilmonatsbehandlung, Teilfertigstellung, abrechenbare Aufmasszustände,
Mindestabruf. `05-API-KARTE.md` §D.7 verlangt, dass jede Strategie ihre
Parameter „als Konfiguration mit einem als PLATZHALTER gekennzeichneten Wert"
führt und die Festschreibung verweigert, solange der Parameter nicht gesetzt
ist.

Umgesetzt auf `vertrag_abrechnung.parameter` (jsonb, ohne Geldbetrag — Geld
steht in den getippten Cent-Spalten). Fehlt ein Schlüssel, liefert `pruefe()`
einen **blockierenden** Befund mit der Frage im Klartext und `O-04` daneben,
und `positionen()` wirft `AbrechnungFehler('parameter_offen')`. Es gibt keinen
Vorgabewert und keinen Rückfall.

Zwei Feinheiten, die sonst verlorengingen:

- **`einzelabruf.mindestabrufmenge` darf ausdrücklich `null` sein.** „Keine
  Mindestabnahme" ist eine ENTSCHEIDUNG und muss im Vertrag stehen; die
  Abwesenheit des Schlüssels ist etwas anderes und wird abgewiesen.
- **`monatspauschale.teilmonat = 'arbeitstage'` rechnet nicht.** Welche Tage
  Arbeitstage dieses Vertrages sind (Mo–Fr? Mo–Sa nach §3 BUrlG? welche
  Feiertagsliste?) steht nirgends, und O-167 ist offen. Ein voller Monat wird
  auch in diesem Modus berechnet — dort gibt es nichts zu teilen.

### D-346 · Ein Aufmass wird beim Abrechnen NICHT neu ausgewertet

Abnahme (3) verlangt das gespeicherte Ergebnis. Umgesetzt: die Strategie liest
`aufmass_zeile.ergebnis_skaliert` (ganze Zahl, 10⁻⁴ der Einheit) und
`rechenansatz` **als Text**; `rechenansatz_ast` und `parser_version` werden
nicht einmal selektiert. Was diese Datei nicht liest, kann sie nicht
versehentlich neu auswerten — und ein geänderter Übermessungsschritt (O-23)
veränderte sonst rückwirkend, was ein Auftraggeber unterschrieben hat.

Summiert wird in der festen Skala und **einmal** auf `numeric(12,3)`
projiziert. Je Zeile zu projizieren und dann zu summieren rundete so oft, wie
das Blatt Zeilen hat.

Der Rechenansatz steht wörtlich in `beschreibung`, mit der Blattnummer davor.

### D-347 · Ein nicht gegengezeichnetes Aufmass wird VERWEIGERT, nicht übersprungen

Die Blätter werden der Strategie ausdrücklich genannt (`aufmassIds`) und nicht
gesucht. Ein Blatt, das die Abfrage still überginge, weil sein Zustand nicht
passt, ergäbe eine Rechnung, der eine Leistung fehlt — und niemand sähe, dass
etwas fehlt. Ein genanntes Blatt in einem nicht abrechenbaren Zustand ist
deshalb ein getippter Fehler (`aufmass_nicht_abrechenbar`), und die Vorprüfung
meldet denselben Sachverhalt als blockierenden Befund.

`gegengezeichnet` ist immer abrechenbar — dass eine vom Auftraggeber
unterschriebene Aufmassurkunde gilt, ist keine offene Frage. Die **einseitige
Feststellung** nach §14 Abs. 2 VOB/B ist ein eigener Zustand (B10) und gilt nur,
wenn der Vertrag sie ausdrücklich führt (O-04).

Eine Zeile ausserhalb des Leistungsverzeichnisses hat keinen vereinbarten
Einheitspreis und wird ebenfalls abgewiesen: sie gehört in einen Nachtrag
(BAU-05, §2 Abs. 6 VOB/B), und mit null Euro durchzulaufen wäre geleistete
Arbeit, die niemand berechnet.

### D-348 · Der Einheitspreis kommt aus `app.lv_preis_lesen()`, nicht aus der Spalte

`lv_position.einheitspreis_cent` ist `cse_app` spaltenweise entzogen (K-05,
`0071` §8) — ein `select p.einheitspreis_cent` scheitert mit „permission denied
for table lv_position". Das ist kein Hindernis, sondern die Absicht: der
Zugriff auf einen Kalkulationspreis prüft `bau.preis_lesen` und landet im
Protokoll. Die Strategie ruft deshalb den Definer-Leser. Gibt er NULL zurück,
weist sie benannt ab und nennt beide möglichen Gründe (kein Preis hinterlegt /
Recht fehlt), statt mit null Euro zu rechnen.

### D-349 · Die Steuersatzgruppe wird aus der Leistungszeile aufgelöst, nie geraten

`auftrag_leistung` trägt `steuersatz_bp` und `steuer_kennzeichen`; der Katalog
`steuersatz_gruppe` trägt dieselben zwei Angaben. Gefunden wird über das Paar,
**am Leistungsende** und nicht am heutigen Tag. Findet sich keine Gruppe oder
finden sich zwei — der §13b-Fall, in dem `bau` und `gebaeudereinigung` beide
Satz 0 und dasselbe Kennzeichen tragen —, wird ein getippter Fehler geworfen.
Eine von zweien zu wählen hiesse, die §13b-Kategorie zu erfinden, und die steht
gedruckt auf dem Beleg (§14a Abs. 5 UStG, O-104). Die Ermittlung selbst gehört
FIN-09 und PR 51.

Für eine auftragsweite Pauschale müssen alle lebenden Leistungszeilen denselben
Satz tragen; sonst hat die Pauschale keinen eindeutigen, und der Fehler sagt,
dass die Konfiguration dann je Leistungszeile gehört (O-53).

### D-350 · Der Herkunftstyp der Abrechnungsschicht ist ein eigener, mit EINER Abbildung

`rechnungsposition_quelle` und ihr Vokabular gehören PR 49. Die
Abrechnungsschicht führt einen eigenen `HerkunftVerweis` und bildet ihn an
genau einer Stelle (`alsQuellen` in `abrechnungsart/index.ts`) auf
`QuelleEingabe` ab. Ändert der Nachbar seine Form, ist das eine Funktion und
nicht fünf Strategien.

Eine Monatspauschale und ein Pauschalpreis-Los tragen dabei
`{ typ: 'manuell', notiz: … }` mit der Vertragsabrechnung im Text — nicht einen
erfundenen Verweis auf eine Leistungszeile, die die Konfiguration gar nicht
nennt. FIN-07 verlangt einen BELEG; der Beleg einer Pauschale ist der Vertrag,
und das schreibt die Notiz auch hin.

*(Ende des Phase-6-Blocks — ab hier gilt wieder der Stand dieses Zweigs.)*

---

## Entschieden beim Phase-5-Abschluss — die Demodaten und die Sprache einer Prüfung

Die Browsersuite fiel an wechselnden Stellen um, und die Ursachen lagen nicht
in der Anwendung, sondern in dem, was sie vorfand. Vier Befunde, jeder mit
Folgen über den Testlauf hinaus.

### D-301 · Der Seed liefert alle vier Portalsprachen aus — jede an einem Menschen

`person.sprache` ist die EINZIGE Quelle der Portalsprache (SEITENKARTE §12).
Eine Prüfung, die Arabisch ansehen wollte, musste die Sprache der einzigen
Mitarbeiterin im Seed umschreiben; `playwright.config.ts` läuft aber
`fullyParallel`, und mehrere Arbeiter schrieben gleichzeitig in dieselbe Zeile.
Das Ergebnis war nicht ein Fehlschlag, sondern ein wandernder: einmal stand
`dir="ltr"` auf der arabischen Prüfung, einmal „Bugün" auf einer deutschen in
einer ganz anderen Datei.

**Entschieden:** der Seed trägt alle vier Sprachen, jede an einer eigenen
Person — Fatima Yildiz deutsch (sie ist die meistgenutzte Fixtur), Amir Haddad
arabisch, Marta Kowalski türkisch, Kwame Mensah englisch. Amir bekommt ein
eigenes Mitarbeiterkonto, und `/dev/anmelden` trägt die Kennung am Knopf, damit
eine Prüfung sich als einen BESTIMMTEN Menschen anmelden kann statt als „den
ersten mit dieser Rolle". Keine Prüfung schreibt mehr in `person`.

### D-302 · Die Browsersuite bekommt für jeden Lauf eine frische Datenbank

Die Suite legt an — Posten, Aufträge, Projekte, Aufmaßblätter, Wachbuchseiten,
Personen —, weil sie das Anlegen prüft. Löschen kann sie nichts: in Finanzen,
Zeiterfassung und Audit gibt es keine harten Löschungen (Invariante 8). Der
zweite Lauf gegen dieselbe Datenbank fand deshalb jede Fixtur doppelt, und
Playwright meldete im strikten Modus Fehler, die wie kaputte Bildschirme
aussahen. Gemessen wurden 24 Fehlschläge im einen Lauf und 38 im nächsten —
derselbe Commit.

**Entschieden:** `pnpm e2e:db` verwirft die Datenbank, migriert, seedet und
importiert den Seiteninhalt. Der Inhaltsimport gehört dazu und ist kein
Zusatz — ohne ihn antwortet `/` mit 404 (PUB-07). Die Datenbankeinstellung
`cse.fenster_schluessel` (K-06) überlebt ein `drop database` nicht und wird
mit gesetzt; ohne sie lässt der Besetzungslauf jede Schicht offen und meldet
„unrecognized configuration parameter".

### D-303 · Die Security bekommt Posten, Plan, Leitung — und Fatima ihre zweite Gesellschaft

D-09 verspricht: ein Mensch, zwei Gesellschaften, zwei Stundenkonten, beide
Schichtlisten. Geliefert wurde eine Gesellschaft. `security` hatte keinen
Posten, keine Planungsserie, keinen einzigen Dienst und ausser zwei
Mitarbeitenden **niemanden** — keine Leitung, die planen, gegenzeichnen oder
entscheiden könnte. Das Mitarbeiterportal zeigte die halbe Wahrheit auf einem
Bildschirm, der vollständig aussah.

**Entschieden:** `src/server/db/seed/security.ts` legt einen Posten mit
Abdeckungsregel an, dazu die Planungsserie, und lässt den ECHTEN Generator
laufen; besetzt wird über `besetzeEinsatz`. Der Besetzungslauf aus `zeit.ts`
ist dafür zu `besetzeUndErfasse` herausgezogen — eine zweite Abschrift wäre
die Stelle, an der die eine Fassung eine Sperre respektiert und die andere sie
vergisst. Der Seed bekommt ausserdem eine `leitung.security@cse-gruppe.de`.

**Und der Dienst liegt dort, wo das ArbZG ihn zulässt.** Der erste Entwurf
setzte ihn auf 14:00–22:00; `besetzeEinsatz` wies ihn zurück, weil die
Reinigung am Folgetag um 06:00 beginnt und zwischen 22:00 und 06:00 acht
Stunden liegen, nicht die elf des § 5 ArbZG. Die Grenzen gelten dem MENSCHEN
und nicht dem Mandanten (D-09) — die zweite Gesellschaft stolperte über die
erste. Genau deshalb läuft der Seed über den Dienst und nicht über ein
`insert`: ein direktes Einfügen hätte die Zeilen geschrieben, der Bildschirm
hätte voll ausgesehen, und der Verstoss wäre täglich vorgeführt worden, ohne
sichtbar zu sein.

### D-304 · Der Qualifikationskatalog war leer — und damit sperrte die Sperre nichts

`qualifikation` und `nachweis` hatten im Seed NULL Zeilen. Das Nachweisregister
aus PR 44 zeigte einen leeren Bildschirm, der Ablaufwächter warnte nie, und
`app.einsatz_qualifikation_erfuellt` beantwortete jede Frage mit „erfüllt",
weil es keine Anforderung gab. Der gefährlichste Zustand war dabei nicht der
sichtbar leere Bildschirm, sondern die grüne Einteilung.

**Entschieden:** vier Katalogeinträge, jeder mit seiner Rechtsgrundlage —
Sachkundeprüfung und Unterrichtung nach §34a Abs. 1a GewO, Bewacherausweis nach
§11b GewO, jährliche Unterweisung nach §4 DGUV Vorschrift 1. Nachweise für drei
Menschen in drei Lagen: gültig, in der Warnfrist, abgelaufen. Fatimas
Bewacherausweis ist der abgelaufene Fall — mit Absicht an der meistgenutzten
Fixtur, denn eine Sperre, die nur an einem Randdatensatz zu sehen ist, sieht
beim Abnehmen niemand.

**`kern.nachweis_dokumentpflicht` wird NICHT umgangen.** DOC-01 verweigert
`gueltig`, solange bei einer dokumentpflichtigen Qualifikation keine Urkunde
hängt. Der Seed könnte eine `dokument`-Zeile schreiben, die auf einen
Speicherschlüssel zeigt, unter dem nichts liegt — es ist kein Objektspeicher
angebunden, und eine Zeile, die eine Datei verspricht, die beim Anklicken nicht
da ist, ist die vorgetäuschte Integration, die CLAUDE.md verbietet. Die
betroffenen Nachweise stehen deshalb als `beantragt` da: erfasst, ohne
hinterlegte Urkunde — als das, was sie sind.

### Offen, neu aufgeworfen beim Phase-5-Abschluss

| # | Question | Blocks |
|---|---|---|
| O-341 | **Mit welcher Frist läuft ein Bewacherausweis in Ihrem Haus ab — folgt sie der Wiederholung der Zuverlässigkeitsprüfung oder dem aufgedruckten Datum des Ausweises?** `qualifikation.standard_gueltigkeit_monate` bleibt deshalb leer; das Ablaufdatum steht am einzelnen Nachweis, wo es herkommt. Ein geratener Vorgabewert trägt sich sonst in jeden neu erfassten Nachweis ein und sieht dort aus wie eine geprüfte Angabe — und der 60/30/7-Wächter mahnt zu einem Datum, das niemand geprüft hat. | SEC-02, EMP-08, §11b GewO, `qualifikation` |
| O-342 | **Welche Qualifikation verlangt welcher Posten — genügt die Unterrichtung nach §34a Abs. 1a GewO, oder verlangt der Objektschutz am Kurfürstendamm die Sachkundeprüfung?** Die Sperre ist gebaut und geprüft (`app.einsatz_qualifikation_erfuellt`, `einsatzanforderung`); welche Zeile sie scharf stellt, entscheidet der Vertrag und nicht der Seed. Bis zur Antwort trägt der Demoposten KEINE `einsatzanforderung` — die Einteilung fragt also, findet nichts und lässt durch. | SEC-01, SEC-04, §34a GewO, `einsatzanforderung`, `posten` |
| O-343 | **Sollen die Urkunden zu §34a und Bewacherausweis in der Plattform liegen, oder genügt die Personalakte auf Papier und die Plattform führt nur Nummer und Frist?** `qualifikation.erfordert_dokument` steht für die drei gesetzlichen Einträge auf `true`, und DOC-01 verweigert deshalb `gueltig` ohne hinterlegte Urkunde. Das ist die strengere und damit laute Variante: sie blockiert sichtbar, statt still eine Gültigkeit zu behaupten, für die kein Papier da ist. Antwortet der Mandant mit „Papierakte genügt", ist es ein Boolean. | SEC-02, DOC-01, `qualifikation`, `nachweis`, `dokument` |

### D-305 · Der Konfliktlauf prüft die EINTEILUNG, nicht die erfasste Zeit

Der nächtliche `konflikte_erkennen` lief ab `now()` vorwärts, und
`ladeKandidaten` filtert `e.ende_zeitpunkt > $2`. Eine Schicht, die bereits
vorbei war, konnte damit **niemals** Kandidat werden: ein Plan, der am Vorabend
kurzfristig geändert wurde — Einspringen für eine Kranke, eine vorgezogene
Nachtschicht —, war am nächsten Morgen unprüfbar. Der Verstoß hatte
stattgefunden und stand nirgends.

**Entschieden:** das Fenster reicht sieben Tage zurück. Sieben ist kein runder
Wert, sondern die Woche, in der eine Korrektur noch etwas bewirkt — die
Zeiterfassung ist offen, der Monat nicht abgeschlossen, und die Ruhezeit der
Folgewoche lässt sich noch planen.

**Was das nicht löst, und warum es hier steht statt in einem stillen TODO:**
geprüft wird die **Einteilung**, nicht die erfasste Zeit. Eine Schicht, die
06:00–14:00 geplant war und 06:00–18:00 gearbeitet wurde, fällt weiter durch —
`ladeKandidaten` liest `einsatz_zuordnung`, nicht `zeiteintrag`. Das ist die
Lücke, die zählt: § 16 Abs. 2 ArbZG verlangt die Aufzeichnung der über acht
Stunden hinausgehenden Arbeitszeit, und das ist die tatsächliche, nicht die
geplante.

Der Detektor braucht dafür einen **zweiten Kandidatenweg** über `zeiteintrag`
mit denselben Regeln und demselben Fingerabdruck — sonst entstehen zwei Zeilen
für denselben Tag, eine aus dem Plan und eine aus der Erfassung. Das ist eine
eigene Runde, keine Zeile in diesem PR, und sie gehört vor den ersten echten
Lohnlauf.

### D-306 · HEIC wird abgelehnt, statt zerstört und mit GPS gespeichert

Die Metadaten-Bereinigung schickte HEIC durch dieselbe ISO-BMFF-Boxroutine wie
MP4 — nachvollziehbar, denn HEIC *ist* ein ISO-BMFF-Container. Sie blendet
`udta`, `meta` und `uuid` aus. Bei einem Video ist `meta` Beiwerk; **bei einem
HEIC ist es der Index des Bildes** (`iinf`, `iloc`, `iprp` sagen, wo die
Bilddaten liegen). Mit Nullen überschrieben ist die Datei für jeden Betrachter
kaputt.

Und die Ortsdaten blieben trotzdem drin: EXIF steht in HEIC als eigenes
**Item**, dessen Nutzlast in `mdat` liegt — und `mdat` fasst die Bereinigung nie
an. Das Ergebnis war eine zerstörte Datei mit vollständigem GPS, gemeldet als
`entfernt: true`, und die Oberfläche zeigte dazu „ohne Ortsdaten abgelegt"
(TIM-10). Beide Aussagen falsch; die zweite ist die teure — eine
Reinigungskraft, die ein Objekt fotografiert, gibt damit die Adresse preis, an
der sie nachts allein arbeitet.

**Entschieden:** HEIC wird abgelehnt, mit einem Satz, der sagt was zu tun ist.
Eine item-genaue Bereinigung von Hand — `iloc` auflösen, den EXIF-Extent in
`mdat` finden, ihn nullen, die Offsets halten — ist möglich und genau die Sorte
Arbeit, bei der ein Fehler *still* ist: es sieht bereinigt aus. Solange keine
geprüfte Bibliothek eingerichtet ist, ist die Ablehnung die ehrliche Antwort.

### D-307 · Der Seed muss auf einer nicht leeren Datenbank laufen

`on conflict (slug) do update` setzte `name` und `eigener_nummernkreis`, aber
nicht `ist_rechtseinheit`. Der CHECK verbindet beide: ein eigener Nummernkreis
setzt eine Rechtseinheit voraus. Traf der Zweig eine Zeile, die von anderswo
kam — `tests/isolation/harness.ts` legt `mandant` ohne `ist_rechtseinheit` an,
die Spalte bleibt NULL —, stand danach „eigener Kreis ja, Rechtseinheit
unbekannt" da, und der Seed brach ab.

**Entschieden:** `ist_rechtseinheit` und die drei Identitätsspalten gehen
denselben Weg. Ein Seed, der nur auf einer leeren Datenbank läuft, ist keiner:
danach traut sich niemand mehr, ihn anzufassen, und die Demodaten veralten.

### D-308 · Ein Anmeldekonto ohne Mensch ist an jeder zweiten Stelle ausgesperrt

Vier der acht Seed-Konten — `leitung.security`, `leitung.bau`,
`admin.reinigung`, `admin.bau` — waren reine `benutzer`-Zeilen: keine `person`,
keine `anstellung`, `benutzer.person_id` NULL. Das las sich wie ein
Schönheitsfehler und war keiner. `schreibeEintrag` löst den Urheber einer
Wachbuchseite über `anstellung where person_id = app.aktuelle_person() and
mandant_id = app.aktiver_mandant()` auf und wirft sonst `KeinUrheber` (422,
§10.5). Im geseedeten Bestand konnte die Wachleitung der SSE Security damit
**keine einzige Wachbuchseite führen** — bei genau der Rolle, der SEC-05 das
Buch zuweist. Drei Browserprüfungen scheiterten daran, zu Recht.

**Entschieden:** Jedes Konto, das im Betrieb HANDELT, bekommt seinen Menschen
und seine Beschäftigung in seiner Gesellschaft. Die D-09-Trennung bleibt
unberührt: die `person` ist der Mensch, die `anstellung` die Beschäftigung, und
`benutzer.person_id` ist nur die Verbindung zwischen Anmeldung und Mensch.
`benutzer.name` bleibt die Funktionsbezeichnung des Platzes („Leitung
Security"); der Name des Menschen steht in `person`, und von dort liest ihn das
Wachbuch.

Was dabei NICHT entschieden wurde, ist die Vergütung: `stundensatz_intern`
bleibt für diese Stellen NULL (O-347), `arbeitszeitmodell` auf `unbekannt`
(O-18). Eine plausible Zahl hätte bestätigt ausgesehen und wäre in jede
Kalkulation eingegangen.

Zwei Nebenwirkungen, beide gewollt. Erstens legt der Seed `person` jetzt
**lesend zuerst** an: die Tabelle trägt keinen natürlichen Schlüssel, ein
zweiter Lauf erzeugte bisher fünf weitere Menschen, während die
Beschäftigungen an `anstellung_personalnummer_uk` abprallten — danach zeigte
jedes Konto auf einen Menschen ohne Beschäftigung, und `KeinUrheber` war
zurück. Zweitens stehen diese Stellen jetzt in der Belegschaft, aus der der
Besetzungslauf des Seeds reihum einteilt. Das bleibt so: die Einteilung kennt
keine Sperre gegen planende Personen, und eine einzuführen wäre eine
Geschäftsregel, die niemand entschieden hat. Die Zahl der Einteilungen und
Zeiteinträge ändert sich dadurch nicht, nur ihre Verteilung.

| # | Question | Blocks |
|---|---|---|
| O-347 | **In welcher Beschäftigungsform stehen die Führungs- und Verwaltungskräfte der drei Gesellschaften, und wird ihre Vergütung als Stundensatz geführt oder als Festgehalt, das die Plattform gar nicht trägt?** Seit D-308 tragen `leitung.security`, `leitung.bau`, `admin.reinigung` und `admin.bau` eine `anstellung` — ohne sie kann in diesen Gesellschaften niemand ein Wachbuch führen (§10.5). **Seit der Symmetrie-Ergänzung sind es SECHS**: `admin.security` (S-2004, Nadia Özkan) und `leitung.reinigung` (R-1005, Peter Brandt) kamen dazu, damit jede der drei Gesellschaften eine Verwaltung UND eine Leitung hat. Die Aufzählung stand hier bei vier, und der Seed-Kommentar auch — wer die Frage nach dieser Liste beantwortet hätte, hätte zwei Beschäftigungen ohne Satz übersehen. `stundensatz_intern` bleibt dort NULL: ein erfundener Satz sähe wie eine geprüfte Angabe aus, ginge über `anstellung_id` in jede Kostenrechnung ein und fiele niemandem mehr auf. Lautet die Antwort „Festgehalt", ist die Folgefrage, ob die Plattform es überhaupt führen soll — sie rechnet keinen Lohn (out of scope) und braucht den Betrag nur für die Kalkulation. | EMP-01, D-09, K-05, O-16, O-18, `anstellung.stundensatz_intern` |
| O-346 | **Soll die Plattform HEIC-Fotos annehmen?** Das hiesse, eine Bildbibliothek mit HEIF-Unterstützung in die Auslieferung zu nehmen und sie zu pflegen — eine eigene Abhängigkeit mit eigener Angriffsfläche, die auf jedem Upload läuft. Bis zur Antwort werden HEIC abgelehnt; iPhones können unter „Kamera › Formate › Maximale Kompatibilität" JPEG senden, und der Browser wandelt beim Hochladen aus der Mediathek ohnehin meist um. Die Frage ist keine technische: sie entscheidet, ob eine Reinigungskraft am Objekt ein Foto machen kann, ohne vorher eine Einstellung zu ändern. | TIM-10, LEG-10, `medien`, `exif.ts` |

## Entschieden beim Phase-5-Abschluss — die Reinigung im Seed (Reviere, Nachweise, Beanstandungen)

Die größte Gesellschaft der Gruppe stand im geseedeten Bestand mit **sechs
leeren Revieren** da: `revier` 6 Zeilen, `revier_raum` 0, `leistungsnachweis`
0, `reklamation` 0. Das sah nicht nach einer Lücke aus. Die Revierliste zeigte
sechs Zeilen, jede mit einer Sollzeit im Kopf — und daneben eine Summe der
Räume von null. Auf jedem Revierblatt stand damit „stimmt nicht überein", also
genau die Aussage, die CLN-01 gerade nicht machen soll. Und der Kopfwert war
keine Kalkulation: 210, 180 und 480 Minuten hatte `seedDienstplan` beim Anlegen
hineingeschrieben.

### D-309 · Der Revierzuschnitt läuft über `setzeRaeume`, nie über ein `insert`

`src/server/db/seed/reinigung.ts` ordnet die Räume des Raumbuchs den Revieren
über den echten Dienst zu. Der liest die Flächen unter RLS, holt die
Leistungswerte über `app.leistungswerte_lesen()` (K-05), ruft die EINE
getestete Rechnung aus PR 25 auf, macht die Gegenprobe `Σ revier_raum =
revier.sollzeit_minuten` VOR dem Schreiben und setzt den Kopfwert danach auf
das Ergebnis. Ein `insert` hätte sechs Reviere mit Räumen ergeben und einen
Kopfwert, den weiterhin niemand gerechnet hat — dieselbe Lüge, nur besser
versteckt.

Drei Zonen liegen dabei über derselben Fläche, und das ist kein Versehen:
0065 §5.2 erlaubt einen Raum ausdrücklich in zwei Revieren, weil
Unterhaltsreinigung und Glasreinigung zwei Reviere über denselben Räumen sind
(CLN-05). Der Zuschnitt selbst — welcher Raum in welche Zone fällt — ist eine
Entscheidung der Objektleitung und keine Geschäftsregel; der Seed schneidet
plausibel und sagt das im Kommentar.

**Der Seed schneidet nur leere Reviere.** Eine Zuordnung steht unter
Löschsperre (§5.2) und lässt sich nicht lösen; `setzeRaeume` ist additiv und
wirft `RaumNichtEntfernbar`, sobald ein heute zugeordneter Raum in der neuen
Menge fehlt. Ein zweiter Lauf mit geändertem Zuschnitt bräche deshalb ab — zu
Recht, und darum wird gelesen, bevor geschrieben wird.

### D-310 · Eine Nachweisposition entsteht aus einem Zeiteintrag, nicht aus einer erfundenen Zeile

Beide Leistungsnachweise des Seeds tragen je Position `quelle = 'zeiteintrag'`
und die Kennung der Schicht, aus der sie stammt — über den dreispaltigen
Schlüssel Mandant → Auftragsleistung → Zeiteintrag (`lnp_zeiteintrag_fk`). Das
ist der Weg, den FIN-07 verlangt, und er lässt sich nur prüfen, wenn Zeilen im
Bestand stehen, die ihn gegangen sind. Die Glasreinigung hat mit Absicht keinen
Abrechnungsanker (`auftrag.ts`) und taucht deshalb in keinem Nachweis auf — sie
bleibt der Fall, den `zeiteintrag_ohne_auftrag` melden muss (FIN-18).

Der Leistungszeitraum spannt vom ersten bis zum letzten aufgenommenen
Durchgang und nicht über einen ganzen Kalendermonat. Ein Nachweis über „den
Vormonat" wäre an jedem Tag nach dem 22. eines Monats ein Blatt ohne eine
einzige Zeile, weil die geseedete Zeiterfassung drei Wochen vor heute beginnt.

Unterschrieben wird über die **zwei Schritte** des Dienstes: Vorschau mit
Prüfsumme, dann Unterschrift gegen dieselbe Prüfsumme. Der Abzug in
`leistungsnachweis_signatur.snapshot` ist danach das, was das Blatt zeigt — die
lebende Tabelle ist es nicht mehr. Eine selbst geschriebene Signaturzeile hätte
den Vergleich beider Digests übersprungen, also genau die Zusage aus CLN-04.
`signatur_medien_id` bleibt NULL: ohne Zugangsdaten zum Bildspeicher entsteht
keine Medienzeile, und die Oberfläche sagt „nicht verbunden".

### D-311 · „Behoben" bekommt eine Abstellmaßnahme, keine Umgehung

Die behobene Beanstandung trägt Ursache, Maßnahme und die Nacharbeitsschicht
(den `einsatz`, nicht die Person). `MassnahmeFehlt` (422) und
`rk_behoben_hat_massnahme` weisen beide ab, was ohne Maßnahme auf „behoben"
gesetzt wird — das ist keine Hürde, um die man herumseedet, sondern die Regel
selbst. Die offene Beanstandung bestreitet den **unterschriebenen** Nachweis:
der Kunde hat quittiert und beschwert sich über denselben Zeitraum, und genau
diese Verknüpfung entscheidet, ob eine Rechnung berechtigt ist (FIN-18).
`faellig_am` bleibt in beiden leer, solange O-14 unbeantwortet ist.

| # | Question | Blocks |
|---|---|---|
| O-348 | **Trägt eine Position des Leistungsnachweises bei monatlicher Pauschale einen Einzelpreis je Durchgang, und wie wird er aus der Pauschale bestimmt?** Der Demoauftrag führt die Unterhaltsreinigung als Monatspauschale (`auftrag_leistung.einzelpreis_cent`, Demowert); der Nachweis weist Durchgänge nach. `leistungsnachweis_position.einzelpreis_cent` bleibt bis zur Antwort NULL — der Nachweis belegt die LEISTUNG, der Preis steht am Auftrag, und ein aus der Pauschale geteilter Betrag wäre eine erfundene Zahl auf einem Dokument, das der Kunde unterschreibt. Hängt an O-146 (wird ein ausgefallener Turnus gegen die Pauschale gutgeschrieben). | CLN-04, FIN-05, FIN-07, O-146, `leistungsnachweis_position.einzelpreis_cent` |
| O-349 | **Rechnet ein Glasreinigungsrevier seine Sollzeit auf die Glasfläche, und mit welchem Leistungswert?** `berechneRevierSollzeit` rechnet für jede Zone auf die BODENfläche und den Leistungswert der Belagsart; die Glasfläche reist als Schnappschuss mit (`revier_raum.fenster_flaeche_qm`), geht aber in keine Zeit ein. Die Demozone „Glasflächen" trägt deshalb die Räume, die Glas haben — ihre Sollzeit ist bis zur Antwort die des Bodens und keine Glasreinigungszeit. Die Antwort ist eine zweite Bezugsgröße in `sollzeit.ts` und ein Leistungswert je m² Glas, der heute in keinem Katalog steht (verwandt mit O-17). | CLN-01, CLN-05, OPS-03, OPS-07, O-17, `revier.sollzeit_minuten`, `belagsart` |

---

## Entschieden beim Phase-5-Abschluss — Vertrieb und Bau im Seed (Angebot, Auftrag, LV, Aufmaß, Nachtrag, Bautagebuch)

Zwei ganze Gewerke standen im geseedeten Bestand mit **null Zeilen** da:
`projekt` 0 · `lv_position` 0 · `aufmass` 0 · `aufmass_zeile` 0 · `nachtrag` 0 ·
`bautagebuch` 0 · `angebot` 0. Das ist der Grund, aus dem der Auftraggeber das
Portal als „leer" erlebt hat — die Seiten sind gebaut, sie hatten nur nichts zu
zeigen. Und eine leere Tabelle sieht aus wie ein fertiger Bildschirm, an dem
heute zufällig nichts anliegt: niemand prüft an ihr, ob die Kette dahinter
trägt.

`src/server/db/seed/vertrieb.ts` und `src/server/db/seed/bau.ts` schließen
beide Lücken. **Was über einen Dienst läuft, läuft über den Dienst** — wie der
Besetzungslauf der Security (D-303) und der Revierzuschnitt der Reinigung
(D-309): Kalkulation und Versand des Angebots, Aufmaß (`erfasseAufmass` mit
serverseitigem Rechenansatz), Nachtrag (`meldeNachtragAn`,
`ordneAufmasszeileZu`, `reicheEin` — durch das Ausgangstor), Bautagebuch und
Wetter.

Hier stand „**beide** gehen den Weg der ECHTEN Dienste", und das war eine
Zusage, die der Kopf von `bau.ts` selbst zurücknimmt: Auftrag, Projekt und die
LV-Zeilen schreibt der Seed **direkt**, weil es für sie keinen schreibenden
Dienst gibt (`services/bau/lv.ts` liest und rechnet), und der Import eines
echten LV käme aus GAEB. Dasselbe gilt für `gewerk` und für die beiden
`freigabe`-Zeilen des Nachtrags. Der Satz kostete nichts, solange ihn niemand
prüfte — und genau dann etwas, wenn die nächste Sitzung aus ihm schließt, für
jede dieser Tabellen habe schon einmal ein Dienst die Vorbedingungen geprüft.
Geschrieben wurden sie als `cse_app` mit gebundenem Mandanten
(`alsPortalSitzung`), also unter RLS, Policies, Spaltendecken und Auslösern,
und die Auftragsnummer kommt aus `vergebeNummer` — durch einen Dienst gelaufen
ist die Zeile selbst nicht.

### D-312 · Das Demoangebot wird bestätigt — mit genau den Platzhalterzahlen, mit denen gerechnet wurde

`kern.angebot_versand_pruefen` lässt kein Angebot hinaus, dessen Kalkulation auf
unbeantworteten Fragen steht (O-16 Tarif, O-56 Frequenzfaktor, O-17
Leistungswert je Zeile). Ein versendetes Demoangebot ist ohne Bestätigung also
nicht darstellbar — und das ist richtig so.

Der Seed umgeht die Sperre nicht, sondern geht durch `bestaetigeKalkulation`,
denselben Dienst wie ein Mensch, und bestätigt mit **genau den Zahlen, mit
denen `kalkuliere` gerechnet hat**: 29,00 € Stundenverrechnungssatz, 15 %
Gemeinkosten auf Lohn, 8 % Wagnis und Gewinn, Frequenzfaktor 21,667. Damit
verschiebt die Bestätigung keinen Cent — und genau das ist die Probe: eine
Bestätigung, die den Preis änderte, wäre eine andere Kalkulation unter
derselben Überschrift.

Was diese Bestätigung **nicht** ist: eine Antwort auf O-16. Sie gilt dem einen
Demoangebot, sie schreibt keinen Katalogwert um (`belagsart.ist_platzhalter`
bleibt unberührt, 0027), und `kalkulation.bemerkung` trägt weiter „Offene
Fragen: O-16, O-17, O-56". `PLATZHALTER_TARIF` bleibt Platzhalter; jede andere
Kalkulation bleibt in der Sperre.

### D-313 · Ein zweites Angebot bleibt Entwurf — das ist die Prüfung, nicht der Rest

Der Entwurf trägt **keine Angebotsnummer**: sie entsteht erst in demselben
UPDATE, das `versendet_am` setzt (FIN-03), und ein Entwurf hat deshalb keine —
dieselbe Einbahnstraße wie bei der Rechnung (Invariante 4). Und er ist dem
Kundenportal nicht sichtbar: `t_kunde` und die Portaldecke verlangen beide
`status <> 'entwurf'` (AUT-01). Beide Zusagen lassen sich nur an einem
vorhandenen Entwurf prüfen — ein Bestand ohne einen ist ein Bestand, in dem die
Browsersuite nichts zu unterscheiden hat.

Beide Angebote rechnen auf dasselbe Raumbuch und unterscheiden sich im Turnus
(5× wöchentlich gegen vierteljährlich). Das ist der Alltag einer
Gebäudereinigung und macht den Vergleich lesbar: dieselbe Grundlage, der Faktor
dazwischen ist der Turnus.

### D-314 · Das LV geht bis `1.2.12`, und die Auftragssumme entsteht aus der GELESENEN Ordnung

Ein Leistungsverzeichnis mit acht Positionen je Titel zeigt nicht, worum es
geht. Erst ab `1.2.9` und `1.2.10` trennt sich die Ordnung der Datenbank
(`sortier_pfad`) von der Zeichenkettensortierung, die `1.2.10` VOR `1.2.9`
stellt. Die Demodaten gehen deshalb bis `1.2.12`.

`pfad`, `sortier_pfad` und `ebene` schickt der Seed **nicht** mit:
`kern.lvp_pfad_setzen` (0071) leitet alle drei vom Elternteil ab. Sie hier zu
rechnen wäre eine zweite Fassung derselben Regel, und die zweite erführe nie,
wenn die erste sich ändert.

Die Auftragssumme wird anschließend aus den **gelesenen** Zeilen gebildet —
`ladeLvPositionen` → `baueOzBaum` → `lvSummeCent` —, nicht aus der Liste, die
der Seed geschrieben hat. Damit steht in `projekt.auftragssumme_netto_cent` und
`auftrag.auftragswert_netto_cent` dieselbe Zahl, die die Oberfläche unter dem
LV anzeigt, und nicht eine zweite, die daneben gerechnet worden wäre.

**Je eine Bedarfs- und eine Alternativposition stehen mit Absicht im LV.** Sie
zählen nach 03-GEWERKE §3.3 nicht in die Auftragssumme (O-155). Eine Demo, in
der jede Zeile mitzählt, prüft die Unterscheidung gerade nicht.

Der Seed läuft dafür unter einem Konto, das `bau.preis_lesen` hält:
`app.lv_preis_lesen` gibt NULL zurück, wer das Recht nicht hat (K-05, §1.9) —
die Summe wäre dann 0,00 €, die Zeile „unvollständig", und das Projekt trüge
eine Auftragssumme, die plausibel aussieht und keine ist.

### D-315 · Das Aufmaßblatt bleibt Entwurf, weil kein Messfoto entstehen kann

`pruefeVorlage` verlangt für den Übergang `entwurf → vorgelegt` mindestens eine
als Nachweis gekennzeichnete Aufnahme (BAU-03). Ein Foto entsteht nur über
`legeMediumAb` im privaten Bucket — und ohne Zugangsdaten zum Medienspeicher
entsteht keine Medienzeile. Eine selbst geschriebene `einsatz_medien`-Zeile mit
`repeat('a',64)` als Prüfsumme wäre ein vorgetäuschter Beleg unter einer
Gegenzeichnung, also genau das, was BAU-03 verhindern soll. Dieselbe
Entscheidung wie bei der Nachweisunterschrift der Reinigung (D-310).

Die Mengen entstehen dabei **serverseitig aus der Formel**: `erfasseAufmass`
ruft `rechneZeilen` → `berechneRechenansatz`, und `3 × (4,20 × 2,75) − 2 ×
(0,90 × 2,10)` wird zu 30,870 m². Ein Seed, der die Menge daneben hinschriebe,
prüfte den Zerteiler nicht und könnte eine Zahl eintragen, die zur Formel nicht
passt — der klassische Streitfall in einer Schlussrechnung.

### D-316 · Der Nachtrag geht durch `gate()` — mit einer Freigabe, die genau ihn deckt

Die dritte Aufmaßzeile liegt **außerhalb des LV** (BAU-05) und ist der Anlass
des Nachtrags. Der Seed geht den ganzen Weg: `meldeNachtragAn` →
`ordneAufmasszeileZu` (nur so verschwindet die Warnung „außerhalb des LV, ohne
Nachtrag") → Freigabe → `reicheEin`.

Die Freigabe wird über `nachtragNutzlast` und `nutzlastHash` an **diesen**
Nachtrag gebunden, und der Kettenhash kommt aus `berechneHash` — derselben
geprüften Funktion, mit der die Rechnungskette rechnet (Invariante 4). Einfach
`hash = nutzlast_hash` zu schreiben sieht gleich aus und ist keine Kette: jedes
Glied ließe sich dann einzeln austauschen.

`betrag_netto_cent` bleibt NULL. Der Preis eines Nachtrags ist nicht vereinbart,
solange der Auftraggeber nicht beauftragt hat — und `cse_app` darf die Spalte
ohnehin nicht lesen (K-05), weshalb sie auch nicht im Nutzlast-Abdruck steht.

### D-317 · Der Gewerkekatalog bekommt zwei Zeilen, und beide sind als unbestätigt gekennzeichnet

Ohne ein Gewerk lässt sich keine Mannstundenzeile anlegen — `hefteMannstundenAn`
weist ab, und der Bautag stünde ohne die Angabe da, um die es in einem
Bauzeitenstreit überhaupt geht. Der Katalog wird nach O-159 leer ausgeliefert;
der Seed legt deshalb genau zwei Zeilen an (`TRO` Trockenbau, `EST` Estrich und
Bodenbelag), beide mit `ist_platzhalter = true`. Die Oberfläche schreibt
„(unbestätigt)" dahinter — der Bildschirm ist dafür gebaut. Das ist kein
Ersatz für die Antwort, sondern die sichtbare Form der offenen Frage.

### D-318 · Das Wetter bleibt leer, und der Befund steht in der Schlussmeldung

`hefteWetterAn` wird für jeden Bautag gerufen und wirft nie: es gibt einen
BEFUND zurück, und der Tag bleibt, wie er ist (BAU-08). Heute lautet er
`ohne_koordinaten` — die Baustelle trägt keine Geodaten, also wird die Station
gar nicht erst gesucht; `src/server/versand/dwd.ts` ist ohne
`DWD_OPENDATA_BASE` zusätzlich nicht verbunden. Beides steht wörtlich in der
Schlussmeldung des Seeds.

`wetter_notiz` bleibt dabei **leer**. Das Feld ist die Beobachtung eines
Menschen („ab Mittag Dauerregen"); „Wetterdaten nicht verfügbar"
hineinzuschreiben machte aus dem Befund der Integration eine Aussage der
Bauleitung. Die Seite zeigt den Befund ohnehin selbst (`leseWetterAnzeige`).

Der erste der drei Bautage wird **geschlossen**, die beiden anderen bleiben
offen: ein abgeschlossener Bautag ist unveränderlich, korrigiert wird durch
Storno und Ersatztag (BAU-07, LEG-01). Ein Bestand, in dem jeder Tag offen ist,
zeigt diese Kante nie — und einer, in dem jeder Tag geschlossen ist, lässt die
Erfassungsmaske nirgends prüfen.

**Der Seed hört weiterhin vor der ersten Rechnung auf.** Der Angebots- und der
Auftragskreis sind bestätigt und werden gezogen; der Rechnungskreis ist es
nicht (O-134), und eine Nummer aus einem unbestätigten Kreis wäre eine
erfundene.

### Offen, neu aufgeworfen beim Phase-5-Abschluss (Vertrieb und Bau)

| # | Question | Blocks |
|---|---|---|
| O-350 | **Wie lange ist ein Angebot bindend, und wird `gueltig_bis` beim Versand aus dieser Frist gesetzt?** Der Seed lässt `angebot.gueltig_bis` leer. Ein geratenes Datum stünde auf einem Dokument, das der Kunde als Zusage liest (§ 145 BGB), und der Ablaufbericht (`angebot_ablauf_idx`) mahnte danach zu einem Termin, den niemand vereinbart hat. Die Antwort ist eine Frist je Gesellschaft oder je Angebotsart und eine Zeile im Versanddienst. | OPS-08, `angebot.gueltig_bis`, `versendeAngebot` |
| O-351 | **Nach welchem Schlüssel werden Bauprojekte nummeriert — ein eigener Nummernkreis je Gesellschaft, die Auftragsnummer oder eine Bauvorhabenskennung des Auftraggebers?** `projekt.nummer` hat keinen Kreis hinter sich. Der Seed setzt die AUFTRAGSNUMMER ein, weil das Projekt der Auftrag ist (§7.1, `projekt_auftrag_uk`) und diese Wahl am wenigsten erfindet; ein ausgedachtes Format „BV-2026-001" sähe dagegen aus wie ein bestätigter Nummernkreis und wäre keiner. | BAU-01, FIN-03, `projekt.nummer`, `nummernkreis` |

## Entschieden beim Phase-5-Abschluss — die Stempelfläche, ihre Warteschlange und die Medienroute

### D-372 · Ein gemerkter Stempel reist unter SEINER Marke, nicht unter der zuletzt geöffneten

Seit 0090 liest der Server Richtung, Einteilung und **Mensch** einer
Nachreichung an der Marke ab, unter der sie ankommt. Die Warteschlange auf dem
Gerät liegt aber in `localStorage` — eine einzige Schlange für alle
`/check-in/…`-Links dieses Browsers — und wurde komplett unter der gerade
geöffneten Marke gesendet.

Damit holte die Schlange genau die geratene Richtung zurück, die 0090 aus dem
Gerät entfernt hat: wer um 22:00 im Funkloch seinen Beginn-Link antippte und um
06:00 den Ende-Link öffnete, dessen gemerkter Schichtbeginn wurde beim Leeren
als Schichtende verbucht. Auf einem geteilten Objekt-Telefon war es
schlimmer — die Nachreichung der einen Kraft lief unter der Marke der nächsten
und trug deren `person_id`.

`WarteEintrag` trägt deshalb seit hier seine Marke, geprägt beim ANLEGEN wie
die `client_ereignis_id`, und `sende` bündelt je Marke eine Anfrage. Einträge
einer älteren Fassung haben keine; sie gehen notgedrungen unter der gerade
geöffneten mit — der einzige Weg, den es für sie gibt, und genau das, was
vorher mit allen geschah.

### D-373 · Die Medienroute prüft die Marke VOR dem Bucket — die dritte Funktion des Prinzipals `cse_checkin`

`POST /api/check-in/[token]/medien` ist offen (`recht: null`), und was sie
schützt, soll die Marke sein. Die Reihenfolge war jedoch Größe → Magic Bytes →
EXIF → **Bucket** → Marke, und die Kompensation im `catch` lief nie: eine Marke,
die nicht auflöst, lässt `app.offline_ereignis_annehmen` nicht werfen, sondern
in den Vorbereich schreiben und Erfolg melden (§5.13, AUT-06). Ein Fremder ohne
jede Marke konnte damit 100 MiB je Anfrage in den privaten Medienbucket legen,
beliebig oft — und weil der Vorbereich keine `einsatz_medien`-Zeile schreibt,
lag das Objekt danach ohne Zeile da: über die Anwendung nicht mehr löschbar.

`app.checkin_marke_praesentierbar(text)` (0095) zieht die Prüfung vor, ohne die
Marke zu verbrauchen. Dass damit eine **dritte** Funktion des Prinzipals
`cse_checkin` im geschlossenen K-08-Register steht, ist der Preis und bewusst
gezahlt: `cse_checkin` hält kein Tabellenrecht, kann also nicht selbst
nachsehen, und beide vorhandenen Funktionen schreiben. Die neue Zeile ist die engste denkbare — ein Argument,
`boolean` zurück, `stable`, kein Schreibvorgang, keine Auskunft über Mandant,
Person oder Einteilung. Sie verrät ein Bit, das der Check-in-Endpunkt ohnehin
herausgibt, dort sogar auf Kosten der Marke. Sie prüft **dieselben drei
Bedingungen** wie das Tor dahinter (existiert, nicht widerrufen, Einteilung
nicht zurückgenommen) und ausdrücklich weder Gültigkeitsfenster noch
`eingeloest_am` — wäre sie strenger, wiese die Route Aufnahmen ab, die die
Warteschlange danach annimmt.

**Was dabei am Register selbst nachgezählt werden musste.** Die Überschrift
dieses Abschnitts sagte „fünfte Zeile", der Absatz darunter „dritte Funktion",
und der Kommentar an der Funktion in `0095` sagt „Zeile 5" — drei Zahlen für
eine Sache, und keine davon stand neben der Zählweise, aus der sie stammt.
Nachgesehen: `03-AUTH-BERECHTIGUNGEN.md` §6.3 führt das Register als
**geschlossene Liste von fünf** Funktionen — `app.sitzung_aufloesen`,
`app.versuch_protokollieren`, `app.checkin_verbrauchen`,
`app.offline_ereignis_annehmen`, `app.ical_feed_lesen`. Vier davon gibt es
heute; den Kalenderfeed hat niemand gebaut (`grep -rn ical_feed_lesen src
tests` → kein Treffer). Diese hier ist also die **fünfte gebaute** und die
**sechste benannte** Funktion des Registers, und die dritte, die `cse_checkin`
aufrufen darf. Wer die Zahlen ohne diesen Satz liest, hält die Liste für voll
oder für halb leer, je nachdem, welche er erwischt.

Zwei Dinge folgen daraus und gehören nicht in diese Datei, sondern dorthin, wo
sie stehen: §6.3 nennt als Sperrklinke `tests/invariants/route-manifest.test.ts`
und sagt, die Liste „fails the build on any sixth" — **diesen Pfad gibt es im
Baum nicht**, und `tests/kern/routen-manifest.test.ts`, das es gibt, zählt das
Register nirgends auf. Die sechste Zeile fällt also niemandem auf; sie ist hier
begründet, nicht erschlichen. Und §6.3 selbst muss die sechste aufnehmen,
sonst widerspricht die Konvention ab jetzt der Datenbank.

## Entschieden beim Phase-5-Abschluss — der Text gegen den Code

Diese Runde hat keine Zeile Anwendungscode angefasst, sondern die Dokumente
gegen `cse_p5` (migriert bis `0091`) und gegen den Baum nachgezählt. Der Anlass
ist eine Erfahrung dieses Zweiges: die nächste Sitzung liest nicht den Code,
sie liest das, was hier steht — und handelt danach. Eine falsche Zahl in einer
Entscheidung ist deshalb kein Schönheitsfehler, sondern eine Anweisung, die
jemand befolgt.

Vier Behauptungen **in dieser Datei** wurden gestrichen oder eingegrenzt, jede
an ihrer Stelle: die Zählung des K-08-Registers (D-373), „beide Seed-Dateien
gehen den Weg der echten Dienste" (Abschnitt Vertrieb und Bau), „95 von 98
Definer-Funktionen" (D-300) und die Migrationsnummern der Phase-6-Abschnitte.
Dazu in `PHASE-5-STAND.md` die Test- und Commit-Zahlen, dieselbe
Definer-Zahl, eine Merge-Wache, die unter einem Namen genannt war, den es nicht
gibt (`anzeige-zeitzone`), und die freie Nummer `0086`; in `ROADMAP.md` die
Tatsache, dass keines seiner Kästchen je gesetzt wurde, und eine längst
beantwortete offene Frage (D-11). Was dort steht, ist jetzt nachgezählt und
nennt, woher die Zahl kommt.

### D-374 · Der Steuersatz wird am LEISTUNGSdatum aufgelöst — die Reihenfolge der Stichtage gehört hierher, nicht nur in einen Codekommentar

`0087_steuersatz_historie` nimmt `steuersatz_gruppe` den Schlüsselzwang
(`ssg_schluessel_uk`) und erlaubt damit zum ersten Mal **zwei datierte Zeilen
desselben Schlüssels** — 19 % bis zum Stichtag, der neue Satz danach. Erst mit
dieser Migration bekommt die Frage „welcher Tag zählt" überhaupt eine Wirkung.

Sie zählt nach **§ 13 Abs. 1 Nr. 1 UStG**: die Steuer entsteht mit Ausführung
der Leistung, nicht mit dem Schreiben der Rechnung. Der Stichtag ist deshalb
`leistung_bis` vor `leistung_von` vor `vereinnahmung_geplant_am` vor
`app.berlin_heute()` — das Ende des Leistungszeitraums, weil mit ihm die
Leistung ausgeführt ist; der geplante Vereinnahmungstag für die Abschlags- und
Anzahlungsrechnung, die keinen Zeitraum trägt (§ 14 Abs. 4 Nr. 6 UStG); der
heutige Tag nur für den Entwurf, der noch keines von beidem hat.

Vorher stand dort zweimal `app.berlin_heute()`. Der Preis wäre nach der ersten
Satzänderung angefallen, und zwar auf jedem Beleg, der dem Leistungsmonat
hinterherläuft — das tun sie alle: die Januarrechnung über eine
Dezemberleistung hätte den Januarsatz getragen. Zu hoch ausgewiesene
Umsatzsteuer schuldet man nach § 14c Abs. 1 UStG trotzdem, und festgeschrieben
ist der Beleg unveränderlich (Invariante 4) — die Korrektur wäre Storno plus
Neuausstellung, je Kunde.

**Warum das hier steht und nicht nur im Code:** Die Auflösungsreihenfolge ist
eine Auslegung des § 13 UStG und keine Implementierungsfrage. Wer sie im
Codekommentar allein lässt, hat sie beim nächsten Umbau der Positionsanlage
verloren, ohne dass jemand merkt, dass eine Rechtsauslegung mit umgezogen ist.

### D-375 · Der Eröffnungsakt des Nachfolgekreises schreibt AUCH `vorgaenger_nummernkreis_id` — sonst prüft der Kettenlauf einen Übergang, den niemand aufgeschrieben hat

`kettenlauf.ts` kennt seit dieser Phase zwei zusätzliche Bruchgründe:
`kettenkopf_weicht_ab` (der gespeicherte `nummernkreis.letzter_hash` ist nicht
der Hash des letzten Gliedes) und `kreisuebergang_gebrochen` (der `genesis_hash`
eines Kreises ist nicht der nachgerechnete Kettenkopf seines Vorgängers).
Beide standen in keiner Entscheidung, und der zweite hängt an einer Spalte, die
**keine Zeile der Anwendung schreibt**: `vorgaenger_nummernkreis_id` kommt
ausserhalb von `kettenlauf.ts` nur in der DDL von `0006_nummernkreis.sql` und in
der Fixtur von `tests/isolation/rechnung-kette.test.ts` vor. In `cse_p5` tragen
alle drei `ausgangsrechnung`-Kreise `genesis_hash IS NULL` und
`vorgaenger_nummernkreis_id IS NULL`.

Der Lauf schweigt deshalb, solange kein Vorgänger BENANNT ist — §5.7 Schritt 3b
prüft den Übergang ausdrücklich nur für einen Kreis, dessen
`vorgaenger_nummernkreis_id` gesetzt ist. Die Zwischenfassung meldete schon beim
blossen Vorhandensein eines `genesis_hash`, und diese Meldung konnte nur falsch
sein: wer den Nachfolger genau so eröffnet, wie der Hinweistext in
`0077_rechnung_hash.sql` es beschreibt, bekäme ab dem 2. Januar jede Nacht eine
`kritisch`-Meldung nach NOT-01/NOT-03 auf einer unversehrten Rechnung. In
derselben Fassung beendete der Übergang ausserdem die Prüfung des Kreises
(`continue`), so dass ein ECHTER Bruch im laufenden Jahr hinter dem Fehlalarm
unsichtbar blieb und `geprueft` 0 zählte. Beides ist behoben: der Übergang ist
Schritt 0 und eine ZUSÄTZLICHE Aussage, kein Ersatz für die Schritte 1 bis 4.

D-210 hat entschieden, dass der Nachfolgekreis **nicht** in der Festschreibung
entsteht, sondern ein Verwaltungsakt mit `nummernkreis.verwalten` ist. Was
D-210 offen liess und der Hinweistext in `0077_rechnung_hash.sql` ebenfalls
nicht nennt: dieser Akt kopiert nicht nur `letzter_hash` nach `genesis_hash`,
er muss auch den Vorgänger **eintragen**. Ohne diese Spalte ist der Übergang
für jeden Prüfer unsichtbar — die Kette wäre über die Jahresgrenze eine Linie
(D-29, § 5.4) und sähe aus wie zwei, und ein Kreis mit gesetztem Genesis ohne
eingetragenen Vorgänger ist ein Befund für die Nummernkreisverwaltung und kein
Beweis für eine gebrochene Kette.

Solange O-134 offen ist, kann der Fall nicht eintreten: jeder
`ausgangsrechnung`-Kreis ist Platzhalter und vergibt keine Nummer. Genau
deshalb steht der Satz jetzt hier — am 2. Januar des ersten echten Jahres wird
niemand ihn suchen.

### Offen, neu aufgeworfen beim Phase-5-Abschluss (Dokumentenrunde)

| # | Question | Blocks |
|---|---|---|
| O-352 | **Wer hält in den drei Gesellschaften `nummernkreis.verwalten`, und wer führt den Jahreswechsel des Rechnungskreises aus?** Das Öffnen des Nachfolgekreises schliesst den Vorgänger (`geschlossen_am`), kopiert `letzter_hash` nach `genesis_hash` und trägt den Vorgänger ein (D-210, D-375) — ein Akt mit rechtlicher Wirkung, der bewusst nicht in der Festschreibung liegt: wer festschreibt, hält `verwalten` nicht. Bis zur Antwort gibt es den Vorgang nicht, und es kann ihn nicht geben, ohne eine Rolle zu erfinden, die ihn auslöst. Verwandt mit O-77 (wer darf stornieren) und O-134 (wie der Kreis überhaupt geschnitten wird). | FIN-03, LEG-01, O-77, O-134, `nummernkreis`, D-210 |
| O-353 | **Wie lauten Anschrift, Rufnummer, Handelsregister- und Umsatzsteuer-Identifikationsnummer der vier Gesellschaften wirklich?** Was heute in `mandant` steht, ist ERFUNDEN: `Kurfürstendamm 21`, `+49 30 555 0100`, `DE1000000xx`, `HRB 2000xx` — fortlaufend hochgezählt, nie erfragt. Weglassen geht nicht, `mandant_ustg14_vollstaendig` verlangt Anschrift und Steuernummer von jeder Gesellschaft mit eigenem Rechnungskreis (§ 14 UStG). Deshalb tragen die Zeilen seit 0097 `angaben_bestaetigt_am = NULL`, und das Impressum sagt es sichtbar VOR den Angaben: sie stammen aus dem Demonstrationsbestand und sind keine gültige Auskunft nach § 5 TMG. Mit der Antwort werden die Werte gesetzt und die Spalte gefüllt; die Prüfung, die den Hinweis erzwingt, gehört dann umgeschrieben — nicht der Hinweis entfernt. | LEG-01, § 5 TMG, § 14 UStG, `mandant`, D-19 |
| O-354 | **An welche Adresse geht ein gescheiterter Nachtlauf, und ab welchem Rang wird jemand geweckt?** `runner.ts` verspricht „kein stiller Tod", und `ProtokollAlarm` löst das heute so ehrlich, wie es ohne verbundenen Kanal geht: eine `JOB-ALARM`-Zeile auf `stderr` (auf Vercel in den Funktionsprotokollen) plus `job_lauf.ergebnis = 'fehler'` in der Datenbank. Beides setzt voraus, dass jemand nachsieht. Was fehlt, ist der Weg nach draußen — Mailadresse, Dienst oder Nummer — und die Schwelle: der Dienstplangenerator, der zweimal scheitert, ist etwas anderes als der Lead-SLA-Job, der einmal aussetzt. | SPEC §14, `src/server/jobs/alarm.ts`, `job_lauf` |
| O-355 | **Wer trägt die Modulbuchung ein und pflegt `mandant.module_gepflegt`?** Seit 0103 ist die Frage nicht mehr, was eine leere Liste heisst — das Kennzeichen sagt es: `false` = nicht eingetragen, es wird nicht gefiltert (damit eine neu angelegte Gesellschaft nicht schwarz wird); `true` = die Liste gilt, leer heisst kein Gewerk. Offen bleibt der Vorgang: kommt die Buchung aus dem Vertrag, aus der Verwaltung oder setzt sie ein Super-Admin über `system.module_zuweisen` — und wer merkt, wenn sie fehlt? | `src/server/registry/modul.ts`, 0103, D-377 |
| O-356 | **Bucht jede Gesellschaft genau ein Gewerk, oder gibt es Überschneidungen?** Der Seed setzt `reinigung → [reinigung]`, `security → [security]`, `bau → [bau]`, `operations → []` — abgeleitet aus den Gewerken, die in `CLAUDE.md` stehen. Praktisch plausibel wäre anderes: Bauendreinigung bei der REALTIME Service, Veranstaltungsreinigung bei der SSE Security. Bis zur Antwort sieht eine Gesellschaft nur ihr eigenes Gewerk; die Korrektur ist eine Zeile in `mandant.module` und kein Codeeingriff. | `mandant.module`, `src/server/db/seed/index.ts`, D-377 |
| O-357 | **Wohin gehen die Wächter-Meldungen aus SPEC §14 — Posteingang, Mail oder beides — und wer bekommt die Kettenmeldung?** Die Ablaufwarnung (60/30/7) erreicht die Person selbst; das ist EMP-08 und unstrittig. „Hashkette gebrochen" dagegen hat keinen persönlichen Empfänger: es ist eine Meldung an die Buchhaltung oder die Geschäftsführung, und beide sind heute keine adressierbare Größe im Modell. Solange die Frage offen ist, wird der Kettenprüfer bewusst NICHT als Job registriert — ein Lauf, der jede Nacht „ok" meldet, ohne dass jemand die Meldung liest, schafft Vertrauen, das er nicht deckt. | SPEC §14, `src/server/jobs/bootstrap.ts`, `kettenlauf.ts`, NOT-01 |

### Vier Befunde, die ausserhalb dieser Datei liegen

Sie stehen hier, weil sie sonst mit dieser Runde verschwinden — geändert werden
müssen sie dort, wo sie stehen:

1. **`docs/ANNAHMEN.md` nennt die Zahlen nicht, mit denen gerechnet wird.** Das
   Blatt für den Auftraggeber führt elf vorläufige Werte und fünf bewusst
   offene. Nicht darunter: `PLATZHALTER_TARIF` (29,00 € Stundenverrechnungs-
   satz, 15 % Gemeinkosten, 8 % Wagnis und Gewinn, O-16) und
   `PLATZHALTER_FREQUENZ` (21,667, O-56) — also genau die Werte, aus denen ein
   Angebotspreis entsteht. Der Versand ist gesperrt
   (`kern.angebot_versand_pruefen`), die Sperre ist aber das, was der Kunde
   NICHT sieht: er liest eine Liste mit elf Punkten und schliesst, der
   Stundensatz sei keiner davon. Die Datei wird erzeugt; die Zeile gehört nach
   `src/lib/annahmen.ts` (`OFFEN_GEBLIEBEN`), nicht in das Markdown.
2. **`03-AUTH-BERECHTIGUNGEN.md` §6.3 führt das K-08-Register als geschlossene
   Liste von fünf und beruft sich auf `tests/invariants/route-manifest.test.ts`
   — den Pfad gibt es nicht.** Mit `0095` hat das Register eine sechste
   benannte Zeile (D-373). Die Konvention muss sie aufnehmen, und die
   Sperrklinke, auf die sie sich beruft, muss entweder gebaut oder aus dem Satz
   gestrichen werden.
3. **`PortalRahmen.tsx` nennt `NAVIGATION` „18 Eintraege"; es sind 17.** Die
   erste Fundstelle von `schluessel:` in `registry/navigation.ts` ist das Feld
   der Schnittstelle, nicht ein Modul. Die Zahl in der PR-Beschreibung (17)
   stimmt, der Kommentar daneben nicht — und der Kommentar ist der, den die
   nächste Sitzung liest.
4. **Die Beschreibung von PR #5 trägt dieselben zwei Behauptungen weiter**, die
   hier gestrichen wurden: „**Alles über die echten Dienste**" (Auftrag,
   Projekt, LV-Zeilen, `gewerk` und die beiden `freigabe`-Zeilen schreibt der
   Seed direkt) und „95 von 98 `SECURITY DEFINER`-Funktionen" (94 von 99, mit
   `0095` von 100). Dazu ihre Kopfzahlen — „72 Commits · 406 Dateien · 45
   Migrationen" —, die beim Nachzählen gegen `origin/main` bei 82 · 427 · 49
   standen und mit jedem Commit dieser Nacht weiterlaufen. Die Beschreibung ist
   das, was beim Merge in die Geschichte eingeht; sie gehört vor dem Merge
   nachgezogen, und die drei Kopfzahlen am besten zuletzt.

### D-378 · Der Kettenprüfer läuft unter `cse_job` — als erster Job überhaupt

`pruefeKette` (FIN-06, LEG-01) war seit PR 46 gebaut, geprüft und **nicht
registriert**. Der Grund stand als langer Kommentar in `bootstrap.ts`: der
Dienst filtert über `app.aktiver_mandant()`, und ein Job hat keine Sitzung, in
der diese Frage eine Antwort hat. Ihn trotzdem einzutragen hätte jede Nacht
null Rechnungen geprüft und „keine Abweichung" gemeldet — eine grüne Meldung
über nichts, und damit schlimmer als kein Prüfer.

`src/server/jobs/sitzung.ts` schließt das: `alsJobSitzung` öffnet eine
Transaktion, setzt `set local role cse_job` und bindet `app.scope`,
`app.mandant_id` und `app.mandant_ids` transaktionslokal. Benutzer und Person
bleiben LEER — ein Nachtlauf ist keiner, und `app.akteur_typ = 'system'` ist
die Angabe, die stimmt (0004:132). `app.readonly = 'on'` ist Vorgabe: ein
Prüfer, der schreiben könnte, könnte auch reparieren, und eine Kette, die sich
selbst repariert, bezeugt nichts mehr.

**Was beim Bauen auffiel und größer ist als der Prüfer.** Im ganzen Baum stand
kein einziges `set local role cse_job`. Die Kommentare sagen seit 0012 an
vielen Stellen „der Job verbindet sich als `cse_job`" — nichts machte das
wahr. Die vier bestehenden Nachtläufe nehmen die Rolle aus `DATABASE_URL`,
und die ist in CI und im Seed `postgres`: Superuser mit `BYPASSRLS`. Jede
Spaltenbeschränkung und jede Policy, die seit 0012 für `cse_job` geschrieben
wurde — 0041, 0075, 0077, 0099, 0100, 0101 —, lief damit ungeprüft mit. Sie
war nicht falsch; sie war nur nie auf dem Weg, den irgendetwas tatsächlich
geht.

Die vier umzustellen heißt, für jeden einzeln Rechte und Policies nachzuziehen
und jeden einzeln gegen die enge Rolle zu fahren — das ist eine eigene Runde
mit eigenen Tests, kein Nebenschritt, und wird hier ausdrücklich NICHT
miterledigt. Der Kettenprüfer ist der erste Lauf, der die Rolle wirklich
trägt; `tests/isolation/kette-job.test.ts` hält das mit
`select current_user` fest, statt es zu glauben.

**`0108` bindet die Policy an den Mandanten, nicht an `true`.** Die sieben
Policies aus 0101 stehen auf `using (true)`, weil ein Job damals keine Sitzung
hatte. Jetzt hat er eine, also kann die Wand in der Datenbank stehen statt in
der Abfrage: `app.aktiver_mandant()` ist NULL, solange niemand gebunden hat,
und `mandant_id = NULL` liefert keine Zeile. Wer den Prüfer künftig ohne
Binder aufruft, sieht nichts — und die dritte Prüfung der Testdatei hält genau
das fest, damit „sieht nichts" von „ist in Ordnung" unterscheidbar bleibt.

**Die Zusicherung ist `geprueft`, nicht `ok`.** Eine blinde Prüfung meldet
ebenfalls `ok`. Deshalb steht in jeder Prüfung der Datei die Zahl der
geprüften Rechnungen — es ist die einzige Zusicherung, die eine leere Messung
von einer sauberen Kette trennt. Dasselbe Muster wie bei der Gegenprobe in
`tests/isolation/spaltenrechte.test.ts`.

### D-379 · `versuche` hat bei einem `je_mandant`-Job heute keine Wirkung

Beim Festlegen von `versuche: 0` für den Kettenprüfer fiel auf, dass die Zahl
dort gar nichts steuert. `runner.ts` fängt bei `bereich: 'je_mandant'` den
Fehler JE MANDANT, vermerkt ihn in `job_lauf_mandant`, meldet am Ende Alarm
und **kehrt zurück** — die Wiederholungsschleife darüber wird nie ein zweites
Mal betreten. Die drei bestehenden `je_mandant`-Jobs (`einsaetze_generieren`,
`konflikte_erkennen`, `lead_sla_eskalation`) versprechen mit `versuche: 2`
also eine Wiederholung, die niemand ausführt.

Das ist hier festgehalten und **nicht** nebenbei geändert: ob ein einzelner
fehlgeschlagener Mandant wiederholt werden soll — und ob dann der ganze Lauf
oder nur dieser Mandant —, ist eine Entscheidung mit Folgen für Idempotenz und
Alarmhäufigkeit. Für den Kettenprüfer ist `0` ohnehin die richtige Angabe: ein
gebrochener Hash wird beim zweiten Hinsehen nicht heil, und was eine
Wiederholung dort kaufen würde, ist Verzögerung zwischen Fund und Meldung —
bei „alert immediately" (SPEC §14) genau das Falsche.

### D-380 · SVG ist XML, und eine Merge-Wache liest jede einzelne

Die acht Motivtafeln aus D-376 waren **nie wohlgeformt**. Der Erzeuger
`scripts/motivtafeln.py` schrieb den Namen des Overlay-Tokens in einen
XML-Kommentar — mitsamt seinen zwei fuehrenden Bindestrichen. Ein
XML-Kommentar darf keinen doppelten Bindestrich enthalten, und eine SVG ist
XML. Der Server lieferte die acht Dateien mit **200** aus, der Browser verwarf
sie beim Parsen und zeichnete nichts. Die Startseite sah leer aus, und dass
sie es war, stand in keinem Testbericht.

**Warum das monatelang gruen war.** Es gab eine Pruefung. Sie prueft die
sichtbare Platzhalter-Kennzeichnung NEBEN dem Bild — und die stand ja da. Das
`<img>` war im DOM, der `src` stimmte, die Datei existierte, die Antwort war
200. Jede Ebene UNTER dem Fehler war in Ordnung; genau das ist die Bauart, an
der man solche Fehler erkennt. Eine Pruefung, die eine Ebene zu tief ansetzt,
ist nicht halb so gut wie die richtige — sie ist gruen und damit schlechter
als keine, weil sie den Platz besetzt.

Die Wache `svg-wohlgeformt` in `pnpm guards` liest deshalb **die Datei
selbst**, nicht die Seite, die sie einbindet.

**Der Pruefer ist von Hand geschrieben** (`scripts/guards/xml-wohlgeformt.ts`).
Node bringt kein `DOMParser` mit — das ist eine Browser-Schnittstelle, und weil
`DOM` in `tsconfig.lib` steht, waere der erste Entwurf sauber durch den
Typecheck gegangen und erst zur Laufzeit gestorben. Eine Abhaengigkeit
aufzunehmen waere fuer eine Wache zu viel Gewicht.

Ein selbstgeschriebener Parser hat genau eine gefaehrliche Fehlerart: **er ist
sich einig mit sich selbst**, und ein Test aus derselben Hand teilt seine
blinden Flecken. Deshalb wurde er gegen einen fremden, ausgewachsenen Parser
abgeglichen — Pythons expat — auf zwei Wegen: 61 handgeschriebene Faelle und
3000 zufaellige Mutationen der acht echten Tafeln (800 davon noch wohlgeformt,
2200 kaputt). **Null Abweichungen in beide Richtungen.** Die 61 Faelle stehen
als Tabelle in `tests/kern/xml-wohlgeformt.test.ts`; der Fuzzer war eine
einmalige Gegenprobe und liegt nicht im Baum, weil er Python voraussetzt.

Zwei Entwurfsentscheidungen, die dazugehoeren:

- **Im Zweifel rot.** Was der Pruefer nicht versteht — eine `<!DOCTYPE …>` mit
  interner Teilmenge, eine fremde `<!…>`-Deklaration —, meldet er, statt es zu
  ueberspringen. Eine Wache, die im Zweifel schweigt, ist die Wache, die
  diesen Fehler durchgelassen hat.
- **Geprueft wird das Verzeichnis, nicht die Trefferzahl.** `mussLesen` waere
  hier falsch: kommen eines Tages echte Fotos und verschwinden die Tafeln, ist
  null SVG das richtige Ergebnis. Der Ausfall, den `mussLesen` sonst abfaengt —
  ein vertippter Pfad, der still nichts liest —, faellt hier auf die Existenz
  von `public/` zurueck.

### D-381 · Die Gesellschaftswahl zieht in den Kopf

DESIGN §6 verlangte sie woertlich „under the hero": vier runde Markenavatare
unter dem Kopfbild. So war sie gebaut, und der Weg dorthin war selbst schon
eine Korrektur — sie hatte vorher im Fussbereich gestanden, wo Code, Test und
Testname sich einig waren und gemeinsam danebenlagen.

**Unter dem Hero war sie aus zwei Gruenden falsch, die ein Entwurf nicht zeigen
kann.** Sie sass unmittelbar unter dem Kopfbild, wo die ueberlebensgrosse
Geisterschrift des Heros durchschlaegt; die vier Firmennamen landeten auf
dieser Schrift und lasen sich als Kollision statt als Bedienelement. Und sie
verbrauchte ein ganzes Band Hoehe direkt unter der Falz — auf genau der
Flaeche, auf der der erste Eindruck entschieden wird.

Der Mandant hat den Umzug verlangt, nachdem er den laufenden Auftritt gesehen
hat. Das ist das bessere Beweismittel als der Entwurf, und DESIGN §6 ist
mitgezogen, nicht umgangen.

**Was der Umzug nebenbei behoben hat.** `aktiv` gab es an der Huelle und an
`Abschnitte` — und gesetzt hat es niemand. Die Markenreihe bekam also immer
`null` und hat die offene Gesellschaft nie hervorgehoben. Eine Eigenschaft, die
alle durchreichen und keiner fuellt, faellt nicht auf: sie sieht nur auf jeder
Seite gleich aus. Das Layout rechnet den Slug jetzt aus dem Pfad aus und prueft
ihn gegen die ECHTEN Slugs — `/unternehmen/erfunden` hebt nichts hervor.

**Drei Entwurfsentscheidungen.**

- **Kein JavaScript.** `<details>` oeffnet ohne — wie das Telefonmenue daneben
  und die Tableiste im Portal. Ein Auswahlfeld, das erst laedt, ist auf einem
  schlechten Netz keines.
- **Die Zusammenfassung zeigt, wo man IST**, nicht was man waehlen kann.
  „Gesellschaften" als Dauerbeschriftung sagt auf allen fuenf Seiten dasselbe;
  der Firmenname sagt etwas.
- **Auf dem Telefon steht sie nicht im Kopf.** Der Kopf ist 72px hoch und
  traegt dort schon den Menueknopf; ein zweites Klappelement daneben waere bei
  375px kein Ziel mehr, das man trifft. Die vier Gesellschaften stehen deshalb
  als eigener Abschnitt IM Vollbildmenue, vor „Angebot anfragen": erst wohin,
  dann was.

Der Fussbereich bleibt unveraendert — dort stehen die vier weiterhin als
Textlinks neben ihrer Anschrift, mit eigener Beschriftung. Zwei `nav` mit
demselben zugaenglichen Namen waeren ein mehrdeutiges Landmark; das hat dieser
Zweig beim Telefonmenue schon einmal gekostet.

`MarkenReihe.tsx` ist geloescht und nicht auskommentiert stehengeblieben.

### D-382 · Die Motivtafel ist die Zeichnung — Overlay und Beschriftung gehoeren der Seite

Nachdem D-380 (nicht wohlgeformtes XML) und der Tafel-Verlauf aus D-376/§4.1b
behoben waren, war der Auftritt **immer noch** zu dunkel, und der Mandant sah
ausserdem einen halbdurchsichtigen Doppelgaenger seiner eigenen Ueberschrift.
Zwei weitere Ursachen, beide vom selben Denkfehler.

**Der Overlay lag doppelt.** `Hero.tsx` und `MarkenKarte.tsx` legen den Token
aus DESIGN §4.4 ueber jedes Bild — richtig so, denn ein Foto bringt keinen mit.
Die Tafel brachte ihn trotzdem mit, ausgeschrieben, weil eine SVG die
CSS-Variablen des Dokuments nicht sieht. Zwei Schichten multiplizieren sich:

| Stelle | eine Schicht | zwei Schichten |
|---|---|---|
| Mitte | 0.55 | **0.80** |
| Fuss | 0.92 | **0.994** |

0.994 ist Schwarz. Die Tafel, die als Datei einwandfrei aussah, war auf der
Seite wieder verschwunden — und zwar aus einem Grund, den man ihr nicht ansieht,
weil er erst beim Einbau entsteht.

**Die Beschriftung stand zweimal da.** Die Tafel trug „REALTIME SERVICE" und
darunter „Hier steht spaeter eine Aufnahme …" eingebacken. Die Seite setzt ihre
eigene Ueberschrift derselben Gesellschaft unmittelbar darueber. Das Ergebnis
las sich als Darstellungsfehler, nicht als Kennzeichnung. Gemeldet hat es der
Mandant, gesehen hatte es vorher niemand: im Dateibetrachter sieht die Tafel
richtig aus, und der Browsertest prueft die Marke `Platzhalterbild` — die stand
ja da, ein zweites Mal daneben faellt einer Zusicherung nicht auf.

**Die Regel, die daraus folgt:** eine Motivtafel steht fuer ein Foto, also
verhaelt sie sich wie eines. Kein Farbverlauf, keine Bildunterschrift — beides
gehoert der Flaeche, die sie einbaut. DESIGN §4.1a ist mitgezogen.

Gekennzeichnet bleibt der Platzhalter durch die Marke `Platzhalterbild`, die
die Seite ohnehin rendert: **eine** Kennzeichnung, auf der Flaeche, wo sie
sehen kann, was sonst noch dort steht.

Die Zeile und die Marke wandern damit nicht ins Nichts — sie stehen weiter im
`aria-label` des Wurzelelements der SVG und sind dort die einzige Auskunft, die
ein Screenreader ueber das Bild bekommt.

**Vier unabhaengige Ursachen fuer ein Symptom.** „Der Auftritt sieht von innen
sehr schlecht aus und es ist nichts da" hatte am Ende vier Gruende: die Dateien
waren kein gueltiges XML (D-380), der Mandant lief auf einem alten Stand ohne
die Dateien, der Zeichenverlauf war fuer UI statt fuer Bild gerechnet (§4.1b),
und Overlay wie Beschriftung lagen doppelt (hier). Jede einzelne haette
gereicht. Dass drei davon erst nach der Behebung der jeweils vorigen sichtbar
wurden, ist der Grund, warum „einmal hinsehen" hier nicht genuegt hat.

### D-383 · Fuenf CC0-Aufnahmen als Zwischenloesung — kein Objekt, keine Person

Der Mandant hat dreimal um echte Bilder gebeten und beim dritten Mal den
entscheidenden Satz gesagt: es muessen **keine Personen** sein, nur nicht
gezeichnet und ohne Lizenzkosten. Damit war die Aufgabe eine andere.

**Warum die ersten beiden Runden nichts ergaben.** Gesucht wurde nach
Menschen bei der Arbeit — „Reinigungskraft", „Wachmann", „Bauarbeiter". Die
freien Quellen sind dort Archiv und nicht Werbefotografie: fuer die Reinigung
kamen Scheuersaugmaschinen auf Parkdecks und ein Kind auf einer Maschine, fuer
die Security ukrainische Kriegsgraeber und ein Friedhof in Pionki. Nichts
davon geht auf den Auftritt eines Sicherheitsdienstes, und es wurde auch
nichts davon abgelegt.

**Architektur ist die Staerke derselben Quellen.** Ohne Personen oeffnet sich
der CC0-Bestand, den Commons aus Unsplash uebernommen hat: professionelle
Aufnahmen, 4000 bis 6700 px, gemeinfrei gestellt. Fuenf davon liegen jetzt in
`public/bilder/` — Stadtbild, Innenraum, Fassade bei Nacht, Baustelle, Buero.

**Drei Bedingungen, die alle fuenf erfuellen:**

- **CC0.** Keine Namensnennungspflicht, keine Gebuehr. Damit braucht der
  Auftritt keine Impressumszeile fuer Bildrechte und keinen Credits-Abschnitt,
  den beim naechsten Bild jemand vergisst. CC BY waere fachlich sauber
  gewesen, haette aber eine Pflicht eingefuehrt, die niemand bestellt hat.
- **Kein bestimmtes Objekt der Gruppe.** §4.3 bleibt unangetastet: ein fremdes
  Gebaeude auf der Projektseite DIESER Gruppe waere eine Behauptung, die
  niemand deckt. Die fuenf tragen das Gewerk und sagen nichts ueber einen
  konkreten Auftrag. Objekt- und Projektkacheln bekommen ausdruecklich keines
  — dort bleibt die reservierte Flaeche.
- **Keine Personen.** §4.2 ist damit gar nicht erst beruehrt, und niemand auf
  dem Auftritt kann fuer Belegschaft gehalten werden, der keine ist.

**Was sie NICHT sind: das Ende von O-13.** DESIGN §4.1 verlangt eigene
Aufnahmen, und das bleibt richtig — eine Gruppe, die koerperliche Anwesenheit
verkauft, zeigt am Ende ihre eigenen Objekte. Die Herkunft jeder Datei steht in
`public/bilder/HERKUNFT.md`; ein Austausch ist eine Datei, kein Codepfad.

**Die sichtbare Folge, die dazugehoert.** Was in `public/bilder/` liegt,
erscheint OHNE Platzhalter-Kennzeichnung — die Seite behauptet ab jetzt, das
Bild gehoere zum Motiv. Das ist die Zusage, die der Ordner seit jeher macht
(`LIESMICH.md`), und sie gilt jetzt zum ersten Mal wirklich.

**Und eine Zusicherung, die daran zerbrochen waere.** Der Browsertest
verlangte `marken > 0` — also dass die Startseite Platzhalter HAT. Das ist
nicht, was §4.1 fordert, und es war doppelt falsch: drei unmarkierte
Platzhalter waren erlaubt, solange einer markiert war, und die Zusicherung
faellt am Tag des Erfolgs, wenn echte Bilder eintreffen. Sie prueft jetzt die
Aussage selbst — so viele Marken wie Platzhalterbilder, und null Platzhalter
erfuellen das richtig.

---

### D-384 · Die Anmeldung der Beschaeftigten liegt in der Datenbank, nicht in der Anwendung

PR 20 schliesst die eine benannte Luecke der Phasen 0 bis 5: es gab keine
Anmeldung. Sitzungen kamen aus `/dev/anmelden`, und das steht hinter
`CSE_DEV_FLAECHEN`.

**Drei Funktionen unter dem Eigentuemer, nicht drei Anweisungen in der
Anwendung** (`0114`, `0115`). Wer sich anmeldet, ist noch niemand:
`app.aktueller_benutzer()` ist NULL, `cse_app` sieht unter RLS nichts, und es
gibt keinen Mandanten zu binden. Die Anmeldung ist damit der eine Weg, der VOR
der Autorisierung liegt und trotzdem in die Datenbank greifen muss.

Das ist keine Vorliebe, sondern zweimal nachgewiesen:

- **`cse_app` hat auf `benutzer_sitzung` kein INSERT**, und die beiden
  Policies darauf lauten `benutzer_id = app.aktueller_benutzer()`. Ein
  direktes `insert` — so wie `devSitzungAusstellen` es tut — funktioniert nur,
  solange die Anwendung als Eigentuemer verbindet. In einer Auslieferung, die
  richtigerweise als `cse_app` laeuft, waere die Anmeldung tot gewesen: erst
  dort, nicht hier.
- **Die Abmeldung traf dasselbe.** `beendeSitzung` setzte `beendet_am` mit
  einem eigenen UPDATE. Unter `cse_app` traf das null Zeilen und meldete
  nichts — eine Abmeldung, die wie eine aussieht und keine ist. Sie laeuft
  jetzt ueber `app.sitzung_beenden`, und der Besitz des Tokens ist der
  Ausweis.

Beide Befunde stehen als Test in `tests/isolation/mitarbeiter-anmeldung.test.ts`
(„ein direktes INSERT als cse_app scheitert", „ein direktes UPDATE als cse_app
beendet dagegen nichts"). Wer die Funktionen „vereinfacht", faellt dort.

**`ansicht = 'person'` ist die Decke, nicht der Vorgabewert** (K-04).
`app.sitzung_aufloesen` leitet das Portal aus der Ansicht ab; `person` ergibt
`mitarbeiter`, unabhaengig von jeder weiteren Rolle des Kontos. Wer als
Leitung gefuehrt wird und sich mit dem Telefon anmeldet, landet im
Mitarbeiterportal — der leichte Weg (EMP-01, ein Faktor) kann den schweren
(AUT-02, zwei Faktoren) nicht ersetzen. Das ist die sichere Richtung; ob sie
die gewollte ist, ist **O-88**.

**`aal1`, nicht `aal2`.** Der Einmalcode IST der erste Faktor, nicht der
zweite. `devSitzungAusstellen` setzt `aal2`, damit Rechte mit `erfordert_2fa`
auf den Entwicklungsflaechen nicht still leer bleiben; in der echten Anmeldung
waere dieselbe Zeile eine Falschangabe.

**Offen und als Platzhalter gefuehrt:** `auth.sitzung_stunden` = 12
(`ist_vorlaeufig`), **O-79**. Zwoelf Stunden sind der Wert, den die
Dev-Anmeldung seit PR 19 benutzt; er steht jetzt als Einstellung statt als
Zahl im Code, damit die Antwort an einer Stelle landet. Fuer Reinigungskraefte
und Wachleute ist die Frage eine andere als fuer die Buchhaltung: das Telefon
liegt auf dem Objekt, und eine zwoelf Stunden gueltige Sitzung ueberlebt das
Schichtende.

---

### D-385 · „Nicht verbunden" und „Code anzeigen" sind ZWEI Zusagen, nicht eine

`codeAnfordern` gab den Klartextcode zurueck, wenn `!sms.verbunden`. Beide
Dienste im Baum sind `verbunden = false` — der eine, weil O-82 offen ist, der
andere, weil er auf der Entwicklungsflaeche absichtlich nichts sendet. Die
Bedingung galt also fuer beide.

**Was das in einer Auslieferung ohne Gateway bedeutet hätte:** jeder
Unbekannte tippt die Mobilnummer einer Beschaeftigten ein und liest den Code
daneben. Ein Einmalcode, den der Anfordernde sieht, ohne das Telefon zu haben,
ist kein Faktor, sondern eine Tuer — und die Anmeldung, die PR 20 baut, waere
schwaecher gewesen als gar keine, weil sie nach einer aussieht.

`SmsDienst` traegt deshalb `zeigtCode` als EIGENE Zusage. Sie ist nur auf der
Entwicklungsflaeche wahr; ein kuenftiger echter Anbieter setzt sie nie. Der
Umkehrschluss aus `verbunden` ist damit ausgeschlossen, und
`tests/kern/mitarbeiter-anmeldung.test.ts` prueft beide Faelle GETRENNT — samt
eines dritten Dienstes, den es im Baum nicht gibt (verbunden UND anzeigend),
damit die alte Regel den Test nicht gruen machen kann.

Und die Folge fuer den Betrieb steht auf dem Bildschirm statt in einer Datei:
ohne Gateway sagt `/auth/mitarbeiter` „nicht verbunden" und nennt O-82 — genau
das, was 01-ORDNERSTRUKTUR §11.3 festhaelt. Die Zeiterfassung haengt trotzdem
nicht daran: der planerseitige Check-in-Link (TIM-07) ist tokenisiert und
braucht keine Anmeldung.

---

### D-386 · `/dev/anmelden` wird VERENGT, nicht abgeschafft

Die ROADMAP sagt, PR 20 ersetze die Dev-Anmeldung. Woertlich genommen waere
das falsch: PR 20 baut EMP-01, also den Zugang der Beschaeftigten.
`/auth/login` mit E-Mail, Kennwort und zweitem Faktor ist Phase 1 (AUT-01,
AUT-02) und nicht gebaut. Wer die Seite ganz entfernte, naehme `admin`,
`leitung`, `super_admin` und dem Kundenzugang den einzigen Eingang, den sie
haben.

Die Seite listet deshalb seit PR 20 **keine `mitarbeiter`-Konten mehr**. Fuer
den einen Weg, den PR 20 abdeckt, gibt es jetzt eine Anmeldung, und eine
Abkuerzung daneben hiesse, dass jede Pruefung sie nimmt und die Anmeldung
ungeprueft bleibt — und dass ein Entwicklungsbau zwei Eingaenge in dasselbe
Portal hat.

**Die Weiche sitzt im Anmeldehelfer der Browsersuite, nicht an den
Aufrufstellen.** `alsKonto(page, email)` liest die Rolle des Kontos und nimmt
fuer `mitarbeiter` den echten Weg. Fuenfzehn Aufrufstellen umzuschreiben waere
moeglich gewesen — nur stehen mehrere davon in TABELLEN (`[pfad, konto]`), und
eine Weiche, die man je Aufrufer trifft, trifft man irgendwo nicht.

---

### D-387 · Die vier Anmeldefunktionen gehoeren `cse_definer` — und das zieht mehr nach sich als eine Zeile

`0114` und `0115` legen `SECURITY DEFINER`-Funktionen an und sagten nicht, wem
sie gehoeren. Postgres gibt sie dann dem Konto, das die Migration ausfuehrt:
`postgres`, Superuser mit `BYPASSRLS`. Eine Definer-Funktion laeuft mit den
Rechten IHRES Eigentuemers — die vier liefen also an jeder Zeilensicherheit
vorbei und mit vollem Zugriff auf jede Tabelle. Ausgerechnet die vier, die ein
Unangemeldeter aufrufen darf.

**Gefunden hat es die Sperrklinke aus D-300**, `tests/isolation/definer-eigentum.test.ts`,
und zwar in CI, nicht im Betrieb. Sie ist genau dafuer da, dass die Altlast von
95 Funktionen nicht waechst; sie hat funktioniert.

**Das Umhaengen ist eine Zeile, die Folgen sind es nicht.** Ohne
Superuser-Rechte stehen zwei Fragen offen, die vorher niemand stellen musste:
welche Tabellen darf die Funktion anfassen, und welche Zeilen sieht sie dort.
`0116` beantwortet beide — spaltengenau (K-05) und mit einer Policy je Tabelle
und Anweisung. Drei Dinge fielen dabei auf, die alle erst zur Laufzeit
gemeldet haetten:

- **`app.plattform_einstellung`** wird aus `mitarbeiter_sitzung_ausstellen`
  gerufen. Als `postgres` ging das ohne Recht; als `cse_definer` stirbt die
  Anmeldung mit „permission denied for function plattform_einstellung".
- **PUBLIC hielt EXECUTE auf allen vieren.** `create function` vergibt das,
  ohne dass es jemand hinschreibt. Bei einer Funktion, die als `cse_definer`
  laeuft, ist „jeder andere Aufrufer" genau die Menge, die es nicht geben darf.
  `0093` hatte denselben Entzug fuer die damals vorhandenen Funktionen
  gefahren; diese vier kamen danach.
- **`using (true)` ist hier die richtige Verengung.** Eine Anmeldung MUSS eine
  Nummer nachschlagen koennen, die sie noch nicht kennt; jede Bedingung auf
  „eigene Zeilen" waere zirkulaer, es gibt ja noch keinen Handelnden. Die
  Verengung liegt woanders und ist schaerfer: `cse_definer` ist `NOLOGIN`,
  niemand ist Mitglied, und die Rolle laesst sich nur ueber genau diese vier
  Funktionen betreten.

---

### D-388 · Es gibt jetzt beide Richtungen: kein Recht ohne Policy UND keine Policy ohne Recht

`tests/isolation/spaltenrechte.test.ts` prueft seit 0100, dass kein
Tabellenrecht ohne passende Policy dasteht — unter FORCE heisst „keine
anwendbare Policy" *nichts*, und die Zeile kommt nie an.

**Die Gegenrichtung fehlte, und sie hat sofort etwas gefunden.** `0113` (PR 20)
kam mit drei sorgfaeltig geschnittenen Policies fuer `cse_app` auf
`mitarbeiter_zugang` — und mit keinem einzigen Recht darauf. Postgres prueft
in dieser Reihenfolge: erst das GRANT, dann die Policy. Eine Policy auf einer
Tabelle, auf die die Rolle kein Recht hat, wird nie ausgewertet. Die Migration
lief durch, die Policies standen in `pg_policies`, und die Personalstelle
haette beim ersten Versuch `permission denied` gesehen — an einem Bildschirm,
den bis dahin niemand geoeffnet hatte.

Zwei Dinge, die der erste Entwurf falsch machte und die jetzt ausdruecklich
dastehen:

- **Spalten zaehlen mit.** K-05 gewaehrt bewusst je Spalte;
  `information_schema.role_table_grants` kennt nur Tabellenrechte. Gefragt
  wird deshalb `has_any_column_privilege` — und fuer DELETE
  `has_table_privilege`, weil es DELETE auf einer Spalte gar nicht gibt.
- **RESTRICTIVE zaehlt nicht mit.** Eine restriktive Policy erlaubt nichts,
  sie verengt nur; ihr fehlendes Recht macht sie nicht tot, sondern doppelt
  zu. `p_intern_eingang_delete` auf `formular_eingang` ist genau der Fall, und
  eine eigene Pruefung haelt fest, dass es GENAU diese eine ist — kaeme eine
  zweite dazu, muss jemand sie ansehen, statt dass sie durch eine stille
  Bedingung rutscht.

**Und ein dritter Befund aus demselben Nachmittag, der nichts mit Rechten zu
tun hat:** `scripts/test-db.sh` haelt die Aufbausperre auf Dateikanal 9 und
startete den Server innerhalb dieser Sperre. `pg_ctl start` loest einen Prozess
ab, der den Kanal erbt — und die Sperre damit auf Lebenszeit haelt. Der erste
`db:test:up` auf einem frischen Rechner lief durch, jeder folgende wartete zehn
Minuten und starb an „Warte-Zeit abgelaufen", was aussieht wie ein haengender
Postgres. `9>&-` schliesst den Kanal fuer den abgeloesten Prozess;
`tests/kern/test-db-sperre.test.ts` faehrt den Wortlaut der Funktion aus dem
Skript und prueft beide Richtungen — mit und ohne.

---

### D-389 · Der Abzug der Abschläge trägt die Beträge der Belege, er rechnet sie nicht nach

PR 50 (FIN-08). Eine Schlussrechnung zieht die vorher gestellten Abschläge ab.
Drei Entscheidungen stecken darin, und jede hat eine Gegenprobe im Test.

**Je Steuergruppe, nie aus einer Bruttosumme.** §14 Abs. 4 Nr. 8 UStG verlangt
die Umsatzsteuer je Satz, und die abgezogenen Abschläge müssen in derselben
Aufteilung dastehen. Wer vom Brutto abzieht, hat einen Zahlbetrag, der stimmt,
und eine Steueraufteilung, die es nicht tut — und die Voranmeldung zieht aus
der falschen. Deshalb `abschlagsrechnung_bezug` mit
`abzug_netto_cent`/`abzug_steuer_cent` je `steuersatz_gruppe_id` und nicht eine
Zeile in `rechnung_beziehung`, die nur verweisen kann.

**Summiert, nicht neu gerundet.** Jeder Abschlag hat seine Steuer beim
Festschreiben schon auf ganze Cent gerundet und ist danach unveränderlich. Die
Summe dreier einzeln gerundeter Beträge ist NICHT dasselbe wie der Satz auf die
Gesamtsumme: `tests/kern/abschlag.test.ts` fährt den Fall (drei Abschläge,
deren Steuer je genau auf der halben Stelle liegt) und prüft zuerst, dass die
beiden Wege überhaupt auseinandergehen — ohne diesen Vortest bewiese die
eigentliche Zusage nichts. Der Abzug folgt den Belegen. Der Kunde, der
nachrechnet, hat sonst recht.

**Ein stornierter Abschlag hält an, statt still zu verschwinden.** Es gibt
keinen Zustand `storniert` auf `rechnung` — eine Stornierung ist ein eigener
Beleg, der zurückverweist (Invariante 4, K-12). Ob die Schlussrechnung den
Abschlag deshalb gar nicht, den Storno mit, oder einen Ersatz abzieht, ist eine
kaufmännische Entscheidung. Die Plattform nennt die Nummer und hört auf; das
ist die einzige Antwort, die nicht falsch sein kann.

**Und die Festschreibung weist eine unvollständige Schlussrechnung ab**, vor
der Nummernvergabe (Schritt 2a in `finalisiere`) — danach wäre die Warnung
wertlos, weil der Zähler unwiderruflich weitergerückt ist. Die Meldung nennt
die Nummern; „es fehlt etwas" ist keine Auskunft, mit der jemand arbeiten kann.

**Offen: der Sicherheitseinbehalt (O-20).**
`finanz/abschlag/bedingungen.platzhalter.ts` setzt `einbehalt: null`, und das
ist die einzige Belegung, die dort stehen darf. Jeder Zahlenwert — auch der
branchenübliche — wäre eine Vertragsklausel, die niemand vereinbart hat, auf
einem Beleg, der nach dem Festschreiben unveränderlich ist. Die Richtung ist
bewusst gewählt: ohne Entscheidung wird nichts einbehalten, der Kunde zahlt den
vollen Betrag, und die Gruppe trägt das Risiko einer Nachverhandlung.
Andersherum stünde auf einer Rechnung ein Abzug ohne Grundlage.

---

### D-390 · §13b und §48 werden aus Nachweisen gelesen, nicht aus dem Gewerk abgeleitet

PR 51 (FIN-09, FIN-10, LEG-06).

**Der Fehler, der hier nicht gemacht wird**, steht in `01-ORDNERSTRUKTUR.md`
§8.6 beim Namen: „a reverse-charge invoice inferred from a trade code". Die
REALTIME Service GmbH baut auch um, ohne dass jede Position eine Bauleistung
nach §13b Abs. 2 Nr. 4 wäre; die CSE Dienstleistungen reinigt für Kunden, die
selbst reinigen, und für solche, die es nicht tun. Aus dem Mandanten lässt sich
der Steuerfall nicht ableiten. Die Art der Leistung steht deshalb auf dem BELEG
(`rechnung.reverse_charge_grundlage`), gesetzt von einem Menschen; der Dienst
beantwortet nur, was daraus folgt.

**Zwei Tatbestände, nicht einer.** Nr. 4 verlagert bei Bauleistungen, Nr. 8 bei
Gebäudereinigungsleistungen an einen Unternehmer, der selbst reinigt. In dieser
Gruppe ist der zweite der häufigere. `kunde_bauleistender_status` trägt deshalb
`leistungsart`, und ein `EXCLUDE` schliesst überlappende Zeiträume je Kunde und
Art aus — zwei Antworten auf eine Frage, deren Auswahl die Sortierung träfe,
sind so gar nicht erst speicherbar.

**Der Status wird am Leistungsdatum gelesen, nicht heute.** Ein Kunde, der seit
letztem Monat kein Bauleistender mehr ist, war es im August; eine Rechnung über
August muss das tragen. Ein boolesches Kennzeichen auf `kunde` hätte jede
historische Rechnung beim nächsten Statuswechsel rückwirkend umgedeutet — auf
Belegen, die unveränderlich sind.

**Der Riegel gegen §13b ohne Nachweis sitzt in der Datenbank**
(`fin.reverse_charge_pruefen`, 0118), nicht nur im Dienst: ein Import, ein
Skript oder eine spätere Route ginge sonst daran vorbei. Wer die Steuer zu
Unrecht verlagert, weist keine Umsatzsteuer aus, der Empfänger schuldet sie
nicht, und der Leistende schuldet sie trotzdem (§13a UStG), ohne sie eingenommen
zu haben — Jahre später, auf einem Beleg, den niemand mehr ändert.

**§48 EStG hat zwei teure Richtungen, und beide hängen an einem Datum.** Wer
nicht einbehält, obwohl er müsste, haftet (§48a Abs. 3 EStG); wer einbehält,
obwohl eine gültige Bescheinigung vorlag, zieht dem Kunden Geld ab, das ihm
zusteht. Die Tests fahren deshalb die GRENZTAGE einzeln: eine Bescheinigung,
die am Tag vor dem Stichtag endet, befreit nicht; eine, die am Stichtag endet,
befreit. Dazwischen liegen bei 10.000 € genau 1.500 €.

**Und §48b kennt zwei Formen.** Eine auftragsbezogene Bescheinigung befreit
EINEN Auftrag; ohne `umfang` und `auftrag_id` nähme der Prüfer sie für jeden
anderen mit an.

**Offen (O-21), und sichtbar statt still entschieden.** Welcher Stichtag gilt —
Leistungsende, Zahlung, oder geteilte Abrechnung —, ist nicht beantwortet. Bis
dahin `leistung_bis`, als EIN injizierter Parameter
(`estg48/grenzen.platzhalter.ts`: die Antwort ist ein Wert dort plus ein Test,
kein Umbau). Endet die Gültigkeit einer Bescheinigung INNERHALB des
Leistungszeitraums, trägt die Lage eine Warnung mit der Nummer und dem Datum —
der Mensch, der unterschreibt, sieht den Fall. Die Bagatellgrenzen des §48
Abs. 2 EStG bleiben unangewandt: ohne Grenze wird immer einbehalten, und das
ist die Seite, die nicht haftet.

### D-391 · Die Nutzlast bekommt eine zweite Gestalt, weil eine Anschrift kein Satz ist

PR 52 (FIN-11, K-12, §5.3).

`cse.rechnung.v1` trug jede Anschrift als EINE Zeile — `concat_ws(', ', strasse,
concat_ws(' ', plz, ort), land)`, erzeugt in der Kopfabfrage. Für das PDF genügt
das; ein Mensch liest die Zeile und erkennt die Adresse.

**EN 16931 liest keine Zeilen.** Die Norm führt Straße, Ort, Postleitzahl und
Ländercode als eigene Geschäftsanforderungen (BT-35, BT-37, BT-38, BT-40 für
den Leistenden; BT-50, BT-52, BT-53, BT-55 für den Empfänger), und die
XRechnung-CIUS macht drei davon zu harten Regeln (BR-DE-3 bis BR-DE-5). Aus
einer Zeile ergeben sie sich nur durch Raten: ein Komma ist kein Feldtrenner,
`"Berlin, DE"` und `"Berlin"` sind beide plausibel, und ein falscher Ländercode
lässt die Rechnung beim Empfänger durchfallen — nachdem sie festgeschrieben und
damit unveränderlich ist.

**K-12 lässt genau einen Weg offen.** Der Snapshot IST das Dokument; die
XRechnung liest ihn und nicht die Stammdaten. Also muss der Snapshot die Felder
tragen. Die Alternative — beim Erzeugen doch frisch abfragen — hiesse, dass eine
spätere Pflege des Kundenstamms ändert, was die XRechnung sagt, während die
Kettenprüfung weiter „intakt" meldet: zwei Dokumente zu einer Rechnungsnummer,
und das zweite beweist nichts.

**Bestehende Glieder bleiben gültig, und zwar ohne Zutun.** Der Kettenlauf hasht
`rechnung_snapshot.nutzlast_bytes`, wie sie gespeichert sind; er baut die
Nutzlast nie neu. Eine v1-Zeile bleibt byte-gleich, verifiziert weiter und trägt
ihre Gestalt in `schema_version` bei sich. Genau dafür gibt es das Feld.

**Eine v1-Rechnung bekommt trotzdem keine XRechnung** (`SnapshotZuAltFehler`).
Sie ist nicht verloren — sie ist nur nicht maschinenlesbar zustellbar, und der
Weg dahin ist Storno und Neuausstellung. Das ist eine kaufmännische
Entscheidung und keine, die ein Parser heimlich trifft.

Mitgekommen ist der **Verkäuferkontakt** (BG-6): BR-DE-2 macht die Gruppe zur
Pflicht, BR-DE-6 bis BR-DE-8 die drei Felder darin. Zwei standen längst auf
`mandant` (`telefon`, `email`); das dritte, die Kontaktstelle (BT-41), gab es
nicht. `0119` legt die Spalte an und lässt sie NULL: was der öffentliche
Auftraggeber auf der Rechnung liest und wen er anruft, entscheidet die
Gesellschaft. Ein `default 'Buchhaltung'` wäre in neun von zehn Fällen richtig
und damit die teuerste Sorte Erfindung.

### D-392 · Die XRechnung-Pflichtfelder sperren die Festschreibung, nicht den Download

PR 52 (FIN-11, §14 UStG-Vorprüfung).

Der naheliegende Ort für die Prüfung wäre das Erzeugen des Dokuments gewesen:
wer herunterlädt, bekommt entweder eine XRechnung oder eine Fehlerliste. Das
ist **zu spät**. Zum Zeitpunkt des Downloads ist die Rechnung festgeschrieben,
trägt eine gezogene Nummer und hängt in der Hashkette; der einzige Weg zurück
ist ein Storno und eine neue Rechnung — wegen einer fehlenden Telefonnummer.

05-API-KARTE §D sagt es für die Leitweg-ID ausdrücklich: bei einem öffentlichen
Auftraggeber ist sie sperrend, „weil FIN-11 die XRechnung zum einzigen Weg
macht, ihn überhaupt abzurechnen". Dasselbe gilt für die übrigen
Pflichtangaben derselben Norm. Die Regel `xrechnung.pflichtfelder` steht deshalb
im §14-Bericht und blockiert die Festschreibung.

**Sie greift nur, wenn der Kunde eine XRechnung verlangt** (`xrechnung_pflicht`
oder `ist_oeffentlicher_auftraggeber`) — und dann als Fehler, nicht als Warnung.
Eine Reinigungsrechnung an eine Hausverwaltung braucht kein BT-41; eine Warnung,
die auf jedem zweiten Beleg steht, liest nach zwei Wochen niemand mehr.

**Eine Liste, zwei Aufrufer.** `fehlendePflichtfelder` nimmt eine schmalere
Gestalt als eine ganze Rechnung (`XRechnungEingabe`), und `RechnungVollstaendig`
erfüllt sie von selbst. Die Vorprüfung baut sie aus ihrer eigenen Abfrage, weil
ein Entwurf weder Nummer noch Kettenposition hat. Zwei getrennte Listen wären
die teurere Lösung: sie driften auseinander, und zwar in der Richtung, in der
die Vorschau „vollständig" sagt und der Erzeuger sich danach weigert.

`BT-3` ist die eine Ausnahme: der Rechnungsart-Code entsteht erst beim Zug der
Nummer. Ihn in der Vorprüfung zu verlangen hiesse, jeden Entwurf zu sperren.

### D-393 · Der KoSIT-Prüfer läuft in CI — und hat sofort zwei Fehler gefunden, die keine Eigenprüfung findet

PR 52 (FIN-11, SPEC §14, 01-ORDNERSTRUKTUR §11.2).

Jede Zusage in `tests/kern/xrechnung.test.ts` stammt aus demselben Kopf wie der
Erzeuger und teilt seine Irrtümer. Der KoSIT-Prüfer ist das Werkzeug, gegen das
die Rechnungseingangsplattformen des Bundes und der Länder prüfen; er kennt die
Regeln, an die ich nicht gedacht habe. Beim ersten Lauf gegen die vier Muster:

1. **Die `CustomizationID` trug die Schreibweise der Fassung 2.x**
   (`urn:xoev-de:kosit:standard:xrechnung_3.0`). Zur 3.0 hat die KoSIT den
   Bezeichner auf `urn:xeinkauf.de:kosit:xrechnung_3.0` umgestellt. Das Dokument
   war wohlgeformt, vollständig und inhaltlich richtig; der Prüfer meldete
   `noScenarioMatched` und wies ALLE VIER ab, ohne einen einzigen inhaltlichen
   Fehler zu nennen. Keine selbstgeschriebene Prüfung hätte das gefunden — sie
   hätte dieselbe falsche Zeichenkette erwartet.
2. **`PartyLegalEntity/RegistrationAddress` mit dem Registergericht.** Nach §35a
   GmbHG gehört es auf jeden Geschäftsbrief; UBL-CR-185 schliesst das Element in
   einem Rechnungsdokument aus. Der Prüfer nahm die Rechnung an und beanstandete
   sie — ein Zustand, in dem niemand arbeiten will. Das Gericht steht weiter im
   Snapshot und auf dem PDF.

**Eigener Auftrag, nicht in `pruefung`.** Der Prüfer ist ein Java-Werkzeug mit
einer getrennt veröffentlichten Regelwerksfassung. Ihn in den Hauptlauf zu
hängen hiesse, jede Prüfung an zwei Downloads zu binden, die mit ihr nichts zu
tun haben. Beide Fassungen sind **gepinnt**: ohne Pin brächte eine neue
Regelwerksfassung den Bau an einem beliebigen Dienstag zu Fall, ohne dass jemand
etwas geändert hätte, und niemand wüsste, ob die neue Regel richtig ist oder
unsere Rechnung.

**Der Lauf fällt, wenn der Prüfer fehlt — er überspringt nicht.** Ein
übersprungener Konformitätstest ist ein grüner Lauf ohne Prüfung, und das ist
genau die Freigabe, die 04-SEITENKARTE §5.14.3 verbietet. Nur lokal, ohne Java
und ohne Prüfer, gibt es einen Hinweis statt eines Fehlschlags.

**Und die Oberfläche behauptet weiterhin nichts.** §5.14.3 nennt drei Zustände —
„In CI validiert" mit der Regelwerksfassung, „Prüfung ausstehend", „Prüfer nicht
verbunden" — und verbietet einen vierten, der wie ein Bestehen aussieht.
`pruefstand.ts` kennt genau diese drei, und sein Vorgabewert ist der
zurückhaltendste. „In CI validiert" sagt ausdrücklich, dass die Aussage dem
ERZEUGER gilt und nicht dieser einzelnen Rechnung.

### D-394 · Vier Spalten, die niemand beschrieb — und eine Vorprüfung, die daran fast jede Rechnung gesperrt hätte

PR 52.1 (FIN-11, K-12).

`rechnung` trägt seit 0075 vier Spalten: `verkaeufer_eadresse`,
`verkaeufer_eadresse_schema`, `kaeufer_eadresse`, `kaeufer_eadresse_schema`.
Sie werden gelesen — von der kanonischen Nutzlast (BT-34, BT-49) und seit
PR 52 von der §14-Vorprüfung. **Geschrieben wurden sie von nichts.** Kein
Formular, keine Route, keine Funktion, kein Seed.

Das blieb folgenlos, solange niemand eine XRechnung baute. Mit PR 52 wurde es
zum Fehler mit zwei Gesichtern: der Erzeuger meldete auf JEDER Rechnung zwei
fehlende Pflichtangaben, und die neue FIN-11-Regel hätte jede Festschreibung
an einen öffentlichen Auftraggeber blockiert — mit zwei Feldern, die in keiner
Maske stehen. **Ein Riegel, den niemand öffnen kann, ist kein Riegel, sondern
eine Sackgasse.**

**Zwei Dinge fehlten, nicht eines.** Auf der Käuferseite gab es die Quelle
längst (`kunde.elektronische_adresse`, seit 0020); auf der Verkäuferseite gab
es sie nicht. `0120` legt `mandant.elektronische_adresse` an — und lässt sie
NULL. Welche Adresse eine Gesellschaft für elektronische Rechnungen benennt
und unter welchem EAS-Schema, ist eine Auskunft des Mandanten; die USt-IdNr.
unter EAS 9930 wäre ein plausibler Vorgabewert und trotzdem geraten. Ein
`CHECK` verlangt beide Hälften oder keine: eine Adresse ohne Schema ist
unlesbar, ein Schema ohne Adresse leer.

**Eingefroren wird per Trigger, nicht in `fin.rechnung_nummer_ziehen`.** Die
Funktion ist der eine Weg, auf dem heute festgeschrieben wird — aber nur
heute. Ein Import oder eine spätere Route setzt `status` und ginge daran
vorbei. Dieselbe Begründung wie bei `fin.reverse_charge_pruefen` (D-390): der
Riegel gehört an die Tabelle. `coalesce` statt Überschreiben, weil ein Kunde
für EINEN Auftrag eine andere Eingangsadresse nennen kann als im Stammsatz —
und der Beleg ist dann der richtige Ort dafür.

**Die Vorprüfung liest den WIRKSAMEN Wert.** Sie läuft vor dem Zug der Nummer,
also vor dem Einfrieren; stur die Spalte gelesen meldete sie BT-34 und BT-49
als fehlend und blockierte genau die Rechnung, die eine Millisekunde später
beide Werte bekommt. Derselbe `coalesce`-Ausdruck wie im Trigger, mit Absicht:
was die Vorschau grün nennt, muss der Beleg auch tragen.

**Denselben Fehler gab es ein zweites Mal, und mein eigener Kommentar hatte
davor gewarnt.** `zahlung.bankkonto` stand in `ladeRechnungVollstaendig` auf
`null` mit dem Vermerk „kommt mit PR 49". PR 49 hat keine `bankkonto`-Tabelle
gebracht, und `mandant.iban` gibt es seit 0001. Die Vorprüfung las `mandant.iban`
und meldete BT-84 als vorhanden, der Erzeuger las die `null` und meldete es als
fehlend: die Vorschau sagte grün, das Dokument entstand nicht. Genau die
Divergenz, gegen die `XRechnungEingabe` geschrieben wurde — nur an einer
Stelle, an der ich sie selbst nicht gesucht hatte. Gefunden hat sie der erste
Isolationstest, der einen Beleg wirklich bis zum Dokument führte.

**Und die Demodaten kannten keinen öffentlichen Auftraggeber.** ROADMAP Phase 6
nennt als Abnahme „a KoSIT-valid XRechnung is produced for a public buyer";
der Seed führte vier Hausverwaltungen. Der ganze FIN-11-Weg liess sich nicht
einmal ansehen. Es gibt jetzt ein Bezirksamt — erfunden wie die übrigen
Demofirmen, mit einer Leitweg-ID in der FORM der echten. Welche Kennung ein
wirklicher Auftraggeber hat, bleibt O-22.

**Die Abnahme ist damit vorführbar und nicht nur behauptet:** ein Beleg aus der
Seed-Datenbank, festgeschrieben über den echten Weg, aus dem Snapshot gebaut,
vom KoSIT-Prüfer angenommen — Schema und Schematron, ohne Beanstandung.

### D-395 · BT-81 hatte kein Feld — und der erste Browsertest hat es gefunden

PR 52.2 (FIN-11, §4.2).

Die FIN-11-Regel aus PR 52 sperrt die Festschreibung an einen öffentlichen
Auftraggeber, wenn eine Pflichtangabe fehlt. Richtig — aber **BT-81
(Zahlungsart, UNTDID 4461) hatte keine Maske.** `rechnung.zahlungsmittel_code`
gab es seit 0075; kein Formular setzte ihn. Eine Rechnung an das Bezirksamt
liess sich damit über die Oberfläche gar nicht anlegen: die Vorprüfung nannte
ein Feld, das niemand ausfüllen konnte.

Gefunden hat das nicht ein Gedanke, sondern der erste Browsertest, der einen
Beleg wirklich bis zum Dokument führen wollte. **Dieselbe Klasse Fehler wie
D-394, nur eine Ebene höher:** ein Riegel ohne Schlüssel.

Das Feld steht jetzt im Anlegen-Formular, **ohne Vorgabewert** — aus demselben
Grund wie das Zahlungsziel (§4.2): ein stilles `58` behauptete eine
SEPA-Überweisung, die niemand vereinbart hat, und stünde unveränderlich im
Beleg. Die Liste in `services/finanz/zahlungsmittel.ts` ist die normative
UNTDID-4461-Teilmenge und entscheidet nichts: welches Zahlungsmittel für einen
Beleg gilt, setzt ein Mensch. `zahlungsmittelCode()` siebt, was nicht auf der
Liste steht — ein Freitext käme sonst unverändert ins Dokument und fiele beim
Prüfer über BR-CL-16, nach dem Versand.

**Zwei weitere Lücken im selben Lauf**, beide Stammdaten, beide gleich
behandelt: die Demogesellschaften hatten keine Bankverbindung (BT-84, ohne die
BR-DE-13 jede SEPA-Rechnung sperrt) — jetzt eine öffentlich dokumentierte
TESTkennung mit `TODO(client, O-353)`, nie eine echte Kontonummer in einer
Quelldatei. Und die Vorauswahl der Mengeneinheit ist `einsatz`, die keinen
UN/ECE-Rec-20-Code hat und auch keinen bekommen kann (O-174): der Beleg wird
zu Recht abgewiesen, und der Test wählt jetzt Quadratmeter. Die Lehre steht im
Test und nicht in einer stillen Änderung — wer für einen öffentlichen
Auftraggeber abrechnet, braucht eine Einheit mit Code.

**Und ein echter Barrierefreiheitsmangel, den ich selbst eingebaut hatte.**
Der Vorschaukasten der XRechnung rollt; ohne `tabIndex` kommt eine Person ohne
Maus an die Zeilen unterhalb der ersten vierzig nicht heran
(`scrollable-region-focusable`, DESIGN §9, BFSG/LEG-07). Der axe-Fall, den ich
zur Seite geschrieben hatte, hat ihn beim ersten Lauf gemeldet.

**Ein flackernder Test, mit Ursache statt mit Wiederholung behoben.** Die
axe-Prüfung der Anmeldung war zeitweise rot mit `document-title`. Gemessen:
unmittelbar nach `waitForURL` meldet der Browser `document.title === ''`, kurz
darauf den richtigen Titel — der zweite Schritt entsteht durch eine
clientseitige Navigation, und die Adresse wechselt, bevor Next die Metadaten
angewandt hat. axe lief in dieses Fenster. Die Prüfung wartet jetzt auf die
Bedingung, von der sie abhängt, und die Wartezeile ist zugleich eine
Zusicherung auf den erwarteten Titel: strenger als vorher, nicht lascher.

### D-396 · Die Löschsperre gehört in die Registratur, nicht in die Migration

PR 52.3 (Invariante 8, K-16, LEG-01).

`src/server/db/schema/rls.ts` führt jede Tabelle, die
`kern.verhindere_loeschung()` trägt, mit ihrer **Löschart** und ihrem
**Grund**; `scripts/generate-triggers.ts` schreibt daraus den Block ans Ende
der jeweiligen Migration. Die Liste ist damit kein Kommentar, sondern die
Quelle — und sie ist das, was ein Prüfer liest, wenn er fragt, welche Daten
dieses Hauses nicht gelöscht werden dürfen.

**PR 50 und PR 51 haben daran vorbeigearbeitet.** `abschlagsrechnung_bezug`,
`kunde_bauleistender_status` und `freistellungsbescheinigung` bekamen ihre
Sperre von Hand in die Migration geschrieben. In der Datenbank war alles
richtig; die Registratur nannte sie nicht. Der Unterschied ist nicht
kosmetisch: eine Liste, die drei Finanztabellen unterschlägt, liest sich für
den nächsten Menschen so, als dürfte man sie löschen — und die Löschart, die
den Weg *heraus* beschreibt (`wirksam`, `gilt_bis`, `widerrufen_am`), stand
nirgends.

Gefunden hat es `unveraenderbarkeit.test.ts` §(4), und zwar in der Richtung,
die man beim Schreiben einer Wache leicht vergisst: nicht „steht jede
registrierte Tabelle auch in der Datenbank", sondern **„trägt eine Tabelle den
Auslöser, ohne registriert zu sein"**. Nur diese Richtung fängt den Fall, in
dem jemand die Sperre setzt und die Liste vergisst. Der Kommentar über der
Wache sagt es wörtlich: „the registry cannot go stale in either direction."

Alle drei sind `archiv`: die Zeile bleibt, ihr Zustand ändert sich. Der
Präzedenzfall ist `kleinbetrag_grenze` und `steuersatz_gruppe` — eine
ausgelaufene Gültigkeit bekommt ihr Enddatum, eine neue Lage ist eine neue
Zeile.

**Und der Fall war lange unsichtbar, weil ich ihn nie erreicht habe.** Die
Isolationssuite läuft ~25 Minuten; ich hatte sie viermal vorzeitig
abgebrochen, um an einem roten CI-Lauf oder an einer Migration zu arbeiten,
und die betroffene Datei liegt in der zweiten Hälfte. Die Lehre ist nicht
„öfter laufen lassen", sondern: **ein Lauf, der abgebrochen wird, hat nichts
bewiesen** — und die drei grünen Teilläufe davor haben mich das Gegenteil
glauben lassen.

---

### D-397 · Der offene Posten entsteht an der Tabelle, nicht in der Festschreibungsfunktion

PR 54.1 (FIN-14, ACC-07, `05-FINANZEN.md` §7.3).

Eine festgeschriebene Rechnung war bisher das Ende der Kette: Nummer, Hash,
Fälligkeit — und danach wusste das System nicht, ob sie bezahlt wurde. Ohne
offenen Posten gibt es keinen Mahnlauf (FIN-15), keine Wache „überfällig > 14
Tage", keine Altersliste und kein Ausgangsbuch, das sich abstimmen lässt
(FIN-16). 0121 bringt `zahlung`, `offener_posten`, `zahlung_zuordnung`,
`op_ausgleich` und die beiden Stammtische `bankkonto` und `kasse`.

**Wo der Posten entsteht, ist die eigentliche Entscheidung.** Der naheliegende
Ort wäre `fin.rechnung_nummer_ziehen` — dort läuft heute jede Festschreibung
durch. „Heute" ist das Problem: ein Import, ein Reparaturskript oder eine
spätere Route setzt `status` und ginge daran vorbei. Die Rechnung stünde dann
gestellt in den Büchern und in keiner Forderungsliste, und bemerkt würde es,
wenn das Geld ausbleibt. Der Auslöser hängt deshalb an `rechnung`, mit
derselben Begründung wie `fin.eadresse_einfrieren` (0120) und
`fin.reverse_charge_pruefen` (D-390): **der Riegel gehört an die Tabelle.**

Nachstellen lässt sich der zweite Weg heute nicht — 0077 lässt keine
festgeschriebene Rechnung ohne Snapshot zu, und 0076 lässt den Status nur
einmal wandern. Die Eigenschaft wird deshalb dort geprüft, wo sie steht: ein
Isolationstest liest `pg_trigger` und verlangt, dass
`fin.rechnung_nummer_ziehen` das Wort `offener_posten` NICHT enthält. Diese
Prüfung schlägt an dem Tag an, an dem jemand den Auslöser in die Funktion
zurückholt.

**Kein Cent-Feld trägt ein Vorzeichen.** Die Richtung steht in
`zahlung.richtung` und `offener_posten.art`. Ein Storno öffnet deshalb
`debitor_guthaben` mit positivem Betrag und nicht `debitor` mit negativem:
`offen_cent` ist `betrag_cent − bezahlt_cent`, und ein negativer Posten
erreichte die Null nur über `bezahlt_cent < 0`, was `CHECK (bezahlt_cent >= 0)`
verbietet. Er stünde für immer in der Altersliste.

---

### D-398 · Eine Überzahlung wird ein Guthaben — sie verschwindet nie

PR 54.1 (FIN-14, ACC-07).

Kommen 1.500,00 € auf eine Rechnung über 1.190,00 €, gibt es drei
Möglichkeiten und zwei davon sind falsch: den Rest wegwerfen (der Kunde
bekommt sein Geld nie zurück, und niemand sieht es) oder ihn auf die Rechnung
buchen (der Posten wäre „mehr als bezahlt", und die Forderungsliste stimmt
nicht mehr). Richtig ist die dritte: die Rechnung ist ausgeglichen, und
310,00 € stehen als `debitor_guthaben` offen — eine Verbindlichkeit gegenüber
dem Kunden.

`fin.op_fortschreiben` weist jede Zuordnung ab, die `bezahlt_cent` über
`betrag_cent` schöbe; nur eine ausdrückliche `differenz` mit Begründung darf
abschließen, und auch die nur bis zur Höhe des Restes. Eine
`ueberzahlung`-Zeile berührt `bezahlt_cent` gar nicht: sie ERZEUGT das
Guthaben, sie gleicht es nicht aus.

**Die Deckungsprüfung zählt nur, was von der Zahlung wirklich abgeht.** Die
erste Fassung verlangte „Summe aller Zuordnungen ≤ Zahlungsbetrag" und machte
damit den häufigsten Alltagsfall unbuchbar: 1.189,00 € kommen auf eine
Rechnung über 1.190,00 €, der eine Euro wird abgeschrieben — Summe 1.190,00 €,
Zahlung 1.189,00 €, abgewiesen. Vier der acht Arten bewegen kein Geld
(`skonto`, `bauabzugsteuer_einbehalt`, `differenz`, `gebuehr`), und sie zählen
seither nicht mit. Gefunden hat es der Test, nicht das Nachdenken.

**Und der Skonto wird nach BRUTTO aufgeteilt, nicht nach Netto.** §17 UStG
mindert das Entgelt je Steuersatzgruppe. Bei 1.000,00 € zu 19 % und 1.000,00 €
nach §13b und 2 % Skonto sind das 23,80 € und 20,00 € — beide Nettos sinken um
exakt 2 %. Nach Netto geteilt wären es 21,90 € und 21,90 €: die Summe stimmte,
jede einzelne Zeile wäre falsch, und die Voranmeldung zöge daraus. **OB** ein
Skonto gewährt wird, entscheidet niemand hier: `skonto.platzhalter.ts` hält die
Toleranz auf 0, bis O-177 beantwortet ist, und jede Unterzahlung bleibt bis
dahin ein offener Rest.

---

### D-399 · Eine erzeugte Spalte ist im BEFORE-Auslöser NULL — und hat den Änderungsschutz der Rechnung blockiert

PR 54.1, Nebenbefund (Invariante 4, LEG-01, GoBD).

`fin.rechnung_unveraenderlich` (0076) vergleicht `to_jsonb(old)` mit
`to_jsonb(new)` und nimmt vier Spalten aus — darunter `aufbewahrung_bis`, weil
der Aufbewahrungslauf die GoBD-Frist auf einem festgeschriebenen Beleg setzen
muss.

**Diese Ausnahme war tot.** `rechnung.ueberweisungsbetrag_cent` ist eine
erzeugte Spalte, und PostgreSQL berechnet erzeugte Spalten erst NACH den
BEFORE-Auslösern: in `new` steht dort NULL, in `old` der Wert. Die beiden
Abbilder waren damit auf JEDER Änderung verschieden — auch auf einer, die gar
nichts ändert. Nachgestellt:

```
update rechnung set aufbewahrung_bis = date '2036-12-31' where id = …;
ERROR: Rechnung RE-00001: … unveraenderlich — ueberweisungsbetrag_cent wurde geaendert
```

Zwei Schäden, und der zweite ist der größere: der Aufbewahrungslauf kam an
keine festgeschriebene Rechnung heran, und die Meldung nannte eine Spalte, die
niemand angefasst hatte. Wer sie liest, sucht einen Schreibzugriff, den es
nicht gibt.

0122 nimmt erzeugte Spalten aus dem KATALOG heraus (`pg_attribute.attgenerated`)
und nicht aus einer Liste. `0084` kennt dieselbe Falle und schreibt
`- 'mannstunden'`; das ist dort richtig und hier zu wenig, weil 0076 den
`to_jsonb`-Vergleich ausdrücklich damit begründet, dass eine später
hinzukommende Spalte automatisch geschützt sein soll. Eine ausgeschriebene
Ausnahmeliste wäre am Tag der nächsten erzeugten Spalte wieder falsch — und
wieder still. Verloren geht dabei nichts: eine erzeugte Spalte ist eine
Funktion ihrer Quellspalten, und die stehen im Vergleich.

**Nebenbei aufgefallen und NICHT behoben:** `rechnung.aufbewahrung_klasse`
steht auf `rechnung_ausgang`, und `dokument_aufbewahrung` kennt nur
`rechnung`. Zu keiner Ausgangsrechnung gibt es also eine Regel, `aufbewahrung_bis`
bleibt NULL und `loeschsperre` steht — fail-closed, wie §1.10 es will. Der
Eintrag fehlt trotzdem sichtbar, statt sichtbar offen zu sein; das gehört in
die Runde, die O-25 beantwortet, und nicht in diese.

---

### D-400 · Der nächtliche Abgleich rechnet die offenen Posten unabhängig nach — und repariert nie

PR 54.1 (ACC-07, `05-FINANZEN.md` §7.3, §10).

`offener_posten.bezahlt_cent` ist eine fortgeschriebene Zahl: die Auslöser
erhöhen sie bei jeder Zuordnung und jedem Ausgleich. Das ist nötig — der
Mahnlauf muss sich erinnern, was er gemahnt hat, und eine Altersliste muss
nachträglich reproduzierbar sein. Es ist zugleich die Stelle, an der ein
Rechenfehler still bleibt.

Die Sicht `offener_posten_berechnet` rechnet dieselbe Zahl aus den Belegzeilen
noch einmal, auf einem anderen Weg als der Auslöser. Der Job
`offene_posten_abgleichen` hält beide gegeneinander und nennt die
**Rechnungsnummer** — dieselbe Bauart wie der Kettenlauf (§5.7): zwei Wege zu
derselben Zahl, mit Absicht.

**Er repariert nicht, und das steht nicht in einer Zusage dieses Codes.**
`cse_job` hält auf `offener_posten` genau ein Schreibrecht: `neu_berechnet_am`,
den Stempel „geprüft am". `bezahlt_cent` ist für ihn unerreichbar, weil das
Spaltenrecht es verbietet — ein Isolationstest weist beides nach.

**Die Sabotage, die zunächst grün durchlief.** Nimmt man den
`ueberzahlung`-Ausschluss aus der Sicht heraus, meldete der Lauf auf jedem
Guthabenposten jede Nacht eine Abweichung. Fünf Sabotagen fielen auf ihren
Test; diese eine nicht, weil keine Prüfung eine Überzahlung buchte. Eine
Wache, die täglich dasselbe falsch meldet, wird abgeschaltet — und meldet dann
auch das Richtige nicht mehr. Der fehlende Fall steht jetzt als eigener Test
daneben. Die Lehre ist nicht „mehr Tests", sondern: **eine Sabotage, die
niemanden weckt, prüft die Prüfung.**

---

### D-401 · Die interne Belegnummer der Eingangsrechnung entsteht beim BUCHEN, nicht bei der Freigabe

PR 54.3 (FIN-14, ACC-06, GoBD; `05-FINANZEN.md` §8.2).

Der Kreis `eingangsrechnung_beleg` ist lückenlos — GoBD verlangt eine
fortlaufende Belegnummerierung. Zöge die FREIGABE die Nummer, verbrauchte eine
freigegebene und danach abgelehnte Rechnung eine und liesse sie liegen: genau
die Lücke, deren Unmöglichkeit §5.5 für die Ausgangsrechnung über mehrere
Seiten beweist, im selben Dokument wieder eingeführt. Buchen ist der
unumkehrbare Schritt, also wird dort gezogen — unter `SELECT … FOR UPDATE` auf
der Kreiszeile, wie bei der Ausgangsrechnung.

Die Übergangstabelle steht als **Auslöser**, nicht als Prosa, und `gebucht` ist
ein Endzustand: korrigiert wird durch eine Gegenbuchung (PR 58), nie durch
einen Zustandswechsel. Ein Weg zurück hiesse, dass die Finanzbuchhaltung und
dieses System verschiedene Wahrheiten führen.

**Die Vier-Augen-Freigabe ist Einstellung, kein `CHECK`.** Ein fest
verdrahtetes `freigegeben_von <> erstellt_von` erfände eine
Organisationsregel und sperrte in einem Rückbüro aus zwei Menschen jede
Freigabe ohne Ausweg. `app.einstellung('eingang.vier_augen_ab_cent')` bleibt
NULL, bis O-183 beantwortet ist — dann gilt sie, und der Dienst weist eine
Selbstfreigabe darüber ab.

---

### D-402 · Drei Befunde, die erst der erste Testlauf gezeigt hat

PR 54.3. Alle drei hätten im Betrieb geschwiegen, und zwei davon dauerhaft.

**(a) Der Aufbewahrungsauslöser durfte seine eigene Regelabfrage nicht rufen.**
`fin.aufbewahrung_aus_klasse` läuft als `cse_definer` und ruft
`app.aufbewahrung_regel` (0009), deren `grant execute` nur an `cse_app` ging —
weil bis dahin jeder Aufrufer unter `cse_app` lief. Ergebnis: „permission
denied for function", und zwar so, dass NICHTS rot geworden wäre. Die GoBD-Frist
wäre auf jedem Beleg NULL geblieben, die Löschsperre stünde, und niemand hätte
einen Grund gehabt hinzusehen. Es ist derselbe Befund wie D-388, nur eine Ebene
höher: nicht Recht und Policy auf einer TABELLE, sondern das Ausführungsrecht
auf einer FUNKTION.

**(b) `freigabe_status` heisst `genehmigt`, nicht `freigegeben`.** Der
Übergangsauslöser verglich mit einem Wert, den das Enum nicht kennt; Postgres
weist das ab, also wäre JEDE Freigabe gescheitert. Eine Zeichenkette gegen ein
Enum zu vergleichen sieht in SQL richtig aus, bis sie läuft.

**(c) Die Steuerzeilen brauchen ein UPDATE-Recht.** ACC-05 schlägt zuerst den
Kopf vor und die Sätze danach; wer erfasst, korrigiert die Aufteilung, bis sie
stimmt. Mit `insert`-only scheiterte das `on conflict do update` an „permission
denied". Beweglich sind sie jetzt bis zum Buchen, danach nicht mehr — und das
hält ein Auslöser, kein Rechteentzug: ein Recht kann nicht zwischen „vor" und
„nach dem Buchen" unterscheiden.

Die Lehre ist nicht „mehr Tests". Sie ist: **ein Riegel, der nie gelaufen ist,
ist kein Riegel.** Alle drei Befunde lagen in Code, der beim Lesen richtig
aussah.

---

### D-403 · Die Freigabe bekommt einen Dienst, weil eine abgeschriebene Hashkette nichts bezeugt

PR 54.3 (K-13, APR-07).

Die drei Schritte einer Freigabe — `freigabe`, Kettennummer über
`app.freigabe_kette_ziehen`, `freigabe_snapshot` mit `berechneHash` — standen
bisher an genau EINER Stelle ausgeschrieben: im Seed der Bau-Domäne. Die
zweite Domäne, die eine Freigabe braucht, hätte sie abgeschrieben, und eine
abgeschriebene Hashkette ist eine, die beim ersten Tippfehler nichts mehr
bezeugt — `hash = nutzlast_hash` zu schreiben sieht gleich aus und ist keine
Kette.

`services/freigabe.ts` erteilt sie jetzt an einer Stelle. Die Freigabe friert
ein, WORÜBER entschieden wurde — Lieferant, Nummer, Datum, Betrag —, damit
eine nachträgliche Änderung sie nicht mehr deckt.

**Der Abdruck ist getrennt von `agent/policy.ts::nutzlastHash`, und das ist
Absicht.** Dort geht es um das Tor vor dem, was das Haus VERLÄSST (Invariante
7), und die dortige `Aktion` ist genau diese geschlossene Menge. Die Freigabe
einer Eingangsrechnung ist eine interne Kontrolle; sie in jene Liste zu
schreiben hiesse, eine Buchhaltungsentscheidung als Aussendung zu führen — und
beim nächsten Blick auf die Liste stünde eine Richtlinie „darf automatisch
raus" über einer Rechnungsfreigabe.

Die Freigabe verlangt im Portal ZWEI Rechte: `eingang.freigeben` für die
Entscheidung über die Rechnung und `freigabe.entscheiden` für das Schreiben in
die Kette. Zwei Handlungen, zwei Rechte — und eine Kette, in die jeder
schreiben darf, bezeugt nichts.

---

### D-404 · Das Ausgangsbuch ist eine Lesart, keine Tabelle — und es rechnet zweimal

PR 56 (FIN-16, REP-07, `05-FINANZEN.md` §10).

Jede Zahl im Rechnungsausgangsbuch steht schon irgendwo: auf der Rechnung, im
Snapshot, im Kettenglied. Sie ein zweites Mal zu speichern hiesse, eine zweite
Wahrheit zu führen, die beim ersten Nachtrag von der ersten abweicht. Das Buch
ist deshalb eine Sicht (`security_invoker`), und die Mandantenwand steht dort,
wo sie ohnehin steht — in den Policies der drei Tabellen darunter.

**Die Summe wird trotzdem zweimal gebildet.** `stimmeAb()` liest sie einmal
aus der Sicht und einmal direkt aus `rechnung`, ohne die Joins auf Snapshot
und Kette. Weichen beide ab, liegt der Fehler in der Sicht — und den findet
sonst niemand, weil eine Sicht mit einem falschen Join plausible Zahlen zeigt.
Dieselbe Bauart wie beim Kettenlauf und beim Postenabgleich: zwei Wege zu
derselben Zahl, mit Absicht.

**Der Kundenname kommt aus dem SNAPSHOT** (K-12). Wird ein Kunde umbenannt
oder nach Art. 17 DSGVO anonymisiert, muss das Buch weiter zeigen, was auf dem
Beleg stand. Ein Join auf den Stammsatz gäbe ein Buch, das sich rückwirkend
ändert — und die Hashkette meldete weiter „intakt", weil die Rechnung selbst
sich nicht bewegt hat. Genau dieser Fall steht als Prüfung daneben.

**Wie eine Lücke überhaupt entstehen kann.** Nicht durch Löschen (Invariante
8), nicht durch Verwerfen (0076 weist `festgeschrieben → verworfen` ab) — nur
über den ZÄHLER. Wer `nummernkreis.naechste_nummer` vorstellt, überspringt eine
Nummer, ohne dass sich ein Beleg bewegt. Dafür gibt es dieses Buch, und genau
so wird es geprüft.

**Zwei Prüfungen dieser Datei waren zunächst zu schwach — und beide fielen
erst der Sabotage auf.**

`expect(zeilen.every(z => !z.luecke)).toBe(true)` lief grün durch, als der
`coalesce` aus der Sicht entfernt wurde: ohne ihn ist `luecke` auf der ersten
Zeile jeder Gruppe NULL, und `!null` ist `true`. §10 warnt genau davor — „die
Zusage hätte bestanden oder nicht bestanden, je nachdem wie ein Test sie prüft,
und das ist von drei Ausgängen der schlechteste" — und die erste Fassung dieser
Prüfung tat es trotzdem. Sie vergleicht jetzt gegen `[false, false, false]`.

Die zweite zählte nur Zeilen und lief deshalb auch dann grün, als der Join auf
den Nummernkreis zu einem LEFT JOIN wurde und Entwürfe im Buch auftauchten.
Sie prüft jetzt die ZUSAGE: jede Zeile trägt eine Nummer und ein Kettenglied.

Die Lehre steht schon in D-400 und gilt hier zum zweiten Mal: **eine Sabotage,
die niemanden weckt, prüft die Prüfung.**

**Was PR 56 NICHT bringt: FIN-17.** Umsatz, Kosten und Ergebnis je Periode
hängen an der Frage, ob eine Gesellschaft nach vereinbarten Entgelten (Soll)
oder nach vereinnahmten (Ist, §20 UStG) versteuert — das entscheidet, in
welchem Monat ein Umsatz zählt. `mandant.versteuerungsart` gibt es nicht, und
die Frage ist Teil von O-05. Eine Kennzahl, die sich still für Soll
entscheidet, wäre eine erfundene steuerliche Regel in genau der Zahl, die die
Geschäftsführung liest. Die Kennzahlen kommen, wenn die Frage beantwortet ist
— zusammen mit `buchungssatz` (PR 58), der ohnehin ihre richtige Quelle ist.

### D-405 · Das Mahnwesen schlägt vor; ein Mensch entscheidet, und erst danach läuft der Verzug

FIN-15 verlangt Mahnungen mit Stufen, Gebühren und Zinsen. Was PR 55 dabei
NICHT baut, ist der Automat: der Nachtlauf `mahnvorschlaege_erzeugen` legt
**Entwürfe** an, und ein Entwurf geht nirgendwohin. Er trägt keine Nummer, er
hat keinen Empfänger, er wartet.

Die Kette ist bewusst dreiteilig:

1. **Der Lauf** liest `faellige_forderung` und legt je Kunde und Stufe einen
   Entwurf an — nur, wo eine **bestätigte** `mahnstufe` vorliegt. Wo keine
   liegt, entsteht nichts und der Grund steht auf dem Bildschirm (O-19).
2. **Die Freigabe** ist ein K-13-Vorgang mit Begründung. Erst sie kippt den
   Zustand, und erst dabei zieht `fin.mahnung_uebergang` die Nummer unter
   `FOR UPDATE`.
3. **Der Versand** wird dokumentiert, nicht ausgelöst: es gibt keinen
   Mailversand (O-116), also gehen Brief, Einschreiben und Bote — und
   `e_mail`/`portal` werden abgewiesen statt nachgebaut. Erst danach schreibt
   `mahnung_2_versand` `letzte_mahnstufe` und `letzte_mahnung_am` auf den
   Posten fort.

**§286 Abs. 1 BGB steht in Schritt 3, nicht in Schritt 1.** Der Verzug tritt
durch die Mahnung ein, also trägt die erste keine Zinsen — auch dann nicht,
wenn die Stufe welche vorsieht. Die Ausnahmen des Abs. 2 und 3 hängen an
Vereinbarungen und am Zugang der Rechnung; beides ist offen und bleibt
unangewandt. `zahlbar_bis = mahndatum` folgt §271 BGB: eine überfällige
Forderung ist bereits fällig, und eine im Brief gewährte Frist ist ein
Entgegenkommen, keine Rechtsfolge (O-19).

**Was nicht geraten wird:** Fristen, Gebühren und Zinsart je Stufe (O-19), der
Basiszinssatz selbst (D-409), und wer eine Eskalation freigibt (O-181). Der
Seed legt drei Stufen als **Platzhalter** an — der Demobildschirm zeigt damit
die Sperre statt einer leeren Liste.

### D-406 · Ein Entwurf trägt keine Nummer — jetzt auch erzwungen

`mahnung` hatte die Schranke „freigegeben ohne Nummer ist unmöglich" und die
Gegenrichtung nicht. Damit war eine Nummer auf einem **Entwurf** erlaubt.
Heute schreibt sie niemand; das ist genau die Sorte Zusage, die hält, bis sie
jemand ändert.

Der Befund kam aus einer Sabotage, die zunächst NICHT auffiel: der Auslöser
`mahnung_1_uebergang` wurde so verbogen, dass er die Nummer schon beim Entwurf
zieht — und der Test blieb grün, weil der Entwurf per `INSERT` entsteht und der
Auslöser `BEFORE UPDATE` ist. Die zweite Sabotage — der Dienst schreibt eine
Nummer direkt in den `INSERT` — zeigte die Lücke.

`mahnung_entwurf_ohne_nummer` schliesst sie, wörtlich wie
`rechnung_entwurf_ohne_nummer` in 0075: im Zustand `entwurf` sind `nummer`,
`nummernkreis_id`, `freigegeben_am`, `freigegeben_von` und `freigabe_id` NULL.
Der Grund ist derselbe: eine gezogene Nummer auf einem verworfenen Entwurf ist
eine Lücke im Register, und die erklärt später niemand.

### D-407 · `kunde.mahnsperre_bis` bleibt eine K-05-Spalte — die Sicht fragt ein Tor

Die Sicht `faellige_forderung` muss sagen, warum eine überfällige Forderung
nicht gemahnt wird; eine Mahnsperre beim Kunden ist einer dieser Gründe. Die
Spalte gehört aber seit 0020 zum wirtschaftlichen Block, den `cse_app` NICHT
lesen darf (0104 nennt das ausdrücklich kein Versehen) — und eine
`security_invoker`-Sicht, die sie selbst liest, scheitert für jeden Aufrufer
mit „permission denied for table kunde".

Beide naheliegenden Auswege wären falsch gewesen: das Spaltenrecht zu erteilen
öffnete Sperre und Datum jedem `crm.lesen`; `security_invoker` abzuschalten
hängte die ganze Sicht an `cse_definer` und damit an der Mandantentrennung
vorbei (§1.12).

`app.kunde_mahnsperre_aktiv(kunde, mandant)` ist das engste, was die Frage
beantwortet: **ein Wahrheitswert**, nie das Datum und nie der Grund; das Recht
selbst geprüft, in derselben Dreiteilung wie überall (Nachtlauf `cse_job`,
Gruppenansicht `gruppe.mahnung.lesen`, Mandantensicht `mahnung.lesen`); und
eine Ausnahme statt eines stillen `false`, denn „nicht gesperrt" legte genau
den gesperrten Posten zum Mahnen vor.

### D-408 · Der Abdruck einer Freigabe ist der des TORS, sobald etwas hinausgeht

`erteileFreigabe` (D-403) rechnete einen hauseigenen Abdruck über
`{aktion, mandantId, inhalt}`. `agent/policy.ts::gate` vergleicht beim Versand
gegen `nutzlastHash`, der zusätzlich `betragCent` kanonisiert. Eine mit dem
einen erteilte Freigabe passt also nie zu dem, was das andere prüft — das Tor
hätte **jede** Mahnung abgewiesen, mit der Begründung, die Nutzlast sei nach
der Freigabe geändert worden. Sie war es nie.

`FreigabeErteilen.abdruck` gibt ihn deshalb vor: wer etwas freigibt, das das
Haus verlässt, übergibt `policy.nutzlastHash(nutzlast)`, und der Schnappschuss
speichert Nutzlast und Abdruck zueinander passend. Für rein interne Kontrollen
(eine gebuchte Eingangsrechnung) bleibt der hauseigene richtig; sie gehören
nicht in die Aktionsliste des Tors.

**Die Nutzlast enthält die Mahnungsnummer NICHT** — sie entsteht erst durch die
Freigabe. Entschieden wird über Empfänger, Stufe, Positionen und Beträge; die
Nummer kommt lückenlos aus dem Zähler und ist nichts, worüber ein Mensch
befindet.

### D-409 · Zwei Löcher, die erst der zweite Testlauf zeigte — und der Basiszinssatz, der nicht erfunden wird

**(a) `cse_definer` durfte `freigabe` nicht lesen.** `fin.mahnung_uebergang`
ist `SECURITY DEFINER` (K-01) und fragte „steht der Freigabesatz auf
`genehmigt`?" — ohne Grant und ohne Policy. Jede Freigabe wäre mit „permission
denied for table freigabe" gescheitert, und zwar erst im Betrieb.

Die Reparatur ist nicht nur der Grant. `fin.eingangsrechnung_uebergang` (0123)
stellte dieselbe Frage als gewöhnlicher Auslöser — also unter den Policies des
AUFRUFERS, und `t_mandant` auf `freigabe` verlangt `versand.lesen`. Wem dieses
fremde Recht fehlt, dem hätte die Datenbank „der Freigabesatz steht nicht auf
genehmigt" gesagt: eine falsche Aussage über eine Zeile, die er nicht sehen
darf. Heute halten beide Rollen zufällig beide Rechte; das ist keine Zusage.
`app.freigabe_genehmigt(freigabe, mandant)` beantwortet die **strukturelle**
Frage mit ja/nein, als Definer mit eigenem Spaltenrecht, und beide Auslöser
rufen sie.

**(b) Der Basiszinssatz wird nicht geseedet.** § 247 BGB ist eine echte Zahl
der Deutschen Bundesbank, die halbjährlich wechselt. Ein plausibler Demowert
stellte eine Zinsforderung auf eine erfundene Grundlage — und sähe aus wie
eine richtige. Ohne Zeile fordert jede Mahnung NULL Zins und sagt es; der
Wächter `basiszinssatz_pruefen` fällt am 15. Juni und am 15. Dezember aus,
wenn die kommende Hälfte nicht gedeckt ist. Er holt den Satz nicht selbst: es
gibt keine Bundesbank-Anbindung, und ein falsch geparster Satz erzeugte
falsche Forderungen an echte Kunden. Wer ihn pflegt, ist O-358.

### D-410 · O-19 bekommt einen Bildschirm — und drei Regeln, die vorher an der Sortierung hingen

Eine offene Geschäftsregel braucht zwei Dinge: eine Sperre, damit niemand rät,
und **einen Weg, sie zu beantworten**. Das zweite fehlte. Ohne
`/portal/[mandant]/einstellungen/mahnwesen` liesse sich eine Mahnstufe nur per
SQL bestätigen — und dann bestätigt sie niemand, und die Sperre wird
irgendwann als Fehler gemeldet statt als Frage gelesen.

Drei Entscheidungen stecken darin:

**(a) Bestätigen heisst ablösen, nicht überschreiben.** Die neue Fassung gilt
ab einem Tag, die alte endet am Tag davor und bleibt lesbar. Eine versendete
Mahnung beruft sich auf die Stufe, wie sie GALT; ohne die alte Fassung liesse
sich ein geforderter Betrag nicht mehr herleiten — und genau danach fragt der
Anwalt des Empfängers (Invariante 8).

**(b) Zwei gültige Fassungen derselben Stufe an einem Tag gibt es nicht.** Der
Lauf sucht die Stufe zur nächsten Nummer und nimmt die erste, die er findet.
Gäbe es zwei — die alte mit Gebühr 0, die neue mit 5,00 € —, hinge der
geforderte Betrag an der Sortierung, und **beide Antworten sähen richtig aus**.
`mahnstufe_kein_ueberlapp` (`EXCLUDE USING gist`, dieselbe Konstruktion wie
`bzs_kein_ueberlapp`) macht den Zustand unmöglich, statt ihn zu erkennen.

**(c) Der Verzug beginnt am Versandtag, nicht am Entwurfstag.** Zwischen Lauf
und Freigabe können Tage liegen. `letzte_mahnung_am` nahm bisher das
`mahndatum` — die nächste Stufe forderte damit Zinsen für Tage, an denen noch
nichts hinausgegangen war, zu unseren Gunsten und ohne Grundlage. Der Auslöser
nimmt jetzt den Berliner Kalendertag von `versendet_am`. §286 BGB knüpft
genau genommen an den ZUGANG an, der noch später liegt; dass der Verzugsbeginn
damit höchstens zu früh und nie zu spät steht, ist die konservative Seite
dieser Näherung, und die genaue Regel ist Teil von O-19.

Was der Bildschirm NICHT tut: den Basiszinssatz pflegen. Er gilt für alle
Gesellschaften und ist eine Bekanntmachung der Bundesbank, keine
Hausentscheidung (D-409, O-358).

### D-411 · ZUGFeRD ist kein zweites Rechnungsformat, sondern dieselbe Rechnung zweimal

FIN-11 und FIN-12 sehen wie zwei Aufgaben aus und sind eine. Die XRechnung
(UBL) geht an öffentliche Auftraggeber; ZUGFeRD geht an gewerbliche Kunden,
die eine PDF-Rechnung erwarten und sie automatisch einlesen wollen. EN 16931
ist die gemeinsame Semantik, CII und UBL zwei Syntaxen dafür.

**Beide lesen denselben Snapshot (K-12), und beide benutzen dieselbe
Vorprüfung.** Was als XRechnung nicht entsteht, entsteht auch nicht als
ZUGFeRD. Sonst wäre das eine Format die Hintertür für eine Rechnung, die das
andere als unvollständig abgewiesen hat — an einem Beleg, der nach §14 UStG
nicht mehr geändert werden darf.

Die ROADMAP-Abnahme lautet „totals equal in both directions". Der Test liest
die sieben Endsummen aus BEIDEN Dokumenten und vergleicht sie auf den Cent —
nicht gegen die Eingabedaten, denn zwei Bauer, die dieselbe Zahl gleich falsch
übernehmen, bestünden das.

### D-412 · Das Farbprofil wird gerechnet, nicht mitgeliefert

PDF/A-3 verlangt einen OutputIntent mit eingebettetem ICC-Profil — das Profil
liegt also in JEDER Rechnung, die das Haus verlässt. Die verbreiteten fertigen
sRGB-Profile stehen unter Lizenzen, die genau das mitregeln wollen: eines
unter CC BY-SA, bei mehreren war kein Lizenztext auffindbar. Eine
Share-Alike-Bedingung an einer Kundenrechnung ist eine Verpflichtung, die
niemand eingehen wollte und die niemandem auffällt, bis sie jemandem auffällt.

`icc.ts` erzeugt das Profil stattdessen aus den veröffentlichten Festlegungen
(IEC 61966-2-1 für sRGB, ISO 15076-1 für das Dateiformat): D50-adaptierte
Primärvalenzen, Bradford-Matrix, 1024 Stützstellen der sRGB-Kurve. Das
Ergebnis ist reproduzierbar, prüfbar — `tests/kern/icc.test.ts` liest Kopf und
Tagtabelle zurück — und gehört niemandem.

**Die Schrift ist Noto Sans (OFL 1.1) und nicht Inter.** DESIGN §2 nennt Inter
als Hausschrift; es gibt sie nur als Variable Font, und eine variable Schrift
bettet in PDF/A eine Instanz ein, die niemand festgelegt hat. Für einen Beleg
mit zehn Jahren Aufbewahrungspflicht ist eine statische Schrift die richtige
Wahl, und der Bildschirm bleibt davon unberührt.

**Und dasselbe PDF bei jedem Abruf.** `erzeugtAm` kommt aus dem
Festschreibungsdatum, nicht aus der Uhr: zwei Abrufe desselben Belegs ergeben
byte-gleich dieselbe Datei, und ihr SHA-256 taugt damit als Nachweis. Ein
Dokument, das sich bei jedem Herunterladen ändert, beweist nichts (Invariante
5, K-11).

### D-413 · Ein Konformitätsauftrag fährt nur den Bereich, dessen Werkzeug er installiert hat

`tests/compliance/` prüft gegen FREMDE Werkzeuge, und jedes bringt sein eigenes
Java mit: KoSIT für die XRechnung, veraPDF für das ZUGFeRD-Archiv. Beide
CI-Aufträge riefen `pnpm test:compliance` auf — und das fährt die GANZE
Konfiguration. Der KoSIT-Auftrag fuhr damit auch den veraPDF-Test, ohne dessen
`VERAPDF_CLI`, und umgekehrt. Beide Tests fallen bei fehlendem Werkzeug mit
Absicht durch, statt sich zu überspringen (D-403), also standen zwei rote
Aufträge da, deren eigene Prüfung grün war: der KoSIT-Prüfer hatte alle vier
Muster angenommen, der veraPDF-Prüfer das erzeugte PDF als PDF/A-3B.

Ab jetzt hat jeder Bereich ein eigenes Skript (`test:compliance:xrechnung`,
`test:compliance:zugferd`), das auf sein Verzeichnis einschränkt, und jeder
Auftrag ruft genau seines auf. `pnpm test:compliance` bleibt für den
Entwicklungsrechner, wo beide Prüfer fehlen dürfen.

**Und eine Wache hält es so.** `konformitaetsauftrag` (in `pnpm guards`)
verlangt für jedes Verzeichnis unter `tests/compliance/` ein gleichnamiges
Skript, das einschränkt, und einen Auftrag, der es aufruft; sie meldet den
unbesehenen Aufruf `pnpm test:compliance` in einem Auftrag und auch ein Skript,
dessen Bereich es nicht mehr gibt. Der nächste Bereich — Z3/GoBD in Phase 7 —
bringt wieder ein eigenes Werkzeug mit; wer ihn anlegt und den Auftrag
vergisst, bekäme sonst entweder einen Bereich, den niemand prüft, oder färbte
zwei fremde Aufträge rot. Neun Sabotagefälle in `tests/kern/wachen.test.ts`
zeigen die Wache je einmal feuern.

**Nebenher: das Kennzeichen des echten Baums ist jetzt `pnpm-lock.yaml`.** Die
Wachen erkannten ihn an `package.json` — und diese Wache LIEST `package.json`,
also muss ein Wegwerf-Baum eine schreiben dürfen, ohne sich dadurch als echter
Baum auszugeben und jede andere Wache an einem fehlenden `src/server/db`
abstürzen zu lassen.

**Und der veraPDF-Bericht überlebt jetzt den Fehlschlag.** Der Prüfer endet
mit 1, sobald ein Dokument nicht konform ist; `execFileSync` warf dann, bevor
der Bericht geschrieben war. Rot war der Lauf, leer das Artefakt, und die
verletzte Regel stand nirgends — genau im einzigen Fall, in dem sie jemand
braucht.
