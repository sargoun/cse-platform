# Registereintraege: zustellung

**Warteschlange, kein Archiv.** Diese Eintraege sind **noch nicht** im Baum.
Eingetragen heisst geloescht.

## Gebaut

- /home/user/cse-platform/drizzle/0350_mein_posteingang_nachricht.sql — Definer-Funktionen kern.nachricht_faden_beteiligt, kern.nachricht_selbst_verfasst, kern.nachricht_absender_name (alle owner cse_definer, K-01); Spalten-Grants + Policy d_nachricht_empfaenger_faden fuer cse_definer; p_beteiligt auf nachricht_empfaenger um den Zweig 'selbst verfasst' erweitert; Index nachricht_faden_zeit_idx
- /home/user/cse-platform/src/server/services/mitarbeiter/nachricht.ts — NEU: listeMeineFaeden, ladeMeinenFaden, mandantDesFadens, antwortZiele, fadenGeschlossen; Konstanten EIGENER_FADEN_MOEGLICH (O-830) und ANLAGEN_ABRUFBAR (O-831). Rein LESEND — kein Schreibweg (Zusage von tests/kern/mitarbeiter.test.ts)
- /home/user/cse-platform/src/server/services/mitarbeiter/posteingang.ts — NEU: reine Rechenfunktionen mischePosteingang() und zaehleUngelesen(). Zwei Quellen, eine Liste, getrennte Ungelesen-Zahlen
- /home/user/cse-platform/src/app/portal/mein/nachrichten/page.tsx — die Liste fuehrt benachrichtigung UND nachricht zusammen, nach Zeit sortiert; je Zeile 'Systemmeldung' oder 'Nachricht', Gesellschaft (EMP-14/D-09), Absender, eigene Ungelesen-Zahl; Hinweis zu O-830
- /home/user/cse-platform/src/app/portal/mein/nachrichten/[id]/page.tsx — oeffnet BEIDES: erst die Meldung (unveraendert, alte Links bleiben gueltig), sonst den Faden als Faden mit Verlauf, Absendernamen, Anlagenzahl (O-831), 'Als gelesen markieren' und Antwortfeld
- /home/user/cse-platform/src/app/api/mein/nachrichten/[id]/route.ts — NEU: POST mit was=gelesen | antworten. Mandant im Personen-Scope aufgeloest, dann withTenant mit portal:'mitarbeiter' (K-18, wie api/mein/antraege); geschrieben wird ueber den Fachdienst antworte() aus services/kern/nachricht.ts; Redirect 303, kein JSON
- /home/user/cse-platform/src/lib/i18n/texte.ts — 16 neue MeinTexte-Schluessel in allen vier Portalsprachen (de/en/ar/tr)
- /home/user/cse-platform/src/server/db/seed/kern.ts — der Demofaden geht jetzt an bis zu drei ANMELDBARE Menschen der Gesellschaft (an + kopie), und die Antwort kommt von der Angeschriebenen statt vom Absender selbst; damit hat Fatima im Seed in BEIDEN Gesellschaften einen zweizeiligen Faden
- /home/user/cse-platform/tests/isolation/mein-nachrichten.test.ts — NEU, 15 Faelle gegen echtes Postgres
- /home/user/cse-platform/tests/kern/mein-posteingang.test.ts — NEU, 9 Faelle fuer die Mischung und die Zaehlung

## Migrationen

- 0350_mein_posteingang_nachricht.sql — angewendet und geprueft gegen w_zust und iso_zust. 0351–0354 blieben ungenutzt: es war genau EINE Migration noetig.

## src/server/registry/dienste.ts

Zwei Zeilen fuer src/server/registry/dienste.ts (DIENSTE). Beide LESEND — der Schreibweg ist kern/nachricht, das dort bereits als schreibend unter nachricht.versenden steht; tests/kern/mitarbeiter.test.ts verlangt ausdruecklich, dass kein Dienst unter mitarbeiter/ schreibt, und genau deshalb liegt der Schreibsatz im Fachdienst:

  /**
   * **Der Posteingang der Kraft (0350, EMP-11).** Beide lesend: der Faden wird
   * gelesen, geantwortet wird ueber `kern/nachricht` — den Fachdienst, der
   * ohnehin unter `nachricht.versenden` schreibt. Ein vierter, im Portaldienst
   * angelegter Schreibweg waere genau der, der an den drei bekannten
   * vorbeifuehrt. `mitarbeiter/posteingang` beruehrt gar keine Datenbank: es
   * mischt `benachrichtigung` und `nachricht` zu einer Liste.
   */
  { modul: 'nachricht', pfad: 'mitarbeiter/nachricht', schreibend: false },
  { modul: 'nachricht', pfad: 'mitarbeiter/posteingang', schreibend: false },

