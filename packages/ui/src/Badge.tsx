import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning';
  style?: React.CSSProperties;
}

const variantStyles: Record<string, React.CSSProperties> = {
  default: { background: '#171717', color: '#a3a3a3', border: '1px solid #2a2a2a' },
  success: { background: '#052e16', color: '#22c55e', border: '1px solid #166534' },
  danger: { background: '#2e0510', color: '#ef4444', border: '1px solid #661111' },
  warning: { background: '#2e1f05', color: '#eab308', border: '1px solid #663e11' },
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