/**
 * Die Kacheln, die es HEUTE gibt (DSH-01, DSH-02).
 *
 * **Genau so viele, wie Module gemergt sind.** Der PR-Plan nennt sieben, und
 * jede einzelne zaehlt in einer Tabelle, die existiert. Eine achte fuer
 * "offene Rechnungen" waere leicht zu schreiben und wuerde `0` anzeigen — und
 * `0` heisst in einem Dashboard "es gibt keine", nicht "das Modul kommt in
 * Phase 7". Wer die beiden verwechselt, plant auf einer Zahl, die es nicht
 * gibt.
 *
 * Spaetere PRs registrieren ihre eigenen Kacheln; das Register waechst mit den
 * Modulen und nicht vor ihnen.
 *
 * **`$1` ist immer `mandant_ids::uuid[]`.** Der Bereichsfilter aendert genau
 * dieses eine Argument — und weil dieselbe Bedingung in `zaehlung` und
 * `zeilen` steht, koennen Kachel und Liste nicht auseinanderlaufen.
 */
import { registriereKachel, type Kachel, type KachelKontext }
  from '../../registry/kennzahlen.js';

/**
 * Wohin eine Kachel fuehrt — an EINER Stelle.
 *
 * **Sie fuehrte nach `/dev/kennzahl/…`.** Das war richtig, solange es keine
 * angemeldete Portal-Shell gab, und die Datei sagte das auch: *"Wenn sie da
 * ist, aendert sich DIESE Funktion — nicht sieben Kacheln, von denen man sechs
 * findet."* Sie ist da; im angemeldeten Portal war jede Kachel bis hierher ein
 * toter Link in einen Entwicklungsbaum, den ein Deployment gar nicht ausliefert.
 *
 * Ziel ist jetzt die LISTE des Moduls aus `04-SEITENKARTE.md` — im Bereich
 * `/portal/<slug>/…`, in der Gruppenansicht `/portal/gruppe/…`. Beide Adressen
 * stehen im Manifest, tragen dasselbe Recht wie die Kachel und antworten,
 * solange ihr Modul noch gebaut wird, mit genau dieser Auskunft statt mit 404.
 */
export function kennzahlPfad(
  k: KachelKontext, imBereich: string, inDerGruppe: string,
): string {
  if (k.mandantSlug !== null) return `/portal/${k.mandantSlug}/${imBereich}`;
  // Leer heisst: die Gruppenansicht kennt keine eigene Liste dafuer. Dann ist
  // ihre Uebersicht das ehrliche Ziel — und keine erfundene Adresse.
  return inDerGruppe === '' ? '/portal/gruppe' : `/portal/gruppe/${inDerGruppe}`;
}

