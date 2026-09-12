-- ===========================================================================
-- 0051 — Zeit → Auftrag, Monatsanteil und die § 17-MiLoG-Aufzeichnung
--        (04-PLANUNG-ZEIT.md §7.3, §7.4, §14.2; TIM-12, TIM-13, LEG-02,
--         FIN-07, FIN-18)
--
-- Vertrag: `docs/architecture/02-datenmodell/04-PLANUNG-ZEIT.md` §7.3, dort
-- steht die Sicht `zeiteintrag_monatsanteil` woertlich. Wo dieser Text und
-- eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- Drei Dinge stehen hier bewusst NICHT so, wie es naheliegend waere:
--
--  1. **Der Monatssplit teilt den `zeiteintrag` NICHT.** Eine Schicht
--     31.10. 22:00 → 01.11. 06:00 gehoert zwei Monaten an. Die naheliegende
--     Umsetzung — zwei Zeilen schreiben — faelscht genau die Aufzeichnung, die
--     § 17 Abs. 1 MiLoG verlangt: Beginn, Ende und Dauer, EINMAL und so, wie
--     sie waren. Die Aufteilung ist deshalb eine SICHT und ein abgeleitetes
--     Verhaeltnis, kein zweiter Datensatz.
--
--  2. **Die Monatsgrenze ist eine Berliner Mitternacht als Zeitpunkt**, nie
--     UTC-Mitternacht (K-11). Der Teilungspunkt der Maerz/April-Schicht ist
--     22:00Z am 31.03. Wer bei 00:00Z teilt, verschiebt im Winter 60 und im
--     Sommer 120 Minuten in den falschen Monat — in ein Stundenkonto, in einen
--     Lohn und auf eine Rechnung, und keine Zeile sieht falsch aus.
--
--  3. **Der Nettoanteil wird hier NICHT gerechnet.** Die Sicht liefert
--     Bruttominuten je Anteil; die Pause wird in
--     `src/server/services/zeit/monatsanteil.ts` nach groesstem Rest verteilt
--     (§7.4). Jeden Anteil einzeln zu runden erzeugt oder vernichtet an jedem
--     Monatsende eine Minute, und die taucht spaeter als Centdifferenz auf
--     einer Rechnung wieder auf. Eine Rundungsregel gehoert in eine getestete
--     Funktion, nicht in eine DDL-Anweisung, die kein Test erreicht.
--
-- NICHT in dieser Migration: `stundenkonto` und sein Sperrausloeser
-- `z_monat_sperren` (PR 37) — die Spalte `zeiteintrag.gesperrt_am` steht seit
-- 0034 bereit und bekommt ihren einzigen Schreiber dort. Die Abrechnung aus
-- Zeit (PR 48).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Zeit → Auftrag (TIM-12, FIN-07)
-- ---------------------------------------------------------------------------

/**
 * `zeiteintrag_auftrag` — die aufgeloeste Kette Zeit → Leistungszeile →
 * Auftrag.
 *
 * TIM-12 sagt: „Zeit haengt am Auftrag, keine manuelle Uebertragung in die
 * Abrechnung." Die Aufloesung ist deshalb ein JOIN und kein Uebertrag: der
 * Ausloeser `z_erben` (0034) hat `auftrag_leistung_id` beim Einfuegen von der
 * Schicht geerbt, `z_leistung_fk` (0050) haelt sie in derselben Gesellschaft,
 * und `auftrag_leistung.auftrag_id` ist NOT NULL. Damit loest jeder Eintrag
 * mit Leistungsbezug auf GENAU EINEN Auftrag auf — das ist eine Eigenschaft
 * der Schluessel und keine Zusage dieser Sicht.
 *
 * `security_invoker = true`, und das ist nicht Kosmetik (§1.11, §16 Nr. 8):
 * ohne sie liefe die Sicht mit den Rechten ihres EIGENTUEMERS und dessen
 * RLS-Befreiung — ein vollstaendiger mandantenuebergreifender Durchgriff auf
 * die Stunden aller vier Gesellschaften, durch genau den Mechanismus, den
 * diese Domaene sonst muehsam verschliesst.
 */
