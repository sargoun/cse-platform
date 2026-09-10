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
| O-206 | **Is "CSE Gruppe" a legal entity?** Does a group-level Rechtsträger (holding) exist — under which name, address and register entry — or is the group only a brand over four independent companies? A structured-data `Organization` block carries an address and therefore asserts that such a company exists; until this is answered the site emits four complete `LocalBusiness` entries and no umbrella. | PUB-11, `/impressum`, footer |

---

O-02 has been answered — see **D-11**. O-03 has been answered — see **D-09**; the
`person` / `anstellung` split is confirmed and must be in the schema from the first
migration.
