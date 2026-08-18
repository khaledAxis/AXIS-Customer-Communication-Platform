import { NextResponse } from "next/server";

import { isValidStoredFilename } from "../../../../domain/media/imagePolicy";
import { readMedia } from "../../../../server/services/mediaService";

/**
 * Serves uploaded images.
 *
 * Uploaded files live OUTSIDE `public/` and are served only through this handler so
 * that:
 *  - the filename is re-validated against the generated-name pattern (traversal and
 *    unexpected extensions are impossible),
 *  - the Content-Type is chosen by the server from the extension allow-list — never
 *    echoed from the upload,
 *  - `nosniff` + an attachment-safe disposition stop a browser from ever treating a
 *    stored file as HTML or script.
 */

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;

  if (!isValidStoredFilename(name)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const media = await readMedia(name);
  if (!media) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(Buffer.from(media.bytes), {
    status: 200,
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.bytes.byteLength),
      "Content-Disposition": `inline; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
