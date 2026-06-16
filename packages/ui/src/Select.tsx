import React from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

const baseStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'var(--color-input)',
  border: 'var(--admin-rule, 1px solid var(--color-rule))',
  borderRadius: 'var(--radius-md, 6px)',
  color: 'var(--admin-ink, var(--color-ink))',
  fontSize: '14px',
  outline: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundPosition: 'right 8px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px 16px',
  paddingRight: '32px',
};

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  style,
}) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...baseStyle, ...style, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};
