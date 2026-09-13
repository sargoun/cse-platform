-- ===========================================================================
-- 0137 — Zwei Loecher in 0136, beide von der Isolationssuite gefunden
-- ===========================================================================
--
-- `tests/isolation/freigabe-posteingang.test.ts` hat 0136 zum ersten Mal
-- gegen eine echte Datenbank gefahren. Siebzehn Faelle fielen, und es waren
-- keine siebzehn Fehler, sondern zwei:
--
--  (1) **`app.freigabe_entscheiden` sah die Ansicht nicht.** Jeder Aufruf
--      endete in „diese Person hat sie nie geoeffnet (APR-08)" — obwohl die
--      Zeile stand. `freigabe_ansicht` traegt `force row level security`, und
--      die Policies aus 0136 gelten `to cse_app`. Fuer `cse_definer` gibt es
--      damit KEINE anwendbare Policy, und keine Policy heisst null Zeilen —
--      nicht „permission denied". Die Funktion las also brav nichts und zog
--      daraus den einzigen Schluss, den sie ziehen konnte: es gab keine
--      Ansicht.
--
--      Das ist die Klasse Fehler, vor der D-388 warnt, mit umgekehrtem
--      Vorzeichen: dort war eine Policy zu breit, hier fehlt sie ganz. Beide
--      Male ist das Ergebnis STILL.
--
--  (2) **`revoke select (pruefdauer_sek)` hat nichts bewirkt.** 0012 hat
--      `grant select on freigabe_snapshot to cse_app` gegeben — ein
--      TABELLENWEITES Recht. Ein Spaltenentzug daneben nimmt es nicht weg:
--      Postgres prueft zuerst das Tabellenrecht, findet es, und laesst die
--      Spalte durch. Der Test, der „permission denied" erwartete, bekam eine
--      leere Ergebnismenge — die Spalte war also die ganze Zeit lesbar.
--
--      Und genau diese Spalte ist die, bei der es rechtlich zaehlt: sie misst,
--      wie schnell ein NAMENTLICH bekannter Mensch freigibt (§ 87 Abs. 1
--      Nr. 6 BetrVG, O-06). „Eingeschraenkt" darf nicht heissen „allen
--      gegeben und in der Oberflaeche gefiltert" — und beinahe hiesse es das.

-- ---------------------------------------------------------------------------
-- 1. Der Definer sieht, was er prueft (K-05, D-388)
-- ---------------------------------------------------------------------------

/**
 * **Gebunden an den aktiven Mandanten, nicht `using (true)`.**
 *
 * 0134 hat vier `using (true)`-Policies wieder eingefangen, die dort aus
 * Bequemlichkeit standen: permissive Policies ODERN sich, und eine
 * ungebundene hebt den Mandantsschnitt der gebundenen daneben auf. Diese hier
 * entstehen deshalb gleich gebunden.
 *
 * Der Mandantsschnitt in der Policy ist die zweite Linie; die erste steht im
 * Rumpf von `app.freigabe_entscheiden`, das `f.mandant_id` gegen
 * `app.aktiver_mandant()` prueft, bevor es irgendetwas tut (Invariante 3).
 */
create policy d_freigabe_ansicht on freigabe_ansicht for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

create policy d_freigabe_feld on freigabe_feld for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

/**
 * **`d_freigabe_lesen` gibt es schon** — 0123 hat sie fuer
 * `app.freigabe_genehmigt` angelegt, mit demselben Praedikat. Eine zweite
 * Policy gleichen Sinns waere nicht nur doppelt, sondern gefaehrlich: sie
 * ODERN sich, und die naechste Aenderung an einer von beiden liesse die
 * andere unbemerkt weiter gelten (D-388).
 *
 * Was 0123 nicht mitgeben KONNTE, ist der Spaltenschnitt: dort wurden
 * `(id, mandant_id, status)` gebraucht, hier zusaetzlich `payload_hash` und
 * `erforderliches_recht` — beides Spalten, die es 0123 noch nicht gab. Ein
 * `grant` auf weitere Spalten ergaenzt den vorhandenen, er ersetzt ihn nicht.
 */
