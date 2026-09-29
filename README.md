# FMT Operations Dashboard — Site TBS

Version **2.4.0**.

## Default CasaOS access

- Container port: `8096`
- Installer prefers host port `8096` and searches upward if occupied.
- Default bootstrap login requested for this deployment: `admin / admin`.

## Attendance upload

The upload page supports multiple PDFs, drag & drop, selected-file preview, 50 MB per-file validation in the CasaOS deployment, progress feedback, and structured upload errors. Successful upload opens the relevant Signing Workspace batch automatically.

## Delete controls

Permanent delete is permission-gated and available where operationally appropriate: Attendance, Asset FMT, Tools Inventory, Consumables, unused Signatures, and tickets. Audit-sensitive records are protected. User accounts should normally be disabled rather than deleted.

## Security note

Change the default admin password before exposing this service outside the trusted LAN.
