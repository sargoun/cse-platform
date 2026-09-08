# O-number register — mechanical rebuild

Working file for step 2 of `HANDOVER.md`. Kept in `_review/` as the evidence for how the
register in `docs/DECISIONS.md` was derived. Delete with the rest of `_review/` once Phase 0
is signed off.

**Method.** Every `O-nn` occurrence in the thirteen documents was extracted, grouped by
number, and each occurrence resolved to the *question* it names — not to the number. Nothing
below rests on a document's claim about what it owns.

## What the extraction found

133 numbers were in use across the set (`O-01 … O-133`). They fall into four groups:

| Group | Numbers | State |
|---|---|---|
| Client originals, `docs/DECISIONS.md` | `O-01`, `O-04 … O-13` (`O-02`, `O-03` answered by D-11 / D-09) | consistent everywhere |
| `08-PR-PLAN.md`'s block | `O-14 … O-29` | consistent everywhere |
| **The coordinated chain** | `O-33 … O-133` | consistent; the six documents that hold it cite each other's numbers correctly |
| **Six local blocks** | each document independently minted `O-30 … O-4x` | **collide with the chain and with each other** |

The chain, in the order it was allocated:

| Owner | Numbers |
|---|---|
| `04-SEITENKARTE.md` | `O-33 … O-52` **minus `O-39`**, plus `O-93` and `O-132` |
| `02-datenmodell/04-PLANUNG-ZEIT.md` | `O-39` — 04-SEITENKARTE vacated it deliberately and moved its own question to `O-132` |
| `02-datenmodell/02-CRM-OPERATIONS.md` | `O-53 … O-73` |
| `03-AUTH-BERECHTIGUNGEN.md` | `O-74 … O-92` |
| `05-API-KARTE.md` | `O-94 … O-104` |
| `06-AGENTEN-FREIGABEN.md` | `O-105 … O-115`, `O-133` |
| `07-INTEGRATIONEN.md` | `O-116 … O-131` |

The chain is **kept**. It is the larger, internally coordinated half, and its documents
cross-reference each other by number; renumbering it would break references that are correct
today. `O-30`, `O-31` and `O-32` were never claimed by the chain and stay free.

The colliding local blocks belong to six documents:
`01-ORDNERSTRUKTUR.md`, `02-datenmodell/01-KERN.md`, `02-datenmodell/03-GEWERKE.md`,
`02-datenmodell/04-PLANUNG-ZEIT.md`, `02-datenmodell/05-FINANZEN.md`,
`02-datenmodell/06-RADAR-KI-INHALT.md` — plus the four agent questions
`06-AGENTEN-FREIGABEN.md` shares with 06-RADAR outside its own block.

`O-33` alone carried **six** different questions. Every one of those is resolved below.

## The mapping

`fold` means the question already exists under the target number and the local one is a
duplicate; the document now references the target instead of minting a second number for one
question. `→ O-nnn` means a genuinely new question that gets the next free number.

### `01-ORDNERSTRUKTUR.md` §26

