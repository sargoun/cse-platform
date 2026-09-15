import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { FARBEN_DRUCK, FARBEN_MARKE, MASSE_DRUCK } from '@/lib/design/theme';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/angebote/[id]/pdf` — das Angebotsdokument (OPS-08).
 *
 * **Print ist nicht die App** (DESIGN §11): weisses Blatt, `#111` Text, CSE-Rot
 * nur in der Kopflinie. Ein rot-auf-schwarzes Angebot ist auf Papier
 * unlesbar und wirkt unprofessionell.
 *
 * **Jede Gesellschaft druckt ihre EIGENE Identitaet.** Anschrift,
 * Registergericht, HRB, Geschaeftsfuehrung, Steuernummer und Bankverbindung
 * kommen aus `mandant` — nicht aus einer Konstante, denn drei Gesellschaften
 * mit einem gemeinsamen Briefkopf waeren drei falsche Briefkoepfe.
 *
 * **Warum HTML und kein erzeugtes PDF.** Ein serverseitiger PDF-Renderer ist
 * eine eigene Abhaengigkeit mit eigener Laufzeit; solange keine ist
 * eingerichtet, waere ein Knopf "PDF" ohne Datei eine vorgetaeuschte
 * Funktion. Diese Seite IST das Dokument: druckbar, A4, 20 mm Rand, und der
 * Browser macht daraus eine Datei. Sobald ein Renderer feststeht, schreibt er
 * genau dieses Layout in `dokument` und diese Seite bleibt seine Vorschau.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly einleitungstext: string | null;
  readonly schlusstext: string | null;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
  readonly versendet_am: string | null;
  readonly kunde: string;
  readonly kunde_strasse: string | null;
  readonly kunde_plz: string | null;
  readonly kunde_ort: string | null;
  readonly ansprechpartner: string | null;
  readonly objekt: string | null;
  readonly m_firma: string;
  readonly m_strasse: string | null;
  readonly m_plz: string | null;
  readonly m_ort: string | null;
  readonly m_telefon: string | null;
  readonly m_email: string | null;
  readonly m_web: string | null;
  readonly m_gericht: string | null;
  readonly m_hrb: string | null;
  readonly m_gf: string | null;
  readonly m_ustid: string | null;
  readonly m_steuernummer: string | null;
  readonly m_iban: string | null;
  readonly m_bic: string | null;
  readonly m_bank: string | null;
}

interface PositionZeile {
  readonly id: string;
  readonly position_nr: number;
  readonly typ: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly gesamtpreis_cent: string;
}

interface SteuerZeile {
  readonly steuersatz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
  readonly hinweistext: string | null;
}

