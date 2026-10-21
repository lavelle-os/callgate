# callgate

A keypad gate for your own phone number. Robocalls stop at a code prompt and never ring you. People you know ring straight through. Everyone else leaves a message, and the transcript lands on your phone.

It works on iPhone and Android with nothing to install on the phone. You keep your number. The gate sits behind it and only catches the calls you don't answer.

**Who it is for:** anyone who gets spam calls and can follow a setup guide. You will rent one phone number (about 50 cents a month) and run one small program on a web host (a few dollars a month). No company is in the middle: your number, your host, your account.

**What it is not:** finished. It has been tested with automated tests, not yet on a live phone. Read [What has not been tested](#what-has-not-been-tested) and [LEGAL-AND-SAFETY.md](LEGAL-AND-SAFETY.md) before you forward real calls to it.

## How a call goes

```
someone calls your number
   you don't answer (or your iPhone silences an unknown caller)
   your carrier forwards the call to your gate number
        │
        ├─ caller is on your whitelist ──────────────► your phone rings (shown as your gate number)
        ├─ caller is your gate number (a loop) ──────► hang up
        └─ anyone else hears: "You have reached Pat. This call may be recorded.
           If you have the code, enter it now. To leave a message, press 1,
           or just stay on the line."
                │
                ├─ right code ───────────────────────► your phone rings
                ├─ wrong code, 1, or nothing ────────► voicemail, transcribed, sent to your phone
                └─ you don't pick up the ring ───────► voicemail
```

A robocall presses nothing and costs you a fraction of a cent. A missed call-back from a real person, including emergency dispatch, is never hung up on: staying on the line always reaches voicemail.

## What it costs

Read from Plivo's US pricing page on 2026-10-20. Check the current page before you count on these.

| Item | Price |
|---|---|
| One local phone number | $0.50 a month |
| A call that reaches the gate | $0.0055 a minute |
| Ringing your phone (the bridged leg) | $0.0115 a minute |
| Voicemail transcription | about $0.01 a minute |
| Web host | about $5 a month on Railway; Render and Fly also work |

At 40 screened calls and 10 real calls a month, that is about $1.25 in Plivo charges plus the host.

## What you need

1. A [Plivo](https://www.plivo.com) account with a few dollars of credit. A trial account can only call numbers you have verified, so plan to add credit before real use.
2. A web host that runs Node.js and gives you an `https://` address. [Railway](https://railway.app) is what this was written on. Avoid free tiers that sleep: a sleeping server answers too slowly and the call fails.
3. The free [ntfy](https://ntfy.sh) app on your phone for voicemail alerts (optional but recommended).
4. Ten minutes with your phone to set up call forwarding.

## Setup

Do these in order. Each step depends on the one before it.

### 1. Rent a number

In the Plivo console: **Phone Numbers → Buy Numbers**. Pick a local US number. Write it down. This is your `SERVICE_NUMBER`.

### 2. Put the server online

On Railway: **New Project → Deploy from GitHub repo**, pick your copy of this repository. Railway detects Node and runs `npm start`. Then open **Settings → Networking → Generate Domain** and copy the `https://` address. That is your `BASE_URL`.

In the service's **Variables** tab, add each setting from [.env.example](.env.example):

| Setting | What to put |
|---|---|
| `OWNER_PHONE` | your real cell number, digits only |
| `SERVICE_NUMBER` | the Plivo number from step 1 |
| `GATE_CODE` | 2 to 8 digits you will give to people who should reach you |
| `BASE_URL` | the `https://` address, with no slash at the end |
| `PLIVO_AUTH_TOKEN` | Plivo console → the auth token on the account overview page |
| `GREETING` | how the gate introduces itself, for example `You have reached Pat.` |
| `NTFY_URL` | `https://ntfy.sh/` plus a long random topic name; subscribe to the same topic in the ntfy app |
| `RING_SECONDS` | how long to ring you; keep it shorter than your carrier's ring time (see step 4) |

Open `BASE_URL` in a browser. You should see `callgate is running`.

### 3. Point the number at the server

In the Plivo console: **Voice → Applications → Add New Application**.

- Application name: `callgate`
- Primary answer URL: your `BASE_URL` followed by `/answer`, for example `https://callgate-production.up.railway.app/answer`
- Primary answer method: `POST`

Save it. Then **Phone Numbers → Your Numbers → click your number → Application type: XML Application → Plivo Application: callgate → Update**.

These screen names come from Plivo's documentation, not from a live account, so a label may differ slightly from what you see.

Call your gate number from any phone. You should hear the greeting. If you hear a Plivo error message instead, the answer URL or the server is wrong.

### 4. Forward your unanswered calls to the gate

This is "conditional" or "no-answer" forwarding: your phone still rings first, and only the calls you don't pick up go to the gate. Your number does not change.

Dial the code for your carrier from your phone, replacing `GATE` with your gate number (ten digits), and press call. The codes below are the standard ones; every carrier documents its own, and the published setup pages of the big call-screening apps use this same pattern. Confirm with your carrier. The wrong code can forward **all** your calls.

| Carrier | Turn on | Turn off |
|---|---|---|
| Verizon | `*71GATE` | `*73` |
| AT&T | `**004*GATE#` | `##004#` |
| T-Mobile | `**004*GATE#` | `##004#` |

Turn Wi-Fi off while you dial the code; several screening apps' guides say the code can fail over Wi-Fi calling.

Your carrier decides how long your phone rings before it forwards (Verizon says three or four rings). `RING_SECONDS` in step 2 must be shorter than that, or your carrier's own voicemail answers before the gate can ring you. Carriers can also charge airtime on forwarded calls; Verizon says so on its call-forwarding page.

### 5. Phone settings

**iPhone**

1. Settings → Contacts: save your gate number as a contact named, for example, `Gate`. Calls the gate passes to you show this number, so the phone must know it.
2. Settings → Apps → Phone → Screen Unknown Callers: choose **Silence**. Unknown callers are sent to voicemail without ringing, and your carrier then forwards them to the gate. Do not choose **Ask Reason for Calling**: Apple's screening answers the call itself, and an answered call is not forwarded.
3. Settings → Apps → Phone → Live Voicemail: **off**, so the iPhone does not answer and record before the forward happens.

**Android**

Save the gate number as a contact. If your phone has its own spam screening (Google's Call Screen, Samsung Smart Call), turn it off or it will answer before the forward.

### 6. Test it before you trust it

From a second phone, in this order:

1. Call your number and don't answer. You should hear the greeting.
2. Enter the code. Your phone should ring, showing the gate contact.
3. Call again, press 1, leave a message. An alert with the recording link should reach ntfy within a minute and the transcript a minute or two later.
4. Call again, say nothing, press nothing. You should reach voicemail, not a hang-up.
5. Add the second phone to `whitelist.txt` (one number per line), redeploy, call again. It should ring you with no greeting.
6. Call, enter the code, and don't answer the ring. The caller should land in voicemail.

If step 2 rings but the call drops after a few seconds, your `RING_SECONDS` is longer than your carrier's forward timer and the call looped. Lower it.

## Settings

All settings are environment variables. [.env.example](.env.example) lists every one with a note. For local testing, copy it to `.env`, set `CHECK_SIGNATURES=false`, and run:

```bash
npm install
npm start
```

Then `curl -X POST -d From=3125550123 http://localhost:3000/answer` prints the call XML.

`CHECK_SIGNATURES=false` must never be set on a public server. With checks on, the server refuses any request that is not signed by Plivo with your auth token.

## What has not been tested

Every branch of the call flow has an automated test ([test/flow.test.js](test/flow.test.js)). Nothing below has been checked on a real phone yet, and the first person to do so should record the result in [TEST-LOG.md](TEST-LOG.md).

- That each carrier actually forwards an unanswered call to the gate with the codes above.
- That an iPhone set to **Silence** lets the carrier forward a silenced call rather than taking the voicemail itself.
- That the carrier's forward timer is longer than `RING_SECONDS`, on each carrier.
- That a bridged call shown as the gate number is not labeled spam by the owner's carrier.
- That `**004*` works on AT&T and T-Mobile and `*71` on Verizon for current plans.

## Where this came from

Built by an appliance repair shop that already runs its phones on cloud voice agents. The design was reviewed before it was built, by two independent research passes, and the open questions those raised are in [LEGAL-AND-SAFETY.md](LEGAL-AND-SAFETY.md). It is one piece of [Lavelle](https://github.com/lavelle-os), an open method for running a small service business on AI agents.

MIT license. No warranty. Your number, your host, your responsibility.
