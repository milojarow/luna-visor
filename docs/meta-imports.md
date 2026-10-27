# Public Meta preview imports

`POST /api/files/import-meta` accepts `{ "url": "https://…" }` with the scoped API key of a **public ephemeral vault**. Owner/partner requests with multiple vaults also supply `client_id`. Admin keys cannot write. Permanent and private vaults cannot import Meta previews.

Only signed public raster-image / MP4 URLs on the allowed Facebook/CDN hosts are accepted. Never send Meta API tokens. Every redirect is revalidated. No Luna key goes to Meta. Images are bounded to 8 MiB and MP4 to 128 MiB, with two active downloads, bounded queue, 60 new URLs per minute per vault, 2 GiB per temporary vault and a 1 GiB disk reserve. Source hashes and content hashes permit cache reuse without storing signed URLs; equal bytes deduplicate within the same vault.

A cached result is HTTP 200 `{id,cdn_url,cached:true}`. New work returns HTTP 202 `{status:"pending",poll_url,retry_after:1}` immediately. The opaque, read-only `poll_url` is public for 15 minutes and can only resolve public CDN media. HEAD waits up to 25 seconds and GET up to 120 seconds; ready work redirects with HTTP 307, pending work returns 202 / Retry-After. Polling never authorizes import or access to a private vault. Browser HEAD follows the redirect to obtain the final CDN URL without transferring the image. Video GET follows to the CDN where range delivery occurs.

This is a temporary cache of public advertising previews, not storage for conversations. Ephemeral files retain the existing 24-hour expiry; cached imports are reused for at most 23 hours. Provider/network failures return an error without leaving output files. Restarted jobs may need a new import request; clients retry the small JSON request rather than hosting a fallback copy on Vercel.

Verification: `node --test tests/meta-import.test.js` covers host/redirect credentials, private/permanent exclusion, job capabilities, deduplication/concurrency, size/MIME/HTML/partial response rejection, backpressure, negative cache and transactional cleanup. The full existing suite must also pass.
