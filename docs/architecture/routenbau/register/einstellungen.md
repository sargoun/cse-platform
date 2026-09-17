# Registereintraege: einstellungen

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil acht Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (alle gegen eine eigene Datenbank gefahren: True)

- drizzle/0200_mandant_identitaet.sql
- drizzle/0201_arbeitszeitmodell_tarif.sql
- drizzle/0202_migration_lauf.sql
- drizzle/0203_agent_richtlinie_recht.sql
- drizzle/0204_audit_kette.sql

## Gebaute Routen

- `/portal/[mandant]/einstellungen/agent-richtlinien` — fertig — Alle acht AKTIONEN als vollstaendiger Konfigurationsraum, auch die fuenf ohne Zeile ('nicht hinterlegt' = Freigabe noetig). Rechtekonflikt behoben: 0203 zieht t_richtlinie_lesen/-schreiben auf agent.richtlinie_verwalten ODER versand.* (vorher Tor offen, Datenbank leer). Angebot/Nachtrag/Behinderung sind im Code gesperrt; setzeRichtlinie weist eine gespeicherte Erlaubnis ab, ein kern-Test haelt IM_CODE_GESPERRT gegen gate(). 0203 gibt der Tabelle ihre erste Spur (Audit-, geaendert_am-, Loeschsperr-Trigger, geaendert_von) - sie trug KEINEN Trigger.
- `/portal/[mandant]/einstellungen/protokoll/export` — fertig — Zaehlen vor Herunterladen; Manifest (kanonisches JSON, SHA-256 im Kopf und Dateinamen) und ZIP (STORE, Nullzeitstempel, reproduzierbar). Nur ebene=mandant dieser Gesellschaft, Spalte ebene steht trotzdem in jeder Zeile. Vorher/Nachher ueber die neue mengenwertige app.audit_nutzlast_buendel: verlangt system.audit_exportieren UND system.audit_sensitiv_lesen und schreibt EINE Protokollzeile statt einer je Zeile (0139 schreibt eine je Zeile). Fehlt das zweite Recht, ist das Buendel redigiert und das Manifest sagt warum; Kopfzeile x-cse-redigiert. Kette: kern.audit_kette + kern.audit_kettenglied, fortgeschrieben beim Buendeln, nachgerechnet von app.audit_kette_pruefen.
- `/portal/[mandant]/einstellungen/vorlagen` — fertig — Vier Abschnitte an ihren echten Quellen, EIN Editor je Zeile: Behinderungsvorlage (pflegbar, Ablösung durch Archivierung), Mahntext (lesend, verlinkt auf /einstellungen/mahnwesen), Benachrichtigungsarten (im Code definiert, Pille 'nicht verbunden' mit O-36/O-501), Fusszeilen (lesend, verlinkt auf /einstellungen/identitaet). Der vierte Blocker der Kritik ist geloest, ohne die RLS zu weiten: die Seite fragt bau.lesen/bau.schreiben/mahnung.lesen ausdruecklich und sagt 'nicht sichtbar' statt 'nicht hinterlegt'; die POST-Route autorisiert system.einstellung_verwalten UND bau.schreiben.
- `/portal/[mandant]/einstellungen/import` — fertig — Ehrliche Zustandsseite aus dem PORT (nicht aus einer zweiten Liste) plus echte Lauf-Tabelle. MigrationImportPort mit einer ausgelieferten Umsetzung, die NichtVerbundenFehler wirft - kein Hochladefeld, keine simulierte Uebernahme. Die beiden feststehenden Regeln stehen auf der Seite: Zeiten als historische Zeilen mit quelle=migration ohne Serveruhr-Anspruch (Invariante 5), Rechnungen als Beleg, nie in Nummernkreis und nie in die Hashkette. Registerzeile 'altsystem' in registry/integrationen.ts ergaenzt, tests/kern/integrationen.test.ts entsprechend angepasst (die Liste war exakt festgeschrieben). Keine 'nicht verbunden'-Pille erfunden: StatusPill 'Inaktiv' + STAND_TEXT, genau wie /einstellungen/integrationen.
- `/portal/[mandant]/einstellungen/identitaet` — fertig — mandant_identitaet vollstaendig nach 01-KERN §6.2, samt mi_oeffentlich (prinzipalloser Renderpfad), Projektions-View mandant_identitaet_oeffentlich (ohne email_absender/email_signatur/domain), Alt-Text-CHECK, Anlage-Trigger und Nachtragung der vorhandenen Bereiche. Farbe ist ein TOKEN mit CHECK - kein Farbwaehler, das Farbfeld zeigt nur den Wert aus DESIGN §1. Kein Hochladeknopf, weil es keinen Marken-Bucket und keinen POST unter api/medien gibt; Alternativtexte sind trotzdem pflegbar. Kartentext/Profiltext werden hier NICHT gepflegt (unternehmensprofil je Sprache, D-82).
- `/portal/[mandant]/einstellungen/arbeitszeit` — teilweise — Seite, Tabellen, Dienst, Rechte, Leerzustand und beide Schreibwege sind vollstaendig. 'teilweise' betrifft genau EINE Regel: die Sollzeitherleitung bleibt nach Regel 1 ein Platzhalter (sollzeitregel='offen', SOLLSTUNDEN_OFFEN antwortet null, Seite zeigt 'offen (O-18)'). regelFuerModell ist die zweite Umsetzung der SollstundenRegel-Schnittstelle an genau einer Stelle; ein benannter, aber nicht gebauter Regelname traegt seinen Namen in die Meldung. Tarif: tv_mindestens_gesetz laesst keinen Wert unter § 4/§ 5 ArbZG zu, der Dienst weist ihn VORHER benannt ab - die ArbZG-Grenzen sind keine Einstellung (Seitenkarte Z. 1927-1932).

