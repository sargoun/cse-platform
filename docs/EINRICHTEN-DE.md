# Einrichten und Anbinden — Schritt für Schritt

**Für wen dieses Blatt ist.** Für den, der die Plattform betreibt — heute Sie,
später der Käufer. Es sagt, **welche Schlüssel es gibt, wo sie hingehören, was
ohne sie passiert**, und was Sie auf keinen Fall tun dürfen.

Die arabische Fassung steht in `EINRICHTEN-AR.md` und sagt dasselbe.

---

## 0. Die eine Regel, aus der alles andere folgt

> **Es wird nichts vorgetäuscht.**

Fehlt ein Schlüssel, dann sagt die Plattform **„nicht verbunden"** und arbeitet
ohne diese Funktion weiter. Sie tut **nie** so, als wäre eine E-Mail
verschickt, eine SMS zugestellt oder ein Beleg gelesen worden.

Das ist keine Höflichkeit, sondern der Unterschied zwischen einem Betrieb, der
weiss, dass er die Rechnung von Hand schicken muss, und einem, der sie im
Spam-Ordner sucht.

**Wo Sie den wahren Zustand sehen — immer, ohne zu raten:**

```
/portal/<gesellschaft>/einstellungen/integrationen
```

Diese Seite fragt die Adapter selbst, nicht eine zweite Liste. Sie kann nicht
veralten.

---

## 1. Wo ein Schlüssel hingehört — und wo nicht

| | Wohin | Wie |
|---|---|---|
| **Auf Ihrem Rechner** | Datei `.env.local` im Projektordner | `.env.example` kopieren, umbenennen, ausfüllen |
| **In der Produktion (Vercel)** | Vercel → Project → Settings → **Environment Variables** | Name und Wert eintragen, Umgebung wählen, **neu deployen** |

**Drei Dinge, die Sie nie tun dürfen:**

1. **Kein Schlüssel im Code.** Nicht in einer `.ts`-Datei, nicht in einem
   Kommentar, nicht „nur kurz zum Testen".
2. **Kein Schlüssel in einem Commit.** `.env.local` steht in `.gitignore` und
   muss dort bleiben. Einmal gepusht ist ein Schlüssel öffentlich — auch wenn
   der Commit später gelöscht wird.
3. **Kein Schlüssel mit `NEXT_PUBLIC_` davor.** Dieses Vorwort schickt den
   Wert in den Browser. Der Service-Role-Key von Supabase dort wäre der
   Vollzugriff auf alle Daten, für jeden Besucher.

**Nach jeder Änderung in Vercel muss neu deployt werden.** Die Variablen werden
beim Bauen gelesen, nicht beim Aufrufen.

---

## 2. Die Datei `.env.example`

Sie liegt im Projektordner und ist **die vollständige Liste** — jede Zeile darin
wird irgendwo im Code wirklich gelesen. Nachzählen können Sie es selbst:

```bash
grep -rhoP "process\.env\[['\"]\K[A-Z0-9_]+" src/ scripts/ | sort -u
```

So fangen Sie an:

```bash
cp .env.example .env.local
# dann .env.local öffnen und ausfüllen
```

---

## 3. Pflicht — ohne diese startet nichts

| Variable | Was sie ist | Woher |
|---|---|---|
| `DATABASE_URL` | Die Postgres-Adresse | Lokal aus Docker (`docs/LOKAL-STARTEN.md`); in Produktion aus Supabase → Settings → Database |
| `PORT` | Der Hafen der Anwendung | Frei wählbar, Vorgabe `3001` |
| `SUPABASE_URL` | Die Projektadresse | Supabase → Project Settings → **API** → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Der Serverschlüssel | Supabase → Project Settings → **API** → `service_role` |

**Zur Region:** Das Supabase-Projekt muss in **Frankfurt (EU)** liegen. Die
Plattform hält Arbeitszeiten, gesundheitsnahe Abwesenheiten und Finanzdaten
dreier deutscher Rechtseinheiten. Ein Projekt in einer anderen Region ist kein
Einrichtungsfehler, sondern ein Datenschutzvorfall.

