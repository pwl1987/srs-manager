import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { statusColor } from '../lib/utils';
import { Satellite, Plus, Edit, Trash2, Play, Pause, Ban, RefreshCw, Copy, X } from 'lucide-react';

export default function CdnChannels() {
  const [channels, setChannels] = useState([]);
  const [streams, setStreams] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ channel_name: '', stream_id: '', region: '' });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    loadChannels();
    api.get('/streams').then(setStreams).catch(console.error);
  }, []);

  async function loadChannels() {
    try {
      setChannels(await api.get('/cdn/channels'));
    } catch (err) {
      console.error(err);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ channel_name: '', stream_id: streams[0]?.id || '', region: '' });
    setShowModal(true);
  }

  function openEdit(channel) {
    setEditing(channel);
    setForm({ channel_name: channel.channel_name, stream_id: channel.stream_id, region: channel.region });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/cdn/channels/${editing.id}`, form);
      } else {
        await api.post('/cdn/channels', form);
      }
      setShowModal(false);
      loadChannels();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除此频道？')) return;
    try {
      await api.delete(`/cdn/channels/${id}`);
      loadChannels();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleBatchState(ids, state) {
    try {
      await api.get(`/cdn/channels/batch-state`, { params: { ids: ids.join(','), state } });
      loadChannels();
    } catch (err) {
      alert(err.message);
    }
  }

  function copyUrl(url, label) {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const selectedIds = [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">CDN 频道</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
          <Plus size={16} /> 新建频道
        </button>
      </div>

      <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-3">频道名称</th>
              <th className="text-left px-4 py-3">关联流</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">区域</th>
              <th className="text-left px-4 py-3">拉流地址 (HLS)</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {channels.map(c => {
              const stream = streams.find(s => s.id === c.stream_id);
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{c.channel_name}</td>
                  <td className="px-4 py-3">{stream?.name || '-'}</td>
                  <td className={`px-4 py-3 ${statusColor(c.status)}`}>{c.status}</td>
                  <td className="px-4 py-3">{c.region || '-'}</td>
                  <td className="px-4 py-3">
                    {c.pull_url_hls && (
                      <button onClick={() => copyUrl(c.pull_url_hls, `pull-${c.id}`)} className="flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs">
                        <Copy size={12} /> {copied === `pull-${c.id}` ? '已复制' : '复制'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {c.status === 'active' ? (
                        <button onClick={() => handleBatchState([c.id], 'stop')} className="p-1.5 rounded hover:bg-yellow-900/30 text-[var(--muted-foreground)] hover:text-yellow-400" title="停止">
                          <Pause size={14} />
                        </button>
                      ) : (
                        <button onClick={() => handleBatchState([c.id], 'start')} className="p-1.5 rounded hover:bg-green-900/30 text-[var(--muted-foreground)] hover:text-green-400" title="启动">
                          <Play size={14} />
                        </button>
                      )}
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        <Edit size={14} />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {channels.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-[var(--muted-foreground)]">暂无 CDN 频道</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-96 border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editing ? '编辑频道' : '新建频道'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1">频道名称</label>
                <input
                  type="text"
                  value={form.channel_name}
                  onChange={e => setForm({ ...form, channel_name: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">关联流</label>
                <select
                  value={form.stream_id}
                  onChange={e => setForm({ ...form, stream_id: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                >
                  <option value="">选择流...</option>
                  {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">区域</label>
                <input
                  type="text"
                  value={form.region}
                  onChange={e => setForm({ ...form, region: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                  placeholder="如：华东"
                />
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
    </div>
  );
}
