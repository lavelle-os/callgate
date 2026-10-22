# callgate

A keypad gate for your own phone number. Robocalls stop at a code prompt and never ring you. People you know ring straight through. Everyone else leaves a message, and the transcript lands on your phone.

It is designed to work on iPhone and Android with nothing to install on the phone. You keep your number. The gate sits behind it and only catches the calls you don't answer.

**Who it is for:** anyone who gets spam calls and can follow a setup guide. You will rent one phone number (about 50 cents a month) and run one small program on a web host (about $5 a month). No company is in the middle: your number, your host, your account.

**What it is not:** finished. It has passed automated tests and two independent reviews of the code and this guide, and has not yet been tested on a live phone. Read [What has not been tested](#what-has-not-been-tested) and [LEGAL-AND-SAFETY.md](LEGAL-AND-SAFETY.md) before you forward real calls to it. If you test it, write what happened in [TEST-LOG.md](TEST-LOG.md).

## How a call goes

```
someone calls your number
   you don't answer
   your carrier forwards the call to your gate number
        │
        ├─ caller is on your whitelist ──────────────► your phone rings, shown as "Gate"
        ├─ caller is your gate number (a loop) ──────► refused
        └─ anyone else hears: "You have reached Pat. This call may be recorded and
           transcribed. If you have the code, enter it now. To leave a message,
           press 1, or just stay on the line."
                │
                ├─ right code ───────────────────────► your phone rings; you press 1 to take it
                ├─ wrong code, 1, or nothing ────────► voicemail, transcribed, sent to your phone
                ├─ silence after the tone ───────────► your phone rings once more, then goodbye
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
| `BASE_URL` | the `https://` address from Railway, no slash at the end |
| `PLIVO_AUTH_TOKEN` | Plivo console overview page: the **Auth Token**, not the Auth ID. If the number sits in a subaccount, that subaccount's token |
| `GREETING` | how the gate introduces itself, for example `You have reached Pat.` |
| `NTFY_URL` | `https://ntfy.sh/` plus a topic of at least 16 random characters (run `openssl rand -hex 16`); subscribe to the same topic in the ntfy app |
| `WHITELIST` | numbers that ring straight through, separated by commas; leave empty for now |

3. Deploy the staged changes. Open `BASE_URL` in a browser. You should see `callgate is running` and the answer URL. If you set `NTFY_URL`, the ntfy app should show "callgate started" within a few seconds. If it does not, fix the alerts before going on: nothing else will tell you a voicemail arrived.

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
| Verizon | `*71GATE` (covers busy and no answer) | `*73` | Verizon's call-forwarding FAQ, read 2026-10-21 |
| T-Mobile | `**61*1GATE#` (no reply), `**62*1GATE#` (not reachable), `**67*1GATE#` (busy); delay form `**61*1GATE**30#` | `##004#` (resets forwarding to default) | T-Mobile's self-service short codes page, read 2026-10-21 |
| AT&T | Not confirmed on an AT&T page as of 2026-10-21. Third-party guides list `*61*GATE#`, `*62*GATE#`, `*67*GATE#` | `##004#` | ask AT&T or test with step 0 |

After dialing, do the read-back: call your own cell from the second phone, don't answer, and confirm you reach the gate. Turn Wi-Fi off on your phone while you dial a code; Apple's and T-Mobile's pages say some codes don't work over Wi-Fi calling.

### 5. Phone settings

**iPhone**

1. Open the **Contacts** app, tap **+**, name it `Gate`, enter your gate number, tap **Done**. Calls the gate passes to you show this number, and an iPhone that silences unknown callers only rings for contacts.
2. Settings → Apps → Phone → Screen Unknown Callers: choose **Silence**. Do not choose **Ask Reason for Calling**: Apple's screening answers the call itself, and an answered call is never forwarded.
3. Settings → Apps → Phone → Live Voicemail: **off**. Live Voicemail answers on the phone itself, so your carrier never sees an unanswered call to forward. One user report; untested here. If you don't see the switch, your carrier or region doesn't offer it.

**Whether a silenced call is forwarded is the main untested premise for iPhone users.** Apple says a silenced call is "sent to voicemail". Whether the network sees that as unanswered (forwarded to the gate) or as declined (carrier voicemail) has not been checked on any carrier. Step 6 tests it.

**Android**

Save the gate number as a contact. Google's page says calls screened by its Call Screen are not forwarded, so turn off Call Screen (and Samsung Smart Call) or they answer before the forward.

### 6. Test it before you trust it

From the second phone, in this order. Write each result in TEST-LOG.md with the carrier and the date.

1. Call your number and don't answer. You should hear the greeting, not a busy tone.
2. Enter the code. Your phone should ring, showing the Gate contact. Answer and press 1. You should be connected.
3. Call again, press 1, leave a message, and hang up without pressing #. The ntfy alert with the recording link should arrive within a minute, and the transcript within a few minutes (Plivo's page says under five, longer for long messages, English only).
4. Call again and stay silent through the greeting and the tone. After about ten seconds of silence your phone should ring. Don't answer. The caller should then hear goodbye, not an error.
5. Set `WHITELIST` to the second phone's number in Railway's Variables, deploy, and call again. It should ring you with no greeting.
6. Call, enter the code, and don't press 1 when your phone rings. The caller should land in voicemail, and the alert should arrive.
7. Set your phone to **Silence** unknown callers (iPhone) and call from a number that is not a contact. Does the greeting play? Record the answer: it decides whether the iPhone setup works on your carrier.

Then, once per carrier, the conditions that decide whether the design holds up: your phone busy on another call, powered off, in airplane mode, declining the call, on Wi-Fi calling, with the carrier's spam filter on, and with the server stopped. For each, note what the caller heard.

## Settings

All settings are environment variables. [.env.example](.env.example) lists every one with a note. For local testing on your own computer, copy it to `.env`, set `CHECK_SIGNATURES=false`, and run:

```bash
npm install
npm run dev
```

Then `curl -X POST -d From=13125550123 http://localhost:3000/answer` prints the call XML. With checks off the server only listens on 127.0.0.1, so it cannot be reached from outside.

## Cap your costs

Anyone who learns your gate number can call it over and over, and every call costs minutes. Three things limit that:

1. The server refuses more than `CALLS_PER_HOUR_PER_CALLER` calls from one number and `CALLS_PER_HOUR` overall (defaults 6 and 60), and caps a bridged call at `MAX_CALL_SECONDS`.
2. In the Plivo console, open **Billing**: check **Auto Recharge** and turn it off if it is on, and keep the prepaid balance small. A zero balance stops the gate answering, which is the trade-off.
3. Watch the ntfy alerts. Every wrong code and every ring-through sends one, so a leaked code shows up before it becomes harassment.

## When it stops working

Forwarding replaces your carrier voicemail. If the gate is down, unanswered calls go nowhere until you turn forwarding off. Keep the cancel code where you can find it:

- Verizon `*73`. T-Mobile and AT&T `##004#`.
- A zero Plivo balance, an unpaid host, a changed `BASE_URL`, or a regenerated auth token each stops the gate.
- If your own voicemail stopped working after setup, you forwarded all calls instead of unanswered ones. Dial the cancel code and redo step 4.
- Make one test call a month from the second phone.

## A limit to know before you rely on it

Your phone rings for the gate number because that number is saved as a contact. Caller ID can be spoofed. Someone who learns your gate number and spoofs it as their caller ID rings your phone directly, around the gate. The whitelist has the same weakness: it trusts the caller's number. The code is the only part of this that does not depend on caller ID. Treat the gate number like the code: don't publish it, and change the Plivo number if it leaks. An on-phone app could check more than caller ID, and iPhone does not allow one to answer calls, which is why this design exists and why it has this limit.

## What has not been tested

Every branch of the call flow has an automated test ([test/flow.test.js](test/flow.test.js)), and the Plivo XML and callback fields were checked against Plivo's documentation. Nothing below has been checked on a real phone yet.

- That each carrier forwards an unanswered call to the gate with the codes above, and what caller ID the forwarded call carries.
- That an iPhone set to **Silence** leaves the call for the carrier to forward.
- Each carrier's no-answer time, and that `RING_SECONDS` below it prevents the loop.
- That the press-1 screening works with the owner's carrier, and what happens when the owner's carrier voicemail answers instead.
- That a bridged call shown as the gate number is not labeled spam.
- That Plivo calls `/recorded` when the caller hangs up instead of pressing #.
- That the fallback XML is accepted from the host you choose.

## Where this came from

Built by an appliance repair shop that already runs its phones on cloud voice agents. The design and this guide were reviewed before release by two independent research passes, and every open question they left is listed above or in [LEGAL-AND-SAFETY.md](LEGAL-AND-SAFETY.md). It is one piece of [Lavelle](https://github.com/lavelle-os), an open method for running a small service business on AI agents.

MIT license. No warranty. Your number, your host, your responsibility.
