/**
 * Die eigene Portalsprache ändern (EMP-12).
 *
 * **Der Befund.** `src/lib/i18n/texte.ts` übersetzt das Arbeiterportal
 * vollständig in vier Sprachen — de, en, ar, tr, samt `dir="rtl"`. Die Sprache
 * kommt aus `person.sprache`. Und sie liess sich **nirgends ändern**: es gab
 * keine Seite, keine Route und kein Recht dafür. Eine Reinigungskraft, deren
 * Zeile auf `de` steht, sah das Portal auf Deutsch — egal, welche der vier
 * Sprachen sie spricht. EMP-12 ist in der ROADMAP abgehakt; erreichbar war es
 * für niemanden.
 *
 * **Die Vorlage steht schon in 0007.** `benutzer` trägt seit jeher
 * `t_benutzer_selbstpflege` (`id = app.aktueller_benutzer()`) und — das ist
 * der wichtige Teil — ein SPALTENGENAUES Recht:
 * `grant update (name, sprache, benachrichtigung_praeferenz)`. Diese Migration
 * macht für `person` dasselbe.
 *
 * **Warum die Spaltenliste hier keine Formalie ist.** `person` trägt
 * `telefon`, und diese Nummer IST der Anmeldeweg einer Mitarbeiterin
 * (`app.zugang_code_anfordern`, EMP-01). Ein tabellenweites `grant update`
 * liesse jede angemeldete Person ihre eigene Nummer ändern — und damit den
 * Einmalcode auf ein beliebiges Telefon umleiten. Aus „ich stelle meine
 * Sprache auf Arabisch" würde eine Kontoübernahme, in derselben Zeile.
 * Deshalb steht genau EINE Spalte im Recht.
 *
 * **Und `not app.ist_readonly()` in der `with check`.** Jede Portalseite wird
 * mit `app.readonly = 'on'` gerendert; nur der Schreibweg bindet sie ab. Ohne
 * diese Bedingung wäre die Sprache das einzige Feld der Plattform, das sich
 * aus einer lesenden Sitzung heraus ändern liesse.
 *
 * **Nicht hier: die Sprache eines ANDEREN Menschen.** Die Personalverwaltung
 * pflegt Stammdaten über ihre eigenen Wege und ihr eigenes Recht
 * (`personal.schreiben`); diese Policy ist ausdrücklich Selbstzugriff — sie
 * gilt für die Zeile, die zur angemeldeten Person gehört, und für keine
 * andere.
 */
create policy t_person_selbstpflege on person for update to cse_app
  using      (id = app.aktuelle_person())
  with check (id = app.aktuelle_person() and not app.ist_readonly());

/**
 * EINE Spalte. Siehe oben: `telefon` daneben wäre der Anmeldeweg.
 *
 * Ein tabellenweites `grant update` gefolgt von `revoke update (telefon)`
 * funktioniert in PostgreSQL NICHT — das Tabellenrecht deckt weiter jede
 * Spalte, und der Entzug ändert stillschweigend nichts. Dieselbe Falle wie
 * beim Lohnsatz (K-05, 0004): die Spalte muss von vornherein draussen
 * bleiben.
 */
grant update (sprache) on person to cse_app;

comment on policy t_person_selbstpflege on person is
  'EMP-12: die eigene Portalsprache. Nur die eigene Zeile, nur die Spalte '
  '`sprache` (das Spaltenrecht daneben), und nicht aus einer lesenden Sitzung.';
