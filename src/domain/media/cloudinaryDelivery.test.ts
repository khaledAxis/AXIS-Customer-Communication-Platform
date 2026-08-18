import { describe, it, expect } from "vitest";

import {
  EMAIL_IMAGE_MAX_WIDTH,
  EMAIL_LOGO_DISPLAY_WIDTH,
  EMAIL_LOGO_MAX_WIDTH,
  emailDeliveryUrl,
  emailLogoUrl,
  emailTransformation,
  isCloudinaryUrl,
} from "./cloudinaryDelivery";

const BASE = "https://res.cloudinary.com/axis-demo/image/upload";
const ASSET = `${BASE}/v1700000000/axis-newsletter/content/photo-abc123.jpg`;

describe("recognising Cloudinary delivery URLs", () => {
  it("recognises an HTTPS delivery URL", () => {
    expect(isCloudinaryUrl(ASSET)).toBe(true);
  });

  it.each([
    "http://res.cloudinary.com/axis-demo/image/upload/v1/a.jpg", // insecure
    "https://cdn.example.com/a.jpg",
    "https://res.cloudinary.com/axis-demo/video/upload/v1/a.mp4",
    "/api/media/a.png",
    "",
  ])("does not treat %j as a Cloudinary image URL", (url) => {
    expect(isCloudinaryUrl(url)).toBe(false);
  });

  it("handles null and undefined", () => {
    expect(isCloudinaryUrl(null)).toBe(false);
    expect(isCloudinaryUrl(undefined)).toBe(false);
  });
});

describe("email delivery transformation", () => {
  it("limits width to the retina size of the 640px container", () => {
    expect(EMAIL_IMAGE_MAX_WIDTH).toBe(1280);
    expect(emailDeliveryUrl(ASSET)).toContain("w_1280");
  });

  it("uses c_limit so images are never upscaled or cropped", () => {
    expect(emailDeliveryUrl(ASSET)).toContain("c_limit");
    expect(emailDeliveryUrl(ASSET)).not.toContain("c_fill");
    expect(emailDeliveryUrl(ASSET)).not.toContain("c_crop");
  });

  it("inserts the transformation immediately after /image/upload/", () => {
    expect(emailDeliveryUrl(ASSET)).toBe(
      `${BASE}/c_limit,w_1280,q_auto/v1700000000/axis-newsletter/content/photo-abc123.jpg`,
    );
  });

  it("never negotiates AVIF, which several email clients cannot display", () => {
    expect(emailDeliveryUrl(ASSET)).not.toContain("f_auto");
    expect(emailDeliveryUrl(ASSET)).not.toContain("avif");
  });

  it("converts WebP to JPEG because Outlook on Windows cannot render WebP", () => {
    const webp = `${BASE}/v1/axis-newsletter/content/photo-abc123.webp`;
    expect(emailDeliveryUrl(webp)).toContain("f_jpg");
    expect(emailTransformation(webp)).toBe("c_limit,w_1280,q_auto,f_jpg");
  });

  it("keeps PNG as PNG so logo transparency survives", () => {
    const png = `${BASE}/v1/axis-newsletter/content/logo-abc123.png`;
    expect(emailDeliveryUrl(png)).not.toContain("f_jpg");
  });

  it("is idempotent — re-rendering cannot stack transformations", () => {
    const once = emailDeliveryUrl(ASSET)!;
    const twice = emailDeliveryUrl(once)!;
    expect(twice).toBe(once);
    expect(twice.match(/c_limit/g)).toHaveLength(1);
  });

  it("leaves non-Cloudinary URLs untouched", () => {
    expect(emailDeliveryUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(emailDeliveryUrl("/api/media/a.png")).toBe("/api/media/a.png");
  });

  it("passes null through", () => {
    expect(emailDeliveryUrl(null)).toBeNull();
    expect(emailDeliveryUrl(undefined)).toBeNull();
  });

  it("stays HTTPS", () => {
    expect(emailDeliveryUrl(ASSET)!.startsWith("https://")).toBe(true);
  });
});

describe("logo delivery sizing", () => {
  const LOGO = `${BASE}/v1700000000/axis-logo.png`;

  it("caps the logo at the logo retina width, not the hero width", () => {
    expect(emailLogoUrl(LOGO)).toContain(`w_${EMAIL_LOGO_MAX_WIDTH}`);
    expect(EMAIL_LOGO_MAX_WIDTH).toBe(440);
    expect(emailLogoUrl(LOGO)).not.toContain("w_1280");
  });

  it("displays at roughly 200px, within the requested 180-220px range", () => {
    expect(EMAIL_LOGO_DISPLAY_WIDTH).toBeGreaterThanOrEqual(180);
    expect(EMAIL_LOGO_DISPLAY_WIDTH).toBeLessThanOrEqual(220);
    // Delivered at 2x the display width so it stays crisp on retina screens.
    expect(EMAIL_LOGO_MAX_WIDTH).toBeGreaterThanOrEqual(EMAIL_LOGO_DISPLAY_WIDTH * 2);
  });

  it("uses c_limit so the logo is never upscaled or cropped", () => {
    expect(emailLogoUrl(LOGO)).toContain("c_limit");
    expect(emailLogoUrl(LOGO)).not.toContain("c_fill");
    expect(emailLogoUrl(LOGO)).not.toContain("c_crop");
  });

  it("keeps PNG transparency — no forced JPEG for a logo", () => {
    expect(emailLogoUrl(LOGO)).not.toContain("f_jpg");
    expect(emailLogoUrl(LOGO)).not.toContain("f_auto");
  });

  it("is idempotent", () => {
    const once = emailLogoUrl(LOGO)!;
    expect(emailLogoUrl(once)).toBe(once);
    expect(once.match(/c_limit/g)).toHaveLength(1);
  });

  it("leaves a non-Cloudinary logo untouched", () => {
    expect(emailLogoUrl("https://www.axis-gps.com/logo.png")).toBe("https://www.axis-gps.com/logo.png");
  });

  it("passes null through", () => {
    expect(emailLogoUrl(null)).toBeNull();
  });
});
