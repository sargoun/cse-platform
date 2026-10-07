-- 0522 — Eine Position verlaesst den Rechnungsentwurf, mit Grund (V-356, O-212, D-831)
--
-- rechnungsposition traegt die Loeschsperre (Invariante 8) und hatte keine
-- Zustandsspalte: eine versehentlich erfasste Zeile blieb, und der einzige
-- Ausweg war, den ganzen Entwurf zu verwerfen. Die Voreinstellung (O-212,
-- D-796): wie bei angebotsposition (0392) bleibt die Zeile stehen und
-- bekommt entfernt_am — hier zusaetzlich mit Grund und Person —, und sie
-- faellt aus jeder Summe heraus. Ihre Herkunft wird frei (wirksam = false),
-- sodass Zeit, Abruf, Nachweis, Aufmass oder Ausgabe wieder abrechenbar sind.
--
-- Entfernen geht nur im Entwurf: fin.kind_unveraenderlich (0076) laesst eine
-- Aenderung an einer Position nur zu, solange die Rechnung Entwurf ist. Eine
-- entfernte Position bleibt, wie sie ist (kein Zurueckholen), und ihre
-- Herkunft wird nicht wieder wirksam.
--
-- Ersetzt werden vier Funktionen, jede mit der Migration, die sie zuletzt
-- definiert hat; create or replace behaelt Eigentuemer und Rechte:
--   fin.rechnung_summen_stimmig        — 0076 (Summen nur ueber lebende Positionen)
--   fin.rechnung_beziehung_pruefen     — 0076 (Vollstorno: Gruppe mit null Netto
--                                         und null Steuer zaehlt nicht)
--   fin.rechnung_ustg14_pflichtfelder  — 0104 (mindestens eine LEBENDE Leistungszeile)
--   fin.auftrag_abschluss_befunde      — 0299, Eigentuemer seit 0340 (ein Nachweis
--                                         ist nur ueber eine wirksame Herkunft abgerechnet)
-- Die Kundenpolicy t_kunde auf rechnungsposition (0075) kommt neu, mit
-- entfernt_am is null.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 1. Die Spalten
-- ---------------------------------------------------------------------------

alter table rechnungsposition
  add column entfernt_am    timestamptz,
  add column entfernt_von   uuid references benutzer(id),
  add column entfernt_grund text;

alter table rechnungsposition add constraint rp_entfernung_benannt check (
  (entfernt_am is null and entfernt_von is null and entfernt_grund is null)
  or (entfernt_am is not null and entfernt_von is not null
      and length(btrim(coalesce(entfernt_grund, ''))) >= 3));

create index rp_lebend_idx on rechnungsposition (mandant_id, rechnung_id, position_nr)
  where entfernt_am is null;

comment on column rechnungsposition.entfernt_am is
  'V-356, O-212, D-831. Im Entwurf entfernt: die Zeile bleibt (Invariante 8), faellt aus '
  'jeder Summe, aus Nutzlast, Beleg und XRechnung, und ihre Herkunft ist frei.';
comment on column rechnungsposition.entfernt_grund is
  'V-356. Warum die Zeile den Entwurf verlassen hat — mindestens drei Zeichen.';

-- ---------------------------------------------------------------------------
-- 2. Eine entfernte Position bleibt, wie sie ist
-- ---------------------------------------------------------------------------

create function fin.entfernte_position_bleibt() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.entfernt_am is not null then
    raise exception 'Position % ist aus dem Entwurf entfernt und bleibt so (V-356)', old.id
      using errcode = 'restrict_violation',
            hint = 'Eine entfernte Position kommt nicht zurueck; was fehlt, ist eine neue Position.';
  end if;
  return new;
end $$;

create trigger trg_rp_entfernt_bleibt
  before update on rechnungsposition
  for each row execute function fin.entfernte_position_bleibt();

-- ---------------------------------------------------------------------------
-- 3. Die Herkunft einer entfernten Position wird nicht wieder wirksam
-- ---------------------------------------------------------------------------