## src/server/registry/dienste.ts

/**
   * Die Einstellungen der Domaene `einstellungen` (PR einstellungen).
   *
   * `migration/uebernahme` liest nur: den Parser gibt es nicht (O-128), und
   * der Port wirft. `audit/buendel` schreibt - Kettenglieder und die
   * Protokollzeile des Abrufs -, und sein Schreibrecht ist
   * `system.audit_exportieren`; `app.audit_kette_fortschreiben` prueft
   * zusaetzlich `app.ist_readonly`, weil `exportieren` in der Gruppenansicht
   * erlaubt ist und diese Funktion trotzdem schreibt.
   */
  { modul: 'system', pfad: 'migration/uebernahme', schreibend: false },
  {
    modul: 'agent', pfad: 'agent/richtlinie',
    schreibend: true, schreibRecht: 'agent.richtlinie_verwalten',
  },
  {
    modul: 'system', pfad: 'audit/buendel',
    schreibend: true, schreibRecht: 'system.audit_exportieren',
  },
  {
    modul: 'system', pfad: 'mandant/identitaet',
    schreibend: true, schreibRecht: 'system.identitaet_verwalten',
  },
  /*
   * `einstellung/vorlagen` schreibt die Behinderungsvorlage, und die gehoert
   * dem Bau: `bau.schreiben` und nicht `system.einstellung_verwalten`. Die
   * Route autorisiert beide - das Recht der Seite UND das der Tabelle.
   */
  {
    modul: 'system', pfad: 'einstellung/vorlagen',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  {
    modul: 'stammdaten', pfad: 'zeit/arbeitszeitmodell',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },

## src/server/auth/route-manifest.ts

{
    /**
     * Eine Richtlinie des Ausgangs-Gates setzen (AGT-03, APR-01,
     * Invariante 7).
     *
     * `agent.richtlinie_verwalten` und nicht `versand.freigeben`: hier wird
     * die REGEL gesetzt, nicht eine Nachricht freigegeben. Wer Richtlinien
     * pflegt, laesst damit noch nichts hinausgehen - und wer freigibt,
     * aendert damit keine Regel. `0203` zieht die RLS der Tabelle auf
     * dasselbe Recht; vorher kam die Sitzung durch das Tor und bekam null
     * Zeilen.
     */
    pfad: 'api/einstellungen/agent-richtlinien',
    recht: 'agent.richtlinie_verwalten',
  },
  {
    /**
     * Das Beweismittelbuendel ueber das Pruefprotokoll (SEC-A9, DOC-08,
     * LEG-01): Manifest immer, ZIP mit Protokoll-CSV dazu. Jeder Abruf steht
     * im Protokoll - ein Beweismittel verlaesst das Haus.
     *
     * `system.audit_exportieren` ist das Recht der Route; die
     * Vorher/Nachher-WERTE haengen zusaetzlich an
     * `system.audit_sensitiv_lesen` (05-API-KARTE 369/591,
     * 03-AUTH-BERECHTIGUNGEN 2342). Fehlt das zweite, kommt ein redigiertes
     * Buendel mit dem Grund im Manifest.
     */
    pfad: 'api/einstellungen/protokoll/export',
    recht: 'system.audit_exportieren',
  },
  {
    /**
     * Das Erscheinungsbild einer Gesellschaft pflegen (TEN-07, PUB-09,
     * LEG-07, DESIGN §11).
     *
     * `system.identitaet_verwalten` und nicht `system.mandant_verwalten`:
     * das Erscheinungsbild ist nicht die Firmierung. Wer das Logo pflegt,
     * aendert damit keine Registernummer.
     */
    pfad: 'api/einstellungen/identitaet',
    recht: 'system.identitaet_verwalten',
  },
  {
    /**
     * Eine Behinderungsvorlage bestaetigen (BAU-06, § 6 VOB/B).
     *
     * Im Manifest steht das Recht der SEITE; der Handler autorisiert
     * zusaetzlich `bau.schreiben`, das Recht der TABELLE
     * (`behinderung_vorlage`, Policy `t_mandant`). Nur das erste zu pruefen
     * hiesse: Handler durch, RLS weist ab, null Zeilen, Erfolgsmeldung fuer
     * eine Aenderung, die nicht stattfand.
     */
    pfad: 'api/einstellungen/vorlagen',
    recht: 'system.einstellung_verwalten',
  },
  {
    /**
     * Ein Arbeitszeitmodell oder eine Tarifregel hinterlegen (EMP-04,
     * TIM-06, TIM-14, O-18, O-50).
     *
     * `stammdaten.verwalten` ist das Recht der Seite UND das der beiden
     * Tabellen (0201) - hier gibt es keinen Rechtebruch zu ueberbruecken.
     * Die gesetzlichen ArbZG-Grenzen sind keine Einstellung; ein Wert
     * darunter wird abgewiesen.
     */
    pfad: 'api/einstellungen/arbeitszeit',
    recht: 'stammdaten.verwalten',
  },

## src/server/db/schema/rls.ts

// --- KEIN_HARD_DELETE: fuenf Eintraege, Reihenfolge je Migration beachten
// (der Generator schreibt sie in Registerreihenfolge; die Bloecke in
// 0200-0203 sind genau so bereits eingesetzt).
  {
    tabelle: 'mandant_identitaet',
    art: 'append',
    migration: '0200',
    grund:
      '§6.2, TEN-07, LEG-01. Die 1:1-Zeile traegt die rechtlichen Fusszeilen, die auf '
      + 'jedem Angebot und jeder Rechnung dieser Entitaet stehen, und den Alternativtext '
      + 'jedes ausgelieferten Bildes (PUB-09, LEG-07). Sie entsteht mit dem Mandanten und '
      + 'endet nie: es gibt keinen Zustand „diese Gesellschaft hat kein Erscheinungsbild", '
      + 'nur Felder ohne Wert. Eine geloeschte Zeile machte TEN-07 wertlos und die '
      + 'Herkunft einer alten Fusszeile unbelegbar.',
  },
  {
    tabelle: 'arbeitszeitmodell',
    art: 'archiv',
    migration: '0201',
    grund:
      'EMP-04, TIM-06, LEG-02, O-18. Das Modell ist die Grundlage jeder Sollstunden- und '
      + 'Urlaubsrechnung; eine geloeschte Fassung bewertet stillschweigend jeden Monat '
      + 'neu, in dem sie galt, und der Zeitnachweis nach § 17 MiLoG stimmt danach mit '
      + 'keinem Papier mehr ueberein. Abgeloest wird sie von der naechsten datierten '
      + 'Zeile, geschlossen ueber `gueltig_bis`.',
  },
  {
    tabelle: 'tarifvereinbarung',
    art: 'archiv',
    migration: '0201',
    grund:
      'O-50, TIM-14, LEG-03. Die strengere Pausen- und Ruhezeitregel entscheidet, ob eine '
      + 'geplante Schicht rechtmaessig war. Wird die Zeile geloescht, prueft der Planer '
      + 'rueckwirkend gegen das Gesetz statt gegen den Tarif — und jeder frueher '
      + 'gemeldete Verstoss verschwindet, ohne dass sich eine Schicht geaendert hat. '
      + 'Abgeloest wird sie von der naechsten Fassung, geschlossen ueber `gilt_bis`.',
  },
  {
    tabelle: 'migration_lauf',
    art: 'archiv',
    migration: '0202',
    grund:
      'ROADMAP Phase 10, LEG-01, ACC-06. Der Lauf ist der Nachweis, WOHER ein historischer '
      + 'Zeit- oder Buchungsdatensatz kommt — Datei, Pruefsumme, wer geprueft und wer '
      + 'uebernommen hat. Ohne ihn ist eine uebernommene Zeile eine Behauptung ueber die '
      + 'Vergangenheit. Verworfen wird ein Lauf ueber `status`, nie durch DELETE.',
  },
  {
    tabelle: 'migration_zeile',
    art: 'append',
    migration: '0202',
    grund:
      'ROADMAP Phase 10, LEG-01. Die Rohzeile belegt, was in der Quelldatei stand, als '
      + 'jemand die Uebernahme freigab. Wird sie geloescht, laesst sich ein uebernommener '
      + 'Zeitnachweis nach § 17 MiLoG nicht mehr gegen seine Quelle halten.',
  },
  {
    tabelle: 'agent_richtlinie',
    art: 'archiv',
    migration: '0203',
    grund:
      'AGT-03, APR-01, Invariante 7, SEC-A9. Die Zeile entscheidet, ob eine Nachricht ohne '
      + 'benannten Menschen hinausgeht. Sie zu loeschen ist fail-closed — und genau '
      + 'deshalb verfuehrerisch: der Bildschirm sagt danach „nicht hinterlegt", und '
      + 'niemand kann belegen, ob je etwas anderes dort stand. Abgeschaltet wird eine '
      + 'Richtlinie ueber `ist_aktiv`, nicht durch DELETE.',
  },

// --- GEAENDERT_AM: vier Eintraege
  { tabelle: 'mandant_identitaet', migration: '0200' },
  { tabelle: 'arbeitszeitmodell', migration: '0201' },
  { tabelle: 'tarifvereinbarung', migration: '0201' },
  { tabelle: 'migration_lauf', migration: '0202' },
  { tabelle: 'agent_richtlinie', migration: '0203' },

// --- AUDITIERT: fuenf Eintraege
  { tabelle: 'mandant_identitaet', migration: '0200' },
  { tabelle: 'arbeitszeitmodell', migration: '0201' },
  { tabelle: 'tarifvereinbarung', migration: '0201' },
  { tabelle: 'migration_lauf', migration: '0202' },
  { tabelle: 'agent_richtlinie', migration: '0203' },

// --- NUR_UEBER_DEFINER: die beiden Kettentabellen (0204)
  {
    tabelle: 'kern.audit_kette',
    zugang: 'app.audit_kette_fortschreiben / app.audit_kette_pruefen',
    grund:
      '§6.12/§9.1. Der Kettenkopf traegt laufende Nummer und letzten Hash des Protokolls. '
      + 'Eine Policy, die `cse_app` an die Zeile liesse, machte den Zaehler von aussen '
      + 'bewegbar — und eine Kette, deren Kopf jemand verstellen kann, bezeugt nichts '
      + '(dasselbe Muster wie `freigabe_kette`). Kein Grant, keine cse_app-Policy. Die '
      + 'Loeschsperre steht von Hand in 0204, weil der Generator aus einem '
      + 'schemaqualifizierten Namen keinen gueltigen Triggernamen bilden kann.',
  },
  {
    tabelle: 'kern.audit_kettenglied',
    zugang: 'app.audit_kette_fortschreiben / app.audit_kette_pruefen',
    grund:
      '§9.1. Je Protokollzeile ihre Kettenposition und ihr Hash — anfuegend. Ein Glied, '
      + 'das von aussen schreibbar waere, liesse eine manipulierte Protokollzeile neu '
      + 'beglaubigen; genau das soll die Kette ausschliessen. Loeschsperre von Hand in '
      + '0204 (schemaqualifizierter Name, siehe kern.audit_kette).',
  }

## src/server/registry/navigation.ts

Keine Aenderung noetig. Alle sechs Routen haengen unter dem vorhandenen NAVIGATION-Punkt `einstellungen` (Tab `mehr`) und werden ueber die Karten in `src/app/portal/[mandant]/einstellungen/page.tsx` erreichbar — die habe ich dort selbst ergaenzt (sechs neue KARTEN-Eintraege), weil die Datei nicht in der Liste der zentral gepflegten steht. Jede Karte fragt das Recht ihrer Zielseite aus dem Manifest, also entscheidet dieselbe Pruefung wie bisher, wer sie sieht. Zu GRUPPEN_NAVIGATION gehoert nichts davon: Einstellungen sind ein Verwaltungspunkt, und in einer Ansicht ohne aktiven Mandanten gibt es nichts einzustellen (das prueft tests/kern/portal-shell.test.ts ausdruecklich).

## Sonstiges

1) scripts/generate-triggers.ts — MIGRATIONS_DATEIEN braucht vier neue Zeilen, sonst schlaegt `pnpm db:triggers --check` fehl (die Bloecke sind in den Dateien schon eingesetzt und stimmen Zeichen fuer Zeichen mit der Generatorausgabe ueberein):
  // Einstellungen (mandant_identitaet, Arbeitszeit, Uebernahme, Agent-Richtlinie).
  '0200': join(WURZEL, 'drizzle/0200_mandant_identitaet.sql'),
  '0201': join(WURZEL, 'drizzle/0201_arbeitszeitmodell_tarif.sql'),
  '0202': join(WURZEL, 'drizzle/0202_migration_lauf.sql'),
  '0203': join(WURZEL, 'drizzle/0203_agent_richtlinie_recht.sql'),
  (0204 traegt KEINEN generierten Block: seine beiden Tabellen liegen in `kern` und stehen in NUR_UEBER_DEFINER.)

