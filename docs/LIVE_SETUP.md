# Live service configuration

Overcall uses its own Supabase project, `tcnrzqtiwgffrzgqfhgl`, in West US. This is a dedicated backend for the app.

## Hosted application

Production deployment: [overcall-genai.vercel.app](https://overcall-genai.vercel.app). Vercel Authentication remains enabled; this is an owner-protected deployment, not an anonymous public release. The app also has its own Supabase sign-in. Vercel CLI deployment is available from the authorized account; Git auto-deployment is not linked.

## Supabase

- Core schema, broadcasting, and production-hardening migrations are deployed.
- RLS is enabled on all 16 application tables. Privileged user commands live in a private schema behind caller-privilege public wrappers.
- The vision Edge Function is deployed and verifies Supabase bearer tokens itself.
- Auth Site URL is the production HTTPS origin. Allowed redirects are that exact origin, localhost:3000, 127.0.0.1:3000, with the native `overcall://auth/callback` prepared but pending final dashboard verification.
- The built-in email sender/default templates are in use. Configure a production SMTP provider before opening sign-ups to a friend group; sender restrictions and quotas still apply.
- Native sign-in supports the default email magic link using PKCE. OTP entry remains available for a future custom template. Native device testing is still required.
- Web and Expo public connection fields are stored in ignored local environment files. No server/provider credentials belong in a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` variable.
- Live Postgres smoke checks validated membership isolation, human quorum, atomic payouts, and private signaling. Synthetic test data was rolled back.
- Supabase security advisors reported no findings after the hardening migration. Unused-index informational notices are expected on a new database.

For a different deployment, apply the migrations to the chosen project and configure its public URL/key. Email Auth must allow the exact web origin; add the deployed HTTPS origin to URL Configuration before sending sign-in links. Do not use wildcard redirect URLs.

## OpenRouter

A user-supplied OpenRouter key is saved only in the ignored local web environment file. Authentication succeeded and the configured model correctly read a generated scoreboard image as 123 / 4. Provider metadata reported no spending cap and an expiration of December 4, 2026; this differs from the requested $1 total cap and no expiration. Rotate the chat-exposed key and correct those settings in OpenRouter.

Deployment of Function Secrets is still pending: the Supabase CLI has no authenticated access token and browser control cannot initialize. The local key is not available to the deployed Edge Function.

The Edge Function needs `OPENROUTER_API_KEY` and `OPENROUTER_VISION_MODEL` in Supabase Function Secrets. Key creation and availability of credits are separate from deploying the function. A deployed function with missing provider secrets returns an explicit 503; it never invents a model response.

The configured development model is `nvidia/nemotron-3.5-super-vl:free`, selected from the provider's current catalog for image and JSON-schema support. Availability, free-tier limits, privacy, and provider eligibility can change. Use a paid model only with an appropriate account budget. No funds are automatically purchased by this project.

Direct OpenAI credentials remain optional future placeholders; no direct adapter is enabled.

## Live sports

`GET /api/sports?sport=Cricket|NBA|NFL|MLB|NHL|Soccer` runs on the Next.js server.

- NBA/NFL/MLB/NHL and Premier League soccer: ESPN public scoreboards, cached for 30 seconds per server instance.
- Cricket: [ESPNcricinfo live-scores RSS](https://static.espncricinfo.com/rss/livescores.xml), cached for 120 seconds. Basic current scores work without a key. RSS does not provide authoritative match-phase/player/over-event details, so phase is explicitly `unknown`; it cannot independently resolve a prop.
- Optional richer cricket data: set `CRICKETDATA_API_KEY` server-side to use CricketData.org currentMatches instead of RSS.
- Provider errors retain the last fetched score with an explicit stale notice; unavailable feeds never fall back to fictional scores. RSS older than ten minutes is marked stale.
- Public ESPN endpoints do not come with a contractual SLA. Obtain appropriate provider terms/licensing and a service plan before a commercial launch. No Odds API is used. Pool shares remain in-house token proportions.

## WebRTC broadcasting

The host selects a scoreboard window/tab. Audio capture is disabled. An authenticated, single-host session is created for the group; viewers choose Watch scoreboard. SDP and ICE messages use recipient-only Supabase rows, with database-assigned sender identity. A 90-second host lease is renewed every 20 seconds. Inbox messages expire and are collected on session-control operations; received messages are deleted after processing. This is a small-group mesh, limited to nine viewers per host.

Media travels directly between browsers, or through TURN when configured. Supabase carries signaling, not video. Offers/candidates are never sent to a public broadcast topic. Leaving, ending capture, or closing/unmounting the room closes peer connections and stops the host tracks. The live room stream can be sampled by the existing vision flow; the user does not need to start another screenshare.

`/api/rtc/ice?group=<id>` requires a valid user bearer token and group membership. It returns STUN configuration and, when available, one-hour coturn REST credentials. Set `TURN_URLS` and `TURN_SHARED_SECRET` on the Next.js server to enable the relay. The long-lived shared secret never reaches the browser.

A coturn template is in `infra/coturn/turnserver.conf.example`. Deploy it on a host with a public IP, configure TLS and firewall ports, and use the same shared secret in the app. Direct WebRTC is operational without TURN, but some NAT/firewall combinations cannot connect until a relay is configured. No TURN host or paid relay account is provisioned automatically.

## Verification boundaries

- Production RoomBroadcast peer logic delivered actual synthetic video frames between two real browser RTCPeerConnections.
- That development fixture uses in-memory signaling; Supabase authorization and message isolation were independently verified with live Postgres and migration tests.
- Two physical devices on separate networks and a forced TURN-only connection still need a configured relay and a device test.
- The fixture at `/qa/webrtc` is available only in development and returns 404 in production.

These distinctions prevent a local loopback result from being presented as proof of arbitrary internet connectivity or paid-provider readiness.
