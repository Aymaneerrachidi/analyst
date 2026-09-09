import { NextResponse } from "next/server";
import { signalPerformance } from "@/lib/intelligence/signal-store";
import { intParam, noStore } from "@/lib/api";
export async function GET(req: Request) { const url = new URL(req.url); return NextResponse.json({ signals: await signalPerformance(intParam(url, 'days', 30, 1, 90), intParam(url, 'score', 0, 0, 100)) }, noStore); }
