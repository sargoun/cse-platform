-- 0495 — die Gruppenansicht liest keine Nachrichtenfaeden (V-379, O-651, D-805).
--
-- 0011 legte t_nachricht_gruppe an: mit gruppe.nachricht.lesen durfte die
-- Gruppenansicht jede Nachricht jeder Gesellschaft lesen. Eine Seite dafuer
-- gab es nie; die Policy wirkte nur auf direkte Abfragen. 0231 und 0370
-- liessen die Frage bewusst offen (O-651), weil eine restriktive Decke den
-- vorhandenen Schluessel still wirkungslos gemacht haette.
--
-- Die Voreinstellung steht seit D-799: die Gruppenleitung liest keine
-- Nachrichtenfaeden (TEN-05 gibt ihr Zahlen, nicht den Wortlaut einer
-- Schwestergesellschaft; wie O-910 fuer Gespraechsinhalte im CRM). Deshalb
-- hier beides, sichtbar und nicht still:
--
--   1. t_nachricht_gruppe faellt weg — die Tuer ist zu.
--   2. p_gruppe_kein_personenbezug als RESTRIKTIVE Decke auf den drei
--      Nachrichtentischen, in der Bauart von 0370 — sie haelt die Tuer zu,
--      falls jemand die permissive Policy wieder anlegt. Restriktiv heisst
--      UND: sie kann nichts oeffnen, nur schliessen.
--
-- Der Schluessel gruppe.nachricht.lesen bleibt im Katalog stehen und oeffnet
-- auf den Nachrichtentischen nichts mehr; das sagt der Kommentar an der Decke.
-- Kein Datensatz aendert sich.

drop policy if exists t_nachricht_gruppe on nachricht;

do $$
declare t text;
begin
  foreach t in array array['nachricht', 'nachricht_anhang', 'nachricht_empfaenger']
  loop
    execute format($p$
      create policy p_gruppe_kein_personenbezug on %I as restrictive for all to cse_app
        using (not app.ist_gruppenansicht())
        with check (not app.ist_gruppenansicht())$p$, t);
  end loop;
end $$;

comment on policy p_gruppe_kein_personenbezug on nachricht is
  'V-379, O-651, D-799/D-805: die Gruppenansicht sieht null Nachrichten, Anhaenge und '
  'Empfaenger, gleich wie gruppe.nachricht.lesen gesaet ist. TEN-05 gibt der Gruppe '
  'verdichtete Zahlen, nicht den Wortlaut der Faeden einer Schwestergesellschaft.';