grant select (payload_hash, erforderliches_recht, freigegeben_von, freigegeben_am)
  on freigabe to cse_definer;

create policy d_freigabe_schreiben on freigabe for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());
grant update (status, freigegeben_von, freigegeben_am, begruendung, geaendert_am)
  on freigabe to cse_definer;

create policy d_freigabe_snapshot on freigabe_snapshot for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant());
create policy d_freigabe_snapshot_lesen on freigabe_snapshot for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

/**
 * Der Kettenkopf ist die Ausnahme, und sie ist begruendet.
 *
 * `freigabe_kette` steht im Register `NUR_UEBER_DEFINER`: `cse_app` hat dort
 * weder Policy noch Grant, weil ein Zaehler, den jemand von aussen verstellen
 * kann, keine Kette traegt. Der Definer MUSS ihn bewegen —
 * `app.freigabe_kette_ziehen` zieht die Nummer unter `SELECT … FOR UPDATE`.
 * Ein Mandantsschnitt in der Policy waere hier zudem wirkungslos: die
 * Funktion bekommt den Mandanten als Argument und ist die Stelle, die ihn
 * prueft.
 */
create policy d_freigabe_kette on freigabe_kette for all to cse_definer
  using (true) with check (true);

comment on policy d_freigabe_kette on freigabe_kette is
  'Bewusst ungebunden (Gegenstueck zu D-388): der Kettenkopf wird je Mandant '
  'als ARGUMENT gezogen, nicht aus der Sitzung. app.freigabe_kette_ziehen ist '
  'die einzige Tuer, und cse_app hat auf dieser Tabelle gar keinen Grant.';

/**
 * Der Rechtekatalog ist mandantslos — er ist Referenzdaten, keine
 * Gesellschaftszeile. `trg_freigabe_recht_gueltig` liest ihn, um einen
 * Tippfehler in `erforderliches_recht` abzufangen (K-19).
 */
grant select (schluessel) on berechtigung to cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Ein Spaltenentzug wirkt nur ohne Tabellenrecht daneben
-- ---------------------------------------------------------------------------

/**
 * **Erst das Tabellenrecht weg, dann die Spalten einzeln.**
 *
 * Das ist der ganze Fehler aus 0136 und zugleich seine Behebung. Postgres
 * gewaehrt den Zugriff, sobald IRGENDEIN passendes Recht greift; ein
 * `revoke` auf eine Spalte hebt ein tabellenweites `grant` daneben nicht auf.
 * Wer eine Spalte wirklich zurueckhalten will, muss das breite Recht
 * hergeben und die uebrigen Spalten benennen.
 *
 * Die Liste ist damit vollstaendig aufzufuehren — laestig, und genau deshalb
 * richtig: eine neue Spalte auf dieser Tabelle ist ab jetzt eine bewusste
 * Entscheidung darueber, wer sie lesen darf, und nicht eine, die stillschweigend
 * mitkommt.
 */
revoke select on freigabe_snapshot from cse_app;

grant select (
  id, mandant_id, freigabe_id, kette_nr, nutzlast, nutzlast_hash,
  vorheriger_hash, hash, algorithmus, entscheidung, entschieden_von,
  erstellt_am, art, rolle, artefakt_hash, diff, diff_hash, felder,
  felder_hash, ansicht_modell, ansicht_modell_hash, policy_ergebnis,
  policy_ergebnis_hash, richtlinien_version, code_version, modell,
  prompt_version, ist_stapel, stapel_id, stapel_groesse, begruendung,
  widerruft_snapshot_id, ip_adresse, user_agent, entschieden_am
) on freigabe_snapshot to cse_app;

comment on column freigabe_snapshot.pruefdauer_sek is
  'APR-08, K-05, § 87 Abs. 1 Nr. 6 BetrVG. NICHT an cse_app gegeben — '
  'lesbar allein ueber app.freigabe_pruefdauer_lesen, die das Recht erneut '
  'prueft. Ein GRANT gilt einer ROLLE, nicht einer Person; jede Sitzung ist '
  'cse_app, also waere ein Spaltenrecht hier ein Recht fuer alle. Die '
  'personenbezogene Auswertung bleibt bis zur Antwort auf O-06 aus.';

