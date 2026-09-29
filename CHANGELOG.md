# Changelog

## 3.2.0 — Apple Design System + Signing Hardening

### Apple-style UI overhaul
- Rebuilt the global visual system around Apple-like system typography (`-apple-system`, `BlinkMacSystemFont`, SF Pro fallbacks), neutral surfaces, restrained blue accent, subtle borders and blur.
- Reworked light and dark mode tokens across the complete application.
- Simplified login into a focused, centered, high-contrast secure workspace with a more prominent BDX logo.
- Reworked sidebar, topbar, navigation states, account menu, notification popover, cards, tables, forms, buttons, badges, tabs, modal, command palette, empty states and responsive behavior.
- Fixed mobile sidebar JS/CSS class mismatch.
- Fixed Operational Health ring CSS variable mismatch.
- Fixed 5-stage attendance pipeline layout.
- Removed misleading static Application/Database health pills from Dashboard; status rail now uses actual operational data.
- Added consistent visual treatment for review/detail pages, PDF viewer, inventory statistics, user/profile pages and permissions.

### Signing workflow hardening
- Signed/Final/Archived attendance records can no longer be signed again directly.
- A fresh PDF revision can be uploaded after a Signed version for intentional re-signing; old signing pointers are cleared while previous versions remain in history.
- Bulk signing now requires both `attendance.sign_bulk` and `attendance.sign`.
- Signature authorization is revalidated during placement, saved-template application, final preview and final sign.
- Signature template matching now checks page dimensions, rotation and a whole-document layout fingerprint.
- Final signing database changes are atomic per document using a single SQLite transaction.
- Generated output is deleted if the database transaction fails.
- Signed PDF validation now checks that every expected signature region is visibly changed, in addition to file integrity, page count and SHA-256 checksum.
- Signature management permissions are tightened; non-managers may only manage their own signature when allowed to sign.
- Final Sign button is UI-gated until an exact Final Preview has successfully rendered.

### Interaction cleanup
- Kept one primary action for each workflow step.
- Preserved functional notification, search, theme, account menu, upload, template, preview, sign, delete and workflow actions.
- No dummy UI controls were added.
