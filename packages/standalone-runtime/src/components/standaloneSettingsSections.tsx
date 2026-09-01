import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip
} from "@mantine/core";
import {
  IconDownload,
  IconLogout,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload
} from "@tabler/icons-react";

import type { CustomSettingsSection } from "@srl-labs/clab-ui/host";

import { subscribeEndpointUiAction, type EndpointUiAction } from "../endpointActions";
import {
  fetchEdgeSharkStatus,
  installEdgeShark,
  uninstallEdgeShark,
  type EdgeSharkStatusResponse
} from "../runtimeApi";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  type TerminalPreferences
} from "../runtimeTerminalSettings";
import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  persistCapturePreferences,
  setSessionHostnameOverride,
  type CapturePreferences,
  type CapturePreferredAction
} from "../runtimeCaptureSettings";
import { isPagesRuntimeMode } from "../runtimeMode";
import { type EndpointConfig } from "../stores/endpointStore";
import { EndpointManager } from "./EndpointManager";
import { useStandaloneSettings } from "./standaloneSettingsContext";

const SETTINGS_GROUP = "Application";

interface SshUserMappingRow {
  id: string;
  kind: string;
  username: string;
}

type TerminalDraftResult =
  | { error: null; field: null; preferences: TerminalPreferences }
  | { error: string; field: "ssh" | "telnet" | "fontSize" };

let sshRowIdCounter = 0;
function nextSshRowId(): string {
  sshRowIdCounter += 1;
  return `ssh-row-${sshRowIdCounter}`;
}