Ohne diese zwei Zeilen faellt tests/kern/mitarbeiter.test.ts > 'jeder Dienst unter mitarbeiter/ ist eingetragen'.

## src/server/auth/route-manifest.ts

Ein Eintrag fuer src/server/auth/route-manifest.ts (ROUTEN):

  {
    /**
     * Der Rueckweg des Posteingangs (EMP-11, NOT-03, 0350): stempeln und
     * antworten. Kein Rechteschluessel, und das ist kein Loch (K-19,
     * SEITENKARTE §7) — dieselbe Begruendung wie bei `api/mein/antraege`:
     * „nur die Beteiligte" laesst sich als Recht nicht ausdruecken, weil ein
     * Recht einer Rolle gehoert und eine Rolle vielen Menschen.
     */
    pfad: 'api/mein/nachrichten/[id]',
    recht: null,
    grund:
      'EMP-11, NOT-03, SEITENKARTE §7. Den EIGENEN Faden als gelesen stempeln und darin '
      + 'antworten ist Selbstzugriff und kein Modulrecht (K-19). Die Wache ist vierfach: '
      + 'die Sitzung, der Ursprungsvergleich, der aus dem FADEN serverseitig aufgeloeste '
      + 'Mandant (K-02, Invariante 3 — ein fremder Faden gibt dort null Zeilen und damit '
      + '404 statt 403, AUT-06) und die Policies: `t_empfaenger_eigene_stempeln` (0231) '
      + 'trifft nur die eigenen Zustellzeilen, und fuer die Antwort pruefen '
      + '`t_nachricht_mandant` und `t_empfaenger_mandant` im WITH CHECK '
      + '`nachricht.versenden` — im Katalog an `mitarbeiter` gebunden — unter der '
      + 'restriktiven K-04-Mitarbeiterdecke `p_beteiligt`. Nichts verlaesst dabei das '
      + 'System: richtung `intern`, kanal `portal` (Invariante 7, O-36).',
  },

Ohne diesen Eintrag faellt tests/kern/routen.test.ts > 'keine Route fehlt im Manifest' und tests/kern/mitarbeiter.test.ts > 'und die Liste beschreibt den Baum'.

## src/server/db/schema/rls.ts

Keine Aenderung noetig. 0350 legt keine Tabelle an; der generierte Hard-Delete-Block fuer nachricht, nachricht_empfaenger und nachricht_anhang steht unveraendert in 0231. Zur Kenntnis fuer die Policy-Pflege: 0350 ERSETZT p_beteiligt auf nachricht_empfaenger (drop + create in derselben Transaktion) und haengt einen vierten Zweig an — kern.nachricht_selbst_verfasst(mandant_id, nachricht_id). Wortlaut und Begruendung stehen als comment on policy an der Policy selbst.

## src/server/registry/navigation.ts

Keine Aenderung noetig. /portal/mein/nachrichten ist als vierter Tab der Mitarbeiterleiste bereits registriert (registry/tableiste.ts), und /portal/mein/nachrichten/[id] ist eine Unterseite derselben Familie. Es kommt keine neue Navigationsadresse hinzu.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-830 | **Darf eine Mitarbeiterin im Portal von sich aus eine Nachricht schreiben — und an wen?** Antworten funktioniert vollstaendig (0350): wer angeschrieben wird, schreibt zurueck, und die Empfaenger ergeben sich aus dem Faden. Beim ERSTEN Brief gibt es diese Antwort nicht — sie waere eine Empfaengerliste, und die zusammenzustellen heisst zu entscheiden, wen eine Reinigungskraft erreichen darf: nur die Einsatzleitung des laufenden Einsatzes, jede Leitung ihrer Gesellschaft, die Verwaltung, jedes Konto? Das ist eine betriebliche Festlegung mit Folgen fuer die Erreichbarkeit der Leitung. Die Datenbank stuende bereit: `nachricht.versenden` ist an die Rolle `mitarbeiter` gebunden (0008), `eroeffneFaden` schreibt intern und im Portal. Heute gilt: kein Eroeffnen; die Seite sagt es als Satz an der Stelle, an der der Knopf staende (`EIGENER_FADEN_MOEGLICH = false`). | `services/mitarbeiter/nachricht.ts`, `/portal/mein/nachrichten`, `drizzle/0350`, `drizzle/0008`, EMP-11, K-19 |

