/**
 * Die vier Anmeldefunktionen gehören `cse_definer` — und bekommen genau die
 * Rechte, die sie brauchen (K-01).
 *
 * **Der Befund.** `0114` und `0115` legen `SECURITY DEFINER`-Funktionen an und
 * sagen nicht, wem sie gehören. Postgres gibt sie damit dem Konto, das die
 * Migration ausführt: `postgres`, Superuser mit `BYPASSRLS`. Eine
 * `SECURITY DEFINER`-Funktion läuft mit den Rechten IHRES Eigentümers — die
 * vier liefen also an jeder Zeilensicherheit vorbei und mit vollem Zugriff auf
 * jede Tabelle der Datenbank. Ausgerechnet die vier, die ein Unangemeldeter
 * aufrufen darf.
 *
 * Aufgefallen ist es nicht beim Schreiben, sondern an
 * `tests/isolation/definer-eigentum.test.ts` — der Sperrklinke aus D-300, die
 * genau dafür da ist, dass die Altlast nicht wächst. Sie hat funktioniert.
 *
 * **Warum das nicht mit einer Zeile erledigt ist.** Das Eigentum umzuhängen
 * heisst, der Funktion ihre Superuser-Rechte zu nehmen — und damit stehen
 * plötzlich beide Fragen offen, die vorher niemand stellen musste: WELCHE
 * Tabellen darf sie anfassen, und WELCHE Zeilen darf sie dort sehen. Ohne
 * beides liest sie stillschweigend null Zeilen und meldet keinen Fehler. Der
 * Rest dieser Datei beantwortet beide, je Funktion und je Spalte.
 */

alter function app.zugang_code_anfordern(text, text, timestamptz, inet)
  owner to cse_definer;
alter function app.zugang_code_einloesen(text, text)
  owner to cse_definer;
alter function app.mitarbeiter_sitzung_ausstellen(uuid, text, inet, text)
  owner to cse_definer;
alter function app.sitzung_beenden(text)
  owner to cse_definer;

/**
 * **Die Rechte — spaltengenau (K-05).**
 *
 * `mitarbeiter_zugang`: die beiden Codefunktionen suchen eine Zeile über die
 * Nummer und prüfen, ob sie gesperrt ist; `einloesen` schreibt danach
 * `letzter_login_am`. Mehr nicht — insbesondere kein Recht, einen Zugang
 * ANZULEGEN oder eine Nummer zu ändern: das ist Sache der Personalstelle
 * (`cse_app`), und eine Anmeldefunktion, die Zugänge anlegen kann, ist eine,
 * die sich selbst einen anlegen kann.
 */
grant select (id, person_id, telefon_e164, gesperrt_am) on mitarbeiter_zugang to cse_definer;
grant update (letzter_login_am) on mitarbeiter_zugang to cse_definer;

/**
 * `mitarbeiter_einmalcode`: hier liegt das Geheimnis, und hier darf die
 * Funktion alles, was das Verfahren braucht — lesen, anlegen, verbrauchen,
 * Fehlversuche zählen. Der Schnitt liegt nicht in den Spalten, sondern darin,
 * WER die Funktion aufrufen kann: `cse_app` hat auf diese Tabelle weder Recht
 * noch Policy, und `cse_definer` ist `NOLOGIN` ohne ein einziges Mitglied.
 * Der einzige Weg an den Hash führt durch die beiden Funktionen.
 */
grant select (id, zugang_id, code_hash, gueltig_bis, verbraucht_am, fehlversuche, erstellt_am)
  on mitarbeiter_einmalcode to cse_definer;
grant insert (zugang_id, code_hash, gueltig_bis, ip) on mitarbeiter_einmalcode to cse_definer;
grant update (verbraucht_am, fehlversuche) on mitarbeiter_einmalcode to cse_definer;

/**
 * `benutzer`: `mitarbeiter_sitzung_ausstellen` muss zum Menschen das Konto
 * finden und dessen Zustand prüfen. Sechs Spalten, alle in der `where`-Klausel
 * oder im `returning` — keine E-Mail, kein Name, keine Rolle.
 */
grant select (id, person_id, status, deaktiviert_am, ist_dienstkonto, gesperrt_bis)
  on benutzer to cse_definer;

/**
 * `benutzer_sitzung`: eine Sitzung anlegen (Anmeldung) und eine schliessen
 * (Abmeldung). `token_hash` und `beendet_am` stehen auch im `select`-Recht,
 * weil `app.sitzung_beenden` seine Zeile darüber findet — ein UPDATE ohne
 * Leserecht auf die Spalten seiner eigenen `where`-Klausel ist keines.
 */
