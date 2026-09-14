-- ===========================================================================
-- 0130 — Sechs Befunde aus der Durchsicht von PR #9
-- ===========================================================================
--
-- Alle sechs haben dieselbe Form: eine Pruefung, die es GIBT, greift eine
-- Stelle zu kurz. Nichts davon faellt im Betrieb sofort auf — genau deshalb
-- steht es hier und nicht auf einer Liste.
--
--  (1) `app.zugang_code_anfordern` zaehlt offene Codes ohne die Zeile zu
--      sperren: zwei gleichzeitige Anfragen sehen beide zwei und schreiben
--      beide — der SMS-Deckel aus O-82 ist damit keiner.
--  (2) `kunde_bauleistender_status.dokument_id` und
--      `freistellungsbescheinigung.dokument_id` zeigen auf `dokument(id)`
--      ohne Mandanten: ein §13b-Nachweis liesse sich aus einer FREMDEN
--      Gesellschaft anhaengen.
--  (3) `freistellungsbescheinigung.lieferant_id` traegt seit 0123 einen
--      Elterntisch, aber immer noch keinen Fremdschluessel.
--  (4) `fin.op_fortschreiben` prueft die RICHTUNG der Zahlung nicht gegen die
--      ART des Postens: ein Geldeingang konnte eine Verbindlichkeit tilgen.
--  (5) `fin.op_ausgleich_fortschreiben` prueft die Gegenpartei nur beim
--      Storno-Ausgleich — der offene Weg verrechnete zwei beliebige Posten.
--  (6) `app.freigabe_genehmigt` prueft die AKTION nicht: eine genehmigte
--      Freigabe fuer etwas anderes oeffnete beide Zustandsuebergaenge.

-- ---------------------------------------------------------------------------
-- (1) Der SMS-Deckel haelt nur mit Sperre (0114, O-82)
-- ---------------------------------------------------------------------------

/**
 * Dieselbe Funktion wie in 0114, mit EINER Aenderung: `for update` auf der
 * Zugangszeile, bevor gezaehlt wird.
 *
 * Der Zaehler liest `mitarbeiter_einmalcode`, die Sperre haelt
 * `mitarbeiter_zugang` — das ist Absicht und kein Vertun: die Codezeilen
 * entstehen erst, die Zugangszeile gibt es schon. Sie ist der natuerliche
 * Serialisierungspunkt je Telefonnummer, und genau je Telefonnummer gilt der
 * Deckel. Zwei gleichzeitige Anfragen fuer DIESELBE Nummer laufen damit
 * nacheinander; zwei fuer verschiedene Nummern stoeren sich nicht.
 *
 * `app.zugang_code_einloesen` (0114) macht es seit jeher so und sagt auch
 * warum — hier fehlte es, und es fehlte an der Stelle, an der es Geld kostet.
 */
create or replace function app.zugang_code_anfordern(
  p_telefon_e164 text,
  p_code_hash    text,
  p_gueltig_bis  timestamptz,
  p_ip           inet default null
) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_zugang uuid;
  v_offen  integer;
begin
  select z.id into v_zugang
    from public.mitarbeiter_zugang z
   where z.telefon_e164 = p_telefon_e164
     and z.gesperrt_am is null
     for update;

  if v_zugang is null then
    return false;
  end if;

  select count(*) into v_offen
    from public.mitarbeiter_einmalcode c
   where c.zugang_id = v_zugang
     and c.verbraucht_am is null
     and c.gueltig_bis > now();

  if v_offen >= 3 then
    return false;
  end if;

  insert into public.mitarbeiter_einmalcode (zugang_id, code_hash, gueltig_bis, ip)
  values (v_zugang, p_code_hash, p_gueltig_bis, p_ip);

  return true;
end
$$;

/** `create or replace` behaelt Eigentuemer und Rechte — hier nur zur Sicherheit. */
alter function app.zugang_code_anfordern(text, text, timestamptz, inet) owner to cse_definer;

-- ---------------------------------------------------------------------------
-- (2)+(3) Ein Nachweis gehoert der Gesellschaft, die ihn fuehrt (K-02)
-- ---------------------------------------------------------------------------

