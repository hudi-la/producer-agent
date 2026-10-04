// For failures outside the currently open form (background reads, card actions).
export function reportError(error, context = '') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fairwind-error', { detail: { error, context } }))
}
