# Owner reporting release gates

Status: NOT EXECUTED. A checklist is not test evidence. Record commit, deployment, tester, device, actual result and evidence per case. Never use real financial records as fixtures.

## Data semantics
- A local draft or pending upload exists only on that browser; the owner cannot observe it remotely. Do not label local data as received by the owner.
- Server upload confirmed means the submission RPC returned accepted=true and local synced status was durably saved. It does not prove the owner viewed the report.
- The owner list reads server shifts through an owner-authorized API. Filters may hide a received report.

## Accuracy fixtures (isolated test environment only)
Opening 100, closing 110, price GHS 10: volume 10 L, expected GHS 100. Cash 60 + MoMo 30 + expenses 10 = accounted 100, variance 0.
Same readings and price, cash 50 + MoMo 30 + expenses 10: accounted 90, variance -10 (shortage).
Same readings and price, cash 70 + MoMo 30 + expenses 10: accounted 110, variance +10 (overage).
Two balanced fixture shifts: cash 120, MoMo 60, expenses 20, volume 20, expected 200, accounted 200. Collections excluding expenses = 180. Never equate collections with expected sales.
Check fractional readings, decimal prices, missing fields and rounding. Reject negative/non-finite fields; missing financial values must not silently count as verified zero. Preserve stored variance and distinguish it from any newly calculated value.

## Required tests
1. Build and type-check exact release commit; run lint and record failures.
2. Email OTP delivery, incorrect/expired codes, resend, MFA enrollment and challenge, recovery and sign-out. Never record OTP or MFA secrets in evidence.
3. Owner API refuses missing token, wrong identity and aal1. Correct owner aal2 succeeds.
4. Offline completion remains pending locally; owner list does not claim receipt. No automatic upload of legacy test reports.
5. Send reviewed fixture online; verify one server row and matching photos/financial fields. Open owner list with filters cleared; next successful visible-page refresh must show the row. Record latency; 15-second polling is not an instant-delivery guarantee.
6. Simulate lost response after commit, retry same client reference: exactly one row, baseline advanced once. Conflicting content with same reference must be rejected.
7. Two devices submit against same opening baseline: verify concurrency behavior and no silent overwrite.
8. Network failure on owner refresh preserves displayed rows and displays stale-data warning; reconnect recovers. Sign-out clears private content.
9. Search and all date filters, print, opening/closing photos, phone portrait, keyboard focus and horizontal table scrolling.
10. Check report counts beyond the database default row limit; ensure no silent truncation before release.

Production fixture insertion, baseline changes, deployment and record deletion each require explicit action approval. Supervisor access stays open by the user's decision; that accepted risk is not resolved by these tests.