/**
 * `cse_job` liest die Spalte weiterhin — der Waechter
 * `jobs/watchdogs/freigabe-rubberstamp.ts` laeuft unter dieser Rolle und
 * gibt nur die aggregierte, pseudonymisierte Zahl heraus, die §4.9 erlaubt.
 * Er ist kein Mensch an einem Bildschirm, und der Index `fs_rubberstamp_idx`
 * fragt ohnehin keine Spaltenrechte.
 */
grant select on freigabe_snapshot to cse_job;

-- ---------------------------------------------------------------------------
-- 3. Die Rolle des Entscheiders wird KOPIERT, also muss der Definer sie lesen
-- ---------------------------------------------------------------------------

/**
 * `freigabe_snapshot.rolle` haelt fest, welche Rolle die entscheidende Person
 * IM AUGENBLICK der Entscheidung hielt (§4.7). Sie spaeter nachzuschlagen
 * waere kein Beleg: eine Rolle, die heute `leitung` heisst, hiess damals
 * vielleicht `admin`, und die Zuweisung kann laengst entzogen sein. Deshalb
 * kopiert `app.freigabe_entscheiden` sie — und dafuer braucht der Definer die
 * Zuordnung.
 *
 * `rolle` traegt keine `mandant_id`-Zeilenbedingung, weil die Tabelle ein
 * KATALOG ist: fuenf Systemrollen und die je Gesellschaft angelegten. Der
 * Schnitt liegt in `benutzer_mandant`, und der ist bereits gebunden (0128).
 * Die Spalten sind scharf gezogen: die Funktion braucht den Schluessel, nicht
 * den Namen und nicht das Portal.
 */
grant select (id, schluessel) on rolle to cse_definer;

create policy d_rolle_freigabe on rolle for select to cse_definer using (true);

comment on policy d_rolle_freigabe on rolle is
  'K-05, D-388. Der Rollenkatalog ist mandantslos; die Verengung liegt in den '
  'zwei Spalten und darin, dass nur Definer-Funktionen diese Rolle annehmen. '
  'Eine Zeilenbedingung waere hier keine Sicherheit, sondern eine Attrappe.';

/**
 * Und die Tuer zum Kettenkopf. 0012 hat sie nur `cse_app` gegeben — damals
 * zog `erteilen.ts` die Nummer selbst. `app.freigabe_entscheiden` ist eine
 * `security definer`-Funktion und laeuft als `cse_definer`; ohne diese Zeile
 * scheitert JEDE Entscheidung aus dem Posteingang an „permission denied for
 * function freigabe_kette_ziehen" — an der letzten Stelle vor dem Schreiben.
 */
grant execute on function app.freigabe_kette_ziehen(uuid) to cse_definer;

-- ---------------------------------------------------------------------------
-- 4. Der Riegel galt fuer Freigaben, die gar nicht in den Posteingang gehoeren
-- ---------------------------------------------------------------------------

/**
 * `freigabe_offen_ist_vorzeigbar` aus 0136 war richtig gemeint und zu breit
 * gezogen. Er verlangte Titel, Zusammenfassung und Vorschau von JEDER offenen
 * Freigabe — auch von denen, die es seit Phase 6 gibt und die nie durch einen
 * Posteingang laufen: die Behinderungsanzeige (BAU-06) legt eine offene
 * Freigabe an, die ihr eigener Bildschirm vorlegt, nicht dieser hier.
 *
 * Die Bedingung gehoert deshalb an das Merkmal, das eine Zeile ZUM
 * Posteingangseintrag macht: `vorgang_typ`. Wer sich als Agentenvorschlag
 * ausweist, muss vorzeigbar sein; wer es nicht tut, gehoert einer Domaene und
 * wird dort vorgelegt.
 *
 * Das ist keine Abschwaechung, sondern die genauere Fassung derselben Zusage —
 * und sie faellt zusammen mit der Frage, welche Zeilen der Posteingang
 * ueberhaupt listet (der Index unten).
 */
