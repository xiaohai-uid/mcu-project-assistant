"use client";

import { useState, useEffect, useCallback } from "react";

interface DesignDraftStatus {
  id: string;
  title: string;
  status: string;
  current_stage: string;
  experience_level: string;
  created_at: string;
  updated_at: string;
  snapshot_id: string;
  snapshot_data: unknown;
}

export function useDesignDraft(designDraftId: string | null) {
  const [data, setData] = useState<DesignDraftStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    if (!designDraftId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${designDraftId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const result = await res.json();
      setData(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [designDraftId]);

  useEffect(() => {
    if (!designDraftId) return;
    const interval = setInterval(poll, 2000);
    poll();
    return () => clearInterval(interval);
  }, [designDraftId, poll]);

  return { data, isLoading, error, refetch: poll };
}

export function useProjectStatus(projectId: string | null) {
  return useDesignDraft(projectId);
}
