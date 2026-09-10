# AWS voice setup (Polly + Transcribe)

Phase 98 — per-instance operator setup for the AWS-backed voice endpoints. Each
Skynet instance (t1000, T800, future) uses its own AWS account and its own IAM
role; policy attach is a per-operator step, not shipped in code. Without a
policy attach, voice features are dark (503 responses to `/voice/transcribe`
and `/voice/speak-stream`) — this is intentional and IS the cost gate.

## What this covers

- Attaching a narrow IAM policy to your instance's EC2 role that grants access
  to Amazon Polly + Amazon Transcribe streaming.
- Verifying the policy is live via one `aws` CLI command.
- Understanding the off-switch behavior (policy absence = feature dark, no
  crash, no error cascade).
- Instance-specific notes for **t1000 (Ashley)** and **T800 (Stacy)**.
- Ship-motion coordination checklist.

## Prerequisites

- AWS CLI installed on the Skynet instance (`aws --version` succeeds).
- Ambient EC2 instance role attached (IMDS available). Verify:

  ```bash
  curl -s http://169.254.169.254/latest/meta-data/iam/info
  ```

  Should return JSON that includes `InstanceProfileArn`. If it returns nothing
  or a 404, the instance has no attached role and no amount of policy work
  will help — coordinate with your cloud-infra team first.

- IAM permissions on the operator side to attach a customer-managed policy (or
  inline policy) to that EC2 instance role. If the operator doesn't have the
  IAM perms, they need to coordinate with the cloud-infra team (Iris on
  Ashley's side).

## Steps

1. **Create a customer-managed IAM policy** named `SkynetPollyTranscribe` with
   the JSON below (see § The policy JSON). Do this via the AWS Console
   (IAM → Policies → Create policy → JSON), the CLI (`aws iam create-policy`),
   or Terraform/CDK if you manage IAM as code.

2. **Attach the policy to the instance's EC2 role** (the role whose profile
   ARN was returned by the IMDS check above). Console: IAM → Roles → the
   role → Add permissions → Attach policies → search
   `SkynetPollyTranscribe`. CLI:

   ```bash
   aws iam attach-role-policy \
     --role-name <your-instance-role-name> \
     --policy-arn arn:aws:iam::<your-account-id>:policy/SkynetPollyTranscribe
   ```

3. **Verify Polly access from the instance:**

   ```bash
   aws polly describe-voices --engine generative --language-code en-US
   ```

   Expected: JSON listing 7+ generative en-US voices (including Danielle,
   Joanna, Ruth, Salli, Matthew, Stephen, Tiffany). If you get
   `AccessDeniedException`, the policy is not yet attached OR you need to
   wait ~30s for IAM propagation and retry.

4. **Verify Transcribe access from the instance:**

   ```bash
   aws transcribe list-vocabularies --max-results 1
   ```

   Expected: an empty list (or a short list) with no `AccessDeniedException`.
   Same 30s IAM-propagation note applies.

5. **Restart Skynet** so the backend picks up the newly-live IAM permissions
   on its next request:

   ```bash
   docker-compose restart skynet
   ```

   (Strictly speaking, the SDK's default credential chain refreshes IMDS
   creds automatically and no restart is required. Restart is belt-and-braces
   confirmation that the backend sees the new permission surface.)

6. **Smoke-test from the browser:**
   - Voice-out: open any Claude Code pane, click the speaker icon on an
     assistant message. Audio should synthesize and play through the
     standard client audio pipeline.
   - Voice-in: click the mic icon in the compose box, say a short phrase,
     stop recording. A transcript should appear.

   If both work, you're done. If either 503s, jump to § What happens if the
   policy is absent below.

## The policy JSON

