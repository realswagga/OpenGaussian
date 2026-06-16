import React from 'react';

interface IconButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  active?: boolean;
}

const sizes: Record<string, React.CSSProperties> = {
  sm: { width: 28, height: 28, fontSize: 14 },
  md: { width: 36, height: 36, fontSize: 16 },
  lg: { width: 44, height: 44, fontSize: 20 },
};

const variantStyles: Record<string, React.CSSProperties> = {
  ghost: { background: 'transparent', color: 'var(--admin-soft, var(--color-ink-soft))', border: '1px solid transparent' },
  secondary: { background: 'var(--admin-panel, var(--color-panel))', color: 'var(--admin-ink, var(--color-ink))', border: 'var(--admin-rule, 1px solid var(--color-rule))' },
  primary: { background: 'var(--admin-accent, var(--color-accent))', color: 'var(--admin-accent-ink, var(--color-accent-ink))', border: '1px solid var(--admin-accent, var(--color-accent))' },
  danger: { background: 'var(--admin-danger, var(--color-error))', color: 'var(--color-accent-ink)', border: '1px solid var(--admin-danger, var(--color-error))' },
};

export const IconButton: React.FC<IconButtonProps> = ({
  children,
  onClick,
  label,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  type = 'button',
  active = false,
}) => {
  const dims = sizes[size]!;
  const vars = variantStyles[variant]!;

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: active ? '1px solid var(--admin-accent, var(--color-accent))' : vars.border,
    background: active ? 'var(--admin-panel-2, var(--color-panel-2))' : vars.background,
    color: active ? 'var(--admin-ink, var(--color-ink))' : vars.color,
    opacity: disabled ? 0.4 : 1,
    transition: 'background 150ms, border-color 150ms',
    ...dims,
    padding: 0,
    fontFamily: 'inherit',
  };

  return (
    <button
      type={type}
      style={style}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
};
