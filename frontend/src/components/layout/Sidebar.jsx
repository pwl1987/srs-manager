import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Radio, Satellite, Key, FileText,
  ArrowLeftRight, Monitor, Film, Settings as SettingsIcon, Cloud
} from 'lucide-react';
import { cn } from '../../lib/utils';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/streams', label: '流管理', icon: Radio },
  { path: '/cdn-channels', label: 'CDN 频道', icon: Satellite },
  { path: '/auth-keys', label: '鉴权密钥', icon: Key },
  { path: '/distribution', label: '分发申请', icon: FileText },
  { path: '/forwarding', label: '拉流转发', icon: ArrowLeftRight },
  { path: '/monitor', label: '监控', icon: Monitor },
  { path: '/transcode', label: '转码模板', icon: Film },
  { path: '/wangsu-auth', label: '网宿认证', icon: Cloud },
  { path: '/settings', label: '设置', icon: SettingsIcon },
];

export default function Sidebar() {
  return (
    <aside className="w-56 flex flex-col border-r bg-[var(--card)]">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold">SRS Manager</h1>
        <p className="text-xs text-[var(--muted-foreground)]">直播流媒体管理面板</p>
      </div>
      <nav className="flex-1 p-2">
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors',
              isActive
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]'
            )}
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
