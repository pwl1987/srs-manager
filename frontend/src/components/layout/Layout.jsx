import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const workspaceMode = /^\/streams\/\d+\/?$/.test(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <div className="hidden shrink-0 md:flex">
        <Sidebar compact={workspaceMode} />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/72 backdrop-blur-[2px]" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full shadow-[var(--shadow-elevated)]">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {workspaceMode ? <div className="md:hidden"><Header onMenuClick={() => setSidebarOpen(true)} /></div> : <Header onMenuClick={() => setSidebarOpen(true)} />}
        <main className={workspaceMode ? 'min-h-0 flex-1 overflow-hidden p-0' : 'flex-1 overflow-y-auto p-4 md:p-6 xl:p-8'}>
          <div className={workspaceMode ? 'w-full' : 'mx-auto w-full max-w-[1600px]'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