export default async function Angebotsdokument(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/angebote/${id}/pdf`);
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
        `select a.angebotsnummer, a.titel, a.einleitungstext, a.schlusstext,
                a.netto_cent::text,
                to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(a.versendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY')
                  as versendet_am,
                k.name as kunde, k.strasse as kunde_strasse, k.plz as kunde_plz,
                k.ort as kunde_ort,
                nullif(trim(coalesce(ap.vorname,'') || ' ' || ap.nachname), '')
                  as ansprechpartner,
                o.bezeichnung as objekt,
                m.firma as m_firma, m.strasse as m_strasse, m.plz as m_plz, m.ort as m_ort,
                m.telefon as m_telefon, m.email as m_email, m.web as m_web,
                m.handelsregister_gericht as m_gericht, m.handelsregister_nummer as m_hrb,
                m.geschaeftsfuehrer as m_gf, m.ust_id as m_ustid,
                m.steuernummer as m_steuernummer,
                m.iban as m_iban, m.bic as m_bic, m.bank as m_bank
           from angebot a
           join kunde k on k.id = a.kunde_id
           join mandant m on m.id = a.mandant_id
           left join ansprechpartner ap on ap.id = a.ansprechpartner_id
           left join objekt o on o.id = a.objekt_id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      const positionen = await kontext.abfrage<PositionZeile>(
        `select id, position_nr, typ::text as typ, kurztext, langtext, menge::text,
                einheit, einzelpreis_cent::text, gesamtpreis_cent::text
           from angebotsposition where angebot_id = $1 order by position_nr`, [id]);
      const steuer = await kontext.abfrage<SteuerZeile>(
        `select steuersatz_bp, netto_cent::text, steuer_cent::text, hinweistext
           from angebot_steuer where angebot_id = $1 order by steuersatz_bp`, [id]);
      return { kopf, positionen, steuer };
    })) as Promise<{
      kopf: Kopf; positionen: readonly PositionZeile[]; steuer: readonly SteuerZeile[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, positionen, steuer } = daten;
  const steuerSumme = steuer.reduce((s, z) => s + BigInt(z.steuer_cent), 0n);
  const brutto = BigInt(kopf.netto_cent) + steuerSumme;

  return (
    <article data-cse="angebotsdokument" className="cse-blatt">
      {/*
        Die Druckregeln stehen als Blatt-eigene Regel und nicht in der
        globalen CSS: sie gelten fuer dieses Dokument, und ein `@page` im
        Anwendungsstil legte den Rand auch auf jede andere Seite.
      */}
      <style>{`
        .cse-blatt { background: ${FARBEN_DRUCK['druck-papier']};
                     color: ${FARBEN_DRUCK['druck-text']};
                     max-width: 210mm; margin: 0 auto; padding: 20mm;
                     font-size: 10pt; line-height: 1.5; }
        .cse-blatt table { width: 100%; border-collapse: collapse; }
        .cse-blatt th, .cse-blatt td {
                     padding: ${MASSE_DRUCK['druck-zelle-y']} ${MASSE_DRUCK['druck-zelle-x']};
                     vertical-align: top; }
        .cse-blatt thead th { border-bottom: 1px solid ${FARBEN_DRUCK['druck-text']};
                              text-align: left;
                              font-size: ${MASSE_DRUCK['druck-kopf-groesse']};
                              text-transform: uppercase;
                              letter-spacing: ${MASSE_DRUCK['druck-kopf-sperrung']}; }
        .cse-blatt tbody tr { border-bottom: 1px solid ${FARBEN_DRUCK['druck-linie-leicht']}; }
        .cse-blatt tfoot tr:last-child { border-top: 1px solid ${FARBEN_DRUCK['druck-text']};
                                         font-weight: 600; }
        .cse-blatt .zahl { text-align: right; font-variant-numeric: tabular-nums;
                           white-space: nowrap; }
        .cse-blatt .leise { color: ${FARBEN_DRUCK['druck-text-leise']};
                            font-size: ${MASSE_DRUCK['druck-meta-groesse']}; }
        .cse-blatt .kopflinie { border: 0; border-top: 3px solid ${FARBEN_MARKE.red};
                                margin: ${MASSE_DRUCK['druck-block']} 0
                                        calc(2 * ${MASSE_DRUCK['druck-block']}); }
        .cse-blatt .fuss { border-top: 1px solid ${FARBEN_DRUCK['druck-linie']};
                           margin-top: calc(2 * ${MASSE_DRUCK['druck-block']});
                           padding-top: ${MASSE_DRUCK['druck-block']};
                           font-size: ${MASSE_DRUCK['druck-kopf-groesse']};
                           color: ${FARBEN_DRUCK['druck-text-leise']}; }
        @media print {
          @page { size: A4; margin: 20mm; }
          .cse-blatt { padding: 0; max-width: none; }
          .cse-nicht-drucken { display: none; }
        }
      `}</style>

      <header>
        <p style={{ margin: 0, fontSize: '14pt', fontWeight: 600 }}>{kopf.m_firma}</p>
        <hr className="kopflinie" />
      </header>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16mm' }}>
        <address style={{ fontStyle: 'normal' }}>
          {kopf.ansprechpartner === null ? null : <>{kopf.ansprechpartner}<br /></>}
          <strong>{kopf.kunde}</strong><br />
          {kopf.kunde_strasse ?? ''}<br />
          {`${kopf.kunde_plz ?? ''} ${kopf.kunde_ort ?? ''}`}
        </address>
        <dl style={{ margin: 0, minWidth: '55mm' }}>
          <div>
            <dt style={{ display: 'inline' }}>Angebot </dt>
            <dd style={{ display: 'inline', margin: 0, fontWeight: 600 }}>
              {kopf.angebotsnummer ?? 'Entwurf'}
            </dd>
          </div>
          <div>
            <dt style={{ display: 'inline' }}>Datum </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{kopf.versendet_am ?? '—'}</dd>
          </div>
          {kopf.gueltig_bis === null ? null : (
            <div>
              <dt style={{ display: 'inline' }}>Bindefrist </dt>
              <dd style={{ display: 'inline', margin: 0 }}>{kopf.gueltig_bis}</dd>
            </div>
          )}
          {kopf.objekt === null ? null : (
            <div>
              <dt style={{ display: 'inline' }}>Objekt </dt>
              <dd style={{ display: 'inline', margin: 0 }}>{kopf.objekt}</dd>
            </div>
          )}
        </dl>
      </div>

      <h1 style={{ fontSize: '13pt', marginTop: '12mm' }}>{kopf.titel}</h1>
      {kopf.einleitungstext === null ? null : <p>{kopf.einleitungstext}</p>}

      <table>
        <caption className="sr-only">Positionen des Angebots</caption>
        <thead>
          <tr>
            <th scope="col">Pos.</th>
            <th scope="col">Leistung</th>
            <th scope="col" className="zahl">Menge</th>
            <th scope="col" className="zahl">Einzelpreis</th>
            <th scope="col" className="zahl">Gesamt</th>
          </tr>
        </thead>
        <tbody>
          {positionen.map((p) => (
            <tr key={p.id}>
              <td className="zahl">{String(p.position_nr)}</td>
              <td>
                {p.kurztext}
                {p.langtext === null ? null : (
                  <span className="leise" style={{ display: 'block' }}>{p.langtext}</span>
                )}
              </td>
              <td className="zahl">
                {p.menge === null
                  ? '—'
                  : `${formatiereMenge(mengeAusPostgresOderNull(p.menge))} ${p.einheit ?? ''}`}
              </td>
              <td className="zahl">
                {p.einzelpreis_cent === null
                  ? '—'
                  : formatiereGeld(cent(BigInt(p.einzelpreis_cent)))}
              </td>
              <td className="zahl">{formatiereGeld(cent(BigInt(p.gesamtpreis_cent)))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="zahl">Netto</td>
            <td className="zahl">{formatiereGeld(cent(BigInt(kopf.netto_cent)))}</td>
          </tr>
          {steuer.map((z) => (
            <tr key={z.steuersatz_bp}>
              <td colSpan={4} className="zahl">
                {`Umsatzsteuer ${(z.steuersatz_bp / 100).toLocaleString('de-DE')} %`}
              </td>
              <td className="zahl">{formatiereGeld(cent(BigInt(z.steuer_cent)))}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} className="zahl">Gesamt</td>
            <td data-cse="brutto" className="zahl">{formatiereGeld(cent(brutto))}</td>
          </tr>
        </tfoot>
      </table>

      {steuer.filter((z) => z.hinweistext !== null).map((z) => (
        <p key={z.steuersatz_bp} style={{ fontSize: '8.5pt' }}>{z.hinweistext}</p>
      ))}
      {kopf.schlusstext === null ? null : <p>{kopf.schlusstext}</p>}

      <footer className="fuss">
        <p style={{ margin: 0 }}>
          {[kopf.m_firma,
            `${kopf.m_strasse ?? ''}, ${kopf.m_plz ?? ''} ${kopf.m_ort ?? ''}`,
            kopf.m_telefon, kopf.m_email, kopf.m_web]
            .filter((x) => x !== null && x !== '').join(' · ')}
        </p>
        <p style={{ margin: 0 }}>
          {[kopf.m_gericht === null ? null : `${kopf.m_gericht} ${kopf.m_hrb ?? ''}`,
            kopf.m_gf === null ? null : `Geschäftsführung: ${kopf.m_gf}`,
            kopf.m_ustid === null ? null : `USt-IdNr. ${kopf.m_ustid}`,
            kopf.m_steuernummer === null ? null : `Steuernummer ${kopf.m_steuernummer}`]
            .filter((x) => x !== null).join(' · ')}
        </p>
        {kopf.m_iban === null ? null : (
          <p style={{ margin: 0 }}>
            {[kopf.m_bank, `IBAN ${kopf.m_iban}`, kopf.m_bic === null ? null : `BIC ${kopf.m_bic}`]
              .filter((x) => x !== null).join(' · ')}
          </p>
        )}
      </footer>
    </article>
  );
}
