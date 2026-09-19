/**
 * Die ENGLISCHEN Entwurfstexte der oeffentlichen Seiten (O-207).
 *
 * **Dieselben Aussagen, andere Sprache — nichts dazu.** Eine Uebersetzung ist
 * die Gelegenheit, einen Satz "griffiger" zu machen, und genau das darf hier
 * nicht passieren: was auf der englischen Seite steht und auf der deutschen
 * nicht, hat niemand geprueft. Also keine Zahlen, keine Auszeichnungen, keine
 * Kundennamen und keine Zusagen — wie deutsch.
 *
 * **Deutsche Rechtsbegriffe bleiben stehen.** "§ 34a GewO", "VOB/B",
 * "Leistungsverzeichnis": sie zu uebersetzen wuerde sie ungenau machen. Wo es
 * hilft, steht eine kurze Erklaerung daneben — das ist eine Lesehilfe und
 * keine zweite Bedeutung.
 *
 * // TODO(client): O-207 — bitte auch die englische Fassung durchgehen. Sie
 * // ist so zurückhaltend wie die deutsche und wartet auf dieselben Angaben.
 */
import type { SeitenInhalt } from './inhalt.js';

const TRADE = {
  reinigung: 'Building cleaning',
  security: 'Security and premises protection services',
  bau: 'Structural work, fit-out, demolition',
} as const;

const service = (name: string, beschreibung: string) => ({ name, beschreibung });