/** Order-independent snapshot used to detect real changes and avoid self-sync loops. */
function serializeTerminalPreferences(prefs: TerminalPreferences): string {
  const sortedMapping = Object.fromEntries(
    Object.entries(prefs.sshUserMapping).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify({
    sshUserMapping: sortedMapping,
    telnetPort: prefs.telnetPort,
    fontSize: prefs.fontSize
  });
}

/** Containerlab kinds from the schema clab-ui exposes on window.__SCHEMA_DATA__. */
function schemaKinds(): string[] {
  const schema = (window as { __SCHEMA_DATA__?: { kinds?: unknown } }).__SCHEMA_DATA__;
  return Array.isArray(schema?.kinds)
    ? schema.kinds.filter((kind): kind is string => typeof kind === "string")
    : [];
}

function sshMappingToRows(mapping: Record<string, string>): SshUserMappingRow[] {
  return Object.entries(mapping).map(([kind, username]) => ({
    id: nextSshRowId(),
    kind,
    username
  }));
}

function formatCaptureStatus(
  hasEndpoint: boolean,
  loading: boolean,
  status: EdgeSharkStatusResponse | null,
  endpointLabel: string
): string {
  if (!hasEndpoint) {
    return "No endpoint selected";
  }
  if (loading) {
    return `Loading status for ${endpointLabel}...`;
  }
  if (!status) {
    return `Unknown on ${endpointLabel}`;
  }
  if (!status.running) {
    return `Not running on ${endpointLabel}`;
  }
  return `Running on ${endpointLabel}${status.version ? ` (${status.version})` : ""}`;
}

const TONE_COLOR: Record<"info" | "success" | "warning" | "error", string> = {
  info: "blue",
  success: "green",
  warning: "yellow",
  error: "red"
};

function toneStyle(tone: "info" | "success" | "warning" | "error"): React.CSSProperties {
  return {
    borderColor: `var(--mantine-color-${TONE_COLOR[tone]}-filled)`,
    backgroundColor: "light-dark(rgba(0,0,0,0.015), rgba(255,255,255,0.03))",
    boxShadow: "none"
  };
}

function SectionCard(props: {
  title: string;
  description: string;
  tone?: "info" | "success" | "warning" | "error";
  children: React.ReactNode;
}) {
  const { title, description, tone, children } = props;

  return (
    <Paper withBorder p="lg" style={tone ? toneStyle(tone) : undefined}>
      <Stack gap="lg">
        <Box>
          <Text fw={600}>{title}</Text>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </Box>
        {children}
      </Stack>
    </Paper>
  );
}

function parseTerminalPreferencesDraft(
  sshRows: SshUserMappingRow[],
  telnetPortText: string,
  fontSizeText: string
): TerminalDraftResult {
  const normalizedMapping: Record<string, string> = {};
  for (const row of sshRows) {
    const normalizedKey = row.kind.trim();
    const normalizedValue = row.username.trim();
    if (!normalizedKey && !normalizedValue) {
      continue;
    }
    if (!normalizedKey || !normalizedValue) {
      return {
        error: "Each mapping needs both a kind and a default username.",
        field: "ssh"
      };
    }
    if (normalizedKey in normalizedMapping) {
      return { error: `Duplicate kind "${normalizedKey}".`, field: "ssh" };
    }
    normalizedMapping[normalizedKey] = normalizedValue;
  }

  const telnetPort = Number(telnetPortText.trim());
  if (!Number.isInteger(telnetPort) || telnetPort <= 0 || telnetPort > 65535) {
    return { error: "Telnet port must be an integer between 1 and 65535.", field: "telnet" };
  }

  const fontSize = Number(fontSizeText.trim());
  if (
    !Number.isInteger(fontSize) ||
    fontSize < MIN_TERMINAL_FONT_SIZE ||
    fontSize > MAX_TERMINAL_FONT_SIZE
  ) {
    return {
      error: `Terminal font size must be an integer between ${MIN_TERMINAL_FONT_SIZE} and ${MAX_TERMINAL_FONT_SIZE}.`,
      field: "fontSize"
    };
  }

  return {
    error: null,
    field: null,
    preferences: { sshUserMapping: normalizedMapping, telnetPort, fontSize }
  };
}

function primarySettingsEndpoint(endpoints: EndpointConfig[]): EndpointConfig | null {
  return endpoints.find((endpoint) => endpoint.status === "connected") ?? endpoints[0] ?? null;
}

function captureSettingsEndpoint(
  endpoints: EndpointConfig[],
  captureEndpointId: string
): EndpointConfig | null {
  return endpoints.find((endpoint) => endpoint.id === captureEndpointId) ?? null;
}

function captureSettingsEndpointLabel(endpoint: EndpointConfig | null): string {
  return endpoint?.label || endpoint?.url || endpoint?.id || "selected endpoint";
}

function EndpointsSection() {
  const {
    defaultApiUrl,
    endpoints,
    onAddEndpoint,
    onExportEndpoints,
    onImportEndpoints,
    onLogout,
    onReconnectEndpoint,
    onRemoveEndpoint,
    onUpdateEndpoint,
    onSetEndpointSessionDuration
  } = useStandaloneSettings();
  const [requestedEndpointAction, setRequestedEndpointAction] = useState<EndpointUiAction | null>(
    null
  );

  useEffect(() => {
    const unsubscribe = subscribeEndpointUiAction((action) => {
      if (action.action === "add") {
        setRequestedEndpointAction(null);
        return;
      }
      setRequestedEndpointAction(action);
    });
    return unsubscribe;
  }, []);

  return (
    <Stack gap="lg">
      <Box>
        <Title order={4}>Endpoints</Title>
        <Text size="sm" c="dimmed">
          Configure every `clab-api-server` session that should appear in the explorer. The
          selected target endpoint is resolved per action from endpoint context or a picker.
        </Text>
      </Box>
      <EndpointManager
        defaultApiUrl={defaultApiUrl}
        endpoints={endpoints}
        healthStatsEnabled
        onAddEndpoint={onAddEndpoint}
        onExportEndpoints={onExportEndpoints}
        onImportEndpoints={onImportEndpoints}
        onReconnectEndpoint={onReconnectEndpoint}
        onRemoveEndpoint={onRemoveEndpoint}
        onUpdateEndpoint={onUpdateEndpoint}
        onSetEndpointSessionDuration={onSetEndpointSessionDuration}
        onRequestedActionHandled={() => setRequestedEndpointAction(null)}
        requestedAction={requestedEndpointAction}
      />
      <Box>
        <Button
          variant="outline"
          color="red"
          leftSection={<IconLogout size={20} />}
          onClick={onLogout}
          data-testid="standalone-settings-logout"
        >
          Disconnect Sessions
        </Button>
      </Box>
    </Stack>
  );
}

function TerminalSection() {
  const { terminalPreferences, onSaveTerminalPreferences } = useStandaloneSettings();
  const [sshRows, setSshRows] = useState<SshUserMappingRow[]>(() =>
    sshMappingToRows(terminalPreferences.sshUserMapping)
  );
  const [telnetPortText, setTelnetPortText] = useState(() =>
    String(terminalPreferences.telnetPort)
  );
  const [fontSizeText, setFontSizeText] = useState(() => String(terminalPreferences.fontSize));
  // Snapshot of the last value we synced from or saved to the host, so incoming
  // updates we caused ourselves don't clobber in-progress edits (or steal focus).
  const lastSyncedRef = useRef(serializeTerminalPreferences(terminalPreferences));

  useEffect(() => {
    const incoming = serializeTerminalPreferences(terminalPreferences);
    if (incoming === lastSyncedRef.current) {
      return;
    }
    lastSyncedRef.current = incoming;
    setSshRows(sshMappingToRows(terminalPreferences.sshUserMapping));
    setTelnetPortText(String(terminalPreferences.telnetPort));
    setFontSizeText(String(terminalPreferences.fontSize));
  }, [terminalPreferences]);

  const updateSshRow = useCallback((id: string, patch: Partial<Omit<SshUserMappingRow, "id">>) => {
    setSshRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);
  const removeSshRow = useCallback((id: string) => {
    setSshRows((rows) => rows.filter((row) => row.id !== id));
  }, []);
  const addSshRow = useCallback(() => {
    setSshRows((rows) => [...rows, { id: nextSshRowId(), kind: "", username: "" }]);
  }, []);

  const terminalDraft = useMemo(
    () => parseTerminalPreferencesDraft(sshRows, telnetPortText, fontSizeText),
    [fontSizeText, sshRows, telnetPortText]
  );
  const kindOptions = useMemo(() => schemaKinds(), []);
  const usedKinds = useMemo(
    () => new Set(sshRows.map((row) => row.kind.trim()).filter(Boolean)),
    [sshRows]
  );

  useEffect(() => {
    if (terminalDraft.error !== null) {
      return;
    }
    const serialized = serializeTerminalPreferences(terminalDraft.preferences);
    if (serialized === lastSyncedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      lastSyncedRef.current = serialized;
      onSaveTerminalPreferences(terminalDraft.preferences);
    }, 400);
    return () => clearTimeout(timer);
  }, [onSaveTerminalPreferences, terminalDraft]);

  return (
    <Stack gap="lg">
      <Box>
        <Title order={4}>Terminal</Title>
        <Text size="sm" c="dimmed">
          Configure standalone defaults for SSH username resolution, telnet access, and terminal
          font sizing.
        </Text>
      </Box>
      <Stack gap="lg">
        <Box>
          <Text size="sm" fw={600}>
            Telnet port
          </Text>
          <Text
            size="xs"
            c={terminalDraft.field === "telnet" ? "red" : "dimmed"}
            style={{ display: "block", marginTop: 2, marginBottom: 8 }}
          >
            {terminalDraft.field === "telnet"
              ? terminalDraft.error
              : "Default telnet port used by standalone terminal actions."}
          </Text>
          <TextInput
            type="number"
            value={telnetPortText}
            onChange={(event) => setTelnetPortText(event.currentTarget.value)}
            size="sm"
            error={terminalDraft.field === "telnet"}
            w={220}
            min={0}
            max={65535}
            step={1}
            aria-label="Telnet port"
            data-testid="standalone-settings-telnet-port"
          />
        </Box>
        <Box>
          <Text size="sm" fw={600}>
            Terminal font size
          </Text>
          <Text
            size="xs"
            c={terminalDraft.field === "fontSize" ? "red" : "dimmed"}
            style={{ display: "block", marginTop: 2, marginBottom: 8 }}
          >
            {terminalDraft.field === "fontSize"
              ? terminalDraft.error
              : `Global size applied to all terminals (${MIN_TERMINAL_FONT_SIZE}-${MAX_TERMINAL_FONT_SIZE}). Use Alt+Up, Alt+Down, Alt+0 in a terminal to adjust.`}
          </Text>
          <TextInput
            type="number"
            value={fontSizeText}
            onChange={(event) => setFontSizeText(event.currentTarget.value)}
            size="sm"
            error={terminalDraft.field === "fontSize"}
            w={220}
            min={MIN_TERMINAL_FONT_SIZE}
            max={MAX_TERMINAL_FONT_SIZE}
            step={1}
            aria-label="Terminal font size"
            data-testid="standalone-settings-font-size"
          />
        </Box>
        <Box data-testid="standalone-settings-ssh-mapping">
          <Text size="sm" fw={600} mb={4}>
            SSH User Mapping
          </Text>
          <Text size="sm" c="dimmed" mb="sm">
            Map container kinds to the default SSH username used when opening terminals.
          </Text>
          <Stack gap="xs">
            {sshRows.length === 0 ? (
              <Text size="sm" c="dimmed">
                No mappings yet. Add one to override the default SSH username per kind.
              </Text>
            ) : (
              sshRows.map((row) => (
                <Group key={row.id} gap="xs" align="flex-end" wrap="nowrap">
                  <Autocomplete
                    data={kindOptions.filter(
                      (kind) => kind === row.kind.trim() || !usedKinds.has(kind)
                    )}
                    value={row.kind}
                    onChange={(value) => updateSshRow(row.id, { kind: value })}
                    size="sm"
                    style={{ flex: 1 }}
                    label="Kind"
                    data-testid="standalone-settings-ssh-kind"
                  />
                  <TextInput
                    label="Default Username"
                    value={row.username}
                    onChange={(event) => updateSshRow(row.id, { username: event.currentTarget.value })}
                    size="sm"
                    style={{ flex: 1 }}
                    data-testid="standalone-settings-ssh-username"
                  />
                  <Tooltip label="Remove mapping">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => removeSshRow(row.id)}
                      aria-label="Remove mapping"
                      data-testid="standalone-settings-ssh-remove"
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))
            )}
          </Stack>
          {terminalDraft.field === "ssh" ? (
            <Text size="xs" c="red" style={{ display: "block", marginTop: 8 }}>
              {terminalDraft.error}
            </Text>
          ) : null}
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconPlus size={18} />}
            onClick={addSshRow}
            mt="sm"
            data-testid="standalone-settings-ssh-add"
          >
            Add Mapping
          </Button>
        </Box>
      </Stack>
    </Stack>
  );
}

