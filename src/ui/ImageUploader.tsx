"use client";

import { useRef, useState } from "react";

import { MAX_IMAGE_BYTES } from "../domain/media/imagePolicy";

/**
 * Friendly image picker.
 *
 * The user never types a path: they choose a file, it uploads, and a thumbnail
 * appears. The resulting application URL travels in a hidden field. The server
 * re-validates everything — this component is convenience, not a control.
 */
export function ImageUploader({
  name,
  altName,
  defaultUrl,
  defaultAlt,
}: {
  name: string;
  altName: string;
  defaultUrl?: string | null;
  defaultAlt?: string | null;
}) {
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/media/upload", { method: "POST", body });
      const payload = (await response.json()) as { ok: boolean; url?: string; message?: string };

      if (!response.ok || !payload.ok || !payload.url) {
        setError(payload.message ?? "That image could not be uploaded.");
        return;
      }
      setUrl(payload.url);
    } catch {
      setError("That image could not be uploaded. Please try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <input type="hidden" name={name} value={url} />

      {url ? (
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- user upload served from our media route; no static optimisation wanted */}
          <img
            src={url}
            alt="Selected newsletter image"
            className="h-28 w-40 rounded-lg border border-slate-200 object-cover"
          />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:text-slate-400"
            >
              {busy ? "Uploading…" : "Replace image"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUrl("");
                setError(null);
              }}
              className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              Remove image
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-sky-400 hover:bg-sky-50/50 disabled:opacity-60"
        >
          <span aria-hidden className="text-2xl">
            🖼️
          </span>
          <span className="text-sm font-semibold text-slate-800">
            {busy ? "Uploading…" : "Upload an image"}
          </span>
          <span className="text-xs text-slate-500">
            JPG, PNG, WebP or GIF · up to {MAX_IMAGE_BYTES / (1024 * 1024)} MB
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}

      {url ? (
        <div className="mt-3">
          <label className="block text-xs font-semibold text-slate-700">
            Describe the image (shown if the picture cannot load)
          </label>
          <input
            type="text"
            name={altName}
            defaultValue={defaultAlt ?? ""}
            placeholder="For example: AXIS field team using a GPS receiver"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
          />
        </div>
      ) : null}
    </div>
  );
}
