/**
 * Ein totes Recht auf `vertrag_abrechnung` — gefunden von der Wache, nicht
 * von einem Menschen.
 *
 * `0105` schrieb `grant select on vertrag_abrechnung to cse_job;` ohne einen
 * Satz daneben, der sagt, wofuer. Die Tabelle traegt `force row level
 * security`, und ihre drei Policies gelten alle `to cse_app`. Unter FORCE
 * heisst „keine anwendbare Policy" nicht „alles", sondern „nichts": das Recht
 * war da, der Weg nicht. `tests/isolation/spaltenrechte.test.ts` — in der
 * Nachtrunde von PR #5 von „irgendeine Policy" auf „eine Policy FUER DIESE
 * ANWEISUNG" geschaerft — hat es beim ersten Lauf gegen den Phase-6-Zweig
 * gemeldet.
 *
 * **Entzogen und nicht mit einer Policy geheilt.** Die naheliegende Reparatur
 * waere eine mandantengebundene Policy gewesen, wie sie `0108` fuer den
 * Kettenpruefer bekommt. Der Unterschied ist, dass es den Leser dort GIBT:
 * `kette_pruefen` liest `nummernkreis` und `rechnung` jede Nacht. Auf
 * `vertrag_abrechnung` liest kein einziger der fuenf registrierten Jobs —
 * die Abrechnungsarten laufen ausschliesslich aus `/api/abrechnung`, also
 * als `cse_app` in einer Portalsitzung.
 *
 * Ein Recht fuer einen Aufrufer, den es nicht gibt, ist keine Vorbereitung,
 * sondern eine Behauptung: der naechste Mensch liest es als „der Nachtlauf
 * rechnet ab" und baut darauf. Wenn ein periodischer Abrechnungslauf kommt,
 * bringt er Recht UND Policy zusammen mit — `0108` ist die Vorlage dafuer,
 * und die Wache verlangt es ohnehin.
 *
 * Der Stundensatz auf dieser Zeile ist ausserdem die Marge (02-CRM §3.2,
 * EMP-13). Wer sie ohne Not fuer einen weiteren Prinzipal oeffnet, oeffnet
 * genau die Zahl, die `p_intern_decke` vom Kunden und von der Kraft vor Ort
 * fernhaelt.
 */
revoke select on vertrag_abrechnung from cse_job;
