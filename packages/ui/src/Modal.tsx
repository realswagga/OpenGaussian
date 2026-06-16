import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--color-viewer-scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '24px',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--admin-panel-solid, var(--color-panel-solid))',
  border: 'var(--admin-rule, 1px solid var(--color-rule))',
  borderRadius: 'var(--radius-card, 8px)',
  padding: '24px',
  maxWidth: '520px',
  width: '100%',
  maxHeight: '90vh',
  overflow: 'auto',
  color: 'var(--admin-ink, var(--color-ink))',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--admin-ink, var(--color-ink))',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--admin-soft, var(--color-ink-soft))',
  fontSize: '20px',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: '4px',
};

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          {title && <h2 style={titleStyle}>{title}</h2>}
          <button style={closeButtonStyle} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
};
