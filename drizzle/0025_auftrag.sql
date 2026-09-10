-- ===========================================================================
-- 0025 — Auftrag (OPS-05, OPS-09, OPS-10, PRO-05)
--
-- Der Auftrag ist das, was eine Gesellschaft tatsaechlich ausfuehrt: Art,
-- Laufzeit, Wert, verantwortliche Leitung. Ein PROJEKT ist ein Auftrag mit
-- einer Erweiterungszeile in der Baudomaene, keine zweite Kopftabelle.
--
-- Zwei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **Die Auftragsnummer ist nicht lueckenlos.** Die Lueckenlosigkeit von
--     FIN-03 ist eine gesetzliche Anforderung an die RECHNUNG. Sie hier zu
--     behaupten waere ein Versprechen, das niemand einhaelt — ein verworfener
--     Auftrag hinterlaesst eine Luecke, und das ist in Ordnung.
--  2. **Die Referenzfreigabe (PRO-05) haengt nicht am Abschluss.** Ein seit
--     drei Jahren laufender Rahmenvertrag ist die wertvollste Referenz einer
--     Reinigungsfirma. Sie an `status = 'abgeschlossen'` zu binden, schloesse
--     genau die aus.
-- ===========================================================================

-- PLACEHOLDER  // TODO(client, O-73): Auftragsarten (SPEC OPS-05 "type") bestaetigen.
create type auftrag_art as enum ('einzelauftrag','rahmenvertrag','dauerauftrag','projekt');

-- PLACEHOLDER  // TODO(client, O-73): Auftrags-Lebenszyklus bestaetigen.
create type auftrag_status as enum ('angelegt','aktiv','pausiert','abgeschlossen','storniert');

create table auftrag (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  auftragsnummer text not null,
  kunde_id      uuid not null,
  objekt_id     uuid,
  angebot_id    uuid,
  lead_id       uuid,
  art           auftrag_art not null,
  status        auftrag_status not null default 'angelegt',
  bezeichnung   text not null,
  beschreibung  text,
  verantwortlich_benutzer_id uuid not null references benutzer(id),
  start_datum   date not null,
  laufzeit_bis  date,
  kuendigungsfrist_tage smallint,
  verlaengerung_automatisch boolean not null default false,
  auftragswert_netto_cent bigint,
  personalbedarf_anzahl smallint,
  wochenstunden_soll numeric(12,3),
  ausstattung_hinweis text,
  abnahme_am    date,
  -- // TODO(client, O-68): Welche Gewaehrleistungsfrist wird vereinbart —
  -- VOB/B §13 (in der Regel 4 Jahre) oder BGB (5 Jahre)? Je Auftrag abweichend?
  gewaehrleistung_bis date,
  -- // TODO(client, O-20): Wird ein Sicherheitseinbehalt gefuehrt, und wird er
  -- durch Buergschaft abgeloest?
  sicherheitseinbehalt_bp integer,
  sicherheitseinbehalt_cent bigint,
  abgeschlossen_am timestamptz,
  -- PRO-05: das EINZIGE Tor zur oeffentlichen Referenz.
  freigegeben_vom_kunden boolean not null default false,
  freigabe_am   timestamptz,
  freigabe_durch_ansprechpartner_id uuid,
  freigabe_dokument_id uuid,
  freigabe_text text,
  freigabe_widerrufen_am timestamptz,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint auftrag_mandant_uk unique (mandant_id, id),
  constraint auftrag_nummer_uk unique (mandant_id, auftragsnummer),
  constraint auftrag_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint auftrag_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint auftrag_angebot_fk foreign key (mandant_id, angebot_id)
    references angebot (mandant_id, id),
  constraint auftrag_lead_fk foreign key (mandant_id, lead_id) references lead (mandant_id, id),
  constraint auftrag_freigabe_ansprechpartner_fk
    foreign key (mandant_id, kunde_id, freigabe_durch_ansprechpartner_id)
    references ansprechpartner (mandant_id, kunde_id, id),
  /**
   * PRO-05, gehaertet: eine Referenz ohne hinterlegte Freigabe kann als DATEN
   * nicht existieren — also auch nicht versehentlich veroeffentlicht werden.
   */
  constraint auftrag_referenzfreigabe_vollstaendig check (
    freigegeben_vom_kunden = false
    or (freigabe_am is not null
        and freigabe_durch_ansprechpartner_id is not null
        and freigabe_dokument_id is not null)),
  constraint auftrag_laufzeit_stimmig check (laufzeit_bis is null or laufzeit_bis >= start_datum),
  -- Eine Gewaehrleistungsfrist ohne Abnahme haette keinen Beginn.
  constraint auftrag_gewaehrleistung_nach_abnahme check (
    gewaehrleistung_bis is null or abnahme_am is not null),
  constraint auftrag_abschluss_datiert check (
    status <> 'abgeschlossen' or abgeschlossen_am is not null),
  constraint auftrag_einbehalt_eindeutig check (
    num_nonnulls(sicherheitseinbehalt_bp, sicherheitseinbehalt_cent) <= 1),
  constraint auftrag_einbehalt_bereich check (
    sicherheitseinbehalt_bp is null or sicherheitseinbehalt_bp between 0 and 10000),
  /**
   * Mengen, die es nicht geben kann.
   *
   * `min="0"` im Formular ist eine Bitte an den Browser, keine Grenze: ein
   * von Hand abgeschickter POST traegt -3 Personen und -40 Wochenstunden
   * genauso hinein. Beides geht spaeter in Planung und Abrechnung, und dort
   * sieht eine negative Menge aus wie eine Gutschrift.
   *
   * Die Obergrenze ist bewusst grosszuegig und trotzdem endlich: sie faengt
   * den Tippfehler (4000 statt 40) und nicht die Wirklichkeit.
   */
  constraint auftrag_personalbedarf_bereich check (
    personalbedarf_anzahl is null or personalbedarf_anzahl between 0 and 5000),
  constraint auftrag_wochenstunden_bereich check (
    wochenstunden_soll is null or wochenstunden_soll between 0 and 10000)
);

