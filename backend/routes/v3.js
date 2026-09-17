const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const workspaceV3 = require('../services/v3-workspace-service');

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
