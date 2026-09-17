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
    const operation = operationCore.getOperation(req.params.operationId);
    if (!operation) return res.status(404).json({ code: 'V3_OPERATION_NOT_FOUND', message: 'Operation not found', detail: req.params.operationId, retryable: false, correlation_id: null });
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
