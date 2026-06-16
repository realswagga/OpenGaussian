import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  style?: React.CSSProperties;
}

const baseStyles: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'var(--admin-rule, 1px solid var(--color-rule))',
  borderRadius: 'var(--radius-md, 6px)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 500,
  transition: 'background 150ms, border-color 150ms, opacity 150ms, transform 120ms',
  background: 'var(--admin-panel, var(--color-panel))',
  color: 'var(--admin-ink, var(--color-ink))',
};

const variantStyles: Record<string, React.CSSProperties> = {
  primary: { background: 'var(--admin-accent, var(--color-accent))', color: 'var(--admin-accent-ink, var(--color-accent-ink))', border: '1px solid var(--admin-accent, var(--color-accent))' },
  secondary: { background: 'var(--admin-panel, var(--color-panel))', color: 'var(--admin-ink, var(--color-ink))', border: 'var(--admin-rule, 1px solid var(--color-rule))' },
  danger: { background: 'var(--admin-danger, var(--color-error))', color: 'var(--color-accent-ink)', border: '1px solid var(--admin-danger, var(--color-error))' },
  ghost: { background: 'transparent', color: 'var(--admin-soft, var(--color-ink-soft))', border: '1px solid transparent' },
};

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: '13px', height: '30px' },
  md: { padding: '6px 14px', fontSize: '14px', height: '36px' },
  lg: { padding: '10px 20px', fontSize: '15px', height: '44px' },
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  style: styleOverride,
}) => {
  const style: React.CSSProperties = {
    ...baseStyles,
    ...(variantStyles[variant] || variantStyles.secondary),
    ...(sizeStyles[size] || sizeStyles.md),
    ...styleOverride,
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  return (
    <button
      type={type}
      style={style}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  );
};
