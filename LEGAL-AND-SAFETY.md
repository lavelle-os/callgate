# Legal and safety notes

Read this before forwarding real calls. None of it is legal advice. These are the questions a telecom lawyer should answer before anyone runs this for other people, written down so they are not forgotten. Rule citations were read on the eCFR on 2026-10-21.

## Emergency call-backs

If you call 911 and the dispatcher calls you back while your phone is forwarding unanswered calls, that call-back reaches the gate. The gate never leaves a silent caller on a dead line: a caller who stays silent after the tone is rung through to you once more, and a caller who speaks leaves a message that is sent to your phone at once. That is no worse than ordinary voicemail, which is where an unanswered call-back lands on any phone, and it is not a substitute for answering.

Apple's page says call screening turns off for 24 hours after you call emergency services. That covers Apple's own screening, not your carrier's forward.

If you expect an emergency call-back, turn forwarding off with your carrier's cancel code first.

## Recording and transcription

The greeting says "This call may be recorded and transcribed," and every voicemail prompt repeats it, on every path that records. Voicemail is recorded and transcribed by Plivo, a third party.

Some US states require every party's consent to record a call. A spoken notice before the tone is the usual treatment, but no state statute was successfully opened while writing this (California's page timed out). If you are in, or expect calls from, an all-party-consent state, check the rule for your state.

Plivo's Record page says recordings and transcripts are deleted after 30 days, and that transcription is English only. Download any voicemail you want to keep.

## Caller ID is not proof

The owner's phone rings for the saved gate number, and the whitelist passes saved numbers through. Both trust the caller ID the network presents, and caller ID can be spoofed. A spoofed gate number rings the owner directly; the word the gate speaks on every bridged call is what tells a real gate call from a spoofed one (see the README section "Caller ID is not proof"). The code and the word are the two things independent of caller ID. Keep the gate number private and treat a leak like a leaked code.

## The gate code and Plivo's logs

The gate code is a shared secret. Anyone who learns it rings through. The server refuses codes shorter than four digits and the obvious ones, alerts you on every wrong try and every ring-through, and caps calls per hour and rings per hour. There is no lockout beyond that, so pick six digits or more if you can.

The owner's word (`OWNER_WORD`) is spoken to you inside every call the gate bridges, before you press 1, and is how you know a ring came through the gate. It goes to Plivo inside the XML Plivo fetches for that prompt, so Plivo's request logs may hold it. It never goes in an alert, a log line or a URL. It proves the call's path; it unlocks nothing, so a leak costs you a new word, not your privacy.

Plivo logs keypad input by default. The gate asks Plivo not to (`log="false"` on the input element). After your first test call, open the call in the Plivo console and confirm the digits are not shown.

## Whether this makes you a phone company

A service that answers and bridges calls may count as a "voice service provider" under the FCC's robocall rules. 47 CFR 64.6300 defines "voice service" as any service interconnected with the public switched telephone network that furnishes voice communications to an end user using North American numbering resources. A voice service provider has to authenticate the calls it originates (64.6301) and keep a robocall mitigation program and a database filing (64.6305(a), (d) and (h)). 64.6302 is the separate rule for intermediate providers that carry traffic they neither originate nor terminate.

For one person renting one number from Plivo and running their own gate, the likelier reading is that you are Plivo's customer and Plivo is the provider. That is a reading, not a ruling. For anyone offering this to others as a service, it is the first question for a telecom lawyer, and it deserves a second independent legal read before launch.

## Caller ID

When the gate rings you, the call shows your gate number, not the original caller's number. That is deliberate: your gate number is saved as a contact, and an iPhone set to silence unknown callers only rings for contacts. Whether that caller ID is delivered unchanged to your phone on a bridged call is untested. It is your own rented number showing on your own phone, so nothing is spoofed. The Truth in Caller ID rule, 47 CFR 64.1604(a), bars misleading caller ID transmitted "with the intent to defraud, cause harm, or wrongfully obtain anything of value", which this is not.

The trade-off: you do not see who is calling until you take it. The alert history in ntfy shows who entered the code and who left messages.

## Alerts and the recording links

Voicemail alerts carry the caller's number, the transcript and a link to the recording. On ntfy.sh the topic name is the only protection: anyone who knows it can read every alert, and ntfy.sh caches recent messages. Plivo's recording links are not password-protected and contain your Plivo Auth ID. So: at least 16 random characters in the topic, or a self-hosted ntfy with a token (`NTFY_TOKEN`), and treat the topic like a password. Lock-screen previews will show alert text.

ntfy.sh limits free use per sending address. If your host shares an outbound address with other customers, alerts can be throttled by strangers' traffic. The server logs any rejected alert.

## Call records

The server keeps the last 200 recordings in memory (caller number and recording link) so the transcript alert can name the caller, and the caller's number also travels in the signed callback URLs. Nothing is written to disk. Plivo keeps the recordings on its side for 30 days; delete them from the Plivo console if you want them gone sooner.
