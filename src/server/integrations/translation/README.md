# Article translation

The TranslationProvider port accepts only selected article passages. The OpenAI adapter
uses a fixed HTTPS endpoint, structured JSON output, bounded batches and a shared timeout.
It has no CRM, email, browser/tool execution or approval capability. Configuration and
credentials stay server-side. Tests use a recording provider and cannot construct a live
adapter. Partial/provider errors never publish a translated article (ADR-0037).
