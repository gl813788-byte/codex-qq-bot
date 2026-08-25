# Architecture

[简体中文](ARCHITECTURE_CN.md) | English

This document is the map for changing the project without having to rediscover its boundaries from `src/server.js`.

## Runtime flow

```text
environment + runtime paths
          |
          v
    initial app state
          |
          v
 HTTP hub / channel adapter ------> QQ / OneBot
          v
 domain services -------------> memory, persona, stickers, web search
          |
          v
 infrastructure -------------> Codex CLI, files, processes, logs
```

`src/server.js` is the composition root. It wires dependencies, starts the HTTP listener and owns process shutdown. It remains transitional legacy orchestration, but Codex Agent execution, native tool/output boundaries, runtime-setting policy, settings snapshots/repository, file-Agent policy, and the HTTP server adapter now live in focused modules. New parsing, policy and persistence logic belongs in a focused module and is only wired from the composition root.

## Source layout

| Path | Responsibility | Change here when... |
| --- | --- | --- |
| `src/app/` | Application state and startup composition | changing global state shape or startup lifecycle |
| `src/app/qq-codex-runtime-settings.js` | Native Codex turn-setting command policy | changing reasoning summary/personality/service-tier validation or persistence actions |
| `src/app/qq-file-agent-turn.js` | Owner/administrator/public file-Agent capability policy | changing file-task roots, sandboxing, administrator destructive-operation refusal, or task instructions |
| `src/channels/http/hub-http-server.js` | HTTP request dispatch and safe error boundary | changing API/asset routing or OneBot webhook limiting |
| `src/channels/qq/` | Single QQ and OneBot message transport boundary | parsing or validating incoming QQ events |
| `src/config/` | Environment normalization and runtime defaults | adding an environment variable or changing a deployment default |
| `src/qq-enhancer/` | Optional QQ reply behavior | changing context images, proactive interest or reply style |
| `src/qq-main-prompt.js` | Main-model prompt boundary | changing role, execution order, approved proactive tasks or the need-based tool directory |
| `src/qq-proactive-pipeline.js` | Two-model proactive-chat contract | interest approvals and mandatory main-model validation for ordinary interjections, cold topic/chatter, and private outreach |
| `src/qq-proactive-cycle-state.js` | In-memory ordinary-interest cycle state | counting pending messages, resetting at confirmed Bot delivery, and superseding an in-flight pre-delivery judge without consuming later messages |
| `src/qq-conversation-follow-up.js` | Post-Bot-reply continuation batch state machine | same-sender matching, adaptive 3–12 minute and 2–6 message bounds, cap-without-early-judge plus five-second quiet batching, freeze-before-judge intake closure, and semantic-gate metadata |
| `src/qq-language-style.js` | QQ language-statistics candidates | group/member punctuation and functional-phrase counts plus high-frequency candidates, without assigning meanings |
| `src/qq-message-run-compaction.js` | Model-context repeat-run compaction | semantic identity, count merging, and Chinese count annotations for adjacent duplicate messages |
| `src/codex-app-server-turn.js` | One-turn Codex app-server client | `thread/start`/`thread/resume`, `turn/start`, in-flight control, direct interrupt-and-restart, inactive-turn race recovery, timeout, and interruption |
| `src/infrastructure/codex/qq-turn-runner.js` | QQ App Server lifecycle adapter | limits, isolated child environment, native turn settings, diagnostics, fused-turn recovery, cancellation and quota refresh |
| `src/infrastructure/codex/qq-native-tools.js` | Dynamic QQ tool surface | mapping structured App Server calls to existing authenticated Hub operations |
| `src/qq-cross-session.js` | Cross-session catalog and event rebinding | listing/resolving group/private selectors or safely rebinding a verified role to a target session |
| `src/qq-operation-log.js` | Unified QQ operation-log fields | aligning actor and source/target scope fields across Agent, administrator, social and cross-session work |
| `src/infrastructure/codex/qq-agent-output.js` | Structured QQ final-output boundary | reply/silence/addressing/attachment schema and delivery compatibility translation |
| `src/infrastructure/codex/qq-agent-attachments.js` | Codex generated-image import boundary | copying only current-turn, current-thread, signature-checked generated images into the active QQ task output, including recovery of the latest valid image for an explicit image task that omitted its attachment, while leaving file policy unchanged |
| `src/qq-inbound-files.js` | QQ inbound-file trust and transfer boundary | extracting redacted current/quoted file metadata, assigning turn-local selectors, building group/private URL lookups, and enforcing bounded downloads into the active task input |
| `src/infrastructure/storage/settings-repository.js` | Atomic settings I/O | loading or persisting `data/settings.json` without embedding filesystem code in the composition root |
| `src/qq-codex-turn-recovery.js` | Fused-turn failure isolation | detecting a replacement that exceeds its task-and-effort-specific protocol-idle window and rebuilding one fresh-thread attempt from the original prompt plus accepted fused input |
| `src/qq-reply-steering.js` | QQ follow-up fusion scheduler | a five-second quiet window reset by every new follow-up, snapshot consumption, active-turn steering with interrupt/replacement fallback, completed-draft replacement, failure retention, and active-turn identity checks |
| `src/qq-context-relevance.js` | Distant-chat semantic scoring | cached local semantic profiles and relevance scoring for older human/Bot transcript fragments |
| `src/qq-reply-targeting.js` | Fused-reply addressing policy | bounded participant candidates, structured model-selected quote/mention/plain targeting, and safe plain fallback |
| `src/qq-delivery-receipt.js` | QQ delivery truth boundary | delivered/failed bubble receipts and bounded next-turn failure context |
| `src/qq-codex-session.js` | QQ Codex session policy | temporary/persistent/auto selection, frequency thresholds, and normalized thread-map retention |
| `src/qq-outgoing-mentions.js` | Outgoing QQ mention resolver | exact name/QQ-number parsing, ambiguity rejection, group-member caching, and real `at` segment construction |
| `src/qq-knowledge-base.js` | QQ long-term knowledge domain | changing title/scope policy, slang matching, frequency evidence, deletion review state or its repository |
| `src/dashboard-knowledge-base.js` | Dashboard knowledge-management boundary | validating exact scoped upserts/deletes, stale conflicts, and frequency-evidence preservation |
| `src/qq-knowledge-review.js` | Complex knowledge-review prompt boundary | bounded interest triage, full-evidence main review, and strict result parsing |
| `src/qq-history-retrieval.js` | QQ review-history boundary | NapCat pagination, normalization, local merging and deduplication |
| `src/qq-short-term-memory.js` | QQ short-term memory domain | legacy migration, brief/detail, overwrite and stale lifecycle |
| `src/qq-style-review.js` | Human/Bot style-review boundary | flexible main-model prompt, phrase/sentence usage review, punctuation-to-slang references with confidence/boundaries, scoped slang patches, structured parsing and safe compaction |
| `src/qq-manual-ai-task.js` + `src/qq-menu.js` | Pure manual-model-task and QQ-menu policy/presentation boundaries | changing task aliases, scope validation, force-mode guidance, or visual menu sections |
| `src/unified-memory/` | Cross-channel memory | SQLite/FTS/vector hybrid recall, QQ-id/unique-alias person resolution, AI profile promotion, cross-session person scoping, and one-shot brief injection |
| `src/*.js` | Existing domain and infrastructure modules | changing the named capability while it is migrated incrementally |
| `modules/` | Platform clients and optional integrations | changing shared UI, launchers or the QQ social bridge |
| `scripts/` | Operator and deployment commands | changing checks, deployment or the `ncc` CLI |
| `test/` | Node test suite | every behavior change or extracted boundary |
| `data/` | Local persistent state | never source code; preserve across updates |
| `runtime/` | Logs, generated replies and temporary output | never source code; preserve while diagnosing |