| was | question | now |
|---|---|---|
| O-30 | Nachträge: days an announced Nachtrag may stay unsubmitted before the watchdog escalates, and to whom (BAU-04) | **O-30** (unchanged) |
| O-31 | Certificates: escalation intervals before a §34a / Sachkunde expiry, and to whom at each step (SEC-02, SEC-04) | **O-31** (unchanged) |
| O-32 | Sector minimum wage: which MiLoG / sector rates apply per area, from which date (LEG-02, TIM-13) | **O-32** (unchanged) |
| O-33 | §13b UStG: how is a customer's bauleistender status evidenced | fold → **O-104** (`05-API-KARTE.md`) |
| O-34 | CPV codes confirmed against the official list | fold → **O-98** (`05-API-KARTE.md`) |
| O-35 | Number circles: one per legal entity, or per entity **and** document type | **O-134** (merged with 05-FINANZEN's `nummernkreis` question) |
| O-36 | SMS provider, region, DPA | fold → **O-82** (`auth-sms-anbieter`) |
| O-37 | OCR processor for incoming invoices, region, DPA | **O-135** |
| O-38 | Monitoring / error tracking service, region, DPA | fold → **O-118** (`int-betriebsueberwachung`) |
| O-40 | AUT-07 attempt, window and lockout thresholds | fold → **O-80** (`auth-sperrschwellen`) |

### `02-datenmodell/01-KERN.md` §15

| was | question | now |
|---|---|---|
| O-30 | Which sector wage agreement applies per entity, and is it tracked at all | **O-136** |
| O-31 | May an Admin appoint another Admin, a Leitung a deputy | fold → **O-85** (`auth-rollen-delegation`) |
| O-32 | Two concurrent employments with the **same** entity | **O-137** |
| O-33 | Sick days during approved leave credited back (§9 BUrlG) | **O-138** |
| O-34 | Paid/unpaid per absence type, proof-from-day-N, Lohnart mapping | **O-139** |
| O-35 | Retention **and legal basis** per data class (audit classes, `anmeldeversuch`, `sicherheitsvorfall`, `job_lauf`) | fold → **O-92** (`auth-aufbewahrung-telemetrie`, widened there to name all four) |
| O-36 | Bewacherregister: ID format and check digit, status vocabulary, notification events, §34a activity types | fold → **O-40** (`04-SEITENKARTE.md`, widened) |
| O-37 | Is the §34a Unterrichtung/Sachkunde unbefristet, and what triggers a re-check | **O-140** |
| O-38 | Idle timeout and absolute session lifetime per role; AUT-07 thresholds | fold → **O-79** + **O-80** |
| O-39 | May a Leitung see the internal hourly cost rates of their own area | fold → **O-75** (`auth-entgelt-leitung`) |
| O-40 | Does the first-recording entity keep read access after the person moves | **O-141** |
| O-41 | Which further request types does the group run | **O-142** |
| O-42 | Provisional Stundenkonto state; may a Zeit-Einwand be partially upheld | **O-143** |
| O-43 | Confirm the `qualifikation_kategorie` categories | **O-144** |

### `02-datenmodell/03-GEWERKE.md` §14

| was | question | now |
|---|---|---|
| O-30 | Turnus missed on a public holiday: brought forward, made up, or dropped | **O-145** |
| O-31 | Is a missed Turnus credited against a monthly flat, and at what amount | **O-146** |
| O-32 | Leistungsnachweis: gapless sequential numbering, and from which step | **O-147** |
| O-33 | Which Postenarten and Schlüsselarten are kept | **O-148** |
| O-34 | Qualification requirement for guard duties with no fixed post | **O-149** |
| O-35 | May a started night shift finish when the §34a certificate expires at midnight | **O-150** |
| O-36 | Which Wachbuch entries may the following shift see, and for how long | **O-151** |
| O-37 | Does a contract require presence proof per patrol, in what form | **O-152** |
| O-38 | Must a new Dienstanweisung version be re-acknowledged by all | **O-153** |
| O-39 | BGB-Bauverträge or VOB/B only, and how does the site manager tell | **O-154** |
| O-40 | Gewährleistungsfrist per contract type and from which event | fold → **O-68** (`02-CRM-OPERATIONS.md`) |
| O-41 | Which LV position types occur, and how does each enter the order total | **O-155** |
| O-42 | When is a one-sided Aufmaß billable (§14 Abs. 2 VOB/B) | **O-156** |
| O-43 | Bautagebuch per site or per construction section | **O-157** |
| O-44 | From what threshold is weather work-impeding, per trade | **O-158** |
| O-45 | Which trades are kept in the Bautagebuch (STLB-Bau) | **O-159** |
| O-46 | Which table carries material consumption, so FIN-07 gets its fourth source | **O-160** |
| O-47 | Does recovering a key close the liability case once the lock change is ordered | **O-161** |

### `02-datenmodell/04-PLANUNG-ZEIT.md` §17.1

| was | slug | now |
|---|---|---|
| O-30 | `zeit-milog-aufbewahrungsbeginn` | **O-162** |
| O-31 | `zeit-dst-verguetung` | **O-163** |
| O-32 | `zeit-checkin-kanal` | **O-93** — `04-SEITENKARTE.md` already allocated it there |
| O-33 | `zeit-checkout-toleranz` | **O-164** |
| O-34 | `zeit-nacherfassungsfrist` | **O-165** |
| O-35 | `zeit-konflikt-blockiert` | **O-166** |
| O-36 | `zeit-feiertage-bundesland` | **O-167** |
| O-37 | `zeit-pausenerfassung` | **O-168** |
| O-38 | `zeit-ohne-auftragsbezug` | **O-169** |
| O-39 | `zeit-freigabeschritt` | **O-39** (unchanged — the chain reserved it) |
| O-40 | `zeit-schichtfunktionen` | **O-170** |
| O-41 | `zeit-sonntagsarbeit` | **O-171** |
| O-42 | `zeit-betriebsrat-erweiterung` | **O-172** |
| O-43 | `zeit-korrekturgruende` | **O-173** |

### `02-datenmodell/05-FINANZEN.md` §17

| was | question | now |
|---|---|---|
| O-30 | `nummernkreis`: yearly reset and format mask | **O-134** (merged with 01-ORDNERSTRUKTUR's circle question — one `nummernkreis` question) |
| O-31 | `masseinheit` → UN/ECE Rec 20 codes (BT-130) | **O-174** |
| O-32 | `kleinbetrag_grenze`: issue §33 UStDV small-amount invoices at all | **O-175** |
| O-33 | `bauabzugsteuer_freigrenze` §48 Abs. 2 EStG per entity | **O-176** |
| O-34 | Standard payment term per entity | fold → **O-66** (`02-CRM-OPERATIONS.md` — the document says so itself) |
| O-35 | Skonto rate, term, and the under-payment tolerance | **O-177** |
| O-36 | `storno_art`: is a partial Storno admissible | **O-178** |
| O-37 | `abschlagsplan` conditions and Sicherheitseinbehalt | fold → **O-20** |
| O-38 | May one Zeiteintrag be split across two invoices | **O-179** |
| O-39 | Material taken from stock or bought per order | **O-180** |
| O-40 | Who releases a collection handover or a Mahnbescheid | **O-181** |
| O-41 | Set-off of a customer credit against a supplier liability (§387 BGB) | **O-182** |
| O-42 | Four-eyes release for incoming invoices, from what amount | **O-183** |
| O-43 | Self-billing of subcontractors by Gutschrift (§14 Abs. 2 UStG) | **O-184** |
| O-44 | Receipt-free bookings (Eigenbeleg), up to what amount | **O-185** |
| O-45 | `kasse`: electronic register with TSE (§146a AO) or an open cash box | **O-186** |
| O-46 | Who files the §48a EStG Bauabzugsteuer return | **O-187** |
| O-47 | Intra-Community supplies / §19 UStG small-business rule | fold → **O-60** (`02-CRM-OPERATIONS.md`) |
| O-48 | Who signs the Verfahrensdokumentation, and how often is it reviewed | **O-188** |
| O-49 | Will any entity ever invoice in a currency other than EUR | **O-189** |
| O-50 | Is the counter-signed Leistungsnachweis a `quelle_typ` behind a cleaning line | **O-190** |

### `02-datenmodell/06-RADAR-KI-INHALT.md` §16 — and the four it shares with `06-AGENTEN-FREIGABEN.md`

| was | question | now |
|---|---|---|
| O-30 | CPV lists confirmed against the official list | fold → **O-98** |
| O-31 | Negative keyword / excluding CPV: exclude or only cost points; minimum residual deadline | **O-191** |
| O-32 | FX conversion for the value corridor, and the rate source | fold → **O-47** (`04-SEITENKARTE.md` — the same question) |
| O-33 | When are a national and a TED notice the same procurement | **O-192** |
| O-34 | Are lots evaluated and bid individually | **O-193** |
| O-35 | Catalogue of required documents per platform and procedure | **O-194** |
| O-36 | Budget warning threshold, budget currency, FX source *(also `06-AGENTEN` §18)* | **O-195** |
| O-37 | Maximum tool steps per agent task *(also `06-AGENTEN` §18)* | **O-196** |
| O-38 | Confidence below which a field is `unsicher`; the amount and effect that make a case *hoch* *(also `06-AGENTEN` §18)* | **O-197** |
| O-39 | How long model payloads may be kept before redaction *(also `06-AGENTEN` §18)* | **O-198** |
| O-40 | Which applicant details are collected, and which are necessary (Art. 5(1)(c)) | **O-199** |
| O-41 | Binding status stages of the application process and of a vacancy | **O-200** |
| O-42 | How job requirements are weighted, on what scale | **O-201** |
| O-43 | Which notifications also go out by e-mail | **O-202** |

## Result

- **Highest number in use: `O-202`.** No number carries two questions.
- Nine local questions folded into an existing number rather than minting a second one:
  O-20, O-40, O-47, O-60, O-66, O-68, O-75, O-79/O-80, O-82, O-85, O-92, O-98, O-104, O-118.
- The register itself lives in `docs/DECISIONS.md` under **Open**. This file records only how
  it was derived.
