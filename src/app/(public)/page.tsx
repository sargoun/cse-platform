import type { Metadata } from 'next';
import { OeffentlicheSeite } from './OeffentlicheSeite';
import { metadatenFuer } from './metadaten';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return metadatenFuer('/');
}

export default function Startseite() {
  return <OeffentlicheSeite pfad="/" />;
}
