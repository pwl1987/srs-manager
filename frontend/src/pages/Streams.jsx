import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes, formatTime, statusColor } from '../lib/utils';
import { Radio, Plus, Edit, Trash2, Copy, X } from 'lucide-react';

export default function Streams() {
  const [streams, setStreams] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', protocol: 'rtmp' });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    loadStreams();
  }, []);

  async function loadStreams() {
    try {
      setStreams(await api.get('/streams'));
    } catch (err) {
      console.error(err);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', protocol: 'rtmp' });
    setShowModal(true);
  }

  function openEdit(stream) {
    setEditing(stream);
    setForm({ name: stream.name, protocol: stream.protocol });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/streams/${editing.id}`, form);
      } else {
        await api.post('/streams', form);
      }
      setShowModal(false);
      loadStreams();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除此流？')) return;
    try {
      await api.delete(`/streams/${id}`);
      loadStreams();
    } catch (err) {
      alert(err.message);
    }
  }

  function copyUrl(url, label) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">流管理</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
          <Plus size={16} /> 新建流
        </button>
      </div>

      <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">协议</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">观众</th>
              <th className="text-right px-4 py-3">码率</th>
              <th className="text-left px-4 py-3">推流地址</th>
              <th className="text-left px-4 py-3">拉流地址 (HLS)</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {streams.map(s => (
              <tr key={s.id} className="border-t">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">{s.protocol}</td>
                <td className={`px-4 py-3 ${statusColor(s.status)}`}>{s.status}</td>
                <td className="px-4 py-3 text-right">{s.viewers || 0}</td>
                <td className="px-4 py-3 text-right">{s.bitrate ? `${(s.bitrate / 1000).toFixed(1)} kbps` : '-'}</td>
                <td className="px-4 py-3">
                  {s.push_url && (
                    <button onClick={() => copyUrl(s.push_url, 'push')} className="flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs">
                      <Copy size={12} /> {copied === 'push' ? '已复制' : '复制'}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">
                  {s.pull_url_hls && (
                    <button onClick={() => copyUrl(s.pull_url_hls, 'pull')} className="flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs">
                      <Copy size={12} /> {copied === 'pull' ? '已复制' : '复制'}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                      <Edit size={14} />
                    </button>
                    <button onClick={() => handleDelete(s.id)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {streams.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-[var(--muted-foreground)]">暂无流，推流后会自动出现</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-96 border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editing ? '编辑流' : '新建流'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1">流名称</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">协议</label>
                <select
                  value={form.protocol}
                  onChange={e => setForm({ ...form, protocol: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                >
                  <option value="rtmp">RTMP</option>
                  <option value="rtsp">RTSP</option>
                  <option value="hls">HLS</option>
                </select>
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
