import { env } from 'cloudflare:workers';
import { handle } from '../../lib/addon.mjs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handle(request,env.DB,fetch,env);}
export const POST=GET;
export const DELETE=GET;
export const OPTIONS=GET;
export const HEAD=GET;
