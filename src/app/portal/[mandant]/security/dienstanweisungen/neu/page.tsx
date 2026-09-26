import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';

/**
 * `/portal/[mandant]/security/dienstanweisungen/neu` — Kopf und erste Fassung
 * (SEC-06, DOC-05, EMP-12).
 *
 * **Kein Feld für die Fassungsnummer und keines für den Hash.** Beides setzt
 * der Auslöser (0078 §7): die Nummer unter einer Sperre auf dem Kopf, den Hash
 * aus dem Inhalt. Ein Formularfeld dafür wäre die Einladung, etwas anderes
 * einzutragen — und der Auslöser überschriebe es ohnehin.
 *
 * **Die drei Übersetzungsfelder sind leer und bleiben es, wenn niemand sie
 * füllt** (EMP-12). Eine leere türkische Fassung anzulegen hiesse, dem
 * Telefon einer türkischsprachigen Wache eine leere Seite unter einer
 * Überschrift zu zeigen, die Bestätigung verlangt. Deshalb wird nur
 * übernommen, was wirklich dasteht.
 *
 * **„Sofort freigeben" ist ein Ankreuzfeld und keine zweite Seite.** Eine
 * Anweisung als Entwurf zu speichern und die Freigabe zu vergessen ist der
 * häufigste Weg, mit dem eine Unterweisung nie stattfindet — und der Entwurf
 * ist für die Wache unsichtbar (0078 §12).
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }
interface Postenzeile {
  readonly id: string; readonly bezeichnung: string; readonly objekt: string;
}

export default async function DienstanweisungNeu(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/security/dienstanweisungen/neu`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const vorbelegt = typeof suche['objekt'] === 'string' ? suche['objekt'] : null;
  // Der Berliner Kalendertag kommt aus der DATENBANK und nicht aus der
  // Prozessuhr: zwischen Mitternacht und 02:00 ist der UTC-Tag der gestrige.
  const heute = await berlinHeute();

  const { objekte, posten } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        objekte: await kontext.abfrage<Objektzeile>(
          `select id, bezeichnung from objekt
            where archiviert_am is null order by bezeichnung`,
        ),
        posten: await kontext.abfrage<Postenzeile>(
          `select p.id, p.bezeichnung, o.bezeichnung as objekt
             from posten p
             join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
            where p.archiviert_am is null
            order by o.bezeichnung, p.bezeichnung`,
        ),
      }))) as Promise<{
        objekte: readonly Objektzeile[]; posten: readonly Postenzeile[];
      }>);

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';
  const bereich = 'w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
    + 'text-sm text-text';

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/security/dienstanweisungen`, text: 'Dienstanweisungen' }}
      titel="Dienstanweisung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstanweisungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Dienstanweisung anlegen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Der Kopf bleibt, der Text wird versioniert. Eine Änderung ist später
        eine NEUE Fassung — sie bekommt die nächste Nummer, und wer die alte
        bestätigt hat, muss erneut bestätigen. Die alte Fassung und ihre
        Bestätigungen bleiben unverändert stehen.
      </p>

      <form
        action="/api/sicherheit/dienstanweisungen"
        method="post"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />

        <label className="mb-s4 block">
          <span className={feld}>Titel</span>
          <input
            name="titel" required maxLength={160} className={eingabe}
            placeholder="Hausordnung Werkstor Nord"
          />
        </label>

        <label className="mb-s4 block">
          <span className={feld}>Objekt</span>
          <select name="objekt" className={eingabe} defaultValue={vorbelegt ?? ''}>
            <option value="">— gesellschaftsweit —</option>
            {objekte.map((o) => (
              <option key={o.id} value={o.id}>{o.bezeichnung}</option>
            ))}
          </select>
        </label>
        <p className="mb-s4 mt-[-0.5rem] max-w-prose text-sm text-text-muted">
          Ohne Objekt gilt die Anweisung gesellschaftsweit — und ist im
          Mitarbeiterportal <strong>nicht</strong> sichtbar: die Wache sieht
          die Anweisungen der Objekte, auf denen sie eingesetzt ist (0078 §12).
        </p>

        {posten.length > 0 && (
          <label className="mb-s4 block">
            <span className={feld}>Posten (für eine Postenanweisung)</span>
            <select name="posten" className={eingabe}>
              <option value="">— keiner —</option>
              {posten.map((p) => (
                <option key={p.id} value={p.id}>{p.objekt} · {p.bezeichnung}</option>
              ))}
            </select>
          </label>
        )}

        <label className="mb-s4 block">
          <span className={feld}>Gilt ab</span>
          <input
            name="gueltig_ab" type="date" required className={eingabe}
            defaultValue={heute}
          />
        </label>

        <label className="mb-s4 block">
          <span className={feld}>Text (deutsch)</span>
          <textarea
            name="inhalt" rows={10} required className={bereich}
            placeholder="Was gilt an diesem Objekt? Vollständig, in ganzen Sätzen."
          />
        </label>

        <fieldset className="mb-s4 border-0 p-0">
          <legend className={feld}>Übersetzungen (EMP-12) — optional</legend>
          <p className="mb-s3 text-sm text-text-muted">
            Was hier leer bleibt, wird nicht angelegt. Auf dem Telefon steht
            dann die deutsche Fassung, und die Seite sagt, dass es die deutsche
            ist.
          </p>
          <label className="mb-s3 block">
            <span className={feld}>English</span>
            <textarea name="inhalt_en" rows={4} className={bereich} />
          </label>
          <label className="mb-s3 block">
            <span className={feld}>العربية</span>
            <textarea name="inhalt_ar" rows={4} dir="rtl" className={bereich} />
          </label>
          <label className="mb-s3 block">
            <span className={feld}>Türkçe</span>
            <textarea name="inhalt_tr" rows={4} className={bereich} />
          </label>
        </fieldset>

        <label className="mb-s4 block">
          <span className={feld}>Änderungshinweis</span>
          <input
            name="aenderungshinweis" maxLength={200} className={eingabe}
            placeholder="Erstfassung"
          />
        </label>

        <label className="mb-s3 flex items-center gap-s2 text-sm text-text">
          <input
            type="checkbox" name="veroeffentlichen" value="1" defaultChecked
            className="min-h-6 min-w-6"
          />
          Sofort freigeben — erst dann sieht die Wache sie
        </label>
        <label className="mb-s5 flex items-center gap-s2 text-sm text-text">
          <input type="checkbox" name="ohne_pflicht" value="1" className="min-h-6 min-w-6" />
          Ohne Kenntnisnahmepflicht (reine Information)
        </label>

        <Button type="submit" variante="primary">Anweisung anlegen</Button>
      </form>
    </PortalRahmen>
  );
}
