import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { haeltRechte } from '@/app/portal/rechte';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/objekte/[id]/raumbuch/import` — hochladen und VORSCHAU
 * (OPS-04).
 *
 * Die Seite hat zwei Zustaende und keinen dritten: ohne `?import=` das
 * Formular, mit `?import=` die Vorschau samt Uebernahmeknopf. Beides auf
 * einer Adresse, weil es ein Vorgang ist — und weil ein Formular, das direkt
 * uebernimmt, die Zusage dieser Phase nicht haette.
 */
export const dynamic = 'force-dynamic';

const AKTIONSPILLE: Readonly<Record<string, PillZustand>> = {
  anlegen: 'Bereit',
  aktualisieren: 'In Prüfung',
  unveraendert: 'Abgeschlossen',
  ignorieren: 'Fehler',
};

interface ImportKopf {
  readonly id: string;
  readonly dateiname: string;
  readonly status: string;
  readonly zeilen_gesamt: number;
  readonly zeilen_gueltig: number;
  readonly zeilen_fehler: number;
}

interface ZeileAnzeige {
  readonly id: string;
  readonly zeilennummer: number;
  readonly etage: string | null;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly flaeche_qm: string | null;
  readonly belagsart_code: string | null;
  readonly aktion: string;
  readonly fehler: readonly string[];
}

export default async function RaumbuchImport(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const importId = typeof suche['import'] === 'string' ? suche['import'] : null;

  const pfad = `/portal/${mandant}/objekte/${id}/raumbuch/import`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const darf = await haeltRechte(sitzung, 'objekt.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [objekt] = await kontext.abfrage<{ id: string; bezeichnung: string }>(
        `select id, bezeichnung from objekt where id = $1`, [id]);
      if (objekt === undefined) return null;
      if (importId === null) return { objekt, kopf: null, zeilen: [] };

      const [kopf] = await kontext.abfrage<ImportKopf>(
        `select id, dateiname, status::text as status, zeilen_gesamt, zeilen_gueltig,
                zeilen_fehler
           from raumbuch_import where id = $1 and objekt_id = $2`, [importId, id]);
      if (kopf === undefined) return { objekt, kopf: null, zeilen: [] };

      const zeilen = await kontext.abfrage<ZeileAnzeige>(
        `select id, zeilennummer, etage, raumnummer, bezeichnung, flaeche_qm::text,
                belagsart_code, aktion::text as aktion, fehler
           from raumbuch_import_zeile where import_id = $1 order by zeilennummer`,
        [importId]);
      return { objekt, kopf, zeilen };
    })) as Promise<{
      objekt: { id: string; bezeichnung: string };
      kopf: ImportKopf | null;
      zeilen: readonly ZeileAnzeige[];
    } | null>);

  if (daten === null) notFound();
  const { objekt, kopf, zeilen } = daten;
  const schonUebernommen = kopf?.status === 'uebernommen';

  return (
    <PortalRahmen
      titel={`Raumbuch-Import · ${objekt.bezeichnung}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {/*
        * Das Raumbuch dahinter öffnet mit `objekt.lesen` (Manifest); diese
        * Seite mit `objekt_import.schreiben`. Zwei Rechte aus zwei Modulen —
        * ohne das erste führte „← Raumbuch" auf 404 und verriet damit, was es
        * nicht zeigen darf (AUT-06; Copilot-Runde auf PR 16 / D-581).
        */}
      {darf['objekt.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/objekte/${id}/raumbuch`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← Raumbuch
          </Link>
        </nav>
      )}
      <h1 className="mb-s5 text-h1 text-text">Raumbuch importieren</h1>

      {kopf === null ? (
        <form
          method="post"
          action={`/api/raumbuch-import?mandant=${mandant}`}
          encType="multipart/form-data"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="objektId" value={id} />
          <p className="mt-0 text-sm text-text-muted">
            CSV mit Semikolon als Trennzeichen — so speichert Excel im deutschen
            Sprachraum. Erwartete Spalten: Etage, Raumnummer, Bezeichnung,
            Fläche, Belag, Klasse. Die Zuordnung wird vorgeschlagen und in der
            Vorschau gezeigt.
          </p>
          <p className="text-sm text-text-muted">
            <strong>Es passiert noch nichts.</strong> Der nächste Schritt ist die
            Vorschau; erst danach gibt es einen Knopf, der das Raumbuch ändert.
          </p>
          <label className="mt-s4 block text-sm text-text" htmlFor="datei">
            Datei
          </label>
          <input
            id="datei"
            type="file"
            name="datei"
            accept=".csv,text/csv,text/plain"
            required
            className="mt-s2 block min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />
          <button
            type="submit"
            data-cse="import-hochladen"
            className="mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
          >
            Datei prüfen
          </button>
        </form>
      ) : (
        <>
          <dl className="m-0 mb-s5 grid grid-cols-2 gap-s4 sm:grid-cols-4">
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Datei</dt>
              <dd className="m-0 mt-s1 text-sm text-text">{kopf.dateiname}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Zeilen</dt>
              <dd className="m-0 mt-s1 cse-zahl text-sm text-text">
                {String(kopf.zeilen_gesamt)}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Gültig</dt>
              <dd className="m-0 mt-s1 cse-zahl text-sm text-text">
                {String(kopf.zeilen_gueltig)}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Mit Fehler
              </dt>
              <dd data-cse="fehlerzahl" className="m-0 mt-s1 cse-zahl text-sm text-text">
                {String(kopf.zeilen_fehler)}
              </dd>
            </div>
          </dl>

          <DataTable
            beschriftung="Vorschau: was die Übernahme mit jeder Zeile tun würde"
            zeilen={zeilen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'nr', kopf: 'Zeile', numerisch: true,
                zelle: (z) => String(z.zeilennummer),
              },
              { schluessel: 'etage', kopf: 'Etage', zelle: (z) => z.etage ?? '—' },
              { schluessel: 'raum', kopf: 'Raum', zelle: (z) => z.raumnummer ?? '—' },
              {
                schluessel: 'bezeichnung', kopf: 'Bezeichnung',
                zelle: (z) => z.bezeichnung ?? '—',
              },
              {
                schluessel: 'flaeche', kopf: 'Fläche m²', numerisch: true,
                zelle: (z) => (z.flaeche_qm === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereMenge(mengeAusPostgresOderNull(z.flaeche_qm))),
              },
              { schluessel: 'belag', kopf: 'Belag', zelle: (z) => z.belagsart_code ?? '—' },
              {
                schluessel: 'aktion', kopf: 'Übernahme',
                zelle: (z) => (
                  <span className="inline-flex flex-col gap-s1">
                    <StatusPill zustand={AKTIONSPILLE[z.aktion] ?? 'Fehler'} />
                    {z.fehler.length === 0 ? null : (
                      <span className="text-xs text-warning">{z.fehler.join(' · ')}</span>
                    )}
                  </span>
                ),
              },
            ]}
          />

          {schonUebernommen ? (
            <p
              data-cse="import-uebernommen"
              className="mt-s5 rounded-md border border-line bg-surface p-s4 text-sm text-text-muted"
            >
              Dieser Import ist übernommen. Ein zweiter Lauf derselben Datei
              würde nichts ändern.
            </p>
          ) : (
            <form
              method="post"
              action={`/api/raumbuch-import?mandant=${mandant}&zurueck=${
                encodeURIComponent(`/portal/${mandant}/objekte/${id}/raumbuch`)}`}
              className="mt-s5"
            >
              <input type="hidden" name="aktion" value="uebernehmen" />
              <input type="hidden" name="importId" value={kopf.id} />
              <button
                type="submit"
                data-cse="import-uebernehmen"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
              >
                Übernehmen — Raumbuch ändern
              </button>
            </form>
          )}
        </>
      )}
    </PortalRahmen>
  );
}
