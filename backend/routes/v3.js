const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const workspaceV3 = require('../services/v3-workspace-service');
const capabilityService = require('../services/v3-capability-service');
const operationCore = require('../services/v3-operation-core');
const legacyOperationService = require('../services/operation-service');
const ingestCredentialService = require('../services/ingest-credential-service');
const db = require('../database');
const previewAccessService = require('../services/preview-access-service');
const sourcePreviewService = require('../services/source-preview-service');
const outputService = require('../services/v3-output-service');
const runPlanService = require('../services/run-plan-service');
const sessionService = require('../services/session-service');
const preflightService = require('../services/preflight-service');

const router = express.Router();
router.use(jwtAuth);

function internalError(res, error, code = 'V3_INTERNAL_READ_FAILED') {
  return res.status(500).json({
    code,
    message: error.message || 'Failed to read Workspace V3 state',
    detail: null,
    retryable: true,
    correlation_id: null
  });
}


function requireRoomStream(req, res) {
  const streamId = workspaceV3.parseRoomId(req.params.roomId);
  if (!streamId) {
    res.status(404).json({ code: 'V3_ROOM_NOT_FOUND', message: 'Room not found', detail: req.params.roomId, retryable: false, correlation_id: null });
    return null;
  }
  const stream = db.prepare('SELECT id, name FROM streams WHERE id = ?').get(streamId);
  if (!stream) {
    res.status(404).json({ code: 'V3_ROOM_NOT_FOUND', message: 'Room not found', detail: req.params.roomId, retryable: false, correlation_id: null });
    return null;
  }
  return stream;
}

router.get('/rooms/:roomId/ingest-credentials', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  res.json({ room_id: workspaceV3.roomId(stream.id), credentials: ingestCredentialService.listCredentials(stream.id) });
});

router.post('/rooms/:roomId/ingest-credentials', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  try {
    const created = ingestCredentialService.createCredential(stream.id, { label: req.body?.label, created_by: req.user?.username || req.user?.sub || null });
    res.status(201).json({ room_id: workspaceV3.roomId(stream.id), ...created });
  } catch (error) {
    const validation = String(error.message).includes('required');
    res.status(validation ? 400 : 500).json({ code: validation ? 'V3_INGEST_VALIDATION' : 'V3_INGEST_CREATE_FAILED', message: error.message, detail: null, retryable: false, correlation_id: null });
  }
});

router.post('/rooms/:roomId/ingest-credentials/:credentialId/revoke', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  const credential = ingestCredentialService.revokeCredential(stream.id, req.params.credentialId);
  if (!credential) return res.status(404).json({ code: 'V3_INGEST_CREDENTIAL_NOT_FOUND', message: 'Ingest credential not found', detail: req.params.credentialId, retryable: false, correlation_id: null });
  res.json(credential);
});

router.post('/rooms/:roomId/sources/:sourceId/preview-access', async (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  const source = sourcePreviewService.resolvePullSource(stream.id, req.params.sourceId);
  if (!source) return res.status(409).json({ code: 'V3_SOURCE_PREVIEW_UNAVAILABLE', message: 'Only enabled IN-PULL sources are previewable in Phase 03.', detail: req.params.sourceId, retryable: false, correlation_id: null });
  const capability = sourcePreviewService.capability();
  if (!capability.available) return res.status(503).json({ code: 'V3_SOURCE_PREVIEW_RUNTIME_UNAVAILABLE', message: 'FFmpeg source preview runtime is unavailable.', detail: capability, retryable: true, correlation_id: null });
  res.json({ ...previewAccessService.issueSourcePreviewToken(stream, req.params.sourceId), capability });
});

router.post('/rooms/:roomId/program/switch', async (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  if (!idempotencyKey) return res.status(400).json({ code: 'V3_IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required', detail: null, retryable: false, correlation_id: null });
  try {
    const workspace = await workspaceV3.getWorkspace(stream.id);
    const target = (workspace.sources || []).find(source => source.id === req.body?.target_source_id);
    if (!target) return res.status(404).json({ code: 'V3_SOURCE_NOT_FOUND', message: 'Source not found', detail: req.body?.target_source_id || null, retryable: false, correlation_id: null });
    if (target.id === workspace.program?.source_id) return res.json({ already_program: true, program: workspace.program, operation: null });
    if (target.kind !== 'IN_PULL') return res.status(409).json({ code: 'V3_CROSS_OWNERSHIP_SWITCH_UNAVAILABLE', message: 'Switching to a non-current IN-PUSH source cannot preserve the old Program and is not enabled in Phase 03.', detail: target.id, retryable: false, correlation_id: null });
    const current = (workspace.sources || []).find(source => source.id === workspace.program?.source_id) || null;
    if (current && current.kind !== 'IN_PULL') return res.status(409).json({ code: 'V3_CROSS_OWNERSHIP_SWITCH_UNAVAILABLE', message: 'Cross PUSH/PULL Program switching is unavailable until a reversible ownership handoff exists.', detail: { from: current.id, to: target.id }, retryable: false, correlation_id: null });
    const operation = legacyOperationService.requestPullSourceSwitch(target.compatibility.pull_task_id, target.compatibility.external_source_id, req.user?.username || req.user?.sub || null, idempotencyKey);
    return res.status(202).json(workspaceV3.projectOperation(operation));
  } catch (error) {
    const conflict = String(error.message).includes('already in progress') || String(error.message).includes('already active') || String(error.message).includes('must be RUNNING') || String(error.message).includes('not enabled or active');
    return res.status(conflict ? 409 : 400).json({ code: conflict ? 'V3_PROGRAM_SWITCH_CONFLICT' : 'V3_PROGRAM_SWITCH_INVALID', message: error.message, detail: null, retryable: false, correlation_id: null });
  }
});


