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
  border: '1px solid #2a2a2a',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 500,
  transition: 'background 150ms, border-color 150ms, opacity 150ms',
  background: '#0d0d0d',
  color: '#f5f5f5',
};

const variantStyles: Record<string, React.CSSProperties> = {
  primary: { background: '#f5f5f5', color: '#050505', border: '1px solid #f5f5f5' },
  secondary: { background: '#171717', color: '#f5f5f5', border: '1px solid #2a2a2a' },
  danger: { background: '#ef4444', color: '#ffffff', border: '1px solid #ef4444' },
  ghost: { background: 'transparent', color: '#a3a3a3', border: '1px solid transparent' },
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
