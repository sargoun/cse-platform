-- 0381 — das Modellregister ohne SQL-Zeile (V-120, D-04, §3.6).
--
-- ===========================================================================
-- Der Befund — ein Nutzerbericht beim Einrichten
-- ===========================================================================
--
-- `docs/EINRICHTEN-*.md` §9 sagt dem Betreiber, er solle den KI-Schluessel
-- setzen — und danach eine Zeile `insert into modell_register …` von Hand in
-- der Datenbank ausfuehren. Genau dort ist der Mandant stehengeblieben:
--
--     „وشو هاد السطر insert into modell_register … شو هدون؟"
--     („Was IST diese Zeile ueberhaupt?")
--
-- Er hat recht, und der Fehler liegt nicht in der Dokumentation. `0154` gibt
-- `cse_app` auf `modell_register` **nur `select`** — keine Policy, kein
-- Grant, kein Schreibweg. Die einzige Art, ein Modell freizugeben, war eine
-- handgeschriebene SQL-Anweisung in einem Datenbankwerkzeug.
--
-- **Das ist mehr als unbequem.** Wer SQL von Hand schreibt, um eine
-- Rechtsaussage einzutragen, schreibt sie ohne Formular, ohne Pflichtfelder
-- und ohne dass sein Name irgendwo landet: `geprueft_von` haette er selbst
-- eintippen muessen, und niemand haette gemerkt, wenn er es liess. Der CHECK
-- `mr_fremder_anbieter_braucht_menschen` faengt genau das — aber erst als
-- Datenbankfehler, den der Betreiber nicht lesen kann.
--
-- ===========================================================================
-- Was diese Migration oeffnet — und was sie geschlossen laesst
-- ===========================================================================
--
-- **Eintragen und aendern: ja. Loeschen: nein.** Das Register ist der Beleg,
-- WER wann bezeugt hat, dass ein Modell rechtlich benutzt werden darf. Eine
-- geloeschte Zeile nimmt diesen Beleg mit; zurueckgenommen wird eine Freigabe
-- durch `freigegeben = false`, und die Zeile bleibt stehen.
--
-- **`geprueft_von` setzt die DATENBANK, nicht das Formular.** Ein Feld, in
-- das der Betreiber einen Namen tippt, ist keine Bezeugung — es ist eine
-- Behauptung ueber einen Dritten. Der Ausloeser unten setzt
-- `app.aktueller_benutzer()`, und zwar bei jedem Schreibvorgang neu: wer die
-- Freigabe aendert, ist danach der, der sie bezeugt.
--
-- **Das Recht ist `system.einstellung_verwalten`** (gebunden an
-- `super_admin`, bindbar an `admin`). Es ist dasselbe Recht wie fuer die
-- uebrigen Plattformeinstellungen — und ein eigenes waere eines, das genau
-- die Menschen zusaetzlich braeuchten, die die Einrichtung ohnehin machen
-- (K-19).

/**
 * Der Zeuge wird gesetzt, nicht eingetippt.
 *
 * **Und `geprueft_am` mit ihm.** Die beiden gehoeren zusammen: ein Zeitpunkt
 * ohne Zeugen sagt „irgendwann hat jemand", ein Zeuge ohne Zeitpunkt „wer
 * weiss wann". Der CHECK `mr_freigabe_hat_zeitpunkt` verlangt den Zeitpunkt
 * ohnehin, sobald `freigegeben` steht — hier entsteht er von selbst, statt
 * dass ein Formular ihn mitschicken muesste.
 *
 * **Bei `anbieter = 'demo'` bleibt beides leer, wenn nichts freigegeben
 * wird.** Der Demobetrieb laeuft im eigenen Prozess; ihn mit einem Zeugen zu
 * versehen hiesse, eine Bezeugung zu erfinden, die niemand abgegeben hat.
 */
create function kern.modell_register_zeuge() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.freigegeben then
    new.geprueft_von := coalesce(app.aktueller_benutzer(), new.geprueft_von);
    new.geprueft_am  := coalesce(new.geprueft_am, now());
  end if;
  return new;
end $$;

comment on function kern.modell_register_zeuge() is
  'V-120, D-04. `geprueft_von` ist eine Bezeugung und kein Eingabefeld: ein '
  'Name, den jemand eintippt, ist eine Behauptung ueber einen Dritten. Die '
  'Datenbank setzt den, der tatsaechlich schreibt.';

create trigger trg_modell_register_zeuge
  before insert or update on modell_register
  for each row execute function kern.modell_register_zeuge();

-- ---------------------------------------------------------------------------
-- Der Schreibweg
-- ---------------------------------------------------------------------------
--
-- **Ohne `mandant_id`, und das ist kein Versehen.** `modell_register` traegt
-- keine — ein freigegebenes Modell gilt fuer die ganze Gruppe, weil der
-- Auftragsverarbeitungsvertrag fuer die ganze Gruppe gilt. Die Policy haengt
-- deshalb am RECHT im aktiven Mandanten und nicht an einer Mandantenspalte,
-- die es nicht gibt.

create policy t_modell_register_schreiben on modell_register for insert to cse_app
  with check (not app.ist_readonly()
              and not app.ist_gruppenansicht()
              and app.aal() = 'aal2'
              and (select app.hat_recht('system.einstellung_verwalten',
                                        app.aktiver_mandant())));

create policy t_modell_register_aendern on modell_register for update to cse_app
  using      ((select app.hat_recht('system.einstellung_verwalten',
                                    app.aktiver_mandant())))
  with check (not app.ist_readonly()
              and not app.ist_gruppenansicht()
              and app.aal() = 'aal2'
              and (select app.hat_recht('system.einstellung_verwalten',
                                        app.aktiver_mandant())));

comment on policy t_modell_register_schreiben on modell_register is
  'V-120. Der Weg, den `docs/EINRICHTEN-*.md` §9 bis hierher als '
  'handgeschriebene SQL-Anweisung beschreiben musste. aal2, weil die Zeile '
  'eine Rechtsaussage ist und kein Schalter (K-15).';

grant insert, update on modell_register to cse_app;

-- Kein DELETE — und kein Grant dafuer (Invariante 8, §3.6).
revoke delete, truncate on modell_register from cse_app, cse_anon, cse_checkin, cse_job;