| O-831 | **Darf eine Mitarbeiterin die Anlage einer internen Nachricht im Portal oeffnen?** Die ANZAHL der Anlagen ist im Personen-Scope lesbar (`t_anhang_eigene`, 0231) und steht an jeder Fadenzeile — eine Nachricht mit Anlage, die aussieht wie eine ohne, waere die schlechtere Antwort. Die DATEI haengt an `dokument`, und dort gibt es fuer den Personen-Scope keinen permissiven Lesepfad; einen zu setzen ist eine Entscheidung ueber Anlagen und nicht ueber Policies. Dieselbe Frage stellt O-671 fuer das Kundenportal, sie gehoert aber je Portal beantwortet: ein Dienstplan-PDF an die Kraft ist etwas anderes als eine Kalkulation an den Kunden. Offen ist zusaetzlich, fuer welche `dokument.kategorie` das gelten soll (vgl. O-736). Heute gilt: Zahl ja, Datei nein (`ANLAGEN_ABRUFBAR = false`). | `services/mitarbeiter/nachricht.ts`, `/portal/mein/nachrichten/[id]`, `drizzle/0231`, `drizzle/0350`, O-671, O-736, DOC-01, DOC-03 |


## Befunde

- DER BEFUND BESTAETIGT, ABER DIE URSACHE LAG WOANDERS ALS VERMUTET: Die RLS auf nachricht/nachricht_empfaenger war seit 0231 KORREKT. t_nachricht_eigene und t_empfaenger_eigene binden je Empfaengerart — 'person' gegen app.aktuelle_person(), 'benutzer' gegen app.aktueller_benutzer(). tests/isolation/nachricht-faden.test.ts (5) beweist beide Richtungen bereits seit 0231. Der Fehler war allein die Seite: /portal/mein/nachrichten/page.tsx und [id]/page.tsx lasen ausschliesslich @/server/benachrichtigung/posteingang, also die Tabelle benachrichtigung. Kein Policy-Defekt, sondern eine Tabellenverwechslung.
- ZUSATZBEFUND 1 — der Absendername war im Personen-Scope unerreichbar. t_benutzer_lesen (0007) gibt einer Mitarbeitersitzung genau EINE Zeile heraus: die eigene (der dritte Zweig haengt an app.aktiver_mandant(), und der ist im Personen-Scope NULL, K-20). Ein left join benutzer haette stillschweigend NULL geliefert — auf dem Telefon staende 'Nachricht von —'. Eine permissive Policy auf benutzer waere der falsche Weg: RLS ist zeilen-, nicht spaltenweise, und die Kraft bekaeme mit dem Namen auch email, gesperrt_bis, letzte_ip und globale_rolle_id. Loesung: Definer-Funktion, die EINEN TEXT herausgibt, und nur an jemanden, der im Faden steht (K-05).
- ZUSATZBEFUND 2 — die Gegenrichtung war an EINER Stelle blockiert. Antworten konnte die Kraft grundsaetzlich (nachricht.versenden ist im Katalog 0008 an die Rolle mitarbeiter gebunden, beide WITH-CHECK-Haelften von t_nachricht_mandant / t_empfaenger_mandant tragen genau diesen Schluessel). Was fehlte, war die EMPFAENGERZEILE der Antwort: p_beteiligt auf nachricht_empfaenger ist restriktiv, hat kein eigenes with check und benutzt deshalb sein using auch als with check — eine Zeile, die auf die LEITUNG zeigt, war damit ausserhalb des internen Portals nicht einfuegbar. Ohne sie kaeme die Antwort im Posteingang der Leitung nicht als ungelesen an (listeFaeden zaehlt nur eigene Empfaengerzeilen): der Faden truege in eine Richtung.
- ZUSATZBEFUND 3 — erbeEmpfaenger() aus services/kern/nachricht.ts ist im Mitarbeiterportal unbrauchbar. Unter der K-04-Decke sieht eine Kraft nur ihre EIGENE Empfaengerzeile; eine geerbte Antwort haette sich selbst adressiert und waere in ihrem eigenen Posteingang gelandet. Deshalb ermittelt antwortZiele() die Empfaenger ueber nachricht.absender_benutzer_id ('antworte denen, die mir geschrieben haben') und uebergibt sie ausdruecklich.
- ZUSATZBEFUND 4 — der Demobestand traf den Fehler mit. src/server/db/seed/kern.ts adressierte den Demofaden an die ERSTE Beschaeftigung der Gesellschaft; in der Reinigung ist das Jonas Berger, und der hat kein Konto. Nachgemessen: Fatima Yildiz sah im frisch geseedeten Bestand NULL Nachrichten und NULL Benachrichtigungen — der Leerzustand war von einer kaputten Abfrage nicht zu unterscheiden. Nach der Korrektur: zwei Faeden (reinigung + security), je zwei Zeilen, ungelesen 2, Absendername aufgeloest.
- ZUSATZBEFUND 5 — die Seed-Antwort war ein Selbstgespraech. Das Verwaltungskonto antwortete sich selbst, und die Antwort trug keine Empfaengerzeile; fuer die Kraft war sie damit unsichtbar (t_nachricht_eigene zeigt nur Selbstgeschriebenes oder Adressiertes). Der Verlauf auf der Detailseite hatte im Demobestand genau eine Zeile. Jetzt antwortet die Angeschriebene und adressiert zurueck.
- NICHT REPARIERT, WEIL KEIN DEFEKT: min(uuid) gibt es in Postgres nicht — im Fadenkopf wird der Mandant mit (array_agg(distinct n.mandant_id))[1] gezogen. Der Fehler faellt erst zur Laufzeit; er ist jetzt im Kommentar benannt.
- NICHT REPARIERT, WEIL AUSSERHALB: 'Ablaufwarnungen ohne Zugang zur Person (D-09)' im Seed — meldeAblaufwarnungen() erreicht Personen ohne benutzer-Zeile nicht. Das ist eine Eigenschaft von seed/benachrichtigung.ts und der Datenlage, nicht der Zustellung; ich habe die Datei nicht angefasst (Parallelarbeit).

