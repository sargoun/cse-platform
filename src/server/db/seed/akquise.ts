import type postgres from 'postgres';
import { bewerte } from '../../services/akquise/bewertung.js';

/**
 * Die Akquise für die Vorführung (§12).
 *
 * **Die Quellen entstehen IMMER, auch ohne Demoflagge** — dieselbe Begründung
 * wie bei den Social-Kanälen: dass es vier mögliche Recherchewege gibt und
 * keiner verbunden ist, ist kein Demodatum, sondern der Stand. Ein leerer
 * Quellenbildschirm sähe aus wie ein unfertiger Bau; vier Zeilen mit „nicht
 * verbunden" und dem Grund daneben sind die Wahrheit (O-596).
 *
 * **Die Firmen entstehen nur mit `CSE_DEV_FLAECHEN`.** Sie sind erfundene
 * Berliner Betriebe, und sie stehen hier nur, damit Liste, Sortierung und
 * Übernahme sich vorführen lassen.
 *
 * **Keine davon trägt einen Personennamen** — die Spalten dafür gibt es nicht.
 * Wer den Datensatz auf Personendaten prüft, findet keine, und das ist die
 * Aussage: Art. 14 DSGVO wird nicht durch eine Löschroutine eingehalten,
 * sondern dadurch, dass nichts entsteht, was zu löschen wäre.
 */

export interface AkquiseErgebnis {
  readonly quellen: number;
  readonly ziele: number;
  readonly laeufe: number;
  readonly uebersprungen: boolean;
}

interface QuellenVorlage {
  readonly art: 'manuell' | 'register' | 'dienstleister' | 'vergabe_radar';
  readonly bezeichnung: string;
  readonly hinweis: string;
}

const QUELLEN: readonly QuellenVorlage[] = [
  {
    art: 'manuell', bezeichnung: 'Von Hand erfasst',
    hinweis: 'Immer offen: jemand trägt eine Firma ein, die ihm begegnet ist. '
      + 'Braucht keinen Vertrag und keine Schnittstelle.',
  },
  {
    art: 'register', bezeichnung: 'Handelsregister (Gemeinsames Registerportal)',
    hinweis: 'Nicht verbunden: es ist kein Abrufvertrag hinterlegt. Der Abruf ist '
      + 'kostenpflichtig und liefert Firmendaten — offen ist O-596, ob er beauftragt wird.',
  },
  {
    art: 'dienstleister', bezeichnung: 'Firmendatenanbieter',
    hinweis: 'Nicht verbunden: es ist kein Anbieter beauftragt. Ein Vertrag müsste '
      + 'ausdrücklich abdecken, dass die Daten zur Ansprache verwendet werden dürfen '
      + '(O-596), und ein AV-Vertrag nach Art. 28 DSGVO gehört dazu.',
  },
  {
    art: 'vergabe_radar', bezeichnung: 'Vergaberadar (eigene Bekanntmachungen)',
    hinweis: 'Nicht angeschlossen: die Bekanntmachungen liest die Plattform bereits ein, '
      + 'die Übernahme in die Akquiseliste ist noch nicht verdrahtet. Sie ist der '
      + 'unauffälligste Weg — eine Bekanntmachung ist eine öffentliche Tatsache.',
  },
];

/**
 * Erfundene Berliner Betriebe, je Gewerk.
 *
 * Sie tragen ABSICHTLICH gemischte Qualität: eine ohne Branche, eine ausserhalb
 * Berlins, eine ohne jeden Erreichbarkeitsweg. Ein Datensatz, in dem jede Zeile
 * vollständig ist, führt eine Liste vor, die es so nie gibt — und verbirgt
 * genau die Fälle, an denen die Sortierung interessant wird.
 */
const FIRMEN: Readonly<Record<string, readonly {
  firmenname: string; branche: string | null; plz: string | null; ort: string | null;
  strasse?: string; website?: string; allgemeineEmail?: string; telefon?: string;
}[]>> = {
  reinigung: [
    { firmenname: 'Hausverwaltung Prenzlauer Berg GmbH', branche: 'Hausverwaltung',
      plz: '10405', ort: 'Berlin', strasse: 'Danziger Straße 12',
      website: 'https://beispiel-hausverwaltung.test', allgemeineEmail: 'info@beispiel-hausverwaltung.test',
      telefon: '030 1111111' },
    { firmenname: 'Bürohaus Spreebogen Betriebsgesellschaft', branche: 'Bürogebäude',
      plz: '10557', ort: 'Berlin', strasse: 'Alt-Moabit 90',
      allgemeineEmail: 'kontakt@beispiel-spreebogen.test' },
    { firmenname: 'Seniorenresidenz Köpenick gGmbH', branche: 'Pflegeeinrichtung',
      plz: '12555', ort: 'Berlin', telefon: '030 2222222' },
    { firmenname: 'Praxisgemeinschaft am Wasserturm', branche: 'Arztpraxis',
      plz: '14467', ort: 'Potsdam', strasse: 'Hegelallee 3' },
    { firmenname: 'Nordhandel Kontor AG', branche: null, plz: null, ort: null },
  ],
  security: [
    { firmenname: 'Messebau Westend GmbH', branche: 'Messebau und Event',
      plz: '14055', ort: 'Berlin', strasse: 'Messedamm 22', telefon: '030 3333333',
      website: 'https://beispiel-messebau.test' },
    { firmenname: 'Logistikzentrum Schönefeld Betriebs GmbH', branche: 'Logistik und Lager',
      plz: '12529', ort: 'Schönefeld', allgemeineEmail: 'zentrale@beispiel-logistik.test' },
    { firmenname: 'Konzerthaus Friedrichshain Betriebs gGmbH', branche: 'Veranstaltungsstätte',
      plz: '10243', ort: 'Berlin', strasse: 'Warschauer Straße 5' },
    { firmenname: 'Baustellenservice Marzahn GmbH', branche: 'Baustelle',
      plz: '12679', ort: 'Berlin' },
  ],
  bau: [
    { firmenname: 'Wohnbau Lichtenberg Projektentwicklung GmbH',
      branche: 'Bauträger und Projektentwicklung', plz: '10365', ort: 'Berlin',
      strasse: 'Frankfurter Allee 210', telefon: '030 4444444',
      allgemeineEmail: 'projekte@beispiel-wohnbau.test' },
    { firmenname: 'Gewerbepark Adlershof Verwaltungs GmbH', branche: 'Gewerbeimmobilien',
      plz: '12489', ort: 'Berlin', website: 'https://beispiel-gewerbepark.test' },
    { firmenname: 'Sanierungsgesellschaft Oranienburg mbH', branche: 'Sanierung und Umbau',
      plz: '16515', ort: 'Oranienburg' },
    { firmenname: 'Ladenbau Mitte GmbH', branche: 'Ladenbau', plz: '10178', ort: 'Berlin',
      strasse: 'Karl-Liebknecht-Straße 9' },
  ],
};

