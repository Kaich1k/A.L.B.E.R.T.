# Free and Fast AI Options for Albert

Research checked against vendor documentation on 2026-08-05. Speed numbers below are vendor claims;
free quotas can change and should be re-read from response headers or the provider console.

## Recommended stack

Anthropic, Groq, Gemini (Google AI Studio), and Ollama are wired into Albert today. The other rows are
researched next-provider options, not controls that already exist in Systems.

| Priority | Provider and model | Status | Best Albert role | Current free allowance / caveat |
| --- | --- | --- | --- | --- |
| 1 | Groq `openai/gpt-oss-20b` | Implemented, but blocked by this Groq organization until an admin enables it | Recommended cloud QUICK model when Groq is selected | 30 RPM, 1,000 requests/day, 8K TPM, 200K tokens/day. Groq advertises ~1,000 tokens/sec, 131K architectural context, tools, JSON, and reasoning; the free 8K TPM ceiling makes very large uncached prompts impractical. |
| 2 | Ollama `qwen3.5:4b` | Implemented and the new-settings default; not installed on this Mac yet | Private, offline conversation on this 16GB Mac when Endpoint is Local | No service quota when run locally. The quantized model is about 3.4GB and supports text, vision, and tools. Keep active context around 4–8K for responsiveness. Endpoint Auto uses Ollama Cloud when an API key is present. |
| 3 | Gemini `gemini-2.5-flash` | Implemented on Mac (QUICK provider) and mobile (Systems provider / Auto peer) | Free-tier Google AI Studio route; good Flash latency | Free input/output subject to project RPM/day quotas. Default model is `gemini-2.5-flash` with lite/pro fallbacks. Free-tier traffic may be used to improve Google products. Albert still uses its own `web_search` tools; Google Search grounding is not enabled on the free path. Key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| 4 | Cerebras `gpt-oss-120b` | Researched, not implemented | Groq overflow and stronger free text/tool reasoning | 30 RPM, 14,400 requests/day, 64K TPM, 1M tokens/day; no vision/audio and only an 8K free context allowance. |
| 5 | Cloudflare Workers AI | Researched, not implemented | Consolidated chat/STT/TTS emergency route | 10,000 neurons/day shared across Workers AI models; requests stop when the free allocation is exhausted. |

Useful secondary routes:

- Mistral Studio Free is a no-card evaluation tier with an OpenAI-compatible API, vision, and tools.
  Exact free quotas are account-specific; Mistral says API data is not used for training.
- OpenRouter is excellent for experiments, but its zero-spend free models are limited to 50 requests/day
  and 20 RPM. Pin a model; do not use the random `openrouter/free` router as Albert's stable personality.
- GitHub Models is useful for prototyping and model comparisons, not an always-on assistant. GitHub
  explicitly describes free API access as experimentation-oriented and rate-limited.
- Hugging Face's $0.10/month free inference credit is too small to be a practical daily Albert route.

## Migration scaffolding and required account action

Groq will shut down `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` on 2026-08-16.
`meta-llama/llama-4-scout-17b-16e-instruct` was already retired on 2026-07-17.

The code migration is in place, but this installation is **not operationally migrated yet**. Its saved
Groq model remains Llama 3.1; live probes show both temporary Llama bridges work, but no post-cutoff
replacement is enabled for this organization.
An organization administrator must enable a replacement before August 16. If that does not happen,
switch QUICK to local Ollama; Groq requests will stop working after the cutoff. Albert now:

- defaults new installs to `openai/gpt-oss-20b`, while retaining a working transition model when
  an organization has not enabled GPT-OSS yet;
- migrates already-retired Llama 4 Scout to `openai/gpt-oss-120b` and fails over among current Groq IDs;
- normalizes requests away from the two temporary Llama IDs at the August 16 cutoff on Mac and phone;
  the pickers drop them on the next app load after the cutoff;
- calls the mixed Ollama/Groq/Gemini tier **QUICK**, and labels Groq/Gemini as cloud free tiers instead of
  implying they are on-device/private;
- gives each Groq model call a 35-second total retry budget and each Ollama model call a 40-second cloud /
  90-second local retry budget, instead of resetting a long timeout for every schema/endpoint attempt;
