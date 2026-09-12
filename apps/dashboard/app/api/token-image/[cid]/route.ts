const gateways = [
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

const maximumImageBytes = 5_000_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchImage(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "image/avif,image/webp,image/*" },
    signal: AbortSignal.timeout(3_000),
  });
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (!response.ok || !contentType?.startsWith("image/")) {
    throw new Error(`Invalid image response: ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maximumImageBytes) throw new Error("Image is too large");
  const body = await response.arrayBuffer();
  if (!body.byteLength || body.byteLength > maximumImageBytes) throw new Error("Invalid image size");
  return { body, contentType };
}

export async function GET(_request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!/^[a-zA-Z0-9]{20,120}$/.test(cid)) {
    return Response.json({ error: "Invalid IPFS CID" }, { status: 400 });
  }

  try {
    const image = await Promise.any(gateways.map((gateway) => fetchImage(`${gateway}${cid}`)));
    return new Response(image.body, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Token image unavailable" }, {
      status: 502,
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  }
}
