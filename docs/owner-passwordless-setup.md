# Owner passwordless setup and release checks

The owner layout accepts email OTP before rendering the existing owner page, which handles TOTP. The server owner API remains the authority and requires confirmed owner email plus aal2. The approved address in the layout must match the server OWNER_EMAIL environment variable. Client email filtering is not an authorization boundary.

## Supabase configuration required
- Enable email authentication. Account creation must be permitted for first passwordless sign-in, or provision/invite the owner through the supported Auth administration flow.
- Configure the Magic Link email template to show the six-digit code using {{ .Token }}. Example body: <h2>Dong Gas owner sign-in</h2><p>Your code is {{ .Token }}</p><p>Do not share this code.</p>
- Verify SMTP delivery, provider limits, OTP expiry and rate limits for production. The UI cooldown is only a convenience, not server abuse protection.
- Passwordless sign-in with shouldCreateUser creates an Auth user, not owner privileges. Keep server authorization and database restrictions.
- Complete first authenticator enrollment on the owner device. Never put the authenticator secret in logs or chat.

## Must pass before production approval
1. New owner receives code and completes email verification.
2. No dashboard data without server-accepted owner identity and MFA.
3. Existing owner completes TOTP challenge after email sign-in.
4. Wrong/expired email codes, resend limits, wrong TOTP, reload and sign-out behave correctly.
5. Handle interrupted authenticator enrollment and agree a secure recovery procedure.
6. Successful TypeScript/build verification and deployed browser tests.
7. Restrict public database policies and test supervisor upload paths.

This commit does not change Supabase email templates, SMTP, RLS policies, or existing Auth users. It does not prove production readiness.