create view zeiteintrag_auftrag with (security_invoker = true) as
select z.id                  as zeiteintrag_id,
       z.mandant_id,
       z.kette_id,
       z.anstellung_id,
       z.person_id,
       z.einsatz_id,
       z.auftrag_leistung_id,
       al.auftrag_id,
       a.auftragsnummer,
       al.position_nr,
       al.bezeichnung        as leistung,
       al.einheit,
       z.objekt_id,
       z.beginn_zeitpunkt,
       z.ende_zeitpunkt,
       z.dauer_brutto_minuten,
       z.dauer_netto_minuten,
       z.pause_minuten,
       z.freigegeben_am,
       z.gesperrt_am,
       z.abgerechnet_am
  from zeiteintrag z
  join auftrag_leistung al
    on al.mandant_id = z.mandant_id and al.id = z.auftrag_leistung_id
  join auftrag a
    on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
 where z.storniert_am is null
   and z.ersetzt_am   is null;

comment on view zeiteintrag_auftrag is
  'TIM-12/FIN-07: jeder Zeiteintrag mit Leistungsbezug loest auf genau einen '
  'Auftrag auf. security_invoker (§1.11).';

/**
 * `zeiteintrag_ohne_auftrag` — der BERICHT, nicht der Papierkorb.
 *
 * Die Abnahme von PR 36 sagt: „ein nicht aufloesbarer Eintrag wird gemeldet,
 * nie verworfen." Der naheliegende Entwurf waere ein `inner join` in der
 * Abrechnungsabfrage — der laesst solche Eintraege still verschwinden, und
 * eine Stunde, die niemand abrechnet, faellt erst auf, wenn ein Kunde sie
 * nicht bezahlt hat. Deshalb gibt es die Gegen-Sicht, sie benennt die URSACHE,
 * und die Oberflaeche liest sie.
 *
 * Es gibt legitime Zeiten ohne Auftragsbezug — interne Arbeit, Schulung,
 * Bereitschaft, Fahrzeit. Wie sie kostenmaessig behandelt werden, ist offen;
 * bis dahin sind sie hier eine gemeldete Zeile und keine erfundene Zuordnung.
 * // TODO(client, O-169): Gibt es Zeiten ohne Auftragsbezug — interne Arbeit,
 * Schulung, Bereitschaft, Fahrzeit — und wie werden sie kostenmaessig
 * behandelt?
 */
create view zeiteintrag_ohne_auftrag with (security_invoker = true) as
select z.id                  as zeiteintrag_id,
       z.mandant_id,
       z.anstellung_id,
       z.person_id,
       z.einsatz_id,
       z.objekt_id,
       z.beginn_zeitpunkt,
       z.ende_zeitpunkt,
       z.dauer_netto_minuten,
       z.freigegeben_am,
       case
         when z.einsatz_id is null            then 'ohne_einsatz'
         when e.auftrag_leistung_id is null   then 'einsatz_ohne_leistung'
         else                                      'leistung_entfernt'
       end                   as ursache
  from zeiteintrag z
  left join einsatz e
    on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
 where z.auftrag_leistung_id is null
   and z.storniert_am is null
   and z.ersetzt_am   is null;

comment on view zeiteintrag_ohne_auftrag is
  'FIN-18: Zeiteintraege, die auf keinen Auftrag aufloesen — mit Ursache. '
  'Gemeldet, nie verworfen.';

grant select on zeiteintrag_auftrag    to cse_app;
grant select on zeiteintrag_ohne_auftrag to cse_app;

-- ---------------------------------------------------------------------------
-- 2. Der Monatsanteil (§7.3) — eine abgeleitete Zuordnung, kein zweiter Satz
-- ---------------------------------------------------------------------------

/**
 * Woertlich §7.3. Die Monatsgrenzen sind Berliner Mitternachte, in Zeitpunkte
 * umgerechnet; `brutto_minuten` je Anteil ist wieder die Differenz zweier
 * Zeitpunkte, weshalb eine Monatsgrenze, die mit einer Zeitumstellung
 * zusammenfaellt, von derselben Arithmetik erledigt wird wie alles andere.
 *
 * Die Sicht traegt `freigegeben_am` und `gesperrt_am` mit und FILTERT NICHT
 * darauf — jeder Verbraucher nennt sein eigenes Praedikat (§7.3): das
 * Stundenkonto bucht nur Freigegebenes, das Mitarbeiterportal zeigt auch
 * Ungeprueftes mit der Pille „In Pruefung", der Lohnexport verlangt beides.
 * Ein Filter hier machte aus drei verschiedenen Fragen eine Antwort.
 */
create view zeiteintrag_monatsanteil with (security_invoker = true) as
select z.id as zeiteintrag_id, z.mandant_id, z.anstellung_id, z.person_id,
       z.auftrag_leistung_id, z.freigegeben_am, z.gesperrt_am,
       (m.monat_lokal)::date                                  as monat,
       greatest(z.beginn_zeitpunkt, m.monat_beginn)           as anteil_beginn,
       least(z.ende_zeitpunkt,      m.monat_ende)             as anteil_ende,
       (extract(epoch from (least(z.ende_zeitpunkt, m.monat_ende)
                          - greatest(z.beginn_zeitpunkt, m.monat_beginn))) / 60)::integer
                                                              as brutto_minuten
