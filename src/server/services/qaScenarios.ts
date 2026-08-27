import type { NewsletterLanguage } from "../../domain/email/newsletterTemplate";

/**
 * The QA scenario catalogue (ADR-0027).
 *
 * Each entry exercises ONE rendering behaviour and exists so that a live QA email can
 * be justified by name. "Do not send duplicate emails merely to increase the test
 * count" is enforced by construction: a send names a scenario, and each scenario tests
 * something different.
 *
 * Content here is written for testing. It is NOT customer copy, it names no customer,
 * and it is never used by a campaign.
 */

export interface QaScenarioItem {
  title: string;
  summary?: string | null;
  bodyHtml?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  externalUrl?: string | null;
  kicker?: string | null;
}

export interface QaScenario {
  id: string;
  /** Appears after the mandatory prefix in the subject line. */
  subject: string;
  title: string;
  /** Why this email exists — reported next to the send. */
  purpose: string;
  /** What the recipient should look at in their inbox. */
  inspect: string[];
  language: NewsletterLanguage;
  preheader?: string | null;
  introHtml?: string | null;
  items: QaScenarioItem[];
  /**
   * Names the campaign whose hosted web version this scenario demonstrates.
   *
   * A NAME rather than an id, because this catalogue is source code and a database
   * id means nothing on another machine. Resolved at send time through the ordinary
   * deliverability gate: if the campaign has no web version, or the configured
   * origin is one a recipient could not reach, the link is simply absent — exactly
   * as in a production newsletter. Almost every scenario leaves this unset.
   */
  webVersionCampaignName?: string;
}

/** A real Cloudinary asset already in AXIS storage — the production image path. */
const CLOUDINARY_IMAGE =
  "https://res.cloudinary.com/ypzrrtnt/image/upload/v1787044127/axis-newsletter/content/whatsapp-image-2026-08-16-at-09-46-15-abf4de5ad9eba649.jpg";

/**
 * A machine-local asset. Deliberately included in one scenario: the renderer must
 * OMIT it rather than ship a broken image to a recipient (ADR-0015).
 */
const LOCAL_ONLY_IMAGE = "/api/media/axis-demo-photo-cdccfa699e475f46.png";

const LOREM_HE =
  "מערכות מדידה מתקדמות מאפשרות לצוותי השטח לאסוף נתונים מדויקים בזמן קצר יותר, ולהעביר אותם ישירות למשרד לצורך עיבוד וניתוח.";
const LOREM_AR =
  "تتيح أنظمة المسح المتقدمة لفرق العمل الميداني جمع بيانات دقيقة في وقت أقصر، ونقلها مباشرة إلى المكتب لمعالجتها وتحليلها.";