grant select (id, token_hash, beendet_am) on benutzer_sitzung to cse_definer;
grant insert (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am, ip, user_agent)
  on benutzer_sitzung to cse_definer;
grant update (beendet_am, ende_grund) on benutzer_sitzung to cse_definer;

/**
 * **Und die Policies — ohne die die Rechte oben tot wären.**
 *
 * Alle vier Tabellen tragen `force row level security`. Unter FORCE heisst
 * „keine anwendbare Policy" nicht *alles*, sondern *nichts*: die Funktionen
 * hätten das Recht und läsen null Zeilen. Das ist derselbe Befund wie in
 * `0109` und in `0113` — nur diesmal, bevor er jemanden kostet.
 *
 * **`using (true)`, und das ist hier die richtige Verengung, nicht die
 * fehlende.** Eine Anmeldung MUSS eine Nummer nachschlagen können, die sie
 * noch nicht kennt — jede Einschränkung auf „eigene Zeilen" wäre zirkulär, es
 * gibt ja noch keinen Handelnden. Die Verengung liegt deshalb woanders und
 * ist schärfer als eine Zeilenbedingung: `cse_definer` ist `NOLOGIN`, niemand
 * ist Mitglied, und die Rolle lässt sich nur über genau diese vier Funktionen
 * betreten. Dieselbe Form benutzen `q_definer`, `d_planungsbedarf` und
 * `verstoss_definer_read` seit ihren Migrationen.
 */
create policy d_zugang_lesen on mitarbeiter_zugang
  for select to cse_definer using (true);
create policy d_zugang_login on mitarbeiter_zugang
  for update to cse_definer using (true) with check (true);

create policy d_code_lesen on mitarbeiter_einmalcode
  for select to cse_definer using (true);
create policy d_code_anlegen on mitarbeiter_einmalcode
  for insert to cse_definer with check (true);
create policy d_code_verbrauchen on mitarbeiter_einmalcode
  for update to cse_definer using (true) with check (true);

create policy d_benutzer_anmeldung on benutzer
  for select to cse_definer using (true);

create policy d_sitzung_lesen on benutzer_sitzung
  for select to cse_definer using (true);
create policy d_sitzung_ausstellen on benutzer_sitzung
  for insert to cse_definer with check (true);
create policy d_sitzung_beenden on benutzer_sitzung
  for update to cse_definer using (true) with check (true);

/**
 * **PUBLIC hält auf keiner dieser vier etwas** (K-08).
 *
 * `create function` gibt EXECUTE an PUBLIC, ohne dass es jemand hinschreibt.
 * `0114` und `0115` haben deshalb neben `cse_anon` und `cse_app` still auch
 * jeden anderen Aufrufer berechtigt — und bei einer Funktion, die als
 * `cse_definer` läuft, ist „jeder andere" genau die Menge, die es hier nicht
 * geben darf. `0093` hat denselben Entzug für die damals vorhandenen
 * Funktionen gefahren; diese vier kamen danach.
 *
 * Der Entzug steht NACH den Grants oben, nicht davor: ein `revoke … from
 * public` ohne vorherigen benannten Grant liesse jeden Aufrufer lautlos
 * ausfallen.
 */
revoke execute on function app.zugang_code_anfordern(text, text, timestamptz, inet) from public;
revoke execute on function app.zugang_code_einloesen(text, text) from public;
revoke execute on function app.mitarbeiter_sitzung_ausstellen(uuid, text, inet, text) from public;
revoke execute on function app.sitzung_beenden(text) from public;

/**
 * **Und was die Funktionen ihrerseits aufrufen.**
 *
 * `app.mitarbeiter_sitzung_ausstellen` liest die Sitzungsdauer über
 * `app.plattform_einstellung`. Solange sie `postgres` gehörte, fiel das nicht
 * auf — als Superuser darf sie alles. Seit sie `cse_definer` gehört, braucht
 * die Rolle das Recht, und ohne es stirbt die Anmeldung mit „permission
 * denied for function plattform_einstellung": nicht still, aber erst zur
 * Laufzeit, und zwar an der einen Stelle, an der niemand mehr weiterkommt.
 *
 * `tests/isolation/spaltenrechte.test.ts` („jeder `app.*`-Aufruf aus einer
 * `cse_definer`-Funktion ist ihr erlaubt") prüft genau diese Kette — und hat
 * diesen Fall gefunden, bevor es ein Mensch tat.
 */
grant execute on function app.plattform_einstellung(text) to cse_definer;