**`CSE_DEV_FLAECHEN=1`** schaltet den Demobetrieb frei: Demodaten, der
SMS-Code steht **auf dem Bildschirm** statt im Netz, Kekse ohne `Secure`, und
`/dev/anmelden` erlaubt die Anmeldung als beliebiges Konto **ohne Kennwort**.

> **In Produktion muss diese Variable leer sein.** Ein `1` dort heisst: jeder
> kann sich als jeder anmelden.

---

## 4. Der KI-Schlüssel — der Teil, nach dem Sie gefragt haben

Hier ist die Plattform **strenger als üblich**, und mit Absicht: ein
Modellaufruf schickt Vertragstext, Beträge und Namen an einen fremden
Dienstleister. Deshalb gibt es **vier Tore plus eine Zeile in der Datenbank**.
Fällt eines davon, sagt die Oberfläche „KI-Funktion nicht verfügbar" und die
Arbeit läuft von Hand weiter. **Es gibt keine stille Ausweichroute** — keinen
Rückfall auf eine andere Region, kein anderes Modell, keine Warteschlange.

Alles vier steht in `src/server/versand/modell-openai.ts`.

### Schritt 1 — Den Schlüssel holen

1. <https://platform.openai.com> → anmelden
2. **Settings → Organization → Data controls** → **Data residency: EU**
   einstellen. Ohne das ist Schritt 3 unten eine Lüge.
3. **API keys** → *Create new secret key* → kopieren
   (er wird **nur einmal** gezeigt)
4. Einen **Auftragsverarbeitungsvertrag (DPA)** abschliessen — bei OpenAI
   unter *Settings → Organization → Data controls*. Ohne DPA darf über die
   Plattform kein personenbezogener Text hinaus (Art. 28 DSGVO).

### Schritt 2 — Die vier Variablen setzen

```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://eu.api.openai.com/v1
OPENAI_DATA_RESIDENCY=eu
CSE_KI_MODELL=
```

**Was jede einzelne tut:**

| Tor | Variable | Wenn es fällt |
|---|---|---|
| 1 | `CSE_KI_MODELL` darf **nicht** `nicht_verbunden` sein | Der Riegel für Abnahmeumgebungen. Er **gewinnt gegen alles andere** — auch gegen einen gültigen Schlüssel. |
| 2 | `OPENAI_API_KEY` | Ohne Schlüssel: `NOT_CONNECTED`. Es wird **nie** ein Versuch unternommen. |
| 3 | `OPENAI_DATA_RESIDENCY=eu` | Sonst `RESIDENCY_BLOCKED`. Der Adapter geht nicht live, solange die Residenz nicht bestätigt ist. |
| 4 | `OPENAI_BASE_URL` | Wird **zerlegt** geprüft: `https`, Wirt aus der erlaubten Liste, **keine** Zugangsdaten in der URL, **kein** Query. |

Zu Tor 4: erlaubt ist ab Werk nur `eu.api.openai.com`. Reicht das nicht, setzen
Sie weitere ausdrücklich:

```bash
OPENAI_EU_HOSTS=weiterer-endpunkt.example.com,noch-einer.example.com
```

> **Warum eine Liste und keine Plausibilitätsprüfung.** Ein blockierter Aufruf
> wegen eines Tippfehlers ist ärgerlich. Eine Vertragsseite, die an einem
> beliebigen Wirt landet, weil `OPENAI_BASE_URL` falsch gesetzt war, ist
> **meldepflichtig**.
>
> Welche Endpunkte Ihr DPA deckt, weiss Ihr Vertrag — nicht die Software.
> Das ist die offene Frage **O-509**.

### Schritt 3 — Die Zeile in der Datenbank

Das ist der Teil, den man vergisst. Die vier Variablen öffnen die *Tür*; die
Zeile in `modell_register` ist die *Bescheinigung*, dass jemand hingesehen hat.

