# Product verification — November 6, 2026

## Result

49 automated domain/database/demo tests passed. Web and mobile TypeScript checks, the Next.js production build, and Android bundle export passed. All six sports returned real, non-stale data through both the local server and the deployed application. The Supabase security advisor returned no findings. This is **partial end-to-end verification**, not a claim that every browser/device flow passed.

Web deployment: https://overcall-genai.vercel.app (Vercel Authentication enabled). Vision Edge Function version 4 is active. Provider inference was tested directly using synthetic images; the deployed Edge Function still needs its OpenRouter secret.

## Each sport

Counts are observations from this run, not fixed expectations. A successful feed can legitimately contain zero matches on another date. Soccer currently covers the English Premier League.

| Sport | Production HTTP / matches | Fixed, match, free entry lifecycle | Direct provider image fixture |
| --- | --- | --- | --- |
| Cricket | 200 / 14 | Passed all three | Incomplete live score: no outcome suggested |
| NBA | 200 / 2 | Passed all three | Final home win read correctly |
| NFL | 200 / 15 | Passed all three | Final home win read correctly |
| Soccer | 200 / 1 | Passed all three | Full-time home win read correctly |
| MLB | 200 / 1 | Passed all three | Final home win read correctly |
| NHL | 200 / 11 | Passed all three | Final home win read correctly |

For each of the 18 lifecycle cases, the tests create a prediction, debit its stake, join the opposing side, enforce the entry amount, lock entries, propose evidence, reject premature settlement, collect human votes, settle once, conserve the ledger, and separately void/refund a prediction. They execute the actual migration functions in PGlite. The six demo cases also verify rejected proposals, immutable starting state, closed entries, and exact refunds.

Vision fixtures use the application's prompt and matching strict JSON schema. They check schema validity, null cricket-only fields for other sports, and temporal abstention for incomplete cricket evidence. These six generated fixtures are a smoke test, not an accuracy benchmark or proof of live broadcast interpretation. Earlier trials produced truncated output and invalid confidence values; the revised request passed this run. Human confirmation remains mandatory.

## Feature coverage