create index auftrag_liste_idx on auftrag (mandant_id, status, start_datum desc);
create index auftrag_kunde_idx on auftrag (mandant_id, kunde_id, start_datum desc);
create index auftrag_objekt_idx on auftrag (mandant_id, objekt_id) where objekt_id is not null;
create index auftrag_leitung_idx on auftrag (mandant_id, verantwortlich_benutzer_id, status);
create index auftrag_ablauf_idx on auftrag (mandant_id, status, laufzeit_bis)
  where laufzeit_bis is not null;
create index auftrag_gewaehrleistung_idx on auftrag (mandant_id, gewaehrleistung_bis)
  where gewaehrleistung_bis is not null;
-- Der PRO-05-Referenzstrom: freigegeben, nicht widerrufen, nicht archiviert.
-- Ausdruecklich OHNE `status = 'abgeschlossen'`.
create index auftrag_referenz_idx on auftrag (mandant_id)
  where freigegeben_vom_kunden and freigabe_widerrufen_am is null and archiviert_am is null;
create index auftrag_lead_idx on auftrag (lead_id) where lead_id is not null;
/**
 * EIN Angebot ergibt hoechstens EINEN Auftrag — und zwar hier, nicht nur im
 * Dienst.
 *
 * `wandleInAuftrag` prueft erst und schreibt dann. Zwischen beidem liegt ein
 * Fenster: zwei gleichzeitige Klicks auf „Angenommen“ sehen beide keinen
 * Auftrag und legen beide einen an. Ein gewoehnlicher Index verhindert das
 * nicht; ein Vergleich im Anwendungscode auch nicht. Der eindeutige Index ist
 * die einzige Stelle, an der die Regel unter Nebenlaeufigkeit haelt — und der
 * Dienst uebersetzt seinen Verstoss in denselben benannten Fehler, den die
 * Vorabpruefung liefert.
 *
 * Sollte ein Angebot einmal in zwei Auftraege zerfallen duerfen (zwei
 * Objekte, zwei Vertraege), ist das eine Entscheidung des Mandanten und
 * gehoert als solche aufgeschrieben — nicht als stillschweigend erlaubter
 * Doppeleintrag.
 */
create unique index auftrag_angebot_uk on auftrag (angebot_id) where angebot_id is not null;

-- Der Fremdschluessel, den 0023 noch nicht setzen konnte.
alter table kalkulation add constraint kalkulation_auftrag_fk
  foreign key (mandant_id, auftrag_id) references auftrag (mandant_id, id);

/**
 * Die Freigabezeit kommt vom Server — aber NUR beim Ereignis.
 *
 * Ein Auftrag entsteht, BEVOR der Kunde ihn als Referenz freigibt. Ein
 * unbedingter Zeitstempel beim INSERT markierte jeden neuen Auftrag als
 * bereits freigegeben, und zwar geraeuschlos: `freigegeben_vom_kunden` steht
 * auf false, und die Bedingung oben feuert nur in der anderen Richtung.
 */
create function kern.auftrag_freigabe_stempeln() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.freigegeben_vom_kunden then new.freigabe_am := now(); end if;
    return new;
  end if;
  if new.freigegeben_vom_kunden and not old.freigegeben_vom_kunden then
    new.freigabe_am := now();
  end if;
  if new.freigabe_widerrufen_am is not null and old.freigabe_widerrufen_am is null then
    new.freigabe_widerrufen_am := now();
  end if;
  return new;
