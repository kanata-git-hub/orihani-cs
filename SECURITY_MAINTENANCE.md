# Security maintenance — 2026-09-20

AI endpoints now verify the Firebase ID token used by the existing Google sign-in. Current signed-in access, models, prompts and output are retained. Run `npm run test:security`, `npm run lint`, and `npm run build`.

Patient drafts are scoped to Firebase UID and protected components remount when accounts change. A restored login migrates its existing draft contents unchanged. Unattributed logged-out legacy data remains under the old keys and is not exposed to the next login; confirm its original owner before recovery. Browser storage remains local and unencrypted.

Refresh open tabs after deployment to use authenticated API calls. The per-instance burst limit is 600 requests/minute and 32 concurrent per UID; it is not a distributed billing cap. Dependency fixes stay within the existing major versions. Firestore policies remain unchanged and were checked in an emulator.
