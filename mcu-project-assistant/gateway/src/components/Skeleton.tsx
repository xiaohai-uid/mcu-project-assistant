export function Skeleton({ width, height, borderRadius = 4 }: { width?: string | number; height?: string | number; borderRadius?: number }) {
  return (
    <div
      style={{
        width: width || '100%',
        height: height || 20,
        borderRadius,
        background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
      }}
    >
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div style={{ padding: '1rem', border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: '0.75rem' }}>
      <Skeleton height={18} width="60%" />
      <div style={{ height: 8 }} />
      <Skeleton height={14} width="40%" />
      <div style={{ height: 8 }} />
      <Skeleton height={14} width="80%" />
    </div>
  )
}
