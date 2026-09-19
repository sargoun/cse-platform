-- 0174 — die Antwort an eine Bewerberin (REC-03, REC-08, AGG §22, §12).
--
-- ===========================================================================
-- Was diese Tabelle ist, und was sie ABSICHTLICH nicht ist
-- ===========================================================================
--
-- Sie hält den ENTWURF einer Antwort und den Beleg, dass er hinausging. Sie
-- ist kein Postausgang: gesendet wird über `server/versand/email.ts`, und der
-- ist heute nicht verbunden (O-501). Eine Zeile mit `gesendet_am` entsteht
-- deshalb erst, wenn wirklich jemand etwas verschickt hat — nie „schon mal
-- vorsorglich".
--
-- **Warum eine Antwort an eine Bewerberin NICHT durch das UWG-Tor muss.**
-- §7 UWG regelt Werbung. Eine Bewerbung ist eine Kontaktaufnahme DURCH die
-- betroffene Person; die Antwort darauf ist vorvertragliche Kommunikation
-- (Art. 6 Abs. 1 lit. b DSGVO). Sie durch `app.darf_kontaktiert_werden` zu
-- schicken hiesse, eine Absage zu blockieren, weil kein Werbeeinverständnis
-- vorliegt — und eine unbeantwortete Bewerbung ist kein Datenschutz, sondern
-- Unhöflichkeit mit AGG-Risiko.
--
-- ===========================================================================
-- Der AGG-Riegel: eine Absage nennt KEINEN Grund
-- ===========================================================================
--
-- Das ist die wichtigste Zeile dieser Datei. § 22 AGG kehrt die Beweislast um:
-- wer Indizien für eine Benachteiligung vorträgt, zwingt den Arbeitgeber zum
-- Gegenbeweis. Jede Begründung in einem Absageschreiben ist ein solches Indiz
-- in spe — „wir suchen jemanden mit mehr Berufserfahrung" ist in der Hand
-- eines Anwalts ein Altersindiz, „das Team passt besser zu …" eines für alles
-- Übrige. Deutsche Personalpraxis schreibt Absagen deshalb ohne Grund, und das
-- ist kein Ausweichen: die Begründung wird SEHR WOHL festgehalten, nur eben
-- intern in `einstellungsentscheidung.begruendung`, wo sie im Streitfall den
-- sachlichen Grund belegt.
--
-- Die Tabelle hat deshalb keine Spalte für einen Absagegrund, und der Auslöser
-- unten weist einen Text ab, der die interne Begründung enthält.

create type bewerbung_antwort_art as enum (
  -- Der Eingang. Keine Wertung, keine Zusage — nur: „ist angekommen".
  'eingangsbestaetigung',
  -- Die Einladung zum Gespräch.
  'einladung',
  -- Die Absage. OHNE Grund (§ 22 AGG, siehe oben).
  'absage',
  -- Eine Rückfrage, weil Unterlagen fehlen.
  'rueckfrage');

create type bewerbung_antwort_stand as enum (
  'entwurf', 'wartet_auf_freigabe', 'freigegeben', 'gesendet', 'verworfen');

create table bewerbung_antwort (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bewerbung_id  uuid not null,
  art           bewerbung_antwort_art not null,
  stand         bewerbung_antwort_stand not null default 'entwurf',

  betreff       text not null check (btrim(betreff) <> ''),
  text          text not null check (btrim(text) <> ''),

  /**
   * Wer den Entwurf gemacht hat: ein Mensch oder der Agent. Beide dürfen
   * entwerfen — und keiner von beiden darf senden, ohne dass ein Mensch
   * freigegeben hat (Invariante 7).
   */
  entworfen_von akteur_art not null default 'mensch',
  entworfen_durch uuid references benutzer(id),

  freigabe_id   uuid references freigabe(id),
  freigegeben_am timestamptz,
  freigegeben_von uuid references benutzer(id),

  /**
   * NULL, solange nichts hinausging — und das ist heute IMMER NULL, weil kein
   * Postausgang verbunden ist (O-501). Eine Zeile, die Versand behauptet, den
   * es nicht gab, ist schlimmer als eine offene Aufgabe.
   */
  gesendet_am   timestamptz,
  gesendet_an   text,
  versand_fehler text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint bewerbung_antwort_mandant_uk unique (mandant_id, id),
  constraint bewerbung_antwort_bewerbung_fk
    foreign key (mandant_id, bewerbung_id) references bewerbung (mandant_id, id),

  /**
   * Gesendet heisst: freigegeben, an eine Adresse, mit Zeitpunkt. Alle drei
   * oder keines. Ein `gesendet_am` ohne `freigegeben_von` wäre genau die
   * Zeile, die Invariante 7 unmöglich machen soll.
   */
  constraint bewerbung_antwort_versand_belegt check (
    gesendet_am is null
    or (freigegeben_von is not null and btrim(coalesce(gesendet_an, '')) <> '')),

  constraint bewerbung_antwort_stand_stimmig check (
    (stand <> 'gesendet' or gesendet_am is not null)
    and (stand <> 'freigegeben' or freigegeben_am is not null))
);

