-- 0296 — Die zwei Uebergaenge am Auftrag und ihre eigenen Rechte
--        (OPS-05, PRO-05, FIN-18, Invariante 3 und 5).

/**
 * **Der Befund, zweimal derselbe.** `t_mandant` auf `auftrag` verlangt im
 * WITH CHECK `app.hat_recht('auftrag.schreiben')`. Die Seitenkarte und der
 * Rechtekatalog kennen daneben zwei EIGENE Rechte fuer zwei Vorgaenge an
 * derselben Zeile:
 *
 *   auftrag.abschliessen              — den Auftrag beenden (OPS-05, FIN-18)
 *   referenz.kundenfreigabe_erfassen  — die schriftliche Erlaubnis des Kunden,
 *                                       das Projekt oeffentlich zu nennen (PRO-05)
 *
 * Heute decken sich die drei Rollenmengen — super_admin, admin, leitung, und
 * nichts ist zusaetzlich bindbar. Nichts faellt also um. Aber die zweite Linie
 * prueft damit nicht DIESE Vorgaenge, sie prueft einen Nachbarvorgang und
 * trifft zufaellig dieselbe Menge. Der erste Katalogschnitt, der
 * `auftrag.schreiben` an die Disposition bindet, macht daraus stillschweigend
 * ein Loch: Disposition koennte Auftraege abschliessen und Kundenfreigaben
 * erklaeren. Eine Zusage, die nur solange gilt, wie zwei Listen zufaellig
 * gleich sind, ist keine Zusage (Invariante 3: RLS ist die zweite Linie, nie
 * die einzige — und nie eine, die etwas anderes prueft).
 *
 * Gebunden wird im AUSLOESER und nicht in einer zweiten Policy: eine Policy
 * kann nicht sehen, WELCHE Spalte sich aendert, und ein WITH CHECK, das
 * `auftrag.abschliessen` fuer jedes UPDATE verlangte, sperrte die
 * Auftragspflege fuer alle, die nur abschliessen duerfen — und umgekehrt.
 *
 * **Und der Abschluss haelt.** Bisher hielt ihn nichts: `status` liess sich
 * von `abgeschlossen` zurueckdrehen und `abgeschlossen_am` ueberschreiben.
 * Das ist nicht nur Kosmetik — `pruefeZeiterfassung`
 * (src/server/services/finanz/positionsquelle.ts) liest
 * `status = 'abgeschlossen' or abgeschlossen_am is not null` als das Signal,
 * das die FIN-18-Warnung im Rechnungsweg SCHARF macht (D-366, D-367). Ein
 * stilles Zurueckdrehen entschaerfte damit eine Warnung, die jemand
 * ausdruecklich beschlossen hat, und zwar ohne Spur.
 *
 * TODO(client, O-734): Muss ein abgeschlossener Auftrag wieder geoeffnet werden koennen (Nachtrag, Gewaehrleistungsfall) — und was geschieht dann mit der FIN-18-Warnung, die der Abschluss nach D-366 scharf gestellt hat? Bis zur Antwort ist der Abschluss einwegig; korrigiert wird ueber einen Nachtrag oder einen neuen Auftrag.
 * TODO(client, O-735): Wird die Kundenfreigabe am Auftrag befristet (Geltungsdauer der Erlaubnis), und wirkt ein Widerruf rueckwirkend — also muessen bereits veroeffentlichte Referenzen entfernt werden, oder nur keine neuen entstehen?
 */

-- ---------------------------------------------------------------------------
-- 1. Der Ausloeser
-- ---------------------------------------------------------------------------

create or replace function kern.auftrag_uebergang_pruefen()
returns trigger language plpgsql as $$
declare
  v_schliesst boolean := (new.status = 'abgeschlossen'
                          and old.status is distinct from 'abgeschlossen')
                         or (new.abgeschlossen_am is not null
                             and old.abgeschlossen_am is null);
  v_freigabe_beruehrt boolean :=
       new.freigegeben_vom_kunden            is distinct from old.freigegeben_vom_kunden
    or new.freigabe_durch_ansprechpartner_id is distinct from old.freigabe_durch_ansprechpartner_id
    or new.freigabe_dokument_id              is distinct from old.freigabe_dokument_id
    or new.freigabe_text                     is distinct from old.freigabe_text
    or new.freigabe_widerrufen_am            is distinct from old.freigabe_widerrufen_am;
