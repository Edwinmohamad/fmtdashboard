# v3.0.0 — Apple-style UI redesign

- Total visual redesign using an Apple-inspired system font stack and spacing scale.
- New translucent sidebar/topbar surfaces with light and dark appearance support.
- Rebuilt cards, tables, forms, buttons, badges, modals, upload, signing workspace and user-management surfaces.
- New minimal centered login with stronger BDX branding.
- Cleaner dashboard hierarchy and softer operational status presentation.
- Responsive tuning for 1366px, 1440px, tablet and mobile layouts.
- No business logic, route, database schema or permission behavior changed by this UI release.

# Changelog

## 2.4.0 — Upload Reliability + Brand Clarity + Safe Delete

- Reworked Attendance PDF upload UX with drag/drop, selected-file list, client-side PDF/size validation, upload progress, and actionable errors.
- Attendance upload now uses the explicit `attendance.upload` permission on both GET and POST routes.
- AJAX upload returns structured JSON and routes HTTP upload errors back into the page instead of an opaque error screen.
- Added a production upload smoke test to the CasaOS installer to verify actual multipart PDF upload, storage write access, database creation, and cleanup.
- Strengthened BDX logo treatment on the login screen and application sidebar while preserving image aspect ratio.
- Added permission-gated delete actions for Attendance, Asset FMT, Tools Inventory, Consumables, Signatures, and Change/Incident/Problem tickets.
- Delete actions require confirmation and remove associated uploaded files where safe.
- Signatures already used in signed-document history cannot be permanently deleted; they must be disabled to preserve audit integrity.
- User accounts remain disable/enable rather than casually deletable to protect audit traceability.
- CSS/JS cache key bumped to 2.4.0.
