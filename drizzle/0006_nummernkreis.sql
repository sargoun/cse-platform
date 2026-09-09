-- 0006 — nummernkreis: der Zähler, den die Festschreibung sperrt (FIN-03, TEN-02, LEG-01).
--
-- Warum eine ZEILE und keine Sequenz: eine Sequenz rollt nicht zurück. Wer
-- eine Nummer zieht und die Transaktion abbricht, hinterlässt in einer Sequenz
-- eine Lücke — und §14 UStG duldet keine. Ein Zähler in einer Zeile, unter
-- `SELECT … FOR UPDATE`, bewegt sich mit der Transaktion oder gar nicht.
-- Der Preis ist Serialisierung, und der Preis ist der Punkt.

create schema if not exists fin;
grant usage on schema fin to cse_app, cse_job, cse_definer;

-- Neun Typen. Drei aus FIN-03/FIN-16/ACC-06, zwei verlangt von
-- 02-CRM-OPERATIONS §13, zwei von 03-GEWERKE §2.3, einer von §7.8.
create type nummernkreis_typ as enum (
  'ausgangsrechnung', 'gutschrift', 'eingangsrechnung_beleg', 'mahnung',
  'angebot', 'auftrag', 'leistungsnachweis', 'wachbuch', 'kassenbuch'
);

-- PLATZHALTER-Vokabular, ohne Default (O-134). Ein `DEFAULT 'nie'` würde
-- "fortlaufend" zur Nummerierungspolitik jeder Gesellschaft machen, die
-- angelegt wird, bevor der Mandant die Frage beantwortet hat.
create type nummernkreis_zuruecksetzung as enum ('nie', 'jaehrlich');

create table nummernkreis (
  id                          uuid primary key default gen_random_uuid(),
  mandant_id                  uuid not null references mandant(id),
  kreis_typ                   nummernkreis_typ not null,
  -- NICHT optional. 03-GEWERKE braucht (mandant,'wachbuch',objekt_id,jahr) und
  -- (mandant,'leistungsnachweis',null,jahr); ein Kreis ohne diese Spalte kann
  -- die zwei Geltungsbereiche nicht nebeneinander halten.
  kontext_id                  uuid,
  -- 0 = fortlaufend über Jahre. Der Grund, warum die Suche NIE über das
  -- heutige Jahr gehen darf: ein `nie`-Kreis trägt jahr = 0, eine Suche nach
  -- jahr = 2026 findet ihn nicht, und die Festschreibung scheitert für genau
  -- die Gesellschaften, die durchnummerieren.
  jahr                        integer not null check (jahr = 0 or jahr between 2000 and 2100),
  bezeichnung                 text not null,
  -- Kein Default: `angebot` und `auftrag` sind ausdrücklich NICHT lückenlos
  -- (02-CRM-OPERATIONS §4.6), und Lückenlosigkeit zu behaupten, wo nichts sie
  -- erzwingt, ist ein Versprechen ohne Deckung.
  lueckenlos                  boolean not null,
  format_maske                text not null,
  zuruecksetzung              nummernkreis_zuruecksetzung,
  -- DER Zähler. Es gibt keine Spalte `stand` und keine Spalte `letzter_wert`.
  naechste_nummer             bigint not null default 1 check (naechste_nummer >= 1),
  letzter_hash                text check (letzter_hash is null or letzter_hash ~ '^[0-9a-f]{64}$'),
  vorgaenger_nummernkreis_id  uuid references nummernkreis(id),
  -- Der letzte Hash des Vorgängerkreises, beim Öffnen kopiert. NULL nur beim
  -- allerersten Kreis einer Gesellschaft (§5.4).
  genesis_hash                text check (genesis_hash is null or genesis_hash ~ '^[0-9a-f]{64}$'),
  geoeffnet_am                date not null,
  geschlossen_am              date,
  -- Solange true, verweigert fin.rechnung_nummer_ziehen. Ein Kreis ist erst
  -- bestätigt, wenn jemand die Maske und die Rücksetzung beantwortet hat.
  ist_platzhalter             boolean not null default true,

  -- Auditblock (§1.6). Die drei Akteursarten statt eines erfundenen Menschen:
  -- diese Zeile wird auch von einer Funktion und von einem Job geschrieben.
  -- Die FKs auf `benutzer` fehlen noch — die Tabelle kommt mit PR 6.
  erstellt_von_art            akteur_art not null default 'mensch',
  erstellt_von                uuid,
  erstellt_von_agent_id       uuid,
  erstellt_von_dienst         text,
  erstellt_am                 timestamptz not null default now(),
  geaendert_am                timestamptz,
  geaendert_von_art           akteur_art,
  geaendert_von               uuid,

  constraint nummernkreis_mandant_id_uk unique (mandant_id, id),

  constraint akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint nk_maske_bei_lueckenlos check (not lueckenlos or format_maske is not null),
  -- Review B7: bei jährlicher Rücksetzung ohne Jahr in der Maske produzieren
  -- zwei Kreise derselben GmbH zweimal `RE-00042`.
  constraint nk_jahresmaske check (
    zuruecksetzung is distinct from 'jaehrlich'
    or (jahr <> 0 and format_maske like '%{jahr}%')),
  constraint nk_geschlossen_nach_geoeffnet check (
    geschlossen_am is null or geschlossen_am >= geoeffnet_am),
  -- Einen Kreis bestätigen heisst, die Rücksetzungsfrage zu beantworten.
  constraint nk_bestaetigt_hat_ruecksetzung check (ist_platzhalter or zuruecksetzung is not null)
);

