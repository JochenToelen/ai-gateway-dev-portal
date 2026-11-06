import { useCallback, useEffect, useState } from 'react';
import { useAzure } from '../context/AzureContext';
import { loadPricingDocument, PricingStoreError, savePricingDocument, type StoreErrorKind, type StoreSource } from './store';
import { EMPTY_DOCUMENT, type PricingDocument } from './types';
import type { MutationResult } from './mutations';

export type PricingLoadState = 'loading' | 'ready' | 'error';

export interface PricingStore {
  doc: PricingDocument;
  state: PricingLoadState;
  error: { kind: StoreErrorKind | 'unknown'; message: string } | null;
  /** where the shared document lives: a local file (development) or blob storage (Container App) */
  source: StoreSource | null;
  /** false when the document could not be loaded or the server does not allow this user to edit */
  canEdit: boolean;
  reload: () => void;
  /** Applies a pure mutation and persists it with ETag concurrency. Returns validation errors (empty = saved). */
  apply: (mutate: (doc: PricingDocument, user: string, now: string) => MutationResult) => Promise<string[]>;
}

/** Loads the shared pricing document; the same hook serves the admin screen and the cost dashboards. */
export function usePricingStore(): PricingStore {
  const { userProfile } = useAzure();
  const [doc, setDoc] = useState<PricingDocument>(EMPTY_DOCUMENT);
  const [etag, setEtag] = useState<string | null>(null);
  const [state, setState] = useState<PricingLoadState>('loading');
  const [error, setError] = useState<PricingStore['error']>(null);
  const [source, setSource] = useState<StoreSource | null>(null);
  const [serverCanEdit, setServerCanEdit] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await loadPricingDocument();
        if (cancelled) return;
        setDoc(res.doc); setEtag(res.etag); setSource(res.source); setServerCanEdit(res.canEdit);
        setState('ready'); setError(null);
      } catch (e) {
        if (cancelled) return;
        setState('error');
        setError({ kind: e instanceof PricingStoreError ? e.kind : 'unknown', message: e instanceof Error ? e.message : 'Failed to load pricing' });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [tick]);

  const reload = useCallback(() => { setState('loading'); setTick((t) => t + 1); }, []);

  const apply = useCallback(async (mutate: (d: PricingDocument, user: string, now: string) => MutationResult) => {
    const user = [userProfile?.email, userProfile?.name].find((s) => !!s) ?? 'unknown';
    const res = mutate(doc, user, new Date().toISOString());
    if (res.errors.length) return res.errors;
    try {
      const newEtag = await savePricingDocument(res.doc, etag);
      setDoc(res.doc); setEtag(newEtag);
      return [];
    } catch (e) {
      if (e instanceof PricingStoreError && e.kind === 'conflict') reload();
      return [e instanceof Error ? e.message : 'Saving failed'];
    }
  }, [doc, etag, reload, userProfile]);

  return { doc, state, error, source, canEdit: state === 'ready' && serverCanEdit, reload, apply };
}
