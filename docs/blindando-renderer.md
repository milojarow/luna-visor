# Blindando posts in Luna

The dedicated **public ephemeral** vault `blindando-post-preview-temporal` may call `POST /api/files/render-blindando`. Other clients, private vaults and permanent vaults are refused. The authenticated request receives cached `cdn_url` or the same opaque public job protocol as Meta imports. The existing website/n8n image URL can follow a short redirect chain to the final public WebP without downloading/rendering on Vercel.

The template was extracted unchanged from web-blindando `6183f33` (`app/api/og/post/route.js`). `renderers/blindando/template.jsx` is the readable original JSX, and `template.js` is its checked-in CJS form (esbuild 0.25.2, JSX transform). Font files are the original software fonts; logo/background images are fetched exclusively from Luna. Satori 0.26.0, resvg 2.6.2 and React 19.1.0 match the original renderer. Sharp is patched to 0.35.5 rather than installing a decoder affected by upstream advisories. Both a square and an IG render with background matched the old production result **pixel for pixel** (zero channel difference).

Install the isolated worker dependencies with `npm ci --prefix renderers/blindando --ignore-scripts`. The main app uses its own Sharp 0.35.5; existing native DB/password install scripts are explicitly pinned. Run `node --test` before release.

One worker runs at a time, with at most eight queued renders and 20 new inputs per minute. The JS heap is limited to 128 MiB and execution to 30 seconds; raster dimensions are fixed at 1080 square or 1080x1350. Background download is limited to 8 MiB / 50 megapixels, public Luna UUID images only, no redirects. Vault limit 2 GiB and free-disk reserve 1 GiB. All output stays in the existing 24h ephemeral policy, with cache reuse limited to 23h. Private attachments are never accepted.

API input: `headline` up to400 chars, `product` up to120, `bullets` up to4 strings of240 chars (legacy pipe-separated string supported), six-digit hex `color`, optional public Luna raster `bg`, and `format` `square` or `ig`. No changes to financial/product content or publishing workflows. Synthetic renders only are used for validation, no Facebook publication.
