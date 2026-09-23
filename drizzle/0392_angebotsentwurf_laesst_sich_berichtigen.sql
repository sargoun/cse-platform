-- ===========================================================================
-- 0392 — Ein Angebotsentwurf lässt sich berichtigen und zurückziehen (V-130)
-- ===========================================================================
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Der Befund.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `angebotsposition` trägt `revoke delete` (0024:529) und hatte keine
-- Archivspalte; das einzige `update` im ganzen Projekt setzt den Einzelpreis
-- nach einer bestätigten Kalkulation. Der Kopf steht genauso da:
-- `archiviert_am` wird nirgends gesetzt, und `zurueckgezogen` steht seit
-- 0024:27 im Aufzählungstyp, ohne dass ein Dienst ihn je schreibt.
--
-- **Ein Tippfehler in einem Entwurf stand damit dauerhaft in der
-- Angebotsliste.** Nicht in einem abgegebenen Vertragsangebot — in einem
-- Entwurf ohne Nummer, den ausser dem Haus niemand gesehen hat.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Die Entscheidung (O-900 → D-620): die Trennlinie ist `versendet_am`.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ein Angebot, das das Haus VERLASSEN hat, bleibt unveränderlich; eine
-- Änderung ist eine neue Version mit Rückverweis (`ersetzt_angebot_id`,
-- `angebot_nachfolger_uk` liegen bereit). Das gilt weiter und wird hier mit
-- keiner Zeile angefasst.
--
-- Ein ENTWURF ist etwas anderes, und die Plattform hat diese Unterscheidung
-- längst getroffen — bei der Rechnung, in Invariante 4: ein Entwurf trägt
-- keine Nummer, ist frei änderbar, und die Unveränderlichkeit beginnt mit der
-- Festschreibung. `angebot_nummer_bei_versand` zieht dieselbe Linie bereits
-- in dieser Tabelle: `(angebotsnummer is null) = (versendet_am is null)`.
--
-- Dieselbe Regel auf das Angebot anzuwenden erfindet also keine
-- Geschäftsregel, sondern wendet die vorhandene widerspruchsfrei an. **Was
-- ein Prüfer sehen soll, bleibt vollständig:** nichts wird gelöscht. Eine
-- entfernte Position behält ihre Zeile und trägt Zeitpunkt und Urheber; ein
-- zurückgezogener Entwurf verschwindet aus der Arbeitsliste, nicht aus der
-- Datenbank (Invariante 8).
--
-- Die strengere Lesart — jede Korrektur erzeugt eine neue Version, auch am
-- Entwurf — bleibt möglich und kostet einen Dienst weniger, nicht mehr: sie
-- fügt Zeilen hinzu, statt welche zu ändern. Sagt der Auftraggeber das, ist
-- der Weg hierhin zurück offen.

alter table angebotsposition
  add column entfernt_am timestamptz,
  add column entfernt_von uuid references benutzer(id);

comment on column angebotsposition.entfernt_am is
  'V-130/D-620: aus dem Entwurf genommen, NICHT geloescht (Invariante 8). '
  'Nach dem Versand unmoeglich — ap_unveraenderlich weist es ab.';

/**
 * Beide zusammen oder keines — dieselbe Form wie bei jeder anderen
 * Rücknahme in dieser Plattform.
 *
 * Ein Zeitpunkt ohne Urheber wäre eine Entfernung, die niemand zu
 * verantworten hat; ein Urheber ohne Zeitpunkt eine Notiz, die wie eine
 * Entfernung aussieht.
 */
alter table angebotsposition
  add constraint ap_entfernung_benannt check (
    (entfernt_am is null and entfernt_von is null)
    or (entfernt_am is not null and entfernt_von is not null));

-- Die Liste des Entwurfs liest nur die lebenden Zeilen.
create index ap_lebend_idx on angebotsposition (mandant_id, angebot_id, sortierung)
  where entfernt_am is null;

/**
 * Die Summe zählt nur, was noch dasteht.
 *
 * Ohne diese Zeile bliebe der Betrag einer entfernten Position in
 * `angebot.netto_cent` stehen — und der Bildschirm zeigte eine Summe, die
 * sich aus den sichtbaren Zeilen nicht nachrechnen lässt. Genau die Sorte
 * Abweichung, die niemand meldet und die im Angebot an den Kunden geht.
 */