```sql
insert into modell_register
  (anbieter, modell, faehigkeit,
   eu_verarbeitung, zero_retention, freigegeben,
   geprueft_am, nachweis_url, bemerkung)
values
  ('openai', 'gpt-4o-mini', 'text',
   true, true, true,
   now(),
   'https://…/dpa.pdf',        -- Ihr Vertrag, als Nachweis
   'DPA vom TT.MM.JJJJ, EU-Residenz bestätigt, Zero-Retention zugesichert');
```

**Alle drei Wahrheitswerte müssen `true` sein.** `eu_verarbeitung` ohne
Nachweis einzutragen ist keine Konfiguration, sondern eine falsche Aussage in
einem Register, das im Prüfungsfall gelesen wird.

### Schritt 4 — Nachsehen

```
/portal/<gesellschaft>/einstellungen/integrationen
```

Die Zeile **Sprachmodell** muss auf `verbunden` stehen. Steht sie weiter auf
`nicht verbunden`, sagt der Hinweis daneben, **welches Tor** zu ist.

### Was die KI nicht darf — unabhängig von jedem Schlüssel

> **Die KI rechnet nie Geld, Mengen oder Fristen** (Invariante 6).
> Sie liest, extrahiert, klassifiziert und entwirft. Jede Zahl geht durch eine
> getestete Funktion in `src/server/services/`.
>
> **Nichts verlässt das Haus ohne menschliche Freigabe** (Invariante 7).
> E-Mails, Angebote, Bewerbungen, Beiträge — alles läuft durch
> `src/server/agent/policy.ts`.

Diese beiden Regeln hängen **nicht** am Schlüssel. Sie gelten auch mit
perfekter Anbindung.

---

## 5. Die übrigen Anbindungen

### 5.1 Verbunden, sobald Sie den Schlüssel setzen

| Anbindung | Variablen | Woher | Ohne sie |
|---|---|---|---|
| **Supabase Storage** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | Kein Dokument lässt sich hochladen oder abrufen |
| **Nachtläufe** | `JOB_TOKEN` | Selbst erzeugen: `openssl rand -base64 32`, denselben Wert in Supabase → Database → **Cron** hinterlegen | Kein Wächter läuft: keine Besetzungswarnung, keine Ablaufwarnung, keine Mahnvorschläge |
| **Wetter (DWD)** | `DWD_OPENDATA_BASE` | Kostenlos, **keine Anmeldung** — <https://opendata.dwd.de> | Das Bautagebuch bleibt ohne Wetterzeile (VOB/B) |

Zum `JOB_TOKEN`: gesetzt heisst **„die Tür ist offen"**, nicht „jemand hat
angeklopft". Die Plattform zeigt ihn deshalb als `unbestätigt`, bis ein Lauf
wirklich stattgefunden hat — nachzusehen unter
`/portal/<gesellschaft>/einstellungen/jobs`.

### 5.2 Wartet auf eine ENTSCHEIDUNG, nicht auf einen Schlüssel

Diese Schnittstellen sind **fertig gebaut**. Was fehlt, ist die Antwort auf
eine Frage, die nur Sie beantworten können — sie steht in `docs/DECISIONS.md`
unter „Offen".

| Anbindung | Offene Frage | Was zu entscheiden ist |
|---|---|---|
| **E-Mail-Versand** | `O-36` | Welcher **EU-gehostete** Anbieter, unter welchem DPA? (z. B. Brevo, Mailjet EU, eigener SMTP) |
| **SMS-Gateway** | `O-82` | Welches **EU-gehostete** Gateway für den Anmeldecode der Beschäftigten? |
| **Belegerkennung (OCR)** | `O-135` | Welcher Anbieter liest Eingangsrechnungen? |
| **Karten, Geokodierung** | `O-132` | Welcher EU-gehostete Kartendienst, unter welchem DPA? |
| **n8n** | `O-123` | Eigene Instanz oder Cloud? |
| **LinkedIn, Instagram** | — | Unternehmenskonten und App-Registrierung fehlen |

Solange eine Frage offen ist, steht die Zeile auf `nicht verbunden` **mit der
Nummer daneben**. Das ist kein Mangel, den jemand vergessen hat, sondern eine
Frage, die niemand beantwortet hat.

### 5.3 Bewusst KEINE Anbindung — und das ist die Entscheidung

