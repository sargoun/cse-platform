/**
 * §13b UStG (Reverse Charge) und §48 EStG (Bauabzugsteuer) — die Belege, aus
 * denen beide Regeln ihre Antwort ziehen (FIN-09, FIN-10, LEG-06, PR 51).
 *
 * **Beides sind NACHWEISE mit einem Gültigkeitszeitraum, keine Schalter.**
 * Ob eine Rechnung die Steuerschuld verlagert, hängt nicht daran, was heute im
 * Kundenstamm angehakt ist, sondern daran, was am LEISTUNGSDATUM galt. Eine
 * boolesche Spalte auf `kunde` hätte jede historische Rechnung beim nächsten
 * Statuswechsel rückwirkend umgedeutet — auf Belegen, die unveränderlich sind.
 */

/**
 * Der §13b-Status eines Kunden, datiert (FIN-09).
 *
 * **`leistungsart` ist nicht optional.** §13b Abs. 2 Nr. 4 UStG verlagert bei
 * BAULEISTUNGEN an einen Bauleistenden, Nr. 8 bei GEBÄUDEREINIGUNGS­leistungen
 * an einen Unternehmer, der selbst Gebäudereinigungsleistungen erbringt. Das
 * sind zwei verschiedene Tatbestände, und in dieser Gruppe ist der zweite der
 * häufigere: die CSE Dienstleistungen vergibt Reinigung regelmässig an
 * Nachunternehmer. Ein Bau-only-Kennzeichen hätte den häufigsten Fall dieser
 * Gruppe nicht darstellbar gemacht.
 *
 * **`EXCLUDE` statt `unique`.** Zwei sich überlappende Zeiträume für denselben
 * Kunden und dieselbe Leistungsart wären zwei Antworten auf eine Frage, und
 * welche die Rechnung nimmt, entschiede die Sortierung. Der Ausschluss macht
 * den Widerspruch unmöglich, statt ihn zu verbieten.
 */
