// Opt-in (CODEX_REMOTE_CONTACT_AGENT_LEAN_CONTEXT=1) per-thread overrides for
// deployments that use the QQ bot only as a chat persona. By default QQ turns
// keep Codex's full native toolset, because the bot is also a working Agent.
// When enabled, browser and computer use, connectors, plugins, sub-agents,
// goals, the skill catalog and the checkout's AGENTS.md leave QQ turns; on
// Codex 0.163 that saves about 7k input tokens per request. Shell,
// apply_patch, web search, image viewing, planning and image generation stay.
export const CODEX_LEAN_QQ_FEATURE_OVERRIDES = Object.freeze({
  "features.apps": false,
  "features.plugins": false,
  "features.browser_use": false,
  "features.browser_use_external": false,
  "features.computer_use": false,
  "features.in_app_browser": false,
  "features.multi_agent": false,
  "features.goals": false,
  "features.tool_suggest": false,
  "features.sleep_tool": false,
  "features.skill_search": false,
  "skills.include_instructions": false,
  include_apps_instructions: false,
  include_collaboration_mode_instructions: false
});

export function buildCodexLeanQqConfig(config = null, { enabled = false, keepProjectDocs = false } = {}) {
  const explicit = config && typeof config === "object" ? config : {};
  if (!enabled) return Object.keys(explicit).length ? explicit : config;
  return {
    ...CODEX_LEAN_QQ_FEATURE_OVERRIDES,
    // Owner file tasks that work inside the checkout still read its AGENTS.md.
    ...(keepProjectDocs ? {} : { project_doc_max_bytes: 0 }),
    ...explicit
  };
}
