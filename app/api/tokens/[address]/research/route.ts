import { after } from 'next/server';
import { getResearch, generateResearch, reserveResearch, researchConfigured, refreshPendingResearch } from '@/lib/services/token-research';
import { guardWrite } from '@/lib/social/write-guard';
export const maxDuration = 180;
type Context = { params: Promise<{address:string}> };
export async function GET(_req:Request,ctx:Context) { const {address}=await ctx.params; if (!/^0x[a-f0-9]{40}$/i.test(address)) return Response.json({error:'Invalid token'},{status:400}); after(()=>refreshPendingResearch(address.toLowerCase())); return Response.json({configured:researchConfigured(),state:await getResearch(address.toLowerCase())},{headers:{'Cache-Control':'no-store'}}); }
export async function POST(req:Request,ctx:Context) { const {address}=await ctx.params; if (!/^0x[a-f0-9]{40}$/i.test(address)) return Response.json({error:'Invalid token'},{status:400}); const guard=await guardWrite(req,'report'); if(!guard.ok)return guard.response; const result=await reserveResearch(address.toLowerCase()); if(result.accepted)after(()=>generateResearch(address.toLowerCase())); return Response.json(result,{status:result.accepted?202:200,headers:{'Cache-Control':'no-store'}}); }
