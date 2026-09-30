# Implementation Status — v3.5.0

Attendance signing workspace now uses editable copy-to-page behavior instead of hard locks. Visual page boxes, auto-save state, unsigned-page navigation, completion status, keyboard shortcuts, undo/redo, add/remove/duplicate, drag/resize, exact preview and final signing are implemented. Legacy v3.4 lock rows are detached automatically on edit/copy for upgrade compatibility.

# FMT Operations Dashboard — Implementation Status

Current version: **3.4.0**

## Signature placement workflow
Implemented and tested:

1. Open PDF and choose a master page.
2. Add one or more signature boxes.
3. Drag / resize / duplicate / remove boxes freely on the master page.
4. Enter target pages (`2-5`, `2,4,6-8`, etc.).
5. Click **Save & Lock**.
6. Compatible target pages receive the exact master placement and become linked/read-only.
7. Editing the master and saving again automatically synchronizes all linked pages.
8. A target page can be **Unlocked** at any time; its current boxes remain and become independently editable.
9. Final Preview and signing use the actual saved placements.
10. Successful signing removes temporary placement-lock workspace data.

## Safety rules
- A locked target cannot be directly edited until unlocked.
- A page already acting as a master cannot be made a child target, preventing chained/cyclic locks.
- Size/rotation mismatch is skipped rather than forced.
- Add/remove remains supported on master and independent pages.
- Original PDF remains preserved by the signed-version workflow.

## v3.5.1 signed-output controls
- Post-sign success modal keeps the result visible instead of immediately reloading.
- Direct signed-PDF download and document-open controls are available after signing.
- Download endpoint is protected by `attendance.download` permission and only serves Signed/Final verified outputs.
- Current-page `Save now` control remains available before final signing; final signing itself persists a new verified PDF version automatically.
