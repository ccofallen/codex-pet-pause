import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSnapshot } from '../../app/AppProvider';
import { PetLibrary, type PetLibraryCatalog } from '../../features/pets/components/PetLibrary';
import { BUILTIN_PET_ID } from '../../features/pets/domain/types';
import type { AndroidControlHost } from '../bridge/androidHost';
import type { AndroidPetCatalogSession, AndroidPetCatalogState } from '../domain/petCatalog';
import { createAndroidPetCatalog } from '../infrastructure/androidPetCatalog';
import type { AndroidPetImport } from '../infrastructure/androidPetImport';

export function AndroidPetLibrary({
  host,
  androidImport,
}: {
  host: AndroidControlHost;
  androidImport: AndroidPetImport;
}) {
  const snapshot = useAppSnapshot();
  const [catalogState, setCatalogState] = useState<AndroidPetCatalogState>();
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectionPendingId, setSelectionPendingId] = useState<string>();
  const sessionRef = useRef<AndroidPetCatalogSession | undefined>(undefined);
  const lifecycleGenerationRef = useRef(0);
  const selectionGenerationRef = useRef(0);
  const confirmedSelectionRef = useRef(snapshot.settings.activePetId);
  const desiredSelectionRef = useRef(snapshot.settings.activePetId);
  const loadInFlightRef = useRef(new Map<AndroidPetCatalogSession, Promise<void>>());
  const queuedLoadRef = useRef(new Set<AndroidPetCatalogSession>());

  const load = useCallback((session: AndroidPetCatalogSession): Promise<void> => {
    const inFlight = loadInFlightRef.current.get(session);
    if (inFlight !== undefined) {
      queuedLoadRef.current.add(session);
      return inFlight;
    }
    const generation = lifecycleGenerationRef.current;
    if (sessionRef.current === session) setLoading(true);
    const run = async (): Promise<void> => {
      try {
        do {
          queuedLoadRef.current.delete(session);
          const selectionGeneration = selectionGenerationRef.current;
          try {
            const next = await session.load();
            if (next !== undefined && generation === lifecycleGenerationRef.current) {
              const selectionAdvanced = selectionGeneration !== selectionGenerationRef.current;
              if (!selectionAdvanced) {
                confirmedSelectionRef.current = next.activePetId;
                desiredSelectionRef.current = next.activePetId;
              }
              setCatalogState((current) => selectionAdvanced
                ? {
                    ...next,
                    activePetId: current?.activePetId ?? desiredSelectionRef.current,
                  }
                : next);
              setLoadError(false);
            }
          } catch {
            if (generation === lifecycleGenerationRef.current) setLoadError(true);
          }
        } while (queuedLoadRef.current.delete(session)
          && generation === lifecycleGenerationRef.current
          && sessionRef.current === session);
      } finally {
        loadInFlightRef.current.delete(session);
        queuedLoadRef.current.delete(session);
        if (generation === lifecycleGenerationRef.current
          && sessionRef.current === session) setLoading(false);
      }
    };
    const promise = run();
    loadInFlightRef.current.set(session, promise);
    return promise;
  }, []);

  useEffect(() => {
    const session = createAndroidPetCatalog(host);
    sessionRef.current = session;
    lifecycleGenerationRef.current += 1;
    setSelectionPendingId(undefined);
    void load(session).catch(() => undefined);
    return () => {
      lifecycleGenerationRef.current += 1;
      selectionGenerationRef.current += 1;
      if (sessionRef.current === session) sessionRef.current = undefined;
      session.dispose();
    };
  }, [host, load]);

  const selectPet = async (id: string): Promise<void> => {
    const session = sessionRef.current;
    if (session === undefined) return;
    const generation = ++selectionGenerationRef.current;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    desiredSelectionRef.current = id;
    setCatalogState((current) => current === undefined
      ? current
      : { ...current, activePetId: id });
    setSelectionPendingId(id);
    try {
      await session.select(id);
    } catch (error) {
      if (lifecycleGeneration !== lifecycleGenerationRef.current
        || generation !== selectionGenerationRef.current) return;
      if (generation === selectionGenerationRef.current) {
        desiredSelectionRef.current = confirmedSelectionRef.current;
        setCatalogState((current) => current === undefined
          ? current
          : { ...current, activePetId: confirmedSelectionRef.current });
      }
      throw error;
    } finally {
      if (lifecycleGeneration === lifecycleGenerationRef.current
        && generation === selectionGenerationRef.current) setSelectionPendingId(undefined);
    }
    if (lifecycleGeneration === lifecycleGenerationRef.current
      && generation === selectionGenerationRef.current) {
      confirmedSelectionRef.current = id;
      desiredSelectionRef.current = id;
    }
  };

  const deletePet = async (id: string): Promise<void> => {
    const session = sessionRef.current;
    if (session === undefined) return;
    await session.delete(id);
    setCatalogState((current) => current === undefined ? current : {
      ...current,
      activePetId: current.activePetId === id ? BUILTIN_PET_ID : current.activePetId,
      pets: current.pets.filter((pet) => pet.id !== id),
    });
  };

  const refresh = async (): Promise<void> => {
    const session = sessionRef.current;
    if (session !== undefined) await load(session);
  };

  const pets = catalogState?.pets ?? [];
  const catalog: PetLibraryCatalog = {
    pets,
    activePetId: catalogState?.activePetId ?? snapshot.settings.activePetId,
    thumbnailUrls: new Map(pets.flatMap((pet) => pet.thumbnailUrl === undefined
      ? []
      : [[pet.id, pet.thumbnailUrl] as const])),
    ...(selectionPendingId === undefined ? {} : { selectionPendingId }),
    loadError,
    loading,
    selectPet,
    deletePet,
    refresh,
    retry: refresh,
  };

  return <PetLibrary androidImport={androidImport} catalog={catalog} />;
}