## Dependency rules

1. Channel adapters normalize untrusted payloads before application logic sees them.
2. New environment settings go through `createEnvironmentConfig`; feature modules receive normalized values instead of reading `process.env` directly. Remaining direct reads in `server.js` are migration debt, not a pattern to copy.
3. Initial mutable state is created through `createInitialState`; tests and future embedded runtimes can obtain isolated state instances.
4. Domain modules must not start listeners, install signal handlers or terminate the process.
5. Filesystem, child-process and network side effects should sit behind a small exported function or factory so callers can test policy without performing the side effect.
6. Keep local data in `data/` and generated output in `runtime/`; do not import runtime files as source code.

## Configuration lifecycle

```text
process environment / config/local.env
                 |
                 v
       createEnvironmentConfig
                 |
                 v
          startup defaults
                 |
                 +---- data/settings.json overrides persisted settings
                 v
              app state
```

`config/local.env` is sourced by the repository `ncc start` command. A direct `npm start` only receives the caller's existing process environment. `data/settings.json` stores user-facing settings and overrides the corresponding startup defaults after it is loaded. Secrets should remain in the environment; see [Configuration](CONFIGURATION.md).

## Runtime boundaries

- **HTTP:** the dashboard and management API expose public state, maintenance status and logs. Non-loopback access is rejected unless remote binding and authentication are explicitly configured.
- **OneBot:** webhook payloads are authenticated or restricted to loopback, size-limited, normalized and deduplicated before QQ policy runs.
- **Codex:** every main reply, owner/public file task, chat summary, persona/style summary, and complex knowledge review runs through App Server; the legacy `codex exec` reply controller has been removed. Codex owns native multi-turn tool use, plans, context compaction, Web Search, file operations and shell execution. The Hub exposes QQ-specific dynamic tools through `item/tool/call`, handles them under the original sender's permissions, and requires strict structured final output. Bounded native commentary is separately sanitized and delivered as receipt-bearing task progress. When App Server wraps a commentary item in the complete QQ output object because an output schema is active, the Hub extracts visible `text`/`bubbles` only after exactly validating the object shape, `status`, addressing fields and an empty attachment list. The raw JSON envelope, plans, silent results, attachment-bearing intermediate results and final-schema JSON remain internal. Follow-up replacement, renewed task/effort deadlines and one fresh-thread recovery retain the existing semantics. Replacement protocol-idle detection uses the same effective task-and-effort window instead of a fixed one-minute cutoff. Persistent scopes resume the same thread while refreshing current dynamic-tool definitions. Every child receives an isolated allowlisted environment, concurrency limits, and current model, effort, summary, personality and service-tier settings.
- **QQ context:** after adjacent-repeat compaction, one contiguous recent window is always sent in full (group 20, explicit group 30, expanded group 48; private 30 or expanded 60). Semantic selection runs only over the older retained transcript and covers both human and Bot messages. Current text, quote and fused follow-ups form one query that is also reused across short-term, knowledge, impression and unified-memory recall.
- **QQ delivery:** the main model decides from full context whether a turn is casual or a substantive deliverable; problem solving, code, writing, summaries, and short task continuations use completion rather than the casual length hint. Before OneBot delivery, `src/qq-reply-chunks.js` splits text above the per-message safety limit into ordered bubbles at paragraph/sentence boundaries, avoiding both the old 900-character reply cut and one oversized send. Multi-sender fused turns expose bounded participants to the main model; every candidate can be selected for quote or mention through the structured `reply` object, while a missing/invalid target safely falls back to plain delivery. Legacy target markers are stripped from structured visible text before the human-length guard. Single-sender turns still use the relationship-based quote/mention/plain policy. OneBot bubble results are converted into delivery receipts; only delivered text enters sent-message memory, while failures are retained separately for the next model turn.
- **Model responsibilities:** the configured OpenRouter, DeepSeek, or custom OpenAI-compatible interest model is the lightweight background-decision and miscellaneous-triage plane. Provider adaptation is isolated in `src/interest-model-provider.js`; secrets stay in environment configuration while provider/model selection is persisted. It handles only bounded triggers, classification, risk labels, simple review, and whether a frozen same-sender batch after a Bot reply truly continues that exchange. The main Codex model owns conversation, summaries, tool research, topic selection, scoped term/punctuation labeling, knowledge extraction, complex reasoning, and final replies. All contextual meanings for terms, phrases and punctuation converge on the existing scoped slang knowledge variants; language profiles keep only structural usage rules and references to those entries.
- **Storage:** settings, memory and social state are local files. `data/settings.json` is loaded and atomically replaced through `src/infrastructure/storage/settings-repository.js`; the pure snapshot includes all native Codex runtime parameters. The QQ-scope-to-Codex-thread map is atomically stored in `data/qq-codex-sessions.json` without duplicating thread content. `qq-knowledge-base` preserves malformed input and enables read-only protection. Other memory load/save paths should move behind repositories incrementally.
- **Recurring and manual work:** `src/wall-clock-scheduler.js` only wakes domain checks. Due times stay in domain stores: ordinary-interest cycles and short-term memory use `data/qq-memory.json`, knowledge-frequency review uses `data/qq-knowledge-base.json`, and adaptive/persona clocks remain in their persona files. Startup and channel restoration run one immediate catch-up pass, and completed work establishes the next clock anchor. `/api/qq/ai-tasks`, QQ `/AI任务`, and NCC reuse the same summary/review functions, scope validation, and concurrency locks; force mode bypasses only scheduling and normal sample conditions. Automatic and manual low-frequency knowledge review both use the `qq-enhancer` structured channel for bounded interest triage, then start the main Codex model for full-evidence final review.

