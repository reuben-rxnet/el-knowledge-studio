# Integrations

## AI provider: OpenAI Codex (same setup as Knowzy)

The configuration mirrors the Knowzy project's GATEWAY-M1 setup:

| Setting | Value |
| --- | --- |
| Endpoint | `https://dev-apim-ai.luxottica.com/codex/openai/v1` (Azure OpenAI through EssilorLuxottica API Management) |
| Deployment | `gpt-5.3-codex_codeassist` |
| API style | `RESPONSES` (`POST {base}/responses`). `CHAT_COMPLETIONS` is also supported |
| Credential | Gateway subscription key as the `subscription-key` **query parameter** |
| Fixed header | `x-openai-supplier: EssilorLuxottica` |
| Allow-list | `LLM_ENDPOINT_ALLOWLIST=dev-apim-ai.luxottica.com` |

Code: `src/lib/services/openai/` (`provider-request.ts`, `client.ts`, `config.ts`, `services.ts`).

### Safeguards ported from Knowzy

- The key is revealed in exactly one place (`providerFetch`): into the configured header **or** query parameter, never both.
- The key is only sent to allow-listed hosts, over https (loopback excepted), with **redirects refused**.
- A base URL carrying credentials is refused. `sanitizeUrl` redacts credential query parameters by exact name.
- Extra headers are non-secret configuration. Credential-shaped and protocol header names are refused.
- Every request uses a strict JSON schema, `tools: []` and `store: false`.
- The provider's error **message** is never kept (OpenAI's 401 quotes a masked key). Only the status and code are kept.
- 429, 5xx, timeouts and connection resets are retried with backoff. `MALFORMED_OUTPUT` is not retried, because the tokens are already spent.
- The served model ID (a dated snapshot) is recorded alongside the configured alias.
- **Gates** (`assertExternalAiAllowed`): the provider must be configured, `AI_DATA_PROCESSING_APPROVAL_REF` must be recorded, and Highly Confidential and Restricted content is never sent.

### What Codex does (AI_PROVIDER=openai)

Everything the simulated AI did now runs on Codex through the live pipeline (`src/server/jobs/pipeline.ts`):

| Pipeline stage / feature | How | Prompt |
| --- | --- | --- |
| Read the source | Text extracted server-side from uploaded PDF, DOCX, PPTX and TXT (`src/lib/services/extract.ts`), plus the creator's process notes | — |
| Transcribe narration | `POST /audio/transcriptions`, **only if `OPENAI_TRANSCRIBE_MODEL` is set** | — |
| Sensitive information, chapters, script, guide steps, FAQ, knowledge article (summary, purpose, prerequisites) | One structured call | `guide.generate@1` |
| Quiz questions (stored, marked "needs review") | Structured call | `quiz.generate@1` |
| Machine translation of step titles, instructions and script into every target language (stored side by side, protected terms enforced) | One structured call per language | `translate@1` |
| Script rewrites in the video editor | Structured call | `script.rewrite@1` |
| Knowledge Hub grounded answers with citations | Structured call | `answer.grounded@1` |
| Quality checks (structure, timestamps, terminology) | Deterministic code, not AI | — |

The pipeline runs in the background with `after()` once the project is created. A lease ensures one runner per job, and the progress poller resumes a job whose runner stopped (for example after a restart). Quiz, translations and transcription are optional: if one fails, the draft is still saved and the job ends as **partial**, with the reason shown on the processing page. If guide generation fails, nothing is stored, the project returns to Draft and the user can retry.

**Not Codex capabilities, so skipped with an explanation on the processing page:** visual scene detection (Azure AI Video Indexer), screenshot capture and video rendering (FFmpeg render worker), and voice synthesis (Azure AI Speech).

### Transcription through the gateway

Codex models don't transcribe audio. If the APIM gateway exposes an audio deployment, set `OPENAI_TRANSCRIBE_MODEL` (for example `whisper-1` or `gpt-4o-transcribe`), plus `OPENAI_TRANSCRIBE_BASE_URL` if it lives on a different path. A 404 from the gateway is reported as `TRANSCRIPTION_ROUTE_MISSING`. Recordings up to 25 MB can be transcribed (the OpenAI limit). Without transcription, the AI works from the creator's notes, so recordings should come with good process notes.

### Checking the connection

**Administration → AI provider → Test connection** sends one content-free structured request through the same path as generation and shows the served model or the error code. Each test is audited.

## Other services (stubs / planned)

| Service | Interface | Status |
| --- | --- | --- |
| Microsoft Entra ID (OIDC) | `getSession()` | Not connected. Demo auth in development |
| Azure Blob Storage (region-aware) | `StorageAdapter` | Mock: metadata only |
| Malware scanning | `MalwareScanner` | Mock: always clean |
| Azure AI Speech (STT/TTS) | `TranscriptionService`, `TextToSpeechService` | Interface only |
| Azure AI Video Indexer | `VideoAnalysisService` | Interface only |
| Azure AI Translator | `TranslationService` | Interface only. Seeded translation states |
| Azure AI Search | `SearchIndexService` | In-database search for now |
| Microsoft Graph (SharePoint, Teams, Stream) | `PublishingConnector` | Mock connectors. `graphSharePointConnector` stub throws until configured |
| Leonardo, Knowzy | `PublishingConnector` | Mock connectors |

## Speech and video (Phase 2, open source on the server)

The Codex gateway has no audio routes: every speech-to-text and text-to-speech model name tried returned 404 (tested on 2026-10-23). Phase 2 therefore uses open-source models that run on the application server (`SPEECH_PROVIDER=local`). Licences are in [third-party.md](third-party.md).

| Feature | How |
| --- | --- |
| Transcription | FFmpeg extracts 16 kHz audio, then Whisper (`LOCAL_STT_MODEL`) transcribes with timestamps. Protected terms are restored to their exact spelling. If the gateway adds `OPENAI_TRANSCRIBE_MODEL`, that is used instead |
| Playback | `/api/projects/[id]/media` streams the stored recording with HTTP Range (seeking). Authorized on every request |
| Captions | `/api/projects/[id]/captions?lang=xx` serves WebVTT from the script or its translation. Used by the player, and downloadable for Stream or Teams |
| Narration preview | The browser's own voices, restricted to voices that run on the PC (`localService`). Edge's online voices would send text to Microsoft, so they are hidden |
| AI voiceover | Kokoro-82M (English) during rendering |
| Screenshots | Captured in the browser from the recording at each step's timestamp. Scenes marked for redaction are blurred before upload |
| Rendering | `RenderJob` plus FFmpeg. Recordings get burned-in captions, blur and optional AI narration. Documents get a title card and narrated slides, with a soft captions track. MP4 download follows the classification policy (Confidential and above need the download permission) |
