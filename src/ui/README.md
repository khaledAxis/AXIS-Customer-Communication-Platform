# `src/ui` — Reusable presentational components

Small, typed, **RTL-aware** presentational components shared across routes. Use Tailwind **logical**
utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start/end`) so components mirror correctly under
`dir="rtl"` for Hebrew and Arabic. Keep components presentational; data fetching and business logic
belong in Server Components/services, not here. Server Components by default; add `"use client"` only
where interactivity requires it.
