-- ===========================================================================
-- 0095 — die Medienroute schrieb in den Bucket, BEVOR die Marke geprueft war
--        (05-API-KARTE.md §C.3, 04-PLANUNG-ZEIT.md §5.8, §5.13; TIM-10;
--         K-01, K-08; AUT-06)
--
-- **Der Befund.** `POST /api/check-in/[token]/medien` traegt im
-- Routenregister `recht: null` — sie ist offen, so wie der Check-in selbst,
-- weil eine Kraft im Treppenhaus keine Anmeldung hat. Was sie schuetzt, soll
-- die Marke sein. Nur lief die Reihenfolge andersherum:
--
--     Groesse -> Magic Bytes -> EXIF entfernen -> BUCKET -> Marke
--
-- Der Bucket-Schreibvorgang stand VOR der einzigen Pruefung, die den Aufrufer
-- betrifft. Die Kompensation im `catch` fing das nicht auf, und zwar aus
-- einem Grund, der nicht nach einem Fehler aussieht: loest die Marke nicht
-- auf, WIRFT `app.offline_ereignis_annehmen` nicht — sie legt die Einreichung
-- absichtlich im Vorbereich ab (§5.13) und meldet Erfolg (AUT-06: die Antwort
-- unterscheidet die Faelle nicht). Der `catch` lief also nie, das Objekt blieb
-- liegen, und weil der Vorbereich keine `einsatz_medien`-Zeile schreibt, blieb
-- es OHNE Zeile: unerreichbar, unauffindbar, ueber die Anwendung nicht mehr
-- loeschbar.
--
-- Was das gekostet haette: ein Unbefugter ohne jede Marke konnte mit einem
-- einzigen POST bis zu 100 MiB (`MEDIEN_MAX_BYTES`) in den privaten
-- Medienbucket legen, beliebig oft, dazu jedes Mal Magic-Byte-Erkennung und
-- EXIF-Bereinigung ausloesen. Ein Bucket, den Fremde fuellen und niemand
-- leeren kann, ist nicht nur Kosten — er ist eine Ablage fuer fremde Inhalte
-- unter unserem Auftragsverarbeitungsvertrag.
--
-- **Die Reparatur zieht die Markenpruefung vor, ohne die Marke zu
-- verbrauchen.** Diese Funktion LIEST nur, genau wie das Tor am Anfang von
-- `app.offline_ereignis_annehmen`, und mit denselben drei Bedingungen:
--
--   * die Marke existiert,
--   * sie ist nicht widerrufen,
--   * ihre Einteilung ist nicht zurueckgenommen.
--
-- **Bewusst NICHT geprueft werden Gueltigkeitsfenster und `eingeloest_am`.**
-- Eine Nachreichung ist ja gerade deshalb spaet, weil kein Netz da war; sie am
-- Fenster abzuweisen hiesse, die Stunden zu verlieren, um die es geht. Waere
-- diese Funktion strenger als das Tor dahinter, wiese die Route Aufnahmen ab,
-- die die Warteschlange annimmt — zwei Wahrheiten ueber dieselbe Marke.
--
-- **Warum eine DRITTE Zeile im K-08-Register vertretbar ist.** 0092 hat das
-- Register gerade erst geschlossen, und D-135 sagt zu Recht: wer es erweitert,
-- ohne zu muessen, hat bald keins mehr. Hier gibt es keinen anderen Weg — der
-- Prinzipal `cse_checkin` haelt kein Tabellenrecht, kann also nicht selbst
-- nachsehen, und beide vorhandenen Funktionen SCHREIBEN. Die neue Zeile ist
-- die engste denkbare: ein Argument, `boolean` zurueck, `stable`, kein
-- Schreibvorgang, keine Auskunft ueber Mandant, Person oder Einteilung. Sie
-- verraet genau ein Bit — und dasselbe Bit gibt der Check-in-Endpunkt ohnehin
-- heraus, dort sogar auf Kosten der Marke.
--
-- **`owner to cse_definer`** (K-01): eine NEU angelegte `security
-- definer`-Funktion gehoert sonst `postgres` und laeuft als Superuser an jeder
-- RLS vorbei. Nachgesehen und nicht vermutet, dass der Rumpf danach noch
-- liest: `checkin_token` gewaehrt `cse_definer` SELECT und traegt die
-- permissive Policy `ct_definer using (true)`, `einsatz_zuordnung` ebenso mit
-- `ez_definer`. Ohne diese beiden laese die Funktion nach dem
-- Eigentuemerwechsel still `false` — der Fehler, der bei einem Definer NIE
-- eine Meldung erzeugt und hier jede Aufnahme abgewiesen haette.
--
-- **`revoke all … from public`** (0092): Postgres legt jede Funktion mit
-- `EXECUTE` fuer PUBLIC an. Ohne diese Zeile waere der ausdrueckliche Grant
-- daneben wieder nur eine Beschriftung.
-- ===========================================================================

create function app.checkin_marke_praesentierbar(p_token_hash text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.checkin_token ct
      left join public.einsatz_zuordnung ez on ez.id = ct.einsatz_zuordnung_id
     where ct.token_hash = p_token_hash
       and ct.widerrufen_am is null
       and ez.entfernt_am is null);
$$;

comment on function app.checkin_marke_praesentierbar(text) is
  'K-08-Register Zeile 5, Rolle cse_checkin. Sagt NUR, ob eine Marke '
  'vorgelegt werden darf — existiert, nicht widerrufen, Einteilung nicht '
  'zurueckgenommen. Verbraucht nichts, schreibt nichts und nennt weder '
  'Mandant noch Person. Dieselben Bedingungen wie das Tor in '
  'app.offline_ereignis_annehmen: Fenster und eingeloest_am bleiben bewusst '
  'aussen vor, sonst wiese die Route ab, was die Warteschlange annimmt.';

alter function app.checkin_marke_praesentierbar(text) owner to cse_definer;

revoke all on function app.checkin_marke_praesentierbar(text) from public;
grant execute on function app.checkin_marke_praesentierbar(text) to cse_checkin;