- answers current-brain questions from the resolved route rather than asking a model to identify itself.

## Suggested future router

1. On-device/private request: Ollama `qwen3.5:4b`, 4–8K context. Albert disables Qwen 3 thinking on
   ordinary chat requests to protect voice latency.
2. Casual cloud request: Groq `openai/gpt-oss-20b` or Gemini `gemini-2.5-flash` (both implemented).
3. Vision / longer multimodal context: prefer Gemini Flash family (text path live today; richer multimodal later).
4. Groq quota/outage: Cerebras `gpt-oss-120b` (not implemented) or Gemini as peer failover on mobile Auto.
5. Premium tool-heavy reasoning: retain Anthropic Haiku/Opus.

The next provider-layer improvement should be one OpenAI-compatible adapter with capability flags,
per-provider time-to-first-token metrics, `Retry-After` handling, a short circuit breaker, and a model
deprecation registry. Tool schemas should be selected by intent instead of sending every tool on every
free-tier request.

## Live checks on this Albert installation

The committed `npm run test:providers` smoke test reads configured credentials without printing them and
checks availability, streaming, and one strict function call. On 2026-08-05 it measured:

- configured Groq Llama 3.1 8B: available across repeated runs; 71–263ms to first streamed token,
  201–380ms total for the exact-reply test, and a valid strict-schema function call in 108–234ms;
- GPT-OSS 20B, GPT-OSS 120B, and Qwen 3.6 27B: each returned HTTP 403 because this Groq organization
  has not enabled those models yet;
- local Ollama: healthy 7–36ms daemon probe with only `llama3.1:8b` installed. First-probe latency
  varied from 0.43–6.83s depending on whether the model was still resident (reported load time
  0.14–6.18s); immediate warm turns took 0.37–0.68s at 19.4–23.9 generated tokens/sec. The smoke test
  does not forcibly unload the model, so “first probe” is more accurate than claiming every run is cold.

This is why Albert preserves the working transition model and adds runtime model failover instead of
blindly rewriting this installation to GPT-OSS. An organization admin still needs to enable at least one
replacement in [Groq organization limits](https://console.groq.com/settings/limits) before August 16.

Privacy matters when choosing a free route. Groq documents temporary retention and Zero Data Retention
controls; OpenRouter data handling depends on the underlying provider; Gemini explicitly warns that free-
tier traffic may be used to improve Google products. For sensitive work, local Ollama remains the safest
default.

## Voice-provider ideas

- Keep the current local Whisper Base + Kokoro path as the private baseline.
- Groq Whisper Large V3 Turbo is a strong future cloud STT fallback when local transcription is too slow;
  it should be opt-in because microphone audio leaves the Mac.
- Gemini Live is worth prototyping for future full-duplex interruption and audio, but it is a separate,
  preview-style architecture—not a drop-in replacement for Albert's now-hardened local voice loop.

## Sources

- [Groq deprecations](https://console.groq.com/docs/deprecations)
- [Groq GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b)
- [Groq free rate limits](https://console.groq.com/docs/rate-limits)
- [Groq prompt caching](https://console.groq.com/docs/prompt-caching)
- [Groq data controls](https://console.groq.com/docs/your-data)
- [Groq speech-to-text](https://console.groq.com/docs/speech-to-text)
- [Gemini latest models](https://ai.google.dev/gemini-api/docs/latest-model)
- [Gemini pricing and free-tier data policy](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini model and Live API catalog](https://ai.google.dev/gemini-api/docs/models)
- [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)
- [Cerebras pricing and free context](https://inference-docs.cerebras.ai/support/pricing)
- [Cerebras OpenAI compatibility](https://inference-docs.cerebras.ai/resources/openai)
- [Ollama Qwen 3.5 tags](https://ollama.com/library/qwen3.5/tags)
- [Ollama context sizing](https://docs.ollama.com/context-length)
- [Ollama memory/concurrency behavior](https://docs.ollama.com/faq)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare OpenAI compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [OpenRouter free limits](https://openrouter.ai/docs/faq)
- [GitHub Models prototyping limits](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)
- [Mistral free API activation](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)
- [Mistral privacy controls](https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls)
- [Hugging Face inference pricing](https://huggingface.co/docs/inference-providers/en/pricing)
