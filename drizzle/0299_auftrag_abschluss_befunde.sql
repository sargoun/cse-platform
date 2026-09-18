-- 0299 — Die Pruefliste vor dem Auftragsabschluss, als DEFINER-Zahlen
--        (OPS-05, FIN-18, D-366, AUT-05).

/**
 * **Warum das eine Datenbankfunktion ist und keine Abfrage in einem Dienst.**
 *
 * Die Pruefliste der Abschlussseite zaehlt offene Posten am Auftrag —
 * Zeiteintraege ohne Freigabe, freigegebene Zeit ohne Abrechnung,
 * unterschriebene Leistungsnachweise ohne Rechnung, Entwuerfe im
 * Rechnungsbestand, offene Aufmasse und Nachtraege. Die Tabellen dahinter
 * haben EIGENE Policies mit EIGENEN Rechten:
 *
 *   zeiteintrag   t_mandant USING app.hat_recht('zeit.lesen')
 *   rechnung, aufmass, nachtrag, leistungsnachweis  — je ihr Modulrecht
 *
 * Wer `auftrag.abschliessen` haelt, haelt darum nicht `zeit.lesen`. Eine
 * direkte Zaehlung bekaeme von der Datenbank korrekt NULL Zeilen — und die
 * Pruefliste meldete „nichts offen". Das ist nicht ein fehlender Hinweis,
 * sondern ein FALSCHER FREISPRUCH: der Abschluss wirkt geprueft, obwohl die
 * Pruefung nichts sehen konnte. Genau die Verwechslung von „null Zeilen" mit
 * „nichts da" beschreibt AUT-05, und D-366 begruendet an FIN-18 dieselbe
 * Entscheidung: `fin.auftrag_erfasste_minuten` ist `security definer`, damit
 * eine Buchhaltung ohne `zeit.lesen` nicht bei jedem Auftrag eine Warnung
 * bekommt, die nichts bedeutet.
 *
 * Diese Funktion gibt deshalb ZAHLEN und keine Zeilen zurueck — dieselbe
 * Grenze wie bei FIN-18 (EMP-13): wer abschliesst, erfaehrt, DASS Zeit offen
 * ist, nicht von wem. Wer die Zeilen sehen will, braucht `zeit.lesen` und
 * geht auf die Zeitseite.
 *
 * **Das Recht wird geprueft, nicht umgangen.** `security definer` heisst hier
 * „ein anderes Recht", nicht „kein Recht": die Funktion verlangt
 * `auftrag.abschliessen` im Mandanten des Auftrags und weist einen fremden
 * Auftrag ab (Invariante 3), genau wie `fin.auftrag_erfasste_minuten`.
 *
 * **Was NICHT gezaehlt wird.** „Offene auftrag_leistung-Zeilen" gibt es
 * nicht: `auftrag_leistung` traegt keine Statusspalte. Gezaehlt werden
 * stattdessen die Zeilen, deren Gueltigkeit noch nicht endet
 * (`gueltig_bis is null`) — eine Tatsache, kein erfundener Zustand.
 *
 * TODO(client, O-730): Welche dieser Befunde SPERREN den Auftragsabschluss, und welche muessen nur gesehen worden sein? FIN-18 selbst ist entschieden (D-366/D-367: warnt, uebergehbar mit protokollierter Begruendung, und zwar im Rechnungsweg vor der Nummernvergabe) — fuer die uebrigen sechs Befunde ist die Verbindlichkeit offen. Bis zur Antwort sperrt keiner, alle warnen, und die Seite sagt das sichtbar.
 */

