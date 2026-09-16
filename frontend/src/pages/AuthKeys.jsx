import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTime } from '../lib/utils';
import { Key, Plus, Edit, Trash2, RefreshCw, Copy, Eye, EyeOff, X } from 'lucide-react';

export default function AuthKeys() {
  const [keys, setKeys] = useState([]);
  const [streams, setStreams] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ type: 'push', stream_id: '', description: '', expires_at: '', auto_rotate_days: 30 });
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    loadKeys();
    api.get('/streams').then(setStreams).catch(console.error);
  }, []);

  async function loadKeys() {
    try {
      setKeys(await api.get('/keys'));
    } catch (err) {
      console.error(err);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ type: 'push', stream_id: streams[0]?.id || '', description: '', expires_at: '', auto_rotate_days: 30 });
    setShowModal(true);
  }

  function openEdit(key) {
    setEditing(key);
    setForm({
      type: key.type,
      stream_id: key.stream_id,
      description: key.description || '',
      expires_at: key.expires_at || '',
      auto_rotate_days: key.auto_rotate_days || 30
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/keys/${editing.id}`, form);
      } else {
        await api.post('/keys', form);
      }
      setShowModal(false);
      loadKeys();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除此密钥？')) return;
    try {
      await api.delete(`/keys/${id}`);
      loadKeys();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRotate(id) {
    try {
      await api.post(`/keys/${id}/rotate`);
      loadKeys();
    } catch (err) {
      alert(err.message);
    }
  }

  function toggleReveal(id) {
    setRevealed(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function copyKey(key, id) {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">鉴权密钥</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
          <Plus size={16} /> 新建密钥
        </button>
      </div>

      <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-3">类型</th>
              <th className="text-left px-4 py-3">关联流</th>
              <th className="text-left px-4 py-3">密钥</th>
              <th className="text-left px-4 py-3">描述</th>
              <th className="text-left px-4 py-3">过期时间</th>
              <th className="text-left px-4 py-3">自动轮换</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => {
              const stream = streams.find(s => s.id === k.stream_id);
              return (
                <tr key={k.id} className="border-t">
                  <td className="px-4 py-3">{k.type === 'push' ? '推流' : '拉流'}</td>
                  <td className="px-4 py-3">{stream?.name || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span>{revealed[k.id] ? k.key : k.key}</span>
                      <button onClick={() => toggleReveal(k.id)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        {revealed[k.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button onClick={() => copyKey(k.key, k.id)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        <Copy size={12} />
                      </button>
                      {copied === k.id && <span className="text-green-400 text-xs">已复制</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">{k.description || '-'}</td>
                  <td className="px-4 py-3">{k.expires_at ? formatTime(k.expires_at) : '永不过期'}</td>
                  <td className="px-4 py-3">{k.auto_rotate_days ? `${k.auto_rotate_days} 天` : '关闭'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => handleRotate(k.id)} className="p-1.5 rounded hover:bg-blue-900/30 text-[var(--muted-foreground)] hover:text-blue-400" title="轮换">
                        <RefreshCw size={14} />
                      </button>
                      <button onClick={() => openEdit(k)} className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        <Edit size={14} />
                      </button>
                      <button onClick={() => handleDelete(k.id)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-[var(--muted-foreground)]">暂无鉴权密钥</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-96 border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editing ? '编辑密钥' : '新建密钥'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1">类型</label>
                <select
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                >
                  <option value="push">推流密钥</option>
                  <option value="pull">拉流密钥</option>
                </select>
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
                <label className="block text-sm mb-1">描述</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                  placeholder="如：XX公司推流"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">过期时间</label>
                <input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={e => setForm({ ...form, expires_at: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">自动轮换（天）</label>
                <input
                  type="number"
                  min="0"
                  value={form.auto_rotate_days}
                  onChange={e => setForm({ ...form, auto_rotate_days: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
                  placeholder="0 表示关闭"
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