begin
  -- -------------------------------------------------------------------------
  -- (a) Der Abschluss (OPS-05, FIN-18)
  -- -------------------------------------------------------------------------
  if v_schliesst then
    if not app.hat_recht('auftrag.abschliessen', new.mandant_id) then
      raise exception 'auftrag.abschliessen fehlt — der Auftrag bleibt offen'
        using errcode = 'insufficient_privilege',
              detail  = 'Der Abschluss ist ein eigener Vorgang mit eigenem Recht '
                        || '(auftrag.abschliessen), nicht Teil der Auftragspflege.',
              hint    = 'Er stellt nach D-366 die FIN-18-Warnung im Rechnungsweg scharf.';
    end if;
    /**
     * Die Serveruhr (Invariante 5) — und `status` MIT gesetzt.
     *
     * Wer nur `abgeschlossen_am` schreibt, meint den Abschluss; der CHECK
     * `auftrag_abschluss_datiert` verlangt die Gegenrichtung (Status ohne
     * Datum ist verboten), nicht diese. Ohne das Nachziehen entstuende eine
     * Zeile mit Abschlussdatum und Status `aktiv` — und FIN-18 laese sie als
     * abgeschlossen, waehrend die Liste sie als laufend zeigte.
     */
    new.abgeschlossen_am := coalesce(old.abgeschlossen_am, now());
    new.status := 'abgeschlossen';
  end if;

  /**
   * Einwegig — O-734.
   *
   * `coalesce` oben haelt das Datum des ERSTEN Abschlusses; hier faellt jeder
   * Versuch, es zu aendern oder zu leeren.
   */
  if old.abgeschlossen_am is not null
     and new.abgeschlossen_am is distinct from old.abgeschlossen_am then
    raise exception 'Das Abschlussdatum eines Auftrags ist unveraenderlich'
      using errcode = 'check_violation',
            detail  = 'Der Abschluss ist an einem Zeitpunkt geschehen; ihn '
                      || 'umzuschreiben schriebe eine Tatsache um.',
            hint    = 'Korrektur ueber einen Nachtrag oder einen neuen Auftrag (O-734).';
  end if;
  if old.status = 'abgeschlossen' and new.status is distinct from 'abgeschlossen' then
    raise exception 'Ein abgeschlossener Auftrag wird nicht wieder geoeffnet (O-734)'
      using errcode = 'check_violation',
            detail  = 'Der Abschluss hat die FIN-18-Warnung scharf gestellt (D-366); '
                      || 'ein Zurueckdrehen entschaerfte sie ohne Spur.',
            hint    = 'Ob ein Wiederoeffnen vorgesehen ist, ist offen (O-734).';
  end if;

  -- -------------------------------------------------------------------------
  -- (b) Die Kundenfreigabe (PRO-05)
  -- -------------------------------------------------------------------------
  if v_freigabe_beruehrt then
    if not app.hat_recht('referenz.kundenfreigabe_erfassen', new.mandant_id) then
      raise exception 'referenz.kundenfreigabe_erfassen fehlt'
        using errcode = 'insufficient_privilege',
              detail  = 'Die Erlaubnis des Kunden, das Projekt oeffentlich zu nennen, '
                        || 'ist ein eigener Vorgang mit eigenem Recht (PRO-05).',
              hint    = 'Sie ist keine Auftragsaenderung — auftrag.schreiben genuegt nicht.';
    end if;
  end if;

  return new;
end $$;

comment on function kern.auftrag_uebergang_pruefen() is
  'OPS-05, PRO-05, FIN-18. Bindet den Abschluss an auftrag.abschliessen und die '
  'Kundenfreigabe an referenz.kundenfreigabe_erfassen — im Ausloeser, weil eine Policy '
  'nicht sehen kann, welche Spalte sich aendert. Der Abschluss ist einwegig (O-734).';

/**
 * `auftrag_05_uebergang` — VOR `auftrag_freigabe_stempeln`.
 *
 * Gleichartige Ausloeser laufen in Namensreihenfolge, und `0` steht vor `a`:
 * erst das Recht, dann der Zeitstempel. Umgekehrt stempelte die Datenbank
 * `freigabe_am` fuer einen Vorgang, den sie eine Zeile spaeter abweist — die
 * Zeile fiele ohnehin zurueck, aber die Reihenfolge soll die Absicht tragen
 * und nicht der Rollback.
 */
drop trigger if exists auftrag_05_uebergang on auftrag;
create trigger auftrag_05_uebergang
  before update on auftrag
  for each row execute function kern.auftrag_uebergang_pruefen();

-- ---------------------------------------------------------------------------
-- 2. Und beim ANLEGEN: kein Auftrag, der schon freigegeben zur Welt kommt
-- ---------------------------------------------------------------------------

/**
 * `kern.auftrag_freigabe_stempeln` stempelt beim INSERT ebenfalls — ein
 * `insert ... freigegeben_vom_kunden = true` waere also eine Kundenfreigabe
 * ohne das Freigaberecht, auf dem Weg an (a) vorbei. Der Fall ist heute
 * theoretisch (`wandleInAuftrag` setzt die Spalte nicht), und genau deshalb
 * kostet die Wache nichts.
 */
create or replace function kern.auftrag_freigabe_beim_anlegen()
returns trigger language plpgsql as $$
begin
  if new.freigegeben_vom_kunden
     and not app.hat_recht('referenz.kundenfreigabe_erfassen', new.mandant_id) then
    raise exception 'referenz.kundenfreigabe_erfassen fehlt'
      using errcode = 'insufficient_privilege',
            detail  = 'Ein Auftrag entsteht nicht mit einer Kundenfreigabe (PRO-05).';
  end if;
  return new;
end $$;

comment on function kern.auftrag_freigabe_beim_anlegen() is
  'PRO-05. Die Gegenrichtung zu kern.auftrag_uebergang_pruefen: auch ein INSERT gibt '
  'keine Referenz frei, ohne referenz.kundenfreigabe_erfassen zu halten.';

drop trigger if exists auftrag_05_freigabe_anlegen on auftrag;
create trigger auftrag_05_freigabe_anlegen
  before insert on auftrag
  for each row execute function kern.auftrag_freigabe_beim_anlegen();
