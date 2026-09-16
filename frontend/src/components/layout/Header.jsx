import React from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { LogOut } from 'lucide-react';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b bg-[var(--card)]">
      <span className="text-sm text-[var(--muted-foreground)]">
        SRS {new URL(window.location.origin).host}:1935
      </span>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user?.username}</span>
        <button
          onClick={logout}
          className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          title="退出登录"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
