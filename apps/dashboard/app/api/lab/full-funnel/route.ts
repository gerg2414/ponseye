import {
  defaultSurveillanceGate,
  getPonsEyeFullFunnelData,
  type SurveillanceGateSettings,
} from "../../../../lib/lab-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<SurveillanceGateSettings>;
    const settings: SurveillanceGateSettings = {
      minAgeSeconds: boundedNumber(body.minAgeSeconds, defaultSurveillanceGate.minAgeSeconds, 60, 600),
      maxAgeSeconds: boundedNumber(body.maxAgeSeconds, defaultSurveillanceGate.maxAgeSeconds, 60, 3600),
      minMarketCapUsd: boundedNumber(body.minMarketCapUsd, defaultSurveillanceGate.minMarketCapUsd, 1_000, 100_000),
      minTrades: boundedNumber(body.minTrades, defaultSurveillanceGate.minTrades, 1, 100),
      minUniqueTraders: boundedNumber(body.minUniqueTraders, defaultSurveillanceGate.minUniqueTraders, 1, 50),
      minBuyPressurePct: boundedNumber(body.minBuyPressurePct, defaultSurveillanceGate.minBuyPressurePct, 0, 100),
      requireNoCreatorSales: body.requireNoCreatorSales !== false,
    };
    settings.maxAgeSeconds = Math.max(settings.minAgeSeconds, settings.maxAgeSeconds);

    const tokens = await getPonsEyeFullFunnelData(settings);
    return Response.json({ tokens, settings });
  } catch (error) {
    console.error("[lab] full funnel replay failed", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "The full funnel replay could not be completed." }, { status: 500 });
  }
}