const CORE_SCENARIOS: QaScenario[] = [
  // ---------------------------------------------------------------- delivery
  {
    id: "QA-BASIC-EN",
    subject: "Basic Email Delivery",
    title: "Basic delivery",
    purpose:
      "Confirms an AXIS newsletter reaches the inbox at all, with the correct sender name, and is not filtered as spam.",
    inspect: [
      "The message reached the inbox and not the spam folder",
      'Sender shows as "AXIS Advanced Mapping Solutions"',
      "Subject begins with [AXIS Newsletter Platform TEST]",
      "The blue platform-test notice appears at the very top",
      "The AXIS logo renders in the header",
    ],
    language: "UNKNOWN",
    preheader: "Platform delivery check — no action required.",
    items: [
      {
        title: "Delivery check",
        kicker: "QA",
        summary:
          "If you can read this in your inbox, basic delivery from the AXIS Newsletter Platform is working.",
        externalUrl: "https://www.axis-gps.com/",
      },
    ],
  },

  // ---------------------------------------------------------------- Hebrew RTL
  {
    id: "QA-HE-RTL",
    subject: "Hebrew RTL Rendering",
    title: "Hebrew right-to-left",
    purpose:
      "Verifies Hebrew renders right-to-left with correct alignment, punctuation at the correct edge, and a mirrored layout.",
    inspect: [
      "All Hebrew text is right-aligned",
      "The whole layout is mirrored (logo, headings, button)",
      "Full stops and commas sit at the LEFT edge of each line, not the right",
      "The platform-test notice is in Hebrew",
      "Nothing is reversed or scrambled",
    ],
    language: "HE",
    preheader: "בדיקת תצוגה בעברית",
    items: [
      {
        title: "בדיקת תצוגת עברית מימין לשמאל",
        kicker: "בדיקה",
        summary: LOREM_HE,
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "פסקה נוספת לבדיקת יישור",
        summary:
          "יש לוודא שהטקסט מיושר לימין, ושסימני הפיסוק מופיעים בקצה הנכון של השורה.",
      },
    ],
  },

  // ---------------------------------------------------------------- Arabic RTL
  {
    id: "QA-AR-RTL",
    subject: "Arabic RTL Rendering",
    title: "Arabic right-to-left",
    purpose:
      "Verifies Arabic renders right-to-left with correct letter joining, alignment and a mirrored layout.",
    inspect: [
      "All Arabic text is right-aligned",
      "Arabic letters are correctly JOINED (not shown as separate disconnected forms)",
      "The layout is mirrored",
      "The platform-test notice is in Arabic",
      "Punctuation sits at the correct edge",
    ],
    language: "AR",
    preheader: "اختبار العرض بالعربية",
    items: [
      {
        title: "اختبار عرض النص العربي من اليمين إلى اليسار",
        kicker: "اختبار",
        summary: LOREM_AR,
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "فقرة إضافية للتحقق من المحاذاة",
        summary: "يرجى التأكد من أن النص محاذٍ إلى اليمين وأن الحروف متصلة بشكل صحيح.",
      },
    ],
  },

  // ---------------------------------------------------------------- mixed HE/EN
  {
    id: "QA-HE-MIXED",
    subject: "Mixed Hebrew / English Rendering",
    title: "Hebrew with Latin phrases",
    purpose:
      "Verifies Latin product names and URLs stay left-to-right and in one piece inside right-to-left Hebrew text (bidi isolation, ADR-0015).",
    inspect: [
      'Latin phrases such as "Trimble R12i GNSS" read correctly and are NOT reversed',
      "Model numbers stay together as one unit",
      "The email address and URL are not broken apart",
      "Surrounding Hebrew stays right-aligned",
      "Commas and ampersands inside Latin phrases stay in the right place",
    ],
    language: "HE",
    items: [
      {
        title: "בדיקת שילוב עברית ואנגלית",
        kicker: "בדיקה",
        summary:
          "המקלט Trimble R12i GNSS והסורק NavVis VLX 3 מספקים דיוק גבוה. לפרטים: info@axis-gps.com או https://www.axis-gps.com/products",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Spectra Geospatial SP100 — בדיקה נוספת",
        summary:
          "יש לבדוק שהצירוף Spectra Geospatial SP100, כולל הרווחים והמקפים, נשאר שלם ואינו מתהפך.",
      },
    ],
  },

  // ---------------------------------------------------------------- mixed AR/EN
  {
    id: "QA-AR-MIXED",
    subject: "Mixed Arabic / English Rendering",
    title: "Arabic with Latin phrases",
    purpose:
      "Verifies Latin product names and URLs stay left-to-right and unbroken inside right-to-left Arabic text.",
    inspect: [
      'Latin phrases such as "Trimble R12i GNSS" read correctly and are NOT reversed',
      "Model numbers and URLs stay together",
      "Arabic letters remain joined around the Latin text",
      "Alignment stays right",
      "Nothing drifts to the wrong edge",
    ],
    language: "AR",
    items: [
      {
        title: "اختبار الدمج بين العربية والإنجليزية",
        kicker: "اختبار",
        summary:
          "يوفر جهاز Trimble R12i GNSS وماسح NavVis VLX 3 دقة عالية. للتفاصيل: info@axis-gps.com أو https://www.axis-gps.com/products",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Spectra Geospatial SP100 — اختبار إضافي",
        summary:
          "يرجى التأكد من أن عبارة Spectra Geospatial SP100 تبقى متصلة ولا تنعكس.",
      },
    ],
  },

  // ---------------------------------------------------------------- images
  {
    id: "QA-IMAGES",
    subject: "Cloudinary Image Verification",
    title: "Hosted images",
    purpose:
      "Verifies the hero image and secondary images load from Cloudinary in a real mail client, at the correct size and without cropping.",
    inspect: [
      "The hero image at the top loads and is not stretched or cropped",
      "The secondary article image loads",
      "Images are not blocked by default (or load after clicking Show images)",
      "Alt text appears where an image is blocked",
      "The AXIS logo is sharp, not pixelated, on a high-DPI screen",
    ],
    language: "UNKNOWN",
    preheader: "Image rendering check.",
    items: [
      {
        title: "Hero image test",
        kicker: "IMAGES",
        summary:
          "This article carries a full-width hero image served from Cloudinary at the delivery size the platform requests.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment photograph",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Secondary image test",
        summary: "A second article with its own image, to check spacing between blocks.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment photograph, second use",
      },
    ],
  },

  {
    id: "QA-IMAGE-OMISSION",
    subject: "Non-Deliverable Image Omission",
    title: "Unreachable image is omitted",
    purpose:
      "Proves the renderer OMITS an image that only resolves on the sending machine, rather than shipping a broken image icon to a recipient (ADR-0015).",
    inspect: [
      "The first article shows NO broken image icon and no empty grey box",
      "The article text and layout still look correct without it",
      "The second article's Cloudinary image DOES load",
      "No red X or 'image not found' placeholder anywhere",
    ],
    language: "UNKNOWN",
    items: [
      {
        title: "This article's image should be absent",
        kicker: "OMISSION",
        summary:
          "Its picture is stored only on the development machine, so the platform must leave it out entirely rather than send a link you cannot load.",
        imageUrl: LOCAL_ONLY_IMAGE,
        imageAlt: "Should never appear",
      },
      {
        title: "This article's image should load",
        summary: "Served from Cloudinary, so it is deliverable and must appear.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment photograph",
      },
    ],
  },

  // ---------------------------------------------------------------- multi-article
  {
    id: "QA-MULTI-HE",
    subject: "Multi-Article Newsletter",
    title: "Multi-article layout (Hebrew)",
    purpose:
      "Verifies the featured/hero article is visually distinct from the compact secondary articles, and that spacing between four blocks is correct.",
    inspect: [
      "The FIRST article is clearly the largest — hero image, big headline, blue kicker",
      "The remaining three are compact and consistent with each other",
      "Spacing between blocks is even, with no collapsed or doubled gaps",
      "Order matches: 1, 2, 3, 4",
      "Everything stays right-aligned",
    ],
    language: "HE",
    items: [
      {
        title: "כתבה ראשית — מערכות סריקה חדשות",
        kicker: "כתבה ראשית",
        summary: LOREM_HE,
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "ציוד שטח",
        externalUrl: "https://www.axis-gps.com/",
      },
      { title: "כתבה שנייה — עדכוני תוכנה", summary: "בדיקת מרווחים בין בלוקים." },
      { title: "כתבה שלישית — הדרכות", summary: "בדיקת עקביות בין כתבות משניות." },
      { title: "כתבה רביעית — אירועים", summary: "בדיקת הבלוק האחרון לפני הפוטר." },
    ],
  },

  {
    id: "QA-MULTI-AR",
    subject: "Multi-Article Newsletter",
    title: "Multi-article layout (Arabic)",
    purpose:
      "Verifies hero-versus-secondary hierarchy and block spacing hold in Arabic right-to-left layout.",
    inspect: [
      "The FIRST article is the largest with its hero image",
      "The other three are compact and even",
      "Right-to-left order is correct throughout",
      "Arabic letters stay joined in headings as well as body text",
      "The last block sits cleanly above the footer",
    ],
    language: "AR",
    items: [
      {
        title: "المقال الرئيسي — أنظمة المسح الجديدة",
        kicker: "المقال الرئيسي",
        summary: LOREM_AR,
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "معدات ميدانية",
        externalUrl: "https://www.axis-gps.com/",
      },
      { title: "المقال الثاني — تحديثات البرامج", summary: "اختبار المسافات بين الأقسام." },
      { title: "المقال الثالث — الدورات التدريبية", summary: "اختبار الاتساق." },
      { title: "المقال الرابع — الفعاليات", summary: "اختبار القسم الأخير قبل التذييل." },
    ],
  },

  {
    id: "QA-MULTI-EN",
    subject: "Multi-Article Newsletter",
    title: "Multi-article layout (left-to-right)",
    purpose:
      "Verifies the same hero/secondary hierarchy and spacing in a left-to-right newsletter.",
    inspect: [
      "The first article is the hero, the rest are compact",
      "Left-to-right alignment throughout",
      "Even spacing between all four blocks",
      "Kicker label appears above the hero headline",
      "Footer sits directly below the last article",
    ],
    language: "UNKNOWN",
    items: [
      {
        title: "Lead article — new scanning systems",
        kicker: "FEATURED",
        summary:
          "The featured article carries a hero image and a larger headline than the articles below it.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment",
        externalUrl: "https://www.axis-gps.com/",
      },
      { title: "Second article — software updates", summary: "Checking block spacing." },
      { title: "Third article — training", summary: "Checking secondary consistency." },
      { title: "Fourth article — events", summary: "Checking the final block." },
    ],
  },

  // ---------------------------------------------------------------- reply-to
  {
    id: "QA-REPLY-TO",
    subject: "Reply-To Verification",
    title: "Reply-To routing",
    purpose:
      "Verifies that pressing Reply addresses noreply@axis-gps.com and NOT the sending mailbox (ADR-0019). Please do not actually send the reply.",
    inspect: [
      "Press Reply and check the To field — it must read noreply@axis-gps.com",
      "It must NOT be axisgpscana@gmail.com",
      "Then DISCARD the draft — do not send it",
      "The footer still shows info@axis-gps.com as the way to contact AXIS",
      "The sender display name is still AXIS Advanced Mapping Solutions",
    ],
    language: "UNKNOWN",
    preheader: "Reply routing check.",
    items: [
      {
        title: "Reply-To check",
        kicker: "HEADERS",
        summary:
          "Press Reply on this message and confirm the address it would go to, then discard the draft.",
      },
    ],
  },

  // ---------------------------------------------------------------- footer
  {
    id: "QA-FOOTER",
    subject: "Footer and Unsubscribe Verification",
    title: "Footer and unsubscribe",
    purpose:
      "Verifies the footer carries exactly ONE small unsubscribe link and that no mail client shows an extra unsubscribe control generated by AXIS (ADR-0019/0024).",
    inspect: [
      "The footer has exactly ONE unsubscribe link, small, at the bottom",
      "There is NO unsubscribe button next to the sender name at the top of Gmail",
      "The footer shows info@axis-gps.com and the AXIS contact details",
      "Copyright line and company name are present and correct",
      "The unsubscribe link is not prominent, coloured, or button-shaped",
    ],
    language: "UNKNOWN",
    items: [
      {
        title: "Footer check",
        kicker: "FOOTER",
        summary:
          "Scroll to the bottom of this message and check the footer against the list above.",
      },
    ],
  },

  // ---------------------------------------------------------------- plain text
  {
    id: "QA-PLAIN-TEXT",
    subject: "Plain Text Fallback",
    title: "Plain-text alternative",
    purpose:
      "Verifies the text/plain part is readable on its own, for clients that block HTML entirely.",
    inspect: [
      "In Gmail: ⋮ → Show original, and read the text/plain section",
      "All article titles and summaries appear in the plain-text part",
      "The unsubscribe line appears as readable text",
      "No raw HTML tags leak into the plain-text version",
      "Line breaks make the text readable, not one long run-on paragraph",
    ],
    language: "UNKNOWN",
    items: [
      {
        title: "Plain text article one",
        kicker: "TEXT",
        summary:
          "This summary should appear intact in the plain-text alternative of the message.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Plain text article two",
        summary: "A second block, to confirm separation between articles in plain text.",
      },
    ],
  },

  // ---------------------------------------------------------------- long content
  {
    id: "QA-LONG",
    subject: "Long Content Boundary Test",
    title: "Long content boundary",
    purpose:
      "Verifies a long newsletter does not break layout and is not clipped by Gmail's message-size limit.",
    inspect: [
      'Gmail does NOT show "[Message clipped] View entire message" at the bottom',
      "The footer is visible without clicking anything",
      "Long headlines wrap instead of overflowing the 640px container",
      "No horizontal scrollbar appears",
      "Spacing stays consistent all the way down",
    ],
    language: "UNKNOWN",
    items: [
      {
        title:
          "A deliberately long headline that keeps going in order to test how the renderer wraps text inside the fixed six-hundred-and-forty pixel container",
        kicker: "BOUNDARY",
        summary:
          "This article and the six below it exist to push the message length up so that clipping and wrapping behaviour can be judged in a real client. " +
          "Each summary repeats enough text to be realistic without being absurd, because a newsletter that is clipped loses its footer and therefore its unsubscribe link.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment",
        externalUrl: "https://www.axis-gps.com/",
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        title: `Additional article ${index + 2} for the length boundary test`,
        summary:
          "Surveying teams collect field data with GNSS receivers and laser scanners, then transfer it to the office for processing. " +
          "This paragraph is repeated across several articles purely to increase the total message size for this test.",
      })),
    ],
  },

  // ---------------------------------------------------------------- CTA
  {
    id: "QA-CTA",
    subject: "CTA and Layout Verification",
    title: "Call-to-action buttons",
    purpose:
      "Verifies call-to-action buttons render as solid buttons, are tappable on mobile, and point at the right link.",
    inspect: [
      "The button under the first article is a solid blue button with a small corner radius, not a plain text link",
      "The button is easily tappable on a phone (not tiny)",
      "The link opens https://www.axis-gps.com/",
      "Button text is centred and not clipped",
      "Buttons look right in dark mode as well as light mode",
    ],
    language: "UNKNOWN",
    items: [
      {
        title: "Primary call to action",
        kicker: "LAYOUT",
        summary: "This article has a call-to-action button beneath it.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Second call to action",
        summary: "A secondary article with its own link, to compare button styling.",
        externalUrl: "https://www.axis-gps.com/",
      },
    ],
  },

  // ---------------------------------------------------------------- realistic
  {
    id: "QA-REALISTIC",
    subject: "General AXIS Newsletter Rendering",
    title: "Realistic newsletter",
    purpose:
      "A full, realistic AXIS newsletter — the closest thing to what a customer would eventually receive, so overall impression can be judged.",
    inspect: [
      "Overall impression: does this look like a professional AXIS newsletter?",
      "Logo, spacing, typography and colours are consistent",
      "Hero article draws the eye first",
      "Renders correctly in BOTH Gmail and Outlook",
      "Renders correctly in dark mode — text stays readable, logo still visible",
    ],
    language: "UNKNOWN",
    preheader: "Overall rendering check across clients.",
    items: [
      {
        title: "AXIS adds new scanning and GNSS equipment to its portfolio",
        kicker: "PRODUCTS",
        summary:
          "A realistic featured article with a hero image, a summary of a sensible length, and a call to action — the shape a real AXIS newsletter would take.",
        imageUrl: CLOUDINARY_IMAGE,
        imageAlt: "AXIS field equipment",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Firmware update available for field controllers",
        summary: "A short secondary item, as a real newsletter would carry.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Training sessions for surveying teams",
        summary: "A third item to complete a realistic three-article layout.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Premium redesign visual QA (ADR-0032)
// ---------------------------------------------------------------------------
//
// Eight scenarios written for ONE purpose: judging the redesigned layout in real
// inboxes. Each looks at a different aspect of it — right-to-left at both languages,
// hero-versus-secondary hierarchy, image scale and gutters, buttons and mobile — so
// that no two live emails are testing the same thing.
//
// The copy is SAMPLE MARKETING TEXT written for this test. It describes categories of
// equipment AXIS works with in general terms; it announces nothing, dates nothing,
// prices nothing, and names no customer. It is not approved customer copy and no
// campaign uses it.
//
// Only one hosted image exists in AXIS storage today, so scenarios needing several
// images reuse it deliberately. That is stated in the review notes rather than hidden:
// it still exercises image scale, repetition and spacing, which is what these ask.

const PREMIUM_HERO_IMAGE = CLOUDINARY_IMAGE;

const PREMIUM_SCENARIOS: QaScenario[] = [
  // ------------------------------------------------------------------ 1. Hebrew
  {
    id: "QA-PREMIUM-HE",
    subject: "Premium Newsletter Design — Hebrew",
    title: "Premium design — Hebrew",
    purpose:
      "Primary visual inspection of the redesigned premium layout in Hebrew: hero image, large headline, intro, call to action, two secondary articles and the footer.",
    inspect: [
      "The headline of the FIRST article is noticeably larger than the two below it",
      "The hero image runs edge to edge across the white sheet, above the headline",
      "Left and right margins look generous and equal (48px), not cramped",
      "The blue kicker sits above the headline in small spaced capitals",
      "The lead paragraph under the headline is lighter grey than the headline",
      "The button is a solid blue rectangle with a small corner radius, comfortably tappable",
      "Everything is right-aligned and the layout is mirrored",
      "Thin separator lines between articles are inset, not edge-to-edge",
      "The footer sits on a soft grey band with one small unsubscribe link",
    ],
    language: "HE",
    preheader: "בדיקת עיצוב — הגרסה החדשה של הניוזלטר",
    items: [
      {
        title: "פתרונות סריקה ומדידה מדויקים לצוותי שדה",
        kicker: "מוצרים",
        summary:
          "סורקים ניידים ומקלטי GNSS מאפשרים לצוותי המדידה לאסוף נתונים מדויקים בשטח ולהעביר אותם ישירות למשרד לעיבוד, מבלי לחזור על המדידה.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "ציוד מדידה בשטח",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "עדכוני קושחה לבקרי שדה",
        summary:
          "עדכוני קושחה תקופתיים משפרים את יציבות החיבור ואת זמן העבודה של הבקר בשטח. מומלץ לעדכן לפני יציאה לפרויקט ארוך.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "הדרכות לצוותי מדידה",
        summary:
          "מפגשי הדרכה קצרים מכסים תכנון מדידה, עבודה עם נקודות בקרה ובדיקת איכות הנתונים לפני העברתם למשרד.",
      },
    ],
  },

  // ------------------------------------------------------- 2. Multi-article (HE)
  {
    id: "QA-PREMIUM-MULTI",
    subject: "Premium Newsletter Design — Multi-Article",
    title: "Premium design — maximum hierarchy",
    purpose:
      "Tests the redesigned hierarchy at realistic length: one hero and three secondary articles, several images, and Latin product names inside Hebrew text.",
    inspect: [
      "The hero headline is roughly TWICE the size of the three headings below it",
      "The three secondary articles are consistent with each other — same heading size, same spacing",
      "Gaps between articles are even; none looks doubled or collapsed",
      "The hero image is full width; the images below it are inset to the text column and match each other exactly",
      'Latin names such as "Trimble X9" and "NavVis VLX" read correctly and are NOT reversed',
      "Model numbers stay together as one unit inside the Hebrew sentence",
      "The hero button is right-aligned; the \"read more\" links below it line up on the same edge",
      "Reading down the page feels ordered rather than like a stack of equal blocks",
    ],
    language: "HE",
    preheader: "בדיקת היררכיה — כתבה ראשית ושלוש משניות",
    items: [
      {
        title: "סריקת לייזר ומדידת GNSS בפרויקט אחד",
        kicker: "כתבה ראשית",
        summary:
          "שילוב בין סורק לייזר נייד למקלט GNSS מאפשר לכסות שטח גדול במהירות ולשמור על דיוק גבוה בנקודות הבקרה.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "ציוד מדידה בשטח",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Trimble X9 — סריקה במרחבים פתוחים",
        summary:
          "סורק Trimble X9 מיועד לעבודה בשטחים פתוחים ולסריקה של מבנים גדולים, עם עיבוד ראשוני כבר בשטח.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "סורק לייזר",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "NavVis VLX — מיפוי פנים מבנים בהליכה",
        summary:
          "מערכת NavVis VLX נישאת על הכתפיים ומאפשרת מיפוי של קומות שלמות תוך כדי הליכה, ללא עצירה בכל נקודה.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "בקרת איכות לנתוני RTK",
        summary:
          "בדיקת איכות הנתונים לפני העברתם למשרד חוסכת חזרה לשטח. יש לוודא כיסוי לוויינים מספק ותיעוד של נקודות הבקרה.",
      },
    ],
  },

  // ------------------------------------------------------------------ 3. Arabic
  {
    id: "QA-PREMIUM-AR",
    subject: "Premium Newsletter Design — Arabic",
    title: "Premium design — Arabic",
    purpose:
      "Arabic right-to-left review of the redesigned layout: hero image, large headline, secondary article, call to action, and an English product name inside Arabic text.",
    inspect: [
      "Arabic letters are correctly JOINED everywhere, in headings as well as body text",
      "The hero headline is clearly the largest text on the page",
      "The whole layout is mirrored and right-aligned",
      "Margins either side of the text look generous and equal",
      'The Latin name "Trimble R12i GNSS" reads correctly and is not reversed',
      "The button is solid blue with a small radius and sits on the correct side",
      "Punctuation sits at the correct edge of each line",
      "The footer band and the single unsubscribe link look calm, not prominent",
    ],
    language: "AR",
    preheader: "اختبار التصميم الجديد للنشرة البريدية",
    items: [
      {
        title: "حلول المسح والقياس الدقيق للفرق الميدانية",
        kicker: "المنتجات",
        summary:
          "تتيح أجهزة المسح المحمولة ومستقبلات GNSS لفرق العمل جمع بيانات دقيقة في الموقع ونقلها مباشرة إلى المكتب للمعالجة، دون الحاجة إلى إعادة القياس.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "معدات مسح ميدانية",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "جهاز Trimble R12i GNSS في العمل الميداني",
        summary:
          "يوفر جهاز Trimble R12i GNSS دقة عالية في تحديد المواقع، ويعمل مع نقاط التحكم الأرضية للتحقق من جودة البيانات قبل إرسالها.",
        externalUrl: "https://www.axis-gps.com/",
      },
    ],
  },

  // ------------------------------------------------------- 4. Multi-article (AR)
  {
    id: "QA-PREMIUM-AR-MULTI",
    subject: "Premium Newsletter Design — Arabic Multi-Article",
    title: "Premium design — Arabic hierarchy",
    purpose:
      "Verifies the redesigned hero-versus-secondary hierarchy holds under Arabic right-to-left, across a hero and three secondary items with images and buttons.",
    inspect: [
      "The first article is clearly the hero — largest headline, full-width image",
      "The three items below are compact and identical in treatment",
      "Arabic stays joined and right-aligned throughout, including inside headings",
      "Spacing between the four blocks is even",
      "Mixed Arabic and Latin text in the same sentence stays in the correct order",
      "The hero button and the links beneath it all sit on the right edge",
      "The last article sits cleanly above the footer with no cramped gap",
      "No horizontal scrolling is needed at any width",
    ],
    language: "AR",
    preheader: "اختبار التسلسل البصري — مقال رئيسي وثلاثة مقالات",
    items: [
      {
        title: "المسح بالليزر وقياس GNSS في مشروع واحد",
        kicker: "المقال الرئيسي",
        summary:
          "يسمح الجمع بين ماسح ليزر محمول ومستقبل GNSS بتغطية مساحات واسعة بسرعة مع الحفاظ على دقة عالية عند نقاط التحكم.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "معدات ميدانية",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Trimble X9 — المسح في المساحات المفتوحة",
        summary:
          "صُمم ماسح Trimble X9 للعمل في المساحات المفتوحة ومسح المباني الكبيرة، مع معالجة أولية في الموقع.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "ماسح ليزر",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "NavVis VLX — رسم خرائط المباني أثناء المشي",
        summary:
          "تُحمل منظومة NavVis VLX على الكتفين وتتيح مسح طوابق كاملة أثناء المشي دون التوقف عند كل نقطة.",
      },
      {
        title: "التحقق من جودة بيانات RTK",
        summary:
          "يوفّر فحص جودة البيانات قبل إرسالها إلى المكتب عناء العودة إلى الموقع. يجب التأكد من تغطية الأقمار الصناعية وتوثيق نقاط التحكم.",
      },
    ],
  },

  // ---------------------------------------------------------- 5. General layout
  {
    id: "QA-PREMIUM-GENERAL",
    subject: "Premium Newsletter Design — General Layout",
    title: "Premium design — overall impression",
    purpose:
      "Judges the redesign as a normal AXIS marketing newsletter would be judged: does the whole thing look professional and considered, left-to-right.",
    inspect: [
      "First impression: does this read as a designed marketing newsletter, or as a plain form email?",
      "The AXIS logo is sharp and correctly sized in the header, with a thin line beneath it",
      "The hero draws the eye before anything else on the page",
      "Type sizes step down clearly: headline, lead, secondary heading, body",
      "Colour is used sparingly — blue only for the kicker and the button",
      "Vertical rhythm is even; no block feels crowded against its neighbour",
      "The footer is quiet and clearly separated from the content above it",
      "It looks right in BOTH Gmail and Outlook, and in dark mode",
    ],
    language: "UNKNOWN",
    preheader: "The redesigned AXIS newsletter — overall rendering check.",
    items: [
      {
        title: "Precision scanning and GNSS measurement for field teams",
        kicker: "PRODUCTS",
        summary:
          "Mobile scanners and GNSS receivers let survey teams capture accurate field data and pass it straight to the office for processing, without a second visit to the site.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "AXIS field equipment",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Firmware updates for field controllers",
        summary:
          "Periodic firmware updates improve connection stability and battery life in the field. Update before a long project rather than during one.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Training sessions for surveying teams",
        summary:
          "Short sessions covering survey planning, working with control points, and checking data quality before it leaves the site.",
      },
    ],
  },

  // ------------------------------------------------------ 6. Images and spacing
  {
    id: "QA-PREMIUM-IMAGES",
    subject: "Premium Newsletter Design — Images and Spacing",
    title: "Premium design — images, gutters and balance",
    purpose:
      "Focuses on image scale, aspect ratio, gutters, spacing between sections, and overall visual balance in the redesigned layout.",
    inspect: [
      "The HERO image runs edge to edge across the white sheet; the images below it are inset to the text column — that difference is intentional",
      "All the inset images share exactly the same width, so the column edge stays straight",
      "No image is stretched, squashed, or cropped oddly — the aspect ratio is preserved",
      "The gap between an image and the heading under it is consistent in every article",
      "Left and right margins are equal and generous throughout the message",
      "Separator lines between sections are thin, inset, and light — not heavy rules",
      "Spacing above the footer is larger than the spacing between articles",
      "With images turned off, the layout still holds together and alt text appears",
      "The same photograph is used in several articles on purpose — judge scale and repetition, not the subject",
    ],
    language: "UNKNOWN",
    preheader: "Image scale, gutters and spacing check.",
    items: [
      {
        title: "Hero image at full sheet width",
        kicker: "IMAGES",
        summary:
          "The featured image runs the full width of the white sheet, edge to edge, with no margin either side. The text below it is inset by the normal gutter.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "AXIS field equipment, hero placement",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "Secondary image, first placement",
        summary:
          "A secondary article carrying its own image. It is inset to the text column rather than full width — check it lines up exactly with the text above and below it.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "AXIS field equipment, second placement",
      },
      {
        title: "Secondary image, second placement",
        summary:
          "A third image in a row, to judge whether repeated images keep an even rhythm or start to feel crowded.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "AXIS field equipment, third placement",
      },
      {
        title: "A text-only article for contrast",
        summary:
          "This article deliberately carries no image, so the spacing around a text-only block can be compared with the ones above it.",
      },
    ],
  },

  // ------------------------------------------------------- 7. Hebrew mixed copy
  {
    id: "QA-PREMIUM-HE-MIXED",
    subject: "Premium Newsletter Design — Hebrew Mixed Content",
    title: "Premium design — Hebrew with Latin product names",
    purpose:
      "A second opinion on right-to-left layout, concentrating on Latin product names and technical abbreviations set inside Hebrew sentences.",
    inspect: [
      'Each of these reads correctly and is NOT reversed: "Trimble X9", "Trimble R12i", "NavVis VLX", "GNSS", "RTK"',
      "A product name stays together as one unit and does not split across the line",
      "The Hebrew around each Latin name stays right-aligned",
      "Full stops and commas after a Latin name land at the correct edge",
      "The email address and web address are not broken apart",
      "The hero headline is still clearly the largest text despite the mixed content",
      "Nothing overflows the 640px sheet; no horizontal scrolling",
    ],
    language: "HE",
    preheader: "בדיקת שילוב עברית ואנגלית בעיצוב החדש",
    items: [
      {
        title: "Trimble X9 ו-NavVis VLX בפרויקט מדידה משולב",
        kicker: "טכנולוגיה",
        summary:
          "הסורק Trimble X9 והמערכת NavVis VLX משמשים יחד בפרויקטים שמשלבים סריקת חוץ ופנים, לצד מקלט Trimble R12i לקביעת נקודות בקרה.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "ציוד מדידה בשטח",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "עבודה עם GNSS ותיקוני RTK",
        summary:
          "מקלט GNSS עם תיקוני RTK מספק דיוק גבוה בזמן אמת. יש לוודא כיסוי לוויינים מספק לפני תחילת המדידה, ולתעד את נקודות הבקרה.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "פרטים נוספים",
        summary:
          "לשאלות טכניות ניתן לפנות לכתובת info@axis-gps.com או לעיין בפרטי המוצרים באתר https://www.axis-gps.com/products",
      },
    ],
  },

  // ---------------------------------------------------------- 8. CTA and mobile
  {
    id: "QA-PREMIUM-CTA",
    subject: "Premium Newsletter Design — CTA and Mobile Layout",
    title: "Premium design — buttons, mobile and long headlines",
    purpose:
      "Focuses on button styling, hero-to-secondary ratio, mobile hierarchy and how a very long headline behaves in the redesigned layout.",
    inspect: [
      "OPEN THIS ONE ON YOUR PHONE as well as on a computer",
      "On the phone: margins narrow but stay even, and no horizontal scrolling is needed",
      "On the phone: the hero headline shrinks but is still clearly the largest text",
      "The button is easily tappable with a thumb — not a thin strip",
      "The featured article has the ONLY filled button; the ones below use a small blue \"Read more\" link — check both look deliberate, not unfinished",
      "The very long headline in the first article WRAPS neatly and is not clipped or overflowing",
      "The hero headline is roughly twice the size of the secondary headings on both screens",
      "The footer stays readable and the unsubscribe link stays small on the phone",
    ],
    language: "UNKNOWN",
    preheader: "Buttons, long headlines and mobile behaviour.",
    items: [
      {
        title:
          "A deliberately long featured headline about combining mobile laser scanning with GNSS control points on large infrastructure sites",
        kicker: "LAYOUT",
        summary:
          "This headline is longer than any real one would be, so that wrapping, line spacing and the balance between the headline and the image can be judged at both screen sizes.",
        imageUrl: PREMIUM_HERO_IMAGE,
        imageAlt: "AXIS field equipment",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "A second article with a text link instead of a button",
        summary:
          "Secondary articles use a small blue link rather than a second filled button. Check that it still reads as something to click.",
        externalUrl: "https://www.axis-gps.com/",
      },
      {
        title: "A third article with no link at all",
        summary:
          "Without a link, the spacing below this article should still match the others rather than collapsing.",
      },
    ],
  },
];

/**
 * The hosted web version, end to end (ADR-0032).
 *
 * The one scenario that carries a "View as webpage" link, and it carries a REAL one:
 * the address is resolved from the named campaign's own public token at send time,
 * through the same deliverability gate every other caller uses. If the campaign has
 * no web version, or the configured origin is one a recipient could not reach, the
 * link is absent and the message still makes sense — which is the behaviour the
 * previous eight emails demonstrated.
 */
const WEB_VERSION_SCENARIO: QaScenario = {
  id: "QA-WEB-VERSION",
  subject: "View as Webpage — End-to-End Test",
  title: "View as webpage, end to end",
  purpose:
    "Verifies the whole hosted-web-version chain from a real inbox: the link appears near the top of the email, opens over HTTPS with no sign-in, and shows the same newsletter with its images loaded.",
  inspect: [
    'A small grey "View as webpage" link appears ABOVE the AXIS logo, at the top right',
    "It is quiet — small, muted, underlined — not a button and not brand blue",
    "Click it: the browser opens an https:// address, not http://",
    "The page shows the SAME newsletter you are reading in the email",
    "The logo, the hero image and the secondary images all load on the page",
    "You are NOT asked to sign in",
    "The page has no menu, no dashboard, no customer or audience information",
    "The page does NOT show the orange TEST banner",
    "Compare the email and the page side by side — the layout should match",
  ],
  language: "UNKNOWN",
  preheader: "Testing the hosted web version link.",
  webVersionCampaignName: "QA — Web version test (ADR-0032)",
  items: [
    {
      title: "Precision scanning and GNSS measurement for field teams",
      kicker: "PRODUCTS",
      summary:
        "Mobile scanners and GNSS receivers let survey teams capture accurate field data and pass it straight to the office for processing. This featured article carries the hero image and the only filled button.",
      imageUrl: CLOUDINARY_IMAGE,
      imageAlt: "AXIS field equipment",
      externalUrl: "https://www.axis-gps.com/",
    },
    {
      title: "Firmware updates for field controllers",
      summary:
        "A secondary article with its own image, so the page and the email can be compared block by block.",
      imageUrl: CLOUDINARY_IMAGE,
      imageAlt: "AXIS field equipment, secondary placement",
      externalUrl: "https://www.axis-gps.com/",
    },
    {
      title: "Training sessions for surveying teams",
      summary:
        "A third, text-only article completing the layout, so the spacing above the footer can be judged in both places.",
    },
  ],
};

/**
 * The retest.
 *
 * Identical in substance to `QA-WEB-VERSION`; it exists as a separate entry only so
 * the subject line says plainly which attempt a recipient is looking at. The first
 * attempt's link pointed at an ephemeral tunnel hostname that the provider dropped
 * while the SSH session was still connected — the message could not be repaired,
 * because the URL was already in somebody's inbox.
 */
const WEB_VERSION_RETEST: QaScenario = {
  ...WEB_VERSION_SCENARIO,
  id: "QA-WEB-VERSION-RETEST",
  subject: "View as Webpage — Tunnel Retest",
  title: "View as webpage, retest",
  purpose:
    "Repeats the hosted-web-version test against a fresh public HTTPS origin, after the previous temporary tunnel went away and left the earlier link dead.",
  inspect: [
    'A small grey "View as webpage" link appears ABOVE the AXIS logo, at the top right',
    "Click it: the browser opens an https:// address and the page LOADS (no \"no tunnel here\")",
    "The page shows the SAME newsletter you are reading in the email",
    "The AXIS logo, the hero image and the secondary image all load",
    "You are NOT asked to sign in",
    "The page shows no menu, no dashboard, and no customer or audience information",
    "The page does NOT show the orange TEST banner",
    "Compare the email and the page side by side — the layout should match",
  ],
};

/** The catalogue: general rendering checks, then the redesign review set. */
export const QA_SCENARIOS: QaScenario[] = [
  ...CORE_SCENARIOS,
  ...PREMIUM_SCENARIOS,
  WEB_VERSION_SCENARIO,
  WEB_VERSION_RETEST,
];

export type QaScenarioId = (typeof QA_SCENARIOS)[number]["id"];
