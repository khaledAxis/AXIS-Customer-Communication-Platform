# Background execution

The scheduler authenticates through a dedicated server secret; it accepts no actor or job payload.
Only internally claimed PostgreSQL rows enter this async context. The session DAL re-reads their
lease and stored delegating staff user for every capability check, limits capabilities by job kind,
and never grants background approval or user administration. Business services remain authoritative.
