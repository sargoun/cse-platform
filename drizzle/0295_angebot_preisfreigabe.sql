-- 0295 — Die Preisfreigabe als EIGENER Vorgang (OPS-08, Invariante 7, AUT-05).

/**
 * **Der Befund.** `versendeAngebot` setzte `freigegeben_von`, `freigegeben_am`,
 * `versendet_von` und `versendet_am` in EINEM update. Preisfreigabe und
 * Versand waren damit derselbe Klick — und derselbe Klick ist nur EINE
 * Entscheidung. Der Rechtekatalog fuehrt aber zwei:
 *
 *   angebot.preis_freigeben   gebunden an super_admin, leitung   (bindbar: admin)
 *   angebot.versenden         gebunden an super_admin, leitung, admin
 *
 * Das ist ein Vier-Augen-Schnitt mit Ausnahmeweg: der Vertrieb schickt hinaus,
 * die Leitung verantwortet den Preis, und wenn eine Gesellschaft das anders
 * will, bindet sie `angebot.preis_freigeben` zusaetzlich an `admin`. Solange
 * ein Klick beides tat, hat eine Administration den Preis freigegeben, OHNE
 * dieses Recht zu halten — und zwar nicht an der Route vorbei, sondern auf dem
 * vorgesehenen Weg. Das ist der teuerste Fall: er sieht nicht aus wie eine
 * Umgehung, weil er keine ist.
 *
 * **Die zweite Linie deckte es nicht ab.** `t_mandant` auf `angebot` verlangt
 * im WITH CHECK `app.hat_recht('angebot.schreiben')` — und das halten
 * super_admin, admin UND leitung. Bei den anderen Uebergaengen dieser Runde
 * decken sich die Rollenmengen zufaellig; hier fallen sie wirklich
 * auseinander. RLS ist die zweite Verteidigungslinie, nie die einzige
 * (Invariante 3) — aber eine zweite Linie, die ein ANDERES Recht prueft als
 * das Tor, deckt den Vorgang nicht, sie deckt einen Nachbarvorgang.
 *
 * Diese Datei bringt deshalb drei Dinge, und keines davon ist eine neue
 * Geschaeftsregel:
 *
 *   1. Die Preisfreigabe ist an `angebot.preis_freigeben` gebunden — im
 *      Ausloeser, also unabhaengig davon, welcher Weg schreibt.
 *   2. `freigegeben_am` kommt von der SERVERUHR (Invariante 5). Ein Formular
 *      nennt den Zeitpunkt seiner Freigabe nicht.
 *   3. `kern.angebot_versand_pruefen` weist einen Versand OHNE Preisfreigabe
 *      ab. Die Regel „kein Versand ohne Freigabe" stand bisher NUR im
 *      CHECK `angebot_freigabe_vor_versand` — und der greift erst, wenn der
 *      Status auf `versendet` springt, mit einer Meldung ueber eine
 *      Bedingung statt ueber den Vorgang.
 *
 * TODO(client, O-732): Darf eine erteilte Preisfreigabe widerrufen werden, solange das Angebot noch nicht versendet ist — und wenn ja, durch wen und unter welcher Protokollpflicht? Bis zur Antwort ist sie unveraenderlich, und ein anderer Preis braucht eine neue Angebotsversion (dieselbe Bauart wie Invariante 4).
 */

-- ---------------------------------------------------------------------------
-- 1. Die Preisfreigabe: Recht, Serveruhr, Einmaligkeit
-- ---------------------------------------------------------------------------

create or replace function kern.angebot_preisfreigabe_pruefen()
returns trigger language plpgsql as $$
begin
  /**
   * Nur der UEBERGANG null → gesetzt ist die Freigabe.
   *
   * Jedes andere UPDATE auf dieser Zeile traegt `freigegeben_von` unveraendert
   * mit (was eine Anweisung nicht nennt, bleibt, wie es war) und laeuft
   * deshalb durch keine der Pruefungen hier. Das ist wichtig: eine Pruefung
   * auf „Spalte ist nicht null" haette jedes spaetere UPDATE eines
   * freigegebenen Angebots an ein Freigaberecht gebunden — auch das Wandeln
   * in einen Auftrag.
   */
  if old.freigegeben_von is null and new.freigegeben_von is not null then
    if not app.hat_recht('angebot.preis_freigeben', new.mandant_id) then
      raise exception 'angebot.preis_freigeben fehlt — der Preis bleibt unfreigegeben'
        using errcode = 'insufficient_privilege',
              detail  = 'Die Preisfreigabe ist ein eigener Vorgang mit eigenem Recht '
                        || '(angebot.preis_freigeben), nicht Teil des Versands.',
              hint    = 'Die Leitung gibt den Preis frei; der Versand bleibt ein '
                        || 'zweiter Klick mit eigenem Recht (Invariante 7).';
    end if;

    /**
     * Und die Freigabe ruht nicht auf Platzhaltern.
     *
     * Dieselbe Sicht, die `kern.angebot_versand_pruefen` fragt — aber EINEN
     * Schritt frueher. Sonst waere die Freigabe erteilbar und der Versand
     * danach gesperrt: die Leitung haette einen Preis verantwortet, den die
     * Datenbank nicht hinausliesse, und niemand saehe, warum.
     */
    if exists (select 1 from public.kalkulation_platzhalter kp
                where kp.angebot_id = new.id) then
      raise exception 'Kalkulation enthaelt unbestaetigte Werte — Preisfreigabe nicht moeglich'
        using errcode = 'CSE01',
              detail  = 'Offene Werte: Stundenverrechnungssatz, Gemeinkostenbasis, '
                        || 'Gemeinkosten- und Wagnis-/Gewinnzuschlag (O-16), '
                        || 'Leistungswert je Belagsart (O-17), Frequenzfaktor (O-56).',
              hint    = 'Erst die Werte bestaetigen (.../kalkulation), dann freigeben.';
    end if;

    /** Die Serveruhr, nie das Formular (Invariante 5). */
    new.freigegeben_am := now();
    return new;
  end if;

  /**
   * Nach der Freigabe ist sie unveraenderlich — O-732.
   *
   * Nicht aus Vorsicht, sondern weil es die einzige Antwort ist, die keine
   * Regel erfindet: ob ein Widerruf vorgesehen ist und wer ihn erklaeren
   * darf, ist unbeantwortet. Ein Widerruf, den wir erlauben, waere eine
   * erfundene Regel; ein Widerruf, den wir still durchlassen, waere eine
   * erfundene Regel ohne Spur. Korrigiert wird deshalb wie in Invariante 4:
   * durch eine neue Angebotsversion.
   */
  if old.freigegeben_von is not null
     and (new.freigegeben_von is distinct from old.freigegeben_von
          or new.freigegeben_am is distinct from old.freigegeben_am) then
    raise exception 'Eine erteilte Preisfreigabe ist unveraenderlich (O-732)'
      using errcode = 'check_violation',
            detail  = 'Ob ein Widerruf vorgesehen ist, ist eine offene Frage (O-732).',
            hint    = 'Ein anderer Preis braucht eine neue Angebotsversion.';
  end if;

  return new;
