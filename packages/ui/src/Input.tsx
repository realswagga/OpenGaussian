import React from 'react';

interface InputProps {
  label?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  style?: React.CSSProperties;
}

const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--admin-soft, var(--color-ink-soft))',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--color-input)',
  border: 'var(--admin-rule, 1px solid var(--color-rule))',
  borderRadius: 'var(--radius-md, 6px)',
  padding: '8px 12px',
  fontSize: '14px',
  color: 'var(--admin-ink, var(--color-ink))',
  outline: 'none',
  transition: 'border-color 150ms',
  fontFamily: 'inherit',
};

const errorStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--admin-danger, var(--color-error))',
};

export const Input: React.FC<InputProps> = ({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  error,
  className = '',
  style,
}) => {
  return (
    <div style={wrapperStyle} className={className}>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          ...inputStyle,
          ...style,
          borderColor: error ? 'var(--admin-danger, var(--color-error))' : 'var(--color-rule)',
          opacity: disabled ? 0.5 : 1,
        }}
        onFocus={(e) => {
          if (!error) e.target.style.borderColor = 'var(--admin-rule-strong, var(--color-rule-strong))';
        }}
        onBlur={(e) => {
          if (!error) e.target.style.borderColor = 'var(--color-rule)';
        }}
      />
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
};