end $$;

create trigger auftrag_freigabe_stempeln before insert or update on auftrag
  for each row execute function kern.auftrag_freigabe_stempeln();

-- ---------------------------------------------------------------------------
-- Zeilenschutz — Modul `auftrag`, plus die Kundensicht.
-- ---------------------------------------------------------------------------

alter table auftrag enable row level security;
alter table auftrag force  row level security;

create policy t_mandant on auftrag for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('auftrag.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('auftrag.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on auftrag for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.auftrag.lesen')));

-- Der Kunde sieht SEINE Auftraege — auch die laufenden; anders als beim
-- Angebot gibt es hier keinen Entwurfszustand, den er nicht sehen duerfte.
create policy t_kunde on auftrag for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_kunde_decke on auftrag as restrictive for all to cse_app
  using (app.portal() <> 'kunde' or kunde_id = any (app.aktuelle_kunden()));

grant select, insert, update on auftrag to cse_app;

-- ---------------------------------------------------------------------------
-- Der Verantwortliche gehoert zu DIESER Gesellschaft.
-- ---------------------------------------------------------------------------

/**
 * Ist dieses Konto zum Stichtag Mitglied dieser Gesellschaft?
 *
 * `security definer`, weil `benutzer_mandant` unter RLS steht: der Ausloeser
 * unten laeuft als der AUFRUFENDE Rolle, und die sieht dort nicht die
 * Mitgliedschaften ihrer Kollegen. Ein Praedikat, das deshalb `false` saegte,
 * wiese jeden gueltigen Verantwortlichen ausser dem Aufrufer selbst ab.
 *
 * Zurueckgegeben wird nur ja/nein — nie eine id, nie ein Name. Wer eine
 * fremde Benutzer-id durchprobiert, erfaehrt daraus nichts ueber sie, ausser
 * dass sie in DIESER Gesellschaft nicht arbeitet, und das durfte er ohnehin
 * wissen, weil er sonst nichts eintragen koennte.
 */
create function app.ist_mitglied(p_benutzer uuid, p_mandant uuid,
                                 p_stichtag date default current_date)
returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select exists (
    select 1 from public.benutzer_mandant bm
     where bm.benutzer_id = p_benutzer
       and bm.mandant_id  = p_mandant
       and bm.entzogen_am is null
       and bm.gueltig_ab <= p_stichtag
       and (bm.gueltig_bis is null or bm.gueltig_bis >= p_stichtag))
$$;

grant execute on function app.ist_mitglied(uuid, uuid, date) to cse_app, cse_job;

/**
 * Und die Regel darauf.
 *
 * `verantwortlich_benutzer_id` zeigt auf `benutzer` — eine GLOBALE Tabelle,
 * also traegt der Fremdschluessel den Mandanten nicht mit. Das Formular
 * fuellt seine Auswahlliste zwar mandantengefiltert, aber eine Auswahlliste
 * ist keine Grenze: ein von Hand abgeschickter POST setzt jede beliebige id.
 * Der Auftrag der Reinigung haette dann einen Verantwortlichen, der nur bei
 * der Security arbeitet — sichtbar erst, wenn jemand ihn anruft.
 *
 * Geprueft wird beim Anlegen UND beim Umhaengen: ein spaeterer Wechsel auf
 * ein fremdes Konto ist derselbe Fehler.
 */
create function kern.auftrag_verantwortlich_im_mandant() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.verantwortlich_benutzer_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.verantwortlich_benutzer_id is not distinct from new.verantwortlich_benutzer_id
  then return new; end if;

  if not app.ist_mitglied(new.verantwortlich_benutzer_id, new.mandant_id) then
    raise exception 'Der Verantwortliche gehoert nicht zu dieser Gesellschaft'
      using errcode = 'check_violation',
            detail  = 'auftrag.verantwortlich_benutzer_id zeigt auf ein Konto ohne '
                      || 'gueltige benutzer_mandant-Zeile in diesem Mandanten.',
            hint    = 'Erst die Mitgliedschaft anlegen, dann den Auftrag zuweisen.';
  end if;
  return new;
end $$;

create trigger trg_auftrag_verantwortlich_im_mandant
  before insert or update on auftrag
  for each row execute function kern.auftrag_verantwortlich_im_mandant();

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0025)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- auftrag (archiv): OPS-05, FIN-07. An einem Auftrag haengen Rechnungen mit zehnjaehriger Aufbewahrung (§ 147 AO); ein beendeter Auftrag wird abgeschlossen und archiviert, nie entfernt.
create trigger trg_auftrag_kein_hard_delete
  before delete on auftrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_auftrag_kein_truncate
  before truncate on auftrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on auftrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_auftrag_geaendert_am
  before update on auftrag
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