export function registriereBerichtKacheln(): readonly Kachel[] {
  return [
    registriereKachel({
      schluessel: 'neue_leads',
      label: 'Neue Anfragen',
      modul: 'crm',
      recht: 'crm.lesen',
      ton: 'info',
      zaehlung:
        `select count(*)::int as wert from lead
          where mandant_id = any($1) and status = 'neu' and archiviert_am is null`,
      zeilen:
        `select id, leadnummer, betreff, firma_name, sla_frist_am from lead
          where mandant_id = any($1) and status = 'neu' and archiviert_am is null
          order by erstellt_am desc`,
      ziel: (k) => kennzahlPfad(k, 'crm/leads', 'leads'),
    }),

    registriereKachel({
      schluessel: 'leads_ueber_sla',
      label: 'Frist überschritten',
      modul: 'crm',
      recht: 'crm.lesen',
      // Rot, weil es eine gebrochene Zusage ist und nicht eine Information.
      ton: 'danger',
      zaehlung:
        `select count(*)::int as wert from lead
          where mandant_id = any($1) and sla_frist_am is not null
            and erste_reaktion_am is null and archiviert_am is null
            and sla_frist_am < now()`,
      zeilen:
        `select id, leadnummer, betreff, sla_frist_am, eskalationsstufe from lead
          where mandant_id = any($1) and sla_frist_am is not null
            and erste_reaktion_am is null and archiviert_am is null
            and sla_frist_am < now()
          order by sla_frist_am`,
      ziel: (k) => kennzahlPfad(k, 'crm/leads', 'leads'),
    }),

    registriereKachel({
      schluessel: 'benutzer_aktiv',
      label: 'Aktive Benutzer',
      modul: 'system',
      recht: 'system.benutzer_lesen',
      ton: 'muted',
      zaehlung:
        `select count(distinct bm.benutzer_id)::int as wert
           from benutzer_mandant bm join benutzer b on b.id = bm.benutzer_id
          where bm.mandant_id = any($1) and bm.entzogen_am is null
            and b.status = 'aktiv' and b.deaktiviert_am is null`,
      zeilen:
        `select distinct b.id, b.name, b.email
           from benutzer_mandant bm join benutzer b on b.id = bm.benutzer_id
          where bm.mandant_id = any($1) and bm.entzogen_am is null
            and b.status = 'aktiv' and b.deaktiviert_am is null
          order by b.name`,
      ziel: (k) => kennzahlPfad(k, 'einstellungen/benutzer', ''),
    }),

    registriereKachel({
      schluessel: 'personen',
      label: 'Personen',
      modul: 'personal',
      recht: 'personal.lesen',
      ton: 'muted',
      /**
       * Ueber `anstellung` gezaehlt, nicht ueber `person` — `person` traegt
       * keinen Mandanten (D-09: der Mensch gehoert keiner Gesellschaft).
       * `distinct`, weil ein doppelt Beschaeftigter EIN Mensch ist.
       */
      zaehlung:
        `select count(distinct a.person_id)::int as wert from anstellung a
          where a.mandant_id = any($1) and a.geloescht_am is null`,
      zeilen:
        `select distinct p.id, p.vorname, p.nachname
           from anstellung a join person p on p.id = a.person_id
          where a.mandant_id = any($1) and a.geloescht_am is null
          order by p.nachname, p.vorname`,
      ziel: (k) => kennzahlPfad(k, 'personal/personen', 'personen'),
    }),

    registriereKachel({
      schluessel: 'anstellungen',
      label: 'Beschäftigungen',
      modul: 'personal',
      recht: 'personal.lesen',
      ton: 'muted',
      // Nicht dasselbe wie `personen`: EIN Mensch kann zwei Beschäftigungen
      // haben (D-09), und für die Kosten zählt die Beschäftigung.
      zaehlung:
        `select count(*)::int as wert from anstellung
          where mandant_id = any($1) and geloescht_am is null`,
      zeilen:
        `select a.id, a.person_id, a.mandant_id, a.personalnummer, a.eintritt
           from anstellung a
          where a.mandant_id = any($1) and a.geloescht_am is null
          order by a.eintritt desc`,
      ziel: (k) => kennzahlPfad(k, 'personal/anstellungen', 'personen'),
    }),

    registriereKachel({
      schluessel: 'letzte_aktivitaet',
      label: 'Aktivität (7 Tage)',
      modul: 'crm',
      recht: 'crm.lesen',
      ton: 'info',
      zaehlung:
        `select count(*)::int as wert from lead_aktivitaet
          where mandant_id = any($1) and geschehen_am > now() - interval '7 days'`,
      zeilen:
        `select id, lead_id, typ, richtung, betreff, geschehen_am from lead_aktivitaet
          where mandant_id = any($1) and geschehen_am > now() - interval '7 days'
          order by geschehen_am desc`,
      ziel: (k) => kennzahlPfad(k, 'crm/kunden', 'kunden'),
    }),

    registriereKachel({
      schluessel: 'offene_wiedervorlagen',
      label: 'Offene Wiedervorlagen',
      modul: 'crm',
      recht: 'crm.lesen',
      ton: 'warning',
      zaehlung:
        `select count(*)::int as wert from lead_aktivitaet
          where mandant_id = any($1) and faellig_am is not null and erledigt_am is null`,
      zeilen:
        `select id, lead_id, betreff, faellig_am, zustaendig_benutzer_id
           from lead_aktivitaet
          where mandant_id = any($1) and faellig_am is not null and erledigt_am is null
          order by faellig_am`,
      ziel: (k) => kennzahlPfad(k, 'crm/wiedervorlagen', 'leads'),
    }),
  ];
}
