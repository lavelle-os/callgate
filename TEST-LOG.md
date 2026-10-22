# Test log

What has been checked, by whom, on what. Add a line when you test something new.

| Date | What | Result | Who |
|---|---|---|---|
| 2026-10-21 | Automated tests: the main branches of the call flow, the settings checks, the hourly caps, the signature check with a correctly signed and a forged request, alert dedupe (`npm test`) | pass | the author, on a Mac, Node 24 |
| 2026-10-21 | Plivo XML attribute names and callback fields checked against Plivo's documentation (GetInput, Record, Dial, Hangup, Speak; Record action and transcription callbacks; signature scheme read from the plivo npm package) | match | the author and two independent reviews |
| 2026-10-21 | Carrier forwarding codes: Verizon `*71`/`*73` found on Verizon's FAQ; T-Mobile `**61*`/`**62*`/`**67*`/`##004#` found on T-Mobile's short-code page; AT&T codes not found on an AT&T page | as stated in the README table | the reviews |
| 2026-10-22 | Carrier pages re-read for nine carriers (Verizon, incl. its Live Voicemail page; T-Mobile; Mint; Tello; Xfinity; Spectrum; Ting; Visible; AT&T, whose own pages carry no conditional codes), plus Pixel, Samsung, iPhone, Google Messages and FaceTime settings from the makers' pages; 99 of 117 claims confirmed by a second agent re-opening the pages | as stated in the README | a research run of three finders and one verifier |
| 2026-10-21 | Local signature check (src/signature.js) checked against the Plivo SDK's validator on six URL shapes; `npm audit --omit=dev` clean (the SDK is now a development dependency only; its own dependency tree still carries old findings, unused at runtime) | pass | the author |
| 2026-10-22 | Whitelist press-any-key, ring alerts on every bridge, forged whitelist callback refused (automated tests) | pass | the author |
| 2026-10-22 | 0.4.0: the owner's word in the confirm prompt; ring alerts awaited before the Dial, high priority, failing open; the ring budget (hourly, and one silent ring per number per day); known callers exempt from the flood cap; loop-backs not counted; whitelist labels and no-key entries; `finishOnKey="none"` on the key prompt; the recording classifier (0 or the silence window is silent, a short message is a message, a finished call is never rung); log values stripped to printable ASCII (automated tests, 38) | pass | the author |
| 2026-10-22 | Whether Plivo sends the inbound STIR/SHAKEN verdict as a request field (logged if present; field names logged once per route) | not yet done, needs a live call | |
| 2026-10-22 | The word is heard on a real bridged call before press 1, and the owner's carrier voicemail cannot take the call | not yet done | |
| 2026-10-22 | `RecordingDurationMs` for an all-silent recording, and for a noisy room | not yet done | |
| 2026-10-22 | Whether `#` at the key prompt counts as a key, and whether a played touch-tone passes it | not yet done | |
| 2026-10-22 | Whether `PROMPT_SECONDS` counts from the start or the end of the prompt | not yet done | |
| 2026-10-21 | Live call on a real carrier | not yet done | |
| 2026-10-21 | iPhone set to Silence: does the carrier forward a silenced call? | not yet done | |
| 2026-10-21 | Press-1 screening on the bridged leg; what the owner's carrier voicemail does | not yet done | |
| 2026-10-21 | Does `/recorded` fire when the caller hangs up without pressing #? | not yet done | |
| 2026-10-21 | Bridged call labeled spam on the owner's phone? | not yet done | |
| 2026-10-21 | Plivo console labels as the README names them | not yet done (from docs only) | |
| 2026-10-21 | Fallback XML accepted from GitHub Pages | not yet done | |