from zeiteintrag z
cross join lateral (
  select g.monat_lokal,
         (g.monat_lokal)                      at time zone 'Europe/Berlin' as monat_beginn,
         (g.monat_lokal + interval '1 month') at time zone 'Europe/Berlin' as monat_ende
  from generate_series(
         date_trunc('month',  z.beginn_zeitpunkt                          at time zone 'Europe/Berlin'),
         date_trunc('month', (z.ende_zeitpunkt - interval '1 microsecond') at time zone 'Europe/Berlin'),
         interval '1 month') as g(monat_lokal)
) m
where z.ende_zeitpunkt is not null
  and z.storniert_am is null
  and z.ersetzt_am   is null;

comment on view zeiteintrag_monatsanteil is
  'Der Monatsanteil als ABGELEITETE Zuordnung (§7.3). Der Zeiteintrag bleibt '
  'ungeteilt — die § 17-Aufzeichnung zeigt Beginn und Ende einmal.';

grant select on zeiteintrag_monatsanteil to cse_app;

-- ---------------------------------------------------------------------------
-- 3. Die § 17-MiLoG-Aufzeichnung (TIM-13, LEG-02)
-- ---------------------------------------------------------------------------

/**
 * § 17 Abs. 1 MiLoG verlangt Beginn, Ende und Dauer der taeglichen
 * Arbeitszeit, aufzuzeichnen und **zwei Jahre** aufzubewahren.
 *
 * Diese Sicht ist die Aufzeichnung, und sie zeigt BEIDES nebeneinander: die
 * wahren Zeitpunkte des Eintrags (`beginn_zeitpunkt`, `ende_zeitpunkt` — die,
 * die der Nachweis zeigen muss) und den Anteil, der auf den jeweiligen Monat
 * entfaellt. Nur die Anteilsspalten sind monatsabhaengig; die
 * Aufzeichnungszeilen selbst sind es nicht. Wer stattdessen die Anteilsgrenzen
 * als Beginn und Ende ausgaebe, haette eine Aufzeichnung, die behauptet, die
 * Schicht habe um Mitternacht geendet — genau die Faelschung, die §7.3
 * ausschliesst.
 *
 * `kalendertag` ist der BERLINER Kalendertag des Schichtbeginns (K-11), nicht
 * der UTC-Tag: eine Nachtschicht 22:00–06:00 wird sonst zwei Tagen
 * zugeschrieben, von denen einer nie stattgefunden hat.
 *
 * // TODO(client, O-162): Ab wann laeuft die zweijaehrige Aufbewahrung nach
 * § 17 Abs. 1 MiLoG — ab dem Tag der Arbeitsleistung, ab Erstellung der
 * Aufzeichnung oder ab Monats- bzw. Jahresende?
 */
create view milog_aufzeichnung with (security_invoker = true) as
select ma.zeiteintrag_id,
       ma.mandant_id,
       ma.anstellung_id,
       ma.person_id,
       ma.monat,
       (ma.anteil_beginn at time zone 'Europe/Berlin')::date  as kalendertag,
       z.beginn_zeitpunkt,
       z.ende_zeitpunkt,
       z.pause_minuten,
       z.dauer_brutto_minuten,
       z.dauer_netto_minuten,
       ma.anteil_beginn,
       ma.anteil_ende,
       ma.brutto_minuten                                      as anteil_brutto_minuten,
       ma.freigegeben_am,
       ma.gesperrt_am,
       z.nacherfasst,
       z.erfassungsart_beginn,
       z.quelle_beginn
  from zeiteintrag_monatsanteil ma
  join zeiteintrag z
    on z.mandant_id = ma.mandant_id and z.id = ma.zeiteintrag_id;

comment on view milog_aufzeichnung is
  '§ 17 Abs. 1 MiLoG: Beginn, Ende und Dauer je Beschaeftigung und Monat '
  '(TIM-13, LEG-02). Beginn und Ende sind die WAHREN Zeitpunkte des Eintrags; '
  'monatsabhaengig sind nur die Anteilsspalten.';

grant select on milog_aufzeichnung to cse_app;

