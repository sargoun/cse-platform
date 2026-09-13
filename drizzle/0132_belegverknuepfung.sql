-- ===========================================================================
-- 0132 — Die Belegverknuepfung: das Dokument reist mit der Buchungszeile
--        (PR 59, ACC-03, DOC-04, GoBD, § 147 AO)
-- ===========================================================================
--
-- 0131 hat den Weg gebaut: `app.buchungssatz_schreiben` nimmt einen Beleg
-- entgegen, und die Eingangsrechnung gibt ihren mit. Die Ausgangsseite kann
-- es nicht — sie HAT keinen. Eine festgeschriebene Rechnung erzeugt ihr
-- ZUGFeRD-PDF bis heute bei jedem Abruf neu; abgelegt wird es nie.
--
-- Fuer den Versand reicht das. Fuer eine Betriebspruefung nicht: § 147 AO
-- verlangt das Dokument, das VORLAG — nicht eines, das sich nachbauen laesst.
-- Solange die Erzeugung deterministisch ist, sieht man den Unterschied nicht;
-- an dem Tag, an dem jemand die Vorlage aendert, sieht man ihn ueberall auf
-- einmal, rueckwirkend, und ohne Moeglichkeit zu zeigen, welche Fassung der
-- Kunde bekommen hat.
--
-- Diese Migration legt vier Dinge an:
--
--   (1) `rechnung.beleg_id` — dieselbe Spalte, die die Eingangsrechnung seit
--       0123 traegt, mit derselben Typpruefung.
--   (2) `app.rechnung_beleg_setzen` — haengt den Beleg an die Rechnung UND an
--       ihre noch offenen Buchungszeilen, in einem Schritt.
--   (3) `buchungssatz_unvollstaendig` — die Arbeitsliste: welche Zeile welchen
--       Beleg noch nicht hat.
--   (4) `app.export_bereit` — die Sperre, die PR 60 abfragt, bevor er eine
--       Datei erzeugt.
--
-- Und einen fuenften Riegel: ein Dokument, auf das eine Buchung zeigt, laesst
-- sich nicht mehr wegloeschen — auch nicht weich.

-- ---------------------------------------------------------------------------
-- (1) Die Rechnung traegt ihren Beleg
-- ---------------------------------------------------------------------------

/**
 * **Ein selbst erzeugter Beleg ist eine eigene Herkunft.**
 *
 * `beleg_quelle` kannte vier Wege ins Haus: `upload`, `email`, `scan`, `api`
 * — alle vier beschreiben ein Dokument, das von AUSSEN kam. Das
 * Rechnungs-PDF kommt von nirgendwo: die Plattform erzeugt es aus dem
 * eigenen Snapshot.
 *
 * Es unter `api` zu fuehren waere die bequeme Antwort und eine falsche
 * Angabe: `api` heisst „eine fremde Stelle hat es geliefert", und genau das
 * fragt eine Betriebspruefung, wenn sie wissen will, wer ein Dokument
 * erstellt hat. Eine Herkunftsangabe, die im Zweifel das Gegenteil sagt, ist
 * schlimmer als keine.
 */
alter type beleg_quelle add value if not exists 'erzeugt';

/**
 * Der Wert wird in DIESER Datei nirgends benutzt — Postgres verbietet die
 * Benutzung eines frisch angelegten Enum-Werts bis zum Commit, und der
 * Migrationslauf fuehrt jede Datei in einer Transaktion aus (siehe 0090).
 * Kein `default`, kein `check` darauf, kein `update`.
 */
comment on type beleg_quelle is
  'Woher ein Beleg kam. upload/email/scan/api beschreiben ein Dokument von '
  'AUSSEN; erzeugt heisst, die Plattform hat es aus dem eigenen Snapshot '
  'hergestellt (das Rechnungs-PDF, PR 59). Der Unterschied ist der, nach dem '
  'eine Betriebspruefung fragt.';


alter table rechnung add column beleg_id uuid;

comment on column rechnung.beleg_id is
  'ACC-03. Das ARCHIVIERTE Dokument dieser Rechnung — das PDF, das der Kunde '
  'bekommen hat, nicht eines, das sich nachbauen laesst. NULL, solange der '
  'Archivlauf es noch nicht abgelegt hat; die Buchungszeilen stehen dann in '
  'buchungssatz_unvollstaendig und der Export verweigert.';