create function fin.quelle_entfernter_position() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.wirksam and exists (
       select 1 from public.rechnungsposition p
        where p.id = new.rechnungsposition_id and p.entfernt_am is not null) then
    raise exception 'Die Position % ist entfernt; ihre Herkunft bleibt frei (V-356)',
      new.rechnungsposition_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_rpq_3_entfernt
  before insert or update on rechnungsposition_quelle
  for each row execute function fin.quelle_entfernter_position();

-- ---------------------------------------------------------------------------
-- 4. Die Summen beim COMMIT: nur lebende Positionen (ersetzt 0076)
-- ---------------------------------------------------------------------------

create or replace function fin.rechnung_summen_stimmig() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_r                  record;
  v_netto_positionen   bigint;
  v_zuschlaege         bigint;
  v_netto_soll         bigint;
  v_steuer_summe       bigint;
  v_netto_steuerzeilen bigint;
  v_gruppe             uuid;
begin
  -- Die Zeile wird neu gelesen: geprueft wird der Stand beim COMMIT, nicht
  -- der der ausloesenden Anweisung (0076).
  select r.* into v_r from public.rechnung r where r.id = new.id;
  if not found then
    return null;
  end if;

  -- Eine zwischensumme ist Anzeige, eine textzeile traegt keinen Betrag, und
  -- eine entfernte Position steht nicht mehr auf dem Beleg (V-356).
  select coalesce(sum(p.netto_cent), 0) into v_netto_positionen
    from public.rechnungsposition p
   where p.rechnung_id = v_r.id and p.positionsart = 'leistung'
     and p.entfernt_am is null;

  select coalesce(sum(case when z.art = 'zuschlag' then z.betrag_cent
                           else -z.betrag_cent end), 0)
    into v_zuschlaege
    from public.rechnung_zuschlag z where z.rechnung_id = v_r.id;

  v_netto_soll := v_netto_positionen + v_zuschlaege;

  if v_r.netto_gesamt_cent <> v_netto_soll then
    raise exception
      'Rechnung %: netto_gesamt_cent ist %, die Positionen und Zuschlaege ergeben % (§4.9)',
      coalesce(v_r.nummer, v_r.id::text), v_r.netto_gesamt_cent, v_netto_soll
      using errcode = 'restrict_violation';
  end if;

  select coalesce(sum(s.steuer_cent), 0), coalesce(sum(s.netto_cent), 0)
    into v_steuer_summe, v_netto_steuerzeilen
    from public.rechnung_steuer s where s.rechnung_id = v_r.id;

  if v_r.steuer_gesamt_cent <> v_steuer_summe then
    raise exception
      'Rechnung %: steuer_gesamt_cent ist %, die Steuerzeilen ergeben % (§14 Abs. 4 Nr. 8 UStG)',
      coalesce(v_r.nummer, v_r.id::text), v_r.steuer_gesamt_cent, v_steuer_summe
      using errcode = 'restrict_violation';
  end if;

  if v_netto_steuerzeilen <> v_netto_soll then
    raise exception
      'Rechnung %: die Steuerzeilen tragen Netto %, Positionen und Zuschlaege ergeben % (§4.9)',
      coalesce(v_r.nummer, v_r.id::text), v_netto_steuerzeilen, v_netto_soll
      using errcode = 'restrict_violation';
  end if;

  -- Je Gruppe: das Netto der Steuerzeile ist die Summe ihrer lebenden
  -- Positionen und ihrer Zuschlaege.
  select g.steuersatz_gruppe_id into v_gruppe
    from (
      select s.steuersatz_gruppe_id, s.netto_cent as gebucht,
             coalesce((select sum(p.netto_cent) from public.rechnungsposition p
                        where p.rechnung_id = v_r.id and p.positionsart = 'leistung'
                          and p.entfernt_am is null
                          and p.steuersatz_gruppe_id = s.steuersatz_gruppe_id), 0)
           + coalesce((select sum(case when z.art = 'zuschlag' then z.betrag_cent
                                       else -z.betrag_cent end)
                         from public.rechnung_zuschlag z
                        where z.rechnung_id = v_r.id
                          and z.steuersatz_gruppe_id = s.steuersatz_gruppe_id), 0) as gerechnet
        from public.rechnung_steuer s where s.rechnung_id = v_r.id) g
   where g.gebucht <> g.gerechnet
   limit 1;

  if found then
    raise exception
      'Rechnung %: Steuergruppe % ist mit einem anderen Netto gebucht, als ihre Zeilen ergeben (§4.9)',
      coalesce(v_r.nummer, v_r.id::text), v_gruppe
      using errcode = 'restrict_violation';
  end if;

  -- Der Einbehalt in Magnituden (0076): auf einem Storno sind beide Werte negativ.
  if abs(v_r.einbehalt_bauabzugsteuer_cent) > abs(v_r.zahlbetrag_cent) then
    raise exception
      'Rechnung %: der Steuerabzug nach §48 EStG (%) uebersteigt den Zahlbetrag (%)',
      coalesce(v_r.nummer, v_r.id::text),
      v_r.einbehalt_bauabzugsteuer_cent, v_r.zahlbetrag_cent
      using errcode = 'restrict_violation';
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Der Vollstorno: eine leere Steuergruppe zaehlt nicht (ersetzt 0076)
-- ---------------------------------------------------------------------------
--
-- Entfernt ein Entwurf die einzige Position einer Steuergruppe, schreibt
-- schreibeSummen deren Steuerzeile auf null Netto und null Steuer (geloescht
-- wird nichts). Der Storno spiegelt nur lebende Positionen und hat fuer diese
-- Gruppe gar keine Zeile. Eine Gruppe ohne Betrag hat nichts zu spiegeln; sie
-- faellt auf beiden Seiten aus dem Vergleich. Jede Gruppe MIT Betrag muss
-- weiterhin exakt negiert vorkommen.