export const SEITEN_EN: readonly SeitenInhalt[] = [
  {
    pfad: '/',
    beschreibung:
      'Building cleaning, security services and construction in Berlin — four '
      + 'independent companies, one point of contact.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'Four trades, one',
        text:
          'Cleaning, security and construction in Berlin. Four independent '
          + 'companies that work together when a job needs more than one trade — '
          + 'and separately when it does not.',
      },
      { art: 'markenkarten', ueberschrift: null, text: null },
      {
        art: 'text',
        ueberschrift: 'Why four companies',
        text:
          'Each trade has rules of its own: § 34a GewO for security work, the '
          + 'VOB for construction, separate pay scales and records for cleaning. '
          + 'Separate companies keep those rules cleanly apart. For you nothing '
          + 'changes: you talk to one contact, even when two divisions are '
          + 'involved.',
      },
    ],
  },
  {
    pfad: '/unternehmen',
    beschreibung: 'The four companies of the CSE group at a glance.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Companies', text:
        'Four companies, one location in Berlin.' },
      { art: 'markenkarten', ueberschrift: null, text: null },
      {
        art: 'text',
        ueberschrift: 'Independent, not separate',
        text:
          'Each company runs its own jobs, its own costing and its own '
          + 'invoicing. Where a project touches several trades, the divisions '
          + 'coordinate instead of sending you between three firms.',
      },
    ],
  },
  {
    pfad: '/leistungen',
    beschreibung: 'Cleaning, security services and construction work from Berlin.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Services', text:
        'What the four divisions offer — and which enquiry to send where.' },
      {
        art: 'leistungen',
        ueberschrift: TRADE.reinigung,
        text: null,
        daten: { leistungen: [
          service('Routine cleaning',
            'Recurring cleaning to an agreed schedule of works.'),
          service('Glass and frame cleaning',
            'Windows, façade elements and frames, inside and out.'),
          service('Post-construction cleaning',
            'The clean after building work is finished, before handover.'),
          service('One-off cleaning',
            'Single assignments by arrangement.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: TRADE.security,
        text: null,
        daten: { leistungen: [
          service('Premises protection',
            'Guarding of buildings and installations under § 34a GewO.'),
          service('Event services',
            'Admission, order and supervision at events.'),
          service('Reception services',
            'Staffing of reception and gate.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: TRADE.bau,
        text: null,
        daten: { leistungen: [
          service('Structural work', 'Shell construction to a schedule of works.'),
          service('Fit-out', 'Drywall, flooring, painting.'),
          service('Demolition',
            'Strip-out and demolition, with proof of waste disposal.'),
          service('Refurbishment', 'Repair and renewal in existing buildings.'),
        ] },
      },
    ],
  },
  {
    pfad: '/projekte',
    beschreibung: 'Completed projects of the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Projects', text: null },
      {
        art: 'text',
        ueberschrift: 'References will appear here',
        text:
          'Projects appear here once the customer concerned has agreed in '
          + 'writing to being named. Without that consent no project is shown — '
          + 'not a completed one and not a successful one either.',
      },
    ],
  },
  {
    pfad: '/ueber-uns',
    beschreibung: 'Who is behind the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'About us', text: null },
      {
        art: 'text',
        ueberschrift: 'What we do',
        text:
          `The CSE group runs four companies in Berlin: ${TRADE.reinigung.toLowerCase()}, `
          + `${TRADE.security.toLowerCase()} and ${TRADE.bau.toLowerCase()}. `
          + 'Alongside them, CSE Operations is responsible for the group’s '
          + 'digital processes.',
      },
      {
        art: 'text',
        ueberschrift: 'How we work',
        text:
          'Every job has a named person responsible for it. Hours are recorded '
          + 'on site, not estimated afterwards. Proof of work belongs with the '
          + 'invoice, not with the follow-up question.',
      },
    ],
  },
  {
    pfad: '/news',
    beschreibung: 'News from the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'News', text: null },
      {
        art: 'text',
        ueberschrift: 'No posts yet',
        text: 'As soon as there is something to report, it will appear here.',
      },
    ],
  },
  {
    pfad: '/kontakt',
    beschreibung: 'How to reach the four companies of the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Contact', text: null },
      {
        art: 'text',
        ueberschrift: 'Send an enquiry',
        text:
          'For a quote, please use the form of the division concerned — it asks '
          + 'for exactly the details we need in order to cost the work. The '
          + 'address and phone number of all four companies are in the footer of '
          + 'every page and in the legal notice.',
      },
    ],
  },
  {
    pfad: '/impressum',
    beschreibung: 'Legal notice under § 5 TMG.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Legal notice', text: null },
      {
        art: 'text',
        ueberschrift: 'Details under § 5 TMG',
        text:
          'The four companies, with their registered name, address and phone '
          + 'number, are listed in the footer of this page. Commercial register '
          + 'entry, VAT identification number and management will be added here '
          + 'per company once those details are confirmed. The German version of '
          + 'this notice is the legally binding one.',
      },
    ],
  },
  {
    pfad: '/datenschutz',
    beschreibung: 'Privacy notice under Art. 13 GDPR — website, portals and core business.',
    // A convenience translation of the German notice; the German version is binding (D-84).
    abschnitte: [
      { art: 'hero', ueberschrift: 'Privacy', text:
        'Privacy notice under Art. 13 GDPR for this website and the group portals. '
        + 'Version: September 2026. The German version is the legally binding one.' },
      {
        art: 'text',
        ueberschrift: 'Who is responsible for processing',
        text:
          'The controller is CSE Dienstleistungen GmbH, Kurfürstendamm 201, 10719 '
          + 'Berlin, Germany, phone +49 30 91203341, office@cse-dienstleistungen.de. '
          + 'Your contact for data-protection matters is Cosette Weyer. This notice '
          + 'covers the joint presence of the four group companies; the details of '
          + 'each company are in the legal notice.',
      },
      {
        art: 'text',
        ueberschrift: 'Personal data — what that means',
        text:
          'With this notice we explain the nature, scope and purpose of the '
          + 'processing of personal data. Personal data is any data that relates '
          + 'to you personally, for example your name, address, e-mail address or '
          + 'usage behaviour.',
      },
      {
        art: 'text',
        ueberschrift: 'Processing in the course of our core business',
        text:
          'We process the personal data you provide within our contractual and '
          + 'pre-contractual relationship: name and address, e-mail address and '
          + 'phone number, contract data and payment data. Processing is limited to '
          + 'what is needed to answer your enquiry or to perform the contract. Data '
          + 'is passed to third parties only where the service, our bookkeeping or '
          + 'a legal obligation requires it. The legal basis is Art. 6(1)(b) GDPR; '
          + 'otherwise Art. 6(1)(c) or (f) GDPR. Data is deleted once it is no '
          + 'longer needed; statutory retention periods (§ 147 AO, § 257 HGB) '
          + 'remain unaffected.',
      },
      {
        art: 'text',
        ueberschrift: 'Hosting and processors',
        text:
          'The website and the portals are served by Vercel (server functions in '
          + 'an EU region); database, sign-in and file storage run on Supabase in '
          + 'Frankfurt (EU). Both process data on our behalf under Art. 28 GDPR. '
          + 'When you open a page, the host processes what your browser sends: IP '
          + 'address, date and time, status, transferred volume, browser and '
          + 'operating system, the referring page and the pages you open — needed '
          + 'to deliver the site and to keep it stable and secure (Art. 6(1)(f) '
          + 'GDPR). These access data are kept only as long as operation and '
          + 'security require. No data is transferred to third countries.',
      },
      {
        art: 'text',
        ueberschrift: 'No third parties on this site',
        text:
          'This website loads no fonts, no analytics and no maps from external '
          + 'servers and sets no analytics or advertising cookies. That is why '
          + 'there is no cookie banner: there is nothing to consent to. After '
          + 'signing in to a portal the application sets one strictly necessary '
          + 'session cookie (§ 25(2) no. 2 TTDSG); it ends when you sign out.',
      },
      {
        art: 'text',
        ueberschrift: 'When you contact us or submit a form',
        text:
          'If you contact us by e-mail, phone, post or through our forms, the '
          + 'data you provide is stored and processed to handle your request. For '
          + 'a form we store what you entered, the date and time of receipt and a '
          + 'non-reversible check value derived from your IP address to prevent '
          + 'abuse; the IP address itself is not stored. The legal basis is Art. '
          + '6(1)(a) GDPR for a form, Art. 6(1)(b) within a contractual '
          + 'relationship, otherwise our legitimate interest in answering you '
          + 'properly (Art. 6(1)(f)). Data is deleted when it is no longer needed; '
          + 'we review this every two years. You may withdraw consent at any time.',
      },
      {
        art: 'text',
        ueberschrift: 'Customer and employee portals',
        text:
          'In the portals we process what the cooperation requires: sign-in data '
          + 'and session, for customers their orders, service records and '
          + 'invoices, for employees their employment data, rosters, time records '
          + 'and certificates. The legal basis is Art. 6(1)(b) GDPR, § 26 BDSG for '
          + 'employees, and Art. 6(1)(c) GDPR where the law demands a record (for '
          + 'example § 17 MiLoG for working hours). Retention follows the statutory '
          + 'periods; afterwards data is deleted or blocked.',
      },
      {
        art: 'text',
        ueberschrift: 'Your rights under the GDPR',
        text:
          'You may at any time exercise the following rights against the '
          + 'controller named above: access (Art. 15), rectification (Art. 16), '
          + 'erasure (Art. 17) unless we must keep the data to meet a legal '
          + 'obligation or to establish, exercise or defend legal claims, '
          + 'restriction of processing (Art. 18), notification (Art. 19), data '
          + 'portability (Art. 20), and the right to lodge a complaint with a '
          + 'supervisory authority (Art. 77). Consent once given may be withdrawn '
          + 'at any time (Art. 7(3)); processing carried out before the withdrawal '
          + 'remains lawful.',
      },
      {
        art: 'text',
        ueberschrift: 'Right to object',
        text:
          'You have the right to object at any time, on grounds relating to your '
          + 'particular situation, to processing based on a balancing of interests '
          + '(Art. 6(1)(f) GDPR). We will then stop processing your data unless we '
          + 'can demonstrate compelling legitimate grounds that override your '
          + 'interests and rights. You may object to processing for advertising '
          + 'purposes at any time without giving reasons. Please send your '
          + 'objection to the contact address above.',
      },
      {
        art: 'text',
        ueberschrift: 'Security measures',
        text:
          'We take technical and organisational measures in line with the state '
          + 'of the art to protect your data against accidental or deliberate '
          + 'manipulation, partial or complete loss, destruction and unauthorised '
          + 'access. Every service that runs this platform is pinned to EU '
          + 'regions; files are kept in private storage and released only through '
          + 'time-limited, signed addresses.',
      },
      {
        art: 'text',
        ueberschrift: 'Currency of this notice',
        text:
          'This privacy notice is current as of September 2026. Changes in law or '
          + 'in the platform may require an update; the current version is always '
          + 'published here. The German version of this notice is the legally '
          + 'binding one.',
      },
    ],
  },
  {
    pfad: '/unternehmen/reinigung',
    beschreibung: `CSE Dienstleistungen GmbH — ${TRADE.reinigung.toLowerCase()} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'CSE Dienstleistung', text: TRADE.reinigung },
      // Translated from the company's own site, cse-dienstleistungen.de (D-473).
      {
        art: 'text',
        ueberschrift: 'Your strong service partner',
        text:
          'Our team is made up of motivated, trained staff who know exactly what '
          + 'matters. We deliver every service we offer with the know-how it takes '
          + 'and put particular weight on quality and thoroughness. Our services '
          + 'range from A to Z — demolition work, construction helpers, caretaking '
          + 'or the day-to-day maintenance cleaning of your property — and we '
          + 'always adapt them to what our customers need.',
      },
      {
        art: 'leistungen',
        ueberschrift: 'Our services',
        text: null,
        daten: {
          leistungen: [
            service('Maintenance cleaning',
              'Keep your property and offices in a consistently immaculate condition.'),
            service('Deep cleaning',
              'From removing dust and dirt of every kind, through machine deep cleaning, to special cleaning of surfaces.'),
            service('Window cleaning',
              'A thorough, high-quality clean that gives your windows the shine they deserve.'),
            service('Office cleaning',
              'High-quality office cleaning, including the care of corridors and carpets.'),
            service('Stairwell cleaning',
              'The stairwell is often the first impression of your building.'),
            service('Construction cleaning',
              'Makes sure all materials and waste are fully removed once the project is finished.'),
            service('Demolition / dismantling',
              'Selective dismantling (non-structural) of all fittings down to the shell.'),
            service('Construction helpers',
              'Helpers relieve the skilled trades on site and are hard to do without.'),
            service('Caretaking',
              'A caretaker takes on many tasks for owners and tenants, on schedule or on call.'),
            service('Construction brokering',
              'Access to a network of experienced construction firms and craftsmen.'),
          ],
          faq: [
            {
              frage: 'What do you need in order to quote?',
              antwort:
                'Type of building, area in square metres, number of properties, '
                + 'the frequency you want and your preferred start date. That is '
                + 'exactly what the enquiry form asks for.',
            },
            {
              frage: 'Do you also clean at weekends?',
              antwort:
                'Working times are agreed per property. Please note what you '
                + 'need in the enquiry.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/security',
    beschreibung: `SSE Security — ${TRADE.security.toLowerCase()} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'SSE Security', text: TRADE.security },
      // Translated from the company's own site, select-security.de (D-473).
      {
        art: 'text',
        ueberschrift: 'We keep Berlin safe',
        text:
          'Your partner for professional security solutions — reliable, discreet '
          + 'and ready to deploy. Whether property protection, personal protection '
          + 'or event security: we stand for uncompromising security in every '
          + 'situation.',
      },
      {
        art: 'leistungen',
        ueberschrift: 'Our services',
        text: null,
        daten: {
          leistungen: [
            service('Premises protection', 'Guarding of buildings and installations (§ 34a GewO).'),
            service('Construction-site guarding', 'Protection of sites, materials and equipment.'),
            service('Fire watch', 'Fire safety watch during works and events.'),
            service('Personal protection', 'Close protection for individuals.'),
            service('Patrol and intervention', 'Patrol rounds and response to alarms.'),
            service('Investigation and detective services', 'Investigations within the law.'),
            service('Event security', 'Admission, order and supervision at events.'),
            service('Hostess and reception service', 'Reception, gate and guest care.'),
            service('Doorman service', 'Access control at the entrance.'),
            service('Security technology', 'Technical security systems.'),
          ],
          faq: [
            {
              frage: 'What do you need in order to quote?',
              antwort:
                'The occasion, the period with date and time, the expected '
                + 'number of visitors, the staff required and the location.',
            },
            {
              frage: 'Are your staff instructed under § 34a GewO?',
              antwort:
                'Proof under § 34a GewO — the German trade-law qualification for '
                + 'security work — is a precondition for deployment and is held '
                + 'on file for each member of staff.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/bau',
    beschreibung: `REALTIME Service GmbH — ${TRADE.bau.toLowerCase()} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'REALTIME Service', text: TRADE.bau },
      {
        art: 'leistungen',
        ueberschrift: 'Our trades',
        text: null,
        daten: {
          leistungen: [
            service('Structural work', 'Shell construction to a schedule of works.'),
            service('Fit-out', 'Drywall, flooring, painting.'),
            service('Demolition', 'Strip-out, with proof of waste disposal.'),
            service('Refurbishment', 'Repair and renewal in existing buildings.'),
          ],
          faq: [
            {
              frage: 'What do you need in order to quote?',
              antwort:
                'The trade, the scope and the completion date you want. If you '
                + 'have a bill of quantities, you can attach it to the enquiry as '
                + 'a PDF or XLSX.',
            },
            {
              frage: 'Do you work to the VOB?',
              antwort:
                'Construction work is handled under VOB/B — the German standard '
                + 'terms for construction contracts — unless something else is '
                + 'agreed.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/operations',
    beschreibung: 'CSE Operations — digital processes, reporting and group management.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'CSE Operations',
        text: 'Digital processes, reporting and group management.',
      },
      {
        art: 'text',
        ueberschrift: 'What Operations does',
        text:
          'CSE Operations runs the platform the other three companies work on: '
          + 'time recording, rostering, proof of work, reporting. For external '
          + 'customers the division offers the same work — mapping processes, '
          + 'digitising them and making them measurable.',
      },
    ],
  },
];

/**
 * The English twin of `LEISTUNGSSEITEN` (D-82) — same path, own `seite` row.
 *
 * Provisional demonstration content, and it says so. Which services get a
 * page of their own and which company is responsible for them is open
 * (O-652); until that is answered `mandant_id` stays NULL and the `Service`
 * block carries no `provider`.
 *
 * // TODO(client, O-652): Which services get their own page under
 * `/leistungen/<slug>`, and which company is responsible for each?
 */
export const LEISTUNGSSEITEN_EN: readonly {
  readonly pfad: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly abschnitte: readonly {
    readonly art: 'hero' | 'text' | 'markenkarten' | 'leistungen';
    readonly ueberschrift: string | null;
    readonly text: string | null;
    readonly daten?: Record<string, unknown>;
  }[];
}[] = [
  {
    pfad: '/leistungen/unterhaltsreinigung',
    titel: 'Routine cleaning',
    beschreibung: 'Recurring cleaning to an agreed schedule of works — Berlin.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'Routine cleaning',
        text: 'Recurring cleaning to an agreed schedule of works.',
      },
      {
        art: 'text',
        ueberschrift: 'Provisional page',
        text:
          'This page is demonstration content. It shows what a single service '
          + 'looks like as a page of its own — which services get one, and '
          + 'which company is responsible for them, has not been decided yet '
          + '(open question O-652). Until then the page names no provider.',
      },
    ],
  },
];