alter table rechnung add constraint r_beleg_fk
  foreign key (mandant_id, beleg_id) references beleg (mandant_id, id);

/**
 * Dieselbe Ueberlegung wie `fin.er_belegtyp_pruefen` (0130): der
 * zusammengesetzte Fremdschluessel prueft die Gesellschaft, nicht die ART.
 * Ein Kontoauszug als „Beleg" einer Ausgangsrechnung ginge sonst durch.
 *
 * **Zwei Typen sind erlaubt, nicht einer.** Eine Gutschrift ist eine Rechnung
 * mit negativem Vorzeichen und laeuft durch dieselbe Tabelle; ihr Dokument
 * traegt `typ = 'gutschrift'`. Wer hier nur `ausgangsrechnung` zuliesse,
 * haette die Gutschriften stillschweigend vom Archiv ausgeschlossen.
 */
create function fin.ar_belegtyp_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare v_typ beleg_typ;
begin
  if new.beleg_id is null then return new; end if;

  select typ into v_typ from public.beleg
   where id = new.beleg_id and mandant_id = new.mandant_id;
  if not found then return new; end if;   -- Das meldet der Fremdschluessel.

  if v_typ not in ('ausgangsrechnung', 'gutschrift') then
    raise exception
      'Der Beleg einer Ausgangsrechnung ist vom Typ ausgangsrechnung oder '
      'gutschrift, nicht %.', v_typ
      using errcode = 'check_violation',
            hint = 'ACC-03: der Beleg IST die Rechnung, nicht irgendein Dokument dazu.';
  end if;
  return new;
end $$;

alter function fin.ar_belegtyp_pruefen() owner to cse_definer;
revoke all on function fin.ar_belegtyp_pruefen() from public;

create trigger ar_belegtyp_pruefen
  before insert or update of beleg_id on rechnung
  for each row execute function fin.ar_belegtyp_pruefen();

/**
 * **`beleg_id` muss aus dem Aenderungsschutz heraus — und zwar nur sie.**
 *
 * `fin.rechnung_unveraenderlich` (0076, zuletzt 0122) vergleicht die ganze
 * Zeile ueber `to_jsonb` und nimmt genau vier bewegliche Spalten aus, unter
 * ihnen `aufbewahrung_bis`: der Aufbewahrungslauf muss die Frist auch auf
 * einer festgeschriebenen Rechnung setzen koennen (D-399). Der Archivlauf
 * steht vor derselben Lage — er legt das PDF ab, NACHDEM die Rechnung
 * festgeschrieben ist, denn vorher gibt es keinen Snapshot und keine Nummer.
 *
 * Ohne diese Ausnahme scheiterte er an Invariante 4, und der einzige Ausweg
 * waere gewesen, den Beleg VOR dem Festschreiben zu setzen — also ein
 * Dokument abzulegen, das noch nicht das endgueltige ist.
 *
 * **Eine Ausnahme ist ein Loch, wenn nichts sie schliesst.** Deshalb direkt
 * darunter der engere Riegel: einmal gesetzt, ist der Zeiger fest. Ein
 * Archiv, dessen Zeiger sich umbiegen laesst, ist kein Archiv; was danach
 * kommt, ist eine neue Fassung mit eigenem Beleg, nie ein anderer Zeiger auf
 * derselben Zeile. Der Rumpf ist im Uebrigen woertlich der aus 0122.
 */
create or replace function fin.rechnung_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus  text[];
  v_alt  jsonb;
  v_neu  jsonb;
  v_feld text;
begin
  if old.status = 'entwurf' then
    return new;
  end if;

  select array['geaendert_am', 'geaendert_von', 'geaendert_von_art',
               'aufbewahrung_bis', 'beleg_id']
         || coalesce(array_agg(a.attname::text), '{}')
    into v_aus
    from pg_attribute a
   where a.attrelid = 'public.rechnung'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  v_alt := to_jsonb(old) - v_aus;
  v_neu := to_jsonb(new) - v_aus;

  if v_alt = v_neu then
    return new;
  end if;

  select k into v_feld
    from jsonb_object_keys(v_neu) k
   where v_alt -> k is distinct from v_neu -> k
   order by k
   limit 1;

  raise exception
    'Rechnung %: festgeschriebene und verworfene Belege sind unveraenderlich — % wurde geaendert (Invariante 4, LEG-01)',
    coalesce(old.nummer, old.id::text), coalesce(v_feld, '<Spalte entfernt>')
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch STORNO und Neuausstellung (rechnung_beziehung), '
                 'nie durch Aenderung. Der Versand steht in rechnung_versand.';