/**
 * `zeitnachweis` — das Artefakt eines GESPERRTEN Monats.
 *
 * §7.3: „Der gesperrte Monat rendert einmal und danach nie wieder." Der Grund
 * ist unangenehm konkret: eine Korrektur im Mai praegt eine NEUE Fassung mit
 * Maerz-Zeitpunkten (§15.6). Wer den Maerz danach aus der lebenden Sicht neu
 * rendert, erzeugt ein Dokument, das von dem abweicht, das die Arbeiterin in
 * der Hand hatte — fuer genau den Monat, den EMP-04 stabil halten soll. Und
 * es faellt niemandem auf: beide Dokumente sehen richtig aus.
 *
 * Gesperrt heisst deshalb: die Zeilen werden EINMAL gepraegt, mit ihrem
 * Digest, und danach byte-gleich wieder ausgegeben. Die Korrektur erscheint
 * dort, wo sie hingehoert — in der Korrekturspur (§5.7) und als
 * Ausgleichsbuchung im ersten offenen Monat (§12.2), den das Dokument des
 * Folgemonats zeigt.
 *
 * **Verhaeltnis zu PR 37.** `stundenkonto.abrechnung_dokument_id`
 * (01-KERN §6.24) zeigt spaeter auf das gerenderte PDF. Diese Zeile ist nicht
 * dasselbe und auch kein zweites davon: sie ist die kanonische DATENFASSUNG
 * mit ihrem Digest, aus der das PDF entsteht. Zwei Renderer aus einer Quelle
 * koennen nicht auseinanderlaufen; zwei Quellen fuer ein Dokument tun es
 * zwangslaeufig. Aufgeschrieben in DECISIONS.md (D-152), weil die Tabelle in
 * keinem Dokument der Phase 0 einen Eigentuemer hat.
 */
create table zeitnachweis (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  anstellung_id uuid not null,
  person_id     uuid not null,

  -- Der erste Tag des BERLINER Monats (K-11), nicht des UTC-Monats.
  monat         date not null,

  /**
   * Die Aufzeichnung, exakt so ausgegeben. Ein `jsonb`, weil das Artefakt
   * genau das ist, was es ist: eine eingefrorene Liste, die niemand mehr
   * abfragt, sondern nur noch vorlegt.
   */
  zeilen        jsonb not null,
  zeilen_anzahl integer not null,
  summe_brutto_minuten integer not null,
  summe_netto_minuten  integer not null,

  /**
   * SHA-256 der kanonischen Nutzlast, hex. Gerechnet von
   * `nutzlastHash` in `services/finanz/hash-chain.ts` — dieselbe Funktion,
   * die die Rechnungskette prueft, und nicht eine zweite Digest-Rechnung
   * daneben.
   */
  hash          text not null,

  /** Die Sperre, fuer die dieses Artefakt gepraegt wurde. */
  gesperrt_am   timestamptz not null,

  -- §1.13 / §13, Klasse `zeiterfassung`; nach Abrechnung zusaetzlich GoBD.
  -- // TODO(client, O-162): Ab wann laeuft die zweijaehrige Frist nach
  -- § 17 Abs. 1 MiLoG?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  /**
   * Genau einmal geschrieben: keine `geaendert_*`-Spalten, keine weiche
   * Loeschung. Es gibt hier nichts, was eine Zeile beenden koennte.
   */
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_agent_id uuid,

  primary key (id),
  constraint zeitnachweis_mandant_uk unique (mandant_id, id),
  -- EIN Artefakt je Beschaeftigung und Monat. Ein zweites waere eine zweite
  -- Wahrheit ueber denselben Lohnmonat.
  constraint zeitnachweis_monat_uk unique (mandant_id, anstellung_id, monat),

  constraint zn_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint zn_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),

  constraint zn_monatserster check (monat = date_trunc('month', monat)::date),
  constraint zn_hash_form check (hash ~ '^[0-9a-f]{64}$'),
  constraint zn_summen_nicht_negativ check (
    summe_brutto_minuten >= 0 and summe_netto_minuten >= 0
    and summe_netto_minuten <= summe_brutto_minuten),
  constraint zn_zeilen_gezaehlt check (zeilen_anzahl = jsonb_array_length(zeilen)),
  constraint zn_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index zn_person_idx on zeitnachweis (person_id, monat);
create index zn_monat_idx on zeitnachweis (mandant_id, monat);
create index zn_aufbewahrung_idx on zeitnachweis (aufbewahrung_bis)
  where loeschsperre = false and aufbewahrung_bis is not null;

comment on table zeitnachweis is
  'Die einmal gepraegte § 17-MiLoG-Aufzeichnung eines gesperrten Monats — mit '
  'Digest, byte-gleich wieder ausgegeben (§7.3, EMP-04). Anfuegend.';

