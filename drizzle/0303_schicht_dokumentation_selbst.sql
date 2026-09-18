-- 0303 — Die eigene Schicht DOKUMENTIEREN: Aufnahmen und Bautagebuch
--        (TIM-10, DOC-03, DOC-06, BAU-07, LEG-10, AUT-05, K-19).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- `einsatz_medien` nimmt aus einer angemeldeten Mitarbeitersitzung in KEINEM
-- Scope eine Zeile an. Die INSERT-Policies der Tabelle:
--
--   t_mandant                 WITH CHECK app.hat_recht('zeit.schreiben')
--   t_bau_medien              nur bezug_tabelle = 'aufmass'
--   t_bau_tagebuch_medien     nur bezug_tabelle = 'bautagebuch', bau.schreiben
--   me_definer_insert         nur fuer die Rolle cse_definer
--
-- `zeit.schreiben` und `bau.schreiben` haelt die Rolle `mitarbeiter` nicht,
-- und `me_definer_insert` gehoert `app.offline_ereignis_annehmen` — also dem
-- CHECK-IN-WEG mit der Marke (K-08), nicht der angemeldeten Sitzung. Gegen die
-- lebende Datenbank gemessen, als Mitarbeiterin auf den EIGENEN Zeiteintrag:
-- „new row violates row-level security policy for table einsatz_medien" — im
-- Mandantenscope wie im Personen-Scope.
--
-- Damit gibt es im Mitarbeiterportal heute kein Schichtfoto, kein Tagesfoto am
-- Bautag und keinen Bildanhang am Wachbucheintrag. Der Check-in mit der Marke
-- kann es, die ANGEMELDETE Kraft nicht — und das ist keine Entscheidung,
-- sondern eine Luecke: TIM-10 nennt die Aufnahme ausdruecklich als Teil der
-- Schicht, und DOC-06 verlangt sie als Zustandsbeweis.
--
-- ===========================================================================
-- Woran das Foto haengt: am EINSATZ, nicht am Zeiteintrag
-- ===========================================================================
--
-- `einsatz_medien_bezug` fuehrt acht Bezugstabellen, und `einsatz` ist eine
-- davon (`einsatz | dienstplan | kunde_id`; die CHECK-Bedingung `mb_bekannt`
-- laesst sie zu). Eine Schicht HAT immer ihren Einsatz — `findeEigeneSchicht`
-- gibt seine Kennung zurueck —, waehrend ein Zeiteintrag erst mit dem
-- Einstempeln entsteht. Das Foto am Zeiteintrag aufzuhaengen hiesse: vor dem
-- Einstempeln kein Foto. Genau das waere die Aufnahme, die die Kraft machen
-- will, wenn sie vor einer verschlossenen Tuer steht.
--
-- (`einsatz_medien.zeiteintrag_id` ist eine GENERATED-Spalte aus
-- `bezug_tabelle = 'zeiteintrag'` und wird nie mitgeschrieben.)
--
-- ===========================================================================
-- Wie die Policy eng bleibt, ohne ein Recht zu erfinden
-- ===========================================================================
--
-- Die Abgrenzung kommt nicht aus einem Rechteschluessel (K-19: „nur der
-- Betroffene" ist kein Recht), sondern aus der SICHTBARKEIT DES ELTERNTEILS:
--
--   Der Einschub `exists (select 1 from einsatz e where …)` laeuft als
--   `cse_app` und mit der RLS von `einsatz`. Im M1-Scope des
--   Mitarbeiterportals sieht die Kraft dort GENAU ihre eigenen Schichten
--   (`einsatz.t_selbst_m1`, 0300) — also kann das Foto nur an einer eigenen
--   Schicht haengen. Dasselbe fuer `bautagebuch`: dort zeigt
--   `bautagebuch.t_selbst_m1` (0304) nur die Bautage von Projekten, auf denen
--   sie eingesetzt ist.
--
-- Die Bedingung ist damit dieselbe, die auch die Seite zeigt, und sie kann
-- nicht auseinanderlaufen: wer den Elternteil nicht sehen kann, kann kein Bild
-- daran haengen. Der Ausloeser `kern.einsatz_medien_bezug_pruefen` (0041)
-- prueft zusaetzlich als Definer, dass der Elternteil existiert UND im selben
-- Mandanten liegt, und leitet `kunde_id` daraus ab — auch das bleibt, wie es
-- ist.
--
-- Dazu drei Bedingungen, die die Zeile an den MENSCHEN binden:
-- `erstellt_von_art = 'mensch'`, `erstellt_von_person_id =
-- app.aktuelle_person()` und `app.portal() = 'mitarbeiter'`. Die erste
-- verhindert, dass dieser Weg zu einem Agentenweg wird (Invariante 6/7), die
-- zweite ist die Selbstbindung, und ueber ihr steht ohnehin `p_ma_decke`, die
-- im Mitarbeiterportal nur eigene Aufnahmen durchlaesst.
--
-- **Kein Loeschen, kein Aendern.** Die Policy ist `for insert`. Eine Aufnahme
-- ist ein Beweis; sie wird archiviert, nie entfernt (Invariante 8, LEG-09).
-- ===========================================================================

create policy t_selbst_schichtmedien on einsatz_medien for insert to cse_app
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  /*
   * Die Kraft legt als MENSCH ab. `me_akteur_stimmig` verlangt bei
   * `erstellt_von_art = 'mensch'` ein `erstellt_von`; die Selbstbindung
   * darunter verlangt zusaetzlich die Person — ein Konto ohne Person kommt
   * hier nicht durch, weil `app.aktuelle_person()` dann NULL ist und der
   * Vergleich nie wahr wird.
   */
  and erstellt_von_art = 'mensch'
  and erstellt_von_person_id = app.aktuelle_person()
  /* Eine Aufnahme entsteht lebend. Archiviert wird sie spaeter, von anderen. */
  and archiviert_am is null
  and storage_geloescht_am is null
  and (
    (bezug_tabelle = 'einsatz' and exists (
      select 1 from einsatz e
       where e.mandant_id = einsatz_medien.mandant_id
         and e.id = einsatz_medien.bezug_id
    ))
    or
    (bezug_tabelle = 'bautagebuch' and exists (
      select 1 from bautagebuch b
       where b.mandant_id = einsatz_medien.mandant_id
         and b.id = einsatz_medien.bezug_id
    ))
  )
);