/**
 * **Warum ein einspaltiger Fremdschluessel hier zu wenig ist.**
 *
 * `references dokument(id)` sagt nur: es gibt diese Zeile irgendwo. Die
 * Gesellschaft, der sie gehoert, steht daneben und wird nicht verglichen. Auf
 * einer Beweiszeile fuer §13b UStG oder §48b EStG ist das kein Schoenheits-
 * fehler: der Nachweis, mit dem eine Gesellschaft ihre Steuerbefreiung
 * belegt, koennte aus einer anderen stammen — und im Zweifel steht ihn
 * niemand mehr, weil der Kunde dort ein anderer ist.
 *
 * Der zusammengesetzte Schluessel ist in diesem Baum die Regel (`beleg`,
 * `eingangsrechnung`, `agent_kosten`); diese beiden Tabellen sind aelter als
 * die Regel und haben sie nicht mitbekommen.
 */
alter table kunde_bauleistender_status
  drop constraint if exists kunde_bauleistender_status_dokument_id_fkey,
  add constraint kbs_dokument_fk
    foreign key (mandant_id, dokument_id) references dokument (mandant_id, id);

alter table freistellungsbescheinigung
  drop constraint if exists freistellungsbescheinigung_dokument_id_fkey,
  add constraint fb_dokument_fk
    foreign key (mandant_id, dokument_id) references dokument (mandant_id, id);

/**
 * Und der Lieferant, auf den 0118 ausdruecklich gewartet hat: „PR 54 setzt
 * den Schluessel, statt die Tabelle umzubauen". 0123 hat `lieferant`
 * angelegt und den Schluessel nicht gesetzt — die Zeile im Kommentar blieb
 * eine Absicht.
 */
alter table freistellungsbescheinigung
  add constraint fb_lieferant_fk
    foreign key (mandant_id, lieferant_id) references lieferant (mandant_id, id);

-- ---------------------------------------------------------------------------
-- (4) Eine Zahlung tilgt nur, was in ihrer Richtung liegt (0121, ACC-07)
-- ---------------------------------------------------------------------------

/**
 * **Der Befund:** `fin.op_fortschreiben` sperrt die Zahlung und prueft, ob
 * sie storniert ist — aber nie, ob ihre RICHTUNG zur ART des Postens passt.
 * Ein Geldeingang konnte damit eine Verbindlichkeit gegenueber einem
 * Lieferanten tilgen, und ein Ausgang eine Forderung an einen Kunden. Beides
 * ergibt eine Bilanz, die auf beiden Seiten falsch ist, und beides sieht auf
 * dem Bildschirm aus wie ein bezahlter Posten.
 *
 * **Die Zuordnung, und warum sie keine Erfindung ist.** Sie folgt daraus, wer
 * wem schuldet — nicht aus einer Auslegung:
 *
 * | Posten              | tilgt ein …          | weil                          |
 * |---------------------|----------------------|-------------------------------|
 * | `debitor`           | `eingang`            | der Kunde zahlt UNS           |
 * | `kreditor`          | `ausgang`            | wir zahlen den Lieferanten    |
 * | `debitor_guthaben`  | `ausgang`            | wir zahlen dem Kunden zurueck |
 * | `kreditor_guthaben` | `eingang`            | der Lieferant erstattet uns   |
 *
 * Fuer die Zuordnungsart `ueberzahlung` ist es umgekehrt: dort ENTSTEHT das
 * Guthaben, es wird nicht getilgt. Der Kunde ueberweist zuviel (`eingang` auf
 * `debitor_guthaben`), oder wir ueberweisen zuviel (`ausgang` auf
 * `kreditor_guthaben`).
 *
 * Zuordnungen OHNE Zahlung (`skonto`, `bauabzugsteuer_einbehalt`) beruehrt
 * die Pruefung nicht — sie bewegen kein Geld und haben keine Richtung.
 */
create function fin.zahlung_richtung_passt(
  p_richtung zahlung_richtung, p_op_art offener_posten_art,
  p_zuordnung_art zahlung_zuordnung_art
) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select case
    when p_zuordnung_art = 'ueberzahlung' then
      case p_op_art
        when 'debitor_guthaben'  then p_richtung = 'eingang'
        when 'kreditor_guthaben' then p_richtung = 'ausgang'
        else false
      end
    else
      case p_op_art
        when 'debitor'           then p_richtung = 'eingang'
        when 'kreditor'          then p_richtung = 'ausgang'
        when 'debitor_guthaben'  then p_richtung = 'ausgang'
        when 'kreditor_guthaben' then p_richtung = 'eingang'
      end
  end
$$;

