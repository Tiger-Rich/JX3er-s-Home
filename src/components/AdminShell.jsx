import React from 'react';
import { ClipboardCheck, FileCheck2, LogOut, UsersRound } from 'lucide-react';

const navigation = [
  { id: 'verifications', label: '认证审核', Icon: ClipboardCheck },
  { id: 'requests', label: '委托审核', Icon: FileCheck2 },
  { id: 'users', label: '用户列表', Icon: UsersRound },
];

export default function AdminShell({
  activeTab,
  onTabChange,
  onLogout,
  children,
}) {
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <h1>番薯万事屋</h1>
          <p>同在江湖，先看身份，再谈合作。</p>
        </div>
        <button type="button" onClick={onLogout}>
          <LogOut aria-hidden="true" size={18} />
          <span>退出登录</span>
        </button>
      </header>

      <nav className="admin-navigation" aria-label="后台导航">
        {navigation.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => onTabChange(id)}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="admin-content">{children}</main>
    </div>
  );
}