| Feature | Evidence and result | Remaining gap |
| --- | --- | --- |
| Email sign-in / sign-out | Native callback parser and TypeScript passed; web flow inspected | Real email delivery, click-through, sign-out and reload not exercised this run |
| Native deep link | Scheme/host/path and flow-ID validation passed | Dashboard redirect save and physical-device return still need verification |
| Create room / invite | Actual SQL create/invite used throughout database tests and live rollback smoke | Interactive form and multi-browser refresh not verified |
| Group permissions | Non-admin settings and admin-only creation rejected | Browser rendering of saved settings not verified |
| Confirmation settings | Majority, initiator-plus-one, admin policy; existing prop keeps its original rule | UI interactions not verified |
| Strict participation | Missing participant flagged on lock | Presence-based attendance is not implemented |
| Create prediction | All sports and all entry rules passed; demo rejects invalid sport, negative/fractional stake | Browser create dialogs and mobile tapping not verified |
| Join / stake | Fixed/match amounts, free amounts, duplicate entries, overspend and closed entries checked | Multi-session races on hosted service not exercised |
| Timer / manual lock | Expired timer rejects entry; manual lock lifecycle passes | Automatic sports-event locking is not implemented |
| Search / filters / sport tabs | Source reviewed; feeds independently validated for every sport | Interactive filtering and selected-match controls not exercised |
| Human result proposal / vote | Participant eligibility, quorum and duplicate settlement checked | Two authenticated browser sessions not exercised |
| Void / refunds | Admin restriction, reason, exact refund and final-state protection passed | Browser confirmation flow not exercised |
| Payout / wallet | Token conservation, deterministic remainder math, private ledger and no direct balance writes passed | Interactive wallet rendering not exercised |
| Daily reward | Exactly one grant per day in database and demo | Browser claim button not exercised |
| Chat | RLS rejects outsiders/impersonation | Newest-100 query fixed; interactive send/realtime/render not exercised |
| Public feed | Caller identity enforced in SQL | Posting form and realtime updates not exercised |
| Follows | Insert/delete and private following list checked | Full follow/profile UX is not implemented |
| Leaderboard | Balance query/rendering reviewed | Ranking interactions and multiple room views not exercised |
| Live sports | Six production and local HTTP 200 checks, correct sport, valid team/event schemas, freshness metadata | No contractual provider SLA; cricket RSS has unknown phase |
| Feed failures | Parser rejects malformed/provider-error payloads and XML entity payloads | Cache expiry, concurrent requests and outage recovery not fault-injected this run |
| Vision provider | Real OpenRouter authentication and synthetic-image inference passed | Secret is local only; authenticated app → Edge → provider → database flow remains blocked |
| Vision safeguards | Server-only logging, throttling, failed-attempt audit and no self-confirmation tested | Upload and screen-capture interactions not exercised this run |
| Broadcast authorization | Host exclusivity, membership, sender identity, private inbox and ended-session rejection checked; live SQL signaling smoke passed | Real media over hosted signaling not exercised this run |
| Broadcast video / cleanup | Previous development test delivered real frames; source cleanup reviewed | Not rerun in this pass; physical devices, separate networks and TURN-only connection remain untested |
| ICE endpoint | Production HTTP 401 without session; local invalid bearer also rejected | Valid-session relay configuration not exercised; no TURN service provisioned |
| Production QA route | HTTP 404 confirmed | None for exposure check |
| Native app | TypeScript and Android bundle passed; creation now offers all six sports | No physical Android/iOS run; native vision/broadcast capture is not implemented |
| Responsive layout / accessibility | Existing labels and semantic controls reviewed | No new visual viewport, keyboard, screen-reader or mobile browser pass |

## Fixes made during this pass

- Mobile creation offers all six sports instead of always creating Cricket predictions.
- Vision receives the prop's sport, uses a sport-aware prompt, and leaves cricket-only fields null for other sports.
- Vision disables optional reasoning for this bounded extraction, reserves 2,000 output tokens, and explicitly constrains confidence to 0–1. Validation still rejects invalid responses. [OpenRouter reasoning reference](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/reasoning-tokens.mdx).
- Demo commands execute inside the error handler before setting React state, so domain errors can be reported normally. Demo creation also uses shared validation.
- Chat fetches the latest 100 messages and restores chronological display order, rather than permanently showing the oldest 100.
- Empty cricket feeds show an empty state rather than incorrectly asking to connect an already configured feed.

## Reproduction

```powershell
npm test
npm run typecheck
npm run build
npm run typecheck --prefix apps/mobile
# In apps/mobile:
npx expo export --platform android --output-dir dist
# Start npm run dev, then from repository root:
node --env-file=apps/web/.env.local --import tsx scripts/smoke-live.ts
```

`tests/live-smoke.sql` verifies hosted Postgres inside a transaction and rolls back all synthetic users/rooms. Production endpoint checks were made with authenticated `vercel curl`, retaining deployment protection. They did not create app sessions or grant anonymous access.

## Concrete blockers

Browser discovery reports local browser use disabled in Work settings. Native Chrome snapshots work, but text/keyboard navigation did not reliably reach the app. This prevented a trustworthy interactive browser pass. No browser setting was changed and no UI pass was inferred from HTTP results.

Supabase CLI authentication is absent and the connector does not provide secret writes, so the local OpenRouter key could not be installed as a Function Secret. No secret was embedded in function source or committed. The supplied key metadata previously showed no spending cap and a December 4 expiry; rotation and the requested settings remain pending.

No TURN relay or physical test devices are configured. Default Supabase email sending also needs production SMTP before a broader release. These items must be completed before declaring the whole product end-to-end verified.