2) docs/architecture/04-SEITENKARTE.md — die sechs Routen sind jetzt gebaut; die Zeilen 1903, 1910, 1911, 1912, 1917 und 1918 duerfen ihren „not built"-Vermerk verlieren. Zwei Praezisierungen fuer die Karte: (a) der Vorher/Nachher-Export haengt an `system.audit_sensitiv_lesen`, nicht an `system.audit_exportieren` — der Satz „stehen dem Export mit system.audit_exportieren offen" steht nicht in der Seitenkarte, sondern im Kopfkommentar von einstellungen/protokoll/page.tsx:14-17 und ist dort zu korrigieren; (b) `/portal/[mandant]/agenten/richtlinien` und `/[id]` (routen.generiert.ts:294/295) fuehren dieselbe Tabelle wie `/einstellungen/agent-richtlinien`. Gebaut ist der Editor in den Einstellungen; die beiden Agentenrouten gehoeren zu `agenten-freigaben-radar` und sollten Weiterleitungen werden, nicht ein zweiter Editor. Ich habe sie bewusst NICHT angefasst.

3) docs/DESIGN.md — keine Ergaenzung noetig, und das ist eine Entscheidung: die von der Kritik zu Recht bemaengelte „nicht verbunden"-Pille habe ich NICHT erfunden. §5 kennt keinen Verbindungszustand, also nehmen /einstellungen/import und der E-Mail-Abschnitt von /einstellungen/vorlagen genau die Darstellung von /einstellungen/integrationen: StatusPill „Inaktiv" (geschlossenes Vokabular) plus STAND_TEXT.nicht_verbunden als stummer Text. Wer das kuenftig als eigene Pille will, ergaenzt zuerst DESIGN §5.

