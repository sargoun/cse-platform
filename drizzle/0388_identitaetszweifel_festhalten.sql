-- ===========================================================================
-- 0388 — Der Identitätszweifel bekommt eine Spalte (V-088, Art. 12 Abs. 6)
-- ===========================================================================
--
-- **Der Befund.** `betroffenenanfrage_status` kennt `identitaet_offen` seit
-- `0176`, der Fristindex zählt ihn zu den offenen Zuständen, zwei
-- Oberflächen beschriften ihn — **und kein Weg setzte ihn.** Wer an der
-- Identität eines Antragstellers zweifelte, hatte die Wahl zwischen
-- „in Bearbeitung" (was nicht stimmt) und „abgelehnt" (was zu früh wäre).
--
-- **Warum das nicht nur ein Zustand ist.** Art. 12 Abs. 6 DSGVO erlaubt die
-- Nachfrage NUR „bei begründeten Zweifeln an der Identität". Wer nachfragt,
-- verarbeitet dafür weitere Daten — Ausweiskopie, Geburtsdatum — und muss
-- belegen können, WORAUF sich die Zweifel stützten. Ein blosser Zustand ohne
-- Grund wäre die Behauptung ohne den Beleg; genau dieselbe Lage wie bei der
-- Fristverlängerung, und `0176` hält die dort mit
-- `betroffenenanfrage_verlaengerung_begruendet` zusammen. Diese Migration
-- macht es für den Identitätszweifel genauso.
--
-- **Die FRIST bleibt unberührt, und das ist eine Entscheidung** (O-903).
-- Art. 12 Abs. 3 lässt den Monat mit dem Eingang laufen; ob eine Rückfrage
-- nach Art. 12 Abs. 6 ihn hemmt, sagt die Verordnung NICHT, und die Ansichten
-- dazu gehen auseinander. Die Frist hier still anzuhalten wäre eine
-- Rechtsauffassung, die sich als Spaltenwert tarnt — und im Zweifel eine, die
-- der Aufsicht nicht gefällt. Sie läuft also weiter, und die Liste der
-- fälligen Anfragen zeigt die Anfrage weiter an.

alter table betroffenenanfrage
  add column identitaet_angefordert_am timestamptz,
  add column identitaet_grund          text;

comment on column betroffenenanfrage.identitaet_angefordert_am is
  'Art. 12 Abs. 6: wann zusaetzliche Angaben zur Identitaet angefordert wurden. '
  'Die Monatsfrist laeuft davon unberuehrt weiter (O-903).';

comment on column betroffenenanfrage.identitaet_grund is
  'WORAUF sich die begruendeten Zweifel stuetzen. Ohne ihn keine Anforderung — '
  'die Nachfrage ist selbst eine Verarbeitung und braucht ihren Anlass.';

/**
 * Beide zusammen oder keines — dieselbe Form wie bei der Verlängerung.
 *
 * Ein Zeitpunkt ohne Grund wäre eine Anforderung, deren Anlass niemand mehr
 * kennt; ein Grund ohne Zeitpunkt eine Notiz, die wie eine Anforderung
 * aussieht.
 */
alter table betroffenenanfrage
  add constraint betroffenenanfrage_identitaet_begruendet check (
    (identitaet_angefordert_am is null and identitaet_grund is null)
    or (identitaet_angefordert_am is not null
        and btrim(coalesce(identitaet_grund, '')) <> ''));

/**
 * Und der Zustand `identitaet_offen` trägt sie.
 *
 * Ohne diese Bedingung liesse sich der Zustand setzen, ohne dass jemand einen
 * Grund genannt hat — und dann stünde in der Akte „Identität offen" ohne die
 * Angabe, warum. Umgekehrt gilt sie NICHT: eine Anfrage, deren Identität
 * inzwischen geklärt ist, läuft weiter und behält den Vermerk. Er ist der
 * Beleg dafür, dass nachgefragt wurde, und verschwindet nicht mit der
 * Antwort.
 */
alter table betroffenenanfrage
  add constraint betroffenenanfrage_identitaet_offen_begruendet check (
    status <> 'identitaet_offen' or identitaet_angefordert_am is not null);
