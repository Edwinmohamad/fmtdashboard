# FMT Operations Dashboard — Site TBS

Version **2.8.13**.

## Branding

The application ships with a default `app/static/bdx-logo.png` mark and is used automatically until a custom logo is uploaded under Settings → Branding (or `uploads/branding/bdx.logo` is present for NAS installs). The interface uses a navy BDX + white/neutral-gray palette in both Light and Dark mode, with a flat, low-decoration visual style (minimal shadows, small border radius, no gradients/glow).

## Default CasaOS access

- Container port: `8096`
- Installer prefers host port `8096` and searches upward if occupied.
- Default bootstrap login requested for this deployment: `admin / admin`.

## Attendance upload

The upload page supports multiple PDFs, drag & drop, selected-file preview, 50 MB per-file validation in the CasaOS deployment, progress feedback, and structured upload errors. Successful upload opens the relevant Signing Workspace batch automatically. The Signing Workspace lets you position a signature once and apply it to every selected PDF that shares the same page layout/size; documents with a different layout are flagged (by filename) so their signature position can be adjusted manually. A "Select same layout" action quickly selects every queued document matching the currently open one's page size (and auto-enables "apply to selected" when it finds more than one match), and documents that already have a saved placement show a "Placed" indicator in the queue. If a matching saved position exists for the signature/layout, it's suggested automatically when you open a new document, and a "Reset position" action snaps back to the default box. The 4-step guide reflects your real progress, any signing failures are listed by filename in the workspace, and Prev/Next page buttons are available both at the top of the preview and duplicated at the bottom so you never need to scroll back up while positioning a signature.

An "Auto-detect" panel in the document queue scans every queued, unsigned PDF's actual text for the app's standard anchor phrases ("Menyetujui", "Mengetahui Atasan Langsung") and automatically places and checks documents where a keyword matches exactly once per page; documents with an ambiguous or missing match are flagged "needs review" and left for manual placement — nothing is ever placed or signed without a confident text match, and the final "Sign Selected PDFs" confirmation step is unchanged.

Not every signature needs its own trip through the main dropdown. Once a document is open, every placement already on the page you're viewing renders at once, directly on the PDF — adding another instance, or switching which one you're positioning, never hides the ones already there. Each box carries its own small toolbar: **+** adds another instance to the page (with no cap on how many, and no restriction to signatures not already there, so the same signer can be stamped in more than one spot just as easily as placing two different signers), **×** removes exactly that one instance, and a checkbox explicitly confirms and locks its position in place. Clicking anywhere else on a non-active box's body promotes it to the one you're currently positioning. Dragging or resizing a box saves its new position automatically on release (confirmed by a banner near the top of the screen) and never locks it by itself — you can keep repositioning the same box as many times as you like; only checking its own checkbox freezes it, and unchecking frees it again. "Sign Selected PDFs" refuses to sign a document that still has any unconfirmed placement — most relevantly a fresh extra instance added via **+** that hasn't been checked yet — with a count of how many shown up front in the confirmation dialog so you know before you click Sign, not after. Once every document in the current batch has been signed, the workspace returns you to the Attendance list with a confirmation message instead of staying on an empty queue.

Not every page of a document has to be signed. A row of numbered page buttons in the Position on PDF step lets you click through exactly which pages need the signature — click a page to toggle it, Shift-click a second page to turn on the whole range between them — and a "Pages to sign" text field (e.g. `1,3,5` or `1-3`) stays in sync for typing a range in one go instead. Handy when auto-detect or a batch apply placed more pages than actually need a signature, or when only a few pages out of a long document need one at all.

The page grid above only ever moves whichever ONE signature is currently selected in the dropdown, so a page holding two (or more) different signatures needs a separate control when you want to carry all of them forward together: "Copy every signature on this page to" — type a page range (e.g. `4-10`) and click Copy, and every signature currently placed on the page you're viewing is replicated, each at its own position, to every page you listed. Nothing already on a target page is changed — it only ever adds what's missing.

## Dashboard widgets

Alongside the System Status widget and KPI cards, the dashboard shows a weekly trend bar chart, a "Team Activity" panel (who uploaded or signed documents in the last 7 days), a "Waiting Too Long" panel (open attendance documents idle for more than 3 days, oldest first), and an "Open Tickets by Priority" breakdown — all summarizing existing data with no new record types.

## Delete controls

Permanent delete is permission-gated and available where operationally appropriate: Attendance, Asset FMT, Tools Inventory, Consumables, unused Signatures, and tickets. Audit-sensitive records are protected. User accounts should normally be disabled rather than deleted.

## Security note

Change the default admin password before exposing this service outside the trusted LAN.
