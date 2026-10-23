# callgate

A keypad gate for your own phone number. Robocalls stop at a code prompt. People you know press one key and ring through. Everyone else leaves a message, and the transcript lands on your phone. When the gate rings you, it says a word only you and it know, so a spoofed call cannot pass as the gate.

It is designed to work on iPhone and Android with nothing to install on the phone. You keep your number. The gate sits behind it and only catches the calls you don't answer.

**Who it is for:** anyone who gets spam calls and can follow a setup guide. You will rent one phone number (about 50 cents a month) and run one small program on a web host (about $5 a month). No company is in the middle: your number, your host, your account.

**What it is not:** finished. It has passed automated tests and two independent reviews of the code and this guide, and has not yet been tested on a live phone. Read [What has not been tested](#what-has-not-been-tested) and [LEGAL-AND-SAFETY.md](LEGAL-AND-SAFETY.md) before you forward real calls to it. If you test it, write what happened in [TEST-LOG.md](TEST-LOG.md).

## How a call goes

```
someone calls your number
   you don't answer
   your carrier forwards the call to your gate number
        │
        ├─ caller is on your whitelist ──────────────► "press any key", then your phone rings, shown as "Gate"
        ├─ caller is your gate number (a loop) ──────► refused
        └─ anyone else hears: "You have reached Pat. This call may be recorded and
           transcribed. If you have the code, enter it now. To leave a message,
           press 1, or stay on the line."
                │
                ├─ right code ───────────────────────► your phone rings; you hear your word, press 1
                ├─ wrong code, 1, or nothing ────────► voicemail, transcribed, sent to your phone
                ├─ silence after the tone ───────────► your phone rings once (budgeted), then goodbye
                └─ you don't take the ring ──────────► voicemail
```

A robocall that hangs up at the prompt costs you a fraction of a cent. A robocall that plays its recording into the prompt becomes a voicemail and a transcript, the same as on any answering machine. A person who waits on the line without speaking, including an emergency dispatcher calling you back, is rung through to you rather than dropped. A spoken message ends with goodbye, which is what any voicemail does.

## What it costs

Read from Plivo's US pricing page on 2026-10-20. Check the current page before you count on these. Both legs of a bridged call are billed, and Plivo rounds each leg up to whole minutes.

| Item | Price |
|---|---|
| One local phone number | $0.50 a month |
| A call that reaches the gate | $0.0055 a minute |
| Ringing your phone (the bridged leg) | $0.0115 a minute |
| Voicemail transcription | about $0.01 a minute, on every message |
| Web host | about $5 a month on Railway's Hobby plan |

At 40 short screened calls and 10 real calls a month, that is about $1.25 in Plivo charges plus the host. Forwarded calls also use your carrier's minutes: Verizon's page says forwarded calls are billed as airtime, and AT&T's says they are billed for their length. If your plan has a minute limit, check it.

## What you need

1. A [Plivo](https://www.plivo.com) account. A trial account can only call numbers you have verified under **Phone Numbers → Sandbox Numbers**, and allows two calls at once (a bridged call uses two). Make a first payment before real use; the console's billing page shows the minimum.
2. A web host that runs Node.js 20.6 or newer and gives you an `https://` address. [Railway](https://railway.app) is what this was written on. Avoid free tiers that sleep: a sleeping server answers too slowly and the call fails. Railway's limited trial also restricts outbound network, which would silently stop the alerts, so verify the account or pick the Hobby plan.
3. The free [ntfy](https://ntfy.sh) app on your phone for voicemail alerts.
4. A second phone to test with, and about an hour.

## Setup

Do these in order. Each step depends on the one before it.

### 0. Check that your carrier can forward unanswered calls

Before you spend anything: forward your unanswered calls to a phone you own (a friend's or a landline), let a call go unanswered, and confirm it lands there. Then turn forwarding off with the cancel code. The codes are in step 4. Some resellers and prepaid plans don't support conditional forwarding at all, and this is the cheapest place to find out.

### 1. Rent a number

In the Plivo console: **Phone Numbers → Buy Numbers**. Pick a local US number. Write it down. This is your `SERVICE_NUMBER`.

While you are there, on a trial account, open **Phone Numbers → Sandbox Numbers** and verify your own cell, or the gate will not be allowed to ring you.

### 2. Put the server online

On Railway: **New Project → Deploy from GitHub repo**, pick your copy of this repository. The first deploy will show **Crashed**. That is expected: the program refuses to start until its settings exist.

1. Open **Settings → Networking → Generate Domain** and copy the `https://` address. That is your `BASE_URL`. Use it exactly as Railway shows it, with nothing after the host.
2. In the service's **Variables** tab, add each setting from [.env.example](.env.example). The ones you must set:

| Setting | What to put |
|---|---|
| `OWNER_PHONE` | your real cell number, 10 digits |
| `SERVICE_NUMBER` | the Plivo number from step 1, 10 digits |
| `GATE_CODE` | 4 to 8 digits you will give to people who should reach you; not a run or a repeat |
| `OWNER_WORD` | one or two plain words the gate says to you, and only you, when it rings you. Not a word you use anywhere else |
| `BASE_URL` | the `https://` address from Railway, no slash at the end |
| `PLIVO_AUTH_TOKEN` | Plivo console overview page: the **Auth Token**, not the Auth ID. If the number sits in a subaccount, that subaccount's token |
| `GREETING` | how the gate introduces itself, for example `You have reached Pat.` |
| `NTFY_URL` | required. `https://ntfy.sh/` plus a topic of at least 16 random characters (run `openssl rand -hex 16`); subscribe to the same topic in the ntfy app |
| `WHITELIST` | numbers that skip the code, separated by commas; add `=Name` for a label and `!` for a caller that cannot press a key; leave empty for now |

3. Deploy the staged changes. Open `BASE_URL` in a browser. You should see `callgate is running` and the answer URL. The ntfy app should show "callgate started" within a few seconds. If it does not, fix the alerts before going on: nothing else will tell you a voicemail arrived.

### 3. Point the number at the server

In the Plivo console: **Voice → Applications → Add New Application**.

- Application name: `callgate`
- Primary answer URL: your `BASE_URL` followed by `/answer`, exactly as the front page of your server shows it
- Primary answer method: `POST`
- Hangup URL: your `BASE_URL` followed by `/hangup`, method `POST`
- Fallback answer URL: see below

Save it. Then **Phone Numbers → Your Numbers → click your number → Application type: XML Application → Plivo Application: callgate → Update**.

**The answer URL and `BASE_URL` must match character for character.** Every request Plivo sends is signed over the full URL. If one says `https://` and the other `http://`, or one has a trailing slash, the server refuses every call with a 403 and the caller hears an error. The server logs one warning a minute when that happens, naming the URL it compared against.

**Fallback answer URL.** While forwarding is on, your carrier's own voicemail is out of the picture. If your host is down or your Plivo balance is empty, every unanswered call dead-ends. Plivo calls the fallback URL when the primary one fails. Host the file [fallback.xml](fallback.xml) somewhere that is not your Railway service (GitHub Pages serves `.xml` files), and put that address in as the fallback, method `GET`. It plays an apology and hangs up, which beats an error tone. Whether Plivo accepts the file from your chosen host is one of the things to test.

These screen names come from Plivo's documentation, not from a live account, so a label may differ slightly from what you see. If you find one that differs, note it in TEST-LOG.md.

Call your gate number from the second phone (not your own cell: your own number and the gate number are refused on purpose). You should hear the greeting.

### 4. Measure your carrier's ring time, then forward

Forwarding here is "conditional": your phone still rings first, and only the calls you don't pick up go to the gate. Your number does not change.

**Measure first.** With forwarding still off, call your own cell from the second phone and count the seconds until your carrier's voicemail picks up. That is your carrier's no-answer time. `RING_SECONDS` in step 2 must be at least 5 seconds shorter than it. If it is longer, your carrier forwards the gate's own ring back to the gate, which refuses it, and the caller lands in voicemail instead of reaching you. T-Mobile lets you set the delay in the forwarding code itself.

**Then dial the code for your carrier** from your phone, replacing `GATE` with your ten-digit gate number, and press call. Register all three conditions where the carrier offers them (no reply, busy, not reachable): a phone that silences a call may report busy to the network rather than no reply.

| Carrier | Turn on | Turn off | Source |
|---|---|---|---|
| Verizon | `*71GATE` (busy and no answer; the phone-off case is not documented). On an iPhone, turn Live Voicemail off first (step 5): Verizon's own page says so | `*73` | Verizon's call-forwarding pages, read 2026-10-22 |
| AT&T | One at a time, pressing Call and hanging up between them: `*61*GATE#` (no answer), `*62*GATE#` (unreachable), `*67*GATE#` (busy). On Android there is a menu instead: Phone → Settings → Calling accounts → your SIM → Call forwarding → When unanswered, When unreachable, When busy | `##61#`, `##62#`, `##67#` | The codes appear on Google's Voice help page, not on any AT&T page; the Android menu is on AT&T's device-support pages. Read 2026-10-22 |
| T-Mobile | `**61*1GATE#` (no reply), `**62*1GATE#` (off or no signal), `**67*1GATE#` (busy). Ring delay: `**61*1GATE**30#` (5 to 30 seconds) | `##61#`, `##62#`, `##67#`; `##004#` resets all forwarding | T-Mobile's self-service short codes page, read 2026-10-22 |
| Mint Mobile | The three T-Mobile codes above. Mint's Scam Screener stops working while forwarding is on | `##61#`, `##62#`, `##67#` | Mint's help pages, read 2026-10-22 |
| Tello | The three T-Mobile codes above; the plan must include data | `##61#`, `##62#`, `##67#` | Tello's help page, read 2026-10-22 |
| Xfinity Mobile | `*71GATE` | `*73` | Xfinity's call-forwarding article, read 2026-10-22 |
| Spectrum Mobile | `*71GATE`, or the My Spectrum app: Your Services → Mobile → the line → Call Forwarding → Busy Line & Missed Calls | `*73` | Spectrum's support article, read 2026-10-22 |
| Ting | First in the Ting account: Device settings → the number → Minutes → "Can use call forwarding" on. Then `*71GATE` | `*73` | Ting's help page, read 2026-10-22 |
| Visible | `*71GATE` is documented for busy only; no no-answer code was found | `*73` | Visible's plan-features page, read 2026-10-22 |

Not documented by the carrier, so step 0 decides: Google Fi (its app offers only Don't forward, Ring all numbers, Always forward), Straight Talk and Total Wireless (`*72` forwards every call; nothing conditional), Red Pocket (unconditional only), Cricket, Metro by T-Mobile, Consumer Cellular, Boost, and legacy US Cellular lines. On any GSM carrier the standard codes `**61*GATE#`, `**62*GATE#`, `**67*GATE#` (reset `##004#`) are worth one try before the step-0 test. Resellers ride the big three's networks and do not always pass conditional forwarding through.

After dialing, do the read-back: call your own cell from the second phone, don't answer, and confirm you reach the gate. Turn Wi-Fi off on your phone while you dial a code; Apple's and T-Mobile's pages say some codes don't work over Wi-Fi calling.

### 5. Phone settings

**iPhone**

1. Open the **Contacts** app, tap **+**, name it `Gate`, enter your gate number, tap **Done**. Calls the gate passes to you show this number, and an iPhone that silences unknown callers only rings for contacts. When you answer one, you hear "Call from your gate", then your word, then "press 1".
2. Settings → Apps → Phone → Screen Unknown Callers: **Silence** once the gate is proven (test 7 checks it). Never choose **Ask Reason for Calling**: Apple's screening answers the call itself, and an answered call is never forwarded.
3. Settings → Apps → Phone → Live Voicemail: **off**. Live Voicemail answers on the phone itself, so your carrier never sees an unanswered call to forward. Verizon's own support page says to turn it off when using `*71`. If you don't see the switch, your carrier or region doesn't offer it.
4. Settings → Apps → Phone → Call Forwarding: leave that switch **off**. It forwards every call; the carrier code does the conditional one.
5. For the first tests, Screen Unknown Callers on **Never** and any Focus mode off, so an unanswered call is simply unanswered. Carrier spam apps can also answer or route a call before the forward: Verizon Call Filter (My Verizon app → Call Filter → Settings → spam routing), AT&T ActiveArmor (Calls → Call Routing), T-Mobile Scam Block (`#632#` turns it off, `#662#` on, `#787#` shows status), Cricket Call Defense. Whether each one steals the call from the forward is untested.

**Whether a silenced call is forwarded is the main untested premise for iPhone users.** Apple says a silenced call is "sent to voicemail". Whether the network sees that as unanswered (forwarded to the gate) or as declined (carrier voicemail) has not been checked on any carrier. Step 6 tests it.

**Android**

Save the gate number as a contact. Then turn off anything that answers a call on the phone, because an answered call is never forwarded:

- **Pixel:** Phone app → Settings → Spam and Call Screen → automatic screening **off**. Google's page: "If you use call forwarding, don't use automatic call screening. Screened calls won't be forwarded."
- **Samsung Galaxy:** Phone app → Settings → Call screening → Auto screen calls **off** (One UI 8.5 and later). Conditional forwarding has a menu here too: Phone app → Settings → Supplementary services → Call forwarding → Forward when busy, when unanswered, when unreachable → your gate number → Enable. Leave "Block calls from unknown numbers" off while testing.
- **Any Android:** the carrier menu on AT&T phones is Phone app → Settings → Calling accounts → your SIM → Call forwarding.

### 6. Test it before you trust it

From the second phone, in this order. Write each result in TEST-LOG.md with the carrier and the date.

1. Call your number and don't answer. You should hear the greeting, not a busy tone.
2. Enter the code. Your phone should ring, showing the Gate contact. Answer: you should hear "Call from your gate", then your word. Press 1. You should be connected. On the caller's side, time the gap between the last word of the code prompt and the moment the gate stops listening, and write it down: it decides whether `PROMPT_SECONDS` counts from the start or the end of the prompt.
3. Call again, press 1, leave a message, and hang up without pressing #. The ntfy alert with the recording link should arrive within a minute, and the transcript within a few minutes (Plivo's page says under five, longer for long messages, English only).
4. Call again and stay silent through the greeting and the tone. After about ten seconds of silence your phone should ring. Don't answer. The caller should hear that you could not be reached, not an error. Note the `RecordingDurationMs` the server logged for that call: it shows whether Plivo reports an all-silent recording as 0 or as the length of the silence window. Then repeat from a noisy room or a car. A second silent ring from the same number is refused for a day, so read the alert to see what the server decided.
5. Set `WHITELIST` to the second phone's number in Railway's Variables, deploy, and call again. It should ring you with no greeting.
6. Call, enter the code, and don't press 1 when your phone rings. The caller should land in voicemail, and the alert should arrive.
7. Set your phone to **Silence** unknown callers (iPhone) and call from a number that is not a contact. Does the greeting play? Record the answer: it decides whether the iPhone setup works on your carrier.
8. From the whitelisted phone, press `#` instead of a digit at the key prompt. You should still ring through.
9. From the whitelisted phone, press nothing and hold it to a speaker playing a touch-tone recording. If the gate rings you, a robocall that plays tones would pass the key check too. Write that down.
10. Set your phone to send every call straight to voicemail, then call with the code. Your carrier voicemail cannot press 1, so the caller should land in the gate's voicemail and you should get the alert.

Then, once per carrier, the conditions that decide whether the design holds up: your phone busy on another call, powered off, in airplane mode, declining the call, on Wi-Fi calling, with the carrier's spam filter on, and with the server stopped. For each, note what the caller heard.

## Settings

All settings are environment variables. [.env.example](.env.example) lists every one with a note. For local testing on your own computer, copy it to `.env`, set `CHECK_SIGNATURES=false`, and run:

```bash
npm install
npm run dev
```

Then `curl -X POST -d From=13125550123 http://localhost:3000/answer` prints the call XML. With checks off the server only listens on 127.0.0.1, so it cannot be reached from outside.

## Cap your costs

Anyone who learns your gate number can call it over and over, and every call costs minutes. Four things limit that:

1. The server refuses more than `CALLS_PER_HOUR_PER_CALLER` calls from one number and `CALLS_PER_HOUR` overall (defaults 6 and 60). Known callers are counted per number but not against the total, so a flood of strangers cannot lock out your family. A withheld caller ID counts as one caller. The first refusal in an hour sends you one alert.
2. The gate rings you at most `RINGS_PER_HOUR` times an hour on every path together (default 10), and a number that reaches you by staying silent after the tone gets that once a day (`SILENT_RINGS_PER_DAY`). Over budget, callers get voicemail and you get one alert. `MAX_CALL_SECONDS` caps a bridged call.
3. In the Plivo console, open **Billing**: check **Auto Recharge** and turn it off if it is on, and keep the prepaid balance small. A zero balance stops the gate answering, which is the trade-off.
4. Watch the alerts. Every wrong code and every ring-through sends one, so a leaked code shows up before it becomes harassment.

## When it stops working

Forwarding replaces your carrier voicemail. If the gate is down, unanswered calls go nowhere until you turn forwarding off. Keep the cancel code where you can find it:

- Verizon `*73`. T-Mobile `##004#`. AT&T `##61#`, `##62#`, `##67#` (the standard GSM cancel codes for the three forwards in the table; AT&T publishes no code of its own, so confirm with a test call).
- A zero Plivo balance, an unpaid host, a changed `BASE_URL`, or a regenerated auth token each stops the gate.
- If your own voicemail stopped working after setup, you forwarded all calls instead of unanswered ones. Dial the cancel code and redo step 4.
- Make one test call a month from the second phone.

## Caller ID is not proof, so the gate does not trust it

Caller ID can be spoofed. Three things in this design could be fooled by it, and each has an answer:

- **The whitelist.** A known number still presses one key before it rings you. That stops a recorded robocall wearing a friend's number, because a recording sends no tones. It does not stop a person who spoofs the number and presses a key, and whether a robocall that plays tones gets through is untested (test 9). The whitelist is a convenience for people you know, not a lock. If a caller cannot press a key (a pharmacy's automated call, an alarm company), mark the entry with `!`. If you'd rather nobody pressed one, set `WHITELIST_PRESS_KEY=false`.
- **Your own phone.** It rings for the gate number because that number is a saved contact. Someone who learns the gate number and spoofs it rings you directly, around the gate. The proof is the word: every call the gate bridges to you opens with "Call from your gate", then your `OWNER_WORD`, before you press 1. Only Plivo can play that into a call it is really bridging. **Answer a Gate call and hear no word: hang up.** The "Ringing you" alert is a heads-up, sent before the ring at high priority. It is not the proof, because an alert can be late, lost, or forged by anyone who learns your ntfy topic.
- **The silent line.** A caller who stays silent after the tone rings you once with no code and no key, because a person who is holding, or a dispatcher calling back, should not be stranded. That path is budgeted (once a day per number, inside the hourly ring budget), and it still opens with your word.

The code and the word are the two things that depend on nothing the caller can forge. Keep the gate number as private as the code: callers never see it, since they dial your real number, so it only leaks if you publish it. Change the Plivo number if it does.

Plivo verifies the STIR/SHAKEN signature on inbound US calls and shows the verdict in its console. The server logs whatever field Plivo sends beside each call, and logs the names of all the fields once per route, so the first live call shows whether a verdict arrives at all. A carrier-forwarded call is a new leg, so its verdict may describe the forwarding, not the original caller. Nothing is decided on it.

## Texts and FaceTime are outside the gate

**Text messages.** Carrier forwarding carries calls only. Verizon's FAQ says call forwarding "won't forward text messages, only calls," and Xfinity and Spectrum say the same. The gate never sees a text sent to your number, on any carrier, and cannot hold, challenge, answer or delete one. What works today is on the phone:

- iPhone: Messages → Filters → Manage Filtering: **Screen Unknown Senders** (iOS 26), **Filter spam** (on by default), and a **Text Message Filter** app if you install one. Report a text with Report Spam or by forwarding it to 7726, which reports the sender and does not stop it. Block Contact blocks that number in Phone and FaceTime too.
- Android: Google Messages → your picture → Messages settings → Protection & Safety → **Spam protection** on; touch and hold a conversation → Block → Report spam. Samsung Messages → Settings → Block numbers and spam.

Apple does let a phone-side filter app hand the sender and text of an SMS from a non-contact to one fixed server, which could be a server like this one. That filter can only sort a text into Junk, Promotion or Transaction; it cannot reject, reply, forward or hold one, it never sees iMessage or texts from contacts, and it needs an App Store app and a paid developer account. Not built.

**FaceTime audio.** A FaceTime call runs through Apple's servers and your data connection, not your carrier's voice line, so a carrier forward never sees it. That is why a FaceTime audio call from a stranger reaches a phone that forwards every other unknown call. The settings are on the iPhone:

1. Settings → Apps → FaceTime → **Silence Unknown Callers** on (iOS 17 and later; the iOS 17 path is Settings → FaceTime). Unknown numbers are silenced and listed in Recents; contacts and recent outgoing calls still ring.
2. On iOS 26 and later, also **Unknown Callers** on (missed FaceTime calls from unknown numbers move to a hidden list) and **FaceTime Spam** on.
3. Stronger: under **You can be reached by FaceTime at**, uncheck your phone number and keep only your email. Then nobody who has only your number can FaceTime you, wanted or not.
4. Per caller: while it rings, tap the notification → Block Caller. Afterward, in FaceTime history, tap the call → Block Contact, or touch and hold it → Report Spam.

One side effect: a silenced FaceTime caller can leave a message only when Live Voicemail is on, and step 5 turns that off for the forward. They get nothing, which for a stranger is the point.

## What has not been tested

Every branch of the call flow has an automated test ([test/flow.test.js](test/flow.test.js)), and the Plivo XML and callback fields were checked against Plivo's documentation. Nothing below has been checked on a real phone yet.

- That each carrier forwards an unanswered call to the gate with the codes above, and what caller ID the forwarded call carries. On Verizon, whether a powered-off or out-of-range phone's calls reach the gate or Verizon's voicemail: no Verizon page says.
- Whether a carrier spam app (Verizon Call Filter, AT&T ActiveArmor, T-Mobile Scam Block) or the iPhone's own spam filter takes a call before the forward fires.
- That an iPhone set to **Silence** leaves the call for the carrier to forward.
- Each carrier's no-answer time, and that `RING_SECONDS` below it prevents the loop.
- That the press-1 screening works with the owner's carrier, and what happens when the owner's carrier voicemail answers instead.
- That a bridged call shown as the gate number is not labeled spam.
- That Plivo calls `/recorded` when the caller hangs up instead of pressing #.
- That the fallback XML is accepted from the host you choose.
- That the word in the confirm prompt is heard on a bridged call before the press-1 prompt, and that the owner's carrier voicemail cannot take the call.
- What `RecordingDurationMs` Plivo reports for an all-silent recording and for a noisy room. The silence test assumes 0 or the length of the silence window.
- Whether `PROMPT_SECONDS` counts from the start or the end of the prompt.
- Whether a `#` at the key prompt counts as a key, and whether a robocall that plays tones passes it.
- Which STIR/SHAKEN field, if any, Plivo sends on an inbound forwarded call.

## Where this came from

Built by an appliance repair shop that already runs its phones on cloud voice agents. The design and this guide were reviewed before release by two independent research passes, and every open question they left is listed above or in [LEGAL-AND-SAFETY.md](LEGAL-AND-SAFETY.md). It is one piece of [Lavelle](https://github.com/lavelle-os), an open method for running a small service business on AI agents.

MIT license. No warranty. Your number, your host, your responsibility.
