import { beforeAll, describe, expect, it } from 'vitest';
import { eigeneDatenbank } from './eigene-datenbank.js';
const { sql, baueAuf } = eigeneDatenbank('cse_profil');
import { withOeffentlich } from '../../src/server/kontext/oeffentlich.js';
import { jcsDigest } from '../../src/server/services/freigabe/kette.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import { ReferenzAusTabelle } from '../../src/server/services/inhalt/referenz.js';
import { galerieDerGesellschaft } from '../../src/server/services/inhalt/galerie.js';
import {
  neuigkeitenDerGruppe, oeffentlicheNeuigkeiten, oeffentlicherBeitragNachSlug,
} from '../../src/server/services/social/dienst.js';

/**
 * Die Leser hinter den Profil-Unterseiten (SEITENKARTE §2.2).
 *
 * **Der Satz, den diese Datei beweist:** was auf einer öffentlichen
 * Gesellschaftsseite steht, ist freigegeben, veröffentlicht und gehört DIESER
 * Gesellschaft — und was das nicht ist, kommt auch dann nicht heraus, wenn man
 * seine Adresse kennt.
 *
 * **Warum das nicht die Policy allein erledigt.** Sie erledigt es, und das ist
 * der Punkt: diese Fälle prüfen, dass der DIENST dieselbe Grenze zieht. Eine
 * Policy schützt gegen den Weg, den sie kennt; ein Dienst, der eine Bedingung
 * vergisst, macht daraus eine Liste, die zufällig noch stimmt — bis jemand
 * einen zweiten Weg baut.
 */

/**
 * **Der ECHTE Seed, auf einer eigenen Datenbank.**
 *
 * Der öffentliche Lesekontext (`withOeffentlich`) verlangt den
 * Website-Renderer aus `plattform_einstellung` — ohne ihn läse die Seite null
 * Gesellschaften und lieferte einen leeren Auftritt aus. Die schlanke
 * Harness-Fixtur legt ihn nicht an; der Seed tut es. Der Inhaltsimport gehört
 * dazu, weil `/unternehmen/<bereich>` seine Abschnitte aus `seite` liest.
 *
 * Warum eine eigene Datenbank und nicht die geteilte: dieselbe Begründung wie
 * in `oeffentlich.test.ts` — der Seed legt Menschen an, die die Fixtur einer
 * anderen Datei schon angelegt hat, und EMP-14 lässt genau einen Zugang je
 * Person zu.
 */
let f: { reinigung: string; security: string; bau: string };

beforeAll(async () => {
  baueAuf({ inhalt: true });
  const zeilen = await sql<{ slug: string; id: string }[]>`
    select slug, id from mandant where slug in ('reinigung','security','bau')`;
  const nach = (s: string) => zeilen.find((z) => z.slug === s)!.id;
  f = { reinigung: nach('reinigung'), security: nach('security'), bau: nach('bau') };

  /*
   * **Die Fälle legen sich ihre Zeilen selbst hin.**
   *
   * Referenzen, Beiträge und Galeriebilder gibt es im Seed nur mit
   * `CSE_DEV_FLAECHEN=1` — das ist richtig so (ohne die Flagge legt der Seed
   * die Struktur an, nicht den Demobetrieb). Ein Fall, der davon abhängt,
   * prüft in Wahrheit, ob eine Umgebungsvariable gesetzt war, und ist ohne sie
   * grün, weil er nichts findet, woran er scheitern kann.
   */
  await sql.unsafe(
    `insert into referenz (mandant_id, titel, slug, beschreibung, jahr, status,
                           freigegeben_vom_kunden, freigabe_am)
     values ($1::uuid, 'Reinigung Probeobjekt', 'reinigung-probeobjekt', 'Text', 2025,
             'veroeffentlicht', true, now()),
            ($2::uuid, 'Bau Probeobjekt', 'bau-probeobjekt', 'Text', 2024,
             'veroeffentlicht', true, now())`,
    [f.reinigung, f.bau]);

  for (const [mandantId, titel, slug, art] of [
    [f.reinigung, 'Eine Meldung', 'eine-meldung', 'neuigkeit'],
    [f.reinigung, 'Eine Projektschau', 'eine-projektschau', 'projektschau'],
    [f.bau, 'Meldung der Bau', 'meldung-der-bau', 'aktualisierung'],
  ] as const) {
    await legeBeitragAn(mandantId, titel, slug, art);
  }

  await sql.unsafe(
    `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter, galerie_rang)
     values ($1::uuid, '/bilder/reinigung.jpg', 'Heller Innenraum', true, 0)`,
    [f.reinigung]);
}, 180_000);

