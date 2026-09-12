/**
 * Der Abzug der Abschläge in einer Schlussrechnung (FIN-08, VOB/B §16, PR 50).
 *
 * **Warum das eine eigene Tabelle ist und keine Zeile in `rechnung_beziehung`.**
 * Die Beziehung Abschlag → Schlussrechnung ist kein reiner Verweis: sie trägt
 * einen BETRAG, und zwar je Steuersatzgruppe. Eine Schlussrechnung weist die
 * Umsatzsteuer nach §14 Abs. 4 Nr. 8 UStG je Satz aus, und die abgezogenen
 * Abschläge müssen in derselben Aufteilung dastehen — sonst stimmt der
 * Zahlbetrag und die Steueraufteilung nicht, und die Voranmeldung zieht aus
 * der falschen. `rechnung_beziehung` in eine Betragstabelle zu verwandeln
 * hiesse, ihre beiden sauberen Arten (`storno`, `ersetzt`) mit einem dritten
 * Fall zu belasten, der ganz andere Spalten braucht.
 *
 * **`wirksam` statt Löschen.** Wird die Schlussrechnung storniert, wird der
 * Abschlag wieder abziehbar — die Zeile bleibt stehen und wird unwirksam
 * (Invariante 8). Ein gelöschter Abzug wäre ein Vorgang, den niemand mehr
 * nachvollziehen kann, auf einem Beleg, der zehn Jahre aufbewahrt wird.
 */
create table abschlagsrechnung_bezug (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  schluss_rechnung_id   uuid not null,
  abschlag_rechnung_id  uuid not null,
  steuersatz_gruppe_id  uuid not null references steuersatz_gruppe(id),

  /**
   * Vorzeichengleich mit der Schlussrechnung (review B9): ein Abzug, der in
   * die andere Richtung zeigt, ist kein Abzug, sondern eine Gutschrift — und
   * die hat einen eigenen Beleg.
   */
  abzug_netto_cent      bigint not null,
  abzug_steuer_cent     bigint not null,

  /**
   * `false`, sobald die Schlussrechnung storniert ist: der Abschlag ist dann
   * wieder abziehbar, und der partielle Eindeutigkeitsindex unten gibt ihn
   * frei.
   */
  wirksam               boolean not null default true,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint arb_nicht_auf_sich_selbst
    check (schluss_rechnung_id <> abschlag_rechnung_id),

  /**
   * Netto und Steuer zeigen in dieselbe Richtung — oder die Steuer ist null
   * (§13b: Reverse Charge weist 0,00 € aus, der Nettoabzug bleibt).
   */
  constraint arb_vorzeichen_stimmig
    check (sign(abzug_netto_cent) = sign(abzug_steuer_cent) or abzug_steuer_cent = 0),

  constraint arb_akteur_stimmig check (
    (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent' and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint arb_schluss_fk
    foreign key (mandant_id, schluss_rechnung_id) references rechnung (mandant_id, id),
  constraint arb_abschlag_fk
    foreign key (mandant_id, abschlag_rechnung_id) references rechnung (mandant_id, id),

  constraint arb_mandant_uk unique (mandant_id, id)
);

create unique index arb_zeile_uk on abschlagsrechnung_bezug
  (schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id);

/**
 * **Ein Abschlag wird von GENAU EINER Schlussrechnung abgerechnet.**
 *
 * Der Index ist partiell auf `wirksam`, und das ist der ganze Mechanismus:
 * solange die Verrechnung steht, kann kein zweiter Beleg denselben Abschlag
 * abziehen — sonst zöge die Gruppe ein Geld zweimal ab, das der Kunde einmal
 * gezahlt hat. Wird die Schlussrechnung storniert, wird die Zeile unwirksam,
 * und derselbe Abschlag ist wieder frei.
 */
create unique index arb_abschlag_einmal_uk on abschlagsrechnung_bezug
  (abschlag_rechnung_id) where wirksam;

create index arb_schluss_idx on abschlagsrechnung_bezug (mandant_id, schluss_rechnung_id);

/**
 * **Der Riegel gegen einen Abzug, der nicht hierher gehört.**
 *
 * Fünf Bedingungen, und jede davon ist ein Fall, der ohne sie erst dem Kunden
 * auffiele: ein Abschlag, der noch ein Entwurf ist (und deshalb keine Nummer
 * hat); eine gewöhnliche Rechnung, die als Abschlag abgezogen wird; ein
 * Abschlag eines FREMDEN Kunden; einer aus einem anderen Auftrag; und ein
 * stornierter, dessen Abzug den Kunden um Geld brächte, das er zurückbekommen
 * hat.
 *
 * Der Trigger steht in der Datenbank und nicht nur im Dienst, weil ein zweiter
 * Schreibweg — ein Import, ein Skript, eine spätere Route — sonst an ihm vorbei
 * ginge.
 */
create function fin.abschlag_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_schluss record;
  v_abschlag record;
begin
  select rechnungsart, status, kunde_id, auftrag_id, mandant_id
    into v_schluss from public.rechnung where id = new.schluss_rechnung_id;
  select rechnungsart, status, kunde_id, auftrag_id, mandant_id, nummer
    into v_abschlag from public.rechnung where id = new.abschlag_rechnung_id;

  if v_schluss is null or v_abschlag is null then
    raise exception 'Abschlagsbezug auf eine Rechnung, die es nicht gibt.'
      using errcode = 'foreign_key_violation';
  end if;

  if v_schluss.rechnungsart <> 'schluss' then
    raise exception 'Abschläge werden nur von einer Schlussrechnung abgezogen (%, nicht schluss).',
      v_schluss.rechnungsart using errcode = 'check_violation';
  end if;

  if v_abschlag.rechnungsart not in ('abschlag', 'anzahlung') then
    raise exception 'Rechnung % ist eine %, kein Abschlag und keine Anzahlung.',
      coalesce(v_abschlag.nummer, '(Entwurf)'), v_abschlag.rechnungsart
      using errcode = 'check_violation';
  end if;

  if v_abschlag.status <> 'festgeschrieben' then
    raise exception 'Ein Abschlag im Zustand „%" hat keine Nummer und kann nicht abgezogen werden.',
      v_abschlag.status using errcode = 'check_violation';
  end if;

  if v_abschlag.kunde_id <> v_schluss.kunde_id then
    raise exception 'Abschlag % gehört einem anderen Kunden.',
      v_abschlag.nummer using errcode = 'check_violation';
  end if;

  if v_abschlag.auftrag_id is distinct from v_schluss.auftrag_id then
    raise exception 'Abschlag % gehört zu einem anderen Auftrag.',
      v_abschlag.nummer using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.rechnung_beziehung b
              where b.zu_rechnung_id = new.abschlag_rechnung_id and b.art = 'storno') then
    raise exception 'Abschlag % ist storniert und kann nicht abgezogen werden.',
      v_abschlag.nummer using errcode = 'check_violation';
  end if;

  /**
   * Das Vorzeichen folgt der SCHLUSSRECHNUNG, nicht dem Abschlag: bei einer
   * negativen Schlussrechnung (die es nur als Storno gibt) zeigt auch der
   * Abzug nach unten. Der CHECK auf der Tabelle hält Netto und Steuer
   * zusammen; hier steht der Bezug zum Kopf.
   */
  return new;
end
$$;

alter function fin.abschlag_pruefen() owner to cse_definer;

create trigger abschlag_pruefen
  before insert or update on abschlagsrechnung_bezug
  for each row execute function fin.abschlag_pruefen();

/**
 * Unveränderlichkeit und Löschsperre — wie bei jeder Finanztabelle
 * (Invariante 8, K-16). `wirksam` bleibt änderbar: das ist der Weg, auf dem
 * ein Abzug zurückgenommen wird, ohne eine Zeile zu verlieren.
 */
create trigger arb_kein_delete
  before delete on abschlagsrechnung_bezug
  for each row execute function kern.verhindere_loeschung();
create trigger arb_kein_truncate
  before truncate on abschlagsrechnung_bezug
  execute function kern.verhindere_loeschung();
revoke delete, truncate on abschlagsrechnung_bezug from cse_app, cse_anon, cse_checkin, cse_job;

alter table abschlagsrechnung_bezug enable row level security;
alter table abschlagsrechnung_bezug force  row level security;

/**
 * Dieselben vier Policies wie die übrigen Kindtabellen der Rechnung — nur
 * läuft der Kundenzweig hier über `schluss_rechnung_id` und nicht über ein
 * `rechnung_id`, das es auf dieser Tabelle nicht gibt.
 *
 * **Der Kundenzweig ist nicht optional** (review B18): ohne ihn zeigte das
 * Kundenportal eine Schlussrechnung mit Positionen und Summen, aber ohne
 * Abzugszeilen — also einen Zahlbetrag, der sich aus dem Sichtbaren nicht
 * nachrechnen lässt. Genau der Bildschirm, nach dem ein Kunde anruft.
 */
create policy t_mandant on abschlagsrechnung_bezug for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on abschlagsrechnung_bezug for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')));

create policy t_kunde on abschlagsrechnung_bezug for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from rechnung r
                      where r.mandant_id = abschlagsrechnung_bezug.mandant_id
                        and r.id = abschlagsrechnung_bezug.schluss_rechnung_id
                        and r.kunde_id = any (app.aktuelle_kunden())
                        and r.status = 'festgeschrieben'));