end $$;

/** Der engere Riegel, der die Ausnahme darueber schliesst. */
create function fin.rechnung_beleg_fest() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.beleg_id is not null and new.beleg_id is distinct from old.beleg_id then
    raise exception
      'Rechnung %: der archivierte Beleg steht fest und wird nicht ausgetauscht.', old.id
      using errcode = 'restrict_violation',
            hint = 'Eine andere Fassung ist eine neue Rechnung mit eigenem Beleg.';
  end if;
  return new;
end $$;

create trigger r_beleg_fest
  before update of beleg_id on rechnung
  for each row execute function fin.rechnung_beleg_fest();

create index rechnung_ohne_beleg_idx on rechnung (mandant_id, rechnungsdatum)
  where beleg_id is null and status = 'festgeschrieben';

-- ---------------------------------------------------------------------------
-- (2) Den Beleg anhaengen — an die Rechnung UND an ihre Buchungszeilen
-- ---------------------------------------------------------------------------

/**
 * **Ein Schritt, nicht zwei.**
 *
 * Der Archivlauf legt das PDF ab und muss danach zwei Stellen bewegen: die
 * Rechnung und jede ihrer Buchungszeilen. Zwei Aufrufe von aussen liessen
 * einen Zwischenzustand zu, in dem die Rechnung ihren Beleg hat und die
 * Zeilen nicht — und der Export laege still falsch, weil `beleg_id` auf der
 * ZEILE steht und nirgends sonst.
 *
 * **Nur die noch offenen Zeilen.** `fin.buchungssatz_unveraenderlich` weist
 * jede Aenderung an einer festgeschriebenen Zeile ab, und das ist richtig so.
 * Eine festgeschriebene Zeile OHNE Beleg kann es ohnehin nicht geben:
 * `bs_kein_beleg_ohne_hinweis` verhindert genau das beim Festschreiben. Das
 * `where` ist deshalb keine Nachsicht, sondern die Beschreibung der einzigen
 * Menge, die es zu bewegen gibt.
 *
 * Gibt die Zahl der bewegten Zeilen zurueck — `0` heisst „war schon", nicht
 * „ging nicht": der Lauf ist wiederholbar.
 */
