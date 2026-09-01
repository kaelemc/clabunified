import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Box, Text } from "@mantine/core";
import { applyThemeVars, AppThemeProvider } from "@srl-labs/clab-ui/theme";

import {
  RuntimeTerminalPaneView
} from "./components/RuntimeTerminalWindows";
import { detachedTerminalTargetFromLocation } from "./runtimeDetachedTerminal";
import {
  loadTerminalPreferences,
  persistTerminalPreferences,
  type TerminalPreferences
} from "./runtimeTerminalSettings";
import {
  runtimeUiActions,
  useRuntimeUiStore,
  type RuntimeTerminalPane
} from "./stores/runtimeUiStore";
import { resolveStandaloneTheme } from "./standaloneTheme";

function terminalPaneById(panes: RuntimeTerminalPane[], paneId: string | null): RuntimeTerminalPane | undefined {
  return (paneId ? panes.find((pane) => pane.id === paneId) : undefined) ?? panes[0];
}

function FatalMessage({ message }: { message: string }) {
  return (
    <Box
      style={{
        alignItems: "center",
        background: "var(--mantine-color-body)",
        color: "var(--mantine-color-text)",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: 16
      }}
    >
      <Text size="sm">{message}</Text>
    </Box>
  );
}

function DetachedTerminalApp() {
  const [target] = useState(() => detachedTerminalTargetFromLocation());
  const [terminalPreferences, setTerminalPreferences] =
    useState<TerminalPreferences>(() => loadTerminalPreferences());
  const openedPaneIdRef = useRef<string | null>(null);
  const groups = useRuntimeUiStore((state) => state.terminals);
  const panes = groups.flatMap((group) => group.panes);
  const pane = terminalPaneById(panes, openedPaneIdRef.current);

  useEffect(() => {
    if (!target || openedPaneIdRef.current !== null) {
      return;
    }
    document.title = target.title;
    openedPaneIdRef.current = runtimeUiActions.openTerminal(target);
  }, [target]);

  const handleSaveTerminalPreferences = useCallback(
    (
      next: TerminalPreferences,
      _options?: {
        notify?: boolean;
      }
    ) => {
      setTerminalPreferences(persistTerminalPreferences(next));
    },
    []
  );

  if (!target) {
    return <FatalMessage message="Missing or invalid terminal target." />;
  }

  if (!pane) {
    return <FatalMessage message={openedPaneIdRef.current ? "Terminal closed." : "Opening terminal..."} />;
  }

  return (
    <Box
      style={{
        background: "var(--mantine-color-body)",
        height: "100%",
        minHeight: 0
      }}
    >
      <RuntimeTerminalPaneView
        active
        hidden={false}
        onSaveTerminalPreferences={handleSaveTerminalPreferences}
        paneState={pane}
        terminalPreferences={terminalPreferences}
      />
    </Box>
  );
}

function main(): void {
  const theme = resolveStandaloneTheme();
  document.documentElement.classList.toggle("light", theme === "light");
  applyThemeVars(theme);

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  createRoot(rootElement).render(
    <AppThemeProvider>
      <DetachedTerminalApp />
    </AppThemeProvider>
  );
}

main();