create policy p_kind_decke on abschlagsrechnung_bezug as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and exists (select 1 from rechnung r
                          where r.mandant_id = abschlagsrechnung_bezug.mandant_id
                            and r.id = abschlagsrechnung_bezug.schluss_rechnung_id
                            and r.kunde_id = any (app.aktuelle_kunden())
                            and r.status = 'festgeschrieben')))
  with check (app.portal() = 'intern');

grant select, insert, update on abschlagsrechnung_bezug to cse_app;

/**
 * **Und was der Trigger dafür braucht — nicht mehr.**
 *
 * `fin.abschlag_pruefen` läuft als `cse_definer` und liest zwei Tabellen.
 *
 * Auf `rechnung` steht beides schon: `0104` hat `cse_definer` die Spalten
 * gegeben und `d_rechnung_lesen` auf `mandant_id = app.aktiver_mandant()`
 * gesetzt. **Hier NICHTS dazuzugeben ist die Entscheidung**, nicht das
 * Vergessene: eine zweite permissive SELECT-Policy mit `using (true)` würde
 * sich mit der vorhandenen ODER-verknüpfen und den Mandantenschnitt der
 * bestehenden aufheben — jede Definer-Funktion läse dann jede Rechnung jeder
 * Gesellschaft. Eine Verbreiterung, die wie eine Ergänzung aussieht.
 *
 * Auf `rechnung_beziehung` fehlt beides, also kommt beides — und die Policy
 * trägt denselben Schnitt wie die auf `rechnung`. Ohne Recht UND Policy läse
 * die Funktion null Zeilen und liesse jeden Abzug eines stornierten Abschlags
 * durch: ein Riegel, der aussieht wie einer und keiner ist (D-388).
 */
grant select (mandant_id, zu_rechnung_id, art) on rechnung_beziehung to cse_definer;

create policy d_beziehung_storno_lesen on rechnung_beziehung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
