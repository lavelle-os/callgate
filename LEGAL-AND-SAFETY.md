# Legal and safety notes

Read this before forwarding real calls. None of it is legal advice. These are the questions a telecom lawyer should answer before anyone runs this at scale, written down so they are not forgotten.

## Emergency call-backs

If you call 911 and the dispatcher calls you back while your phone is forwarding unanswered calls, that call-back reaches the gate. The gate never hangs up on a caller who stays on the line: they reach voicemail, and the alert reaches your phone. That is a fallback, not a solution. A dispatcher may not wait through a greeting.

On iPhone, Apple's support page says call screening turns off for 24 hours after you call emergency services. That covers Apple's own screening, not your carrier's forward.

If you expect an emergency call-back, turn forwarding off with your carrier's cancel code first.

## Recording and transcription

The greeting says "This call may be recorded." Voicemail is recorded and transcribed by Plivo.

Some US states require every party's consent to record a call. The greeting is the usual way to get it, but no state statute was checked while writing this. If you are in, or expect calls from, an all-party-consent state, check the rule for your state.

## Whether this makes you a phone company

A service that answers and bridges calls may count as a "voice service provider" under the FCC's robocall rules. A voice service provider has to sign its calls (STIR/SHAKEN), run a robocall mitigation program, and file in the FCC's Robocall Mitigation Database. If instead the service is only a customer of Plivo, those duties may sit with Plivo.

For one person running their own gate on their own number, the question is probably moot. For anyone offering this to others as a service, it is the first question for a lawyer. The rules are 47 CFR 64.6301, 64.6302 and 64.6305.

## Caller ID

When the gate rings you, the call shows your gate number, not the original caller's number. That is deliberate (it is how an iPhone set to silence unknown callers still rings), and it is your own number showing on your own phone. Nothing is spoofed. The Truth in Caller ID rule (47 CFR 64.1604) is about misleading caller ID with intent to defraud, which this is not.

The trade-off: you do not see who is calling until you answer. The alert history in ntfy shows who left messages.

## Call records

The server keeps the last 200 recordings in memory (caller number and recording link) so the transcript alert can name the caller. Nothing is written to disk. Plivo keeps the recordings on its side under its retention policy; delete them from the Plivo console if you want them gone.

## The code

The gate code is a shared secret. Anyone who learns it rings through. Change it in your host's settings whenever you need to; there is no limit on tries, so pick more than two digits.