-- Genau die Suche, die die Festschreibung vor dem Sperren ausführt.
-- NULLS NOT DISTINCT (PG 15+): kontext_id ist NULL für jeden gesellschafts-
-- weiten Kreis, und die Vorgabe-Semantik würde für genau diese Population
-- nichts einschränken.
create unique index nummernkreis_key
  on nummernkreis (mandant_id, kreis_typ, kontext_id, jahr) nulls not distinct;

-- HÖCHSTENS EIN offener Kreis je Geltungsbereich. Das ist, was die Kette über
-- die Kreisgrenze hinweg zu einer Linie macht statt zu einer Gabelung (§5.4),
-- und was die Suche auf dem offenen Schlüssel eindeutig macht.
create unique index nummernkreis_offen_key
  on nummernkreis (mandant_id, kreis_typ, kontext_id) nulls not distinct
  where geschlossen_am is null;

create index nummernkreis_typ_idx on nummernkreis (mandant_id, kreis_typ)
  where geschlossen_am is null;

-- Ein Kreis wird von höchstens einem Nachfolger fortgesetzt.
create unique index nummernkreis_vorgaenger_uk
  on nummernkreis (vorgaenger_nummernkreis_id)
  where vorgaenger_nummernkreis_id is not null;

comment on table nummernkreis is
  'Zählerzeile je Nummernserie und Gesellschaft. FOR UPDATE-gesperrt bei der Vergabe (FIN-03).';
comment on column nummernkreis.naechste_nummer is
  'Der Zähler. Keine Sequenz: eine Sequenz rollt nicht zurück und hinterlässt Lücken.';

-- ---------------------------------------------------------------------------
-- app.hat_recht mit Mandant — die Signatur, die der Trigger unten braucht.
-- ---------------------------------------------------------------------------

/**
 * `05-FINANZEN.md` §3.3 ruft `app.hat_recht('nummernkreis.verwalten', new.mandant_id)`
 * auf — mit ZWEI Argumenten. PR 4 hat nur die einstellige Form angelegt; ohne
 * diese hier lässt sich die Migration nicht einmal anwenden.
 *
 * Das zweite Argument ist nicht Kosmetik: ein Recht gilt je Gesellschaft. Ein
 * `leitung` in der Reinigung hält `nummernkreis.verwalten` dort und nirgends
 * sonst, und die einstellige Form kann diese Frage gar nicht stellen.
 *
 * Wie die einstellige Form antwortet sie `false`, bis PR 6 den Katalog setzt
 * (K-19/D-17, D-23): ein unbekannter Rechteschlüssel ist dauerhafte, stille
 * Verweigerung, und ein `true` vor dem Katalog stünde offen.
 */
create function app.hat_recht(p_schluessel text, p_mandant uuid) returns boolean
language sql stable as $$
  select false
$$;