function CaptureSection() {
  const { endpoints } = useStandaloneSettings();
  const [captureEndpointId, setCaptureEndpointId] = useState("");
  const [capturePreferences, setCapturePreferences] = useState<CapturePreferences>(() =>
    loadCapturePreferences()
  );
  const [captureSessionHostname, setCaptureSessionHostname] = useState(
    () => getSessionHostnameOverride() ?? ""
  );
  const [captureStatus, setCaptureStatus] = useState<EdgeSharkStatusResponse | null>(null);
  const [captureStatusLoading, setCaptureStatusLoading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureActionLoading, setCaptureActionLoading] = useState<"install" | "uninstall" | null>(
    null
  );

  const primaryEndpoint = primarySettingsEndpoint(endpoints);
  const captureEndpoint = captureSettingsEndpoint(endpoints, captureEndpointId);
  const captureEndpointLabel = captureSettingsEndpointLabel(captureEndpoint);

  useEffect(() => {
    const selectedStillExists = endpoints.some((endpoint) => endpoint.id === captureEndpointId);
    if (selectedStillExists) {
      return;
    }
    setCaptureEndpointId(primaryEndpoint?.id ?? "");
  }, [captureEndpointId, endpoints, primaryEndpoint?.id]);

  const refreshCaptureStatus = useCallback(async () => {
    if (!captureEndpoint?.id) {
      setCaptureStatus(null);
      setCaptureError(null);
      setCaptureStatusLoading(false);
      return;
    }
    setCaptureStatusLoading(true);
    setCaptureError(null);
    setCaptureStatus(null);
    try {
      const status = await fetchEdgeSharkStatus(captureEndpoint.id);
      setCaptureStatus(status);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
    } finally {
      setCaptureStatusLoading(false);
    }
  }, [captureEndpoint?.id]);

  useEffect(() => {
    setCapturePreferences(loadCapturePreferences(captureEndpoint?.id));
    setCaptureSessionHostname(getSessionHostnameOverride(captureEndpoint?.id) ?? "");
    void refreshCaptureStatus();
  }, [captureEndpoint?.id, refreshCaptureStatus]);

  const handlePreferredCaptureActionChange = useCallback(
    (nextAction: string) => {
      if (!nextAction) {
        return;
      }
      const persisted = persistCapturePreferences(
        { ...capturePreferences, preferredAction: nextAction as CapturePreferredAction },
        captureEndpoint?.id
      );
      setCapturePreferences(persisted);
    },
    [captureEndpoint?.id, capturePreferences]
  );

  const applyCaptureSessionHostname = useCallback(() => {
    const next = setSessionHostnameOverride(captureSessionHostname, captureEndpoint?.id);
    setCaptureSessionHostname(next ?? "");
  }, [captureEndpoint?.id, captureSessionHostname]);

  const clearCaptureSessionHostname = useCallback(() => {
    setSessionHostnameOverride(undefined, captureEndpoint?.id);
    setCaptureSessionHostname("");
  }, [captureEndpoint?.id]);

  const runCaptureAction = (action: "install" | "uninstall") => {
    setCaptureActionLoading(action);
    setCaptureError(null);
    const operation = action === "install" ? installEdgeShark : uninstallEdgeShark;
    void operation(captureEndpoint?.id)
      .then(() => refreshCaptureStatus())
      .catch((error) => setCaptureError(error instanceof Error ? error.message : String(error)))
      .finally(() => setCaptureActionLoading(null));
  };

  return (
    <Stack gap="lg">
      <Box>
        <Title order={4}>Capture</Title>
        <Text size="sm" c="dimmed">
          Manage Edgeshark availability for packet capture and Wireshark noVNC sessions.
        </Text>
      </Box>
      <SectionCard
        title="Edgeshark"
        description="Install or uninstall Edgeshark on the selected endpoint host."
        tone={captureEndpoint && captureStatus?.running ? "success" : "warning"}
      >
        {captureError ? (
          <Alert color="red" variant="outline">
            {captureError}
          </Alert>
        ) : null}
        <Select
          label="Endpoint"
          value={captureEndpointId}
          onChange={(value) => setCaptureEndpointId(value ?? "")}
          disabled={endpoints.length === 0}
          description="Capture status/actions and defaults are scoped to this endpoint."
          data-testid="standalone-settings-capture-endpoint"
          data={
            endpoints.length === 0
              ? [{ value: "", label: "No endpoints configured" }]
              : endpoints.map((endpoint) => ({
                  value: endpoint.id,
                  label: `${endpoint.label} (${endpoint.status})`
                }))
          }
        />
        <TextInput
          label="Status"
          value={formatCaptureStatus(
            Boolean(captureEndpoint),
            captureStatusLoading,
            captureStatus,
            captureEndpointLabel
          )}
          readOnly
          data-testid="standalone-settings-capture-status"
        />
        <Group gap="sm" wrap="wrap">
          <Button
            variant="default"
            leftSection={<IconRefresh size={20} />}
            onClick={() => {
              void refreshCaptureStatus();
            }}
            disabled={!captureEndpoint || captureStatusLoading || captureActionLoading !== null}
            data-testid="standalone-settings-capture-refresh"
          >
            Refresh
          </Button>
          <Button
            variant="default"
            leftSection={<IconDownload size={20} />}
            onClick={() => runCaptureAction("install")}
            disabled={!captureEndpoint || captureStatusLoading || captureActionLoading !== null}
            data-testid="standalone-settings-capture-install"
          >
            Install
          </Button>
          <Button
            variant="outline"
            color="yellow"
            leftSection={<IconUpload size={20} />}
            onClick={() => runCaptureAction("uninstall")}
            disabled={!captureEndpoint || captureStatusLoading || captureActionLoading !== null}
            data-testid="standalone-settings-capture-uninstall"
          >
            Uninstall
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Capture defaults (image, pull policy, packetflix host/port) are controlled on the API
          server via environment variables.
        </Text>
      </SectionCard>
      <SectionCard
        title="Capture Defaults"
        description="Set per-endpoint defaults for generic capture commands and optional session hostname override."
        tone="info"
      >
        <SegmentedControl
          value={capturePreferences.preferredAction}
          onChange={handlePreferredCaptureActionChange}
          disabled={!captureEndpoint}
          style={{ alignSelf: "flex-start" }}
          data={[
            {
              value: "wireshark-vnc",
              label: (
                <span data-testid="standalone-settings-capture-default-vnc">Wireshark VNC</span>
              )
            },
            {
              value: "edgeshark",
              label: (
                <span data-testid="standalone-settings-capture-default-edgeshark">Edgeshark</span>
              )
            }
          ]}
        />
        <TextInput
          label="Session Hostname Override"
          value={captureSessionHostname}
          onChange={(event) => setCaptureSessionHostname(event.currentTarget.value)}
          placeholder="IPv4, IPv6, or DNS hostname"
          description="Used for packetflix URI generation on the selected endpoint in this browser session only."
          data-testid="standalone-settings-capture-session-hostname"
        />
        <Group gap="sm" wrap="wrap">
          <Button
            variant="default"
            onClick={applyCaptureSessionHostname}
            disabled={!captureEndpoint}
            data-testid="standalone-settings-capture-session-hostname-apply"
          >
            Apply Session Hostname
          </Button>
          <Button
            variant="outline"
            color="yellow"
            onClick={clearCaptureSessionHostname}
            disabled={!captureEndpoint}
            data-testid="standalone-settings-capture-session-hostname-clear"
          >
            Clear Override
          </Button>
        </Group>
      </SectionCard>
    </Stack>
  );
}

/**
 * Settings sections contributed to clab-ui's unified Settings modal. Endpoints
 * and Capture are hidden in the browser (pages) sandbox where they don't apply.
 */
export function standaloneSettingsSections(): CustomSettingsSection[] {
  const hidden = new Set<string>(
    isPagesRuntimeMode() ? ["app-endpoints", "app-capture"] : []
  );
  const sections: CustomSettingsSection[] = [
    { id: "app-endpoints", label: "Endpoints", group: SETTINGS_GROUP, render: () => <EndpointsSection /> },
    { id: "app-terminal", label: "Terminal", group: "TopoViewer", render: () => <TerminalSection /> },
    { id: "app-capture", label: "Capture", group: SETTINGS_GROUP, render: () => <CaptureSection /> }
  ];
  return sections.filter((section) => !hidden.has(section.id));
}
