import type { Metadata } from 'next';
import { OeffentlicheSeite } from '../OeffentlicheSeite';
import { metadatenFuer } from '../metadaten';

/**
 * Die englische Startseite.
 *
 * Vier kleine Dateien unter `en/` statt eines Catch-all: `typedRoutes` prueft
 * dann jeden Verweis, und `/en` bleibt eine Route und kein Sonderfall in einer
 * Segmentbehandlung. Der Inhalt kommt aus derselben Komponente — die Sprache
 * ist ein Argument, keine Kopie.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return metadatenFuer('/', 'en');
}

export default function EnglishHome() {
  return <OeffentlicheSeite pfad="/" sprache="en" />;
}
