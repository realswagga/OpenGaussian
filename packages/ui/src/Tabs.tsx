import React, { useEffect, useState } from 'react';

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTabId?: string;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
}

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: 'var(--admin-rule, 1px solid var(--color-rule))',
  marginBottom: '16px',
};

const tabButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--admin-soft, var(--color-ink-soft))',
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
  color: 'var(--admin-ink, var(--color-ink))',
  borderBottomColor: 'var(--admin-accent, var(--color-accent))',
};

export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTabId, activeTabId: controlledActiveTabId, onTabChange, className = '' }) => {
  const firstTabId = tabs[0]?.id ?? '';
  const [internalActiveTabId, setInternalActiveTabId] = useState(defaultTabId || firstTabId);
  const activeTabId = controlledActiveTabId ?? internalActiveTabId;

  useEffect(() => {
    if (controlledActiveTabId) return;
    setInternalActiveTabId(defaultTabId || firstTabId);
  }, [controlledActiveTabId, defaultTabId, firstTabId]);

  const handleTabChange = (tabId: string) => {
    if (!controlledActiveTabId) setInternalActiveTabId(tabId);
    onTabChange?.(tabId);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  return (
    <div className={className}>
      <div style={tabListStyle}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            style={tab.id === activeTabId ? tabButtonActiveStyle : tabButtonStyle}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
};
