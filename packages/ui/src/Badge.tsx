import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning';
  style?: React.CSSProperties;
}

const variantStyles: Record<string, React.CSSProperties> = {
  default: { background: 'var(--admin-panel-2, var(--color-panel-2))', color: 'var(--admin-soft, var(--color-ink-soft))', border: 'var(--admin-rule, 1px solid var(--color-rule))' },
  success: { background: 'oklch(78% 0.13 145 / 0.12)', color: 'var(--admin-success)', border: '1px solid var(--admin-success)' },
  danger: { background: 'oklch(70% 0.14 25 / 0.12)', color: 'var(--admin-danger)', border: '1px solid var(--admin-danger)' },
  warning: { background: 'oklch(82% 0.11 83 / 0.12)', color: 'var(--admin-warning)', border: '1px solid var(--admin-warning)' },
};

const baseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: 500,
};

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', style }) => {
  const mergedStyle: React.CSSProperties = {
    ...baseStyle,
    ...(variantStyles[variant] || variantStyles.default),
    ...style,
  };

  return <span style={mergedStyle}>{children}</span>;
};
