import React from 'react';

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

const baseStyle: React.CSSProperties = {
  background: 'var(--admin-panel, var(--color-panel))',
  border: 'var(--admin-rule, 1px solid var(--color-rule))',
  borderRadius: 'var(--radius-card, 8px)',
  padding: '16px',
  transition: 'border-color 150ms, background 150ms',
};

export const Card: React.FC<CardProps> = ({
  children,
  style,
  className = '',
  onClick,
  hoverable = false,
}) => {
  const mergedStyle: React.CSSProperties = {
    ...baseStyle,
    ...(hoverable ? { cursor: 'pointer' } : {}),
    ...style,
  };

  return (
    <div style={mergedStyle} className={className} onClick={onClick} onMouseEnter={hoverable ? (e) => {
      (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--admin-rule-strong, var(--color-rule-strong))';
      (e.currentTarget as HTMLDivElement).style.background = 'var(--admin-panel-2, var(--color-panel-2))';
    } : undefined} onMouseLeave={hoverable ? (e) => {
      (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-rule)';
      (e.currentTarget as HTMLDivElement).style.background = 'var(--admin-panel, var(--color-panel))';
    } : undefined}>
      {children}
    </div>
  );
};
