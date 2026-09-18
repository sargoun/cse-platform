-- 0300 — Die eigene Schicht im M1-Scope des Mitarbeiterportals LESEN
--        (EMP-02, EMP-13, K-04, K-18, AUT-05, AUT-06).
--
-- ===========================================================================
-- Der Befund, der diese Migration gebracht hat
-- ===========================================================================
--
-- Jeder Schreibweg des Mitarbeiterportals faehrt die PER->M1-Bruecke: die
-- Zuordnung wird im Personen-Scope aufgeloest (dort traegt `t_person` die
-- Abgrenzung), der Mandant DARAUS abgeleitet (nie aus einem Feld der Anfrage,
-- K-02), und dann wird `withTenant` mit `portal = 'mitarbeiter'` betreten,
-- damit die restriktiven K-04-Decken stehen bleiben. Das ist das gelebte
-- Muster von `api/zeit/einwand` und `api/mein/antraege`.
--
-- Im M1-Scope sieht die Arbeiterin ihre eigene Schicht dann aber NICHT:
--
--   einsatz.t_mandant            USING app.hat_recht('dienstplan.lesen')
--   einsatz_zuordnung.t_mandant  USING app.hat_recht('dienstplan.lesen')
--   objekt.t_mandant             USING app.hat_recht('objekt.lesen')
--
-- Die Rolle `mitarbeiter` haelt genau acht Rechte — aufgabe.schreiben,
-- bau.aufmass_erfassen, dokument.schreiben, nachricht.versenden,
-- nachweis.schreiben, schluessel.schreiben, wachbuch.schreiben,
-- zeit.abwesenheit_melden — und keines der drei oben. `t_person` greift nicht,
-- weil sie `app.scope() = 'person'` verlangt und wir im Mandantenscope stehen.
--
-- Die Folge ist nicht ein Rechtefehler, sondern NULL ZEILEN UND KEIN FEHLER,
-- und zwar mitten in einer Vorpruefung:
--
--   `schreibeEintrag` (Wachbuch) prueft `select objekt_id from einsatz
--   where id = $1` und wirft bei null Zeilen `BezugPasstNichtZumObjekt`.
--   Gegen die lebende Datenbank gemessen: die EIGENE Schicht kommt mit 0
--   Zeilen zurueck, also weist der Dienst den eigenen Eintrag ab — mit der
--   Meldung, der Bezug gehoere zu einem anderen Objekt. Er gehoert ihr.
--
-- Genau diese Verwechslung von „null Zeilen" mit „nichts da" beschreibt
-- AUT-05. Der Weg heraus ist nicht, `dienstplan.lesen` der Mitarbeiterrolle zu
-- binden — das oeffnete ihr den GANZEN Dienstplan aller Kolleginnen, also die
-- Personalplanung der Gesellschaft (EMP-13, K-05). Der Weg heraus ist eine
-- SCHMALE permissive Policy je Tabelle: dasselbe, was die Arbeiterin im
-- Personen-Scope ohnehin sieht, im Mandantenscope ihres eigenen
-- Mitarbeiterportals.
--
-- ===========================================================================
-- Warum kein neuer Rechteschluessel
-- ===========================================================================
--
-- „Nur der Betroffene" laesst sich als Recht nicht ausdruecken: ein Recht
-- gehoert einer Rolle und eine Rolle vielen Menschen (K-19, 04-SEITENKARTE §7:
-- „Almost nothing here is a permission. Self-access ... is a policy branch
-- keyed on the server-set `app.person_id` GUC, not a right"). Ein erfundener
-- Schluessel muesste jeder Mitarbeiterrolle gebunden werden, wuerde also
-- nichts pruefen und dabei behaupten, man pruefe — und `super_admin` bekaeme
-- ihn mit. Dieselbe Begruendung tragen `antrag.t_selbst_einreichen`,
-- `zeit_einwand.t_selbst_einreichen` und `da_kenntnisnahme.t_selbst_bestaetigen`.
--
-- ===========================================================================
-- Die Praedikate: DASSELBE, was die Tabelle schon sagt
-- ===========================================================================
--
-- Hier wird kein neues Zugangsmodell erfunden. Jede Policy unten benutzt genau
-- das Praedikat, das die restriktive Decke DERSELBEN Tabelle bereits benutzt:
--
--   einsatz.p_ma_decke            EXISTS eigene, nicht entfernte Zuordnung
--   einsatz_zuordnung.p_ma_decke  anstellung_id IN (eigene Anstellungen)
--
-- Damit kann keine dieser Policies mehr zulassen, als die Decke ohnehin
-- durchlaesst: sie machen den Weg erreichbar, den die Decke schon beschreibt.
-- `objekt` traegt keine Mitarbeiterdecke; dort steht das Praedikat der
-- Plattform fuer „ich arbeite dort" — `app.ist_eingesetzt_auf_objekt`, dieselbe
-- Funktion, die `leistungsnachweis.p_portal_decke` und `projekt.p_portal_decke`
-- benutzen.
--
-- **Kein Schreibrecht entsteht hier.** Alle drei Policies sind `for select`.
-- Was geschrieben werden darf, entscheidet weiter die `WITH CHECK`-Haelfte der
-- jeweiligen Tabelle — ein Dienstplan bleibt fuer die Arbeiterin unschreibbar.
-- ===========================================================================

/**
 * Die eigene, nicht entfernte Zuordnung — im Mitarbeiterportal, im
 * Mandantenscope.
 *
 * `entfernt_am is null` steht hier und NICHT in `t_person`: diese Policy ist
 * das Tor eines SCHREIBWEGS, und eine aus dem Plan genommene Einteilung soll
 * lesbar bleiben (die Detailseite zeigt sie), aber nichts mehr tragen. Die
 * Seite im Personen-Scope behaelt ihre eigene Sicht.
 */
create policy t_selbst_m1 on einsatz_zuordnung for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and person_id = app.aktuelle_person()
  and entfernt_am is null
);

