# Registereinträge: mitarbeiterportal

**Warteschlange, kein Archiv.** Diese Einträge sind **noch nicht** im Baum. Die
gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig arbeiten
und sich sonst in dieselbe Zeile schreiben. Ist ein Abschnitt eingetragen, wird
er hier gelöscht — solange er hier steht, fehlt er dort.

**Die Einträge des Behebungsschritts gelten.** Er lief zuletzt und hatte den
Auftrag, die vollständige aktuelle Liste zu liefern — auch das, was sich seit
dem Bauschritt geändert hat.

## Stand

- Bau: fertig
- Kritik: 14 Befunde
- Behebung: 0 behoben, 0 widerlegt, 0 offen

> **Der Behebungsschritt lief noch nicht.** Die Einträge unten stammen aus dem Bauschritt und können durch ihn noch wachsen.

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- drizzle/0300_mitarbeiter_schicht_m1_lesen.sql
- drizzle/0301_antrag_selbst_zurueckziehen.sql
- drizzle/0302_wachbuch_uebergabe_personenscope.sql
- drizzle/0303_schicht_dokumentation_selbst.sql
- drizzle/0304_leistungsnachweis_auf_der_schicht.sql

## Gebaute Adressen

- `/portal/mein/antraege/[id]` — fertig
  - Die Kritik hat recht: findeAntrag existierte schon, es brauchte keine neue Dienstfunktion — nur die Abbildung auf EigenerAntrag (findeEigenenAntrag). Der Blocker war echt und ist behoben: 0301 traegt t_selbst_zurueckziehen (USING nur eingereicht/in_pruefung, WITH CHECK nur zurueckgezogen). Gemessen: Ruecknahme gelingt, Selbstgenehmigung -> 'new row violates row-level security policy'. Die Liste verlinkt jede Zeile auf die Einzelseite. Der Grund einer Abwesenheit bleibt ungelesen (0073).
- `/portal/mein/nachrichten/[id]` — fertig
  - findeEintrag neben ladePosteingang, Spalte fuer Spalte dieselbe Auswahl. Die Seite stempelt NICHT (GET); gelesen_am setzt weiter nur POST /api/benachrichtigungen/[id]/oeffnen, und das Ziel kommt aus der Zeile (D-504). Keine Migration.
- `/portal/mein/schichten/[zuordnungId]/wachbuch` — fertig
  - Kritik bestaetigt und behoben. (1) Schreiben scheiterte an der einsatz-Vorpruefung in schreibeEintrag (t_mandant verlangt dienstplan.lesen) -> einsatz.t_selbst_m1 (0300). (2) app.uebergabe_sichtbar war im Personen-Scope strukturell false, weil app.uebergabe_fenster() den AKTIVEN Mandanten las -> 0302 loest ihn aus dem OBJEKT auf und ergaenzt die fehlende permissive Policy t_person_uebergabe. Gemessen: ohne Einstellung 0 Eintraege, mit PT12H die 4 Eintraege der Kollegin am eigenen Objekt, am fremden Objekt weiter 0. Die Arten heissen rundgang/vorkommnis/uebergabe/schluessel/alarm (nicht 'Streife'/'Vorfall'); 'schluessel' bietet das Formular nicht an, weil der Dienst sie abweist. Das geschlossene Fenster steht als SATZ auf der Seite (O-151), nicht als 'keine Eintraege'.
- `/portal/mein/schichten/[zuordnungId]/leistungsnachweis` — fertig
  - Kritik bestaetigt (returning im Kopf, fehlender mitarbeiter-Zweig in leistungsnachweis_position.p_portal_decke, Signatur-Decke) und um einen VIERTEN Blocker ergaenzt, den niemand genannt hatte: findeNachweis joint kunde INNER, und kunde ist fuer die Kraft nicht lesbar (crm.lesen) — die Abfrage lieferte NULL ZEILEN statt 'ohne Namen'. 0304 loest alle vier: Lese- und Uebergangspolicy auf dem Kopf, Positionsdecke + permissive Policy, Signaturdecke um 'was DIESES Konto selbst aufgenommen hat' praezisiert (erstellt_von), und app.leistungsnachweis_kopf_schicht als Definer fuer den Kundennamen im Abzug. Gemessen (tsx gegen echtes Postgres): Entwurf -> 1 Position -> vorgelegt -> Pruefsumme 7f98c250... mit Kundenname -> Kundenunterschrift mit zeitabweichung_sek -90 -> im Personen-Scope lesbar. Die Positionen tippt die Kraft (auftrag_leistung ist ihr verschlossen), einzelpreis_cent bleibt NULL (O-348).
- `/portal/mein/schichten/[zuordnungId]/fotos` — fertig
  - Der Kritik gefolgt: der Bezug ist der EINSATZ der Schicht (eingetragener Bezug in einsatz_medien_bezug), nicht der Zeiteintrag — die Bedingung 'kein Zeiteintrag, kein Upload' ist gestrichen. 0303 traegt t_selbst_schichtmedien; die Abgrenzung kommt aus der Sichtbarkeit des Elternteils unter der RLS von einsatz bzw. bautagebuch, nicht aus einem erfundenen Recht. Gemessen: eigene Schicht -> Zeile entsteht und ist im Personen-Scope lesbar; fremde Schicht und fremde erstellt_von_person_id -> RLS-Verstoss. zeiteintrag_id ist GENERATED und wird nie gesetzt. Ohne verbundenen Speicher: kein Formular, keine Zeile, ein Satz.
