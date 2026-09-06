"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import {
  FILE_MUTATION_COMMIT_EVENT,
  FileMutationCoordinator,
  type FileMutationCommitDetail,
  type FileMutationParticipant,
  type FileMutationRequest,
} from "@/lib/file-mutation";

interface FileMutationContextValue {
  runFileMutation: (request: FileMutationRequest) => Promise<FileMutationCommitDetail>;
  registerParticipant: (participant: FileMutationParticipant) => () => void;
  hasUnsavedChanges: (request: FileMutationRequest) => boolean;
  isMutationInFlight: () => boolean;
}

const FileMutationContext = createContext<FileMutationContextValue | null>(null);

export function FileMutationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const coordinatorRef = useRef<FileMutationCoordinator | null>(null);
  if (coordinatorRef.current == null) {
    coordinatorRef.current = new FileMutationCoordinator();
  }

  const registerParticipant = useCallback(
    (participant: FileMutationParticipant) =>
      coordinatorRef.current!.registerParticipant(participant),
    [],
  );

  const hasUnsavedChanges = useCallback(
    (request: FileMutationRequest) =>
      coordinatorRef.current!.hasUnsavedChanges(request),
    [],
  );

  const runFileMutation = useCallback(
    async (request: FileMutationRequest): Promise<FileMutationCommitDetail> => {
      const detail = await coordinatorRef.current!.run(request);
      window.dispatchEvent(
        new CustomEvent(FILE_MUTATION_COMMIT_EVENT, { detail }),
      );
      window.dispatchEvent(new Event("refresh-file-tree"));
      return detail;
    },
    [],
  );

  const value = useMemo<FileMutationContextValue>(
    () => ({
      runFileMutation,
      registerParticipant,
      hasUnsavedChanges,
      isMutationInFlight: () =>
        coordinatorRef.current!.isMutationInFlight(),
    }),
    [hasUnsavedChanges, registerParticipant, runFileMutation],
  );

  return (
    <FileMutationContext.Provider value={value}>
      {children}
    </FileMutationContext.Provider>
  );
}

export function useFileMutation(): FileMutationContextValue {
  const context = useContext(FileMutationContext);
  if (!context) {
    throw new Error("useFileMutation must be used inside FileMutationProvider");
  }
  return context;
}