create or replace function kern.aktualisiere_angebot_summen() returns trigger
language plpgsql as $$
declare v_id uuid := coalesce(new.angebot_id, old.angebot_id);
begin
  update public.angebot a
     set netto_cent = coalesce((select sum(gesamtpreis_cent)
                                  from public.angebotsposition
                                 where angebot_id = v_id and typ = 'leistung'
                                   and entfernt_am is null), 0)
   where a.id = v_id;
  return null;
end $$;

/**
 * Und die Steuerzeilen beim Versand ebenso.
 *
 * `angebot_steuer` ist die eingefrorene Aufteilung nach Steuersatz; eine
 * entfernte Position darin hiesse, dem Kunden Umsatzsteuer auf eine Leistung
 * auszuweisen, die im Angebot gar nicht mehr steht.
 *
 * Der Rest der Funktion ist unverändert — sie steht hier vollständig, weil
 * `create or replace` keine halbe Fassung kennt.
 */
create or replace function kern.angebot_versand_festschreiben() returns trigger
language plpgsql as $$
begin
  if old.versendet_am is null and new.versendet_am is not null then
    perform set_config('app.angebot_versand', new.id::text, true);

    insert into public.angebot_steuer
      (mandant_id, angebot_id, steuersatz_bp, steuer_kennzeichen, netto_cent, steuer_cent,
       hinweistext)
    select new.mandant_id, new.id, p.steuersatz_bp, p.steuer_kennzeichen,
           sum(p.gesamtpreis_cent),
           round(sum(p.gesamtpreis_cent) * p.steuersatz_bp / 10000.0)::bigint,
           max(p.steuerbefreiung_grund)
      from public.angebotsposition p
     where p.angebot_id = new.id and p.typ = 'leistung'
       and p.entfernt_am is null
     group by p.steuersatz_bp, p.steuer_kennzeichen;

    update public.kalkulation
       set status = 'festgeschrieben',
           festgeschrieben_am = now(),
           festgeschrieben_von = new.versendet_von
     where angebot_id = new.id and status = 'entwurf';

    perform set_config('app.angebot_versand', '', true);
  end if;
  return null;
end $$;

/**
 * **Ein zurückgezogener Entwurf geht nicht mehr hinaus, und ein leeres
 * Angebot ist keines.**
 *
 * Zwei Wege, die es ohne diese Prüfung gäbe und die beide beim Kunden enden:
 *
 *  1. Ein Entwurf wird zurückgezogen und danach versendet. `status` und
 *     `versendet_am` sind getrennte Spalten; die Bedingung
 *     `angebot_rueckzug_ehrlich` erlaubt `zurueckgezogen` ausdrücklich für
 *     ein unversendetes Angebot — sie kann nicht auch noch die Gegenrichtung
 *     abdecken.
 *
 *  2. Alle Leistungspositionen werden entfernt, und das Angebot geht mit
 *     `netto_cent = 0` und ohne eine einzige Steuerzeile hinaus. Ein Blatt
 *     mit Briefkopf, Nummer und Bindefrist — und ohne Leistung. Der
 *     Empfänger hätte ein Vertragsangebot über nichts in der Hand.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **ACHTUNG — diese Funktion trägt DREI Schichten, und `create or replace`
 * kennt keine halbe Fassung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0024` legte sie mit der Platzhalterprüfung an. `0295` ersetzte sie und
 * fügte die **Preisfreigabe** hinzu — Invariante 7 in der Datenbank: ohne
 * benannten Menschen verlässt nichts das Haus. Wer hier von der
 * 0024-Fassung ausgeht, löscht 0295 stillschweigend.
 *
 * **Genau das ist beim Schreiben dieser Migration passiert**, und gefunden
 * hat es `tests/isolation/angebot.test.ts` §3: der Versand ohne Freigabe
 * fiel danach nur noch am CHECK `angebot_freigabe_vor_versand` auf, mit der
 * Meldung „violates check constraint" statt mit dem Satz über den fehlenden
 * Arbeitsschritt — und ein Versand aus `status = 'in_pruefung'` wäre am
 * CHECK ganz vorbeigelaufen, weil dessen erster Zweig diesen Status erlaubt
 * (0295 sagt es selbst an dieser Stelle).
 *
 * Die Reihenfolge der Prüfungen ist Absicht und bleibt: **zuerst die
 * Freigabe** (Invariante 7 ist die schwerste Aussage, und sie gehört zuerst
 * gelesen), dann der Rückzug, dann die leere Leistung, dann die offenen
 * Kalkulationswerte mit dem ausführlichen Weg heraus.
 */
