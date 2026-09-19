-- 0297 — Die Kundenfreigabe am Dokument: ihr Recht und ihre Decke
--        (DOC-03, DOC-04, Invariante 3).

/**
 * **Befund 1 — die zweite Linie prueft das falsche Recht, und hier fallen die
 * Rollenmengen wirklich auseinander.**
 *
 * `t_mandant` auf `dokument` verlangt im WITH CHECK
 * `app.hat_recht('dokument.schreiben')`. Der Katalog bindet:
 *
 *   dokument.schreiben        super_admin, admin, leitung, MITARBEITER
 *   dokument.kunde_freigeben  super_admin, admin, leitung
 *
 * Eine Beschaeftigtenrolle darf also Dokumente ablegen — und genau das soll
 * sie (sie laedt Nachweise und Fotos hoch). Sie darf NICHT entscheiden, was
 * ein Kunde zu sehen bekommt. Bisher schuetzte diese Entscheidung allein das
 * Tor der Route.
 *
 * **Welcher Weg heute wirklich offensteht — nachgemessen, nicht geschlossen.**
 * `t_mandant` verlangt LESEND `dokument.lesen`, und das haelt `mitarbeiter`
 * NICHT. Ein UPDATE dieser Rolle trifft deshalb null Zeilen und kommt an
 * `sichtbar_fuer_kunde` gar nicht heran. Offen ist der INSERT: das WITH CHECK
 * fragt `dokument.schreiben`, und damit legt `mitarbeiter` ein Dokument an,
 * das bereits freigegeben zur Welt kommt — auf einen beliebigen Kunden dieser
 * Gesellschaft. Gegen die lebende Datenbank geprueft: vor dieser Migration
 * durchgelassen, danach `dokument.kunde_freigeben fehlt`.
 *
 * Der UPDATE-Weg ist damit heute LATENT, nicht offen — er oeffnet sich in dem
 * Moment, in dem jemand `dokument.lesen` an `mitarbeiter` bindet oder
 * `dokument.schreiben` an eine weitere Rolle. Der Ausloeser deckt beide
 * Richtungen, weil eine Wache, die nur den heute erreichbaren Weg kennt, beim
 * naechsten Katalogschnitt still aufhoert zu wachen.
 *
 * Gebunden wird im AUSLOESER und nicht in einer Policy: eine Policy kann nicht
 * sehen, WELCHE Spalte sich aendert, und ein WITH CHECK auf
 * `dokument.kunde_freigeben` sperrte jeden gewoehnlichen Upload.
 *
 * **Befund 2 — die Kundendecke kennt den Kunden nicht.**
 *
 * `p_kunde_ceiling` (0009) lautet:
 *
 *   (app.portal() <> 'kunde' OR (sichtbar_fuer_kunde AND geloescht_am IS NULL))
 *
 * Darin steht kein `kunde_id`. Nachgemessen gegen die lebende Datenbank, mit
 * zwei Kunden, zwei freigegebenen Dokumenten und einem Konto, das nur auf
 * Kunde A Zugang hat:
 *
 *   scope='kunde' (das echte Kundenportal)   → 0 Zeilen
 *   scope='mandant', portal='kunde'          → 2 Zeilen: Doc A UND Doc B
 *
 * Nach dieser Migration im zweiten Fall: 1 Zeile, Doc A. Der interne Blick
 * (portal='intern') bleibt unveraendert.
 *
 * Der erste Fall ist heute die Rettung, nicht die Absicht: `dokument` traegt
 * gar keine PERMISSIVE `t_kunde` (das ist O-671, offen), und `t_mandant`
 * greift im Kunden-Scope nicht, weil `app.aktiver_mandant()` dort NULL ist.
 * Der zweite Fall ist die Lage, fuer die `p_kunde_ceiling` ueberhaupt
 * geschrieben wurde — und dort sieht ein Kundenkonto das Dokument eines
 * FREMDEN Kunden derselben Gesellschaft. DOC-04 verlangt, dass die
 * Zugriffskontrolle Rolle UND Bereichsschnitt nachbildet; „jeder Kunde dieses
 * Mandanten" ist nicht der Bereichsschnitt eines Kunden.
 *
 * Diese Decke kommt deshalb JETZT, bevor O-671 beantwortet wird. Eine Decke,
 * die man zugleich mit der Tuer einbaut, die sie deckt, ist eine Decke, die
 * beim ersten Entwurf vergessen wird — und dann steht das Loch in einer
 * Migration, die „Anhaenge im Kundenportal" heisst und niemand als
 * Zugriffsentscheidung liest.
 *
 * Als ZWEITE restriktive Policy und nicht als Ersatz fuer `p_kunde_ceiling`:
 * restriktive Policies werden UND-verknuepft, ein Zusatz kann also nur
 * verengen. Und 0009 bleibt unberuehrt — zwei Migrationen, die dieselbe
 * Policy neu schreiben, sind zwei Fassungen desselben Namens, und welche gilt,
 * entscheidet die Dateireihenfolge.
 *
 * TODO(client, O-736): Welche Dokumentkategorien duerfen einem Kunden UEBERHAUPT freigegeben werden? DOC-01 fuehrt auch `mitarbeiter` und `buchhaltung`; eine Lohnabrechnung oder ein Kontoauszug an einen Kunden freizugeben muss unmoeglich sein, nicht nur unueblich. Bis zur Antwort prueft die Datenbank nur das Recht, und die Oberflaeche nennt die Kategorie gross.
 */