comment on policy t_selbst_schichtmedien on einsatz_medien is
  'TIM-10, DOC-06, BAU-07 (0303): die Aufnahme der angemeldeten Kraft an der '
  'eigenen Schicht (bezug einsatz) oder am Bautag ihres Projekts (bezug '
  'bautagebuch). Die Abgrenzung kommt aus der SICHTBARKEIT des Elternteils '
  'unter der RLS von einsatz bzw. bautagebuch, nicht aus einem erfundenen '
  'Rechteschluessel (K-19). Nur INSERT — ein Beweis wird nicht geaendert.';

-- ===========================================================================
-- Teil 2: das Bautagebuch der eigenen Baustelle (BAU-07)
-- ===========================================================================
--
-- **Der Befund.** Lesen kann die Kolonne ihren Bautag im Personen-Scope schon
-- (`bautagebuch.t_person` ueber `app.ist_eingesetzt_auf_projekt`, plus die
-- Decke `p_intern_einsatz_decke`, die den Mitarbeiterzweig ausdruecklich
-- traegt). SCHREIBEN scheitert auf allen drei Tabellen am selben Recht:
--
--   bautagebuch.t_mandant             WITH CHECK app.hat_recht('bau.schreiben')
--   bautagebuch_mannstunden.t_mandant WITH CHECK app.hat_recht('bau.schreiben')
--   bautagebuch_position.t_mandant    WITH CHECK app.hat_recht('bau.schreiben')
--
-- Gemessen: als Mitarbeiterin im Mandantenscope „new row violates row-level
-- security policy for table bautagebuch".
--
-- **`bau.schreiben` zu binden waere zu breit.** Das Recht traegt in der
-- WITH-CHECK-Haelfte auch `lv_position`, `nachtrag` und die Aufmassfreigabe:
-- wer das Tagebuch fuehrt, bekaeme damit das Leistungsverzeichnis und die
-- Nachtragsanmeldung. Ein NEUES Recht (`bau.bautagebuch_erfassen`) ginge nicht
-- ohne den Katalog in `03-AUTH-BERECHTIGUNGEN.md` §12 und die daraus erzeugte
-- Migration 0008 — und waere ohnehin die falsche Form: das Register und
-- 04-SEITENKARTE §7 fuehren diese Route als `S`, Selbstzugriff. Also dieselbe
-- Bauart wie ueberall sonst im Mitarbeiterportal: eine schmale Policy auf
-- `app.aktuelle_person()` und `app.ist_eingesetzt_auf_projekt` — dasselbe
-- Praedikat, das die restriktive Decke der Tabelle schon nennt.
--
-- **Kein Abschluss, keine Gegenzeichnung.** Die Kolonne fuegt AN. Den Tag
-- schliessen (`abgeschlossen_am`) und gegenzeichnen (§3.3, die Bauleitung des
-- Auftraggebers) bleiben `bau.schreiben` — deshalb gibt es unten keine
-- UPDATE-Policy auf `bautagebuch`, sondern nur INSERT.
--
-- **Ein Storno nur auf der EIGENEN Zeile.** `korrigiereMannstunden` und
-- `korrigierePosition` setzen die alte Zeile auf storniert und die neue
-- daneben (BAU-07, LEG-01: nie ein Aendern). Die UPDATE-Policies unten lassen
-- genau diesen Uebergang zu — `storniert_am is null` -> `not null` — und nur
-- auf Zeilen, die dieser Mensch selbst erfasst hat. Die Zeile der Bauleitung
-- bleibt unberuehrbar.