create or replace function fin.rechnung_beziehung_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_von record;
  v_zu  record;
  v_abweichung record;
begin
  select r.status, r.mandant_id, r.kunde_id, r.rechnungsart, r.nummer
    into v_von from public.rechnung r where r.id = new.von_rechnung_id;
  select r.status, r.mandant_id, r.kunde_id, r.rechnungsart, r.nummer
    into v_zu  from public.rechnung r where r.id = new.zu_rechnung_id;

  if v_von.status is distinct from 'festgeschrieben'
     or v_zu.status is distinct from 'festgeschrieben' then
    raise exception 'rechnung_beziehung: beide Belege muessen festgeschrieben sein'
      using errcode = 'restrict_violation',
            hint = 'Ein Entwurf storniert nichts — er hat noch gar keine Nummer.';
  end if;

  if v_von.mandant_id <> new.mandant_id or v_zu.mandant_id <> new.mandant_id then
    raise exception 'rechnung_beziehung: beide Belege gehoeren derselben Gesellschaft (Invariante 3)'
      using errcode = 'restrict_violation';
  end if;

  if v_von.kunde_id <> v_zu.kunde_id then
    raise exception 'rechnung_beziehung: die Belege gehoeren zwei verschiedenen Kunden'
      using errcode = 'restrict_violation';
  end if;

  if new.art = 'storno' then
    if v_von.rechnungsart <> 'storno' then
      raise exception 'rechnung_beziehung: der stornierende Beleg % traegt rechnungsart = %, nicht storno',
        coalesce(v_von.nummer, new.von_rechnung_id::text), v_von.rechnungsart
        using errcode = 'restrict_violation';
    end if;

    if new.storno_art = 'vollstorno' then
      -- Der volle Aussenvergleich je Steuergruppe, als full join (0076) —
      -- ohne die Gruppen, die weder Netto noch Steuer tragen (V-356).
      select coalesce(o.steuersatz_gruppe_id, s.steuersatz_gruppe_id) as gruppe
        into v_abweichung
        from (select steuersatz_gruppe_id, netto_cent, steuer_cent
                from public.rechnung_steuer
               where rechnung_id = new.zu_rechnung_id
                 and not (netto_cent = 0 and steuer_cent = 0)) o
        full join
             (select steuersatz_gruppe_id, netto_cent, steuer_cent
                from public.rechnung_steuer
               where rechnung_id = new.von_rechnung_id
                 and not (netto_cent = 0 and steuer_cent = 0)) s
          on s.steuersatz_gruppe_id = o.steuersatz_gruppe_id
       where o.steuersatz_gruppe_id is null
          or s.steuersatz_gruppe_id is null
          or s.netto_cent <> -o.netto_cent
          or s.steuer_cent <> -o.steuer_cent
       limit 1;

      if found then
        raise exception
          'Vollstorno: Steuergruppe % spiegelt das Original nicht exakt (§14 Abs. 4 Nr. 8 UStG)',
          v_abweichung.gruppe
          using errcode = 'restrict_violation',
                hint = 'Ein Vollstorno traegt je Steuergruppe genau den negierten Betrag. '
                       'Fuer alles andere ist O-178 offen (Teilstorno).';
      end if;
    end if;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. §14 UStG: mindestens eine LEBENDE Leistungszeile (ersetzt 0104)
