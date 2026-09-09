import { NextResponse } from "next/server";
import { listRadar } from "@/lib/intelligence/signal-store";
import { intParam, noStore } from "@/lib/api";
export async function GET(req: Request) { return NextResponse.json({ signals: await listRadar(intParam(new URL(req.url), 'limit', 30, 1, 100)) }, noStore); }
