-- 0298 — Der Lebenslauf einer Katalogfassung (OPS-06, CLN-05).

/**
 * **Der Befund.** `kern.pruefe_katalog_offen` friert die POSITIONEN eines
 * archivierten Katalogs ein — sie haengt an `leistungskatalog_position`, nicht
 * an `leistungskatalog`. Auf dem Katalogkopf selbst hing bisher nur
 * `setze_geaendert_am`, `verhindere_loeschung` und `kein_truncate`. Also:
 *
 *   archiviert → aktiv  liess sich zurueckdrehen,
 *   und danach waren die Positionen wieder aenderbar.
 *
 * Eine Oberflaeche, die „archivieren friert den Katalog ein" schreibt, hat
 * damit etwas behauptet, das die Datenbank nicht hielt — und zwar die eine
 * Aussage, auf die sich ein Preisgespraech spaeter beruft: „das stand so im
 * Katalog vom 01.01." Ein Einfrieren, das man aufheben kann, ist kein
 * Einfrieren; es ist ein Schild.
 *
 * **Was hier NICHT entsteht: eine Versionierungsregel.** Die Tabelle traegt
 * `version` (default 1), `leistungskatalog_version_uk` unique auf
 * (mandant_id, schluessel, version) und `leistungskatalog_aktiv_uk` unique auf
 * (mandant_id, schluessel) WHERE status = 'aktiv'. Daraus FOLGT der Ablauf,
 * er wird hier nicht erfunden: je Schluessel ist hoechstens eine Fassung
 * aktiv, eine zweite Fassung traegt eine hoehere Versionsnummer, und sie wird
 * aktiv, nachdem die alte archiviert ist. Diese Datei macht aus dem
 * Eindeutigkeitsverstoss nur einen BENANNTEN Fehler — `23505` mit einem
 * Indexnamen ist im Portal nicht lesbar, und der Dienst soll nicht auf
 * Indexnamen musterpruefen muessen.
 *
 * Der Uebergang bleibt an `katalog.schreiben` gebunden; das prueft das WITH
 * CHECK von `t_mandant` bereits, und hier decken sich Tor und Policy (anders
 * als bei `angebot`, `auftrag` und `dokument` in 0295 bis 0297).
 */

create or replace function kern.katalog_status_uebergang()
returns trigger language plpgsql as $$
declare
  v_andere text;
