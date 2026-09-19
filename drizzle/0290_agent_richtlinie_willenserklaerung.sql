-- ===========================================================================
-- 0290 — agent_richtlinie: die zweite Linie unter den drei
--        Willenserklaerungen (AGT-03, APR-01, Invariante 7)
--
-- **Was hier fehlte.** `0012` legte den Riegel
-- `agent_richtlinie_kein_auto_angebot`: ein `angebot_senden` mit
-- `auto_erlaubt = true` kommt nicht in die Tabelle. Das war richtig und ist
-- es geblieben — nur sind seither ZWEI weitere Aktionen dazugekommen, die
-- `server/agent/policy.ts` genauso hart sperrt:
--
--   * `nachtrag_einreichen`  — § 2 Abs. 6 VOB/B: eine Willenserklaerung
--     gegenueber dem Auftraggeber mit unmittelbarer Preisfolge.
--   * `behinderung_senden`   — § 6 Abs. 1 VOB/B: eine anspruchswahrende
--     Rechtserklaerung; der Kanal (Einschreiben, Bote) ist Beweisrecht.
--
-- `gate()` hat fuer beide einen eigenen Zweig und weist sie ab, und
-- `setzeRichtlinie` laesst sie nicht speichern. Die TABELLE nahm sie
-- trotzdem: jeder andere Schreiber — ein Job, eine kuenftige Route, ein
-- `psql` in der Hand eines Administrators — konnte `auto_erlaubt = true`
-- ablegen. Der Bildschirm sagt dann korrekt „nie automatisch — im Code
-- gesperrt", und in der Zeile steht das Gegenteil. Wer spaeter belegen soll,
-- was diese Gesellschaft eingestellt HATTE, liest aus dem Audit-Trail eine
-- Erlaubnis heraus, die nie gewirkt hat. Das ist genau die stille, spaet
-- entdeckte Sorte Fehler, gegen die die Invarianten stehen — und es ist der
-- Grund, warum die Datenbank hier die zweite Linie sein muss und nicht die
-- einzige bleiben durfte.
--
-- **Erfunden wird dabei nichts.** Die drei Sperren sind bereits entschieden:
-- sie stehen als eigener Zweig in `gate()`, mit Begruendung in
-- `services/agent/richtlinie.ts` (`IM_CODE_GESPERRT`, `AKTION_GRUND`), und
-- `tests/kern/agent-richtlinie.test.ts` haelt Code und Anzeige gegeneinander.
-- Diese Migration schreibt dieselbe Entscheidung dorthin, wo sie auch ein
-- direkter INSERT trifft.
--
-- **Und der Wertebereich der Spalte.** `aktion` ist blankes `text` ohne Enum.
-- Ein Tippfehler (`email_sender`) legte eine Zeile an, die `gate()` nie
-- nachschlaegt: sie greift nicht und faellt nicht auf — eine Konfiguration,
-- die aussieht, als waere sie eine. Der Riegel listet die acht `AKTIONEN`
-- aus `server/agent/policy.ts`. Dass eine neunte Aktion damit eine Migration
-- braucht, ist keine Huerde, sondern die Kopplung, die man will: `gate()`
-- muss sie ohnehin lernen, sonst wirkt sie nicht.
--
-- Kein Enum-Typ statt des `CHECK`: `freigabe.richtlinie_id` verweist auf
-- diese Tabelle, und ein Typwechsel einer Spalte mit Eindeutigkeitsbedingung
-- und Fremdschluessel ist eine viel groessere Operation als eine Bedingung,
-- die dasselbe leistet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Wertebereich: genau die acht Aktionen des Gates
-- ---------------------------------------------------------------------------

/**
 * `not valid` waere hier falsch. Die Bedingung soll auch fuer die Zeilen
 * gelten, die schon da sind — gaebe es eine mit unbekannter Aktion, wollte
 * man das JETZT wissen und nicht beim naechsten Schreiben auf ihr. Der Seed
 * legt `email_senden`, `mahnung_senden` und `social_veroeffentlichen` an;
 * alle drei stehen in der Liste.
 */
alter table agent_richtlinie
  add constraint agent_richtlinie_aktion_bekannt
  check (aktion in ('email_senden', 'angebot_senden', 'social_veroeffentlichen',
                    'bewerbung_antworten', 'mahnung_senden', 'rechnung_senden',
                    'nachtrag_einreichen', 'behinderung_senden'));

comment on column agent_richtlinie.aktion is
  'AGT-03: die Aktion des Ausgangs-Gates. Der Wertebereich sind die acht AKTIONEN aus '
  'server/agent/policy.ts (0290) — eine Zeile mit einem anderen Wert greift nie, weil '
  'gate() sie nie nachschlaegt, und faellt ohne diesen Riegel auch nicht auf.';

-- ---------------------------------------------------------------------------
-- 2. Keine Automatik fuer die drei Willenserklaerungen
-- ---------------------------------------------------------------------------

/**
 * Der alte Riegel deckte nur das Angebot ab. Er wird ersetzt und nicht
 * ergaenzt, damit fuer diese Aussage genau eine Bedingung zustaendig ist:
 * zwei Riegel mit ueberlappendem Gegenstand sind zwei Stellen, an denen
 * jemand die naechste Aktion nachtraegt — und er traegt sie in eine davon.
 */
alter table agent_richtlinie
  drop constraint agent_richtlinie_kein_auto_angebot;

alter table agent_richtlinie
  add constraint agent_richtlinie_kein_auto_willenserklaerung
  check (not (auto_erlaubt
              and aktion in ('angebot_senden', 'nachtrag_einreichen',
                             'behinderung_senden')));

comment on constraint agent_richtlinie_kein_auto_willenserklaerung on agent_richtlinie is
  'Angebot (§ 145 BGB), Nachtrag (§ 2 Abs. 6 VOB/B) und Behinderungsanzeige '
  '(§ 6 Abs. 1 VOB/B) gehen nie ohne benannten Menschen hinaus. Die Sperre steht in '
  'server/agent/policy.ts; hier steht sie ein zweites Mal, weil ein direkter INSERT '
  'sonst eine Erlaubnis ablegt, die nie wirkt und wie eine aussieht (0290).';

comment on column agent_richtlinie.auto_erlaubt is
  'AGT-03/Invariante 7: darf diese Aktion ohne menschliche Freigabe hinausgehen? Keine '
  'Zeile und eine abgeschaltete Zeile heissen beide „Freigabe noetig" — eine fehlende '
  'Regel ist keine Erlaubnis. Fuer die drei Willenserklaerungen ist true gesperrt (0290).';