comment on table bewerbung_antwort is
  'REC-03 / § 22 AGG. Der Entwurf einer Antwort an eine Bewerberin. Eine Absage '
  'traegt KEINEN Grund — die Begruendung steht intern in '
  'einstellungsentscheidung, wo sie hingehoert.';

comment on column bewerbung_antwort.gesendet_am is
  'NULL, solange kein Postausgang verbunden ist (O-501). Nie vorsorglich gesetzt.';

/**
 * Eine Antwort je Art und Bewerbung.
 *
 * Zwei Absagen an dieselbe Person sind kein Versehen, das man hinnimmt — sie
 * sind der Fall, den ein Bewerber weitererzaehlt. Der Index laesst eine
 * Eingangsbestaetigung UND eine Absage zu (verschiedene Arten), aber nicht
 * zwei Absagen; ein verworfener Entwurf zaehlt nicht mit.
 */
create unique index bewerbung_antwort_je_art_uk
  on bewerbung_antwort (mandant_id, bewerbung_id, art)
  where stand <> 'verworfen';

create index bewerbung_antwort_offen_idx
  on bewerbung_antwort (mandant_id, stand)
  where stand in ('entwurf', 'wartet_auf_freigabe', 'freigegeben');

-- ---------------------------------------------------------------------------
-- Der AGG-Riegel
-- ---------------------------------------------------------------------------

/**
 * Eine Absage, die die INTERNE Begruendung enthaelt, wird abgewiesen.
 *
 * **Warum ein Ausloeser und nicht eine Ermahnung im Handbuch.** Der Text einer
 * Absage entsteht aus einer Vorlage, und die Vorlage nennt keinen Grund. Der
 * gefaehrliche Weg ist der andere: jemand bearbeitet den Entwurf im Browser
 * und fuegt „ein" — aus Hoeflichkeit, weil eine Absage ohne Grund unpersoenlich
 * wirkt. Genau diese Hoeflichkeit ist im AGG-Streit das Indiz.
 *
 * Geprueft wird gegen die tatsaechlich gespeicherte Begruendung dieser
 * Bewerbung, nicht gegen eine Wortliste: eine Wortliste verbietet Woerter, und
 * die Begruendung kann jedes Wort enthalten. Uebernommen ist uebernommen.
 *
 * Die Grenze von 30 Zeichen ist bewusst: kuerzere Uebereinstimmungen sind
 * Zufall („wir haben uns entschieden"), laengere sind Uebernahme.
 */
create function kern.absage_ohne_grund() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare
  v_grund text;
  v_stueck text;
  i integer;
begin
  if new.art <> 'absage' then return new; end if;

  select e.begruendung into v_grund
    from public.einstellungsentscheidung e
   where e.bewerbung_id = new.bewerbung_id
     and e.mandant_id = new.mandant_id
   limit 1;

  if v_grund is null or length(btrim(v_grund)) < 30 then return new; end if;

  /*
   * Jedes 30-Zeichen-Fenster der Begruendung gegen den Antworttext. Ein
   * einfaches `position(v_grund in new.text)` faende nur die woertliche
   * Vollkopie — und wer kopiert, kuerzt meist.
   */
  for i in 1 .. greatest(length(v_grund) - 29, 1) loop
    v_stueck := substr(v_grund, i, 30);
    if position(v_stueck in new.text) > 0 then
      raise exception
        'Eine Absage traegt keinen Grund (§ 22 AGG). Der Text enthaelt die interne '
        'Begruendung ab Zeichen %: "%"', i, v_stueck
        using errcode = 'check_violation',
              hint = 'Die Begruendung bleibt in einstellungsentscheidung. Nach aussen '
                     'geht ein neutraler Satz.';
    end if;
  end loop;
  return new;
end $$;

comment on function kern.absage_ohne_grund() is
  '§ 22 AGG kehrt die Beweislast um: jede Begruendung in einem Absageschreiben ist '
  'ein Indiz in spe. Der Riegel weist eine uebernommene interne Begruendung ab.';

create trigger trg_bewerbung_antwort_agg
  before insert or update of text, art on bewerbung_antwort
  for each row execute function kern.absage_ohne_grund();

create trigger trg_bewerbung_antwort_geaendert
  before update on bewerbung_antwort
  for each row execute function kern.setze_geaendert_am();