comment on function fin.zahlung_richtung_passt(
  zahlung_richtung, offener_posten_art, zahlung_zuordnung_art) is
  'ACC-07: darf eine Zahlung dieser Richtung diesen Posten beruehren? '
  'Ein Eingang tilgt keine Verbindlichkeit, ein Ausgang keine Forderung.';

/**
 * Die Pruefung haengt als EIGENER Ausloeser vor dem Fortschreiben, nicht in
 * ihm: `fin.op_fortschreiben` ist ein `after insert`, dieser hier ein
 * `before insert`. Er weist also ab, bevor irgendetwas fortgeschrieben wird —
 * und er laesst die vorhandene, gepruefte Funktion unangetastet, statt
 * hundert Zeilen umzuschreiben, um drei einzufuegen.
 */
create function fin.zuordnung_richtung_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_op_art  offener_posten_art;
  v_richtung zahlung_richtung;
begin
  -- Ohne Zahlung keine Richtung: skonto und bauabzugsteuer_einbehalt bewegen
  -- kein Geld (0121, Kommentar zu zahlung_zuordnung_art).
  if new.zahlung_id is null then return new; end if;

  select art into v_op_art from public.offener_posten
   where id = new.offener_posten_id and mandant_id = new.mandant_id;
  if not found then return new; end if;   -- Das meldet fin.op_fortschreiben.

  select richtung into v_richtung from public.zahlung
   where id = new.zahlung_id and mandant_id = new.mandant_id;
  if not found then return new; end if;   -- Ebenso.

  if not fin.zahlung_richtung_passt(v_richtung, v_op_art, new.art) then
    raise exception
      'Eine Zahlung der Richtung % gehoert nicht auf einen Posten der Art % (Zuordnung %).',
      v_richtung, v_op_art, new.art
      using errcode = 'check_violation',
            hint = 'Ein Eingang tilgt keine Verbindlichkeit, ein Ausgang keine Forderung.';
  end if;
  return new;
end $$;

alter function fin.zuordnung_richtung_pruefen() owner to cse_definer;
revoke all on function fin.zuordnung_richtung_pruefen() from public;

create trigger zuordnung_richtung_pruefen
  before insert on zahlung_zuordnung
  for each row execute function fin.zuordnung_richtung_pruefen();

/** Was der Pruefer dafuer liest — zwei Spalten, sonst nichts (K-05, D-388). */
grant select (id, mandant_id, art) on offener_posten to cse_definer;
grant select (id, mandant_id, richtung) on zahlung to cse_definer;

-- ---------------------------------------------------------------------------
-- (5) Verrechnet wird zwischen Posten DERSELBEN Gegenpartei (0121, §387 BGB)
-- ---------------------------------------------------------------------------

/**
 * **Der Befund:** die Gegenparteipruefung in `fin.op_ausgleich_fortschreiben`
 * steht unter `if new.rechnung_beziehung_id is not null` — sie gilt also nur
 * fuer den Storno-Ausgleich. Der offene Weg (`gleicheAus` ohne Bezug) konnte
 * zwei beliebige Posten gegeneinander stellen: die Gutschrift des einen
 * Kunden gegen die Forderung eines anderen, oder eine Forderung gegen eine
 * Verbindlichkeit.
 *
 * **Was diese Migration daraus macht, und was sie NICHT entscheidet.** Sie
 * verlangt zweierlei fuer JEDEN Ausgleich:
 *
 *   * dieselbe Gegenpartei — derselbe Kunde oder derselbe Lieferant;
 *   * dieselbe SEITE — Debitorisches gegen Debitorisches, Kreditorisches
 *     gegen Kreditorisches.
 *
 * Die Verrechnung ueber die Seiten hinweg (ein Kunde, der zugleich Lieferant
 * ist) ist genau der Fall, den §387 BGB regelt und den O-182 offen laesst.
 * Sie bleibt deshalb ABGEWIESEN, mit einer Meldung, die O-182 nennt — nicht
 * still erlaubt. Eine Regel, die noch niemand entschieden hat, wird hier
 * nicht erfunden (CLAUDE.md).
 */
create function fin.ausgleich_gegenpartei_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_soll  record;
  v_haben record;