export async function seedAkquise(
  sql: postgres.Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<AkquiseErgebnis> {
  let quellen = 0;
  let ziele = 0;
  let laeufe = 0;
  const quellenId = new Map<string, string>();

  for (const [slug, mandantId] of ids) {
    for (const q of QUELLEN) {
      const [z] = await sql<{ id: string }[]>`
        insert into akquise_quelle (mandant_id, art, bezeichnung, verbunden, hinweis)
        values (${mandantId}, ${q.art}::akquise_quelle_art, ${q.bezeichnung}, false,
                ${q.hinweis})
        on conflict (mandant_id, art, bezeichnung) do nothing
        returning id`;
      if (z !== undefined) quellen += 1;
      if (q.art === 'manuell') {
        const [vorhanden] = await sql<{ id: string }[]>`
          select id from akquise_quelle
           where mandant_id = ${mandantId} and art = 'manuell' limit 1`;
        if (vorhanden !== undefined) quellenId.set(slug, vorhanden.id);
      }
    }

    /*
     * Der übersprungene Lauf entsteht IMMER — er ist die Vorführung der
     * Zusage, dass ein Leerlauf protokolliert wird. Ohne ihn wäre die
     * Laufliste leer, und eine leere Laufliste sieht aus, als hätte nie
     * jemand gesucht.
     */
    const [lauf] = await sql<{ id: string }[]>`
      insert into akquise_lauf (mandant_id, quelle_id, beendet_am, ergebnis, meldung,
                                gefunden, neu)
      select ${mandantId}, q.id, now(), 'uebersprungen',
             'Quelle nicht verbunden: es ist kein Abrufvertrag hinterlegt (O-596)', 0, 0
        from akquise_quelle q
       where q.mandant_id = ${mandantId} and q.art = 'register'
         and not exists (select 1 from akquise_lauf l
                          where l.mandant_id = ${mandantId} and l.quelle_id = q.id)
      returning id`;
    if (lauf !== undefined) laeufe += 1;
  }

  if (!demodaten) return { quellen, ziele, laeufe, uebersprungen: true };

  for (const [slug, mandantId] of ids) {
    for (const f of FIRMEN[slug] ?? []) {
      /*
       * Die Punktzahl kommt aus DERSELBEN Funktion wie im Betrieb, nicht aus
       * einer im Seed gewählten Zahl. Ein Demodatensatz mit hübschen Werten,
       * die die Rechnung nie erzeugt hätte, führt eine Bewertung vor, die es
       * nicht gibt.
       */
      const b = bewerte({
        firmenname: f.firmenname, branche: f.branche, plz: f.plz, ort: f.ort,
        website: f.website ?? null, allgemeineEmail: f.allgemeineEmail ?? null,
        telefon: f.telefon ?? null,
      });
      const [z] = await sql<{ id: string }[]>`
        insert into akquise_ziel
          (mandant_id, quelle_id, firmenname, branche, strasse, plz, ort, website,
           allgemeine_email, telefon, punktzahl, punktzahl_begruendung,
           passender_bereich, bedarf_vermutung, punktzahl_berechnet_am)
        values (${mandantId}, ${quellenId.get(slug) ?? null}, ${f.firmenname},
                ${f.branche}, ${f.strasse ?? null}, ${f.plz}, ${f.ort},
                ${f.website ?? null}, ${f.allgemeineEmail ?? null}, ${f.telefon ?? null},
                ${b.punktzahl}, ${b.begruendung}, ${b.passenderBereich},
                ${b.bedarfVermutung}, now())
        on conflict do nothing
        returning id`;
      if (z !== undefined) ziele += 1;
    }

    /*
     * Eine verworfene Zeile MIT Grund — damit der Filter „verworfen" nicht
     * leer ist und der Grund an einem echten Fall zu sehen ist.
     */
    await sql`
      update akquise_ziel
         set status = 'verworfen',
             verworfen_grund = 'Hat einen Rahmenvertrag bis 2028 — erneut prüfen im Herbst 2027.'
       where mandant_id = ${mandantId} and status = 'neu'
         and id = (select id from akquise_ziel
                    where mandant_id = ${mandantId} and status = 'neu'
                    order by punktzahl asc nulls first, firmenname limit 1)`;
  }

  return { quellen, ziele, laeufe, uebersprungen: false };
}
