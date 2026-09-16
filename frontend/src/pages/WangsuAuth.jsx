import React, { useState } from 'react';
import { api } from '../lib/api';
import { Cloud, Check, Eye, EyeOff } from 'lucide-react';

export default function WangsuAuth() {
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [authMethod, setAuthMethod] = useState('AKSK');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(null);

  React.useEffect(() => {
    api.get('/cdn/auth-config')
      .then(data => {
        if (data) {
          setAccessKeyId(data.access_key_id || '');
          setAccessKeySecret(data.access_key_secret || '');
          setAuthMethod(data.auth_method || 'AKSK');
          setVerified(data.verified || false);
        }
      })
      .catch(console.error);
  }, []);

  async function handleVerify() {
    setVerifying(true);
    setError('');
    try {
      await api.post('/cdn/auth-config/verify', { access_key_id: accessKeyId, access_key_secret: accessKeySecret });
      setVerified(true);
      setExisting({ access_key_id: accessKeyId, access_key_secret: accessKeySecret, auth_method: authMethod, verified: true });
    } catch (err) {
      setError(err.message);
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    setError('');
    try {
      await api.post('/cdn/auth-config', { access_key_id: accessKeyId, access_key_secret: accessKeySecret, auth_method: authMethod });
      setVerified(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">网宿 CDN 认证</h2>

      <div className="bg-[var(--card)] rounded-lg border p-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Cloud size={20} className="text-[var(--primary)]" />
          <span className="text-sm font-medium">AccessKey 配置</span>
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">AccessKey ID</label>
          <input
            type="text"
            value={accessKeyId}
            onChange={e => setAccessKeyId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
            placeholder="ws-xxxxxxx"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">AccessKey Secret</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={accessKeySecret}
              onChange={e => setAccessKeySecret(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)] pr-10"
              placeholder="••••••••••••••••"
            />
            <button
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-2.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">认证方式</label>
          <select
            value={authMethod}
            onChange={e => setAuthMethod(e.target.value)}
            className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
          >
            <option value="AKSK">AKSK (HMAC-SHA256)</option>
          </select>
        </div>

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {verified && (
          <div className="flex items-center gap-2 text-green-400 text-sm mb-4">
            <Check size={16} />
            凭证验证成功
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleVerify}
            disabled={verifying || !accessKeyId || !accessKeySecret}
            className="px-4 py-2 rounded bg-[var(--secondary)] text-sm font-medium hover:bg-[var(--muted)] disabled:opacity-50"
          >
            {verifying ? '验证中...' : '验证凭证'}
          </button>
          <button
            onClick={handleSave}
            disabled={!accessKeyId || !accessKeySecret}
            className="px-4 py-2 rounded bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--accent)] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>

      <div className="mt-6 bg-[var(--card)] rounded-lg border p-4 text-sm text-[var(--muted-foreground)]">
        <p><strong>获取 AccessKey：</strong>登录网宿控制台 → 用户中心 → AccessKey 管理 → 创建 AccessKey</p>
        <p className="mt-1"><strong>注意：</strong>AccessKey 仅通过面板 UI 配置，存储在数据库中，不存环境变量。</p>
      </div>
    </div>
  );
}