-- ---------------------------------------------------------------------------
-- 1. Die Freigabe braucht ihr eigenes Recht
-- ---------------------------------------------------------------------------

create or replace function kern.dokument_kundenfreigabe_pruefen()
returns trigger language plpgsql as $$
begin
  /**
   * Beim INSERT nur, wenn die Zeile schon freigegeben zur Welt kommt.
   *
   * Der gewoehnliche Upload (`services/dokument/upload.ts`) setzt die Spalte
   * nicht und laeuft an dieser Pruefung vorbei — sonst brauchte jeder
   * Reinigungsnachweis ein Freigaberecht.
   */
  if tg_op = 'INSERT' then
    if new.sichtbar_fuer_kunde
       and not app.hat_recht('dokument.kunde_freigeben', new.mandant_id) then
      raise exception 'dokument.kunde_freigeben fehlt'
        using errcode = 'insufficient_privilege',
              detail  = 'Ein Dokument entsteht nicht bereits fuer den Kunden '
                        || 'freigegeben (DOC-04).',
              hint    = 'Erst ablegen, dann freigeben — die Freigabe ist ein eigener '
                        || 'Vorgang mit eigenem Recht.';
    end if;
    return new;
  end if;

  /**
   * Beim UPDATE beide Richtungen.
   *
   * Zurueckzunehmen ist nicht harmloser als freizugeben: wer eine Freigabe
   * still entfernt, nimmt dem Kunden einen Beleg, den er gesehen hat — und
   * `dokument_zugriff` weiss, ob er ihn schon geholt hat.
   */
  if new.sichtbar_fuer_kunde is distinct from old.sichtbar_fuer_kunde
     and not app.hat_recht('dokument.kunde_freigeben', new.mandant_id) then
    raise exception 'dokument.kunde_freigeben fehlt'
      using errcode = 'insufficient_privilege',
            detail  = 'Was ein Kunde zu sehen bekommt, entscheidet nicht, wer '
                      || 'Dokumente ablegen darf (dokument.schreiben).',
            hint    = 'Die Freigabe laeuft ueber /api/dokumente/[id]/kundenfreigabe.';
  end if;
  return new;
end $$;

comment on function kern.dokument_kundenfreigabe_pruefen() is
  'DOC-04. Bindet jede Aenderung von sichtbar_fuer_kunde an dokument.kunde_freigeben — '
  'im Ausloeser, weil t_mandant mit dokument.schreiben ein WEITERES Recht prueft, das '
  'auch die Rolle mitarbeiter haelt.';

drop trigger if exists dokument_05_kundenfreigabe on dokument;
create trigger dokument_05_kundenfreigabe
  before insert or update on dokument
  for each row execute function kern.dokument_kundenfreigabe_pruefen();

-- ---------------------------------------------------------------------------
-- 2. Die fehlende Kundendecke: freigegeben heisst freigegeben AN DIESEN Kunden
-- ---------------------------------------------------------------------------

/**
 * `kunde_id IS NOT NULL` steht ausdruecklich da.
 *
 * Ein Dokument ohne Kundenzuordnung ist im Kundenportal keine „Freigabe an
 * niemanden", sondern — ohne diese Zeile — eine Freigabe an JEDEN: `NULL = any
 * (…)` ist unbekannt, und `kunde_id = any (app.aktuelle_kunden())` waere damit
 * nicht wahr, aber der Fall soll auch nicht versehentlich ueber eine spaetere
 * `or`-Bedingung hereinkommen. Die Bedingung sagt deshalb beides: es muss eine
 * Zuordnung geben, und sie muss diesem Konto gehoeren.
 */
create policy p_kunde_dokument_zuordnung on dokument
  as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or (kunde_id is not null and kunde_id = any (app.aktuelle_kunden())))
  with check (app.portal() <> 'kunde'
              or (kunde_id is not null and kunde_id = any (app.aktuelle_kunden())));

comment on policy p_kunde_dokument_zuordnung on dokument is
  'DOC-04. Die zweite Haelfte der Kundendecke: p_kunde_ceiling prueft die Freigabe, '
  'diese Policy den Kunden. Ohne sie sieht ein Kundenkonto im Mandanten-Scope jedes '
  'freigegebene Dokument der Gesellschaft, auch das eines fremden Kunden (nachgemessen).';
