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
  color: '#a3a3a3',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #2a2a2a',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  color: '#f5f5f5',
  outline: 'none',
  transition: 'border-color 150ms',
  fontFamily: 'inherit',
};

const errorStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#ef4444',
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
          borderColor: error ? '#ef4444' : '#2a2a2a',
          opacity: disabled ? 0.5 : 1,
        }}
        onFocus={(e) => {
          if (!error) e.target.style.borderColor = '#3a3a3a';
        }}
        onBlur={(e) => {
          if (!error) e.target.style.borderColor = '#2a2a2a';
        }}
      />
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
};
