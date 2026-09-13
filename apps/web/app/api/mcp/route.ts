import { createAgentRoute } from '@/lib/agents/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = createAgentRoute('mcp');
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
