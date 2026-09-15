import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { pruefeRechnung, type PflichtfeldBericht } from '@/server/services/finanz/ustg14';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/pruefung` — der
 * §14-UStG-Vorabbericht (04-SEITENKARTE.md §5.14.2, FIN-04, FIN-05, FIN-13,
 * LEG-05).
 *
 * **Die Seite rechnet nichts und prueft nichts selbst.** Sie ruft
 * `services/finanz/ustg14.ts` — denselben Dienst, den die Festschreibung
 * hinter der Zeilensperre ruft und den die API-Adresse
 * `/api/rechnungen/pruefung` ausliefert. Eine Oberflaeche mit eigener
 * Regelliste waere die zweite Liste, und die zweite ist die, die veraltet:
 * ein Feld, das hier gruen erscheint und dort blockiert, schickt jemanden auf
 * die Suche nach einem Fehler, den es nicht gibt.
 *
 * **Alles auf einmal, nicht das erste Problem.** §6 verlangt „returns every
 * missing field at once": wer zehnmal hintereinander auf „Festschreiben"
 * drueckt und jedes Mal EIN fehlendes Feld genannt bekommt, gibt beim vierten
 * Mal auf.
 *
 * **Warnungen blockieren nicht, und die Seite sagt das.** Eine Warnung, die
 * wie ein Fehler aussieht, wird entweder ignoriert — dann sind auch die Fehler
 * Geraeusch — oder sie haelt jemanden auf, der weitergehen darf.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly brutto_cent: string;
}

function Liste(
  { titel, befunde, ton, leerText }: {
    titel: string;
    befunde: PflichtfeldBericht['fehler'];
    ton: 'fehler' | 'warnung';
    leerText: string;
  },
) {
  return (
    <section className="mb-s5">
      <h2 className="mb-s3 text-h3 text-text">{titel}</h2>
      {befunde.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {leerText}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-s3 p-0">
          {befunde.map((b, i) => (
            <li
              key={`${b.feld}-${String(i)}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <p className="m-0 flex flex-wrap items-baseline gap-s3">
                <span
                  className={`text-sm font-semibold ${
                    ton === 'fehler' ? 'text-danger' : 'text-warning'}`}
                >
                  {b.feld}
                </span>
                <span className="text-xs text-text-muted">{b.regel}</span>
              </p>
              <p className="m-0 mt-s2 max-w-prose text-sm text-text">{b.textDe}</p>
              {b.link === null ? null : (
                <p className="m-0 mt-s2">
                  <Link
                    href={{ pathname: b.link }}
                    className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
                  >
                    Dort beheben →
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function Pruefblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(
    `/portal/${mandant}/finanzen/rechnungen/${id}/pruefung`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart, r.brutto_cent::text
           from rechnung r where r.id = $1`, [id]);
      if (kopf === undefined) return { kopf: null, bericht: null };
      return { kopf, bericht: await pruefeRechnung(kontext, id) };
    })) as Promise<{ kopf: Kopf | null; bericht: PflichtfeldBericht | null }>);

  const k = daten.kopf;
  const bericht = daten.bericht;
  if (k === null || bericht === null) notFound();

  const blockierend = bericht.fehler.length > 0;
  const festgeschrieben = k.status === 'festgeschrieben';

  return (
    <PortalRahmen
      titel="§14-UStG-Prüfung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {k.nummer ?? 'Entwurf ohne Nummer'}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">Pflichtangaben nach §14 UStG</h1>

      <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text">
        {festgeschrieben
          ? 'Dieser Beleg ist festgeschrieben. Der Bericht unten ist die heutige '
            + 'Sicht auf die gedruckten Angaben; der Befund, mit dem festgeschrieben '
            + 'wurde, steht unveränderlich im Snapshot.'
          : blockierend
            ? `Die Festschreibung ist blockiert: ${String(bericht.fehler.length)} `
              + 'Pflichtangabe(n) fehlen. Alle fehlenden Felder stehen unten — nicht '
              + 'nur das erste.'
            : 'Alle geprüften Pflichtangaben liegen vor. Die Festschreibung ist '
              + 'aus Sicht dieser Prüfung möglich.'}
      </p>

      <Liste
        titel="Blockierend"
        befunde={bericht.fehler}
        ton="fehler"
        leerText="Keine blockierenden Befunde."
      />

      <Liste
        titel="Warnungen — sie halten den Beleg nicht auf"
        befunde={bericht.warnungen}
        ton="warnung"
        leerText="Keine Warnungen."
      />

      <h2 className="mb-s3 text-h3 text-text">Kleinbetragsrechnung (§33 UStDV)</h2>
      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Erleichterung</dt>
          <dd className="text-sm text-text">
            {bericht.kleinbetrag.greift ? 'greift' : 'greift nicht'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Grenze</dt>
          <dd className="text-sm text-text">
            {bericht.kleinbetrag.grenzeBruttoCent === null
              ? '—'
              : formatiereGeld(bericht.kleinbetrag.grenzeBruttoCent)}
            {bericht.kleinbetrag.istPlatzhalter ? (
              <span className="text-warning"> — unbestätigter Wert (O-175)</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Brutto dieses Belegs</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.brutto_cent)))}
          </dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs text-text-muted">Begründung</dt>
          <dd className="max-w-prose text-sm text-text-muted">
            {bericht.kleinbetrag.grund}
          </dd>
        </div>
      </dl>

      <h2 className="mb-s3 text-h3 text-text">Was diese Prüfung noch nicht prüft</h2>
      <ul className="mb-s5 m-0 list-none space-y-s2 p-0">
        {bericht.nichtGeprueft.map((n) => (
          <li key={n.regel} className="rounded-lg border border-line bg-surface-2 p-s4">
            <p className="m-0 text-sm text-text">{n.regel}</p>
            <p className="m-0 mt-s1 max-w-prose text-xs text-text-muted">{n.grund}</p>
          </li>
        ))}
      </ul>

      <p className="max-w-prose text-xs text-text-muted">
        Regelwerk {bericht.regelwerkVersion}. Der vollständige Befund wird beim
        Festschreiben in den Snapshot eingefroren — damit später nachvollziehbar
        bleibt, welche Regeln auf diesen Beleg angewandt wurden.
      </p>
    </PortalRahmen>
  );
}