create policy t_selbst_m1 on bautagebuch for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
);

create policy t_selbst_m1_erfassen on bautagebuch for insert to cse_app
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  /* Ein Tag entsteht als Entwurf. Abgeschlossen oder storniert anzulegen
   * hiesse, einen Tag zu erzeugen, den niemand mehr fuellen kann. */
  and status = 'entwurf'
  and abgeschlossen_am is null
  and storniert_am is null
  and gegengezeichnet_am is null
  and exists (select 1 from mandant m
               where m.id = mandant_id and m.archiviert_am is null)
);

comment on policy t_selbst_m1 on bautagebuch is
  'BAU-07 (0303): der Bautag des eigenen Projekts im M1-Scope des '
  'Mitarbeiterportals — Praedikat wie in p_intern_einsatz_decke. Ohne ihn '
  'liefert offenerKopf() null Zeilen, weil t_mandant bau.lesen verlangt.';
comment on policy t_selbst_m1_erfassen on bautagebuch is
  'BAU-07 (0303): die Kolonne OEFFNET den Tag ihres Projekts. Nur als '
  'Entwurf und nur INSERT — Abschluss und Gegenzeichnung bleiben '
  'bau.schreiben.';

create policy t_selbst_m1 on bautagebuch_mannstunden for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
);

create policy t_selbst_m1_erfassen on bautagebuch_mannstunden for insert to cse_app
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  and erstellt_von_art = 'mensch'
  and erstellt_von_person_id = app.aktuelle_person()
  and storniert_am is null
);

create policy t_selbst_m1_storno on bautagebuch_mannstunden for update to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  and storniert_am is null
  and erstellt_von_person_id = app.aktuelle_person()
)
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  /* Nur der eine Uebergang: stornieren. Ein Aendern der Stunden faellt hier. */
  and storniert_am is not null
  and ersetzt_durch_id is not null
  and erstellt_von_person_id = app.aktuelle_person()
);

create policy t_selbst_m1 on bautagebuch_position for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
);

create policy t_selbst_m1_erfassen on bautagebuch_position for insert to cse_app
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  and erstellt_von_art = 'mensch'
  and erstellt_von_person_id = app.aktuelle_person()
  and storniert_am is null
);

