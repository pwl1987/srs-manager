import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTime, statusColor } from '../lib/utils';
import { ArrowLeftRight, Plus, Edit, Trash2, Power, X, Download, Upload } from 'lucide-react';

export default function Forwarding() {
  const [sources, setSources] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [streams, setStreams] = useState([]);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [sourceForm, setSourceForm] = useState({ name: '', source_url: '', protocol: 'rtmp', pull_mode: 'pull' });
  const [taskForm, setTaskForm] = useState({ stream_id: '', external_source_id: '', target_type: 'cdn_channel', target_url: '', enabled: 1 });
  const [error, setError] = useState('');

  useEffect(() => {
    loadSources();
    loadTasks();
    api.get('/streams').then(setStreams).catch(console.error);
  }, []);

  async function loadSources() {
    try { setSources(await api.get('/external-sources')); } catch (err) { console.error(err); }
  }

  async function loadTasks() {
    try { setTasks(await api.get('/forward-tasks')); } catch (err) { console.error(err); }
  }

  function openCreateSource() {
    setEditingSource(null);
    setSourceForm({ name: '', source_url: '', protocol: 'rtmp', pull_mode: 'pull' });
    setShowSourceModal(true);
  }

  function openEditSource(source) {
    setEditingSource(source);
    setSourceForm({ name: source.name, source_url: source.source_url, protocol: source.protocol, pull_mode: source.pull_mode });
    setShowSourceModal(true);
  }

  async function handleSourceSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingSource) {
        await api.put(`/external-sources/${editingSource.id}`, sourceForm);
      } else {
        await api.post('/external-sources', sourceForm);
      }
      setShowSourceModal(false);
      loadSources();
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteSource(id) {
    if (!confirm('确定删除此拉流源？')) return;
    try { await api.delete(`/external-sources/${id}`); loadSources(); } catch (err) { alert(err.message); }
  }

  function openCreateTask() {
    setEditingTask(null);
    setTaskForm({ stream_id: streams[0]?.id || '', external_source_id: sources[0]?.id || '', target_type: 'cdn_channel', target_url: '', enabled: 1 });
    setShowTaskModal(true);
  }

  function openEditTask(task) {
    setEditingTask(task);
    setTaskForm({
      stream_id: task.stream_id, external_source_id: task.external_source_id,
      target_type: task.target_type, target_url: task.target_url, enabled: task.enabled
    });
    setShowTaskModal(true);
  }

  async function handleTaskSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingTask) {
        await api.put(`/forward-tasks/${editingTask.id}`, taskForm);
      } else {
        await api.post('/forward-tasks', taskForm);
      }
      setShowTaskModal(false);
      loadTasks();
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteTask(id) {
    if (!confirm('确定删除此转发任务？')) return;
    try { await api.delete(`/forward-tasks/${id}`); loadTasks(); } catch (err) { alert(err.message); }
  }

  async function handleToggleTask(id, enabled) {
    try {
      await api.put(`/forward-tasks/${id}`, { enabled });
      loadTasks();
    } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">拉流转发</h2>

      {/* External Sources */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-[var(--muted-foreground)]">外部拉流源</h3>
          <button onClick={openCreateSource} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--secondary)] text-xs hover:bg-[var(--muted)]">
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)]">
              <tr>
                <th className="text-left px-4 py-2">名称</th>
                <th className="text-left px-4 py-2">地址</th>
                <th className="text-left px-4 py-2">协议</th>
                <th className="text-left px-4 py-2">模式</th>
                <th className="text-right px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.source_url}</td>
                  <td className="px-4 py-2">{s.protocol}</td>
                  <td className="px-4 py-2">{s.pull_mode === 'pull' ? <Download size={14} className="inline" /> : <Upload size={14} className="inline" />}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openEditSource(s)} className="p-1 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><Edit size={12} /></button>
                      <button onClick={() => handleDeleteSource(s.id)} className="p-1 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400"><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {sources.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-[var(--muted-foreground)]">暂无拉流源</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Forward Tasks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-[var(--muted-foreground)]">转发任务</h3>
          <button onClick={openCreateTask} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--secondary)] text-xs hover:bg-[var(--muted)]">
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="bg-[var(--card)] rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)]">
              <tr>
                <th className="text-left px-4 py-2">流</th>
                <th className="text-left px-4 py-2">拉流源</th>
                <th className="text-left px-4 py-2">目标类型</th>
                <th className="text-left px-4 py-2">目标地址</th>
                <th className="text-left px-4 py-2">状态</th>
                <th className="text-right px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const stream = streams.find(s => s.id === t.stream_id);
                const source = sources.find(s => s.id === t.external_source_id);
                return (
                  <tr key={t.id} className="border-t">
                    <td className="px-4 py-2">{stream?.name || '-'}</td>
                    <td className="px-4 py-2">{source?.name || '-'}</td>
                    <td className="px-4 py-2">{t.target_type}</td>
                    <td className="px-4 py-2 font-mono text-xs">{t.target_url}</td>
                    <td className={`px-4 py-2 ${statusColor(t.enabled ? 'active' : 'inactive')}`}>{t.enabled ? '启用' : '禁用'}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => handleToggleTask(t.id, t.enabled ? 0 : 1)} className="p-1 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                          <Power size={12} />
                        </button>
                        <button onClick={() => openEditTask(t)} className="p-1 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><Edit size={12} /></button>
                        <button onClick={() => handleDeleteTask(t.id)} className="p-1 rounded hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-[var(--muted-foreground)]">暂无转发任务</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Source Modal */}
      {showSourceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-96 border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editingSource ? '编辑拉流源' : '新建拉流源'}</h3>
              <button onClick={() => setShowSourceModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleSourceSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1">名称</label>
                <input type="text" value={sourceForm.name} onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]" required />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">地址</label>
                <input type="text" value={sourceForm.source_url} onChange={e => setSourceForm({ ...sourceForm, source_url: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)] font-mono" required />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm mb-1">协议</label>
                  <select value={sourceForm.protocol} onChange={e => setSourceForm({ ...sourceForm, protocol: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="rtmp">RTMP</option>
                    <option value="srt">SRT</option>
                    <option value="hls">HLS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">模式</label>
                  <select value={sourceForm.pull_mode} onChange={e => setSourceForm({ ...sourceForm, pull_mode: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="pull">拉流 (Pull)</option>
                    <option value="push">推流 (Push)</option>
                  </select>
                </div>
              </div>
              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
              <div className="flex gap-3">
                <button type="submit" className="flex-1 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
                  {editingSource ? '保存' : '创建'}
                </button>
                <button type="button" onClick={() => setShowSourceModal(false)} className="flex-1 py-2 rounded bg-[var(--secondary)] text-sm hover:bg-[var(--muted)]">
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--card)] rounded-xl p-6 w-[480px] border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editingTask ? '编辑转发任务' : '新建转发任务'}</h3>
              <button onClick={() => setShowTaskModal(false)} className="p-1 hover:bg-[var(--secondary)]"><X size={16} /></button>
            </div>
            <form onSubmit={handleTaskSubmit}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm mb-1">流</label>
                  <select value={taskForm.stream_id} onChange={e => setTaskForm({ ...taskForm, stream_id: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="">选择流...</option>
                    {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">拉流源</label>
                  <select value={taskForm.external_source_id} onChange={e => setTaskForm({ ...taskForm, external_source_id: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                    <option value="">选择拉流源...</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">目标类型</label>
                <select value={taskForm.target_type} onChange={e => setTaskForm({ ...taskForm, target_type: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                  <option value="cdn_channel">CDN 频道</option>
                  <option value="srs_edge">SRS 边缘节点</option>
                  <option value="custom_rtmp">自定义 RTMP</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">目标地址</label>
                <input type="text" value={taskForm.target_url} onChange={e => setTaskForm({ ...taskForm, target_url: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)] font-mono" required />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1">启用</label>
                <select value={taskForm.enabled} onChange={e => setTaskForm({ ...taskForm, enabled: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]">
                  <option value="1">启用</option>
                  <option value="0">禁用</option>
                </select>
              </div>
              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
              <div className="flex gap-3">
                <button type="submit" className="flex-1 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
                  {editingTask ? '保存' : '创建'}
                </button>
                <button type="button" onClick={() => setShowTaskModal(false)} className="flex-1 py-2 rounded bg-[var(--secondary)] text-sm hover:bg-[var(--muted)]">
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
