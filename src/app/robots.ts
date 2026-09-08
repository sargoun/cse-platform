import type { MetadataRoute } from 'next';

/** `/dev/**` is a development surface and never appears in the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: ['/dev/'] }] };
}
