// Shared V3 output payload builder (PHASE-09): the workspace BuilderDrawer and
// the create-room wizard must construct identical payloads so scene defaults,
// protection and storage semantics cannot drift between the two surfaces.
export function buildOutputPayload({
  builderMode = 'scene',
  sceneId,
  scene,
  mode,
  transport,
  protection = 'none',
  processing = 'PASSTHROUGH',
  templateId = '',
  name,
  targetUrl = '',
  recordFormat = 'mp4',
  recordSubdir = '',
  segmentSeconds = '6'
} = {}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    const error = new Error('OUTPUT_NAME_REQUIRED');
    error.code = 'OUTPUT_NAME_REQUIRED';
    throw error;
  }
  const effectiveMode = builderMode === 'scene' ? (scene?.mode || mode) : mode;
  const sceneTag = builderMode === 'scene' ? sceneId : 'PROFESSIONAL';
  const processingPayload = processing === 'RENDITION'
    ? { mode: 'RENDITION', template_id: Number(templateId) }
    : { mode: 'PASSTHROUGH' };

  if (effectiveMode === 'PUSH') {
    const trimmedTarget = String(targetUrl || '').trim();
    if (!trimmedTarget) {
      const error = new Error('PUSH_TARGET_REQUIRED');
      error.code = 'PUSH_TARGET_REQUIRED';
      throw error;
    }
    return {
      mode: 'PUSH',
      name: trimmedName,
      scene: sceneTag,
      transport,
      protection,
      processing: processingPayload,
      destination: { kind: 'CUSTOM', label: trimmedName, target_url: trimmedTarget }
    };
  }

  if (effectiveMode === 'RECORD') {
    const payload = {
      mode: 'RECORD',
      name: trimmedName,
      scene: sceneTag,
      format: recordFormat,
      protection: 'storage-policy',
      processing: processingPayload,
      storage: {
        subdir: String(recordSubdir || '').trim(),
        filename_prefix: trimmedName,
        segment_seconds: Number(segmentSeconds || 6)
      }
    };
    if (recordFormat === 'audio') payload.audio_format = 'aac';
    return payload;
  }

  return {
    mode: 'SERVE',
    name: trimmedName,
    scene: sceneTag,
    transports: builderMode === 'scene' ? scene?.transports : [transport],
    consumer: { label: trimmedName },
    ...(builderMode === 'pro' ? { endpoint_protections: { [transport]: protection } } : {})
  };
}

// Shared submit path for output drafts (BuilderDrawer and future callers):
// builds the payload, POSTs it and reports the frozen outcomes.
export async function submitOutputDraft({ apiClient, roomId, fields, notify, t = (key, opts) => key }) {
  try {
    const payload = buildOutputPayload(fields);
    await apiClient.post(`/v3/rooms/${roomId}/outputs`, payload);
    notify.success(t('streams:outputRack.saved'));
    return true;
  } catch (error) {
    if (error.code === 'PUSH_TARGET_REQUIRED') notify.error(t('streams:outputRack.pushTargetRequired'));
    else notify.error(error.message || t('streams:outputRack.createFailed'));
    return false;
  }
}