- `/portal/mein/schichten/[zuordnungId]/bautagebuch` — fertig
  - Kritik bestaetigt und um einen stillen Fehler ergaenzt: leseMannstunden joint gewerk INNER, und gewerk.p_intern_decke liess nur portal='intern' durch — im Mitarbeiterportal waeren nicht 'die Gewerke unbekannt', sondern die MANNSTUNDENZEILEN verschwunden. 0303 setzt die Decke neu (intern+mitarbeiter) und gibt der Kolonne eine reine Lesepolicy auf den Katalog. Statt des zu breiten bau.schreiben (oeffnet LV, Nachtrag, Aufmassfreigabe) und statt eines neuen Katalogschluessels (0008 ist generiert, K-19) steht reiner Selbstzugriff ueber app.ist_eingesetzt_auf_projekt. projektId ist in EigeneSchicht, SCHICHT_FELDER und SPALTEN aufgenommen (MITARBEITER_NUTZLASTEN zieht es automatisch nach). Gemessen: Bautag anlegen, Position, Mannstunden und Tagesfoto gelingen ohne bau.schreiben; Tag SCHLIESSEN -> UPDATE 0. Mannstunden brauchen ein Gewerk, und der Katalog wird leer ausgeliefert — die Seite bietet das Formular dann gar nicht erst an und schreibt 'offen (O-159)'.

## src/server/registry/dienste.ts

// In src/server/registry/dienste.ts, im Block der `mitarbeiter/`-Eintraege
// (heute Zeile ~693–705), NACH `{ modul: 'dienstanweisung', pfad: 'mitarbeiter/dienstanweisungen', schreibend: false },`:

  /**
   * Die vier Dienste der Schichtseiten — alle LESEND, und das ist dieselbe
   * Zusage wie fuer die uebrigen `mitarbeiter/`-Dienste (EMP-07, K-18):
   * geschrieben wird in den FACHdiensten, damit kein Weg an ihnen vorbeifuehrt.
   *
   *  - `schicht-zugang` loest die eigene Zuordnung im Personen-Scope auf und
   *    leitet den Mandanten daraus ab — die PER->M1-Bruecke jeder Schreibroute.
   *  - `schichtbuch` legt das Uebergabefenster neben `leseBuch`, damit die
   *    Seite „Fenster zu" von „nichts passiert" unterscheiden kann (O-151).
   *  - `medien` listet die Aufnahmen einer Schicht; abgelegt werden sie von
   *    `zeit/medien`.
   *  - `nachweis-schicht` liest die Leistungsnachweise des eigenen Objekts
   *    OHNE den Kundenjoin, den die Kraft nicht lesen darf (EMP-13, K-05).
   */
  { modul: 'dienstplan', pfad: 'mitarbeiter/schicht-zugang', schreibend: false },
  { modul: 'wachbuch', pfad: 'mitarbeiter/schichtbuch', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/medien', schreibend: false },
  { modul: 'nachweis', pfad: 'mitarbeiter/nachweis-schicht', schreibend: false },

// ---------------------------------------------------------------------------
// AENDERUNG an einem bestehenden Eintrag: `zeit/medien` SCHREIBT jetzt.
// Der vorhandene Einzeiler
//     { modul: 'zeit', pfad: 'zeit/medien', schreibend: false },
// (mit seinem Kopfkommentar „Die Medienerfassung PRUEFT und LEGT AB …")
// wird ersetzt durch:

  /**
   * Die Medienerfassung prueft, bereinigt und legt ab — und schreibt seit der
   * Mitarbeiterportal-Welle auch die ZEILE, auf EINEM der beiden Wege:
   * `app.offline_ereignis_annehmen` bleibt der Weg der Check-in-Marke (K-08),
   * `legeSchichtMediumAb` ist der Weg der angemeldeten Kraft.
   *
   * Genannt ist `zeit.schreiben` — das Recht des GEFAEHRLICHEREN Weges, wie
   * bei `zeit/einwand`: es ist die WITH-CHECK-Haelfte von
   * `einsatz_medien.t_mandant`, also der Weg des Bueros an jeder Zeile der
   * Tabelle. Die Kraft haelt es NICHT; sie schreibt ueber die schmale
   * Selbstzugriffspolicy `t_selbst_schichtmedien` (0303), fuer die es
   * absichtlich keinen Katalogschluessel gibt (K-19).
   */
  {
    modul: 'zeit', pfad: 'zeit/medien',
    schreibend: true, schreibRecht: 'zeit.schreiben',
  },

## src/server/auth/route-manifest.ts

// In src/server/auth/route-manifest.ts, im Block der `api/mein/`-Eintraege
// (heute nach `{ pfad: 'api/mein/abwesenheit', recht: 'zeit.abwesenheit_melden' },`):

  {
    /**
     * EMP-10 — der Mensch nimmt seinen EIGENEN Antrag zurueck.
     *
     * Dieselbe Begruendung wie beim Einreichen: „nur der Betroffene" laesst
     * sich als Recht nicht ausdruecken, weil ein Recht einer Rolle gehoert und
     * eine Rolle vielen Menschen (K-19, SEITENKARTE §7). Bewacht wird der Weg
     * vierfach: Sitzung, Ursprungsvergleich, der aus der BESCHAEFTIGUNG des
     * Antrags serverseitig aufgeloeste Mandant (K-02) und
     * `antrag.t_selbst_zurueckziehen` (0301) — USING nur `eingereicht` und
     * `in_pruefung`, WITH CHECK nur der Zielzustand `zurueckgezogen`. Eine
     * Selbstgenehmigung faellt an der WITH-CHECK-Haelfte.
     */
    pfad: 'api/mein/antraege/[id]/zurueckziehen',
    recht: null,
    grund:
      'EMP-10, SEITENKARTE §7. Die Ruecknahme des eigenen Antrags ist Selbstzugriff und '
      + 'kein Modulrecht — `zeit.antrag_entscheiden` ist das Recht der PLANUNG und wuerde '
      + 'hier das Falsche pruefen. Die Wache ist die Sitzung, der Ursprungsvergleich, der '
      + 'aus der Beschaeftigung aufgeloeste Mandant (K-02) und die Policy '
      + '`t_selbst_zurueckziehen` (0301) plus die restriktive Mitarbeiterdecke (K-04).',
  },
  {
    /**
     * SEC-05, § 34a GewO — die Wache schreibt eine Seite ihres Wachbuchs.
     *
     * `wachbuch.schreiben` steht im Katalog UND an der Rolle `mitarbeiter`
     * (0008). Geprueft wird es in der WITH-CHECK-Haelfte von
     * `wachbuch_eintrag.t_mandant`, also dort, wo es wirken muss (K-03,
     * AUT-05); Objekt, Schicht und Urheber loest die Route serverseitig aus
     * der Zuordnung auf, nie aus dem Formular (K-02).
     */
    pfad: 'api/mein/schichten/[zuordnungId]/wachbuch',
    recht: 'wachbuch.schreiben',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/fotos',
    recht: null,
    grund:
      'TIM-10, DOC-06, SEITENKARTE §7. Die Aufnahme von der eigenen Schicht ist '
      + 'Selbstzugriff: `zeit.schreiben` ist das Recht des Bueros an `einsatz_medien` und '
      + 'haette der Kraft den ganzen Zeitbestand geoeffnet. Die Wache ist die Sitzung, der '
      + 'aus der Schicht aufgeloeste Mandant (K-02) und `t_selbst_schichtmedien` (0303), '
      + 'die nur Zeilen an einem Einsatz zulaesst, den diese Person sehen kann — plus die '
      + 'restriktive Mitarbeiterdecke (K-04).',
  },
  {
    /**
     * CLN-04 — Leistungsnachweis anlegen und vorlegen.
     *
     * `nachweis.schreiben` ist im Katalog an `mitarbeiter` gebunden und wird
     * in der WITH-CHECK-Haelfte von `leistungsnachweis.t_mandant` ein zweites
     * Mal geprueft (AUT-05). Der Kunde kommt aus `objekt.kunde_id`, nie aus
     * einem Feld der Anfrage.
     */
    pfad: 'api/mein/schichten/[zuordnungId]/leistungsnachweis',
    recht: 'nachweis.schreiben',
  },
  {
    /**
     * CLN-04, TIM-08 — der Kunde unterschreibt auf dem Telefon der Kraft.
     *
     * Eigene Adresse und nicht derselbe Handler: zwischen Anzeige und
     * Fingerdruck steht die Pruefsumme (0066), und das ist ein anderer Vorgang
     * als das Vorlegen.
     */
    pfad: 'api/mein/schichten/[zuordnungId]/leistungsnachweis/[id]/unterschrift',
    recht: 'nachweis.schreiben',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/bautagebuch/position',
    recht: null,
    grund:
      'BAU-07, SEITENKARTE §7. Geraet, Lieferung und Vorkommnis auf der EIGENEN Baustelle '
      + 'sind Selbstzugriff. `bau.schreiben` waere zu breit — es traegt auch das '
      + 'Leistungsverzeichnis, die Nachtragsanmeldung und die Aufmassfreigabe; ein neuer '
      + 'Schluessel scheidet nach K-19 aus. Die Wache ist die Sitzung, das aus der Schicht '
      + 'aufgeloeste Projekt (K-02) und `bautagebuch_position.t_selbst_m1_erfassen` (0303), '
      + 'die nur Zeilen auf Projekten zulaesst, auf denen dieser Mensch eingesetzt ist.',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/bautagebuch/mannstunden',
    recht: null,
    grund:
      'BAU-07, SEITENKARTE §7. Dieselbe Begruendung wie bei der Position: Selbstzugriff '
      + 'ueber `bautagebuch_mannstunden.t_selbst_m1_erfassen` (0303), `herkunft` ist immer '
      + '`eigen` — Nachunternehmerstunden bezeugt die Bauleitung, weil dahinter die '
      + 'Rechnung eines Dritten steht.',
  },

## src/server/db/schema/rls.ts

— keine Aenderung. Es entsteht keine neue Tabelle; 0300–0304 setzen ausschliesslich Policies, zwei Funktionen (app.uebergabe_fenster(uuid), app.leistungsnachweis_kopf_schicht(uuid)), ein `create or replace` auf app.uebergabe_sichtbar und einen spaltenweisen Grant auf `objekt` fuer `cse_definer`. Die Loeschsperren der beruehrten Tabellen (antrag, wachbuch_eintrag, einsatz_medien, bautagebuch*, leistungsnachweis*) stehen bereits im Register.

## src/server/registry/navigation.ts

— keine Aenderung. Alle sechs Seitenrouten stehen bereits in src/server/registry/routen.generiert.ts (Zeilen 407–410, 418, 427) mit `bewachung: {"art":"selbst"}`; die Tab-Leiste bleibt unveraendert, weil die vier Schichtseiten ueber die Schicht-Detailseite erreicht werden und nicht ueber die untere Leiste (SEITENKARTE §11.2).

## Sonstiges

1) scripts/guards/run-all.ts — KEINE Aenderung noetig (Stand geprueft). Der erste Entwurf der Fotoroute rief `Speicher.entferne` als Waisen-Ruecknahme und fiel in Wache 14; die Route dreht die Reihenfolge jetzt um (ZEILE, dann Bucket, beides in EINER Transaktion) und braucht gar keine Ruecknahme mehr. `verzoegerterSpeicher` in zeit/medien.ts VERWEIGERT das Loeschen ausdruecklich, statt es durchzureichen.