| | Warum |
|---|---|
| **DATEV** | Der Steuerberater bekommt eine **Datei** (D-06). Die Plattform bereitet auf, exportiert und übergibt; sie bucht nicht. |
| **Vergabeplattformen** | Es gibt **keine API**. Die Einreichung ist von Hand gewollt und nicht vergessen. |
| **Jobbörsen (Indeed, StepStone)** | Datenabgriff verstösst gegen deren AGB und schafft DSGVO-Risiko. Recruiting läuft über **eingehende** Bewerbungen. |
| **Kaltakquise an gefundene Firmen** | **§ 7 UWG** verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrückliche Einwilligung — **auch im B2B**. Ausgehende Nachrichten gibt es nur an Kontakte mit **erfasster Rechtsgrundlage**. |

Diese vier sind in `CLAUDE.md` unter „Out of scope" festgeschrieben. Wer sie
öffnen will, ändert eine Entscheidung — nicht eine Einstellung.

---

## 6. Sicherheit und Recht

| Variable | Wofür | Ohne sie |
|---|---|---|
| `CSE_IP_PFEFFER` | Salzt die IP-Hashes der öffentlichen Formulare (Honigtopf, Ratenlimit). Erzeugen: `openssl rand -hex 32` | Die Hashes sind ungesalzen und damit rückrechenbar — eine IP-Adresse ist ein personenbezogenes Datum |
| `CSE_VERTRAUTE_URSPRUENGE` | Erlaubte Ursprünge für Formular-POSTs, kommagetrennt | Nur der eigene Ursprung gilt (in den meisten Fällen richtig) |
| `CSE_KANONISCHE_BASIS` | Die Adresse in Links, die das Haus verlassen | Links zeigen auf einen Platzhalter |
| `CSE_CODE_VERSION` | Die Codeversion in der Verfahrensdokumentation (GoBD) | Auf Vercel kommt sie von selbst aus `VERCEL_GIT_COMMIT_SHA` |

---

## 7. Eine Anbindung wirklich prüfen

```bash
# 1. Variablen sind angekommen?
pnpm dev
# dann im Portal: /einstellungen/integrationen

# 2. Läuft ein Nachtlauf wirklich?
#    /einstellungen/jobs  — dort steht die Laufliste, nicht die Absicht
```

**Lesen Sie die Ausgabe, nicht den Rückgabewert.** Eine Befehlskette endet mit
dem Rückgabewert ihres *letzten* Befehls; der sagt nichts über die Prüfung
davor. Das ist in diesem Projekt schon einmal passiert.

---

## 8. Übergabe an einen Käufer

1. **Alle Schlüssel neu erzeugen.** Ein Schlüssel, den zwei Parteien kennen,
   gehört keiner.
2. `.env.local` **nicht** mitgeben. Stattdessen `.env.example` — die Liste
   ohne die Werte.
3. Die Supabase-Organisation übertragen oder ein neues Projekt **in
   Frankfurt** anlegen und die Daten migrieren.
4. Die DPAs neu abschliessen. Sie laufen auf den Betreiber, nicht auf die
   Software.
5. `docs/DECISIONS.md`, Abschnitt „Offen", mit dem Käufer durchgehen — dort
   steht, was noch niemand entschieden hat.
6. **Den Super-Admin neu setzen.** Er entsteht nur über die Umgebung (D-617),
   nie über einen Bildschirm.

---

## 9. Die Anmeldung — welche Seite wofür

Es gibt **zwölf** Seiten unter `/auth`, und sie sind **kein Provisorium**: es
sind **zwei Eingänge** und zehn **Schritte** derselben Abläufe. Jede steht in
`docs/architecture/04-SEITENKARTE.md` §11.

### Die zwei Eingänge

| | Für wen | Warum getrennt |
|---|---|---|
| `/auth/login` | Verwaltung, Leitung, **Kunden** | E-Mail und Kennwort |
| `/auth/mitarbeiter` | **Beschäftigte** | **Kein Kennwort** — Mobilnummer und Einmalcode (EMP-01) |