-- ---------------------------------------------------------------------------

create or replace function fin.rechnung_ustg14_pflichtfelder() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  r            record;
  m            record;
  k            record;
  v_klein      boolean;
  v_name       text;
  v_strasse    text;
  v_plz        text;
  v_ort        text;
  v_zeilen     bigint;
  v_steuer     bigint;
  v_fehlend    text;
begin
  -- Neu gelesen: geprueft wird der Stand beim COMMIT (0104).
  select * into r from public.rechnung where id = new.id;
  if not found or r.status <> 'festgeschrieben' then
    return null;
  end if;

  -- 1. Der Leistende: vollstaendiger Name und Anschrift (§14 Abs. 4 Nr. 1).
  select * into m from public.mandant where id = r.mandant_id;
  if not found then
    raise exception
      'Rechnung %: die ausstellende Gesellschaft ist nicht lesbar — §14 Abs. 4 Nr. 1 UStG verlangt ihren Namen und ihre Anschrift',
      coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
  end if;

  v_fehlend := nullif(concat_ws(', ',
    case when nullif(btrim(coalesce(m.firma, '')), '') is null then 'Firma' end,
    case when nullif(btrim(coalesce(m.strasse, '')), '') is null then 'Strasse' end,
    case when nullif(btrim(coalesce(m.plz, '')), '') is null then 'PLZ' end,
    case when nullif(btrim(coalesce(m.ort, '')), '') is null then 'Ort' end), '');
  if v_fehlend is not null then
    raise exception
      'Rechnung %: dem Leistenden fehlt % — §14 Abs. 4 Nr. 1 UStG verlangt den vollstaendigen Namen und die vollstaendige Anschrift',
      coalesce(r.nummer, r.id::text), v_fehlend
      using errcode = 'restrict_violation',
            hint = 'Zu ergaenzen an der Gesellschaft (Einstellungen → Gesellschaft).';
  end if;

  -- 2. Steuernummer oder USt-IdNr. (§14 Abs. 4 Nr. 2, O-24).
  if nullif(btrim(coalesce(m.ust_id, '')), '') is null
     and nullif(btrim(coalesce(m.steuernummer, '')), '') is null then
    raise exception
      'Rechnung %: die Gesellschaft % fuehrt weder Steuernummer noch USt-IdNr. — §14 Abs. 4 Nr. 2 UStG (O-24)',
      coalesce(r.nummer, r.id::text), m.name
      using errcode = 'restrict_violation',
            hint = 'Ohne eine der beiden Angaben berechtigt der Beleg den Empfaenger '
                   'nicht zum Vorsteuerabzug. Nachzutragen an der Gesellschaft.';
  end if;

  -- 3. Greift die Erleichterung des §33 UStDV? (FIN-13)
  v_klein := fin.kleinbetrag_greift(r.id);

  -- 4. Der Empfaenger: vollstaendiger Name und Anschrift (§14 Abs. 4 Nr. 1);
  --    entfaellt nur bei der Kleinbetragsrechnung.
  if not v_klein then
    select kd.name, kd.rechnungsadresse_abweichend, kd.rechnung_name,
           kd.rechnung_strasse, kd.rechnung_plz, kd.rechnung_ort,
           kd.strasse, kd.plz, kd.ort
      into k
      from public.kunde kd
     where kd.mandant_id = r.mandant_id and kd.id = r.kunde_id;
    if not found then
      raise exception
        'Rechnung %: der Leistungsempfaenger ist nicht lesbar — §14 Abs. 4 Nr. 1 UStG verlangt seinen Namen und seine Anschrift',
        coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
    end if;

    if k.rechnungsadresse_abweichend then
      v_name    := coalesce(nullif(btrim(coalesce(k.rechnung_name, '')), ''), k.name);
      v_strasse := k.rechnung_strasse;
      v_plz     := k.rechnung_plz;
      v_ort     := k.rechnung_ort;
    else
      v_name    := k.name;
      v_strasse := k.strasse;
      v_plz     := k.plz;
      v_ort     := k.ort;
    end if;

    v_fehlend := nullif(concat_ws(', ',
      case when nullif(btrim(coalesce(v_name, '')), '') is null then 'Name' end,
      case when nullif(btrim(coalesce(v_strasse, '')), '') is null then 'Strasse' end,
      case when nullif(btrim(coalesce(v_plz, '')), '') is null then 'PLZ' end,
      case when nullif(btrim(coalesce(v_ort, '')), '') is null then 'Ort' end), '');
    if v_fehlend is not null then
      raise exception
        'Rechnung %: dem Leistungsempfaenger fehlt % — §14 Abs. 4 Nr. 1 UStG (keine Kleinbetragsrechnung nach §33 UStDV)',
        coalesce(r.nummer, r.id::text), v_fehlend
        using errcode = 'restrict_violation',
              hint = 'Zu ergaenzen am Kunden. Unterhalb der Kleinbetragsgrenze des '
                     '§33 UStDV entfaellt diese Angabe — die Grenze steht in '
                     'kleinbetrag_grenze und ist noch unbestaetigt (O-175).';
    end if;
  end if;

  -- 5. Mindestens eine LEBENDE Leistungszeile (§14 Abs. 4 Nr. 5): eine
  --    entfernte Position steht nicht auf dem Beleg (V-356).
  select count(*) into v_zeilen
    from public.rechnungsposition p
   where p.rechnung_id = r.id and p.positionsart = 'leistung'
     and p.entfernt_am is null;
  if v_zeilen = 0 then
    raise exception
      'Rechnung %: keine Leistungsposition — §14 Abs. 4 Nr. 5 UStG verlangt Menge und Art der Leistung',
      coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
  end if;

  -- 6. Das Entgelt, nach Steuersaetzen aufgeschluesselt (§14 Abs. 4 Nr. 7 und
  --    Nr. 8): die Aufschluesselung muss ueberhaupt existieren.
  select count(*) into v_steuer
    from public.rechnung_steuer s where s.rechnung_id = r.id;
  if v_steuer = 0 then
    raise exception
      'Rechnung %: keine Steueraufschluesselung — §14 Abs. 4 Nr. 7 und Nr. 8 UStG verlangen das Entgelt je Steuersatz sowie Satz und Steuerbetrag oder den Hinweis auf die Steuerbefreiung',
      coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Die Pruefliste vor dem Abschluss (ersetzt 0299; Eigentuemer seit 0340)