begin
  /**
   * `archiviert` ist ENDSTATION.
   *
   * Nicht aus Strenge, sondern weil `kern.pruefe_katalog_offen` daran haengt:
   * ein Rueckweg machte die eingefrorenen Positionen wieder aenderbar, und
   * dann waere „eingefroren" ein Zustand, aus dem man ohne Spur herauskommt.
   */
  if old.status = 'archiviert' and new.status is distinct from 'archiviert' then
    raise exception 'Eine archivierte Katalogfassung wird nicht wieder geoeffnet'
      using errcode = 'check_violation',
            detail  = 'Mit dem Archivieren sind die Positionen unveraenderlich '
                      || 'geworden (kern.pruefe_katalog_offen); ein Rueckweg machte sie '
                      || 'stillschweigend wieder aenderbar.',
            hint    = 'Andere Werte brauchen eine neue Fassung: gleiche schluessel, '
                      || 'hoehere version.';
  end if;

  /**
   * **Mit dem Archivieren endet die Gueltigkeit — im AUSLOESER.**
   *
   * Sie stand zuerst im Dienst (`setzeKatalogStatus`), und damit galt sie nur
   * auf einem Weg: gegen die lebende Datenbank nachgemessen blieb
   * `gueltig_bis` bei einem rohen UPDATE NULL. Eine archivierte Fassung mit
   * offener Gueltigkeit ist eine Zusage, die niemand einhalten kann — sie
   * steht in jeder Stichtagsabfrage als geltend, obwohl ihre Positionen
   * eingefroren sind.
   *
   * `greatest(...)` und nicht nur `app.berlin_heute()`: eine Fassung, die erst
   * naechsten Monat gilt und heute archiviert wird, bekaeme sonst ein
   * `gueltig_bis` VOR ihrem `gueltig_ab` — und `leistungskatalog_zeitraum_
   * stimmig` wiese sie mit einer Meldung ueber einen Zeitraum ab, von dem
   * niemand gesprochen hat.
   */
  if new.status = 'archiviert' and old.status is distinct from 'archiviert' then
    new.gueltig_bis := coalesce(
      new.gueltig_bis, greatest(app.berlin_heute(), new.gueltig_ab));
  end if;

  /**
   * Und kein Sprung `entwurf → archiviert` ueber die Aktivierung hinweg?
   *
   * Doch, der ist erlaubt — ein Entwurf, den niemand mehr braucht, wird
   * abgelegt, ohne je gegolten zu haben. Ihn zu verbieten waere eine
   * erfundene Regel und liesse nur den Weg „aktivieren, um archivieren zu
   * koennen", also einen Katalog kurz gelten zu lassen, damit man ihn
   * wegraeumen darf.
   */

  if new.status = 'aktiv' and old.status is distinct from 'aktiv' then
    /**
     * Der partielle Index faengt das ohnehin — aber mit `23505` und einem
     * Indexnamen. Hier steht, WELCHE Fassung im Weg ist.
     */
    select 'Version ' || k.version into v_andere
      from public.leistungskatalog k
     where k.mandant_id = new.mandant_id
       and k.schluessel = new.schluessel
       and k.status = 'aktiv'
       and k.id <> new.id
     limit 1;
    if v_andere is not null then
      raise exception
        'Fuer den Schluessel % gilt bereits eine aktive Fassung (%)', new.schluessel, v_andere
        using errcode = 'unique_violation',
              detail  = 'leistungskatalog_aktiv_uk laesst je Schluessel genau eine '
                        || 'aktive Fassung zu.',
              hint    = 'Zuerst die geltende Fassung archivieren, dann diese aktivieren.';
    end if;
  end if;

  return new;
end $$;

comment on function kern.katalog_status_uebergang() is
  'OPS-06, CLN-05. archiviert ist Endstation (sonst taute kern.pruefe_katalog_offen '
  'wieder auf), und der Verstoss gegen leistungskatalog_aktiv_uk wird ein benannter '
  'Fehler statt eines 23505 mit Indexnamen.';

drop trigger if exists leistungskatalog_05_status on leistungskatalog;
create trigger leistungskatalog_05_status
  before update on leistungskatalog
  for each row execute function kern.katalog_status_uebergang();

/**
 * Und beim Anlegen: kein Katalog, der als zweite aktive Fassung entsteht.
 *
 * Auch das faengt der Index — dieselbe Begruendung wie oben, dieselbe
 * Meldung. Ohne diesen Zweig traegt derselbe Vorgang zwei verschiedene
 * Fehlermeldungen, je nachdem ob er als INSERT oder als UPDATE kommt.
 */
create or replace function kern.katalog_status_beim_anlegen()
returns trigger language plpgsql as $$
declare v_andere text;
begin
  if new.status = 'aktiv' then
    select 'Version ' || k.version into v_andere
      from public.leistungskatalog k
     where k.mandant_id = new.mandant_id and k.schluessel = new.schluessel
       and k.status = 'aktiv' and k.id <> new.id
     limit 1;
    if v_andere is not null then
      raise exception
        'Fuer den Schluessel % gilt bereits eine aktive Fassung (%)', new.schluessel, v_andere
        using errcode = 'unique_violation',
              hint = 'Zuerst die geltende Fassung archivieren.';
    end if;
  end if;
  return new;
end $$;

comment on function kern.katalog_status_beim_anlegen() is
  'OPS-06. Die INSERT-Haelfte von kern.katalog_status_uebergang — damit derselbe '
  'Vorgang nicht zwei verschiedene Meldungen traegt.';

drop trigger if exists leistungskatalog_05_status_anlegen on leistungskatalog;
create trigger leistungskatalog_05_status_anlegen
  before insert on leistungskatalog
  for each row execute function kern.katalog_status_beim_anlegen();