/**
 * Anfuegend, und zwar im Ausloeser und nicht nur in der Policy.
 *
 * Eine Policy schuetzt `cse_app`. Dieser Ausloeser schuetzt auch den
 * Eigentuemer, den Migrator und jeden Wartungszugang — und genau darauf beruht
 * der Beweiswert des Artefakts: es haelt nur, wenn es NIEMAND aendern kann.
 */
create function kern.zeitnachweis_write_once() returns trigger
language plpgsql as $$
begin
  raise exception 'Ein Zeitnachweis wird nicht geaendert'
    using errcode = 'check_violation',
          detail  = 'Das Artefakt eines gesperrten Monats ist der Beleg, den die '
                    || 'Arbeitnehmerin bekommen hat (§7.3, EMP-04).',
          hint    = 'Eine Korrektur erscheint in der Korrekturspur und als '
                    || 'Ausgleichsbuchung im ersten offenen Monat (§12.2).';
end $$;

create trigger trg_zeitnachweis_write_once
  before update on zeitnachweis
  for each row execute function kern.zeitnachweis_write_once();

alter table zeitnachweis enable row level security;
alter table zeitnachweis force  row level security;

create policy t_mandant on zeitnachweis for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on zeitnachweis for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

-- Der Mensch sieht seinen eigenen Nachweis — nur lesend, wie auf `zeiteintrag`.
create policy t_person on zeitnachweis for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and person_id = app.aktuelle_person());

create policy p_ma_decke on zeitnachweis as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
-- Stunden sind ein Beschaeftigungsdatensatz, kein Kundendokument (EMP-13).
create policy p_kunde_decke on zeitnachweis as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

-- `job:aufbewahrung` traegt Fristen ein; wer wie lange gearbeitet hat,
-- entscheidet kein Nachtlauf.
create policy t_job on zeitnachweis for select to cse_job using (true);
create policy t_job_frist on zeitnachweis for update to cse_job using (true) with check (true);

-- KEIN `update` fuer `cse_app`: das Artefakt ist anfuegend. Der Grant sagt
-- dasselbe wie der Ausloeser, eine Ebene frueher.
grant select, insert on zeitnachweis to cse_app;
grant select on zeitnachweis to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on zeitnachweis to cse_job;

-- ---------------------------------------------------------------------------
-- 4. Zwei Fremdschluessel, die 0040 aufgeschoben hat (§14.4)
-- ---------------------------------------------------------------------------

/**
 * 0040 §16 hat sie woertlich hinterlegt und auf `zeiteintrag` (PR 34) und
 * `qualifikation` (PR 31) gewartet. Beide Elternteile stehen inzwischen —
 * 0030 und 0034 laufen vor 0040 —, der Schuldschein blieb aber offen. Er wird
 * hier eingeloest, weil ein Konflikt, der auf einen Zeiteintrag einer ANDEREN
 * Gesellschaft zeigt, aus einem ArbZG-Befund einen Befund ueber die falsche
 * Person macht, und RLS daran nichts auszusetzen faende: beide Zeilen sind
 * fuer sich stimmig.
 */
alter table planungs_konflikt add constraint pk_zeiteintrag_fk
  foreign key (mandant_id, zeiteintrag_id) references zeiteintrag (mandant_id, id);
alter table arbeitszeit_verstoss add constraint av_zeiteintrag_fk
  foreign key (mandant_id, zeiteintrag_id) references zeiteintrag (mandant_id, id);

/**
 * Und der dritte, EINSPALTIG — hier die richtige Form und keine
 * Nachlaessigkeit: `qualifikation` ist der eine Katalog mit nullbarer
 * `mandant_id` (D-128); gruppenweite Zeilen haben keinen Mandanten, den ein
 * zusammengesetzter Schluessel nennen koennte. 0040 §16 benennt die Ausnahme.
 */
alter table planungs_konflikt add constraint pk_qualifikation_fk
  foreign key (qualifikation_id) references qualifikation (id);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0051)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeitnachweis (append): TIM-13, LEG-02, EMP-04. Das einmal gepraegte Artefakt eines gesperrten Monats IST der § 17-MiLoG-Nachweis, den die Arbeitnehmerin bekommen hat. Ein Loeschweg machte aus „byte-gleich wieder ausgegeben" eine Zusage, die der erste Wartungszugang aufhebt.
create trigger trg_zeitnachweis_kein_hard_delete
  before delete on zeitnachweis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeitnachweis_kein_truncate
  before truncate on zeitnachweis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeitnachweis from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
