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
  ghost: { background: 'transparent', color: '#a3a3a3', border: '1px solid transparent' },
  secondary: { background: '#171717', color: '#f5f5f5', border: '1px solid #2a2a2a' },
  primary: { background: '#f5f5f5', color: '#050505', border: '1px solid #f5f5f5' },
  danger: { background: '#ef4444', color: '#ffffff', border: '1px solid #ef4444' },
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
    border: active ? '1px solid #f5f5f5' : vars.border,
    background: active ? '#171717' : vars.background,
    color: active ? '#f5f5f5' : vars.color,
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