comment on function app.hat_recht(text, uuid) is
  'K-19/D-17: Rechte gelten je Gesellschaft. Der Katalog kommt mit PR 6; bis dahin false.';

-- ---------------------------------------------------------------------------
-- fin.nummernkreis_pruefen — was am Zähler überhaupt geschehen darf.
-- ---------------------------------------------------------------------------

/**
 * Review B19: der Entwurf verlangte `NEW.letzter_wert = OLD.letzter_wert + 1`
 * bei JEDEM Update. Damit liess sich die Maske nicht bestätigen, das Label
 * nicht ändern und der Kreis nicht schliessen — und weil die Festschreibung
 * verweigert, solange der Kreis Platzhalter ist, war sie in der Produktion
 * dauerhaft blockiert. Geprüft wird stattdessen die Eigenschaft, auf die es
 * ankommt: der Zähler bewegt sich um genau eins oder gar nicht, und Maske und
 * Geltungsbereich frieren in dem Moment ein, in dem die erste Nummer das Haus
 * verlässt.
 */
create function fin.nummernkreis_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.naechste_nummer <> old.naechste_nummer
     and new.naechste_nummer <> old.naechste_nummer + 1 then
    raise exception 'Nummernkreis: der Zähler darf nur um genau 1 erhöht werden (FIN-03)'
      using errcode = 'restrict_violation';
  end if;

  if old.naechste_nummer > 1
     and (new.format_maske, new.zuruecksetzung, new.kreis_typ, new.jahr, new.kontext_id, new.lueckenlos)
      is distinct from
         (old.format_maske, old.zuruecksetzung, old.kreis_typ, old.jahr, old.kontext_id, old.lueckenlos) then
    raise exception 'Nummernkreis: Maske und Geltungsbereich sind nach der ersten Vergabe unveränderlich (LEG-01)'
      using errcode = 'restrict_violation';
  end if;

  if old.geschlossen_am is not null and new.naechste_nummer <> old.naechste_nummer then
    raise exception 'Nummernkreis: geschlossener Kreis vergibt keine Nummern mehr'
      using errcode = 'restrict_violation';
  end if;

  -- Das Zählerrecht ist nicht das Verwaltungsrecht.
  if not app.hat_recht('nummernkreis.verwalten', new.mandant_id)
     and (to_jsonb(new) - 'naechste_nummer' - 'letzter_hash'
                        - 'geaendert_am' - 'geaendert_von' - 'geaendert_von_art')
      is distinct from
         (to_jsonb(old) - 'naechste_nummer' - 'letzter_hash'
                        - 'geaendert_am' - 'geaendert_von' - 'geaendert_von_art') then
    raise exception 'Nummernkreis: mit nummernkreis.ziehen darf nur der Zähler bewegt werden'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

create trigger trg_nummernkreis_pruefen
  before update on nummernkreis
  for each row execute function fin.nummernkreis_pruefen();

-- ---------------------------------------------------------------------------
-- TEN-02 — ein Rechnungskreis gehört einer eigenen Rechtseinheit.
-- ---------------------------------------------------------------------------

/**
 * Die Vorgabe in §3.3 lautet "ein Trigger, der `mandant.eigener_nummernkreis
 * = true` verlangt", und begründet ihn wörtlich damit, dass sonst **nichts
 * eine Abteilung davon abhält, Rechnungen auszustellen**.
 *
 * Wörtlich auf alle neun Kreistypen angewandt wäre das falsch: `wachbuch` und
 * `leistungsnachweis` sind keine Rechnungen, und eine Gesellschaft ohne
 * eigenen Rechnungskreis könnte dann kein Wachbuch führen — was Phase 5
 * bricht. Die Bedingung gilt deshalb für die abrechnenden Typen, also genau
 * für die Population, über die die Begründung spricht.
 *
 * Die Liste steht hier als Konstante und nicht verstreut, damit ein späterer
 * Typ eine Entscheidung erfordert statt stillschweigend durchzurutschen.
 */
