import 'server-only';
import { headers } from 'next/headers';
import { kanonischeBasis } from '@/lib/domains';
import { ladeSeite, pruefeSeite, type Seite } from '@/server/services/inhalt/seite';
import { faqAus, leistungenAus, breadcrumb, faqPage, localBusiness, organisation, seitenService, services, webSite }
  from '@/server/services/inhalt/jsonld';
import type { BereichsQuelle } from '@/server/services/inhalt/jsonld';
import type { NapQuelle } from '@/server/services/inhalt/nap';
import { bereicheLesen, einstellungLesen, oeffentlichLesen, type BereichZeile } from '@/server/inhalt/lesen';
import { BCP47, SPRACHEN, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/** Die Basis der Anfrage — bis O-08 entschieden ist, ist sie der Host. */
export async function basisAusAnfrage(): Promise<string> {
  const kopf = await headers();
  return kanonischeBasis(kopf.get('host'));
}

/** Eine halbe Anschrift ist keine — `napAus()` wuerde ohnehin werfen. */
function istNapQuelle(wert: unknown): wert is NapQuelle {
  if (typeof wert !== 'object' || wert === null) return false;
  const w = wert as Record<string, unknown>;
  return (['firma', 'strasse', 'plz', 'ort', 'telefon', 'land'] as const)
    .every((k) => typeof w[k] === 'string' && (w[k] as string) !== '');
}

function alsBereichsQuelle(z: BereichZeile): BereichsQuelle {
  return {
    slug: z.slug,
    mandant: {
      firma: z.firma, strasse: z.strasse, plz: z.plz, ort: z.ort, land: z.land,
      telefon: z.telefon, email: z.email,
    },
  };
}

/**
 * Ist das eine Leistungsseite unter `/leistungen/<slug>` (PUB-07)?
 *
 * Die Form ist dieselbe, die `seite.pfad` per `CHECK` erlaubt; das `en`-Praefix
 * gehoert dazu, weil die englische Fassung eine EIGENE `seite`-Zeile ist
 * (D-82) und denselben Block bekommen soll.
 */
export function istLeistungsseite(pfad: string): boolean {
  return /^\/(?:en\/)?leistungen\/[a-z0-9-]+$/u.test(pfad);
}

export interface SeitenDaten {
  readonly seite: Seite;
  readonly bereiche: readonly BereichZeile[];
  readonly basis: string;
  readonly jsonLd: readonly Record<string, unknown>[];
  /** Der Auftrittsname aus `plattform_einstellung` — fuer die Marke im Helden der Startseite. */
  readonly gruppeName: string;
}

/**
 * Alles, was eine oeffentliche Seite braucht — in EINER Transaktion.
 *
 * Der JSON-LD-Aufbau steht hier und nicht in der Seitenkomponente, weil sonst
 * jede neue Seite ihn neu zusammensetzt und die vierte ihn vergisst. Welche
 * Bloecke entstehen, haengt allein davon ab, was gepflegt ist: kein `Service`
 * ohne Leistungen, keine `FAQPage` ohne Fragen.
 */
export async function seitenDaten(
  pfad: string, sprache: Sprache = VORGABE_SPRACHE,
): Promise<SeitenDaten | null> {
  const basis = await basisAusAnfrage();

  const ergebnis = await oeffentlichLesen(async (kontext) => {
    const seite = await ladeSeite(
      { unsafe: (s, w) => kontext.abfrage(s, w) }, pfad, sprache,
    );
    if (seite === null) return null;
    const bereiche = await bereicheLesen(kontext, sprache);
    const gruppeName = await einstellungLesen(kontext, 'website.gruppenname');
    const gruppeNap = await einstellungLesen(kontext, 'website.rechtstraeger');
    /*
     * **Wem gehoert die Leistungsseite?** Nur fuer `/leistungen/<slug>`
     * gefragt: eine Abfrage auf JEDER oeffentlichen Seite waere dreizehn
     * Abfragen fuer einen Block, den zwölf davon nicht haben. `null` heisst
     * „der Gruppe" — und dann bleibt `Service.provider` weg (O-652).
     */
    const besitzer = istLeistungsseite(pfad)
      ? (await kontext.abfrage<{ slug: string | null }>(
        `select m.slug from seite s
           left join mandant m on m.id = s.mandant_id and m.archiviert_am is null
          where s.pfad = $1 and s.sprache = $2
            and s.status = 'veroeffentlicht' and s.geloescht_am is null`,
        [pfad, sprache],
      ))[0]?.slug ?? null
      : null;
    return { seite, bereiche, gruppeName, gruppeNap, besitzer };
  });
  if (ergebnis === null) return null;

  const { seite, bereiche, gruppeName, gruppeNap, besitzer } = ergebnis;
  pruefeSeite(seite);

  const quellen = bereiche.map(alsBereichsQuelle);
  const jsonLd: Record<string, unknown>[] = [];

  const eigener = quellen.find((q) => `/unternehmen/${q.slug}` === pfad);
  if (eigener === undefined) {
    // Gruppenseite. Auf der Startseite steht die Organisation, sonst nur die
    // Brotkrume — `Organization` auf jeder Unterseite zu wiederholen sagt der
    // Suchmaschine nichts Neues und verwaessert den einen `@id`.
    if (pfad === '/') {
      if (typeof gruppeName === 'string' && gruppeName !== '') {
        jsonLd.push(webSite(gruppeName, basis, SPRACHEN.map((s) => BCP47[s])));
      }
      // Ein `Organization`-Block entsteht nur, wenn die Gruppe als
      // Rechtstraeger gepflegt ist (O-206). Vier vollstaendige
      // `LocalBusiness`-Eintraege sind korrekt; ein erfundenes Dach nicht.
      const nap = istNapQuelle(gruppeNap) ? gruppeNap : null;
      if (nap !== null) jsonLd.push(organisation(nap, basis, quellen));
      for (const q of quellen) jsonLd.push(localBusiness(q, basis));
    } else {
      jsonLd.push(breadcrumb(basis, [
        { name: 'Start', pfad: '/' }, { name: seite.titel, pfad },
      ]));
      /*
       * **Die Leistungsseite bekommt ihren `Service`-Block — hier und nicht
       * in der Seitenkomponente.** Sonst setzte ihn jede neue Seite neu
       * zusammen, und die vierte vergaesse ihn (siehe die Begruendung oben).
       * `provider` steht nur da, wo die Gesellschaft bekannt ist (O-652).
       */
      if (istLeistungsseite(pfad)) {
        jsonLd.push(seitenService(seite.titel, seite.beschreibung, basis, besitzer));
      }
    }
  } else {
    jsonLd.push(localBusiness(eigener, basis));
    const leistungen = seite.abschnitte.flatMap((a) => leistungenAus(a.daten));
    const dienste = services(eigener, basis, leistungen);
    if (dienste !== null) jsonLd.push(...dienste);
    const fragen = seite.abschnitte.flatMap((a) => faqAus(a.daten));
    const faq = faqPage(fragen);
    if (faq !== null) jsonLd.push(faq);
  }

  return {
    seite, bereiche, basis, jsonLd,
    gruppeName: typeof gruppeName === 'string' ? gruppeName : '',
  };
}

/** Die Kurztexte der Markenkarten — aus `unternehmensprofil`, sonst leer. */
export function ansprueche(bereiche: readonly BereichZeile[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    bereiche
      .filter((b) => b.kurzbeschreibung !== null)
      .map((b) => [b.slug, b.kurzbeschreibung as string]),
  );
}
