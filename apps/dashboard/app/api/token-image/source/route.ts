import sharp from "sharp";
import { safeImageUrl } from "../../../../lib/images";

const maximumImageBytes = 5_000_000;
const thumbnailSize = 192;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const source = safeImageUrl(new URL(request.url).searchParams.get("url"));
  if (!source) return Response.json({ error: "Invalid image URL" }, { status: 400 });

  try {
    const response = await fetch(source, {
      headers: {
        Accept: "image/avif,image/webp,image/*",
        "User-Agent": "PonsEye/1.0 token image cache",
      },
      cache: "force-cache",
      next: { revalidate: 604_800 },
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!response.ok || !contentType?.startsWith("image/")) {
      throw new Error(`Invalid image response: ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maximumImageBytes) throw new Error("Image is too large");
    const body = await response.arrayBuffer();
    if (!body.byteLength || body.byteLength > maximumImageBytes) throw new Error("Invalid image size");
    const thumbnail = await sharp(Buffer.from(body))
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
