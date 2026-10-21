# Test log

What has been checked, by whom, on what. Add a line when you test something new.

| Date | What | Result | Who |
|---|---|---|---|
| 2026-10-21 | Automated tests: the main branches of the call flow, the settings checks, the hourly caps, the signature check with a correctly signed and a forged request, alert dedupe (`npm test`) | pass | the author, on a Mac, Node 24 |
| 2026-10-21 | Plivo XML attribute names and callback fields checked against Plivo's documentation (GetInput, Record, Dial, Hangup, Speak; Record action and transcription callbacks; signature scheme read from the plivo npm package) | match | the author and two independent reviews |
| 2026-10-21 | Carrier forwarding codes: Verizon `*71`/`*73` found on Verizon's FAQ; T-Mobile `**61*`/`**62*`/`**67*`/`##004#` found on T-Mobile's short-code page; AT&T codes not found on an AT&T page | as stated in the README table | the reviews |
| 2026-10-21 | Live call on a real carrier | not yet done | |
| 2026-10-21 | iPhone set to Silence: does the carrier forward a silenced call? | not yet done | |
| 2026-10-21 | Press-1 screening on the bridged leg; what the owner's carrier voicemail does | not yet done | |
| 2026-10-21 | Does `/recorded` fire when the caller hangs up without pressing #? | not yet done | |
| 2026-10-21 | Bridged call labeled spam on the owner's phone? | not yet done | |
| 2026-10-21 | Plivo console labels as the README names them | not yet done (from docs only) | |
| 2026-10-21 | Fallback XML accepted from GitHub Pages | not yet done | |