alter table freigabe drop constraint freigabe_offen_ist_vorzeigbar;

alter table freigabe
  add constraint freigabe_offen_ist_vorzeigbar check (
    vorgang_typ is null
    or status <> 'offen'
    or (titel is not null
        and zusammenfassung is not null
        and vorschau_payload is not null
        and payload_hash is not null
        and risiko is not null));

/**
 * Und der Posteingang listet genau die, die sich vorlegen lassen. Ohne diesen
 * Zusatz stuende eine Behinderungsanzeige ohne Titel in der Liste — mit einer
 * leeren Zelle da, wo die Zusammenfassung steht.
 */
drop index freigabe_posteingang_idx;
create index freigabe_posteingang_idx
  on freigabe (mandant_id, frist nulls last, risiko desc)
  where status = 'offen' and vorgang_typ is not null;

-- ---------------------------------------------------------------------------
-- 5. Zwei Registerbefunde der Isolationssuite
-- ---------------------------------------------------------------------------

/**
 * **`freigabe_kette` steht im Register `NUR_UEBER_DEFINER` — und „nur ueber
 * den Definer" heisst: KEINE Policy.**
 *
 * `tests/isolation/schema-meta.test.ts` zaehlt die Policies solcher Tabellen
 * und verlangt null. Die oben angelegte `d_freigabe_kette` war der Versuch,
 * ein Problem zu loesen, das es nicht gibt: `app.freigabe_kette_ziehen`
 * gehoert `cse_definer`, und der Eigentuemer einer Tabelle unterliegt FORCE
 * RLS nur, wenn er die Tabelle auch besitzt — hier besitzt sie der Migrator,
 * und die Funktion laeuft mit dessen Rechten nicht. Sie funktioniert, weil
 * `security definer` sie zur Eigentuemerrolle der FUNKTION macht und diese
 * die noetigen Grants aus 0012 mitbringt.
 *
 * Der Registerbefund ist damit nicht Formalismus: er hat eine Policy gefunden,
 * die nichts tut und die Aussage des Registers falsch macht.
 */
drop policy d_freigabe_kette on freigabe_kette;

/**
 * **Ein Recht ohne Policy ist ein totes Recht** (`spaltenrechte.test.ts`).
 *
 * `grant select on freigabe_snapshot to cse_job` oben gab dem Waechter das
 * Recht und keine Policy dazu — unter FORCE RLS laese er damit null Zeilen
 * und meldete jede Nacht „keine Auffaelligkeiten", weil er nichts sieht. Das
 * ist die Sorte Stille, die ein Waechter gerade nicht haben darf.
 *
 * `using (true)` ist hier die richtige Verengung und nicht die fehlende:
 * `cse_job` hat keine Sitzung, also keinen aktiven Mandanten — ein
 * Mandantsschnitt waere immer falsch. Die Verengung liegt darin, dass die
 * Rolle nur von Jobs angenommen wird und §4.9 die Auswertung auf die
 * aggregierte, pseudonymisierte Form beschraenkt.
 */
create policy j_freigabe_snapshot on freigabe_snapshot for select to cse_job
  using (true);

comment on policy j_freigabe_snapshot on freigabe_snapshot is
  'APR-08, §4.9. Der naechtliche Waechter (freigabe-kette-verify, '
  'freigabe-rubberstamp) laeuft ohne Sitzung und damit ohne aktiven Mandanten; '
  'ein Mandantsschnitt waere hier immer falsch. Er gibt nur die aggregierte, '
  'pseudonymisierte Zahl heraus, die O-06 bis zur Antwort erlaubt.';

-- ---------------------------------------------------------------------------
-- 6. Der Vorgaenger kommt aus der KETTE, nicht aus dem Kettenkopf
-- ---------------------------------------------------------------------------

