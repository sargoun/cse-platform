# Phase-3-Nacharbeit — die verifizierten Befunde der PR-Review

Dieses Dokument haelt fest, **was an Phase 3 nachweislich falsch ist**, wie es
nachgewiesen wurde und was die Behebung ist. Es ist kein Wunschzettel: jeder
Punkt wurde gegen den Quelltext der Datenbankfunktion, das Routenmanifest oder
den App-Router-Baum geprueft, bevor er hier steht. Erledigte Punkte werden
gestrichen, nicht geloescht — wer die PR spaeter liest, soll sehen, was gefunden
wurde und nicht nur, was am Ende dastand.

---

## A — `pruefeZugang` fragt in drei Scopes gegen NULL (kritisch)

**Befund.** `src/server/auth/zugang.ts` ruft
`pruefer.hatRecht(schluessel, sitzung.aktiverMandantId)`. In den Scopes `GRP`,
`KDN` und `PER→M1` ist `aktiverMandantId` per Konstruktion NULL (K-20).

**Nachweis.** `drizzle/0008_berechtigung_matrix.sql`, `app.hat_recht`:

```sql
if v_recht.nur_global then return false; end if;
if p_mandant is null then return false; end if;
```

Die globale Rolle wird davor geprueft — sie kommt durch. Eine
Mitgliedschaftsrolle nicht. Und alle 47 `gruppe.*`-Schluessel stehen im Katalog
mit `nur_global = false` (Zeilen 169 ff.).

**Folge.** 45 Routen sind fuer jeden, der kein `super_admin` ist, dauerhaft 404:
25 Gruppenrouten, 19 Kundenrouten und `/portal/mein/abwesenheit/neu`. Die
Gruppenansicht — TEN-05, der Grund, warum es eine Gruppenansicht gibt — ist fuer
genau das Publikum leer, fuer das sie gebaut wurde.

**Behebung.** Der Rechteschluessel wird im mandantenuebergreifenden Scope gegen
**jeden sichtbaren Mandanten** ausgewertet und gilt als gehalten, wenn er in
mindestens einem gilt. Das ist die Formulierung von `04-SEITENKARTE.md` §1.3
(`GRP`: *"gated on `gruppe.<modul>.lesen` per mandant"*): die Seite oeffnet, und
welche ZEILEN erscheinen, entscheidet die Policy je Zeile — die tut das bereits
(`0009_dokument.sql`: `and app.hat_recht('gruppe.dokument.lesen', mandant_id)`).

---

## B — `aktiveRolle` liest ohne gebundene Sitzung (kritisch)

**Befund.** `src/server/auth/anfrage-sitzung.ts` oeffnet fuer die Rollenabfrage
eine eigene Transaktion und bindet darin **nichts**.

**Nachweis.** `drizzle/0007_benutzer_auth.sql`, Policy `t_bm_lesen`:

```sql
using (benutzer_id = app.aktueller_benutzer() or app.ist_super_admin() or ...)
```

Ohne `app.benutzer_id` ist `app.aktueller_benutzer()` NULL, die Policy also
false, und `benutzer_mandant` gibt null Zeilen zuruck. `force row level
security` steht auf der Tabelle, es gibt also auch fuer den Eigentuemer keinen
Weg daran vorbei.

**Folge.** `aktiveRolle` liefert **immer** `null`. `leisteFuer` faellt damit auf
`intern_global` zurueck: `admin` und `leitung` bekommen die falsche Tab-Leiste,
und die Unterscheidung, die `leisteFuer` ueberhaupt begruendet (Freigaben gegen
Zeiterfassung), findet nie statt.

**Behebung.** Die Rolle wird in derselben gebundenen Transaktion gelesen wie die
Zugangsentscheidung — eine Abfrage weniger und keine zweite Stelle, an der die
Bindung vergessen werden kann.

---

## C — `/portal/gruppe` bindet jeden Mandanten und wechselt per GET (kritisch)