create or replace function fin.auftrag_abschluss_befunde(p_auftrag uuid)
returns table (
  /** Zeiteintraege am Auftrag, die noch niemand freigegeben hat. */
  zeit_ohne_freigabe        bigint,
  /** Freigegebene Zeit, die in keiner Rechnung angekommen ist. */
  zeit_ohne_abrechnung      bigint,
  /** Erfasste Minuten insgesamt — die Groesse, an der FIN-18 haengt. */
  erfasste_minuten          bigint,
  /** Unterschriebene Leistungsnachweise ohne Rechnungsbezug. */
  nachweise_ohne_rechnung   bigint,
  /** Rechnungen im Entwurf an diesem Auftrag (FIN-04: Entwuerfe ohne Nummer). */
  rechnungen_entwurf        bigint,
  /** Aufmasse, die weder gegengezeichnet noch einseitig festgestellt sind. */
  aufmasse_offen            bigint,
  /** Nachtraege, die noch keine Entscheidung tragen. */
  nachtraege_offen          bigint,
  /** Leistungszeilen ohne Gueltigkeitsende — der Auftrag laeuft dort weiter. */
  leistungen_laufend        bigint,
  /** Leistungszeilen ohne Abrechnungskonfiguration (FIN-02). */
  ohne_abrechnungsart       bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_gehoert uuid;
begin
  select a.mandant_id into v_gehoert from public.auftrag a where a.id = p_auftrag;
  if not found then
    raise exception 'Auftrag % existiert nicht', p_auftrag using errcode = 'no_data_found';
  end if;
  /**
   * Invariante 3 — der Mandant kommt aus der SITZUNG und wird verglichen, nicht
   * aus dem Parameter abgeleitet. Ein Auftrag einer anderen Gesellschaft ist
   * hier nicht „nicht gefunden", sondern ein Zugriffsversuch.
   */
  if v_gehoert is distinct from v_mandant then
    raise exception 'Auftrag % gehoert nicht zum aktiven Mandanten (Invariante 3)', p_auftrag
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('auftrag.abschliessen', v_gehoert) then
    raise exception 'auftrag.abschliessen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
  with leistung as (
    select al.id, al.gueltig_bis
      from public.auftrag_leistung al
     where al.mandant_id = v_mandant and al.auftrag_id = p_auftrag
  ),
  zeit as (
    /**
     * Nur die geltende Fassung: `ersetzt_am is null` (eine Korrektur ist eine
     * neue Zeile, 0051) und kein Storno. Ohne das zaehlte jede korrigierte
     * Zeit doppelt, und die Pruefliste zeigte offene Posten, die es nicht gibt.
     */
    select z.freigegeben_am, z.abgerechnet_am, z.dauer_netto_minuten
      from public.zeiteintrag z
      join leistung l on l.id = z.auftrag_leistung_id
     where z.mandant_id = v_mandant
       and z.storniert_am is null and z.ersetzt_am is null
  )
  select
    (select count(*) from zeit where freigegeben_am is null),
    (select count(*) from zeit where freigegeben_am is not null and abgerechnet_am is null),
    (select coalesce(sum(dauer_netto_minuten), 0) from zeit),
    (select count(*)
       from public.leistungsnachweis ln
       join leistung l on l.id = ln.auftrag_leistung_id
      where ln.mandant_id = v_mandant
        and ln.status = 'signiert' and ln.storniert_am is null
        and not exists (select 1 from public.rechnungsposition_quelle rq
                         where rq.leistungsnachweis_id = ln.id)),
    (select count(*) from public.rechnung r
      where r.mandant_id = v_mandant and r.auftrag_id = p_auftrag
        and r.status = 'entwurf'),
    (select count(*)
       from public.aufmass am
       join leistung l on l.id = am.auftrag_leistung_id
      where am.mandant_id = v_mandant and am.storniert_am is null
        and am.status not in ('gegengezeichnet', 'einseitig_festgestellt', 'abgelehnt')),
    (select count(*) from public.nachtrag n
      where n.mandant_id = v_mandant and n.auftrag_id = p_auftrag
        and n.storniert_am is null
        and n.status in ('angemeldet', 'kalkuliert', 'eingereicht')),
    (select count(*) from leistung where gueltig_bis is null),
    (select count(*) from leistung l
      where not exists (select 1 from public.vertrag_abrechnung va
                         where va.mandant_id = v_mandant
                           and (va.auftrag_leistung_id = l.id
                                or (va.auftrag_leistung_id is null
                                    and va.auftrag_id = p_auftrag))));
end $$;

comment on function fin.auftrag_abschluss_befunde(uuid) is
  'OPS-05, FIN-18, D-366, AUT-05. Die Pruefliste vor dem Abschluss als Zahlen — '
  'security definer, damit eine Rolle ohne zeit.lesen keinen falschen Freispruch '
  'bekommt. Verlangt auftrag.abschliessen und weist einen fremden Auftrag ab. '
  'Welche Befunde sperren, ist offen (O-730).';

revoke all on function fin.auftrag_abschluss_befunde(uuid) from public;
grant execute on function fin.auftrag_abschluss_befunde(uuid) to cse_app;
