'use strict';
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sessionIdentity = p => p && Object.hasOwn(p, 'id') ? text(p.id) : text(p?.session_id);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const PARSER_VERSION = 4;

// Explicit wire paths, not a recursive search for ID-looking fields. See
// docs/ROLLOUT-OWNERSHIP.md for the protocol inventory and compatibility limits.
const requiredThread = new Set(['item_started', 'item_completed', 'agent_message_content_delta',
  'plan_delta', 'reasoning_content_delta', 'reasoning_raw_content_delta', 'token_usage', 'token_usage_record']);
const senderEvents = new Set(['collab_agent_spawn_begin', 'collab_agent_spawn_end',
  'collab_agent_interaction_begin', 'collab_agent_interaction_end', 'collab_waiting_begin',
  'collab_waiting_end', 'collab_close_begin', 'collab_close_end', 'collab_resume_begin', 'collab_resume_end']);
const localEvents = new Set(`error warning auth_recovery_started auth_recovery_completed guardian_warning
  realtime_conversation_started realtime_conversation_realtime realtime_conversation_closed realtime_conversation_sdp
  model_reroute model_verification turn_moderation_metadata safety_buffering context_compacted thread_rolled_back
  task_started turn_started task_complete turn_complete task_aborted turn_aborted thread_settings_applied token_count
  agent_message user_message agent_reasoning agent_reasoning_raw_content agent_reasoning_section_break
  session_configured environment_connected environment_disconnected thread_goal_updated thread_queue_changed
  mcp_startup_update mcp_startup_complete mcp_tool_call_begin mcp_tool_call_end web_search_begin web_search_end
  image_generation_begin image_generation_end exec_command_begin exec_command_output_delta terminal_interaction
  exec_command_end view_image_tool_call exec_approval_request request_permissions request_user_input
  dynamic_tool_call_request dynamic_tool_call_response elicitation_request elicitation_abandoned apply_patch_approval_request
  guardian_assessment deprecation_notice stream_error patch_apply_begin patch_apply_updated patch_apply_end turn_diff
  realtime_conversation_list_voices_response plan_update shutdown_complete entered_review_mode exited_review_mode
  raw_response_item raw_response_completed hook_started hook_completed sub_agent_activity`.split(/\s+/));
const responseTypes = new Set(`additional_tools message agent_message reasoning local_shell_call function_call
  function_call_output custom_tool_call custom_tool_call_output tool_search_call tool_search_output web_search_call
  image_generation_call compaction`.split(/\s+/));

function owners(record, strict = false) {
  const p = record?.payload, values = [record?.thread_id, record?.threadId, p?.thread_id, p?.threadId];
  const type = record?.type === 'event_msg' ? p?.type : record?.type;
  const required = value => { if (strict && !text(value)) fail('SOURCE_OWNERSHIP_AMBIGUOUS'); values.push(value); };
  if (requiredThread.has(type)) required(p?.thread_id);
  if (senderEvents.has(type)) required(p?.sender_thread_id);
  if (type === 'thread_goal_updated') {
    required(p?.threadId);
    required(p?.goal?.threadId);
    values.push(p?.goal?.thread_id);
  }
  if (type === 'thread_queue_changed') required(p?.threadId);
  if (type === 'session_configured') required(p?.thread_id ?? p?.session_id);
  if (type === 'raw_response_item') values.push(p?.item?.thread_id, p?.item?.threadId);
  return values.filter(value => value !== undefined && value !== null);
}
function assertOwnership(record, expected, strict = false) {
  for (const owner of owners(record, strict)) if (!text(owner) || owner !== expected) fail('SOURCE_OWNERSHIP_CONFLICT');
}
function assertInheritedFormat(record) {
  const p = record.payload;
  if (!object(p)) fail('UNSUPPORTED_INHERITED_RECORD');
  if (record.type === 'event_msg') {
    if (!localEvents.has(p.type) && !requiredThread.has(p.type) && !senderEvents.has(p.type)) fail('UNSUPPORTED_INHERITED_RECORD');
    // Raw response wrappers carry protocol objects; their content/tool arguments
    // remain opaque, but their discriminant must be reviewed before exclusion.
    if (p.type === 'raw_response_item' && !responseTypes.has(p.item?.type)) fail('UNSUPPORTED_INHERITED_RECORD');
  } else if (record.type === 'response_item') {
    if (!responseTypes.has(p.type)) fail('UNSUPPORTED_INHERITED_RECORD');
  } else if (record.type === 'world_state') {
    if (typeof p.full !== 'boolean' || !object(p.state)) fail('UNSUPPORTED_INHERITED_RECORD');
  } else if (record.type === 'token_usage_record') {
    // A separate RolloutItem variant in addition to event_msg compatibility.
    if (!text(p.thread_id)) fail('SOURCE_OWNERSHIP_AMBIGUOUS');
  } else if (!['session_meta', 'turn_context', 'compacted'].includes(record.type)) fail('UNSUPPORTED_INHERITED_RECORD');
}