4) src/server/registry/integrationen.ts habe ich selbst ergaenzt (Zeile `altsystem`, Zustand aus dem Port, offen: 'O-128') — die Datei steht nicht in der Liste der zentral gepflegten. Dazu gehoert die angepasste Erwartung in tests/kern/integrationen.test.ts:38 (['altsystem','email','karte','modell','n8n','ocr','sms']); ohne sie faellt der Test.

5) src/server/services/zeit/arbzg.ts — drei Konstanten sind jetzt exportiert (ACHT_STUNDEN, ZEHN_STUNDEN, RUHEZEIT_MINUTEN, PAUSE_AB_6H, PAUSE_AB_9H). Rein additiv; /einstellungen/arbeitszeit stellt den Tarif daneben, und eine zweite Liste derselben Gesetzeswerte waere die Stelle, an der eine davon veraltet.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-620 | **Welche Adresse ist die maßgebliche Quelle fuer Kartentext (PUB-03) und Profiltext (PRO-01) einer Gesellschaft — `unternehmensprofil` je Sprache oder `mandant_identitaet`?** 01-KERN §6.2 fuehrt `kurzbeschreibung` und `beschreibung` auf `mandant_identitaet`; `unternehmensprofil` fuehrt beide seit 0155 JE SPRACHE, und D-82 verlangt genau das fuer den oeffentlichen Auftritt. 0200 legt die Spalten nach §6.2 an, markiert sie im Spaltenkommentar als zweiten Ort und laesst `/einstellungen/identitaet` sie NICHT pflegen — die Seite verweist auf die Website-Pflege, damit es nicht zwei Editoren fuer einen Text gibt. Bis zur Antwort sind die beiden Spalten unbenutzt. | TEN-07, PUB-03, PRO-01, D-82, `mandant_identitaet`, `unternehmensprofil`, 0200 |
| O-621 | **Soll `mandant_identitaet.rechnung_fuss` bei der Festschreibung in den kanonischen Rechnungs-Payload kopiert werden (K-12) — und wenn ja, als Abbildung auf `rechnung.fusstext` beim Anlegen oder als neues Feld im Payload?** Heute geschieht KEINES von beidem: `services/finanz/kanonisch.ts` kennt kein Mandanten-Fussfeld (Leistender, Z. 251-264), und `fusstext` ist die freie Spalte aus der Eingabe. Eine Aenderung der Fusszeile wirkt damit auf keine Rechnung — weder rueckwirkend (richtig) noch auf neue (falsch). Der Payload ist die Eingabe der Hashkette; ein neues Feld darin ist ein Eingriff mit eigenen Tests. `/einstellungen/identitaet` und `/einstellungen/vorlagen` sagen beides ausdruecklich, statt K-12 als erfuellt darzustellen. | K-12, FIN-06, DESIGN §11, `kanonisch.ts`, `mandant_identitaet`, 0200 |
| O-622 | **Duerfen die bisher fail-closed gebauten `gate()`-Aufrufer ihre Richtlinie laden — also aus „immer Freigabe" ein „`auto_erlaubt` entscheidet" machen?** Drei Stellen uebergeben heute bewusst `null` und sagen es im Kommentar: `api/anfrage/route.ts:342`, `api/finanzen/mahnungen/route.ts:31` („Die Richtlinie wird bewusst NICHT geladen"), `api/bau/behinderungen/[id]/versenden/route.ts:36`; dazu `services/bau/behinderung.ts:481` und `services/finanz/mahnung/index.ts:394`. `services/agent/richtlinie.ts` liefert mit `findeRichtlinie` den Lesepfad, benutzt ihn dort aber NICHT — das ist eine Invariante-7-Entscheidung mit eigenen Tests, keine Aufraeumung. Bis zur Antwort bleibt jede dieser fuenf Stellen fail-closed, und die Seite `/einstellungen/agent-richtlinien` sagt, welche Aktionen im Code gesperrt sind. | AGT-03, APR-01, Invariante 7, `server/agent/policy.ts`, `services/agent/richtlinie.ts` |
| O-623 | **Wird die Hashkette ueber `audit_log` beim SCHREIBEN gezogen (01-KERN §9: `SELECT … FOR UPDATE` in `app.protokolliere`) oder nachtraeglich beim Bilden eines Beweismittels?** Umgesetzt ist das Zweite (0204): `kern.audit_kette` + `kern.audit_kettenglied` sind ein anfuegendes Kettenbuch NEBEN dem Protokoll, fortgeschrieben von `app.audit_kette_fortschreiben` unter `system.audit_exportieren` und nicht in der Gruppenansicht. Zwei Gruende, beide nachrechenbar: (a) `audit_log` hat heute fuer NIEMANDEN einen UPDATE-Grant und keine UPDATE-Policy — nachtraeglich zu fuellende Spalten verlangten genau diesen Schreibpfad; (b) eine Zeilensperre in `app.protokolliere` serialisiert jede schreibende Transaktion der Plattform und erzeugt eine Sperrreihenfolge gegen die Zaehlerzeilen in `nummernkreis` und `freigabe_kette`. Die Folge, die die Antwort braucht: Zeilen seit dem letzten Buendel sind ungekettet, und das Manifest nennt die Zahl statt „revisionssicher" zu behaupten. Zu entscheiden ist ausserdem, welcher Nachtlauf die Kette regelmaessig fortschreibt und prueft (verwandt mit O-357: der Kettenpruefer ist bewusst nicht als Job registriert, weil der Empfaenger der Meldung offen ist). | §6.12, §9.1, SEC-A9, LEG-01, FIN-06, O-357, 0204 |
| O-624 | **Traegt `system.audit_sensitiv_lesen` eine Zwei-Faktor-Pflicht?** 03-AUTH-BERECHTIGUNGEN Z. 2342 verlangt sie; in der lebenden Datenbank steht `erfordert_2fa = false`. Das Recht oeffnet die Vorher/Nachher-Werte des Protokolls, und die tragen Loehne, Geburtsdaten und Abwesenheitsgruende (Art. 9 DSGVO). `/einstellungen/protokoll/export` fordert es zusaetzlich zum Exportrecht und sagt sichtbar, wenn es fehlt (redigiertes Buendel) — die 2FA-Pflicht selbst ist eine Katalogaenderung und gehoert nicht in diese Domaene. | SEC-A9, AUT-02, LEG-09, `berechtigung`, 0204 |
| O-625 | **Soll die Uebernahme aus den Altsystemen rueckwirkend eine Modulbuchung oder ein eigenes Recht bekommen?** 0202 bewacht `migration_lauf`/`migration_zeile` mit `system.einstellung_verwalten` (dem Recht der Route). Ein Lauf legt spaeter Zeiteintraege und Belege an — also Daten zweier Fachdomaenen unter einem Systemrecht. Verwandt mit dem Muster, das `/einstellungen/vorlagen` loest, indem es zusaetzlich `bau.schreiben` verlangt. Bis zur Antwort entsteht kein Lauf (O-128), also wirkt die Frage noch nicht. | ROADMAP Phase 10, O-128, AUT-05, 0202 |

## Tests

- tests/kern/agent-richtlinie.test.ts — 12 Faelle, gruen. Kern: fuer JEDE der acht Aktionen wird gate() mit der grosszuegigsten denkbaren Richtlinie gefragt; was abgewiesen wird, MUSS in IM_CODE_GESPERRT stehen und umgekehrt. Eine vierte Sperre im Code ohne Registereintrag liesse die Seite „automatisch" anzeigen, wo abgewiesen wird.
- tests/kern/arbeitszeit-modell.test.ts — 16 Faelle, gruen. GESETZ ist dieselbe Quelle wie arbzg.ts (keine zweite Liste); pruefeTarifRegel weist 29/44/659 Minuten ab und nennt ALLE zu schwachen Werte; alsMengeText formt Text zu Text (kein Number); keine Sollzeitregel liefert je eine Zahl, und sollMinutenOderFehler wirft statt 0 zurueckzugeben.
- tests/kern/audit-buendel.test.ts — 11 Faelle, gruen. Zeilen-CSV mit ebene-Spalte, RFC-4180-Feldform und Hochkomma vor Formelstart; ein redigiertes Buendel enthaelt die Nutzlastdatei NICHT; zweimal gepackt ergibt dieselben Bytes und denselben SHA-256; das Manifest im Archiv ist Byte fuer Byte das des Buendels.
- tests/kern/einstellungen-vorlagen.test.ts — 8 Faelle, gruen. ERLAUBTE_PLATZHALTER wird gegen die QUELLE von Vorlagenwerte gehalten (eine Schnittstelle ist zur Laufzeit nicht aufzaehlbar): erweitert jemand Vorlagenwerte und vergisst die Liste, wird der Test rot. Jeder erlaubte Platzhalter wird von setzeVorlage wirklich ersetzt, ein unbekannter abgewiesen.
- tests/isolation/mandant-identitaet.test.ts — NICHT ausgefuehrt (pnpm test:isolation ist untersagt); jede Zusicherung von Hand gegen echtes Postgres geprueft (siehe notizen). Prueft: Lesen ohne Fachrecht, Schreiben nur mit system.identitaet_verwalten (leitung: 0 Zeilen), kein INSERT und kein UPDATE auf mandant_id fuer cse_app, prinzipalloser Renderpfad nur mit oeffentlich_sichtbar, Projektions-View ohne email_absender/email_signatur/domain, Alt-Text-CHECK, Anlage-Trigger eingeschaltet, unbekannter Slug bricht mit DESIGN-Anleitung ab, kein DELETE.
- tests/isolation/arbeitszeit-tarif.test.ts — NICHT ausgefuehrt, von Hand geprueft. Prueft: 30/45/660 gehen durch, 29/44/600 werden abgewiesen (tv_mindestens_gesetz), verdrehte Pausen (tv_pausen_geordnet), Ueberlappungsfreiheit je Schluessel bzw. Gewerk und dass sie nach dem Schliessen weichen, Bestaetigung paarweise und unvereinbar mit ist_platzhalter, Lesen mit stammdaten.verwalten ODER zeit.konto_lesen, nichts ohne beide, Kundenportal leer, Gruppenansicht schreibt nicht, wochenstunden nach dem Anlegen nicht mehr aenderbar, kein DELETE.
- tests/isolation/audit-kette.test.ts — NICHT ausgefuehrt, von Hand geprueft. Prueft: fortschreiben kettet jede offene Zeile und der zweite Lauf ist leer (je Protokollzeile genau ein Glied), ohne system.audit_exportieren wird nichts gekettet, der Kettenkopf ist fuer cse_app unerreichbar, eine unveraenderte Kette ist geschlossen, eine manipulierte Protokollzeile bricht sie und die STELLE wird genannt und am Kopf vermerkt, das Nutzlastbuendel schreibt GENAU EINE Protokollzeile, ohne system.audit_sensitiv_lesen kommt nichts (nicht etwa Nullwerte), cse_app kommt an vorher/nachher nicht direkt heran, Plattformzeilen sind nie Teil eines Mandantenbuendels, Deckung vor/nach dem Ketten, kein DELETE.
- tests/isolation/migration-lauf.test.ts — NICHT ausgefuehrt, von Hand geprueft. Prueft: neuer Lauf ist Entwurf und zaehlt nichts, uebernommen ohne Zeitpunkt und verworfen ohne Namen werden abgewiesen, der vollstaendige Weg geprueft→uebernommen geht, die Zaehler muessen aufgehen, ml_sha256 und ml_quelle, dieselbe Datei je Quelle nur einmal (andere Quelle/Gesellschaft ist ein eigener Lauf), Rohzeile nur zum Lauf derselben Gesellschaft (mz_lauf_fk), Zeilennummer je Lauf einmal, Ziel paarweise, Rechte samt K-04-Decke fuer Arbeiter- und Kundenportal, kein DELETE.
- tests/isolation/agent-richtlinie-recht.test.ts — NICHT ausgefuehrt, von Hand geprueft (der entscheidende Fall sogar zweifach: eine Sitzung mit module={agent} haelt agent.richtlinie_verwalten und kein versand.*, liest und schreibt nach 0203). Prueft ausserdem: keine Regression fuer versand.*-Leser, nichts ohne eines der beiden Rechte, fremder Bereich unsichtbar, Gruppenansicht schreibt nicht, jede Aenderung steht mit Vorher/Nachher im Protokoll, geaendert_am/geaendert_von werden gesetzt, kein DELETE.

## NICHT gebaut

- Der eigentliche Altsystem-PARSER (MigrationImportPort mit echtem Format, 07-INTEGRATIONEN §25.3, PR 89). Grund: O-128 nennt kein Exportformat. Gebaut ist Port, Zustandsseite, Registerzeile und die Lauftabelle; die eine fehlende Stelle ist migrationPort(), das heute NichtVerbundenPort liefert.
- Bild-Upload fuer Logo, Avatar und Cover (/einstellungen/identitaet). Grund: BUCKETS in server/storage/adapter.ts kennt keinen Marken-Bucket, und unter src/app/api/medien liegt kein POST. Bewusst KEIN Knopf, der nichts tut (O-12, O-13). Die Alternativtexte sind pflegbar, weil sie Text sind und nach PUB-09/LEG-07 Pflicht.
- Das K-12-Kopieren von rechnung_fuss in den kanonischen Rechnungs-Payload. Grund: der Payload kennt kein Mandanten-Fussfeld, und ein neues Feld darin ist ein Eingriff in die Hashketten-Eingabe mit eigenen Tests. Als O-621 zurueckgegeben; beide Seiten sagen es ausdruecklich.
- Die datierte Sollzeitherleitung, Uebertrags- und Verfallsregel (O-18) und die konkreten Tarifwerte (O-50). Grund: Regel 1 — jede gelieferte Zahl waere eine erfundene Geschaeftsregel mit Lohnfolge. Tabellen, Dienst, Seite, Formulare und Rechte stehen vollstaendig; offen ist nur der Wert, und die Seite zeigt ihn als 'offen (O-18)' bzw. 'nicht hinterlegt (O-50)'.
- Die Weiterleitung von /portal/[mandant]/agenten/richtlinien(+/[id]) auf den Editor in den Einstellungen. Grund: /agenten/** gehoert zur Domaene agenten-freigaben-radar; zwei Agenten im selben Arbeitsbaum an derselben Datei waere schlimmer als der Befund. Als Punkt 2 in registry_sonstiges zurueckgegeben.
- Ein Nachtlauf, der app.audit_kette_fortschreiben regelmaessig ruft. Grund: O-357 halt den Kettenpruefer ausdruecklich aus dem Job-Register heraus, solange offen ist, wer die Meldung 'Hashkette gebrochen' bekommt. Die Kette waechst deshalb beim Bilden eines Beweismittels; O-623 fragt nach dem Lauf.

## Notizen des Bauenden

ALLE SECHS ROUTEN SIND GEBAUT, keine leere Seite, keine simulierte Anbindung. `npx tsc --noEmit` ist ueber das ganze Repository sauber, `npx eslint` auf allen meinen Dateien ohne Befund, die vier neuen kern-Tests laufen gruen (51 Faelle zusammen mit tests/kern/integrationen.test.ts), und `scripts/guards/run-all.ts` meldet zu meinen Pfaden nichts (die 22 Befunde dort sind todo-client-Nummern anderer Agenten im Bereich O-600..O-652, die noch nicht im Register stehen).

MIGRATIONEN GEPRUEFT: 0200-0204 laufen auf einer frisch angelegten `w_einst` bis `Migrationen angewendet.` durch — mehrfach, zuletzt nach der letzten Aenderung. Jede Abfrage und jede Policy habe ich zusaetzlich VON HAND als `cse_app` mit gesetzten GUCs gegen dieselbe Datenbank ausgefuehrt, weil ich die Isolationssuite nicht starten darf. Von Hand bestaetigt: Anlage-Trigger und Abbruch bei unbekanntem Slug; leitung liest die Identitaet, schreibt sie nicht (0 Zeilen); mandant_id und INSERT fuer cse_app verweigert; prinzipalloser Pfad nur mit oeffentlich_sichtbar, auch ueber die View; mi_alt_text; tv_mindestens_gesetz, tv_pausen_geordnet, azm_kein_ueberlapp und dass die zweite Fassung nach dem Schliessen durchgeht; azm_bestaetigt_kein_platzhalter und azm_bestaetigung_paarweise; Lesen des Modells mit zeit.konto_lesen ohne stammdaten.verwalten, wochenstunden-UPDATE verweigert, Kundenportal leer; alle sieben migration_lauf/-zeile-CHECKs samt mz_lauf_fk; Kette ueber 21 Zeilen, zweiter Lauf 0, Bruch an Position 5 erkannt und am Kopf vermerkt, Kettenkopf fuer cse_app unerreichbar, Loeschsperre auf beiden kern-Tabellen; agent_richtlinie mit module={agent} lesbar UND schreibbar (vor 0203: null Zeilen), Audit- und geaendert_am-Trigger schreiben.

EIN BEFUND, DEN ICH BEIM BAUEN GEFUNDEN UND SOFORT GESCHLOSSEN HABE: `system.audit_exportieren` traegt die Aktion `exportieren`, und `app.hat_recht_fuer` laesst `lesen` und `exportieren` in der Gruppenansicht ausdruecklich durch. `app.audit_kette_fortschreiben` und `app.audit_kette_pruefen` SCHREIBEN aber — ein Super-Admin mit globaler Rolle waere ueber den Rechtezweig durchgekommen und haette in einer nur lesenden Ansicht geschrieben (Invariante 10). Beide Funktionen pruefen jetzt zusaetzlich `app.ist_readonly()`; von Hand bestaetigt: 21 Glieder bei readonly=off, 0 bei readonly=on.

ZUR KRITIK, PUNKT FUER PUNKT: (1) Die Definer-Funktion `app.audit_nutzlast_lesen` existiert wirklich — ich habe sie nicht ersetzt, sondern eine mengenwertige Huelle daneben gestellt, weil die vorhandene zeilenweise arbeitet und JEDEN Aufruf protokolliert; ein Jahresbuendel haette Zehntausende Auditzeilen ueber sein eigenes Lesen erzeugt. Das Tor ist wie von der Kritik verlangt `system.audit_sensitiv_lesen` ZUSAETZLICH zum Exportrecht. (2) Es gab genau EIN Inline-SQL auf agent_richtlinie (nachtrag.ts:421), und ich habe es nicht angefasst: die fail-closed Aufrufer bleiben fail-closed, die Entscheidung ist O-622. (3) Den Pfad api/buchhaltung/camt/import gibt es nicht; ich habe das Vorschau-vor-Uebernahme-Muster des Raumbuchs genommen und die DESIGN-§5-Frage nicht durch eine erfundene Pille geloest, sondern durch die vorhandene Darstellung von /einstellungen/integrationen. (4) Der vierte Blocker auf /vorlagen ist geloest, ohne die Bau- und Mahn-RLS zu weiten. (5) mi_oeffentlich und die Projektions-View sind gebaut; der fehlende Schreibweg auf `mandant` betrifft /einstellungen/mandant, nicht diese Route. (6) Server Actions gibt es nur unter src/app/auth/** und src/app/dev — im Portal habe ich ueber Route-Handler geschrieben. (7) §6.15 ist die richtige Fundstelle fuer anstellung_kondition; die Tabelle existiert seit 0192 (personal war vor mir fertig), ich verweise nur darauf.

ZWEI DINGE, DIE DER PARENT WISSEN SOLLTE: (a) `mandant.farbe_token` bleibt tote Spalte — die Bereichsfarbe kommt jetzt aus `mandant_identitaet.identitaets_token` mit CHECK, und der Seed schreibt farbe_token weiterhin, ohne dass jemand liest. Ein Aufraeumen waere eine eigene kleine Migration, und sie gehoert nicht in meine Nummern. (b) Die Testfixtur `seed()` laeuft unter `session_replication_role = replica`, also feuert `kern.mandant_identitaet_anlegen` dort NICHT und die Identitaetszeilen fehlen nach jedem seed(); dasselbe hatte reinigung.test.ts:1051 fuer die Behinderungsvorlagen. Meine Isolationsdatei legt die Zeilen deshalb selbst an und prueft den Ausloeser ueber seinen Abbruchfall. Der PRODUKTIONSSEED benutzt replica nicht — dort entstehen die vier Zeilen wie vorgesehen.

GESTALTUNG: keine neue Farbe, kein neuer Abstand, keine neue Pille. Nur Klassen, die im Repository schon stehen (text-text/-muted/-subtle, bg-surface/-3, border-line/-strong, text-warning, bg-brand/hover, s1..s7, text-h1/h2/h3/micro), StatusPill aus dem geschlossenen Vokabular und Hinweis mit art hinweis|warnung. Einmal steht ein Hex-Wert als inline-`style`: das Farbfeld auf /einstellungen/identitaet zeigt den Wert aus FARBEN_BEREICH, also DESIGN §1 als Daten — eine Tailwind-Klasse je Bereich waere eine zweite Liste derselben Farbe. Fehlend und gemeldet: DESIGN §4 fuehrt kein Import-Symbol, die Uebernahme-Karte nimmt deshalb `eingang`.
