import { createContext, useContext, type ReactNode } from "react";

import type { TerminalPreferences } from "../runtimeTerminalSettings";
import type {
  EndpointConfig,
  EndpointImportResult,
  EndpointSessionDuration
} from "../stores/endpointStore";

/**
 * State and handlers backing the standalone settings sections. These used to be
 * props on the floating SettingsOverlay; they are now shared through context so
 * the sections can render inside clab-ui's unified Settings modal.
 */
export interface StandaloneSettingsValue {
  currentTheme: "light" | "dark";
  defaultApiUrl: string;
  endpoints: EndpointConfig[];
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints: () => string;
  onImportEndpoints: (content: string) => EndpointImportResult | Promise<EndpointImportResult>;
  onLogout: () => void;
  onReconnectEndpoint: (input: {
    endpointId: string;
    password: string;
    username: string;
  }) => Promise<void>;
  onRemoveEndpoint: (endpointId: string) => Promise<void>;
  onUpdateEndpoint: (input: {
    endpointId: string;
    label: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onSetEndpointSessionDuration: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: { notify?: boolean }
  ) => void;
  onThemeChange: (nextTheme: "light" | "dark") => void;
  terminalPreferences: TerminalPreferences;
}

const StandaloneSettingsContext = createContext<StandaloneSettingsValue | null>(null);

export function StandaloneSettingsProvider(props: {
  value: StandaloneSettingsValue;
  children: ReactNode;
}) {
  return (
    <StandaloneSettingsContext.Provider value={props.value}>
      {props.children}
    </StandaloneSettingsContext.Provider>
  );
}

export function useStandaloneSettings(): StandaloneSettingsValue {
  const value = useContext(StandaloneSettingsContext);
  if (!value) {
    throw new Error(
      "useStandaloneSettings must be used within a StandaloneSettingsProvider."
    );
  }
  return value;
}