comment on policy t_selbst_m1 on einsatz_zuordnung is
  'EMP-02, K-18 (0300): die EIGENE Einteilung im M1-Scope des '
  'Mitarbeiterportals. Ohne sie liefert jede PER->M1-Vorpruefung null Zeilen, '
  'weil t_mandant dienstplan.lesen verlangt und die Rolle mitarbeiter es nicht '
  'haelt (AUT-05). Nur lesend, nur die eigene Person, nur nicht entfernte '
  'Zeilen.';

/**
 * Die Schicht, auf der ich eingeteilt bin.
 *
 * Wortgleich mit dem Praedikat von `einsatz.p_ma_decke` — absichtlich: die
 * Decke beschreibt bereits, was das Mitarbeiterportal von `einsatz` sehen
 * darf, sie kann als RESTRICTIVE Policy aber nichts zulassen. Diese Zeile
 * macht den beschriebenen Weg erreichbar.
 *
 * Der Einschub liest `einsatz_zuordnung`, und dessen RLS gilt dabei mit (das
 * ist der Grund, warum die Policy oben zuerst kommt).
 */
create policy t_selbst_m1 on einsatz for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and exists (
    select 1 from einsatz_zuordnung z
     where z.mandant_id = einsatz.mandant_id
       and z.einsatz_id = einsatz.id
       and z.person_id = app.aktuelle_person()
       and z.entfernt_am is null
  )
);

comment on policy t_selbst_m1 on einsatz is
  'EMP-02, SEC-05, CLN-04 (0300): die eigene Schicht im M1-Scope des '
  'Mitarbeiterportals. Sie ist die Vorpruefung jedes Schreibwegs, der an der '
  'Schicht haengt — Wachbucheintrag, Schichtfoto, Leistungsnachweis, '
  'Bautagebuch. Praedikat wortgleich mit einsatz.p_ma_decke.';

/**
 * Das Objekt, auf dem ich eingesetzt bin.
 *
 * `app.ist_eingesetzt_auf_objekt` und nicht die Zuordnung: dieselbe Funktion
 * entscheidet in `leistungsnachweis.p_portal_decke`, was die Arbeiterin von
 * einem Nachweis sehen darf. Zwei verschiedene Praedikate fuer dieselbe Frage
 * waeren eine Seite, die den Nachweis anzeigt und sein Objekt nicht (oder
 * umgekehrt).
 *
 * Die Funktion ist `security definer` und traegt das Zeitfenster ihrer
 * Definition (0004: der Einsatz darf noch nicht beendet sein).
 *
 * TODO(client, O-740): Bis wann NACH Schichtende darf eine Kraft noch zu dieser Schicht erfassen — Foto, Wachbucheintrag, Leistungsnachweis, Bautagebuch?
 */
create policy t_selbst_m1 on objekt for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_objekt(id)
);

comment on policy t_selbst_m1 on objekt is
  'CLN-04 (0300): das Objekt der eigenen Schicht im M1-Scope des '
  'Mitarbeiterportals — die Vorpruefung von erstelleEntwurf, die den Kunden '
  'des Objekts serverseitig aufloest (nie aus der Anfrage). Praedikat wie in '
  'leistungsnachweis.p_portal_decke: app.ist_eingesetzt_auf_objekt.';
