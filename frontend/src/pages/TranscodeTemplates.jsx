import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Film, Plus, Edit, Trash2, Code, X } from 'lucide-react';

export default function TranscodeTemplates() {
  const [templates, setTemplates] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showConfig, setShowConfig] = useState(null);
  const [form, setForm] = useState({
    name: '', vcodec: 'h264', acodec: 'aac',
    video_config: { width: 1280, height: 720, fps: 30, bitrate: 2000 },
    audio_config: { bitrate: 128 },
    output_format: 'rtmp', enabled: 1
  });
  const [error, setError] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try { setTemplates(await api.get('/transcode-templates')); } catch (err) { console.error(err); }
  }

  function openCreate() {
    setEditing(null);
    setForm({
      name: '', vcodec: 'h264', acodec: 'aac',
      video_config: { width: 1280, height: 720, fps: 30, bitrate: 2000 },
      audio_config: { bitrate: 128 },
      output_format: 'rtmp', enabled: 1
    });
    setShowModal(true);
  }

  function openEdit(template) {
    setEditing(template);
    setForm({
      name: template.name, vcodec: template.vcodec, acodec: template.acodec,
      video_config: JSON.parse(template.video_config || '{}'),
      audio_config: JSON.parse(template.audio_config || '{}'),
      output_format: template.output_format, enabled: template.enabled
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const data = {
        ...form,
        video_config: JSON.stringify(form.video_config),
        audio_config: JSON.stringify(form.audio_config)
      };
      if (editing) {
        await api.put(`/transcode-templates/${editing.id}`, data);
      } else {
        await api.post('/transcode-templates', data);
      }
      setShowModal(false);
      loadTemplates();
    } catch (err) { setError(err.message); }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除此模板？')) return;
    try { await api.delete(`/transcode-templates/${id}`); loadTemplates(); } catch (err) { alert(err.message); }
  }

  async function showSrsConfig(id) {
    try {
      const data = await api.get(`/transcode-templates/${id}/srs-config`);
      setShowConfig(data.config);
    } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">转码模板</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
          <Plus size={16} /> 新建模板
        </button>
      </div>

      <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">视频编码</th>
              <th className="text-left px-4 py-3">音频编码</th>
              <th className="text-left px-4 py-3">视频参数</th>
              <th className="text-left px-4 py-3">音频参数</th>
              <th className="text-left px-4 py-3">输出格式</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {templates.map(t => (
              <tr key={t.id} className="border-t">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3">{t.vcodec}</td>
                <td className="px-4 py-3">{t.acodec}</td>
                <td className="px-4 py-3 text-xs">
                  {t.video_config ? Object.entries(JSON.parse(t.video_config)).map(([k, v]) => `${k}=${v}`).join(' ') : '-'}
                </td>
                <td className="px-4 py-3 text-xs">
                  {t.audio_config ? Object.entries(JSON.parse(t.audio_config)).map(([k, v]) => `${k}=${v}`).join(' ') : '-'}
                </td>
                <td className="px-4 py-3">{t.output_format}</td>
                <td className={`px-4 py-3 ${t.enabled ? 'text-green-400' : 'text-gray-500'}`}>{t.enabled ? '启用' : '禁用'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => showSrsConfig(t.id)} className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title="SRS 配置">
                      <Code size={14} />
                    </button>
                    <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><Edit size={14} /></button>
                    <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {templates.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-[var(--muted-foreground)]">暂无转码模板</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-[520px] border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editing ? '编辑模板' : '新建模板'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1">名称</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" required />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm mb-1">视频编码</label>
                  <select value={form.vcodec} onChange={e => setForm({ ...form, vcodec: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="h264">H.264</option>
                    <option value="h265">H.265</option>
                    <option value="vp9">VP9</option>
                    <option value="none">无 (纯音频)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">音频编码</label>
                  <select value={form.acodec} onChange={e => setForm({ ...form, acodec: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="aac">AAC</option>
                    <option value="mp3">MP3</option>
                    <option value="opus">Opus</option>
                    <option value="none">无 (纯视频)</option>
                  </select>
                </div>
              </div>
              {form.vcodec !== 'none' && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="block text-sm mb-1">宽度</label>
                    <input type="number" value={form.video_config.width || ''}
                      onChange={e => setForm({ ...form, video_config: { ...form.video_config, width: parseInt(e.target.value) } })}
                      className="w-full px-2 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">高度</label>
                    <input type="number" value={form.video_config.height || ''}
                      onChange={e => setForm({ ...form, video_config: { ...form.video_config, height: parseInt(e.target.value) } })}
                      className="w-full px-2 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">FPS</label>
                    <input type="number" value={form.video_config.fps || ''}
                      onChange={e => setForm({ ...form, video_config: { ...form.video_config, fps: parseInt(e.target.value) } })}
                      className="w-full px-2 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">码率 (kbps)</label>
                    <input type="number" value={form.video_config.bitrate || ''}
                      onChange={e => setForm({ ...form, video_config: { ...form.video_config, bitrate: parseInt(e.target.value) } })}
                      className="w-full px-2 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                  </div>
                </div>
              )}
              {form.acodec !== 'none' && (
                <div className="mb-4">
                  <label className="block text-sm mb-1">音频码率 (kbps)</label>
                  <input type="number" value={form.audio_config.bitrate || ''}
                    onChange={e => setForm({ ...form, audio_config: { ...form.audio_config, bitrate: parseInt(e.target.value) } })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm mb-1">输出格式</label>
                  <select value={form.output_format} onChange={e => setForm({ ...form, output_format: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="rtmp">RTMP</option>
                    <option value="hls">HLS</option>
                    <option value="mp4">MP4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">启用</label>
                  <select value={form.enabled} onChange={e => setForm({ ...form, enabled: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="1">启用</option>
                    <option value="0">禁用</option>
                  </select>
                </div>
              </div>
              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
              <div className="flex gap-3">
                <button type="submit" className="flex-1 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
                  {editing ? '保存' : '创建'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2 rounded bg-[var(--secondary)] text-sm hover:bg-[var(--muted)]">
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-[500px] border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">SRS 转码配置</h3>
              <button onClick={() => setShowConfig(null)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <pre className="bg-[var(--muted)] rounded p-4 text-xs text-[var(--foreground)] overflow-x-auto">{showConfig}</pre>
            <p className="text-xs text-[var(--muted-foreground)] mt-3">将此配置片段添加到 SRS 的 nginx 配置中，然后重新加载 SRS。</p>
          </div>
        </div>
      )}
    </div>
  );
}