/**
 * **Ein stiller Schreibfehler, gefunden vom Golden-Vector-Test.**
 *
 * 0136 schrieb nach dem Einfuegen `update freigabe_kette set letzter_hash`.
 * Diese Anweisung traf null Zeilen — `freigabe_kette` traegt `force row level
 * security` und hat (richtigerweise, §5) keine Policy fuer `cse_definer`.
 * Kein Fehler, keine Meldung: jedes zweite Glied bekam den Genesis als
 * Vorgaenger, und die Kette war eine Reihe unverbundener Glieder, die brav
 * „intakt" gemeldet haette, solange niemand sie laeuft.
 *
 * Der Vorgaenger steht ohnehin an der besseren Stelle: im Glied davor.
 * `app.freigabe_kette_ziehen` haelt den Kopf waehrend der ganzen Transaktion
 * unter `SELECT … FOR UPDATE` — zwei gleichzeitige Freigebende kommen also
 * nicht beide an dieselbe Nummer, und genau deshalb ist der Blick auf
 * `kette_nr = v_nr - 1` hier rennfrei.
 *
 * `freigabe_kette.letzter_hash` bleibt damit das, was es heute schon ist:
 * ungepflegt. Es ist KEIN Beweisstueck — die Kette selbst ist es —, und eine
 * zweite Fassung derselben Wahrheit waere die Stelle, an der beide
 * auseinanderlaufen.
 */
create or replace function app.freigabe_entscheiden(
  p_freigabe        uuid,
  p_art             freigabe_art,
  p_nutzlast        jsonb,
  p_nutzlast_bytes  bytea,
  p_diff            jsonb,
  p_diff_bytes      bytea,
  p_felder          jsonb,
  p_felder_bytes    bytea,
  p_ansicht         jsonb,
  p_ansicht_bytes   bytea,
  p_policy          jsonb,
  p_policy_bytes    bytea,
  p_artefakt_hash   text,
  p_begruendung     text,
  p_ip              inet,
  p_user_agent      text,
  p_code_version    text
) returns table (snapshot_id uuid, kette_nr bigint, hash text)
language plpgsql security definer set search_path = pg_catalog, public, app as $fn$
declare
  f            record;
  v_mandant    uuid := app.aktiver_mandant();
  v_benutzer   uuid := app.aktueller_benutzer();
  v_nr         bigint;
  v_vorher     text;
  v_geoeffnet  timestamptz;
  v_dauer      integer;
  v_jetzt      timestamptz := now();
  v_rolle      text;
  v_hash       text;
  v_id         uuid;
  v_nutzlast_hash text;
  v_recht      text;
