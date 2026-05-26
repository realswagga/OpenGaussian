import React, { useState } from 'react';

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTabId?: string;
  className?: string;
}

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #2a2a2a',
  marginBottom: '16px',
};

const tabButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#a3a3a3',
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500,
  fontFamily: 'inherit',
  transition: 'color 150ms, border-color 150ms',
  borderBottom: '2px solid transparent',
  marginBottom: '-1px',
};

const tabButtonActiveStyle: React.CSSProperties = {
  ...tabButtonStyle,
  color: '#f5f5f5',
  borderBottomColor: '#f5f5f5',
};

export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTabId, className = '' }) => {
  const [activeTabId, setActiveTabId] = useState(defaultTabId || (tabs[0]?.id ?? ''));

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  return (
    <div className={className}>
      <div style={tabListStyle}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            style={tab.id === activeTabId ? tabButtonActiveStyle : tabButtonStyle}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
};