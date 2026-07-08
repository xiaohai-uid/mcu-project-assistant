export function LoadingSpinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const sizes = { sm: 16, md: 32, lg: 48 }
  const px = sizes[size]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '2rem' }}>
      <div
        style={{
          width: px,
          height: px,
          border: `3px solid #e0e0e0`,
          borderTopColor: '#1976d2',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {label && <span style={{ color: '#666', fontSize: '0.875rem' }}>{label}</span>}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