## NICHT gebaut

- Eine Kraft kann von sich aus KEINEN neuen Faden eroeffnen — offen (O-830). Gebaut ist alles Uebrige: Daten, Liste, Detailseite, Antwort, Gelesen-Stempel, Rechte, Leerzustand. Fehlend ist allein die betriebliche Regel, WEN sie anschreiben darf; eine Empfaengerliste dafuer zu raten waere eine erfundene Geschaeftsregel. Die Seite sagt es als Satz an der Stelle, an der der Knopf staende (EIGENER_FADEN_MOEGLICH = false).
- Anlagen sind im Mitarbeiterportal nicht ABRUFBAR — offen (O-831). Die ANZAHL steht an jeder Fadenzeile (t_anhang_eigene traegt im Personen-Scope), die Datei nicht: dokument hat dort keinen permissiven Lesepfad. Ein Verweis staende vor einem 404 (ANLAGEN_ABRUFBAR = false).
- Kein Weg nach draussen: richtung='intern', kanal='portal'. Der Versand bleibt sendeNachAussen() und endet weiter an O-36 (kein Versender verbunden). Nichts wird simuliert.
- Keine e2e-Pruefung ergaenzt (Playwright, volle Suite ausgeschlossen). tests/e2e/mitarbeiter.spec.ts prueft die Seite weiterhin auf 200 und auf das Fehlen der Bauzustandsseite; beides gilt.

## Notizen

ERGEBNIS IN EINEM SATZ: Die Nachricht des Super-Admins erreicht Fatima jetzt — bewiesen mit einem Isolationstest gegen echtes Postgres, nicht behauptet.

WAS WIRKLICH KAPUTT WAR. Nicht die RLS. tests/isolation/nachricht-faden.test.ts beweist seit 0231, dass eine an `person` adressierte Nachricht genau diese Person erreicht und eine andere nicht — der Kommentar am Enum `nachricht_empfaenger_typ` hat gewirkt. Kaputt war die SEITE: sie las `benachrichtigung` (Systemmeldungen) statt `nachricht`. Zwei Tabellen, zwei Zwecke, ein Bildschirmname. Deshalb aendert 0350 an den bestehenden Lesepfaden nichts und ergaenzt nur, was fehlte.