**Befund 1.** Die Seite liest `select id from mandant where archiviert_am is
null` **vor** `set local role cse_app` und uebergibt das Ergebnis als
`mandantIds` an `withGroupScope`. Im Gruppen-Scope ist
`app.sichtbare_mandanten()` genau `app.mandant_ids()`
(`0004_rls_baseline.sql`) — die Anwendung bestimmt also die Menge selbst, statt
sie ableiten zu lassen. `t_mandant_lesen` prueft nur
`id = any (app.sichtbare_mandanten())` und kein Recht: eine `leitung` der
Reinigung saehe die Namen aller vier Gesellschaften.

**Befund 2.** Die Seite ruft `withGroupScope` unabhaengig davon, ob die Sitzung
`ansicht = 'gruppe'` traegt. `03-AUTH-BERECHTIGUNGEN.md` §4.4 sagt: **"A GET
never switches the tenant."** Der Wechsel ist ein POST, er leitet den Portaltyp
aus der Zielmitgliedschaft ab und schreibt zwei Spiegelzeilen ins `audit_log`
(TEN-09).

**Behebung.** `withGroupScope` leitet seine Menge selbst ab — gebunden, ueber
`app.switcher_mandanten()`, wie `withPersonScope` es bereits tut. Und
`/portal/gruppe` folgt der Tabelle in §4.5: bei `ansicht <> 'gruppe'` das
Zwischenblatt mit POST-Knopf, oder 404, wo die Tabelle 404 sagt.

---

## D — Tab-Ziele ohne Seite, und keine Rechtefilterung

**Befund 1.** `/portal/konto` steht **nicht** im Manifest; dort stehen
`/portal/konto/profil`, `/sicherheit`, `/benachrichtigungen`, `/kalender-feed`,
`/zugriffe`. Der `Profil`-Tab jedes Portals zeigt also auf eine Adresse, die
`findeRoute` nicht kennt — und damit auf 404.

**Befund 2.** `/portal` steht ebenfalls nicht im Manifest, ist aber
`PORTAL_START.intern`.

**Befund 3.** `PortalRahmen` rendert jedes Ziel der Leiste, ohne `TabZiel.recht`
zu pruefen. AUT-06 verbietet genau das: ein Menuepunkt, der auf 404 fuehrt,
verraet die Existenz dessen, was er nicht zeigen darf.

**Befund 4.** Die uebrigen Ziele gehoeren zu Modulen spaeterer Phasen
(`auftraege` 4, `dienstplan/woche` 5, `zeiten` 5, `finanzen` 6, `freigaben` 8,
`radar` 8, `berichte` 9). Sie haben eine Manifestzeile, aber keine Seite.

**Befund 5.** Ueber `md` gibt es ueberhaupt keine Navigation — die Leiste ist
`md:hidden`, und eine Sidebar existiert nicht.

---

## E — Kennzahlkacheln zeigen in den Dev-Baum

`kennzahlPfad` in `src/server/services/bericht/kacheln.ts` liefert
`/dev/kennzahl/<schluessel>`. Im angemeldeten Portal ist das eine tote Adresse.

---

## F — Das Angebotsformular verliert die Sprache

`AnfrageFormular` sendet die Sprache nicht mit; `/api/anfrage` antwortet
deutsch, auch auf ein englisches Formular. `Feld` hat *"Bitte wählen"* fest
verdrahtet. Die Markenkarten unter `/en` und der Bereichswaehler unter
`/angebot` zeigen die deutsche `unternehmensprofil.kurzbeschreibung`.

---

## G — Die abgeloesten oeffentlichen Adressen leiten nicht weiter

`WEITERLEITUNGEN` ist an keine echte 301 angeschlossen und kennt weder
`/reinigung`, `/security`, `/bau`, `/operations` noch `/anfrage/[bereich]`.
Ausserdem ueberleben veroeffentlichte `seite`-Zeilen einen erneuten Import und
erscheinen weiter in der Sitemap.