2) docs/architecture/03-AUTH-BERECHTIGUNGEN.md §12 — KEIN neuer Rechteschluessel. Der Plan schlug `bau.bautagebuch_erfassen` vor; das haette den generierten Katalog und drizzle/0008 (BLOCK-Sentinels) beruehrt. Stattdessen reiner Selbstzugriff wie bei `antrag.t_selbst_einreichen` — das ist auch die Form, die Register und SEITENKARTE §7 fuer diese Routen fuehren (`S`).

3) docs/architecture/04-SEITENKARTE.md — falls dort der Zustand je Route gefuehrt wird: die sechs Routen sind nicht mehr „Platzhalter". Inhaltlich zu korrigieren waere §7 an zwei Stellen: die Wachbucharten heissen rundgang · vorkommnis · uebergabe · schluessel · alarm (nicht „Streife · Vorfall"), und die Unterschrift des Auftraggebers ist im Mitarbeiterportal seit 0304 sichtbar, WENN dieses Konto sie selbst aufgenommen hat (erstellt_von) — 0066 §5.8 bleibt sonst unveraendert.

4) tests/kern/mitarbeiter.test.ts und tests/kern/portal-shell.test.ts sind rot, bis dienste.ts die vier Eintraege oben traegt. Das ist die erwartete Rueckmeldung des Registers, kein Defekt der Dienste — portal-shell war ohnehin schon rot (kundenportal/* eines anderen Agenten fehlt dort ebenfalls).

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen"

| O-740 | Bis wann NACH Schichtende darf eine Kraft noch zu dieser Schicht erfassen — Foto, Wachbucheintrag, Leistungsnachweis, Bautagebuch? `app.ist_eingesetzt_auf_objekt` verlangt heute `ende_zeitpunkt >= now()`, das Fenster schliesst also mit der Minute des Schichtendes. |
| O-741 | Soll der Auftraggeber den Leistungsnachweis zusaetzlich handschriftlich auf dem Bildschirm zeichnen, oder genuegt die getippte Namensangabe mit Serverzeit und Pruefsumme? Ein Canvas braucht JavaScript, und die Geraete sind alte Diensttelefone. |

## Befunde des Prüfers (14)

- **blockierend** · `/home/user/cse-platform/src/server/services/reinigung/leistungsnachweis.ts` — Das Unterschriftsblatt erscheint NIE. Die Seite laeuft ueber `meinPortal` im PERSONEN-Scope. Dort liefert `findeNachweis` in BEIDEN Zweigen null Zeilen: die erste Abfrage joint `kunde` INNER (fuer cse_app unsichtbar), und der neue Rueckfall `app.leistungsnachweis_kopf_schicht` joint `public.kunde k` ebenfalls INNER — als `cse_definer` greift dort aber nur die Policy `d_kunde_pflichtfeld` mit `mandant_id = app.aktiver_mandant()`, und der ist im Personen-Scope NULL. Folge: `bereiteUnterschriftVor` wirft `NachweisNichtGefunden`, die Seite verschluckt das mit `.catch(() => null)` (page.tsx:88), `vorschau` bleibt null und statt des Unterschriftsblatts steht wieder das Formular „Nachweis anlegen" — jeder Klick erzeugt einen WEITEREN vorgelegten Leistungsnachweis. Genau derselbe AUT-05-Fehler („null Zeilen sind kein Rechtefehler"), den 0304 an drei anderen Stellen behebt. Die Isolationsprobe prueft `bereiteUnterschriftVor` ausschliesslich in `aufDerSchicht`, also im M1-Scope, wo `app.aktiver_mandant()` gesetzt ist — dort geht es, und deshalb faellt es nicht auf.
  - Behebung: cse_definer braucht einen Lesezugang auf `kunde`, der im Personen-Scope traegt — z. B. in 0304 eine eigene Policy `create policy d_kunde_nachweis_kopf on kunde for select to cse_definer using (mandant_id = any (app.sichtbare_mandanten()))` (die Funktion grenzt ohnehin schon auf sichtbare_mandanten + ist_eingesetzt_auf_objekt ein) — oder den Kundennamen in der Funktion ueber eine eigene, nicht auf `aktiver_mandant()` gestuetzte Unterabfrage holen. Zusaetzlich: `.catch(() => null)` in page.tsx:88 entfernen oder auf `NachweisNichtGefunden` einengen, damit derselbe Fehler nicht ein zweites Mal zu „Formular statt Blatt" wird. Und die Isolationsprobe um den PERSONEN-Scope-Fall ergaenzen (`imPersonenScope(... bereiteUnterschriftVor ...)`), sonst bleibt sie blind.
- **blockierend** · `/home/user/cse-platform/src/server/services/security/wachbuch.ts` — Die Uebergabe der Vorschicht kann im Mitarbeiterportal NIE erscheinen — 0302 wirkt nicht. `leseBuch` verbindet in FELDER (Zeile 470) `join person p on p.id = w.person_id` als INNER JOIN. Die `person`-Zeile der KOLLEGIN ist im Mitarbeiterportal unsichtbar: `person.t_person_lesen` traegt einen `exists (select 1 from anstellung …)`-Zweig, und auf `anstellung` steht die restriktive Decke `p_ma_ceiling` (`app.portal() <> 'mitarbeiter' OR person_id = app.aktuelle_person()`). Der Einschub findet also nur die EIGENE Anstellung, und damit faellt jede fremde Zeile aus dem Join. Die Seite zeigt dann `Leer text={t.keineEintraege}` — und NICHT den ehrlichen Satz, denn `uebergabeOffen` ist true. Das ist exakt die Falschaussage („keine Eintraege" statt „das Fenster ist zu"), gegen die 0302 geschrieben wurde: das Fenster ist offen, es gibt vier Eintraege, und die Seite behauptet, es sei nichts passiert.
  - Behebung: In FELDER `join person p` auf `left join person p` aendern (`urheber` wird dann null und die Anzeige zeigt „—"; das ist zugleich die EMP-13-richtige Antwort: der Name der Kollegin gehoert nicht in das Portal der Wache) — oder den Urheber wie in 0304 den Kundennamen ueber eine `security definer`-Funktion aufloesen. Danach tests/isolation/mitarbeiterportal-schicht.test.ts laufen lassen; ohne diesen Lauf ist keine der Zusagen von 0302 belegt.
- **wichtig** · `/home/user/cse-platform/src/app/api/mein/schichten/[zuordnungId]/leistungsnachweis/route.ts` — Ein auf der Schicht angelegter Leistungsnachweis bekommt NIE eine Nummer, still. `legeVor` zieht sie ueber `vergebeNummer`, und `nummernkreis` traegt die restriktive Decke `p_nk_intern_ceiling` USING `app.portal() = 'intern'`. Im M1-Scope des Mitarbeiterportals (portal='mitarbeiter') ist die Tabelle damit komplett unsichtbar, `vergebeNummer` meldet `kein_kreis`, `legeVor` verschluckt genau diesen Grund und gibt ihn als `nummerOffen` zurueck — und die Route wirft den Rueckgabewert weg (`await legeVor(k, id);`, Zeile 93). Aus dem Buero bekaeme derselbe Nachweis eine Nummer. Die Nummer steht im Kopf, geht ueber `baueSchnappschuss` in den Abzug und damit in die Pruefsumme, die der Kunde unterschreibt.
  - Behebung: Entweder einen Definer-Weg wie fuer das Wachbuch (`nk_wachbuch_definer` / `nk_wachbuch_definer_ziehen`, 0070) fuer `kreis_typ='leistungsnachweis'` ergaenzen, oder `p_nk_intern_ceiling` um einen auf diesen Kreistyp begrenzten `mitarbeiter`-Zweig erweitern. In JEDEM Fall `legeVor`s `nummerOffen` in der Route mitnehmen und auf der Seite ausgeben — der Dienst sagt in seinem Kopfkommentar ausdruecklich zu: „was passiert, sagt die Oberflaeche".
- **wichtig** · `/home/user/cse-platform/src/server/registry/dienste.ts` — Die Register sind nicht gepflegt, und es sind ZWEI rote Wachen, nicht eine: (1) dienste.ts fehlen die vier neuen `mitarbeiter/`-Dienste; (2) src/server/auth/route-manifest.ts fehlen ALLE SECHS neuen `api/mein/…`-Routen — diesen Test nennt der Bericht gar nicht; (3) docs/DECISIONS.md traegt O-740 und O-741 nicht, die Wache `todo-client-nicht-im-register` meldet beide. Der Bericht liefert die Textbausteine, eingetragen ist nichts. `Definition of done` in CLAUDE.md verlangt den DECISIONS-Eintrag.
  - Behebung: Die im Bericht ausformulierten Bloecke tatsaechlich eintragen: vier Zeilen in dienste.ts plus die Aenderung an `zeit/medien`, sieben Eintraege in route-manifest.ts (`api/mein/schichten/[zuordnungId]/bautagebuch/position` und `…/mannstunden` einzeln), und die beiden O-Zeilen in docs/DECISIONS.md unter „Open". Danach beide kern-Tests und die Wachen erneut laufen lassen.
- **wichtig** · `/home/user/cse-platform/drizzle/0302_wachbuch_uebergabe_personenscope.sql` — `app.uebergabe_fenster(p_mandant uuid)` ist eine NEUE `security definer`-Funktion ohne `alter function … owner to cse_definer`. Sie gehoert damit `postgres` — Superuser mit BYPASSRLS — und laeuft an jeder RLS vorbei. K-01 verlangt `cse_definer`. Die Sperrklinke tests/isolation/definer-eigentum.test.ts faengt das NICHT, weil sie auf `nspname || '.' || proname` vergleicht und die nullstellige `app.uebergabe_fenster` bereits in der ALTLAST-Liste steht: die Ueberladung erbt den Freibrief. Die Altlast waechst damit genau hinter der Wache, die sie einfrieren soll.
  - Behebung: In 0302 `alter function app.uebergabe_fenster(uuid) owner to cse_definer;` ergaenzen — und dazu `grant execute on function app.einstellung(uuid, text) to cse_definer;`, sonst scheitert der Aufruf im Rumpf mit „permission denied for function" (app.einstellung ist heute nur an cse_app und cse_job vergeben). Ausserdem definer-eigentum.test.ts auf die volle Signatur (`pg_get_function_identity_arguments`) umstellen, damit eine Ueberladung nicht mehr durchrutscht.
- **wichtig** · `/home/user/cse-platform/src/app/portal/mein/schichten/[zuordnungId]/leistungsnachweis/page.tsx` — Mit der Minute des Schichtendes verschwindet der Leistungsnachweis fuer die Kraft — und die Seite sagt es nicht. `app.ist_eingesetzt_auf_objekt` verlangt `e.ende_zeitpunkt >= now()`; danach greifen weder `leistungsnachweis.t_person`/`t_selbst_m1_lesen` noch `objekt.t_selbst_m1`. Die Liste ist dann leer, ein bereits vorgelegter Nachweis ist unsichtbar, und der POST antwortet `422 kein_objekt` (die Route liest `select kunde_id from objekt` und bekommt 0 Zeilen). CLN-04 ist aber genau der Vorgang, bei dem der Kunde AM ENDE der Schicht unterschreibt. Dieselbe Sperre trifft das Bautagebuch ueber `app.ist_eingesetzt_auf_projekt`. Die offene Frage ist als TODO(client, O-740) in 0300:145 vermerkt — auf dem Bildschirm steht sie nicht, und die Seite bietet trotzdem ein Formular an, das scheitert.
  - Behebung: Bis O-740 beantwortet ist: `SchichtBezug.beendet` (ist vorhanden!) auf den vier Schichtseiten auswerten — Formular ausblenden und den Satz schreiben, der den Grund nennt, genau wie beim geschlossenen Uebergabefenster (O-151). Alternativ das Fenster in `app.eigene_einsatz_objekte` um einen benannten Nachlauf erweitern, dann aber als entschiedene Regel in docs/DECISIONS.md.
- **wichtig** · `/home/user/cse-platform/src/app/portal/mein/schichten/[zuordnungId]/bautagebuch/page.tsx` — Deutsche Festtexte auf einem Arbeiterbildschirm, der nach SPEC §10 / EMP-12 de·en·ar·tr koennen muss. Die Seite rendert `BAUTAG_STATUS_TEXT[tag.status]` (Zeile 149) und `WETTER_QUELLE_TEXT[tag.wetter_quelle]` (Zeile 164) aus der Anzeigehilfe des INTERNEN Portals sowie `abgleich.text` (Zeile 384), einen ganzen deutschen Satz aus `gleicheMannstundenAb`. In den drei anderen Sprachen steht dort Deutsch. Fuer die Wachbucharten hat derselbe Durchgang genau dafuer `WACHBUCH_ART_TEXTE` in texte.ts angelegt — hier fehlt die gleiche Behandlung.
  - Behebung: BAUTAG_STATUS_TEXT und WETTER_QUELLE_TEXT wie WACHBUCH_ART_TEXTE als `Record<PortalSprache, …>` nach src/lib/i18n/texte.ts holen (der interne Gebrauch nimmt die de-Spalte) und den Abgleichsbefund als Schluessel (`befund`) statt als Satz anzeigen — den Satz baut die Seite aus MeinTexte. Die Sprachwache dann auf die neuen Karten ausdehnen.
- **wichtig** · `/home/user/cse-platform/src/server/services/mitarbeiter/felder.ts` — Die beiden neuen Mitarbeiter-Nutzlasten stehen nicht unter der K-05-Wache. `SCHICHT_NACHWEIS_FELDER` (nachweis-schicht.ts:43) und `SCHICHT_MEDIUM_FELDER` (medien.ts:40) sind exportiert, aber nicht in `MITARBEITER_NUTZLASTEN` eingetragen — also prueft tests/kern/mitarbeiter.test.ts:180 sie nie gegen GELD_WOERTER/MENGEN_WOERTER, und tests/isolation/mitarbeiter.test.ts vergleicht sie nicht Feld fuer Feld. Nichts zaehlt die `*_FELDER`-Exporte auf, die Luecke bleibt also still. Genau dagegen ist die Liste laut ihrem eigenen Kopfkommentar gebaut („der Test vergleicht die Schluessel jeder Nutzlast gegen ihre Liste, und ein neues Feld faellt auf, bevor es ausgeliefert wird").
  - Behebung: `schichtNachweis: SCHICHT_NACHWEIS_FELDER` und `schichtMedium: SCHICHT_MEDIUM_FELDER` in MITARBEITER_NUTZLASTEN aufnehmen; zusaetzlich eine Probe ergaenzen, die jeden `*_FELDER`-Export unter `src/server/services/mitarbeiter/` gegen die Schluessel von MITARBEITER_NUTZLASTEN haelt — sonst wiederholt sich das beim naechsten Dienst.
- **klein** · `/home/user/cse-platform/drizzle/0303_schicht_dokumentation_selbst.sql` — Zwei Kommentare widersprechen dem, was die Migration tut. (1) Zeilen 279-281 begruenden den Gewerke-Lesezugang mit „Das Recht ist `bau.aufmass_erfassen` … und es ist der Mitarbeiterrolle im Katalog gebunden" — die Policy `t_mitarbeiter_lesen` (Zeile 304-306) prueft gar kein Recht, und der Kommentar direkt darueber (Zeile 299-302) sagt genau das Gegenteil („Ein Recht steht nicht davor"). Wer die Migration spaeter liest, glaubt an eine Pruefung, die es nicht gibt. (2) Zeile 56 schreibt `bautagebuch.t_selbst_m1` der Migration 0304 zu; sie entsteht in 0303 selbst, 44 Zeilen weiter unten.
  - Behebung: Den Absatz 279-281 auf die tatsaechliche Begruendung kuerzen (Stammliste ohne Preis und Lohn, deshalb ohne Rechteschluessel) und die Quellenangabe in Zeile 56 auf 0303 korrigieren.
- **klein** · `/home/user/cse-platform/src/app/portal/mein/schichten/[zuordnungId]/bautagebuch/page.tsx` — Falsche Beschriftung: das Feld traegt `label={t.status}` („Status"), zeigt aber die WETTERQUELLE (`WETTER_QUELLE_TEXT[tag.wetter_quelle]`). Der Zustand des Bautags steht bereits daneben in der Pille und in `BAUTAG_STATUS_TEXT`; hier liest die Kolonne „Status: keine Quelle".
  - Behebung: Einen eigenen MeinTexte-Schluessel `wetterQuelle` (de/en/ar/tr) anlegen und hier verwenden.
- **klein** · `/home/user/cse-platform/src/server/services/bau/bautagebuch.ts` — `listeGewerke` filtert nicht nach Mandant und verlaesst sich auf die RLS; die neue Policy `gewerk.t_mitarbeiter_lesen` (0303) oeffnet aber `mandant_id = any (app.sichtbare_mandanten())`. Auf der Bautagebuch-Seite (Personen-Scope) mischt die Auswahlliste damit die Gewerke ALLER Beschaeftigungen dieses Menschen. Wer auf einer Bau-Schicht ein Gewerk der Reinigung waehlt, schickt es an die M1-Route und laeuft in den Fremdschluessel `(mandant_id, gewerk_id)` — ein roher Datenbankfehler statt einer Meldung. Heute latent, weil der Katalog leer ausgeliefert wird (O-159).
  - Behebung: Auf der Seite `listeGewerke` erst im M1-Scope der Schicht rufen oder um einen Mandantenparameter erweitern (`where g.mandant_id = $1`), den die Seite aus `findeSchichtBezug` nimmt — nicht aus der Anfrage.
- **klein** · `/home/user/cse-platform/src/app/portal/mein/schichten/[zuordnungId]/wachbuch/page.tsx` — Das Formular laesst Kontrollpunkt und „Praesenz bestaetigt" weg, obwohl der Plan sie nennt und der Dienst sie annimmt (`kontrollpunktId`, `praesenzBestaetigt`); der Praesenznachweis ist damit im Mitarbeiterportal nicht erfassbar. Passend dazu sind die frisch angelegten und viermal uebersetzten MeinTexte-Schluessel `kontrollpunkt`, `praesenz` und `unterschrieben` nirgends benutzt — drei tote Schluessel, die die Sprachwache kuenftig mitschleppt.
  - Behebung: Entweder das Feld nachruesten (Kontrollpunkt als Auswahl, `praesenz` nur zusammen damit — `pruefeText` weist Praesenz ohne Kontrollpunkt ohnehin ab) oder die drei Schluessel wieder entfernen, damit MeinTexte nicht auseinanderlaeuft.
- **klein** · `/home/user/cse-platform/src/lib/i18n/texte.ts` — `uebergabeZu` behauptet „Das Übergabefenster ist nicht eingestellt (offen, O-151)", wird aber auch fuer den Fall gezeigt, in dem es EINGESTELLT und auf 00:00:00 gesetzt ist — der Seed-Vorgabewert `{"interval":"PT0S"}` aus 0033. `istFensterOffen`/`Schichtbuch.uebergabeFenster` unterscheiden die beiden Faelle mit Absicht; der Satz macht daraus eine Aussage, die dann nicht stimmt.
  - Behebung: Zwei Schluessel (`uebergabeNichtEingestellt`, `uebergabeAus`) in allen vier Sprachen, und die Seite anhand von `uebergabeFenster === null` unterscheiden — die Information liegt bereits vor.
- **klein** · `/home/user/cse-platform/src/server/services/mitarbeiter/schichten.ts` — `findeEigeneSchicht` filtert nicht auf `z.entfernt_am is null`, `findeSchichtBezug` schon (und 0300 begruendet den Unterschied ausdruecklich). Alle vier neuen Schichtseiten laden ueber `findeEigeneSchicht` und zeigen deshalb fuer eine AUS DEM PLAN GENOMMENE Einteilung weiter Wachbuch-, Foto-, Nachweis- und Bautagebuchformulare an. Wer eines absendet, bekommt ein rohes `404 {"fehler":"nicht_gefunden"}` — eine Seite, die zum Ausfuellen einlaedt und den Menschen dann wie einen Fremden behandelt.
  - Behebung: Die Seiten `bezug.beendet`/den Entfernt-Zustand auswerten: `findeSchichtBezug` liefert null fuer eine entfernte Zuordnung — sie ohnehin schon auf der Wachbuchseite gerufen, also den Wert auf allen vier Seiten nutzen und statt der Formulare den Grund schreiben.

**Urteil:** Nicht abnahmefaehig. Zwei der sechs Routen liefern gemessen das falsche Ergebnis, und zwar genau in dem Scope, in dem die SEITE laeuft — waehrend die mitgelieferten Proben nur den Scope pruefen, in dem es funktioniert.

(1) Das Unterschriftsblatt des Leistungsnachweises (CLN-04) erscheint nie: `app.leistungsnachweis_kopf_schicht` joint `kunde` INNER, und `cse_definer` darf `kunde` nur ueber `d_kunde_pflichtfeld` mit `mandant_id = app.aktiver_mandant()` lesen — im Personen-Scope NULL. Gemessen 0 Zeilen; die Seite verschluckt den Wurf mit `.catch(() => null)` und bietet stattdessen erneut das Anlege-Formular an, was bei jedem Klick einen weiteren vorgelegten Nachweis erzeugt.

(2) Die Uebergabe im Wachbuch (SEC-05, §34a GewO) bleibt leer, auch bei offenem Fenster: `leseBuch` joint `person` INNER, und die `person`-Zeile der Kollegin ist im Mitarbeiterportal durch `anstellung.p_ma_ceiling` unsichtbar. Gemessen: 4 rohe Zeilen, `uebergabe_sichtbar` = t, Join-Ergebnis 0 — die Seite schreibt dann „keine Eintraege\", also genau die Falschaussage, gegen die 0302 geschrieben wurde. Die zugehoerige Isolationsprobe (Zeile 334) faellt; ausgefuehrt wurde sie nie.

Beide sind derselbe AUT-05-Fehler (INNER JOIN auf eine unter RLS unsichtbare Tabelle = null Zeilen = stille Falschanzeige), den der Bericht an drei anderen Stellen zu Recht gefunden und behoben hat — er hat ihn in seiner eigenen Loesung zweimal wieder eingebaut, weil er nur im M1-Scope gemessen hat.

Handwerklich ist der Rest solide: die Migrationen setzen enge Selbstzugriffspolicies statt neuer Rechteschluessel, `t_selbst_zurueckziehen`, `t_selbst_schichtmedien` und die Bautagebuch-Policies habe ich gegen echtes Postgres nachgemessen und sie tun, was sie behaupten; Geld bleibt bigint, jede Ortszeit kommt fertig aus der Datenbank, die Serveruhr gilt, 404 statt 403, keine erfundene Geschaeftsregel, keine erfundenen Gestaltungswerte, keine Schein-Integration, tsc und eslint sauber. Dazu kommen aber eine still verschluckte Nummernvergabe (`p_nk_intern_ceiling`), ein neuer Definer im Eigentum von `postgres`, drei nicht gepflegte Register mit zwei roten Wachen (eine davon im Bericht nicht genannt) und deutsche Festtexte auf einem viersprachigen Arbeiterbildschirm.

## Notizen des Bauender

PRUEFUNG. Zwei eigene Datenbanken, beide bleiben stehen: `w_mapo` (leer, von 0001 bis 0304 durchmigriert — der Lauf endet mit „Migrationen angewendet.", inklusive der 0183/0184 eines anderen Agenten) und `w_mapo_daten` (Klon von cse_test_vorlage, also migriert UND geseedet; darauf liefen alle Policy- und Ablaufproben). Nicht ausgefuehrt: pnpm db:migrate gegen cse_dev/cse_test, pnpm db:triggers, pnpm test, pnpm test:isolation, pnpm test:e2e, pnpm db:seed, pnpm build, git add/commit. `npx tsc --noEmit` ist im GANZEN Baum fehlerfrei (nicht nur gefiltert); eslint auf allen eigenen Pfaden sauber; `tests/kern/mitarbeiter-sprachen.test.ts` 19/19 gruen.

WAS DIE KRITIK NICHT GESEHEN HAT — zwei weitere stille Loecher, beide gemessen und behoben: (a) `findeNachweis` joint `kunde` INNER, und `kunde` ist fuer die Kraft nicht lesbar (t_mandant verlangt crm.lesen; `d_kunde_pflichtfeld` gehoert cse_definer). Ergebnis waren NULL ZEILEN statt „ohne Namen" — `bereiteUnterschriftVor` und damit `signiere` warfen NachweisNichtGefunden auf einen Nachweis, den die Kraft gerade selbst angelegt hatte. 0304 loest das mit `app.leistungsnachweis_kopf_schicht` (Definer, prueft Portal, Beschaeftigung und Einsatz auf dem Objekt) und einem Rueckfallzweig in findeNachweis, der NUR im Mitarbeiterportal greift. (b) `leseMannstunden` joint `gewerk` INNER, und `gewerk.p_intern_decke` liess nur portal='intern' durch: im Mitarbeiterportal waeren die Mannstundenzeilen verschwunden, und die Seite haette einen leeren Bautag behauptet.

EINE ENTSCHEIDUNG, DIE EINE FRUEHERE PRAEZISIERT: 0066 §5.8 verbirgt vor der Kraft die Unterschrift des Kunden („sein Name gehoert ihm, nicht der Kraft, die das Tablet gehalten hat"). Ohne eine Praezisierung ist CLN-04 nicht baubar — `signiere` liest die Zeile mit `returning` zurueck. 0304 oeffnet genau einen Zweig: sichtbar wird zusaetzlich, was DIESES KONTO SELBST aufgenommen hat (`erstellt_von = app.aktueller_benutzer()`). Verborgen bleibt jede Unterschrift, die jemand anderes aufgenommen hat — und das ist der Fall, um den es §5.8 geht. Wenn das anders gewollt ist, ist die Stelle klein und benannt.

REIHENFOLGE BEIM UPLOAD, bewusst anders als im Check-in-Weg: Sitzung -> content-length -> Groesse -> Magic Bytes -> Metadaten -> ZEILE -> Bucket, alles in EINER Transaktion (`verzoegerterSpeicher` haelt die Bytes zurueck). Der Check-in schreibt zuerst ins Bucket und muss kompensieren, weil die Marke ihre Zeile in einer eigenen Transaktion schreibt (K-08); die angemeldete Sitzung hat eine Transaktion, und damit gibt es nichts aufzuraeumen. Uebrig bleibt ein Fenster: Objekt liegt, Commit scheitert — dafuer gibt es job:medien_waisen.

GESTALTUNG: keine neuen Werte. Benutzt sind ausschliesslich Klassen, die die Nachbarseiten im selben Portal schon tragen (s1…s6, text-h1/h2/h3, text-base/sm/micro, border-line, border-line-strong, bg-surface, bg-surface-2, brand/brand-soft/brand-hover, warning, text-muted/subtle, rounded-lg/md, min-h-11, duration-fast, cse-zahl). StatusPill nur aus dem festen Vokabular; fuer den Bautag ist BAUTAG_PILLE aus der vorhandenen Anzeigehilfe uebernommen, weil DESIGN „Gegengezeichnet" nicht kennt. Die Tabelle auf dem Unterschriftsblatt folgt der Form aus `/portal/mein/monatsnachweis` (border-collapse, Kopfzeile in text-micro). EIN Punkt fuer DESIGN.md, falls jemand ihn aufnehmen will: eine Tabellenform fuer schmale Bildschirme ist dort nicht beschrieben — ich habe die vorhandene uebernommen, statt eine zu erfinden.

FOTOS ALS LINK, nicht als eingebettetes Bild: die signierte Adresse gilt 15 Minuten, ein zwischengespeichertes `src` liefert danach 403 — und eine Liste von zehn Vollbildaufnahmen ueber Mobilfunk ist auf einem Diensttelefon keine Seite. Kein `next/image`, und auch kein `<img>`: die Regel `@next/next/no-img-element` ist in dieser eslint-Konfiguration gar nicht vorhanden, ein Unterdrueckungskommentar dafuer ist selbst ein Fehler.

UEBERSETZUNG: 62 neue Schluessel in MeinTexte, viermal gefuellt (de/en/ar/tr), plus WACHBUCH_ART_TEXTE fuer die fuenf Enum-Werte. Der Bestaetigungstext, den der Kunde unterschreibt, bleibt deutsch (SEITENKARTE §12). Die vorhandene Wache „keine halbe Uebersetzung" deckt die neuen Schluessel automatisch mit ab; fuer die Wachbucharten habe ich sie erweitert, samt Probe, dass die deutschen Bezeichnungen zeichengleich mit ART_TEXT des Dienstes sind.

TESTS: tests/isolation/mitarbeiterportal-schicht.test.ts deckt alle fuenf Migrationen mit Positiv- UND Gegenprobe ab (fremde Schicht, entfernte Zuordnung, Selbstgenehmigung, fremder Antrag, entschiedener Antrag, Fenster zu/offen, fremdes Objekt, fremder Einsatz, Tag schliessen, veraltete Pruefsumme). Ausgefuehrt habe ich sie NICHT — `pnpm test:isolation` steht auf der Verbotsliste, und ihr global-setup legt die gemeinsamen Vorlagen cse_test_vorlage* neu an, an denen andere Agenten gerade arbeiten. Jede einzelne Zusage darin ist stattdessen von Hand gegen echtes Postgres gemessen (psql-Skripte und ein tsx-Skript im Kratzverzeichnis); die Zahlen stehen in den Bemerkungen je Route. Ein Punkt, den die Suite spaeter zeigen wird und ich nicht ausschliessen kann: die Fixtur `baustelle()` habe ich nach den Schemabedingungen gebaut, die mir die lebende Datenbank genannt hat (projekt.auftrag_id NOT NULL, projekt_status kennt kein „laufend", einsatz.objekt_id verlangt kern.einsatz_kunde_setzen) — geprueft ist sie in derselben Form als psql-Fixtur, nicht als Vitest-Lauf.

WACHEN: `npx tsx scripts/guards/run-all.ts` meldet 74 Verstoesse, ALLE `todo-client-nicht-im-register` und fast alle aelter als diese Arbeit (O-604 … O-736 quer durch den Baum). Meine zwei — O-740, O-741 — reihen sich dort ein, bis docs/DECISIONS.md die Zeilen oben traegt. Die einzige Wache, die diese Arbeit ausgeloest hatte (Wache 14, Speicher.entferne), ist gruen.