begin
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht entscheidet nicht (Invariante 10).'
      using errcode = '42501';
  end if;

  select * into f from public.freigabe where id = p_freigabe;
  if not found then
    raise exception 'Freigabe % existiert nicht oder ist nicht sichtbar.', p_freigabe
      using errcode = 'no_data_found';
  end if;
  if f.mandant_id is distinct from v_mandant then
    raise exception 'Freigabe % gehoert nicht zum aktiven Mandanten (Invariante 3).',
      p_freigabe using errcode = '42501';
  end if;

  v_recht := coalesce(f.erforderliches_recht, 'freigabe.entscheiden');
  if not app.hat_recht(v_recht, f.mandant_id) then
    raise exception '% fehlt', v_recht using errcode = '42501';
  end if;

  if v_benutzer is null then
    raise exception 'Eine Freigabe braucht einen Menschen (Invariante 7).'
      using errcode = '42501';
  end if;

  if f.status <> 'offen' then
    raise exception 'Freigabe % ist bereits entschieden (%).', p_freigabe, f.status
      using errcode = 'restrict_violation';
  end if;

  select min(a.geoeffnet_am_server) into v_geoeffnet
    from public.freigabe_ansicht a
   where a.freigabe_id = p_freigabe and a.benutzer_id = v_benutzer;
  if v_geoeffnet is null then
    raise exception
      'Freigabe %: diese Person hat sie nie geoeffnet (APR-08).', p_freigabe
      using errcode = 'restrict_violation',
            hint = 'GET /api/freigaben/[id] schreibt die Ansicht.';
  end if;
  v_dauer := floor(extract(epoch from (v_jetzt - v_geoeffnet)))::integer;

  v_nutzlast_hash := encode(digest(p_nutzlast_bytes, 'sha256'), 'hex');
  if f.payload_hash is not null and v_nutzlast_hash <> f.payload_hash then
    raise exception
      'Freigabe %: die eingereichte Nutzlast ist nicht die vorgelegte.', p_freigabe
      using errcode = 'restrict_violation',
            hint = 'Wer nach der Vorlage aendert, hat fuer das Geaenderte keine Freigabe.';
  end if;

  if p_art in ('abgelehnt', 'widerruf')
     and (p_begruendung is null or length(btrim(p_begruendung)) = 0) then
    raise exception 'Eine Ablehnung ohne Begruendung ist keine Auskunft.'
      using errcode = 'check_violation';
  end if;

  select coalesce(gr.schluessel, r.schluessel) into v_rolle
    from public.benutzer b
    left join public.rolle gr on gr.id = b.globale_rolle_id
    left join public.benutzer_mandant bm
           on bm.benutzer_id = b.id and bm.mandant_id = f.mandant_id
          and bm.entzogen_am is null
    left join public.rolle r on r.id = bm.rolle_id
   where b.id = v_benutzer;

  /* Die Nummer sperrt den Kopf fuer die Dauer der Transaktion (K-13, FIN-03). */
  select k.kette_nr into v_nr from app.freigabe_kette_ziehen(f.mandant_id) k;

  /* Und der Vorgaenger steht im Glied davor — nicht im Kopf (siehe oben). */
  select s.hash into v_vorher
    from public.freigabe_snapshot s
   where s.mandant_id = f.mandant_id and s.kette_nr = v_nr - 1;

  v_hash := encode(digest(concat_ws(
    chr(31),
    v_nutzlast_hash,
    coalesce(p_artefakt_hash, ''),
    encode(digest(p_diff_bytes,    'sha256'), 'hex'),
    encode(digest(p_felder_bytes,  'sha256'), 'hex'),
    encode(digest(p_ansicht_bytes, 'sha256'), 'hex'),
    encode(digest(p_policy_bytes,  'sha256'), 'hex'),
    p_art::text,
    v_benutzer::text,
    to_char(v_jetzt at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    v_nr::text,
    coalesce(v_vorher, '')
  )::bytea, 'sha256'), 'hex');

  insert into public.freigabe_snapshot
    (mandant_id, freigabe_id, kette_nr, nutzlast, nutzlast_hash, vorheriger_hash, hash,
     entscheidung, entschieden_von, entschieden_am, art, rolle, artefakt_hash,
     diff, diff_hash, felder, felder_hash, ansicht_modell, ansicht_modell_hash,
     policy_ergebnis, policy_ergebnis_hash, pruefdauer_sek, begruendung,
     code_version, ip_adresse, user_agent)
  values
    (f.mandant_id, p_freigabe, v_nr, p_nutzlast, v_nutzlast_hash,
     coalesce(v_vorher, repeat('0', 64)), v_hash,
     case when p_art = 'genehmigt' then 'genehmigt'::freigabe_status
          else 'abgelehnt'::freigabe_status end,
     v_benutzer, v_jetzt, p_art, v_rolle, p_artefakt_hash,
     p_diff,    encode(digest(p_diff_bytes,    'sha256'), 'hex'),
     p_felder,  encode(digest(p_felder_bytes,  'sha256'), 'hex'),
     p_ansicht, encode(digest(p_ansicht_bytes, 'sha256'), 'hex'),
     p_policy,  encode(digest(p_policy_bytes,  'sha256'), 'hex'),
     v_dauer, p_begruendung, p_code_version, p_ip, p_user_agent)
  returning id into v_id;

  update public.freigabe
     set status = case when p_art = 'genehmigt' then 'genehmigt'::freigabe_status
                       else 'abgelehnt'::freigabe_status end,
         freigegeben_von = v_benutzer,
         freigegeben_am  = v_jetzt,
         begruendung     = coalesce(p_begruendung, begruendung),
         geaendert_am    = v_jetzt
   where id = p_freigabe;

  return query select v_id, v_nr, v_hash;
end $fn$;