router.get('/output/scenes', (req, res) => {
  res.json({ scenes: outputService.listScenes() });
});

router.post('/rooms/:roomId/outputs', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  try {
    const mode = String(req.body?.mode || '').toUpperCase();
    if (mode === 'PUSH') {
      return res.status(201).json({ output: outputService.createPushOutput(stream.id, req.body) });
    }
    if (mode === 'SERVE') {
      return res.status(201).json({ output: outputService.configureServeOutput(stream.id, req.body) });
    }
    if (mode === 'RECORD') {
      return res.status(201).json({ output: outputService.createRecordOutput(stream.id, req.body) });
    }
    return res.status(422).json({ code: 'V3_OUTPUT_MODE_UNSUPPORTED', message: 'Supported Output modes are PUSH, SERVE and RECORD.', detail: mode || null, retryable: false, correlation_id: null });
  } catch (error) {
    return res.status(422).json({ code: 'V3_OUTPUT_CREATE_INVALID', message: error.message, detail: null, retryable: false, correlation_id: null });
  }
});

for (const [action, desired] of [['start', 'RUNNING'], ['stop', 'STOPPED']]) {
  router.post(`/rooms/:roomId/outputs/:outputId/${action}`, (req, res) => {
    const stream = requireRoomStream(req, res); if (!stream) return;
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (!idempotencyKey) return res.status(400).json({ code: 'V3_IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required', detail: null, retryable: false, correlation_id: null });
    const taskId = outputService.parsePushOutputId(req.params.outputId);
    const serveStreamId = outputService.parseServeOutputId(req.params.outputId);
    const recordTaskId = outputService.parseRecordOutputId(req.params.outputId);
    try {
      let result;
      if (taskId) {
        const task = require('../services/push-task-service').getTask(taskId);
        if (!task || Number(task.stream_id) !== Number(stream.id)) return res.status(404).json({ code: 'V3_OUTPUT_NOT_FOUND', message: 'Output not found in this Room.', detail: req.params.outputId, retryable: false, correlation_id: null });
        result = outputService.startOrStopPush(taskId, desired, { idempotency_key: idempotencyKey, requested_by: req.user?.username || req.user?.sub || null });
      } else if (serveStreamId && Number(serveStreamId) === Number(stream.id)) {
        result = outputService.startOrStopServe(stream.id, desired, { idempotency_key: idempotencyKey, requested_by: req.user?.username || req.user?.sub || null });
      } else if (recordTaskId) {
        const task = require('../services/record-task-service').getTask(recordTaskId);
        if (!task || Number(task.stream_id) !== Number(stream.id)) return res.status(404).json({ code: 'V3_OUTPUT_NOT_FOUND', message: 'Recording output not found in this Room.', detail: req.params.outputId, retryable: false, correlation_id: null });
        result = outputService.startOrStopRecord(recordTaskId, desired, { idempotency_key: idempotencyKey, requested_by: req.user?.username || req.user?.sub || null });
      } else {
        return res.status(422).json({ code: 'V3_OUTPUT_OPERATION_UNSUPPORTED', message: 'Unsupported Output operation target.', detail: req.params.outputId, retryable: false, correlation_id: null });
      }
      if (result.conflict) return res.status(409).json({ code: 'V3_OUTPUT_OPERATION_CONFLICT', message: 'Another Output operation is already active.', detail: result.operation, retryable: true, correlation_id: null });
      return res.status(result.reused ? 200 : (result.operation.phase === 'SUCCEEDED' ? 200 : 202)).json(result.operation);
    } catch (error) {
      return res.status(422).json({ code: 'V3_OUTPUT_OPERATION_INVALID', message: error.message, detail: null, retryable: false, correlation_id: null });
    }
  });
}


