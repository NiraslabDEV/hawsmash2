import { getBrand } from '@/lib/brand/server';
import { garcomManifest, manifestResponse } from '@/lib/pwa/manifests';

// A marca vem da BD em runtime (§18.2); não congela no build.
export const dynamic = 'force-dynamic';

export async function GET() {
  return manifestResponse(garcomManifest(await getBrand()));
}