begin
  select art, kunde_id, lieferant_id into v_soll from public.offener_posten
   where id = new.op_soll_id and mandant_id = new.mandant_id;
  select art, kunde_id, lieferant_id into v_haben from public.offener_posten
   where id = new.op_haben_id and mandant_id = new.mandant_id;
  -- Nicht erreichbar meldet fin.op_ausgleich_fortschreiben.
  if v_soll is null or v_haben is null then return new; end if;

  if (v_soll.art in ('debitor', 'debitor_guthaben'))
     <> (v_haben.art in ('debitor', 'debitor_guthaben')) then
    raise exception
      'Ein Ausgleich laeuft zwischen zwei debitorischen oder zwei kreditorischen Posten.'
      using errcode = 'check_violation',
            hint = 'Die Aufrechnung ueber die Seiten hinweg (§387 BGB) ist offen: O-182.';
  end if;

  if v_soll.kunde_id is distinct from v_haben.kunde_id
     or v_soll.lieferant_id is distinct from v_haben.lieferant_id then
    raise exception 'Ein Ausgleich laeuft zwischen Posten DERSELBEN Gegenpartei.'
      using errcode = 'check_violation',
            hint = 'Fremde Forderung gegen eigene Gutschrift ist §387 BGB: O-182.';
  end if;
  return new;
end $$;

alter function fin.ausgleich_gegenpartei_pruefen() owner to cse_definer;
revoke all on function fin.ausgleich_gegenpartei_pruefen() from public;

create trigger ausgleich_gegenpartei_pruefen
  before insert on op_ausgleich
  for each row execute function fin.ausgleich_gegenpartei_pruefen();

/** Zwei weitere Spalten fuer denselben Definer. */
grant select (kunde_id, lieferant_id) on offener_posten to cse_definer;

-- ---------------------------------------------------------------------------
-- (6) Eine Freigabe gilt fuer IHRE Aktion (0123, 0125, K-13)
-- ---------------------------------------------------------------------------

/**
 * **Der Befund:** `app.freigabe_genehmigt(id, mandant)` fragt nur nach
 * Mandant und Status. Beide Aufrufer — das Kreditorentor (0123) und das
 * Mahntor (0125) — pruefen damit dasselbe, obwohl sie verschiedene Dinge
 * freigeben lassen. Wer eine genehmigte Freigabe fuer `mahnung_senden` in der
 * Hand hat, konnte damit eine Eingangsrechnung buchen: eine Zustimmung zu
 * einem Brief oeffnete eine Zahlungsverpflichtung.
 *
 * Die neue Fassung nimmt die erwartete Aktion mit. Die alte zweiargumentige
 * Form wird ENTFERNT und nicht danebengelassen: eine Ueberladung, die die
 * Aktion nicht prueft, ist genau die, die beim naechsten Mal wieder gerufen
 * wird.
 */
