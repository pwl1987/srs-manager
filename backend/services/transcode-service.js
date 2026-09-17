const db = require('../database');

const ALLOWED_FIELDS = new Set(['name', 'vcodec', 'acodec', 'video_config', 'audio_config', 'output_format', 'enabled']);

function listTemplates() {
  return db.prepare('SELECT * FROM transcode_templates ORDER BY created_at DESC').all();
}

function getTemplate(id) {
  return db.prepare('SELECT * FROM transcode_templates WHERE id = ?').get(id) || null;
}

function validateBase({ name, vcodec, acodec }) {
  if (!String(name || '').trim() || !String(vcodec || '').trim() || !String(acodec || '').trim()) {
    throw new Error('Name, video codec, and audio codec are required');
  }
}

function createTemplate({ name, vcodec, acodec, video_config, audio_config, output_format, enabled }) {
  validateBase({ name, vcodec, acodec });
  const result = db.prepare(`
    INSERT INTO transcode_templates (name, vcodec, acodec, video_config, audio_config, output_format, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(String(name).trim(), vcodec, acodec, video_config || '{}', audio_config || '{}', output_format || 'rtmp', enabled !== undefined ? enabled : 1);
  return getTemplate(Number(result.lastInsertRowid));
}

function updateTemplate(id, updates = {}) {
  const template = getTemplate(id);
  if (!template) return null;
  const fields = {};
  for (const [key, value] of Object.entries(updates)) {
    if (ALLOWED_FIELDS.has(key) && value !== undefined) fields[key] = value;
  }
  if (fields.name !== undefined) fields.name = String(fields.name || '').trim();
  validateBase({
    name: fields.name !== undefined ? fields.name : template.name,
    vcodec: fields.vcodec !== undefined ? fields.vcodec : template.vcodec,
    acodec: fields.acodec !== undefined ? fields.acodec : template.acodec
  });
  if (!Object.keys(fields).length) return template;
  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE transcode_templates SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(fields), Number(id));
  return getTemplate(id);
}

function deleteTemplate(id) {
  const template = getTemplate(id);
  if (!template) return null;
  const binding = db.prepare('SELECT id FROM stream_transcode_bindings WHERE template_id = ? LIMIT 1').get(Number(id));
  if (binding) throw new Error('Transcode template is still mounted by a stream');
  db.prepare('DELETE FROM transcode_templates WHERE id = ?').run(Number(id));
  return { name: template.name };
}

function generateSrsConfig(template) {
  const parse = value => { try { return JSON.parse(value || '{}') || {}; } catch { return {}; } };
  let config = `transcoder {\n`;
  config += `    vcodec ${template.vcodec};\n`;
  config += `    acodec ${template.acodec};\n`;
  for (const [key, value] of Object.entries(parse(template.video_config))) config += `    ${key} ${value};\n`;
  for (const [key, value] of Object.entries(parse(template.audio_config))) config += `    ${key} ${value};\n`;
  config += `    output_format ${template.output_format || 'rtmp'};\n`;
  config += `}\n`;
  return config;
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, generateSrsConfig };
