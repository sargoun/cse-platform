-- ===========================================================================
-- 0389 — Der Auftragsstatus bewegt sich (V-081, OPS-05)
-- ===========================================================================
--
-- **Der Befund.** `auftrag_status` kennt seit `0025` fuenf Zustaende:
-- `angelegt`, `aktiv`, `pausiert`, `abgeschlossen`, `storniert`. Geschrieben
-- wurde genau EINER — `abgeschlossen`, vom Abschlussdienst (`0296`). Jeder
-- Auftrag stand also von seiner Anlage bis zu seinem Ende auf `angelegt`,
-- waehrend die Auftragsliste ihn als „Geplant" beschriftete und das
-- Auftragsblatt vier weitere Etiketten kannte, die nie jemand sah.
--
-- Im Betrieb fehlt damit genau das, was eine Auftragsliste taeglich braucht:
-- laeuft dieser Vertrag, ruht er (Objekt geschlossen, Kunde hat unterbrochen),
-- oder ist er storniert worden, bevor er begann.
--
-- **Ein Zustandswechsel ohne Grund ist eine Behauptung ohne Beleg.**
-- Ein pausierter Auftrag kostet Umsatz, ein stornierter kostet den ganzen
-- Vertrag — und beide Fragen kommen spaeter: warum ruht der seit Maerz, und
-- wer hat den storniert. `status_grund` haelt die Antwort fest, und der CHECK
-- unten haelt sie mit dem Zustand zusammen. Dieselbe Form wie bei der
-- Fristverlaengerung einer Betroffenenanfrage (`0176`) und beim
-- Identitaetszweifel (`0388`).
--
-- **`angelegt` und `aktiv` brauchen keinen** — sie sind der Normalweg. Ein
-- Pflichtfeld davor waere eine Huerde vor dem Regelfall.

alter table auftrag
  add column status_grund          text,
  add column status_geaendert_am   timestamptz;

comment on column auftrag.status_grund is
  'OPS-05. WARUM der Auftrag ruht oder storniert wurde. Pflicht fuer '
  'pausiert und storniert, sonst leer — der Normalweg braucht keine Begruendung.';

comment on column auftrag.status_geaendert_am is
  'Wann der Zustand zuletzt wechselte. Setzt der Ausloeser aus der SERVERUHR '
  '(Invariante 5), nie der Aufrufer.';

/**
 * Ruhen und Stornieren tragen ihren Grund.
 *
 * Geprüft wird auf nicht-leer nach `btrim`: ein Feld mit zwei Leerzeichen ist
 * kein Grund, und ein CHECK auf `is not null` allein liesse genau das durch.
 */
alter table auftrag
  add constraint auftrag_statusgrund_begruendet check (
    status not in ('pausiert', 'storniert')
    or btrim(coalesce(status_grund, '')) <> '');

-- ---------------------------------------------------------------------------
-- Der Übergang — im AUSLÖSER, wie der Abschluss (0296)
-- ---------------------------------------------------------------------------

/**
 * **Warum die Tabelle der erlaubten Wege hierher gehört und nicht nur in den
 * Dienst.**
 *
 * `0296` sagt es für den Abschluss bereits: eine Policy kann nicht sehen,
 * WELCHE Spalte sich ändert, und die zweite Linie muss DIESEN Vorgang prüfen
 * und nicht zufällig denselben Rollenkreis treffen. Für den Zustand gilt es
 * doppelt: `storniert` ist einwegig, und ein Weg zurück drehte eine
 * Entscheidung um, die jemand getroffen hat — ohne Spur, wenn ihn nur der
 * Dienst kennt.
 *
 * Die erlaubten Wege:
 *
 *   angelegt   → aktiv, pausiert, storniert
 *   aktiv      → pausiert, storniert
 *   pausiert   → aktiv, storniert
 *   abgeschlossen → (nichts — einwegig seit 0296, O-734)
 *   storniert  → (nichts — einwegig, siehe unten)
 *
 * `abgeschlossen` erreicht man weiterhin NUR über den Abschlussdienst: der
 * Zweig oben in dieser Funktion bindet ihn an `auftrag.abschliessen` und
 * setzt `abgeschlossen_am` mit. Diese Tabelle ändert daran nichts — sie
 * verbietet nur, was vorher niemand verbot.
 *
 * **Warum `storniert` einwegig ist.** Ein Storno ist die Aussage „dieser
 * Vertrag kommt nicht zustande" — sie geht nach aussen, sie steht in der
 * Kundenakte, und FIN-18 nimmt den Auftrag daraufhin von der Prüfliste
 * (`0183`). Ein stiller Weg zurück machte aus einem beendeten Vorgang wieder
 * einen laufenden, und niemand sähe, dass er einmal beendet war. Wer sich
 * geirrt hat, legt einen neuen Auftrag an — dieselbe Antwort, die `0296` für
 * den Abschluss gibt.
 */