create policy t_selbst_m1_storno on bautagebuch_position for update to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  and storniert_am is null
  and erstellt_von_person_id = app.aktuelle_person()
)
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and app.ist_eingesetzt_auf_projekt(projekt_id)
  and storniert_am is not null
  and ersetzt_durch_id is not null
  and erstellt_von_person_id = app.aktuelle_person()
);

comment on policy t_selbst_m1_storno on bautagebuch_mannstunden is
  'BAU-07, LEG-01 (0303): die Korrekturspur der EIGENEN Zeile. USING nur '
  'lebende Zeilen dieses Menschen, WITH CHECK nur den Uebergang auf '
  'storniert mit Verweis auf die Ersatzzeile — kein Aendern von Stunden.';

-- ---------------------------------------------------------------------------
-- Der Gewerkekatalog — LESBAR fuer die Kolonne
-- ---------------------------------------------------------------------------
--
-- **Der stille Fehler, den das verhindert.** `leseMannstunden` verbindet die
-- Zeile mit `gewerk` als INNER JOIN (der Gewerkename steht in jeder Zeile).
-- `gewerk.p_intern_decke` laesst als RESTRICTIVE Policy nur das interne Portal
-- durch — im Mitarbeiterportal waeren damit nicht „die Gewerke unbekannt",
-- sondern die MANNSTUNDENZEILEN VERSCHWUNDEN. Die Seite zeigte einen leeren
-- Tag und behauptete damit, es seien keine Stunden erfasst.
--
-- Der Katalog ist eine Stammliste von Gewerkenamen (Rohbau, Elektro) — kein
-- Preis, kein Lohn, kein Kunde. Was er der Kolonne verraet, ist, unter welchem
-- Gewerk ihre eigenen Stunden stehen, und genau das muss sie lesen koennen.
-- Das Recht ist `bau.aufmass_erfassen` — dasselbe, mit dem
-- `projekt.t_erfassen_lesen` (0089) der Kolonne ihr Projekt oeffnet, und es
-- ist der Mitarbeiterrolle im Katalog gebunden. Kein neuer Schluessel.
--
-- Die Decke wird dafuer NEU GESETZT und nicht erweitert — eine Policy laesst
-- sich nicht aendern. Der `intern`-Zweig steht darin wortgleich wie in 0082;
-- hinzu kommt der Mitarbeiterzweig, und er traegt das Recht mit, damit die
-- Decke fuer sich schon eng ist.

drop policy p_intern_decke on gewerk;

create policy p_intern_decke on gewerk as restrictive for all to cse_app
  using (app.portal() in ('intern', 'mitarbeiter'));

/**
 * Lesen, in BEIDEN Scopes des Mitarbeiterportals.
 *
 * `app.sichtbare_mandanten()` ist im M1-Scope genau der aktive Mandant und im
 * Personen-Scope die lebenden Beschaeftigungen dieses Menschen (0004) — die
 * Seite liest im Personen-Scope, die Erfassung schreibt im M1-Scope, und beide
 * brauchen denselben Namen. Ein Recht steht nicht davor: der Gewerkekatalog
 * ist eine Liste von Gewerkenamen, kein Preis und kein Lohn, und ihn an
 * `bau.lesen` zu binden hiesse, die Kolonne von den Namen ihrer eigenen
 * Stunden auszuschliessen.
 */
create policy t_mitarbeiter_lesen on gewerk for select to cse_app
  using (app.portal() = 'mitarbeiter'
         and mandant_id = any (app.sichtbare_mandanten()));

comment on policy t_mitarbeiter_lesen on gewerk is
  'BAU-07 (0303): die Kolonne LIEST den Gewerkekatalog. Ohne ihn faellt der '
  'INNER JOIN in leseMannstunden, und die Seite zeigt einen leeren Bautag '
  'statt der erfassten Stunden. Nur lesend, in beiden Scopes des '
  'Mitarbeiterportals, begrenzt auf die Gesellschaften der eigenen '
  'Beschaeftigungen — kein Schreibweg auf die Stammliste.';