Copy-pasteable, exact 4 actions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "polly:SynthesizeSpeech",
        "polly:DescribeVoices",
        "transcribe:StartStreamTranscription",
        "transcribe:StartStreamTranscriptionWebSocket"
      ],
      "Resource": "*"
    }
  ]
}
```

`Resource: "*"` is intentional. Polly and Transcribe are API-level services
with no resource-level scoping in IAM — cost and scope control is via the
action list, not the resource list. If you tighten `Resource` to anything
other than `*` you will get `MalformedPolicyDocument` on policy create OR
silent AccessDenied at runtime.

## What happens if the policy is absent

Voice endpoints return HTTP 503 with a small JSON body:

- `/voice/transcribe` → `{ "error": "voice STT unavailable", "status": 503 }`
- `/voice/speak-stream` (and the non-streaming `/voice/speak`) → equivalent TTS
  error body.

Skynet logs one line per attempt at `info` level (not `error`) — the log
`operation` field will be `voice_transcribe_access_denied` or
`voice_speak_access_denied`. This is the expected dark-mode state, so it's
deliberately NOT an error.

Frontend UI shows the standard "voice unavailable" affordance. No console
spam, no crash, no cascade into other features.

**Detaching the policy at any time flips the feature off cleanly. Re-attaching
flips it back on at the next request** — no Skynet restart required (the SDK
default credential chain refreshes IMDS creds automatically).

## Region

Region is hardcoded to `us-east-1` in the adapter code:

- `src/backend/voice/polly-adapter.ts` — `new PollyClient({ region: "us-east-1" })`
- `src/backend/voice/transcribe-adapter.ts` — `new TranscribeStreamingClient({ region: "us-east-1" })`

To change region: edit both adapters. Note: Amazon Polly's generative engine
is **not available in every region**. Verify availability at
<https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html> before
switching. Both t1000 and T800 have `us-east-1` generative available.

## Cost

- **Voice-out (Polly generative):** ~$30 per 1M chars synthesized. A typical
  assistant message (~1500 chars) costs ~$0.045. The `SPEAK_TEXT_MAX` cap of
  25000 chars = ~$0.75 max per single call.
- **Voice-in (Transcribe streaming):** ~$0.024 / minute of audio. A typical
  voice note (~10s) costs ~$0.004. The multer 25 MB upload cap works out to
  ~25 min of audio max = ~$0.60 max per single call.
- The JWT auth gate on `/voice/*` means only authenticated Skynet users can
  trigger any spend.
- **Policy-attach is the primary cost gate.** Not attaching the policy = zero
  AWS spend. This is the shape's off-switch by design.

## For t1000 (Ashley's instance)

Policy is already attached:
`termix-ssm-role/PollyTranscribeExploratory` (Iris attached 2026-09-09 for the
exploration phase).

**PRE-SHIP action:** ping Iris to re-scope the policy name from
`-Exploratory` to a production name (she asked for this explicitly). No
functional change — same 4 actions, cleaner name for the prod-tracked policy.

Verification from t1000 should already succeed without any additional work —
just re-run the two `aws` CLI checks in step 3–4 above.

## For T800 (Stacy's instance)

Follow the numbered steps above using Stacy's own AWS account and her EC2
instance role. No modifications needed; the doc is the whole runbook.

If any step is unclear or fails, contact Ashley (not tabitha directly —
Ashley routes questions to the right person).

## Coordination checklist (ship-motion)

- [ ] Ping Iris to re-scope t1000 policy name from `PollyTranscribeExploratory`
      to a production name on `termix-ssm-role` (pre-ship, Ashley owns).
- [ ] Confirm `SKYNET_BASE` URL is set correctly for tg-bridge → Skynet
      routing (per Plan 08 rewire).
- [ ] Confirm `ffmpeg` is present in the docker image (per Plan 01;
      verify with `docker run --rm skynet-patched:local ffmpeg -version`).
- [ ] Run the AWS integration smoke as a pre-ship sanity check from t1000:

      ```bash
      AWS_INTEGRATION_TESTS=1 npx vitest run src/backend/voice/*.integration.test.ts
      ```

- [ ] Post-deploy: browser smoke on both t1000 and T800 per step 6 above.
