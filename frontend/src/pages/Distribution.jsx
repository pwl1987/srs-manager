import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTime, statusColor } from '../lib/utils';
import { FileText, Plus, Edit, Trash2, Clock, Ban, History, X } from 'lucide-react';

export default function Distribution() {
  const [requests, setRequests] = useState([]);
  const [streams, setStreams] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    stream_id: '', applicant: '', region: '', purpose: '',
    pull_url: '', expires_at: '', notes: ''
  });
  const [error, setError] = useState('');
  const [logsRequest, setLogsRequest] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadRequests();
    api.get('/streams').then(setStreams).catch(console.error);
  }, []);

  async function loadRequests() {
    try {
      setRequests(await api.get('/distribution'));
    } catch (err) {
      console.error(err);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({
      stream_id: streams[0]?.id || '', applicant: '', region: '', purpose: '',
      pull_url: '', expires_at: '', notes: ''
    });
    setShowModal(true);
  }

  function openEdit(req) {
    setEditing(req);
    setForm({
      stream_id: req.stream_id, applicant: req.applicant, region: req.region || '',
      purpose: req.purpose || '', pull_url: req.pull_url || '',
      expires_at: req.expires_at || '', notes: req.notes || ''
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/distribution/${editing.id}`, form);
      } else {
        await api.post('/distribution', form);
      }
      setShowModal(false);
      loadRequests();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除此申请？')) return;
    try {
      await api.delete(`/distribution/${id}`);
      loadRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleExtend(id) {
    const newExpiry = prompt('输入新的过期时间 (ISO 格式，如 2026-10-01T00:00:00Z):');
    if (!newExpiry) return;
    try {
      await api.put(`/distribution/${id}/extend`, { new_expiry: newExpiry });
      loadRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRevoke(id) {
    if (!confirm('确定撤销此申请？')) return;
    try {
      await api.put(`/distribution/${id}/revoke`);
      loadRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function showLogs(id) {
    try {
      setLogsRequest(id);
      setLogs(await api.get(`/distribution/${id}/logs`));
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">分发申请</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
          <Plus size={16} /> 新建申请
        </button>
      </div>

      <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-3">流</th>
              <th className="text-left px-4 py-3">申请方</th>
              <th className="text-left px-4 py-3">区域</th>
              <th className="text-left px-4 py-3">用途</th>
              <th className="text-left px-4 py-3">拉流地址</th>
              <th className="text-left px-4 py-3">过期时间</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => {
              const stream = streams.find(s => s.id === r.stream_id);
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3">{stream?.name || '-'}</td>
                  <td className="px-4 py-3">{r.applicant}</td>
                  <td className="px-4 py-3">{r.region || '-'}</td>
                  <td className="px-4 py-3">{r.purpose || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.pull_url || '-'}</td>
                  <td className="px-4 py-3">{r.expires_at ? formatTime(r.expires_at) : '-'}</td>
                  <td className={`px-4 py-3 ${statusColor(r.status)}`}>{r.status}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {r.status === 'active' && (
                        <>
                          <button onClick={() => handleExtend(r.id)} className="p-1.5 rounded hover:bg-blue-900/30 text-[var(--muted-foreground)] hover:text-blue-400" title="延长">
                            <Clock size={14} />
                          </button>
                          <button onClick={() => handleRevoke(r.id)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400" title="撤销">
                            <Ban size={14} />
                          </button>
                        </>
                      )}
                      <button onClick={() => showLogs(r.id)} className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title="日志">
                        <History size={14} />
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {requests.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-[var(--muted-foreground)]">暂无分发申请</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-[500px] border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editing ? '编辑申请' : '新建申请'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm mb-1">流</label>
                  <select value={form.stream_id} onChange={e => setForm({ ...form, stream_id: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="">选择流...</option>
                    {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">申请方</label>
                  <input type="text" value={form.applicant} onChange={e => setForm({ ...form, applicant: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" required />
                </div>
                <div>
                  <label className="block text-sm mb-1">区域</label>
                  <input type="text" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="block text-sm mb-1">用途</label>
                  <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">拉流地址</label>
                <input type="text" value={form.pull_url} onChange={e => setForm({ ...form, pull_url: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)] font-mono" required />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">过期时间</label>
                <input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" required />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">备注</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" rows={2} />
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

      {logsRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-[400px] border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">操作日志</h3>
              <button onClick={() => setLogsRequest(null)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {logs.map(log => (
                <div key={log.id} className="text-sm">
                  <span className="text-[var(--muted-foreground)]">{formatTime(log.created_at)}</span>
                  <span className="ml-2 font-medium">{log.action}</span>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{log.detail}</p>
                </div>
              ))}
              {logs.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">暂无日志</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