create or replace function kern.angebot_versand_pruefen() returns trigger
language plpgsql as $$
begin
  if old.versendet_am is null and new.versendet_am is not null then
    -- 0295, Invariante 7: ohne benannten Menschen verlaesst nichts das Haus.
    if new.freigegeben_von is null or new.freigegeben_am is null then
      raise exception 'Ohne Preisfreigabe kein Versand (Invariante 7)'
        using errcode = 'CSE03',
              detail = 'freigegeben_von/freigegeben_am sind leer — den Preis hat '
                       || 'niemand verantwortet.',
              hint = 'Erst die Preisfreigabe (.../freigabe, Recht '
                     || 'angebot.preis_freigeben), dann der Versand.';
    end if;
    -- V-130: ein zurueckgezogener Entwurf ist eine Entscheidung.
    if old.status = 'zurueckgezogen' then
      raise exception 'Ein zurueckgezogenes Angebot geht nicht hinaus'
        using errcode = 'CSE03',
              detail = 'Der Entwurf wurde zurueckgezogen (V-130).',
              hint = 'Ein neues Angebot anlegen — der Rueckzug bleibt als Vermerk stehen.';
    end if;
    -- V-130: ein Vertragsangebot ueber nichts ist keines.
    if not exists (select 1 from public.angebotsposition p
                    where p.angebot_id = new.id and p.typ = 'leistung'
                      and p.entfernt_am is null) then
      raise exception 'Angebot ohne Leistungsposition geht nicht hinaus'
        using errcode = 'CSE03',
              detail = 'Alle Leistungspositionen sind entfernt (V-130).',
              hint = 'Mindestens eine Position anlegen.';
    end if;
    -- 0024: offene Kalkulationswerte (O-16).
    if exists (select 1 from public.kalkulation_platzhalter kp
                where kp.angebot_id = new.id) then
      raise exception 'Kalkulation enthaelt unbestaetigte Werte — Versand nicht moeglich'
        using errcode = 'CSE01',
              detail = 'Offene Werte: Stundenverrechnungssatz, Gemeinkostenbasis, '
                       || 'Gemeinkosten- und Wagnis-/Gewinnzuschlag (O-16).',
              hint = 'Werte bestaetigen oder die Kalkulation vom Angebot loesen.';
    end if;
  end if;
  return new;
end $$;

/**
 * **Ein zurückgezogener Entwurf bleibt zurückgezogen.**
 *
 * Ohne diese Prüfung liesse sich der Zustand einfach zurückstellen, und der
 * Rückzug wäre ein Vermerk, den man wegklicken kann. Er ist aber die
 * Entscheidung, dass dieses Blatt nicht mehr verfolgt wird — wer es doch
 * will, legt ein neues an. Der Weg heraus führt deshalb nirgendwohin ausser
 * in die Archivierung.
 */
create function kern.angebot_rueckzug_bleibt() returns trigger
language plpgsql as $$
begin
  if old.status = 'zurueckgezogen' and new.status <> 'zurueckgezogen' then
    raise exception 'Ein zurueckgezogenes Angebot wird nicht wiederbelebt'
      using errcode = 'check_violation',
            hint = 'Ein neues Angebot anlegen; der Rueckzug bleibt als Vermerk stehen.';
  end if;
  return new;
end $$;

-- Vor `angebot_10_versand_pruefen`: der Rückzug ist die ältere Aussage.
create trigger angebot_05_rueckzug before update on angebot
  for each row execute function kern.angebot_rueckzug_bleibt();

comment on function kern.angebot_rueckzug_bleibt() is
  'V-130: `zurueckgezogen` ist eine Entscheidung, kein Zwischenstand.';
