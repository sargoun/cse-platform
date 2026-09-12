/**
 * Der Einzelabruf war die einzige der fuenf Abrechnungsarten OHNE
 * Doppelabrechnungssperre.
 *
 * `einzelabruf.ts` schrieb als Herkunft `{ art: 'vertrag', id:
 * auftrag_leistung_id }` — also die VERTRAGSZEILE und nicht den einzelnen
 * Abruf. Auf `auftrag_leistung_id` gibt es bewusst keinen Sperrindex (eine
 * Vertragszeile traegt jeden Monat eine neue Rechnung, 0107), und die vier
 * anderen Arten haengen an `zeiteintrag_id`, `ausgabe_id`,
 * `leistungsnachweis_id` oder an der Summenpruefung des Aufmasses.
 *
 * Damit blieb derselbe Abruf mit `status = 'erbracht'` nach der Rechnung
 * weiter abrechenbar: nichts markierte ihn, und nichts in der Herkunft nannte
 * ihn. Der naechste Lauf haette ihn ein zweites Mal berechnet — und der Beleg
 * saehe stimmig aus, denn die Vertragszeile, auf die er zeigt, gibt es
 * wirklich. Gemeldet vom Copilot-Durchgang auf PR #7.
 *
 * **Und der Diskriminator liess das durchgehen, weil er auf NULL endete.**
 * `case quelle_typ … else null end` ist als CHECK erfuellt: eine
 * Einschraenkung, die bei jedem kuenftigen Aufzaehlungswert stillschweigend
 * abschaltet. Genau der Fall waere jetzt eingetreten. Sie endet ab hier auf
 * `false` — ein unbekannter Typ ist kein Grund, die Zuordnung zu erlassen.
 */
alter table rechnungsposition_quelle
  add column sonderleistung_id uuid,
  add constraint rpq_sonderleistung_fk foreign key (mandant_id, sonderleistung_id)
      references sonderleistung (mandant_id, id);

alter table rechnungsposition_quelle drop constraint rpq_diskriminator;
alter table rechnungsposition_quelle add constraint rpq_diskriminator check (
  case quelle_typ
    when 'zeiteintrag'       then zeiteintrag_id is not null
    when 'aufmass'           then aufmass_id is not null
    when 'vertrag'           then auftrag_leistung_id is not null
    when 'material'          then ausgabe_id is not null
    when 'leistungsnachweis' then leistungsnachweis_id is not null
    when 'nachtrag'          then nachtrag_id is not null
    when 'sonderleistung'    then sonderleistung_id is not null
    when 'manuell'           then true
    else false
  end);

/**
 * **Und die ZWEITE Einschraenkung, die die Spalte nicht kannte.**
 *
 * `rpq_genau_eine_quelle` zaehlt `num_nonnulls(...)` ueber eine
 * ausgeschriebene Spaltenliste. Ohne `sonderleistung_id` darin zaehlte eine
 * Abrufzeile NULL gesetzte Quellen und fiel gegen die erwartete 1 — der
 * Einfuegeversuch scheiterte also, statt still durchzugehen. Das ist die
 * gute Richtung, aber es zeigt, was eine ausgeschriebene Spaltenliste
 * kostet: sie muss an ZWEI Stellen mitwachsen, und nur eine davon meldet
 * sich. Beide stehen jetzt untereinander in dieser Migration.
 */
alter table rechnungsposition_quelle drop constraint rpq_genau_eine_quelle;
alter table rechnungsposition_quelle add constraint rpq_genau_eine_quelle check (
  num_nonnulls(zeiteintrag_id, aufmass_id, auftrag_leistung_id, ausgabe_id,
               sonderleistung_id, leistungsnachweis_id, nachtrag_id)
  = case quelle_typ when 'manuell' then 0 else 1 end);

/**
 * Die Sperre selbst: ein Abruf belegt GENAU EINE wirksame Rechnungszeile.
 *
 * Dieselbe Machart wie `quelle_zeiteintrag_uk` und `quelle_ausgabe_uk` — und
 * wie dort gilt sie nur fuer `wirksam`, damit ein Storno den Abruf wieder
 * freigibt und die Neuausstellung ihn erneut beanspruchen kann.
 */
create unique index quelle_sonderleistung_uk on rechnungsposition_quelle (sonderleistung_id)
  where quelle_typ = 'sonderleistung' and wirksam;

create index quelle_sonderleistung_idx on rechnungsposition_quelle (mandant_id, sonderleistung_id)
  where wirksam;

comment on column rechnungsposition_quelle.sonderleistung_id is
  'Der einzelne Abruf hinter einer Einzelabruf-Zeile (FIN-07). Traegt die '
  'Doppelabrechnungssperre quelle_sonderleistung_uk.';

/**
 * `cse_app` schreibt die Herkunft ueber den Dienst und muss die neue Spalte
 * fuellen duerfen; ein Spaltenrecht ohne diese Spalte waere ein Dienst, der
 * an seiner eigenen Zeile scheitert (K-05).
 */
grant insert (sonderleistung_id), update (sonderleistung_id)
  on rechnungsposition_quelle to cse_app;