## Adding a feature

1. Pick the narrowest domain module. Create a directory under `src/channels/`, `src/app/` or an existing domain when the boundary is clear.
2. Add configuration in `src/config/environment.js`, including defaulting and bounds, instead of adding another direct `process.env` read to `src/server.js`.
3. Export pure parsing and policy functions separately from side-effecting functions.
4. Wire the module in `src/server.js`; keep the wiring small.
5. Add a focused `test/<capability>.test.js` file and run `npm run verify`.

## Incremental extraction roadmap

The remaining `src/server.js` code should be reduced in behavior-preserving slices:

1. Continue moving individual dashboard/API route handlers behind the new `src/channels/http/hub-http-server.js` boundary.
2. Move OneBot API calls and QQ reply delivery into `src/channels/qq/`.
3. Move the remaining Codex quota discovery into `src/infrastructure/codex/`; Agent turn execution is already extracted.
4. Move the remaining memory persistence into repositories under `src/infrastructure/storage/`; settings are already extracted.

Each slice should keep the public API stable and land with its own regression tests. Avoid a single large file-move commit: it makes behavioral review and rollback harder.

## Change checklist

1. Identify the boundary and its untrusted inputs.
2. Preserve persisted schemas or add a compatible migration.
3. Add focused unit tests and integration coverage where side effects meet policy.
4. Run `npm run verify`.
5. Update both language versions of affected documentation and the packaged skill when operator behavior changes.
