import sharp from "sharp";

const gateways = [
  "https://w3s.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://gateway.lighthouse.storage/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

const maximumImageBytes = 5_000_000;
const thumbnailSize = 192;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchImage(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "image/avif,image/webp,image/*" },
    cache: "force-cache",
    next: { revalidate: 604_800 },
    signal: AbortSignal.timeout(8_000),
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
    const thumbnail = await sharp(Buffer.from(image.body))
      .rotate()
      .resize(thumbnailSize, thumbnailSize, { fit: "cover", position: "centre", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return new Response(new Uint8Array(thumbnail), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Token image unavailable" }, {
      status: 502,
      headers: { "Cache-Control": "public, max-age=30, s-maxage=30" },
    });
  }
}
