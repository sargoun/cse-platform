-- 0514 — gesetzliche Untergrenze und Voreinstellung der Aufbewahrung getrennt
--        (V-372, O-906, D-796, D-818).
--
-- kern.aufbewahrung_untergrenze (0141) erzwang zehn Jahre fuer Rechnung,
-- Buchhaltung und Beleg. Seit dem BEG IV (1. Januar 2025) gelten fuer
-- Buchungsbelege — Rechnungen eingeschlossen — acht Jahre (§ 147 Abs. 1 Nr. 4,
-- Abs. 3 AO, § 257 Abs. 1 Nr. 4, Abs. 4 HGB, § 14b Abs. 1 UStG); eine
-- Gesellschaft konnte die kuerzere Frist nicht eintragen, auch wo der
-- Steuerberater sie zulaesst. Buecher, Abschluesse und Inventare bleiben bei
-- zehn, Handels- und Geschaeftsbriefe bei sechs Jahren.
--
-- Die VOREINSTELLUNG bleibt zehn Jahre: das sind die Plattformzeilen in
-- dokument_aufbewahrung (0009), und an ihnen aendert diese Migration nichts.
-- Getrennt wird nur die Untergrenze.
--
-- Die Loeschsperre der drei Finanzklassen haengt jetzt an der KLASSE, nicht an
-- der Zahl: "ab zehn Jahren gesperrt" haette Rechnung und Beleg mit der
-- kuerzeren Untergrenze still aus der Sperre entlassen.
--
-- Dieselben Zahlen stehen in UNTERGRENZE und SPERRE_PFLICHT
-- (src/server/services/dokument/aufbewahrung.ts) — dort, damit der Satz vor dem
-- Schreiben kommt; hier, damit er auch ohne den Dienst gilt.
--
-- Nur Kommentare mit Doppelstrich.

create or replace function kern.aufbewahrung_untergrenze() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_min integer;
begin
  v_min := case new.kategorie
    when 'rechnung' then 8
    when 'buchhaltung' then 10
    when 'beleg' then 8
    when 'vertrag' then 6
    when 'angebot' then 6
    when 'kunde' then 6
    else null
  end;
  if v_min is not null then
    if new.jahre is null or new.jahre < v_min then
      raise exception
        'Aufbewahrung fuer % unter der gesetzlichen Mindestfrist von % Jahren (§ 147 AO, § 257 HGB, § 14b UStG)',
        new.kategorie, v_min
        using errcode = 'restrict_violation';
    end if;
  end if;
  if new.kategorie in ('rechnung', 'buchhaltung', 'beleg') and not new.loeschsperre then
    raise exception
      'Die Loeschsperre fuer % ist gesetzlich (§ 147 AO, § 257 HGB) und laesst sich nicht abwaehlen',
      new.kategorie
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.geaendert_am := now();
  end if;
  return new;
end $$;

comment on function kern.aufbewahrung_untergrenze() is
  'V-372, D-818 (zuerst 0141): gesetzliche Untergrenzen nach BEG IV — Rechnung und Beleg '
  'acht, Buchhaltung zehn, Vertrag, Angebot und Kunde sechs Jahre; die Loeschsperre der '
  'drei Finanzklassen ist Pflicht. Die Voreinstellung (zehn Jahre) steht in den '
  'Plattformzeilen, nicht hier.';
