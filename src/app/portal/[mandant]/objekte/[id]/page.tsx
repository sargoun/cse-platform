import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/objekte/[id]` — die Objektuebersicht (OPS-01, OPS-11).
 *
 * Die Karte fuehrt hier zehn Reiter (Raumbuch · Reviere · Posten · …). Gebaut
 * ist der, der in dieser Phase entsteht — das Raumbuch. Die uebrigen haengen
 * an Tabellen aus Phase 5 und 6; sie hier schon als Reiter zu zeigen, hiesse
 * zehn Links anzubieten, von denen neun auf dieselbe "noch nicht gebaut"-Seite
 * fuehren. Der Reiter erscheint, wenn sein Modul erscheint.
 *
 * **Die internen Notizen stehen NICHT in dieser Abfrage.** `bemerkung` und
 * `zutritt_hinweis` sind `cse_app` entzogen (K-05); sie kommen ueber
 * `app.objekt_notiz_lesen`, das Bereich und Recht selbst prueft.
 */
export const dynamic = 'force-dynamic';

interface ObjektKopf {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly etagen_anzahl: number | null;
  readonly kunde: string | null;
  readonly ansprechpartner: string | null;
  readonly flaeche: string | null;
  readonly raeume: string;
  readonly archiviert: boolean;
}

interface Notiz {
  readonly bemerkung: string | null;
  readonly zutritt_hinweis: string | null;
}

function Feld({ label, children }: {
  readonly label: string; readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 mt-s1 text-sm text-text">{children}</dd>
    </div>
  );
}

export default async function ObjektDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const pfad = `/portal/${mandant}/objekte/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<ObjektKopf>(
        `select o.id, o.objektnummer, o.bezeichnung, o.gebaeudetyp,
                o.strasse, o.hausnummer, o.adresszusatz, o.plz, o.ort, o.etagen_anzahl,
                k.name as kunde,
                nullif(trim(coalesce(ap.vorname,'') || ' ' || ap.nachname), '')
                  as ansprechpartner,
                r.flaeche::text as flaeche, coalesce(r.raeume, 0)::text as raeume,
                (o.archiviert_am is not null) as archiviert
           from objekt o
           left join kunde k on k.id = o.kunde_id
           left join ansprechpartner ap on ap.id = o.ansprechpartner_id
           left join lateral (
                  select sum(flaeche_qm) as flaeche, count(*) as raeume
                    from raum where raum.objekt_id = o.id and raum.archiviert_am is null
                ) r on true
          where o.id = $1`,
        [id],
      );
      if (kopf === undefined) return null;
      /**
       * Nur im internen Portal ueberhaupt FRAGEN.
       *
       * `app.objekt_notiz_lesen` wirft ausserhalb — richtig so, das ist die
       * K-04-Decke in der Funktion selbst. Die Portal-Decke im Tor schickt
       * eine Mitarbeitersitzung schon vorher nach `/portal/mein`, diese Seite
       * also erreicht sie nicht. Sich darauf zu VERLASSEN hiesse, die
       * Korrektheit dieser Datei an einer entfernten Weiterleitung
       * festzumachen: aendert die sich, steht hier ein 500 statt einer Seite
       * ohne Notiz. Die Bedingung steht deshalb da, wo sie gilt.
       */
      const intern = zugang.leiste.startsWith('intern');
      const [notiz] = intern
        ? await kontext.abfrage<Notiz>(
            `select bemerkung, zutritt_hinweis from app.objekt_notiz_lesen($1)`, [id],
          )
        : [];
      return { kopf, notiz: notiz ?? null };
    })) as Promise<{ kopf: ObjektKopf; notiz: Notiz | null } | null>);

  // Ein fremdes oder unbekanntes Objekt gibt dieselbe Antwort — 404, nie 403.
  if (daten === null) notFound();
  const { kopf, notiz } = daten;

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/objekte`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Objekte
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <StatusPill zustand={kopf.archiviert ? 'Archiviert' : 'Aktiv'} />
      </div>

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s5 sm:grid-cols-2 lg:grid-cols-3">
        <Feld label="Objektnummer">{kopf.objektnummer}</Feld>
        <Feld label="Anschrift">
          {`${kopf.strasse}${kopf.hausnummer === null ? '' : ` ${kopf.hausnummer}`}`}
          <br />
          {kopf.adresszusatz === null ? null : <>{kopf.adresszusatz}<br /></>}
          {`${kopf.plz} ${kopf.ort}`}
        </Feld>
        <Feld label="Gebäudetyp">
          {kopf.gebaeudetyp ?? <span className="text-text-subtle">nicht angegeben</span>}
        </Feld>
        <Feld label="Kunde">
          {kopf.kunde ?? <span className="text-text-subtle">ohne Kundenbezug</span>}
        </Feld>
        <Feld label="Ansprechpartner vor Ort">
          {kopf.ansprechpartner ?? <span className="text-text-subtle">keiner hinterlegt</span>}
        </Feld>
        <Feld label="Etagen">
          {kopf.etagen_anzahl === null
            ? <span className="text-text-subtle">nicht angegeben</span>
            : String(kopf.etagen_anzahl)}
        </Feld>
      </dl>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mt-0 text-h3 text-text">Raumbuch</h2>
        <p className="text-sm text-text-muted">
          {kopf.raeume === '0'
            ? 'Noch kein Raum erfasst — ohne Raumbuch lässt sich nichts kalkulieren.'
            : `${kopf.raeume} Räume, ${formatiereMenge(mengeAusPostgresOderNull(kopf.flaeche))} m²`}
        </p>
        <Link
          href={`/portal/${mandant}/objekte/${id}/raumbuch`}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4 text-sm text-white hover:bg-brand-hover"
        >
          Raumbuch und Kalkulation
        </Link>
      </section>

      {notiz === null || (notiz.bemerkung === null && notiz.zutritt_hinweis === null) ? null : (
        <section className="rounded-lg border border-line bg-surface-2 p-s5">
          <h2 className="mt-0 text-h3 text-text">Intern</h2>
          <p className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Nur im internen Portal sichtbar
          </p>
          {notiz.zutritt_hinweis === null ? null : (
            <p className="text-sm text-text">
              <strong>Zutritt:</strong> {notiz.zutritt_hinweis}
            </p>
          )}
          {notiz.bemerkung === null ? null : (
            <p className="text-sm text-text">{notiz.bemerkung}</p>
          )}
        </section>
      )}
    </PortalRahmen>
  );
}