end $$;

comment on function kern.angebot_preisfreigabe_pruefen() is
  'OPS-08, Invariante 5 und 7. Bindet den Uebergang freigegeben_von null → gesetzt an '
  'angebot.preis_freigeben, stempelt freigegeben_am aus der Serveruhr und laesst keine '
  'Freigabe auf Platzhalterwerten zu. Nach der Freigabe unveraenderlich (O-732).';

/**
 * `05` — VOR `angebot_10_versand_pruefen`.
 *
 * Ausloeser gleicher Art laufen in Namensreihenfolge, und die Nummern in
 * `angebot_NN_…` sind genau dafuer da. Setzt jemand Freigabe und Versand doch
 * in einem UPDATE (der Seed tut es nicht mehr, ein Skript koennte es),
 * stempelt dieser Ausloeser `freigegeben_am`, BEVOR die Versandpruefung
 * darunter danach sieht. Andernfalls sperrte die Versandpruefung eine Freigabe,
 * die in derselben Anweisung steht.
 */
drop trigger if exists angebot_05_preisfreigabe on angebot;
create trigger angebot_05_preisfreigabe
  before update on angebot
  for each row execute function kern.angebot_preisfreigabe_pruefen();

-- ---------------------------------------------------------------------------
-- 2. Kein Versand ohne Preisfreigabe
-- ---------------------------------------------------------------------------

/**
 * Dieselbe Funktion wie bisher, um eine Bedingung erweitert — nicht ein
 * zweiter Ausloeser daneben.
 *
 * Zwei Ausloeser, die beide „Versand" heissen und beide etwas anderes
 * pruefen, sind zwei Stellen, an denen die naechste Bedingung fehlen kann.
 * Die Reihenfolge innerhalb der Funktion ist dagegen Absicht: zuerst die
 * offenen Werte (der haeufige Fall, mit dem ausfuehrlichen Weg heraus), dann
 * die fehlende Freigabe.
 */
create or replace function kern.angebot_versand_pruefen()
returns trigger language plpgsql as $$
begin
  if old.versendet_am is null and new.versendet_am is not null then
    if exists (select 1 from public.kalkulation_platzhalter kp
                where kp.angebot_id = new.id) then
      raise exception 'Kalkulation enthaelt unbestaetigte Werte — Versand nicht moeglich'
        using errcode = 'CSE01',
              detail = 'Offene Werte: Stundenverrechnungssatz, Gemeinkostenbasis, '
                       || 'Gemeinkosten- und Wagnis-/Gewinnzuschlag (O-16).',
              hint = 'Werte bestaetigen oder die Kalkulation vom Angebot loesen.';
    end if;

    /**
     * NEU: keine Freigabe, kein Versand.
     *
     * Der CHECK `angebot_freigabe_vor_versand` faengt denselben Fall — aber
     * erst am Statuswechsel und mit einer Meldung ueber eine Bedingung
     * („violates check constraint") statt ueber den Vorgang. Wer das im
     * Portal sieht, liest es als Fehler der Anwendung, nicht als fehlenden
     * Arbeitsschritt. Und ein Versand mit `status = 'in_pruefung'` liefe am
     * CHECK ganz vorbei, weil dessen erster Zweig diesen Status erlaubt.
     */
    if new.freigegeben_von is null or new.freigegeben_am is null then
      raise exception 'Ohne Preisfreigabe kein Versand (Invariante 7)'
        using errcode = 'CSE03',
              detail = 'freigegeben_von/freigegeben_am sind leer — den Preis hat '
                       || 'niemand verantwortet.',
              hint = 'Erst die Preisfreigabe (.../freigabe, Recht '
                     || 'angebot.preis_freigeben), dann der Versand.';
    end if;
  end if;
  return new;
end $$;

comment on function kern.angebot_versand_pruefen() is
  'Invariante 7. Kein Versand auf Platzhalterwerten (O-16, O-17, O-56) und keiner ohne '
  'Preisfreigabe. Zweite Linie zu /api/angebot/freigabe und /api/angebot.';
