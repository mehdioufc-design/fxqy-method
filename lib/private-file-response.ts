import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { contentDispositionAttachment } from "./paths";

export async function privateFileResponse(
  request: Request,
  absolutePath: string,
  options: { fileName: string; download?: boolean },
): Promise<Response> {
  const file = await stat(absolutePath);
  if (!file.isFile()) return new Response(null, { status: 404 });

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": options.download ? "application/octet-stream" : "video/mp4",
    "X-Content-Type-Options": "nosniff",
  });
  if (options.download) {
    headers.set("Content-Disposition", contentDispositionAttachment(options.fileName));
  }

  const range = request.headers.get("range");
  if (!range) {
    headers.set("Content-Length", String(file.size));
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const stream = createReadStream(absolutePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      headers.set("Content-Range", `bytes */${file.size}`);
      return new Response(null, { status: 416, headers });
    }
    start = Math.max(0, file.size - suffix);
    end = file.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : file.size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= file.size
  ) {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  end = Math.min(end, file.size - 1);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  if (request.method === "HEAD") return new Response(null, { status: 206, headers });
  const stream = createReadStream(absolutePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
}
