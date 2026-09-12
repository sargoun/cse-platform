-- =========================================================================
-- 0120 — Die elektronische Adresse: eine Quelle, und ein Einfrieren. PR 52.1.
--
-- **Der Befund, der diese Migration ausgeloest hat.** `rechnung` traegt seit
-- 0075 vier Spalten — `verkaeufer_eadresse`, `verkaeufer_eadresse_schema`,
-- `kaeufer_eadresse`, `kaeufer_eadresse_schema`. Sie werden gelesen: von der
-- kanonischen Nutzlast (BT-34, BT-49) und seit PR 52 von der
-- §14-Vorpruefung. Geschrieben werden sie von NICHTS. Kein Formular, keine
-- Route, keine Funktion, kein Seed.
--
-- Damit war die XRechnung praktisch unerreichbar: der Bauer meldete auf JEDER
-- Rechnung zwei fehlende Pflichtangaben, und die neue FIN-11-Regel haette
-- jede Festschreibung an einen oeffentlichen Auftraggeber mit zwei Feldern
-- blockiert, die in keiner Maske stehen. Ein Riegel, den niemand oeffnen
-- kann, ist kein Riegel, sondern eine Sackgasse.
--
-- **Zwei Dinge fehlten, nicht eines:**
--
--   1. Die QUELLE auf der Verkaeuferseite. `kunde.elektronische_adresse` gibt
--      es seit 0020; auf `mandant` gab es nichts. Sie kommt hier dazu — und
--      sie bleibt NULL. Welche Adresse eine Gesellschaft fuer den Empfang
--      elektronischer Rechnungen benennt und unter welchem EAS-Schema, ist
--      eine Auskunft des Mandanten. Ein abgeleiteter Vorgabewert waere
--      plausibel (die USt-IdNr. unter EAS 9930) und trotzdem geraten.
--
--   2. Das EINFRIEREN. K-12 verlangt, dass die Identitaet auf dem Beleg
--      steht und nicht als Verweis: wird die Adresse spaeter gepflegt, darf
--      das nicht aendern, was eine bereits gestellte Rechnung SAGT.
--
-- **Warum ein Trigger und keine Zeile in `fin.rechnung_nummer_ziehen`.** Die
-- Funktion ist der eine Weg, auf dem heute festgeschrieben wird — aber nur
-- heute. Ein Import, ein Skript oder eine spaetere Route setzt `status` und
-- geht daran vorbei; die Rechnung haette dann keine elektronische Adresse und
-- niemand saehe, warum. Dieselbe Begruendung wie bei
-- `fin.reverse_charge_pruefen` (D-390): der Riegel gehoert an die Tabelle.
-- =========================================================================

alter table mandant
  add column elektronische_adresse        text,
  add column elektronische_adresse_schema text;

comment on column mandant.elektronische_adresse is
  'BT-34: die elektronische Adresse der Gesellschaft als Rechnungsstellerin. '
  'NULL, solange die Gesellschaft sie nicht benannt hat — dann entsteht zu '
  'einem oeffentlichen Auftraggeber keine XRechnung, und die §14-Vorpruefung '
  'sagt das vor dem Festschreiben.';

comment on column mandant.elektronische_adresse_schema is
  'BT-34-1: der EAS-Code zur Adresse (Codeliste ISO/IEC 6523). 9930 = '
  'deutsche USt-IdNr., 0204 = Leitweg-ID. Wird NICHT abgeleitet.';

-- Eine Adresse ohne Schema ist unlesbar, ein Schema ohne Adresse leer. Beide
-- oder keines — sonst steht auf der Rechnung ein Bezeichner, dessen Herkunft
-- niemand kennt.
alter table mandant
  add constraint mandant_eadresse_paarweise
    check ((elektronische_adresse is null) = (elektronische_adresse_schema is null));