create function app.freigabe_genehmigt(p_freigabe uuid, p_mandant uuid, p_aktion text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select exists (
    select 1 from public.freigabe f
     where f.id = p_freigabe and f.mandant_id = p_mandant
       and f.status = 'genehmigt' and f.aktion = p_aktion);
$$;

comment on function app.freigabe_genehmigt(uuid, uuid, text) is
  'K-13: liegt zu dieser Kennung in diesem Mandanten eine genehmigte Freigabe '
  'FUER DIESE AKTION vor? Strukturell, ja/nein — gerufen von den '
  'Zustandsausloesern (0123, 0125).';

alter function app.freigabe_genehmigt(uuid, uuid, text) owner to cse_definer;
revoke execute on function app.freigabe_genehmigt(uuid, uuid, text) from public;
grant  execute on function app.freigabe_genehmigt(uuid, uuid, text) to cse_app, cse_definer;

/** Die Aktion muss der Definer auch lesen duerfen — 0123 gab ihm drei Spalten. */
grant select (aktion) on freigabe to cse_definer;


-- Und die beiden Aufrufer — dieselben Funktionen wie in 0123 und 0125, mit
-- der einen Zeile, die die Aktion mitgibt. `create or replace` behaelt
-- Eigentuemer, Rechte und die haengenden Ausloeser.
create or replace function fin.eingangsrechnung_uebergang() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'gebucht' then
    raise exception 'Eine gebuchte Eingangsrechnung wird nicht mehr umgestellt — korrigiert wird durch Gegenbuchung.'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'abgelehnt' then
    raise exception 'Eine abgelehnte Eingangsrechnung wird neu erfasst, nicht wiederbelebt.'
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'abgelehnt' then
    if old.status not in ('eingegangen', 'in_pruefung') then
      raise exception 'Ablehnen geht nur vor der Freigabe (Zustand %).', old.status
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.status = 'eingegangen' and new.status = 'in_pruefung' then
    if new.lieferant_id is null then
      raise exception 'Ohne Lieferant laesst sich nichts pruefen.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'in_pruefung' and new.status = 'freigegeben' then
    if new.freigabe_id is null then
      raise exception 'Eine Freigabe ohne Freigabesatz gibt es nicht (K-13, Invariante 7).'
        using errcode = 'check_violation';
    end if;
    /*
     * `genehmigt` — so heisst der Wert in `freigabe_status` (0012). Der erste
     * Entwurf verglich mit `freigegeben`, und Postgres wies das als
     * ungueltigen Enumwert ab: JEDE Freigabe waere gescheitert. Ein Test hat
     * es beim ersten Lauf gezeigt; im Betrieb waere es der Bildschirm
     * gewesen, an dem die Buchhaltung haengen bleibt.
     */
    if not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id, 'eingangsrechnung_buchen') then
      raise exception 'Es liegt keine genehmigte Freigabe fuer eingangsrechnung_buchen vor (K-13).'
        using errcode = 'check_violation';
    end if;
    new.freigegeben_am := coalesce(new.freigegeben_am, now());
    new.freigegeben_von := coalesce(new.freigegeben_von, app.aktueller_benutzer());
    return new;
  end if;

  /** Ruecknahme vor dem Buchen — protokolliert, weil sie eine Entscheidung aufhebt. */
  if old.status = 'freigegeben' and new.status = 'in_pruefung' then
    perform app.protokolliere('eingangsrechnung.freigabe_zurueckgenommen',
                              'eingangsrechnung', new.id::text,
                              jsonb_build_object('freigabe_id', old.freigabe_id), null,
                              new.mandant_id);
    new.freigabe_id := null;
    new.freigegeben_am := null;
    new.freigegeben_von := null;
    return new;
  end if;

  if old.status = 'freigegeben' and new.status = 'gebucht' then
    return new;   -- Die Nummer zieht fin.eingangsrechnung_buchen (danach).
  end if;

  raise exception 'Der Uebergang % → % ist nicht vorgesehen.', old.status, new.status
    using errcode = 'restrict_violation';
end $$;

create or replace function fin.mahnung_uebergang() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_kreis  record;
  v_nummer bigint;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('versendet', 'erledigt', 'verworfen') then
    raise exception 'Eine Mahnung im Zustand „%" wird nicht mehr umgestellt.', old.status
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'verworfen' then
    if old.status <> 'entwurf' then
      raise exception
        'Nur ein Entwurf wird verworfen — eine freigegebene Mahnung traegt eine Nummer.'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.status = 'entwurf' and new.status = 'freigegeben' then
    if new.freigabe_id is null then
      raise exception 'Eine Freigabe ohne Freigabesatz gibt es nicht (K-13, Invariante 7).'
        using errcode = 'check_violation';
    end if;
    /*
     * Ueber `app.freigabe_genehmigt` (0123) und nicht mit einem eigenen
     * `select`: die Antwort haengt sonst am Recht `versand.lesen` des
     * Freigebenden, und wem es fehlt, dem sagt die Datenbank „steht nicht
     * auf genehmigt" ueber eine Zeile, die genehmigt ist.
     */
    if not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id, 'mahnung_senden') then
      raise exception 'Es liegt keine genehmigte Freigabe fuer mahnung_senden vor (K-13).'
        using errcode = 'check_violation';
    end if;

    select nk.* into v_kreis
      from public.nummernkreis nk
     where nk.mandant_id = new.mandant_id and nk.kreis_typ = 'mahnung'
       and nk.kontext_id is null and nk.geschlossen_am is null
       for update;
    if not found then
      raise exception 'Fuer diese Gesellschaft ist kein Kreis `mahnung` offen.'
        using errcode = 'restrict_violation';
    end if;
    if v_kreis.ist_platzhalter then
      raise exception 'Nummernkreis %: unbestaetigt — er vergibt keine Nummer.',
        v_kreis.bezeichnung using errcode = 'restrict_violation';
    end if;

    v_nummer := v_kreis.naechste_nummer;
    update public.nummernkreis set naechste_nummer = naechste_nummer + 1
     where id = v_kreis.id;

    new.nummernkreis_id  := v_kreis.id;
    new.nummer           := fin.nummer_formatieren(v_kreis.format_maske, v_nummer, v_kreis.jahr);
    new.freigegeben_am   := coalesce(new.freigegeben_am, now());
    new.freigegeben_von  := coalesce(new.freigegeben_von, app.aktueller_benutzer());
    return new;
  end if;

  if old.status = 'freigegeben' and new.status = 'versendet' then
    new.versendet_am := coalesce(new.versendet_am, now());
    return new;
  end if;

  if old.status = 'versendet' and new.status = 'erledigt' then
    return new;
  end if;

  raise exception 'Der Uebergang % → % ist nicht vorgesehen.', old.status, new.status
    using errcode = 'restrict_violation';