-- ---------------------------------------------------------------------------
--
-- Ein unterschriebener Leistungsnachweis gilt nur dann als abgerechnet, wenn
-- eine WIRKSAME Herkunft auf ihn zeigt. Bis hierher genuegte irgendeine —
-- auch die eines verworfenen Entwurfs, eines Stornos oder jetzt einer
-- entfernten Position, die ihn freigegeben haben.

create or replace function fin.auftrag_abschluss_befunde(p_auftrag uuid)
returns table (
  zeit_ohne_freigabe        bigint,
  zeit_ohne_abrechnung      bigint,
  erfasste_minuten          bigint,
  nachweise_ohne_rechnung   bigint,
  rechnungen_entwurf        bigint,
  aufmasse_offen            bigint,
  nachtraege_offen          bigint,
  leistungen_laufend        bigint,
  ohne_abrechnungsart       bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_gehoert uuid;
begin
  select a.mandant_id into v_gehoert from public.auftrag a where a.id = p_auftrag;
  if not found then
    raise exception 'Auftrag % existiert nicht', p_auftrag using errcode = 'no_data_found';
  end if;
  -- Invariante 3: der Mandant kommt aus der Sitzung und wird verglichen.
  if v_gehoert is distinct from v_mandant then
    raise exception 'Auftrag % gehoert nicht zum aktiven Mandanten (Invariante 3)', p_auftrag
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('auftrag.abschliessen', v_gehoert) then
    raise exception 'auftrag.abschliessen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
  with leistung as (
    select al.id, al.gueltig_bis
      from public.auftrag_leistung al
     where al.mandant_id = v_mandant and al.auftrag_id = p_auftrag
  ),
  zeit as (
    -- Nur die geltende Fassung, ohne Storno (0051).
    select z.freigegeben_am, z.abgerechnet_am, z.dauer_netto_minuten
      from public.zeiteintrag z
      join leistung l on l.id = z.auftrag_leistung_id
     where z.mandant_id = v_mandant
       and z.storniert_am is null and z.ersetzt_am is null
  )
  select
    (select count(*) from zeit where freigegeben_am is null),
    (select count(*) from zeit where freigegeben_am is not null and abgerechnet_am is null),
    (select coalesce(sum(dauer_netto_minuten), 0) from zeit),
    (select count(*)
       from public.leistungsnachweis ln
       join leistung l on l.id = ln.auftrag_leistung_id
      where ln.mandant_id = v_mandant
        and ln.status = 'signiert' and ln.storniert_am is null
        and not exists (select 1 from public.rechnungsposition_quelle rq
                         where rq.leistungsnachweis_id = ln.id and rq.wirksam)),
    (select count(*) from public.rechnung r
      where r.mandant_id = v_mandant and r.auftrag_id = p_auftrag
        and r.status = 'entwurf'),
    (select count(*)
       from public.aufmass am
       join leistung l on l.id = am.auftrag_leistung_id
      where am.mandant_id = v_mandant and am.storniert_am is null
        and am.status not in ('gegengezeichnet', 'einseitig_festgestellt', 'abgelehnt')),
    (select count(*) from public.nachtrag n
      where n.mandant_id = v_mandant and n.auftrag_id = p_auftrag
        and n.storniert_am is null
        and n.status in ('angemeldet', 'kalkuliert', 'eingereicht')),
    (select count(*) from leistung where gueltig_bis is null),
    (select count(*) from leistung l
      where not exists (select 1 from public.vertrag_abrechnung va
                         where va.mandant_id = v_mandant
                           and (va.auftrag_leistung_id = l.id
                                or (va.auftrag_leistung_id is null
                                    and va.auftrag_id = p_auftrag))));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Der Kunde sieht keine entfernte Position (ersetzt die Policy aus 0075)
-- ---------------------------------------------------------------------------

drop policy t_kunde on rechnungsposition;

create policy t_kunde on rechnungsposition for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and entfernt_am is null
         and exists (select 1 from rechnung r
                      where r.mandant_id = rechnungsposition.mandant_id
                        and r.id = rechnungsposition.rechnung_id
                        and r.kunde_id = any (app.aktuelle_kunden())
                        and r.status = 'festgeschrieben'));