**Warum die Beschäftigten einen eigenen Eingang haben.** EMP-01 sagt
wörtlich „phone number + SMS code, **no password**". Eine Reinigungskraft, die
um 05:30 im Treppenhaus steht, hat keinen Passwortverwalter. Auf
`/auth/mitarbeiter` gibt es deshalb **gar kein** Passwortfeld — nicht
versteckt, nicht deaktiviert, sondern keines. `tests/e2e/anmeldung.spec.ts`
zählt die `input[type=password]` im DOM und verlangt **null**.

Die beiden Seiten **verweisen aufeinander**: wer auf `/auth/login` steht und
kein Kennwort hat, findet unten den Satz „Sie arbeiten im Einsatz und haben
kein Kennwort?" mit dem Weg hinüber.

### Was der Knopf „Login" auf der Website tut

Er führt auf **`/auth/login`** (`src/app/(public)/layout.tsx:65`).

> Früher zeigte er auf `/auth/mitarbeiter`, weil das der einzige gebaute
> Eingang war — Verwaltung, Leitung und Kunden landeten auf einem Formular,
> das nach einer Mobilnummer fragte. Seit PR 77 ist es umgekehrt.

### Wohin man nach dem Anmelden kommt

| Rolle | Erste Seite | Warum |
|---|---|---|
| Verwaltung, Leitung | `/auth/bereich` | Ein internes Konto kann mehrere Gesellschaften führen. Es **wählt**, welche — nichts ist vorausgewählt (§4.4) |
| Beschäftigte | `/portal/mein` | Ein Mensch, eine Arbeitsansicht |
| Kunde | `/portal/kunde` | Nur die eigenen Vorgänge |

Festgelegt in `src/server/auth/zugang.ts:62` (`PORTAL_START`).

**Warum die Verwaltung nicht auf „/portal" landet.** Diese Adresse steht in
keiner Zeile der Seitenkarte; das Ziel der Weiterleitung wäre selbst ein 404.
Für die Verwaltung gibt es keine feste Wurzel, **weil der Bereich im Pfad
steht** (`/portal/reinigung/…`).

### Die zehn übrigen Seiten — Schritte, keine Eingänge

| Seite | Wann sie erscheint |
|---|---|
| `/auth/zwei-faktor/pruefen` | Nach Kennwort, wenn die Rolle 2FA verlangt |
| `/auth/zwei-faktor/einrichten` | Beim ersten Mal, **erzwungen** vor allem anderen |
| `/auth/zwei-faktor/wiederherstellung` | Telefon verloren → Wiederherstellungscode |
| `/auth/mitarbeiter/code` | Der SMS-Einmalcode |
| `/auth/passwort-vergessen` | Link anfordern |
| `/auth/passwort-neu` | Neues Kennwort mit dem Token aus der Mail |
| `/auth/kennwort-wechseln` | Der **erzwungene** Wechsel, an der Sitzung, ohne Token (AUT-07) |
| `/auth/einladung/[token]` | Ein eingeladenes Konto nimmt an |
| `/auth/bereich` | Die Bereichswahl (siehe oben) |
| `/auth/kein-zugriff` | Angemeldet, aber das **Recht** fehlt |

**Zu `/auth/kein-zugriff`:** Für eine fremde **Zeile** antwortet die Plattform
mit 404 — dass es sie gibt, wäre selbst schon eine Auskunft (AUT-06). Für ein
fehlendes **Recht** im eigenen Bereich gilt das nicht: dass es das Modul gibt,
steht im Menü. Wer nicht darf, soll wissen, dass er nicht darf — **und wen er
fragen kann**.

### Und `/dev/anmelden`?

Die Entwicklungsanmeldung: ein Konto aus einer Liste wählen, **ohne Kennwort**,
ohne jede Prüfung. Sie erscheint **nur**, wenn `CSE_DEV_FLAECHEN=1` gesetzt
ist.

> **In Produktion darf diese Variable nicht gesetzt sein.** Sonst ist der
> Haupteingang unverschlossen.

### Bleibt es so?

**Ja.** Die zwei Eingänge sind eine Entscheidung, kein Zwischenstand: das eine
Konto hat ein Kennwort, das andere hat keines und soll keines bekommen.