// Every header is validated, including parent headers in a copied prefix and
// same-ID repeats. A repeat cannot introduce, remove or change layout semantics.
function declaration(p) {
  const id = sessionIdentity(p);
  if (!id) fail('MISSING_SESSION_ID');
  const parentId = text(p.forked_from_id), spawn = p.source?.subagent?.thread_spawn;
  const external = p.history_base != null || p.forked_from_ordinal_exclusive != null;
  const supported = !external && p.multi_agent_version === 'v2' && p.history_mode === 'paginated' && object(spawn)
    && parentId && parentId !== id && text(p.parent_thread_id) === parentId && text(spawn.parent_thread_id) === parentId
    && Number.isSafeInteger(p.subagent_history_start_ordinal) && p.subagent_history_start_ordinal >= 2;
  const declaresHistory = external || p.forked_from_id != null || spawn != null && p.subagent_history_start_ordinal != null
    || p.multi_agent_version != null && !['disabled', 'v2'].includes(p.multi_agent_version)
      && (p.parent_thread_id != null || spawn != null || p.subagent_history_start_ordinal != null)
    || p.subagent_history_start_ordinal != null && p.multi_agent_version !== 'disabled';
  if (declaresHistory && !supported) fail('UNSUPPORTED_INHERITED_HISTORY');
  const signature = JSON.stringify([p.session_id ?? null, p.forked_from_id ?? null, p.parent_thread_id ?? null,
    p.multi_agent_version ?? null, p.history_mode ?? null, p.subagent_history_start_ordinal ?? null,
    spawn == null ? null : [spawn.parent_thread_id ?? null]]);
  return { id, parentId, supported, signature };
}

// Parsed nonblank record positions, not caller-supplied ordinals, delimit copied
// history. When a fork supplies ordinals they must corroborate physical order.
function canonicalSource() {
  let ordinal = -1, id = null, fork = null, ready = false, prefixOwner = null;
  const declarations = new Map();
  return {
    get id() { return id; }, get fork() { return fork; }, get ready() { return ready; },
    accept(record, offset) {
      if (record === undefined) return false; // Blank line, as produced by Recorder.
      if (!object(record) || !text(record.type)) fail('MALFORMED_COMPLETE_RECORD');
      ordinal++;
      let header;
      if (record.type === 'session_meta') {
        header = declaration(record.payload);
        assertOwnership(record, header.id);
        const previous = declarations.get(header.id);
        if (previous !== undefined && previous !== header.signature) fail('SESSION_DECLARATION_CHANGED');
        declarations.set(header.id, header.signature);
      }
      if ((fork || header?.supported) && Object.hasOwn(record, 'ordinal') && record.ordinal !== ordinal) fail('FORK_HISTORY_BOUNDARY_INVALID');
      if (fork && !ready) {
        if (ordinal < fork.ordinal) {
          assertInheritedFormat(record);
          if (header && header.id !== fork.parentId) fail('SESSION_ID_CHANGED');
          // Nested copied/external histories require a separate projection model.
          if (header?.supported) fail('UNSUPPORTED_INHERITED_HISTORY');
          assertOwnership(record, fork.parentId, true);
          return false;
        }
        if (record.type !== 'event_msg' || record.payload?.type !== 'thread_settings_applied'
          || record.payload.thread_id != null && record.payload.thread_id !== id) fail('FORK_HISTORY_BOUNDARY_INVALID');
        assertOwnership(record, id);
        fork.offset = offset; ready = true; return true;
      }
      if (!header) {
        if (id) assertOwnership(record, id);
        else for (const owner of owners(record)) {
          if (!text(owner) || prefixOwner && prefixOwner !== owner) fail('SOURCE_OWNERSHIP_CONFLICT');
          prefixOwner = owner;
        }
        return true;
      }
      if (id) { if (header.id !== id) fail('SESSION_ID_CHANGED'); return true; }
      id = header.id;
      if (prefixOwner && prefixOwner !== id) fail('SOURCE_OWNERSHIP_CONFLICT');
      if (header.supported) {
        if (ordinal !== 0) fail('FORK_HISTORY_BOUNDARY_INVALID');
        const p = record.payload;
        const initialRecord = { type: 'session_meta', payload: Object.fromEntries(
          ['model', 'effort', 'reasoning_effort', 'model_context_window', 'context_window'].map(key => [key, p[key]])) };
        fork = { id, parentId: header.parentId, ordinal: p.subagent_history_start_ordinal, initialRecord };
        return false;
      }
      ready = true; return true;
    },
    finish(expectedId) {
      if (!id) fail('MISSING_SESSION_ID');
      if (fork && !ready) fail('FORK_HISTORY_PENDING');
      if (expectedId !== undefined && id !== expectedId) fail('SESSION_ID_CHANGED');
    }
  };
}
module.exports = { canonicalSource, sessionIdentity, assertOwnership, PARSER_VERSION };