create function app.rechnung_beleg_setzen(
  p_mandant uuid, p_rechnung uuid, p_beleg uuid
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare v_zeilen integer;
begin
  perform app.buchen_erlaubt(p_mandant);

  update public.rechnung
     set beleg_id = p_beleg
   where id = p_rechnung
     and mandant_id = p_mandant
     and beleg_id is null
     and status = 'festgeschrieben';

  update public.buchungssatz
     set beleg_id = p_beleg
   where mandant_id = p_mandant
     and rechnung_id = p_rechnung
     and beleg_id is null
     and not festgeschrieben;
  get diagnostics v_zeilen = row_count;

  return v_zeilen;
end $$;

alter function app.rechnung_beleg_setzen(uuid, uuid, uuid) owner to cse_definer;
revoke all on function app.rechnung_beleg_setzen(uuid, uuid, uuid) from public;
grant execute on function app.rechnung_beleg_setzen(uuid, uuid, uuid) to cse_app, cse_job;

/** Der Definer bewegt zwei Spalten und liest, was er dafuer braucht (K-05). */
grant select (id, mandant_id, beleg_id, status) on rechnung to cse_definer;
grant update (beleg_id) on rechnung to cse_definer;
grant select (id, mandant_id, rechnung_id, beleg_id, festgeschrieben) on buchungssatz
  to cse_definer;
grant update (beleg_id) on buchungssatz to cse_definer;

create policy d_rechnung_beleg on rechnung for select to cse_definer using (true);
create policy d_rechnung_beleg_u on rechnung for update to cse_definer
  using (true) with check (true);
create policy d_bs_beleg on buchungssatz for select to cse_definer using (true);
create policy d_bs_beleg_u on buchungssatz for update to cse_definer
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- (3) Die Arbeitsliste: welche Zeile hat ihren Beleg noch nicht
-- ---------------------------------------------------------------------------

/**
 * **Sichtbar statt still.**
 *
 * Eine Buchungszeile ohne Dokument ist kein Fehler in dem Moment, in dem sie
 * entsteht — der Archivlauf kommt gleich. Sie wird einer, wenn niemand
 * hinsieht. Diese Sicht ist die Stelle, an der jemand hinsieht: sie nennt die
 * Zeile, ihren Betrag, ihren Ursprung und den Grund im Klartext.
 *
 * `security_invoker`, damit die Mandantengrenze die des Lesers ist und nicht
 * die des Sichteigentuemers — eine Sicht ohne das waere ein Loch neben RLS,
 * kein Bericht.
 *
 * **`manuell` fehlt mit Absicht.** Eine manuelle Buchung ohne Beleg traegt
 * ihren Grund selbst (`bs_kein_beleg_ohne_hinweis`, 0127); sie hier zu
 * fuehren hiesse, eine erlaubte Buchungsart dauerhaft als unvollstaendig
 * auszuweisen, und die Liste waere nach einer Woche niemandes Liste mehr.
 */
create view buchungssatz_unvollstaendig with (security_invoker = true) as
select
  bs.id                          as buchungssatz_id,
  bs.mandant_id,
  bs.buchung_id,
  bs.buchungsdatum,
  bs.belegdatum,
  bs.periode_id,
  bs.umsatz_cent,
  bs.soll_haben,
  bs.konto,
  bs.buchungstext,
  bs.herkunft,
  bs.rechnung_id,
  bs.eingangsrechnung_id,
  bs.festgeschrieben,
  case
    when bs.beleg_id is null and bs.konto is null
      then 'Beleg fehlt und Konto ist nicht zugeordnet'
    when bs.beleg_id is null then 'Beleg fehlt'
    else 'Konto ist nicht zugeordnet'
  end                            as grund
from buchungssatz bs
where bs.herkunft <> 'manuell'
  and (bs.beleg_id is null or bs.konto is null);

comment on view buchungssatz_unvollstaendig is
  'ACC-03, PR 59. Buchungszeilen, die noch nicht exportfaehig sind: ohne '
  'archivierten Beleg oder ohne Kontenzuordnung. Der DATEV-Export (PR 60) '
  'verweigert, solange hier fuer den Zeitraum eine Zeile steht.';

grant select on buchungssatz_unvollstaendig to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- (4) Die Exportsperre
-- ---------------------------------------------------------------------------

/**
 * Zwei Funktionen, weil zwei Fragen gestellt werden.
 *
 * Die Oberflaeche fragt „was fehlt" und will eine Liste, um sie anzuzeigen.
 * Der Export fragt „darf ich" und will ein Nein, das den Lauf abbricht — kein
 * Ergebnis, das sich uebersehen laesst. Eine Funktion fuer beides hiesse, dass
 * die eine Seite den Rueckgabewert pruefen MUSS und es irgendwann nicht tut.
 */
create function app.export_unvollstaendig(
  p_mandant uuid, p_von date, p_bis date
) returns table (
  buchungssatz_id uuid, belegdatum date, buchungstext text, grund text
)
language sql stable security invoker set search_path = pg_catalog, public, app as $$
  select u.buchungssatz_id, u.belegdatum, u.buchungstext, u.grund
    from public.buchungssatz_unvollstaendig u
   where u.mandant_id = p_mandant
     and u.belegdatum between p_von and p_bis
   order by u.belegdatum, u.buchungstext
$$;

revoke all on function app.export_unvollstaendig(uuid, date, date) from public;
grant execute on function app.export_unvollstaendig(uuid, date, date) to cse_app, cse_job;

/**
 * **Es gibt keine halbrichtige Exportdatei.**
 *
 * Ein Export, der die unvollstaendigen Zeilen auslaesst, ergibt eine Datei,
 * deren Summe nicht stimmt — und niemand sieht es der Datei an. Ein Export,
 * der sie mitnimmt, ergibt Zeilen ohne Beleg, und die Betriebspruefung sieht
 * es sehr wohl. Deshalb: gar keine Datei, mit der Zahl im Fehlertext.
 */
create function app.export_sperre_pruefen(
  p_mandant uuid, p_von date, p_bis date
) returns void
language plpgsql stable security invoker set search_path = pg_catalog, public, app as $$
declare v_offen integer;
begin
  select count(*) into v_offen
    from app.export_unvollstaendig(p_mandant, p_von, p_bis);

  if v_offen > 0 then
    raise exception
      'Der Zeitraum % bis % hat % Buchungszeile(n) ohne Beleg oder ohne Konto. '
      'Es entsteht keine Exportdatei, solange eine davon offen ist.',
      p_von, p_bis, v_offen
      using errcode = 'restrict_violation',
            hint = 'Die Liste steht unter app.export_unvollstaendig(...) und im '
                   'Portal unter Buchhaltung → Unvollstaendig.';
  end if;
end $$;

revoke all on function app.export_sperre_pruefen(uuid, date, date) from public;
grant execute on function app.export_sperre_pruefen(uuid, date, date) to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- (5) Ein Dokument, auf das eine Buchung zeigt, geht nicht weg
-- ---------------------------------------------------------------------------

/**
 * **Warum das nicht schon gilt.**
 *
 * `kern.dokument_loeschsperre` (0009) weist das weiche Loeschen ab, wenn
 * `dokument.loeschsperre` steht — und die steht, weil die KATEGORIE es sagt.
 * Fuer ein Rechnungs-PDF in der Kategorie `buchhaltung` ist das heute wahr,
 * und deshalb faellt die Luecke nicht auf: der Grund ist die Kategorie, nicht
 * die Buchung. Ein Dokument, das in einer freieren Kategorie hochgeladen und
 * SPAETER als Beleg an eine Buchung gehaengt wird, bleibt loeschbar.
 *
 * Genau dieser Fall ist der Regelfall von ACC-05: jemand laedt eine
 * Lieferantenrechnung hoch, sie wird zum Beleg, sie wird gebucht. Der Grund,
 * warum sie bleiben muss, entsteht NACH dem Hochladen.
 *
 * Der Riegel prueft deshalb den Grund selbst — zeigt eine Buchungszeile ueber
 * `beleg` auf dieses Dokument, bleibt es. Unabhaengig von der Kategorie,
 * unabhaengig von der Frist, und ohne dass jemand daran gedacht haben muss.
 */
create function fin.dokument_haengt_an_buchung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, fin as $$
declare v_zeile uuid;
begin
  if new.geloescht_am is null or old.geloescht_am is not null then return new; end if;

  select bs.id into v_zeile
    from public.beleg b
    join public.buchungssatz bs
      on bs.beleg_id = b.id and bs.mandant_id = b.mandant_id
   where b.dokument_id = old.id and b.mandant_id = old.mandant_id
   limit 1;

  if v_zeile is not null then
    raise exception
      'Dokument %: eine Buchungszeile (%) beruft sich darauf. Es bleibt, '
      'solange die Buchung steht (ACC-03, § 147 AO).', old.id, v_zeile
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird die BUCHUNG durch Gegenbuchung, nie der Beleg '
                   'durch Loeschen.';
  end if;
  return new;
end $$;

alter function fin.dokument_haengt_an_buchung() owner to cse_definer;
revoke all on function fin.dokument_haengt_an_buchung() from public;

/**
 * `trg_dokument_b...` — vor `trg_dokument_loeschsperre` (PostgreSQL feuert
 * BEFORE-Ausloeser alphabetisch). Die Reihenfolge entscheidet, welchen Satz
 * der Aufrufer liest: „eine Buchung beruft sich darauf" nennt den Grund,
 * „Loeschsperre steht" nennt nur den Zustand.
 */
create trigger trg_dokument_buchung
  before update of geloescht_am on dokument
  for each row execute function fin.dokument_haengt_an_buchung();

/** Was der Definer dafuer lesen darf — zwei Spalten je Tabelle (K-05). */
grant select (id, mandant_id, dokument_id) on beleg to cse_definer;
create policy d_beleg_dokument on beleg for select to cse_definer using (true);
