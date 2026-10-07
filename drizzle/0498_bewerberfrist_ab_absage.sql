-- 0498 — die Bewerberfrist zaehlt ab der Absage (V-365, O-373, D-797, D-807).
--
-- `aufbewahrung_bis` setzt die Annahme beim Eingang (`nimmBewerbungAn`,
-- `recruiting/postfach.ts`): Eingangstag plus `recruiting.aufbewahrung_tage`.
-- Neu gerechnet wurde die Frist nie. Eine Absage, die spaet kommt, verkuerzte
-- damit die Zeit, in der sich das Verfahren belegen laesst — und genau sie
-- braucht es: einen Anspruch nach § 15 AGG macht die Bewerberin binnen zwei
-- Monaten nach Zugang der Ablehnung geltend (§ 15 Abs. 4 AGG), die Klage
-- folgt binnen drei weiteren Monaten (§ 61b ArbGG).
--
-- Die Voreinstellung zu O-373 (D-797): die Frist laeuft ab der Absage, ohne
-- Entscheidung ab dem Eingang. Der Nachzug aus 0168 setzt deshalb bei einer
-- Absage `aufbewahrung_bis` auf den Berliner Entscheidungstag plus dieselbe
-- Frist wie beim Eingang — und NIE frueher als der Eingangswert: eine Absage
-- verlaengert, sie verkuerzt nicht. Eine Einstellung (`eingestellt`) aendert
-- die Frist nicht; was mit den Unterlagen einer eingestellten Person geschieht,
-- ist die Personalakte (V-366).
--
-- Fehlt die Einstellung oder ist sie keine ganze Zahl, bleibt der Eingangswert
-- stehen: die Entscheidung scheitert nicht an einer Einstellung, und die
-- Annahme hat ohne sie gar nicht erst angenommen (REC-07).

create or replace function app.entscheidung_zieht_bewerbung_nach() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_roh  text;
  v_tage int;
begin
  if new.ergebnis = 'abgelehnt' then
    v_roh := app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}';
    if v_roh ~ '^[1-9][0-9]{0,4}$' then
      v_tage := v_roh::int;
    end if;
  end if;

  update public.bewerbung
     set status = new.ergebnis,
         aufbewahrung_bis = case
           when v_tage is null then aufbewahrung_bis
           else greatest(aufbewahrung_bis, app.berlin_heute() + v_tage)
         end,
         geaendert_am = now()
   where id = new.bewerbung_id and mandant_id = new.mandant_id;
  return new;
end $$;

comment on function app.entscheidung_zieht_bewerbung_nach() is
  'REC-08. Zieht den Status der Bewerbung nach, in DERSELBEN Transaktion wie '
  'die Entscheidung. Bei einer Absage laeuft die Aufbewahrungsfrist ab dem '
  'Berliner Entscheidungstag neu, nie kuerzer als ab Eingang (V-365, O-373).';

-- Unveraendert seit 0168, hier nur bekraeftigt: Eigentum und kein PUBLIC.
alter function app.entscheidung_zieht_bewerbung_nach() owner to cse_definer;
revoke all on function app.entscheidung_zieht_bewerbung_nach() from public;

-- ---------------------------------------------------------------------------
-- Der Altbestand: Absagen VOR dieser Migration
-- ---------------------------------------------------------------------------
--
-- Der Ausloeser greift erst bei kuenftigen Entscheidungen. Eine Bewerbung,
-- die schon abgelehnt ist, behielte ihren Eingangswert, und der Nachtlauf
-- (bewerber_loeschung) loeschte sie, bevor die Frist ab ihrer Absage um ist
-- (Copilot-Befund auf PR 39). Derselbe Nachzug deshalb hier einmal fuer den
-- Bestand.
--
-- Die Regel fuer historische Einstellungswerte, ausdruecklich: einen Verlauf
-- der Einstellung kennt die Plattform nicht (plattform_einstellung ist eine
-- Zeile). Es gilt der Wert von recruiting.aufbewahrung_tage zum Zeitpunkt
-- dieser Migration, gezaehlt ab dem Berliner Kalendertag von
-- einstellungsentscheidung.entschieden_am; wie beim Ausloeser nie kuerzer als
-- der Eingangswert und ohne gueltige Einstellung gar nicht. Was der Nachtlauf
-- schon geloescht hat (geloescht_am), bleibt, wie es ist.

update public.bewerbung b
   set aufbewahrung_bis = (e.entschieden_am at time zone 'Europe/Berlin')::date + t.tage,
       geaendert_am = now()
  from public.einstellungsentscheidung e,
       (select case when r.w ~ '^[1-9][0-9]{0,4}$' then r.w::int end as tage
          from (select app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}' as w) r
       ) t
 where e.bewerbung_id = b.id and e.mandant_id = b.mandant_id
   and e.ergebnis = 'abgelehnt'
   and b.status = 'abgelehnt'
   and b.geloescht_am is null
   and t.tage is not null
   and b.aufbewahrung_bis < (e.entschieden_am at time zone 'Europe/Berlin')::date + t.tage;