end $$;

/**
 * Die zweiargumentige Form geht — nachdem beide Aufrufer umgestellt sind.
 *
 * Sie stehen zu lassen hiesse, das Loch offen zu lassen und daneben ein
 * Schild aufzustellen: der naechste Ausloeser nimmt die kuerzere Signatur,
 * weil sie da ist und weil sie reicht, bis sie es nicht mehr tut.
 */
drop function app.freigabe_genehmigt(uuid, uuid);

-- ---------------------------------------------------------------------------
-- (7) Der Mahnlauf lief nie — cse_job fehlten die Rechte (0125, FIN-15)
-- ---------------------------------------------------------------------------

/**
 * **Der Befund:** `jobs/mahnlauf.ts` faehrt als `cse_job` und tut drei Dinge —
 * `mahnstufe` lesen, `mahnung` schreiben, `mahnung_position` schreiben. 0125
 * gibt der Rolle von diesen dreien: nichts, drei Lesespalten, drei
 * Lesespalten. Jeder naechtliche Lauf waere mit „permission denied for table
 * mahnstufe" gescheitert — im Job, um vier Uhr morgens, und die Buchhaltung
 * haette sich gewundert, warum nie ein Vorschlag da ist.
 *
 * Der Lauf entsteht in `job_lauf` mit Fehler; gemeldet wird er nur, wenn
 * jemand hinsieht. Das ist die teuerste Sorte Fehler: einer, der eine
 * NICHT-Handlung erzeugt.
 *
 * **Was die Rolle bekommt, ist genau das, was sie tut.** Lesen auf
 * `mahnstufe`, Schreiben auf den beiden Mahntischen. Kein `update`, kein
 * `delete`: ein Nachtlauf legt Entwuerfe an und beruehrt nichts Bestehendes.
 *
 * **`mahnstufe` traegt `mandant_id`** — anders als `basiszinssatz`, der
 * global ist. Die Stufen sind eine Entscheidung der Gesellschaft (Gebuehr,
 * Frist, Zinsart), keine Referenzdaten. Die Policy bindet deshalb den
 * Mandanten: ein `using (true)` liesse den Nachtlauf der einen Gesellschaft
 * die Mahnkonditionen der anderen lesen, und das ist genau die Grenze, die
 * dieses ganze Modell traegt (Invariante 3).
 */
grant select on mahnstufe to cse_job;
create policy t_mahnstufe_job_lesen on mahnstufe for select to cse_job
  using (mandant_id = app.aktiver_mandant());

/**
 * Die Spalten der beiden Inserts — und die Spalten, die das `returning id`
 * und der Positionsschreiber danach lesen.
 *
 * `insert` ohne das passende `select` waere hier tot: `legeMahnentwurfAn`
 * holt sich die Kennung des Kopfes mit `returning id` zurueck, und das ist
 * ein Lesezugriff auf `id`. Die drei Lesespalten aus 0125 decken ihn ab.
 */
grant insert (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum, zahlbar_bis,
              forderung_cent, gebuehr_cent, zinsen_cent, gesamt_cent,
              erstellt_von_art, erstellt_von_dienst)
  on mahnung to cse_job;
grant insert (mandant_id, mahnung_id, rechnung_id, offener_posten_id,
              offener_betrag_cent, faellig_am, verzugsbeginn_am,
              verzugsbeginn_regel, verzugstage, zins_bp, zins_methode, zins_cent,
              erstellt_von_art, erstellt_von_dienst)
  on mahnung_position to cse_job;

