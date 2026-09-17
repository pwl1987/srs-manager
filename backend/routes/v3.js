const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const workspaceV3 = require('../services/v3-workspace-service');
const capabilityService = require('../services/v3-capability-service');
const operationCore = require('../services/v3-operation-core');
const legacyOperationService = require('../services/operation-service');

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
