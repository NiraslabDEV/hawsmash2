import { createAgentRoute } from '@/lib/agents/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = createAgentRoute('browser');
export const POST = handle;
export const OPTIONS = handle;