DIE DREI STELLEN, AN DENEN ETWAS FEHLTE.
(1) Der Absendername. Im Personen-Scope gibt `t_benutzer_lesen` nur die eigene Zeile heraus — ein `join benutzer` haette stillschweigend NULL geliefert. Eine Policy auf `benutzer` waere zu grob (RLS ist zeilenweise: mit dem Namen kaeme email, gesperrt_bis, letzte_ip, globale_rolle_id). Gebaut ist deshalb `kern.nachricht_absender_name(uuid)`: gibt EINEN TEXT heraus und nur an jemanden, der im Faden steht. Der Test fragt mit der ECHTEN Id aus einer fremden Sitzung und bekommt NULL — kein Namensorakel.
(2) Die Empfaengerzeile der Antwort. `p_beteiligt` (restriktiv, ohne eigenes with check, also auch als with check wirksam) liess ausserhalb des internen Portals nur Zeilen zu, die auf einen selbst zeigen. Die Antwort an die Leitung war damit nicht einfuegbar, und ohne sie zaehlt `listeFaeden` beim Absender ungelesen=0 — der Faden truege in eine Richtung. 0350 haengt genau einen Zweig an: wer eine Nachricht VERFASST hat, darf ihre Empfaengerzeilen sehen und schreiben (`kern.nachricht_selbst_verfasst`). Das oeffnet nichts Neues — wer eine Nachricht anlegen darf, bestimmt ohnehin ihre Empfaenger —, es macht nur die zweite Haelfte derselben Handlung moeglich. Fuers Kundenportal aendert sich nichts: dort gibt es keinen Schreibweg (O-74).
(3) Der Demobestand. Der Seed adressierte den Faden an die erste Beschaeftigung — in der Reinigung an jemanden ohne Konto. Nachgemessen sah Fatima im frischen Seed NULL Nachrichten; der Leerzustand war von einer kaputten Abfrage nicht zu unterscheiden. Jetzt: zwei Faeden, je zwei Zeilen, Absender aufgeloest.

REKURSION VERMIEDEN, NICHT UEBERSEHEN. 0255 warnt vor dem Ringverweis nachricht ↔ nachricht_empfaenger ('infinite recursion detected in policy', zur Laufzeit). Beide neuen Policy-Helfer sind `security definer` UND `plpgsql` — security definer wird vom Planer nicht eingebaut, plpgsql zusaetzlich nicht, falls eine Funktion je ihren Definer verliert. Die cse_definer-Grants sind spaltenweise (vier Ids und ein Loeschstempel auf `nachricht`, vier Spalten auf `nachricht_empfaenger`); koerper, betreff, rechtsgrundlage und zweck bleiben draussen, wie 0231 es begruendet (K-05).

KEIN NEUES RECHT (K-19). Antworten im eigenen Faden ist Selbstzugriff. `nachricht.versenden` ist im Katalog ohnehin an `mitarbeiter` gebunden und wird von der Datenbank in beiden WITH-CHECK-Haelften geprueft. Der Umweg ueber zwei Scopes ist derselbe wie bei api/mein/antraege: Mandant im Personen-Scope aufloesen (fremder Faden -> null -> 404, nie 403), dann withTenant mit portal:'mitarbeiter', damit die K-04-Decke bleibt.

EINE ARCHITEKTURREGEL UNTERWEGS GELERNT. Mein erster Entwurf legte `antworteImPortal` in services/mitarbeiter/nachricht.ts. tests/kern/mitarbeiter.test.ts verlangt, dass KEIN Dienst unter mitarbeiter/ schreibt — 'ein vierter, im Portaldienst angelegter Schreibweg waere genau der, der an den drei bekannten vorbeifuehrt'. Der Schreibsatz liegt jetzt im Fachdienst (antworte() in kern/nachricht.ts, dort bereits registriert); der Portaldienst liefert nur die zwei Fragen, die allein im Personen-Scope beantwortbar sind.

ZUM TESTSTAND. Alles, was ich geschrieben habe, ist gruen (15 Isolationsfaelle, 9 Kernfaelle), ebenso die mitgelaufenen Nachbarn (nachricht-faden, definer-eigentum, benachrichtigung-posteingang, seed, spaltenrechte, schema-meta, unveraenderbarkeit, datenschutz-abdeckung, mitarbeiter-sprachen, routen-manifest, api-verdrahtung, wachen, verweis-rechte). Gefiltertes tsc und eslint sind sauber; die Merge-Wachen melden aus meinem Bereich NUR die zwei TODO(client)-Zeilen, die auf ihre Registereintraege warten.
ZWEI ZUSICHERUNGEN FALLEN NOCH, BEIDE NUR WEGEN DER ZENTRAL GEPFLEGTEN REGISTER: tests/kern/routen.test.ts ('keine Route fehlt im Manifest') und tests/kern/mitarbeiter.test.ts ('jeder Dienst unter mitarbeiter/ ist eingetragen' + 'die Liste beschreibt den Baum'). Die drei Texte dafuer stehen oben unter registry_manifest und registry_dienste; mit ihnen sind sie gruen. tests/kern/tableiste-ziele.test.ts faellt ebenfalls, aber wegen /portal/kunde/auftraege — das ist die Parallelarbeit am Kundenportal, nicht meine.

GEPRUEFT WURDE GEGEN EIGENE DATENBANKEN: w_zust (Migration + voller Seed, dreimal frisch aufgebaut) und iso_zust (Isolationslauf). Keine bestehende drizzle/*.sql angefasst; keine Datei aus der Nicht-anfassen-Liste geaendert.