create or replace function kern.auftrag_status_pruefen()
returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status then
    /*
     * Kein Wechsel — aber der GRUND darf trotzdem nicht verschwinden: eine
     * Auftragspflege, die `status_grund` leert, liesse einen pausierten
     * Auftrag ohne Angabe stehen. Der CHECK oben faengt das; hier steht
     * nichts, damit jede andere Aenderung ungehindert durchlaeuft.
     */
    return new;
  end if;

  if old.status = 'storniert' then
    raise exception 'Ein stornierter Auftrag wird nicht wieder aufgenommen'
      using errcode = 'check_violation',
            detail  = 'Das Storno ist die Aussage, dass dieser Vertrag nicht '
                      || 'zustande kommt; sie steht in der Kundenakte und nimmt '
                      || 'den Auftrag von der FIN-18-Pruefliste (0183).',
            hint    = 'Wer sich geirrt hat, legt einen neuen Auftrag an.';
  end if;

  /*
   * `abgeschlossen` sperrt bereits `kern.auftrag_uebergang_pruefen` (0296,
   * O-734) in beide Richtungen; hier wird nur der Hinweg abgefangen, damit
   * niemand den Abschlussdienst umgeht.
   */
  if new.status = 'abgeschlossen' then
    return new;
  end if;

  if not (
       (old.status = 'angelegt' and new.status in ('aktiv', 'pausiert', 'storniert'))
    or (old.status = 'aktiv'    and new.status in ('pausiert', 'storniert'))
    or (old.status = 'pausiert' and new.status in ('aktiv', 'storniert'))
  ) then
    raise exception 'Der Weg von % nach % ist am Auftrag nicht vorgesehen',
      old.status, new.status
      using errcode = 'check_violation',
            hint = 'angelegt → aktiv/pausiert/storniert, aktiv → pausiert/storniert, '
                   || 'pausiert → aktiv/storniert. Abgeschlossen wird ueber den '
                   || 'Abschlussvorgang (auftrag.abschliessen).';
  end if;

  -- Die SERVERUHR, nie der Aufrufer (Invariante 5).
  new.status_geaendert_am := now();
  return new;
end $$;

comment on function kern.auftrag_status_pruefen() is
  'OPS-05, V-081. Die Tabelle der erlaubten Zustandswege am Auftrag. Storniert '
  'ist einwegig; abgeschlossen bleibt dem Abschlussvorgang (0296) vorbehalten.';

/**
 * `auftrag_06_status` — NACH `auftrag_05_uebergang`.
 *
 * Gleichartige Auslöser laufen in Namensreihenfolge. `0296` setzt im
 * Abschlusszweig `new.status := 'abgeschlossen'` selbst; liefe diese Prüfung
 * davor, sähe sie den Zustand, den der Aufrufer geschickt hat, und nicht den,
 * der entsteht. Die Reihenfolge ist also nicht Geschmack, sondern die Frage,
 * welchen Wert die Tabelle oben zu sehen bekommt.
 */
drop trigger if exists auftrag_06_status on auftrag;
create trigger auftrag_06_status
  before update on auftrag
  for each row execute function kern.auftrag_status_pruefen();
