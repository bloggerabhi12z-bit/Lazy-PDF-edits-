import { z } from "zod";
import { verifyRequestOrigin } from "@netlify/identity";

const requestSchema = z.object({ url: z.string().url().max(2000) });
const allowedHosts = new Set(["drive.google.com", "www.dropbox.com", "dropbox.com"]);
const maxBytes = 50 * 1024 * 1024;

function normalizeUrl(input: string) {
  const url = new URL(input);
  if (!allowedHosts.has(url.hostname)) throw new Error("Only Google Drive and Dropbox shared links are supported.");
  if (url.hostname.includes("dropbox.com")) url.searchParams.set("dl", "1");
  const driveMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (url.hostname === "drive.google.com" && driveMatch?.[1]) return new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveMatch[1])}`);
  return url;
}

export default async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  try { verifyRequestOrigin(request); } catch { return Response.json({ error: "Request origin rejected." }, { status: 403 }); }
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Enter a valid shared file URL." }, { status: 400 });
    const source = normalizeUrl(parsed.data.url);
    const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return Response.json({ error: "The shared file could not be downloaded. Check its sharing permissions." }, { status: 422 });
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) return Response.json({ error: "Cloud imports are limited to 50 MB." }, { status: 413 });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) return Response.json({ error: "Cloud imports are limited to 50 MB." }, { status: 413 });
    const filename = response.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i)?.[1] ?? source.pathname.split("/").pop() ?? "cloud-file.pdf";
    return new Response(bytes, {
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${decodeURIComponent(filename).replace(/[\r\n"]/g, "")}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Cloud import failed." }, { status: 400 });
  }
};
