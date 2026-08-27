export type ToastType = 'success' | 'error' | 'info' | 'warning'

export function showToast(message: string, type: ToastType = 'info', duration = 5000) {
  const container = document.getElementById('toast-container') || createContainer()
  const toast = document.createElement('div')
  const colors = { success: '#4caf50', error: '#f44336', info: '#1976d2', warning: '#ff9800' }
  Object.assign(toast.style, {
    padding: '0.75rem 1.5rem',
    marginBottom: '0.5rem',
    borderRadius: '4px',
    color: 'white',
    background: colors[type],
    fontSize: '0.875rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    animation: 'slideIn 0.3s ease-out',
  })
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

function createContainer() {
  const el = document.createElement('div')
  el.id = 'toast-container'
  Object.assign(el.style, {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  })
  document.body.appendChild(el)
  const style = document.createElement('style')
  style.textContent = `@keyframes slideIn { from { transform: translateX(100%); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`
  document.head.appendChild(style)
  return el
}
