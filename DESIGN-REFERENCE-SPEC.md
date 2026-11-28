# Customer Portal Design Reference Specification

This file preserves the five user-provided reference screenshots for future chats and implementation. Do not ask the user to upload them again.

## Reference order and visual targets

All supplied screenshots are 1536 x 1024 px.

1. **Reference 1 — Luxury gold/black split booking + QR**
   - Near-black/navy background, gold/yellow accents, Krishna/Radha branding at upper left.
   - Horizontal rounded navigation across top.
   - Wide hero: promotional copy left, stainless-steel utensils / decorated event image right, curved gold divider.
   - Main row: New Booking panel on left; independent Advance Payment QR panel on right.
   - Booking fields arranged in two columns; colorful field labels; bright green submit.
   - Lower full-width booking tracker with search, document shortcuts, and progress steps.
   - Footer trust strip and purple thank-you ribbon.

2. **Reference 2 — Blue/purple dashboard with three-column body**
   - Deep navy background, vivid electric blue/purple glows, gold title/accent.
   - Centered brand heading and small logo; nav row below.
   - Large horizontal hero/banner with utensils and event decoration.
   - Body: booking form left, tracking/results center, stacked benefit cards right.
   - Footer with copyright and social icons.
   - Reference includes an Admin Login concept, but implementation must use Gmail/Google sign-in only; never expose secret key/token login.

3. **Reference 3 — Separate source image**
   - This PNG has a different Git blob SHA from References 1 and 2, so it must remain a distinct selector option. Its precise pixel geometry still requires a rendered visual comparison against the PNG; do not treat it as a duplicate of Reference 1.

4. **Reference 4 — RK crown logo, split booking and tracking**
   - Black/navy base with bright blue borders/glow, purple admin accent, gold/yellow text.
   - Compact top header with RK crown mark, title/tagline, navigation and Admin Login entry.
   - Hero banner with large utensils image, promotional text left, event copy right.
   - Main body: New Booking left, Check Your Booking Status right.
   - Booking panel has customer details, item selection, payment mode, advance payment block/QR and prominent confirm/reset controls.
   - Tracking panel shows search, booking result card, document buttons and progress rail.
   - Admin access must be Gmail-only despite the old reference's token/password visual.

5. **Reference 5 — Exact duplicate of Reference 4**
   - GitHub confirms this PNG has the same blob SHA and byte size as Reference 4. Keep a separate fifth selector entry as requested, but render it identically to Reference 4; do not invent a different fifth design.

## Non-negotiable implementation rules

- These are five distinct selector options. Ref 1 and Ref 3 intentionally render identically because their source images are duplicates.
- Build each reference as a complete customer-portal composition, not merely a palette swap or a few CSS variables.
- Preserve existing ERP business logic, booking submission, OTP, payment QR/UTR, customer tracking, and backend integrations. Rewire existing controls only when needed to move their presentation into the correct visual panel.
- Keep all existing working IDs and handlers wherever possible.
- The customer-facing portal must remain usable and responsive on mobile; adapt layout without horizontal overflow.
- Admin login must be Google/Gmail sign-in only, authorized by the existing admin UID allowlist. Do not show secret-key, admin-token, or password login fields.
- Do not claim pixel-perfect completion until desktop and mobile screenshots have been visually compared against these references and discrepancies corrected.
- User has exhausted upload quota. Do not ask for the reference screenshots again; use this specification and the images already present in the conversation context.