create function fin.nummernkreis_rechtseinheit_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_eigener boolean;
begin
  if new.kreis_typ not in ('ausgangsrechnung','gutschrift') then
    return new;
  end if;
  select m.eigener_nummernkreis into v_eigener from public.mandant m where m.id = new.mandant_id;
  if v_eigener is not true then
    raise exception
      'Nummernkreis: % erfordert mandant.eigener_nummernkreis = true (TEN-02)', new.kreis_typ
      using errcode = 'restrict_violation',
            hint = 'O-01 ist offen: ob CSE Operations eine GmbH mit eigenem Kreis ist '
                   'oder eine Abteilung, entscheidet der Mandant.';
  end if;
  return new;
end $$;

create trigger trg_nummernkreis_rechtseinheit
  before insert or update of kreis_typ, mandant_id on nummernkreis
  for each row execute function fin.nummernkreis_rechtseinheit_pruefen();

-- ---------------------------------------------------------------------------
-- RLS. Mandantenscharf wie jede Tabelle aus PR 3; die Rechteprüfung
-- (nummernkreis.ziehen / .verwalten) kommt mit dem Katalog in PR 6 — genau
-- wie bei `anstellung` und `person`, die hier auf demselben Stand sind.
-- ---------------------------------------------------------------------------
alter table nummernkreis enable row level security;
alter table nummernkreis force  row level security;

-- `_lesen` ist bewusst UNBESCHRÄNKT innerhalb des Mandanten: die Funktion muss
-- einen Platzhalter oder einen geschlossenen Kreis LESEN können, um einen
-- benannten Fehler zu werfen, statt nichts zu finden (§1.1).
create policy d_kreis_lesen on nummernkreis for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten()));

/**
 * `_ziehen`: aktiver Mandant, offen, kein Platzhalter — und **nicht die
 * Rechnungskreise**.
 *
 * Fünf der neun Typen zieht gewöhnlicher Anwendungscode. Die abrechnenden
 * nicht: deren Zug läuft in `fin.rechnung_nummer_ziehen` (SECURITY DEFINER,
 * PR 46), der die Kette in derselben Transaktion mitschreibt. Stünden sie hier
 * ebenfalls offen, könnte die Anwendung eine Rechnungsnummer ziehen **ohne**
 * den Kettensatz zu schreiben — eine vergebene Nummer ohne Kettenglied, und
 * die Lücke fiele erst dem nächtlichen Prüflauf auf.
 *
 * Ohne diese Einschränkung war die Policy weiter als §1.1 sie beschreibt.
 */
create policy d_kreis_ziehen on nummernkreis for update to cse_app
  using (mandant_id = app.aktiver_mandant()
         and geschlossen_am is null
         and not ist_platzhalter
         and kreis_typ not in ('ausgangsrechnung','gutschrift'))
  with check (mandant_id = app.aktiver_mandant()
              and geschlossen_am is null
              and not ist_platzhalter
              and kreis_typ not in ('ausgangsrechnung','gutschrift'));

-- Interner Ceiling (K-04): ein Mitarbeiter- oder Kundenportal sieht keinen
-- Nummernkreis. RESTRICTIVE, weil eine permissive Regel ODER-verknüpft würde
-- und damit ein Loch statt einer Decke wäre.
create policy p_nk_intern_ceiling on nummernkreis as restrictive
  for all to cse_app using (app.portal() = 'intern')
  with check (app.portal() = 'intern');

-- Spaltenliste statt Tabellen-Grant: mit `ziehen` bewegt sich der Zähler und
-- der Kettenkopf, sonst nichts (K-05-Mechanik, §1.1).
grant select on nummernkreis to cse_app;
grant update (naechste_nummer, letzter_hash, geaendert_am, geaendert_von, geaendert_von_art)
  on nummernkreis to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0006)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nummernkreis (archiv): FIN-03, LEG-01. Die Zählerzeile IST der Beweis der Lückenlosigkeit: sie zu löschen und neu anzulegen setzt den Zähler zurück und erzeugt zweimal dieselbe Rechnungsnummer. `geschlossen_am` beendet die Vergabe; die Zeile bleibt, solange die Nummern gelten, die sie ausgegeben hat.
create trigger trg_nummernkreis_kein_hard_delete
  before delete on nummernkreis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nummernkreis_kein_truncate
  before truncate on nummernkreis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nummernkreis from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_nummernkreis_geaendert_am
  before update on nummernkreis
  for each row execute function kern.setze_geaendert_am();

create trigger trg_nummernkreis_audit
  after insert or update or delete on nummernkreis
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
