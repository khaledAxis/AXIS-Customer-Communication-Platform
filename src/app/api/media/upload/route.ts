import { NextResponse } from "next/server";

import { MAX_IMAGE_BYTES } from "../../../../domain/media/imagePolicy";
import { uploadNewsletterImage } from "../../../../server/services/mediaService";

/**
 * Image upload endpoint. Thin: parse -> service -> response (CLAUDE.md route rule).
 *
 * The uploaded bytes are validated against a type allow-list AND magic-byte sniffed
 * before anything touches storage, and the stored filename is generated server-side.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "Could not read the uploaded file." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "Please choose an image to upload." }, { status: 400 });
  }

  // Reject oversized uploads before buffering the whole body.
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        message: `That image is too large. The maximum size is ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadNewsletterImage({ name: file.name, type: file.type, bytes });

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    url: result.media.url,
    filename: result.media.filename,
  });
}
