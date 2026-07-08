'use client'
import { useState, useCallback } from 'react'

export function useLoadingState() {
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set())

  const startLoading = useCallback((key: string) => {
    setLoadingKeys(prev => new Set(prev).add(key))
  }, [])

  const stopLoading = useCallback((key: string) => {
    setLoadingKeys(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const isLoading = useCallback((key: string) => loadingKeys.has(key), [loadingKeys])

  return { isLoading, startLoading, stopLoading }
}
