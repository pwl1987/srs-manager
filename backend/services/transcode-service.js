const db = require('../database');

function listTemplates() {
  return db.prepare('SELECT * FROM transcode_templates ORDER BY created_at DESC').all();
}

function getTemplate(id) {
  return db.prepare('SELECT * FROM transcode_templates WHERE id = ?').get(id) || null;
}

function createTemplate({ name, vcodec, acodec, video_config, audio_config, output_format, enabled }) {
  if (!name || !vcodec || !acodec) throw new Error('Name, video codec, and audio codec are required');
  db.prepare(`
    INSERT INTO transcode_templates (name, vcodec, acodec, video_config, audio_config, output_format, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, vcodec, acodec, video_config, audio_config, output_format || 'rtmp', enabled !== undefined ? enabled : 1);
  return db.prepare('SELECT * FROM transcode_templates WHERE name = ?').get(name);
}

function updateTemplate(id, updates) {
  const template = db.prepare('SELECT * FROM transcode_templates WHERE id = ?').get(id);
  if (!template) return null;
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE transcode_templates SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);
  return db.prepare('SELECT * FROM transcode_templates WHERE id = ?').get(id);
}

function deleteTemplate(id) {
  const template = db.prepare('SELECT * FROM transcode_templates WHERE id = ?').get(id);
  if (!template) return null;
  db.prepare('DELETE FROM transcode_templates WHERE id = ?').run(id);
  return { name: template.name };
}

function generateSrsConfig(template) {
  let config = `transcoder {\n`;
  config += `    vcodec ${template.vcodec};\n`;
  config += `    acodec ${template.acodec};\n`;
  if (template.video_config) {
    for (const [key, value] of Object.entries(template.video_config)) {
      config += `    ${key} ${value};\n`;
    }
  }
  if (template.audio_config) {
    for (const [key, value] of Object.entries(template.audio_config)) {
      config += `    ${key} ${value};\n`;
    }
  }
  config += `    output_format ${template.output_format || 'rtmp'};\n`;
  config += `}\n`;
  return config;
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, generateSrsConfig };