/**
 * Ein veröffentlichter Beitrag auf dem Weg, den der Betrieb geht: erst die
 * genehmigte Freigabe, dann der Beitrag, und der Insert in einer Sitzung, die
 * den Mandanten gebunden hat (sonst sieht der Definer die Freigabe nicht).
 */
async function legeBeitragAn(
  mandantId: string, titel: string, slug: string, art: string,
): Promise<string> {
  const nutzlast = { titel, text: 'Text' };
  const [entscheider] = await sql<{ id: string }[]>`
    select id from benutzer where status = 'aktiv' order by email limit 1`;
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                           zusammenfassung, risiko, vorschau_payload, payload_hash,
                           freigegeben_von, freigegeben_am, bezug_typ)
     values ($1::uuid, 'social_veroeffentlichen', 'genehmigt', 'beitrag_veroeffentlichen',
             $2, $2, 'mittel', $3::jsonb, $4, $5::uuid, now(), 'beitrag')
     returning id`,
    [mandantId, `Beitrag: ${titel}`, JSON.stringify(nutzlast), jcsDigest(nutzlast),
     entscheider!.id]);
  await sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [mandantId]);
    await tx.unsafe(
      `insert into beitrag (mandant_id, titel, text, slug, art, status,
                            freigabe_id, veroeffentlicht_am)
       values ($1::uuid, $2, 'Text', $3, $4::beitrag_art, 'veroeffentlicht',
               $5::uuid, now())`,
      [mandantId, titel, slug, art, fr!.id]);
  });
  return slug;
}

/** Der Kontext so, wie ihn eine oeffentliche Seite bekommt — ohne Sitzung. */
async function oeffentlich<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin((tx) => withOeffentlich(tx, fn)) as Promise<T>;
}

function quelle(kontext: LeseKontext) {
  return new ReferenzAusTabelle({ unsafe: (s, w) => kontext.abfrage(s, w) });
}

describe('§1 Projekte — nur mit Kundenfreigabe', () => {
  it('die Liste zeigt ausschliesslich freigegebene, veroeffentlichte Referenzen', async () => {
    const zeilen = await oeffentlich((k) => quelle(k).fuerMandant(f.reinigung));
    expect(zeilen.length).toBeGreaterThan(0);
    for (const r of zeilen) expect(r.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
  });

  it('eine Referenz OHNE Kundenfreigabe erscheint weder in der Liste noch unter ihrer Adresse', async () => {
    await sql.unsafe(
      `insert into referenz (mandant_id, titel, slug, status, freigegeben_vom_kunden)
       values ($1::uuid, 'Ohne Zustimmung', 'ohne-zustimmung', 'veroeffentlicht', false)`,
      [f.reinigung]);

    const liste = await oeffentlich((k) => quelle(k).fuerMandant(f.reinigung));
    expect(liste.map((r) => r.slug)).not.toContain('ohne-zustimmung');

    /*
     * **Der eigentliche Fall.** Die Liste zu filtern ist leicht; die
     * Detailseite ist die gefährlichere Stelle, weil ihre Adresse rät- oder
     * ratbar ist. `null` heisst dort „gibt es nicht ODER nicht freigegeben" —
     * absichtlich ununterscheidbar.
     */
    const einzeln = await oeffentlich((k) => quelle(k).nachSlug(f.reinigung, 'ohne-zustimmung'));
    expect(einzeln).toBeNull();
  });

  it('eine freigegebene Referenz einer ANDEREN Gesellschaft kommt hier nicht heraus', async () => {
    const bau = await oeffentlich((k) => quelle(k).fuerMandant(f.bau));
    const einer = bau[0];
    expect(einer, 'die Bau-Gesellschaft braucht eine Referenz für diesen Fall').toBeDefined();
    const quer = await oeffentlich((k) => quelle(k).nachSlug(f.reinigung, einer!.slug));
    expect(quer).toBeNull();
  });

  it('die Gruppenliste traegt je Zeile ihre Gesellschaft mit', async () => {
    const alle = await oeffentlich((k) => quelle(k).fuerGruppe());
    expect(alle.length).toBeGreaterThan(1);
    for (const r of alle) {
      expect(r.bereichSlug, r.titel).toMatch(/^(reinigung|security|bau|operations)$/u);
      expect(r.bereichName.length).toBeGreaterThan(0);
    }
    /* Der Beweis, dass es wirklich über Gesellschaften geht und nicht eine ist. */
    expect(new Set(alle.map((r) => r.bereichSlug)).size).toBeGreaterThan(1);
  });
});

describe('§2 Beiträge — veroeffentlicht, nicht zurueckgezogen, diese Gesellschaft', () => {
  it('die Neuigkeitenliste zeigt nur die ankuendigenden Arten', async () => {
    const zeilen = await oeffentlich((k) => oeffentlicheNeuigkeiten(k, f.reinigung));
    for (const b of zeilen) expect(['neuigkeit', 'aktualisierung']).toContain(b.art);
  });

  it('ein Entwurf kommt unter seiner Adresse nicht heraus', async () => {
    await sql.unsafe(
      `insert into beitrag (mandant_id, titel, text, slug, art, status)
       values ($1::uuid, 'Noch nicht freigegeben', 'Text', 'noch-nicht-freigegeben',
               'neuigkeit', 'entwurf')`,
      [f.reinigung]);
    const b = await oeffentlich((k) =>
      oeffentlicherBeitragNachSlug(k, f.reinigung, 'noch-nicht-freigegeben'));
    expect(b).toBeNull();
  });

  it('ein ZURUECKGEZOGENER Beitrag verschwindet auch aus der Detailadresse', async () => {
    /*
     * Er wird erst veröffentlicht — mit Freigabe, denselben Weg wie oben —
     * und DANN zurückgezogen. Ihn gleich zurückgezogen einzufügen prüfte
     * einen Zustand, den der Betrieb nie erzeugt.
     */
    const slug = await legeBeitragAn(f.reinigung, 'Wieder eingezogen',
      'wieder-eingezogen', 'neuigkeit');
    await sql.unsafe(
      `update beitrag set zurueckgezogen_am = now(), zurueckgezogen_grund = 'Probe'
        where mandant_id = $1::uuid and slug = $2`,
      [f.reinigung, slug]);

    const b = await oeffentlich((k) =>
      oeffentlicherBeitragNachSlug(k, f.reinigung, slug));
    expect(b).toBeNull();
  });

  it('die Gruppenliste nennt je Meldung ihre Gesellschaft — fuer die kanonische Adresse', async () => {
    const alle = await oeffentlich((k) => neuigkeitenDerGruppe(k));
    for (const b of alle) {
      expect(b.bereichSlug.length, b.titel).toBeGreaterThan(0);
      expect(b.slug, b.titel).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
    }
  });
});

describe('§3 Galerie — nur was ausdruecklich darin steht', () => {
  it('zeigt die Bilder mit Rang, und zwar nur die dieser Gesellschaft', async () => {
    const bilder = await oeffentlich((k) => galerieDerGesellschaft(k, f.reinigung));
    expect(bilder.length).toBeGreaterThan(0);
    for (const b of bilder) expect(b.alt.length).toBeGreaterThan(2);
  });

  it('ein Bild OHNE Rang bleibt draussen — auch wenn es der Gesellschaft gehoert', async () => {
    /*
     * Der Fall, um den es wirklich geht: `t_medien_oeffentlich` liest `medien`
     * mit `using (true)`. Jedes hochgeladene Bild — der Schnappschuss aus dem
     * Wachbuch, der Scan eines Belegs — ist öffentlich LESBAR. Nur der Rang
     * entscheidet, ob es öffentlich GEZEIGT wird.
     */
    await sql.unsafe(
      `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter)
       values ($1::uuid, '/bilder/wachbuch-schnappschuss.jpg', 'Nicht fuer die Galerie', true)`,
      [f.reinigung]);
    const bilder = await oeffentlich((k) => galerieDerGesellschaft(k, f.reinigung));
    expect(bilder.map((b) => b.pfad)).not.toContain('/bilder/wachbuch-schnappschuss.jpg');
  });

  it('haelt die Reihenfolge des Rangs', async () => {
    await sql.unsafe(
      `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter, galerie_rang)
       values ($1::uuid, '/bilder/zweites.jpg', 'Zweites Motiv', true, 5),
              ($1::uuid, '/bilder/erstes.jpg',  'Erstes Motiv',  true, 1)`,
      [f.security]);
    const bilder = await oeffentlich((k) => galerieDerGesellschaft(k, f.security));
    const raenge = bilder.map((b) => b.rang);
    expect(raenge).toEqual([...raenge].sort((a, b) => a - b));
  });
});