router.get('/rooms/:roomId/run-plans', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  res.json({ room_id: workspaceV3.roomId(stream.id), run_plans: runPlanService.listPlansByStream(stream.id) });
});
router.post('/rooms/:roomId/run-plans', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  try { return res.status(201).json({ run_plan: runPlanService.createPlan({ ...req.body, stream_id: stream.id }) }); }
  catch (error) { return res.status(422).json({ code: 'V3_RUN_PLAN_INVALID', message: error.message, detail: null, retryable: false, correlation_id: null }); }
});
router.put('/rooms/:roomId/run-plans/:planId', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  try {
    const existing = runPlanService.getPlan(req.params.planId);
    if (!existing || Number(existing.stream_id) !== Number(stream.id)) return res.status(404).json({ code: 'V3_RUN_PLAN_NOT_FOUND', message: 'Run Plan not found in this Room.', detail: req.params.planId, retryable: false, correlation_id: null });
    return res.json({ run_plan: runPlanService.updatePlan(existing.id, req.body || {}) });
  } catch (error) { return res.status(422).json({ code: 'V3_RUN_PLAN_INVALID', message: error.message, detail: null, retryable: false, correlation_id: null }); }
});
router.get('/rooms/:roomId/sessions', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  res.json({ room_id: workspaceV3.roomId(stream.id), sessions: sessionService.listSessionsByStream(stream.id) });
});
router.post('/rooms/:roomId/sessions', (req, res) => {
  const stream = requireRoomStream(req, res); if (!stream) return;
  try { return res.status(201).json({ session: sessionService.createSession({ ...req.body, stream_id: stream.id, created_by: req.user?.username || req.user?.sub || null }) }); }
  catch (error) { return res.status(409).json({ code: 'V3_SESSION_CREATE_CONFLICT', message: error.message, detail: null, retryable: false, correlation_id: null }); }
});
router.get('/sessions/:sessionId', (req, res) => {
  const session = sessionService.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ code: 'V3_SESSION_NOT_FOUND', message: 'Session not found.', detail: req.params.sessionId, retryable: false, correlation_id: null });
  res.json({ session });
});
router.post('/sessions/:sessionId/preflight', async (req, res) => {
  try {
    const result = await preflightService.evaluateSession(req.params.sessionId, { mark_ready: req.body?.mark_ready === true });
    return res.status(result.status === 'BLOCKED' ? 409 : 200).json(result);
  } catch (error) {
    const missing = String(error.message).includes('not found');
    return res.status(missing ? 404 : 500).json({ code: missing ? 'V3_SESSION_NOT_FOUND' : 'V3_PREFLIGHT_FAILED', message: error.message, detail: null, retryable: !missing, correlation_id: null });
  }
});

router.get('/capabilities', async (req, res) => {
  try {
    let workspace = null;
    if (req.query?.room_id) {
      workspace = await workspaceV3.getWorkspace(req.query.room_id);
      if (!workspace) return res.status(404).json({ code: 'V3_ROOM_NOT_FOUND', message: 'Room not found', detail: req.query.room_id, retryable: false, correlation_id: null });
    }
    res.json({ contract_version: workspaceV3.CONTRACT_VERSION, capabilities: capabilityService.getCapabilities(workspace) });
  } catch (error) {
    internalError(res, error, 'V3_CAPABILITY_READ_FAILED');
  }
});

router.post('/output/validate', async (req, res) => {
  try {
    let workspace = null;
    if (req.body?.room_id) {
      workspace = await workspaceV3.getWorkspace(req.body.room_id);
      if (!workspace) return res.status(404).json({ code: 'V3_ROOM_NOT_FOUND', message: 'Room not found', detail: req.body.room_id, retryable: false, correlation_id: null });
    }
    const result = capabilityService.validateOutput(req.body || {}, workspace);
    return res.status(result.valid ? 200 : 422).json(result);
  } catch (error) {
    internalError(res, error, 'V3_CAPABILITY_VALIDATE_FAILED');
  }
});

router.get('/operations/:operationId', (req, res) => {
  try {
    const raw = String(req.params.operationId || '').replace(/^operation:/, '');
    const legacy = legacyOperationService.getOperation(raw);
    if (legacy?.type === legacyOperationService.PULL_SWITCH_TYPE) return res.json(workspaceV3.projectOperation(legacy));
    let operation = operationCore.getOperation(req.params.operationId);
    if (!operation) return res.status(404).json({ code: 'V3_OPERATION_NOT_FOUND', message: 'Operation not found', detail: req.params.operationId, retryable: false, correlation_id: null });
    if (operation.subject_type === 'forward_task') operation = outputService.reconcilePushOperation(operation);
    if (operation.subject_type === 'record_task') operation = outputService.reconcileRecordOperation(operation);
    return res.json(operation);
  } catch (error) {
    internalError(res, error, 'V3_OPERATION_READ_FAILED');
  }
});

router.get('/rooms', async (req, res) => {
  try {
    res.json({ contract_version: workspaceV3.CONTRACT_VERSION, rooms: await workspaceV3.listRooms() });
  } catch (error) {
    internalError(res, error, 'V3_ROOMS_READ_FAILED');
  }
});

router.get('/rooms/:roomId/workspace', async (req, res) => {
  try {
    const workspace = await workspaceV3.getWorkspace(req.params.roomId);
    if (!workspace) {
      return res.status(404).json({
        code: 'V3_ROOM_NOT_FOUND',
        message: 'Room not found',
        detail: req.params.roomId,
        retryable: false,
        correlation_id: null
      });
    }
    res.json(workspace);
  } catch (error) {
    internalError(res, error, 'V3_WORKSPACE_READ_FAILED');
  }
});

module.exports = router;