/**
 * Und die Policies — ohne die die Grants tot waeren (D-388).
 *
 * `mandant_id = app.aktiver_mandant()`: der Jobkontext bindet den Mandanten
 * genau wie eine Sitzung (`alsJobSitzung`), und ein Nachtlauf, der fuer
 * Gesellschaft A laeuft, schreibt keine Mahnung fuer B. Ein `using (true)`
 * waere hier bequem und falsch.
 *
 * Nur `for insert`: der Zustandsuebergang auf `freigegeben` ist eine
 * MENSCHLICHE Handlung (Invariante 7), und der Nachtlauf hat dafuer weder
 * Recht noch Anlass.
 */
create policy t_mahnung_job_anlegen on mahnung for insert to cse_job
  with check (mandant_id = app.aktiver_mandant());
create policy t_mp_job_anlegen on mahnung_position for insert to cse_job
  with check (mandant_id = app.aktiver_mandant());

-- ---------------------------------------------------------------------------
-- (8) Der Beleg einer Eingangsrechnung IST eine Eingangsrechnung (ACC-03)
-- ---------------------------------------------------------------------------

/**
 * **Der Befund:** `eingangsrechnung.beleg_id` traegt einen zusammengesetzten
 * Fremdschluessel auf `beleg (mandant_id, id)` — der prueft die Gesellschaft,
 * aber nicht die ART. Ein Vertrag, ein Kontoauszug oder eine AUSGANGSrechnung
 * konnte damit als Beleg einer Eingangsrechnung dienen; die Route nimmt
 * `belegId` aus dem Formular und reicht ihn weiter.
 *
 * Der Fremdschluessel kann das nicht: dafuer braeuchte `beleg` einen
 * eindeutigen Index ueber `(mandant_id, id, typ)` und die Kindtabelle eine
 * konstante Spalte — machbar, aber eine Spalte, die immer dasselbe enthaelt,
 * erklaert sich niemandem. Ein Ausloeser sagt, was er meint.
 */
create function fin.er_belegtyp_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare v_typ beleg_typ;
begin
  select typ into v_typ from public.beleg
   where id = new.beleg_id and mandant_id = new.mandant_id;
  if not found then return new; end if;   -- Das meldet der Fremdschluessel.

  if v_typ <> 'eingangsrechnung' then
    raise exception
      'Der Beleg einer Eingangsrechnung ist vom Typ eingangsrechnung, nicht %.', v_typ
      using errcode = 'check_violation',
            hint = 'ACC-03: der Beleg IST die Rechnung, nicht irgendein Dokument dazu.';
  end if;
  return new;
end $$;

alter function fin.er_belegtyp_pruefen() owner to cse_definer;
revoke all on function fin.er_belegtyp_pruefen() from public;

create trigger er_belegtyp_pruefen
  before insert or update of beleg_id on eingangsrechnung
  for each row execute function fin.er_belegtyp_pruefen();

/** Eine Spalte mehr fuer den Definer — den Typ, um den es geht. */
grant select (id, mandant_id, typ) on beleg to cse_definer;

-- ---------------------------------------------------------------------------
-- (9) Der §48-Einbehalt wird EINMAL gebucht (0121, §48 EStG)
-- ---------------------------------------------------------------------------

/**
 * **Der Befund:** `bucheBauabzug` prueft nicht, ob der Einbehalt schon
 * gebucht ist. Zweimal aufgerufen — zwei Klicks, ein Wiederholungsversuch
 * nach einem Zeitueberschreitungsfehler — schreibt die Funktion den vollen
 * Einbehalt ein zweites Mal und tilgt damit einen Rest, den niemand bezahlt
 * hat. Auf der Rechnung steht genau EIN Einbehaltsbetrag.
 *
 * Der Riegel steht als Index und nicht als Pruefung im Dienst: eine Pruefung
 * im Dienst laesst zwei gleichzeitige Aufrufe beide durch, weil beide nichts
 * finden. Der Index laesst den zweiten auflaufen, egal wie gleichzeitig er
 * ist. Der Dienst prueft trotzdem zusaetzlich — fuer die Meldung, nicht fuer
 * die Sicherheit.
 */
create unique index zz_bauabzug_je_posten
  on zahlung_zuordnung (mandant_id, offener_posten_id)
  where art = 'bauabzugsteuer_einbehalt';

comment on index zz_bauabzug_je_posten is
  '§48 EStG: eine Rechnung weist EINEN Einbehalt aus, also traegt ein Posten '
  'hoechstens eine Einbehaltszeile. Zweimal gebucht loeschte er einen Rest, '
  'den niemand bezahlt hat.';