create table kunde_bauleistender_status (
  id                  uuid primary key default gen_random_uuid(),
  mandant_id          uuid not null references mandant(id),
  kunde_id            uuid not null,

  leistungsart        bauleistungsart not null,
  ist_bauleistender   boolean not null,

  gilt_ab             date not null,
  /** `null` = bis auf Weiteres. */
  gilt_bis            date,

  /**
   * Woher der Nachweis kommt — die Freistellungsbescheinigung USt 1 TG, eine
   * schriftliche Bestätigung, eine Auskunft des Finanzamts.
   *
   * PLATZHALTER als FREITEXT und nicht als Enum:
   * // TODO(client, O-104): Welche §13b-Abs.-2-Tatbestände erbringt und
   * bezieht die Gruppe, und wie wird der Status eines Kunden als nachhaltig
   * bauleistungserbringender Unternehmer belegt (USt 1 TG)?
   */
  grundlage           text not null check (length(btrim(grundlage)) >= 3),
  dokument_id         uuid references dokument(id),

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint kbs_zeitraum check (gilt_bis is null or gilt_bis >= gilt_ab),
  constraint kbs_kunde_fk foreign key (mandant_id, kunde_id) references kunde (mandant_id, id),
  constraint kbs_mandant_uk unique (mandant_id, id),
  constraint kbs_akteur_stimmig check (
    (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent' and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create extension if not exists btree_gist;

alter table kunde_bauleistender_status add constraint kbs_kein_ueberlapp
  exclude using gist (
    kunde_id with =,
    leistungsart with =,
    daterange(gilt_ab, gilt_bis, '[]') with &&
  );

create index kbs_kunde_idx on kunde_bauleistender_status (mandant_id, kunde_id, gilt_ab desc);

/**
 * **`freistellung_umfang` — GESETZT, kein Platzhalter.** §48b EStG stellt
 * beide Formen aus: eine unbeschränkte Bescheinigung und eine, die für einen
 * bestimmten Auftrag gilt. Das sind die zwei, die es gibt; ein dritter Wert
 * wäre erfunden.
 */
create type freistellung_umfang as enum ('unbeschraenkt', 'auftragsbezogen');

/**
 * Die Freistellungsbescheinigung nach §48b EStG (FIN-10).
 *
 * **Ohne sie werden 15 % einbehalten — mit ihr nicht.** Das ist keine
 * Kulanzfrage: wer die Bauabzugsteuer nicht einbehält, obwohl er müsste,
 * haftet für den Betrag (§48a Abs. 3 EStG). Und wer einbehält, obwohl eine
 * gültige Bescheinigung vorlag, zieht dem Kunden Geld ab, das ihm zusteht.
 * Beide Richtungen kosten, und beide entscheiden sich an einem Datum.
 *
 * **`umfang` trennt die zwei Formen, die §48b EStG kennt.** Eine
 * auftragsbezogene Bescheinigung gilt für EINEN Auftrag; ohne die
 * Unterscheidung nähme der Prüfer sie für jeden anderen mit an.
 */
create table freistellungsbescheinigung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /**
   * Kunde ODER Lieferant — genau einer.
   *
   * `lieferant` gibt es noch nicht (die Tabelle kommt mit PR 54,
   * Eingangsrechnungen). Die Spalte steht trotzdem hier, ohne
   * Fremdschlüssel und mit dem CHECK, der sie leer hält: so ist die Form der
   * Tabelle die richtige, und PR 54 setzt den Schlüssel, statt die Tabelle
   * umzubauen.
   */
  kunde_id              uuid,
  lieferant_id          uuid,

  bescheinigung_nummer  text not null check (length(btrim(bescheinigung_nummer)) >= 3),
  finanzamt             text not null check (length(btrim(finanzamt)) >= 3),

  gueltig_von           date not null,
  gueltig_bis           date not null,
  /** Ein Widerruf beendet sie VOR ihrem Ablauf — und rückwirkend nie. */
  widerrufen_am         date,

  umfang                freistellung_umfang not null,
  auftrag_id            uuid,

  dokument_id           uuid references dokument(id),

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint fsb_zeitraum check (gueltig_bis >= gueltig_von),
  constraint fsb_widerruf check (widerrufen_am is null or widerrufen_am >= gueltig_von),
  constraint fsb_genau_ein_traeger check (num_nonnulls(kunde_id, lieferant_id) = 1),
  constraint fsb_umfang_auftrag check ((umfang = 'auftragsbezogen') = (auftrag_id is not null)),
  constraint fsb_kunde_fk foreign key (mandant_id, kunde_id) references kunde (mandant_id, id),
  constraint fsb_auftrag_fk foreign key (mandant_id, auftrag_id) references auftrag (mandant_id, id),
  constraint fsb_mandant_uk unique (mandant_id, id),
  constraint fsb_nummer_uk unique (mandant_id, bescheinigung_nummer),
  constraint fsb_akteur_stimmig check (
    (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent' and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create index fsb_kunde_idx on freistellungsbescheinigung (mandant_id, kunde_id, gueltig_bis desc);

/**
 * Der Satz der Bauabzugsteuer — 15 %, und der steht im GESETZ (§48 Abs. 1
 * EStG), nicht in einer Annahme. Er liegt trotzdem als datierte Einstellung
 * und nicht als Konstante im Code: Sätze sind schon bewegt worden, und eine
 * einkompilierte Zahl bewertete am Tag einer Änderung jede historische
 * Rechnung neu.
 */
insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig) values
  ('finanzen.bauabzugsteuer_satz_bp', '1500'::jsonb,
   'Bauabzugsteuer nach §48 Abs. 1 EStG in Basispunkten (15 %). GESETZT, kein Platzhalter.',
   false);

/**
 * **§13b lässt sich nicht auf einen Kunden anwenden, der keiner ist.**
 *
 * FIN-09 Abnahme (5): „Applying §13b to a non-construction customer is
 * refused." Das ist keine Formsache. Wer die Steuer zu Unrecht verlagert,
 * weist auf dem Beleg keine Umsatzsteuer aus; der Empfänger schuldet sie
 * nicht, der Leistende schuldet sie trotzdem (§13a UStG) und hat sie nicht
 * eingenommen. Der Fehler fällt beim Finanzamt auf, Jahre später, auf einem
 * Beleg, den niemand mehr ändern kann.
 *
 * Der Riegel sitzt in der DATENBANK und nicht nur im Dienst: ein Import, ein
 * Skript oder eine spätere Route ginge sonst daran vorbei. Er prüft am
 * Stichtag, den `estg48/grenzen.platzhalter.ts` benennt — bis O-21 beantwortet
 * ist, `leistung_bis`, ersatzweise das Rechnungsdatum.
 */
create function fin.reverse_charge_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_stichtag date;
begin
  if not new.reverse_charge then
    return new;
  end if;

  if new.reverse_charge_grundlage is null then
    raise exception
      'Reverse Charge ohne Tatbestand: §13b Abs. 2 Nr. 4 (Bauleistung) oder Nr. 8 (Gebaeudereinigung) muss benannt sein.'
      using errcode = 'check_violation';
  end if;

  v_stichtag := coalesce(new.leistung_bis, new.rechnungsdatum, app.berlin_heute());

  if not exists (
    select 1 from public.kunde_bauleistender_status s
     where s.kunde_id = new.kunde_id
       and s.leistungsart = new.reverse_charge_grundlage
       and s.ist_bauleistender
       and s.gilt_ab <= v_stichtag
       and (s.gilt_bis is null or s.gilt_bis >= v_stichtag)
  ) then
    raise exception
      'Fuer diesen Kunden ist am % kein §13b-Status "%" hinterlegt. Die Steuerschuld darf nicht verlagert werden, solange der Nachweis fehlt.',
      v_stichtag, new.reverse_charge_grundlage
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

alter function fin.reverse_charge_pruefen() owner to cse_definer;

create trigger reverse_charge_pruefen
  before insert or update on rechnung
  for each row execute function fin.reverse_charge_pruefen();

/**
 * Und was der Trigger dafür braucht. `rechnung` liest er über `NEW`, also ohne
 * Recht; `kunde_bauleistender_status` muss er lesen dürfen — mit Recht UND
 * Policy, sonst läse er null Zeilen und wiese JEDEN Reverse Charge ab, auch
 * den berechtigten (D-388, die andere Richtung desselben Fehlers).
 */
grant select (kunde_id, leistungsart, ist_bauleistender, gilt_ab, gilt_bis)
  on kunde_bauleistender_status to cse_definer;

create policy d_kbs_13b_lesen on kunde_bauleistender_status for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

/**
 * RLS und Rechte für die Anwendung — das Muster der übrigen Stammdaten dieser
 * Domäne. Beide Tabellen sind Kundenstammdaten: `finanzen.lesen` zum Lesen,
 * `finanzen.schreiben` zum Pflegen.
 *
 * **Der Kunde selbst sieht sie NICHT.** Sein §13b-Status und seine
 * Freistellungsbescheinigung stehen in seinem eigenen Beleg, wo sie hingehören;
 * die Stammdatenzeile daneben ist eine Bewertung DURCH die Gruppe und keine
 * Auskunft, die das Kundenportal geben sollte.
 */
do $$
declare t text;
begin
  foreach t in array array['kunde_bauleistender_status', 'freistellungsbescheinigung'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);

    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')))$p$, t);

    execute format($p$
      create policy p_decke on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);

    execute format('create trigger %I_kein_delete before delete on %I '
                   'for each row execute function kern.verhindere_loeschung()', t, t);
    execute format('create trigger %I_kein_truncate before truncate on %I '
                   'execute function kern.verhindere_loeschung()', t, t);
    execute format('revoke delete, truncate on %I from cse_app, cse_anon, cse_checkin, cse_job', t);
    execute format('grant select, insert, update on %I to cse_app', t);
  end loop;
end $$;
