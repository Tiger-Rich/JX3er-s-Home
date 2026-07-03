import React from 'react';
import {
  ContactRound,
  House,
  LogOut,
  Send,
  UserRound,
} from 'lucide-react';

const navigation = [
  { id: 'feed', label: '万事广场', Icon: House },
  { id: 'create', label: '发个委托', Icon: Send },
  { id: 'contacts', label: '联系申请', Icon: ContactRound },
  { id: 'profile', label: '我的名片', Icon: UserRound },
];

export default function AppShell({
  activeTab,
  onTabChange,
  onLogout,
  children,
}) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>番薯万事屋</h1>
          <p>同在江湖，先看身份，再谈合作。</p>
        </div>
        <button type="button" onClick={onLogout}>
          <LogOut aria-hidden="true" size={18} />
          <span>退出登录</span>
        </button>
      </header>

      <main className="app-content">{children}</main>

      <nav className="bottom-navigation" aria-label="主导航">
        {navigation.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => onTabChange(id)}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