Was sich noch **ändern kann**, ist eine Bequemlichkeit: eine gemeinsame
Startseite mit zwei grossen Feldern („Ich habe ein Kennwort" / „Ich arbeite im
Einsatz"). Das wäre **eine Seite mehr**, kein Umbau — die zwei Formulare
dahinter bleiben, weil sie verschiedene Dinge prüfen. Heute macht `/auth/login`
dasselbe mit einem Satz im Fuss.

---

## 10. Wenn nichts geht — Fehlermeldungen und was sie heissen

Die Tabelle liest die Meldung, **wie sie auf dem Schirm steht**. Sie müssen
die Meldung selbst nicht verstehen.

### Beim Starten

| Was Sie sehen | Was es heisst | Was Sie tun |
|---|---|---|
| `ECONNREFUSED ... 5433` | Die Datenbank läuft nicht | Docker Desktop starten, dann `docker start cse-db` |
| `EADDRINUSE ... 3001` | Der Hafen ist belegt — oft von einem Server von vorhin | `PORT=3002` in `.env.local`, oder den alten Server beenden |
| `Cannot find module` | Die Pakete fehlen | `pnpm install` |
| `extension "vector" is not available` | Das Abbild war `postgres:16` statt `pgvector/pgvector:pg16` | Container löschen, aus dem richtigen Abbild neu anlegen |
| `relation "..." does not exist` | Die Tabellen fehlen, oder die Migration brach in der Mitte ab | `pnpm db:migrate` — und die letzte Zeile lesen |
| Weisse Seite, keine Meldung | Der Server ist noch nicht oben | Warten, bis `Ready in ...` im Terminal steht |

### Beim Anmelden

| Lage | Häufigster Grund | Abhilfe |
|---|---|---|
| Das Kennwort wird nicht angenommen | Die Demodaten fehlen | `pnpm db:seed` |
| Es kommt kein SMS-Code | Richtig so — es ist kein SMS-Anbieter verbunden (O-82) | Im Demobetrieb steht der Code **auf dem Schirm** |
| „Nicht berechtigt" nach dem Anmelden | Das Konto hat in dieser Gesellschaft keine Rolle | Ein anderes Konto — §9 |

### Beim Anbinden eines Dienstes

**Nie raten.** Die Seite sagt den Grund im Klartext:

```
/portal/<gesellschaft>/einstellungen/integrationen
```

Der KI-Adapter kennt **genau diese sechs** Gründe:

| Grund | Was er genau abdeckt | Abhilfe |
|---|---|---|
| `NOT_CONNECTED` | **Entweder** der Schlüssel ist leer **oder** der Riegel `CSE_KI_MODELL=nicht_verbunden` steht noch | Beides prüfen — der Riegel wird am häufigsten übersehen und **gewinnt gegen einen gültigen Schlüssel** |
| `RESIDENCY_BLOCKED` | Residenz nicht `eu`, oder `OPENAI_BASE_URL` leer / nicht https / mit Zugangsdaten / mit Query / Wirt nicht in der Liste | `OPENAI_DATA_RESIDENCY=eu`, `OPENAI_BASE_URL=https://eu.api.openai.com/v1` |
| `AUTH_FAILED` | Der Schlüssel steht, OpenAI weist ihn ab | Falsch oder widerrufen — einen neuen erzeugen |
| `RATE_LIMITED` | Das Kontingent bei OpenAI ist erschöpft | Warten oder das Limit im Konto anheben |
| `TIMEOUT` | Keine Antwort in der gesetzten Zeit | Meist vorübergehend |
| `INVALID_RESPONSE` | Die Antwort passt nicht zum erwarteten Schema | Wird protokolliert und **nicht verwendet** — auf so einer Antwort wird kein Wert gebaut |

### Nach jeder Änderung an `.env.local`

**Den Server neu starten.** Die Datei wird nur beim Start gelesen: `Ctrl+C`,
dann `pnpm dev`.

In Vercel: **neu bereitstellen.** Die Variablen werden beim Bauen gelesen.