/**
 * Das Einfrieren beim Uebergang `entwurf` → `festgeschrieben`.
 *
 * **`coalesce` und nicht stur ueberschreiben.** Steht auf dem Beleg schon
 * eine Adresse, gilt sie: ein Kunde kann fuer EINEN Auftrag eine andere
 * Eingangsadresse nennen als die im Stammsatz (ein anderes Amt, ein anderes
 * Portal), und die Rechnung ist dann der richtige Ort dafuer. Ueberschreiben
 * hiesse, diese Angabe im Moment des Festschreibens still zu verwerfen.
 *
 * **Beide Haelften zusammen oder gar nicht.** Eine Adresse aus dem Stammsatz
 * mit einem Schema vom Beleg waere eine Kennung, die es nirgends gibt.
 *
 * SECURITY DEFINER und `cse_definer` als Eigentuemer (K-01): die Funktion
 * liest `mandant` und `kunde`, und der Aufrufer hat auf beide nur die
 * Spaltenrechte seiner Rolle. `search_path` gesetzt, wie bei jeder Funktion
 * dieser Art.
 */
create function fin.eadresse_einfrieren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_m record;
  v_k record;
begin
  if new.status is not distinct from old.status or new.status <> 'festgeschrieben' then
    return new;
  end if;

  if new.verkaeufer_eadresse is null then
    select m.elektronische_adresse as adresse, m.elektronische_adresse_schema as schema
      into v_m
      from public.mandant m where m.id = new.mandant_id;
    new.verkaeufer_eadresse        := v_m.adresse;
    new.verkaeufer_eadresse_schema := v_m.schema;
  end if;

  if new.kaeufer_eadresse is null then
    select k.elektronische_adresse as adresse, k.elektronische_adresse_schema as schema
      into v_k
      from public.kunde k
     where k.id = new.kunde_id and k.mandant_id = new.mandant_id;
    new.kaeufer_eadresse        := v_k.adresse;
    new.kaeufer_eadresse_schema := v_k.schema;
  end if;

  return new;
end
$$;

alter function fin.eadresse_einfrieren() owner to cse_definer;

/**
 * **Der Name entscheidet die Reihenfolge.** Postgres feuert BEFORE-Trigger
 * ALPHABETISCH, und `eadresse_einfrieren` steht damit vor allen
 * `trg_rechnung_*` aus 0075/0076 und vor `reverse_charge_pruefen` aus 0118.
 *
 * Das ist hier harmlos und trotzdem festgehalten: `trg_rechnung_unveraenderlich`
 * vergleicht `to_jsonb(old)` mit `to_jsonb(new)` und saehe die eingefrorene
 * Adresse als Aenderung — er kehrt aber vorher um, weil `old.status` beim
 * Festschreiben noch `entwurf` ist. Wer diese Bedingung einmal lockert,
 * braucht diesen Absatz.
 */
create trigger eadresse_einfrieren
  before update on rechnung
  for each row execute function fin.eadresse_einfrieren();

/**
 * Der Trigger liest — und braucht dafuer RECHT und POLICY (D-388). Beides
 * ist schon fast da, und deshalb steht hier weniger, als man erwartet:
 *
 *   `mandant` — Tabellenrecht seit 0077 (`grant select on mandant to
 *   cse_definer`), Policy `d_mandant_lesen` ebenda. Ein Tabellenrecht deckt
 *   spaeter hinzukommende Spalten, also ist hier NICHTS zu tun.
 *
 *   `kunde` — Spaltenrechte (K-05). Die beiden neuen Spalten fehlen darin
 *   und kommen dazu. Die POLICY dagegen nicht: `d_kunde_pflichtfeld` (0104)
 *   traegt genau dasselbe Praedikat (`mandant_id = app.aktiver_mandant()`).
 *   Eine zweite permissive Policy mit demselben Inhalt oeffnet nichts und
 *   erweckt den Eindruck, die beiden koennten sich unterscheiden — und beim
 *   naechsten Mal aendert jemand nur eine davon.
 *
 * Postgres prueft erst das GRANT, dann die Policy: ohne diesen einen Grant
 * laese der Trigger null Zeilen und froere still NULL ein.
 */
grant select (elektronische_adresse, elektronische_adresse_schema)
  on kunde to cse_definer;