/**
 * **Diese Zeile WIRD geloescht — als einzige Ausnahme von Invariante 8.**
 *
 * Der Antworttext traegt den Namen der Bewerberin („Sehr geehrte Frau …"). Er
 * ist damit ein Bewerberdatum wie jedes andere und faellt unter die
 * Loeschfrist aus REC-07. Bliebe er stehen, waere die Bewerbung geloescht und
 * die Anrede nicht — ein Rest, der genau den Namen traegt, um dessentwillen
 * geloescht wurde.
 *
 * **Und deshalb steht der Fremdschluessel OHNE Kaskade.** Eine Kaskade
 * loeschte still mit; der Loeschlauf `jobs/bewerberLoeschung.ts` benennt jede
 * abhaengige Zeile einzeln und protokolliert sie. Ein Loeschlauf, der seine
 * Zeilen nennt, laesst sich pruefen — und LEG-11 verlangt genau diesen
 * Nachweis. `delete` hat deshalb `cse_job`, nicht `cse_app`.
 */

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table bewerbung_antwort enable row level security;
alter table bewerbung_antwort force  row level security;

create policy t_bewerbung_antwort_lesen on bewerbung_antwort for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

/**
 * Entwerfen darf, wer Bewerbungen bewerten darf. SENDEN darf, wer entscheidet
 * — und das steht nicht hier, sondern an der Freigabe: `erforderliches_recht`
 * traegt `recruiting.entscheiden`, und der Posteingang laesst niemanden
 * anderen entscheiden.
 */
create policy t_bewerbung_antwort_schreiben on bewerbung_antwort for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('recruiting.bewerbung_bewerten',
                                        app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('recruiting.bewerbung_bewerten',
                                        app.aktiver_mandant())));

-- Der Loeschlauf (REC-07) und der Versandlauf laufen als `cse_job`.
create policy j_bewerbung_antwort on bewerbung_antwort for all to cse_job
  using (true) with check (true);

grant select, insert, update on bewerbung_antwort to cse_app;
grant select, insert, update, delete on bewerbung_antwort to cse_job;

-- ---------------------------------------------------------------------------
-- Der Nachzug: was geschieht, wenn ein Mensch entscheidet
-- ---------------------------------------------------------------------------

/**
 * Genau das Muster von `app.stelle_folgt_freigabe` (0167), und aus demselben
 * Grund: eine ABLEHNUNG sieht kein Ausfuehrer. Der Ausfuehrer laeuft nur auf
 * `genehmigt`; wer den Stand nur dort nachzoege, liesse einen abgelehnten
 * Entwurf auf ewig `wartet_auf_freigabe` stehen — und der naechste Versuch
 * scheiterte am eindeutigen Index, weil dort schon eine Antwort dieser Art
 * haengt, die niemand mehr entscheiden wird.
 *
 * **`freigegeben` heisst NICHT `gesendet`.** Der Nachzug setzt den Stand und
 * den Menschen, der entschieden hat — und dort bleibt die Zeile stehen, bis
 * wirklich jemand etwas verschickt. Heute ist kein Postausgang verbunden
 * (O-501), also bleibt sie stehen. Eine Zeile, die Versand behauptet, den es
 * nicht gab, waere die vorgetaeuschte Integration, die CLAUDE.md verbietet.
 */
create function app.antwort_folgt_freigabe() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status = old.status then return new; end if;

  if new.status = 'genehmigt' then
    update public.bewerbung_antwort
       set stand = 'freigegeben',
           freigegeben_am = now(),
           freigegeben_von = new.freigegeben_von
     where freigabe_id = new.id and stand = 'wartet_auf_freigabe';
  elsif new.status in ('abgelehnt', 'zurueckgezogen') then
    /*
     * Zurueck in den Entwurf UND die Kennung loesen — dieselbe Begruendung wie
     * bei der Stelle: eine abgelehnte Freigabe am Entwurf haengen zu lassen
     * hiesse, dass der naechste Versuch aussieht, als laege schon eine
     * Entscheidung vor.
     */
    update public.bewerbung_antwort
       set stand = 'entwurf', freigabe_id = null
     where freigabe_id = new.id and stand = 'wartet_auf_freigabe';
  end if;

  return new;
end;
$$;

comment on function app.antwort_folgt_freigabe() is
  'REC-03, Invariante 7. Zieht den Antwortentwurf nach — auch bei einer ABLEHNUNG, '
  'die kein Ausfuehrer je sieht. `freigegeben` heisst nicht `gesendet`.';

alter function app.antwort_folgt_freigabe() owner to cse_definer;
revoke all on function app.antwort_folgt_freigabe() from public;

/**
 * Zuteilung UND Policy: `cse_definer` steht unter FORCE RLS und saehe ohne
 * eigene Policy null Zeilen — schweigend. Derselbe Fehler hat in 0162 einen
 * Browserlauf gekostet.
 */
grant select, update on public.bewerbung_antwort to cse_definer;
create policy d_antwort_folgt on bewerbung_antwort for select to cse_definer using (true);
create policy d_antwort_nachzug on bewerbung_antwort as permissive for update
  to cse_definer using (true) with check (true);

create trigger freigabe_zieht_antwort_nach
  after update of status on freigabe
  for each row execute function app.antwort_folgt_freigabe();
