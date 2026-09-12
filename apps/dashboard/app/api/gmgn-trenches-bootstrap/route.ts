export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GMGN_TRENCHES_URL = "https://gmgn.ai/trs/api/v1/trenches_rank";
const QUOTE_ADDRESS_TYPES = [11, 20, 24, 12, 0];

function section(orderby: "created_timestamp" | "progress") {
  return {
    filters: ["offchain", "onchain"],
    launchpad_platform_v2: true,
    launchpad_platform: ["pons"],
    quote_address_type: QUOTE_ADDRESS_TYPES,
    orderby,
    direction: "desc",
    limit: 1,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const connId = typeof body?.connId === "string" ? body.connId : "";
  const rg = typeof body?.rg === "string" ? body.rg : "";
  if (!connId || connId.length > 200 || !/^[a-z0-9_-]{1,32}$/i.test(rg)) {
    return Response.json({ error: "Invalid connection metadata" }, { status: 400 });
  }

  const response = await fetch(GMGN_TRENCHES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://gmgn.ai",
      referer: "https://gmgn.ai/?chain=robinhood",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      meta: { rg, conn_id: connId },
      params: [{
        chain: "robinhood",
        new_creation: section("created_timestamp"),
        near_completion: section("progress"),
        completed: section("progress"),
      }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    return Response.json({ error: `GMGN HTTP ${response.status}` }, { status: 502 });
  }

  const envelope = record(await response.json());
  const rows = Array.isArray(envelope?.data) ? envelope.data : [];
  const root = rows.map(record).find((row) => row?.chain === "robinhood");
  if (Number(envelope?.code) !== 0 || !root) {
    return Response.json({ error: "GMGN returned no Robinhood data" }, { status: 502 });
  }

  const sections = [
    ["new_creation", "new_creation"],
    ["near_completion", "near_completion"],
    ["completed", "completed"],
  ].flatMap(([key, category]) => {
    const value = record(root[key]);
    return typeof value?.filter_id === "string" && typeof value.version === "string"
      ? [{ category, filterId: value.filter_id, version: value.version }]
      : [];
  });
  if (sections.length !== 3) {
    return Response.json({ error: "GMGN returned incomplete subscription metadata" }, { status: 502 });
  }

  return Response.json(
    { chain: "robinhood", rg: typeof root.rg === "string" ? root.rg : rg, sections },
    { headers: { "cache-control": "no-store" } },
  );
}
