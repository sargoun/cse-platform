/**
 * 0124 — Das Rechnungsausgangsbuch (FIN-16, REP-07, `05-FINANZEN.md` §10).
 *
 * **Was es ist.** Die Folge der ausgestellten Rechnungen je Nummernkreis, in
 * der Reihenfolge ihrer Nummern, mit dem Hashkettenglied daneben. Eine
 * Betriebspruefung liest genau das: Ist die Folge lueckenlos? Passt die Summe
 * zu den Belegen? Traegt jeder Beleg sein Kettenglied?
 *
 * **Warum eine Sicht und keine Tabelle.** Jede Zahl darin steht schon
 * irgendwo — auf der Rechnung, im Snapshot, im Kettenglied. Sie ein zweites
 * Mal zu speichern hiesse, eine zweite Wahrheit zu fuehren, die beim ersten
 * Nachtrag von der ersten abweicht. Das Ausgangsbuch ist eine LESART, kein
 * Datenbestand.
 *
 * **Der Kundenname kommt aus dem SNAPSHOT, nicht aus `kunde`** (K-12). Wird
 * der Kunde spaeter umbenannt, umgezogen oder anonymisiert, muss das Buch
 * weiter zeigen, was auf dem Beleg stand. Ein Join auf den Stammsatz gaebe
 * ein Buch, das sich rueckwirkend aendert — und genau das darf ein
 * Ausgangsbuch nicht.
 *
 * **`luecke` ist `coalesce`d, und das ist kein Feinschliff.** Auf der ersten
 * Zeile jeder Gruppe ist `lag()` NULL, und `nummer_laufend <> NULL + 1`
 * ergibt NULL — nicht `false`. Die Zusage „`luecke` ist auf jeder Zeile
 * falsch" haette dann bestanden oder nicht bestanden, je nachdem wie ein Test
 * sie prueft; das ist von drei Ausgaengen der schlechteste. Die erste Zeile
 * wird deshalb gegen `1` geprueft: ein lueckenloser Kreis beginnt dort
 * (`nummernkreis.naechste_nummer` hat keinen anderen Startwert, und ein
 * Nachfolgekreis beginnt wieder bei 1 — die Kette ueber die Jahresgrenze
 * haelt `genesis_hash`, nicht der Zaehler).
 */
create view rechnungsausgangsbuch with (security_invoker = true) as
select
  r.id                                as rechnung_id,
  r.mandant_id,
  r.nummernkreis_id,
  nk.bezeichnung                      as nummernkreis,
  r.nummer,
  r.nummer_laufend,
  r.rechnungsdatum,
  r.leistung_von,
  r.leistung_bis,
  /* K-12: der Name, wie er auf dem Beleg steht — nicht der heutige. */
  s.nutzlast -> 'empfaenger' ->> 'name' as kunde_name,
  r.netto_gesamt_cent,
  r.steuer_gesamt_cent,
  r.brutto_cent,
  r.rechnungsart,
  exists (select 1 from rechnung_beziehung b
           where b.zu_rechnung_id = r.id and b.art = 'storno')
                                      as storniert,
  h.kette_position,
  h.hash,
  coalesce(
    r.nummer_laufend <> lag(r.nummer_laufend)
      over (partition by r.nummernkreis_id order by r.nummer_laufend) + 1,
    r.nummer_laufend <> 1)            as luecke,
  /* Ohne Kettenglied ist der Beleg nicht bezeugt — FIN-06 meldet das
     naechtlich, und hier steht es sichtbar in der Zeile. */
  (h.hash is null)                    as ohne_kettenglied
from rechnung r
join nummernkreis nk
  on nk.id = r.nummernkreis_id and nk.mandant_id = r.mandant_id
left join rechnung_snapshot s
  on s.rechnung_id = r.id and s.mandant_id = r.mandant_id
left join rechnung_hash h
  on h.rechnung_id = r.id and h.mandant_id = r.mandant_id
where r.status = 'festgeschrieben';

comment on view rechnungsausgangsbuch is
  'FIN-16, REP-07. Die Folge der ausgestellten Rechnungen je Kreis, mit '
  'Kettenglied und Lueckenkennzeichen. Entwuerfe stehen NICHT darin: sie '
  'haben keine Nummer und keine rechtliche Existenz.';

/**
 * Die Sicht braucht ein EIGENES Recht — dass der Leser die Tische darunter
 * sehen darf, genuegt nicht. `security_invoker` sorgt dafuer, dass sie nicht
 * mehr zeigt als er ohnehin sehen duerfte: die Mandantenwand steht in den
 * Policies von `rechnung`, `rechnung_snapshot` und `rechnung_hash`, und ein
 * Kunde sieht ueber `p_intern_ceiling` auf `rechnung_snapshot` gar nichts.
 */
grant select on rechnungsausgangsbuch to cse_app, cse_job;
