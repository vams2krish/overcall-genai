# Client API

All commands require a valid Supabase Auth session. Monetary and state mutations go through `supabase.rpc('prop_command', { action, payload })`; clients must never write the affected tables directly.

| Action                     | Payload                                                                       | Authorization / condition                                 |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| create_group               | `{name}`                                                                      | Authenticated user becomes owner/member                   |
| create                     | `{group_id,title,sport,side,stake,entry_type,entry_amount,minutes,lock_type}` | Member, or owner if group creation setting requires admin |
| join                       | `{prop_id,side,stake}`                                                        | Member, open prop, unexpired timer, no previous entry     |
| lock                       | `{prop_id}`                                                                   | Creator/admin, or member once timer has expired           |
| await                      | `{prop_id}`                                                                   | Group member, prop locked                                 |
| vision_start / vision_stop | `{prop_id}`                                                                   | Group member, awaiting result                             |
| propose                    | `{prop_id,side,evidence}`                                                     | Participant/admin, awaiting result                        |
| vote                       | `{prop_id,approve}`                                                           | Participant, or owner for admin policy                    |
| settle                     | `{prop_id}`                                                                   | Group member, human-confirmed, both pools funded          |
| void                       | `{prop_id,reason}`                                                            | Owner, nonfinal prop, reason >= 5 characters              |
| daily                      | `{}`                                                                          | Once per UTC day                                          |

Group administration: `supabase.rpc('manage_group', {gid, action, payload})`.

- `invite`: `{user_id}`; invitee must already have an account; maximum 10 members.
- `settings`: `{strict_mode,confirmation_rule,who_can_create_props,ai_confidence_threshold}`. Settings are editable by the owner. Strict mode increments `missed_props` for expected members who have not entered when a prop locks. It flags; it does not auto-remove users. Expected means all members when a prop opens, not device-presence detection.

Example:

```ts
const { data, error } = await supabase.rpc("prop_command", {
  action: "join",
  payload: { prop_id: prop.id, side: "no", stake: 20 },
});
if (error) throw error;
```

## Vision

1. Move locked prop to awaiting_result with `await`.
2. Call `vision_start`.
3. `supabase.functions.invoke('vision', {body: {prop_id,image,source}})`.
4. `image` must be a JPEG, PNG, or WebP base64 data URL; `source` is `screenshare` or `upload`.
5. The function validates token, RLS visibility, session state, frame size, and rate gate. OpenRouter receives only the proposition and image.
6. A valid high-confidence extraction may create an AI proposal. The function never calls vote or settle.

Responses: 401 invalid session; 404 inaccessible prop; 409 inactive session or changed state; 413 oversized frame; 429 rate gate; 503 missing provider configuration; 502 provider/validation failure. Human evidence entry remains available without vision.

## Standard pool shares

`marketShare(yesStake, noStake)` calculates the percentage of committed tokens on Yes, returning 50/50 for an empty pool. This is an in-house pool indicator, not an external odds API, a forecasting model, or a house-odds feed.

## Public feed and follows

Authenticated users can select/insert `feed_posts`, with their own ID as author. Only authors can create their posts. Private prop contents are never automatically posted. `follows` supports SELECT, INSERT, DELETE only where `follower_id = auth.uid()`. These primitives are available for richer social experiences; the web release exposes feed posting, while full follow/profile UI is deferred.
