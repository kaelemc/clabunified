import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import {
  IconArrowsLeftRight,
  IconCpu,
  IconDatabase,
  IconDownload,
  IconGauge,
  IconLock,
  IconPencil,
  IconRefresh,
  IconTag,
  IconTrash,
  IconUpload,
  IconUser
} from "@tabler/icons-react";

import { ENDPOINT_EXPORT_FILENAME } from "../endpointTransfer";
import {
  fetchEndpointHealthMetrics,
  formatEndpointHealthPercent,
  formatEndpointHealthUsedTotal,
  type EndpointHealthMetrics
} from "../endpointHealth";
import type { EndpointUiAction } from "../endpointActions";
import {
  endpointStatusHint,
  endpointStatusLabel,
  endpointStatusSeverity
} from "../endpointStatus";
import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  endpointSessionDurationLabel,
  isValidEndpointSessionDuration,
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration
} from "../stores/endpointStore";

interface EndpointManagerProps {
  defaultApiUrl: string;
  endpoints: EndpointConfig[];
  externalError?: string | null;
  healthStatsEnabled?: boolean;
  mode?: "initial" | "manage";
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints?: () => string;
  onImportEndpoints?: (content: string) => EndpointImportResult | Promise<EndpointImportResult>;
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
  onRequestedActionHandled?: () => void;
  requestedAction?: EndpointUiAction | null;
  onSetEndpointSessionDuration?: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
}

type EndpointHealthState =
  | { status: "loading" }
  | { status: "ready"; metrics: EndpointHealthMetrics }
  | { status: "error"; message: string };

function readEndpointImportFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.position = "fixed";
    input.style.left = "-9999px";

    let settled = false;
    const cleanup = (file: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      input.remove();
      resolve(file);
    };
    const handleChange = () => cleanup(input.files?.[0] ?? null);
    const handleCancel = () => cleanup(null);

    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function downloadEndpointExport(content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = ENDPOINT_EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

function formatEndpointImportResult(result: EndpointImportResult): string {
  if (result.total === 0) {
    return "No endpoint profiles were found in the import file.";
  }

  const parts = [
    result.added ? `${result.added} added` : null,
    result.updated ? `${result.updated} updated` : null,
    result.unchanged ? `${result.unchanged} unchanged` : null,
    result.duplicates ? `${result.duplicates} duplicate ${result.duplicates === 1 ? "entry" : "entries"} merged` : null
  ].filter((value): value is string => value !== null);

  return `Imported ${result.total} endpoint ${result.total === 1 ? "profile" : "profiles"}${
    parts.length > 0 ? `: ${parts.join(", ")}` : ""
  }.`;
}

function endpointStatusColor(status: EndpointConfig["status"]): string {
  const severity = endpointStatusSeverity(status);
  if (severity === "success") {
    return "var(--mantine-color-green-6)";
  }
  if (severity === "warning") {
    return "var(--mantine-color-yellow-6)";
  }
  if (severity === "error") {
    return "var(--mantine-color-red-6)";
  }
  return "var(--mantine-color-blue-6)";
}

function severityColor(severity: "success" | "info" | "warning" | "error"): string {
  switch (severity) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    case "success":
      return "green";
    default:
      return "blue";
  }
}

function addEndpointButtonLabel(busyKey: string | null, mode: "initial" | "manage"): string {
  if (busyKey === "add") {
    return "Adding...";
  }
  return mode === "initial" ? "Add Endpoint" : "Add";
}

function endpointActionButtonLabel(
  endpoint: EndpointConfig | null | undefined,
  busyKey: string | null,
  action: "edit" | "reconnect" | "remove"
): string {
  const defaultLabels = {
    edit: "Save",
    reconnect: "Reconnect",
    remove: "Remove"
  };
  if (!endpoint) {
    return defaultLabels[action];
  }

  const busyLabels = {
    edit: "Saving...",
    reconnect: "Reconnecting...",
    remove: "Removing..."
  };
  return busyKey === `${action}:${endpoint.id}` ? busyLabels[action] : defaultLabels[action];
}

function endpointAddDescription(mode: "initial" | "manage"): string {
  if (mode === "initial") {
    return "Authenticate against a clab-api-server to start or restore the standalone session.";
  }
  return "Add another clab-api-server and it will appear as its own explorer root.";
}

function showManagedEndpoints(mode: "initial" | "manage", endpointCount: number): boolean {
  return mode === "manage" && endpointCount > 0;
}

function EndpointHealthMetric(props: {
  detail: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Group gap={8} align="center" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
      <Box style={{ color: "var(--mantine-color-dimmed)", display: "inline-flex", flexShrink: 0 }}>
        {props.icon}
      </Box>
      <Box style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed" style={{ display: "block" }}>
          {props.label}
        </Text>
        <Text size="sm" fw={600} truncate>
          {props.value}
        </Text>
        <Text size="xs" c="dimmed" truncate style={{ display: "block" }}>
          {props.detail}
        </Text>
      </Box>
    </Group>
  );
}

function EndpointHealthReady(props: { metrics: EndpointHealthMetrics }) {
  const { cpu, mem, disk } = props.metrics.metrics;
  const diskDetail = `${formatEndpointHealthUsedTotal(disk?.usedDisk, disk?.totalDisk)}${
    disk?.path ? ` on ${disk.path}` : ""
  }`;

  return (
    <Group gap={12} align="flex-start" grow wrap="wrap">
      <EndpointHealthMetric
        icon={<IconGauge size={18} />}
        label="CPU"
        value={formatEndpointHealthPercent(cpu?.usagePercent)}
        detail={cpu?.numCPU ? `${cpu.numCPU} cores` : "cores n/a"}
      />
      <EndpointHealthMetric
        icon={<IconCpu size={18} />}
        label="Memory"
        value={formatEndpointHealthPercent(mem?.usagePercent)}
        detail={formatEndpointHealthUsedTotal(mem?.usedMem, mem?.totalMem)}
      />
      <EndpointHealthMetric
        icon={<IconDatabase size={18} />}
        label="Disk"
        value={formatEndpointHealthPercent(disk?.usagePercent)}
        detail={diskDetail}
      />
    </Group>
  );
}

function EndpointHealthStats(props: {
  endpoint: EndpointConfig;
  state?: EndpointHealthState;
}) {
  const { endpoint, state } = props;

  if (endpoint.status !== "connected") {
    return (
      <Text size="xs" c="dimmed" style={{ display: "block" }}>
        Reconnect to view health stats.
      </Text>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <Group gap={8} align="center" wrap="nowrap">
        <Loader size={14} />
        <Text size="xs" c="dimmed">
          Loading health stats...
        </Text>
      </Group>
    );
  }

  if (state.status === "error") {
    return (
      <Text size="xs" c="yellow" style={{ display: "block" }}>
        Health stats unavailable.
      </Text>
    );
  }

  return <EndpointHealthReady metrics={state.metrics} />;
}

function EndpointStatusPill(props: { status: EndpointConfig["status"] }) {
  const { status } = props;
  const color = endpointStatusColor(status);

  return (
    <Box
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 9,
        paddingRight: 9,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: "var(--mantine-color-body)",
        color
      }}
    >
      <Box
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0
        }}
      />
      <Text size="xs" fw={700} style={{ color: "inherit" }}>
        {endpointStatusLabel(status)}
      </Text>
    </Box>
  );
}

function endpointSessionDurationDraft(
  drafts: Record<string, EndpointSessionDuration>,
  endpoint: EndpointConfig
): EndpointSessionDuration {
  return drafts[endpoint.id] ?? endpoint.sessionDuration;
}

function endpointDurationHasChanges(
  drafts: Record<string, EndpointSessionDuration>,
  endpoint: EndpointConfig
): boolean {
  return endpointSessionDurationDraft(drafts, endpoint).trim() !== endpoint.sessionDuration;
}

function ManagedEndpointList(props: {
  busyKey: string | null;
  endpointHealth: Record<string, EndpointHealthState>;
  endpoints: EndpointConfig[];
  healthStatsEnabled: boolean;
  onDraftChange: (endpointId: string, nextValue: EndpointSessionDuration) => void;
  onEdit: (endpoint: EndpointConfig) => void;
  onReconnect: (endpoint: EndpointConfig) => void;
  onRemove: (endpoint: EndpointConfig) => void;
  onSetEndpointSessionDuration?: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
  sessionDurationDrafts: Record<string, EndpointSessionDuration>;
}) {
  return (
    <Stack gap={10}>
      {props.endpoints.map((endpoint) => {
        const durationDraft = endpointSessionDurationDraft(props.sessionDurationDrafts, endpoint);
        const durationValid = isValidEndpointSessionDuration(durationDraft);
        const saveDurationDisabled =
          props.busyKey !== null ||
          !props.onSetEndpointSessionDuration ||
          !durationValid ||
          !endpointDurationHasChanges(props.sessionDurationDrafts, endpoint);

        return (
          <Paper
            key={endpoint.id}
            withBorder
            style={{
              padding: 14,
              background: "var(--mantine-color-body)"
            }}
          >
            <Stack gap={10}>
              <Group justify="space-between" align="flex-start" gap={8} wrap="nowrap">
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={8} align="center" wrap="nowrap">
                    <Text size="sm" fw={600} truncate>
                      {endpoint.label}
                    </Text>
                    <EndpointStatusPill status={endpoint.status} />
                  </Group>
                  <Text
                    size="xs"
                    c="dimmed"
                    truncate
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      display: "block"
                    }}
                  >
                    {endpoint.url}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ display: "block" }}>
                    {endpointStatusHint(endpoint.status)}
                  </Text>
                </Box>
                <Group gap={4} style={{ flexShrink: 0 }} wrap="nowrap">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => props.onEdit(endpoint)}
                    disabled={props.busyKey !== null}
                    style={{ minWidth: 0, paddingLeft: 8, paddingRight: 8 }}
                  >
                    <IconPencil size={18} />
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => props.onReconnect(endpoint)}
                    disabled={props.busyKey !== null}
                    style={{ minWidth: 0, paddingLeft: 8, paddingRight: 8 }}
                  >
                    <IconRefresh size={18} />
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    color="red"
                    onClick={() => props.onRemove(endpoint)}
                    disabled={props.busyKey !== null}
                    style={{ minWidth: 0, paddingLeft: 8, paddingRight: 8 }}
                  >
                    <IconTrash size={18} />
                  </Button>
                </Group>
              </Group>
              <Divider />
              {props.healthStatsEnabled ? (
                <>
                  <EndpointHealthStats endpoint={endpoint} state={props.endpointHealth[endpoint.id]} />
                  <Divider />
                </>
              ) : null}
              <Group gap={8} align="flex-start" wrap="wrap">
                <TextInput
                  label="Keep signed in"
                  size="sm"
                  value={durationDraft}
                  onChange={(event) => props.onDraftChange(endpoint.id, event.currentTarget.value)}
                  error={
                    Boolean(durationDraft.trim()) && !durationValid
                      ? "Use values like 24h, 36h, 7d, or 1h30m"
                      : undefined
                  }
                  description={durationValid ? "Examples: 24h, 36h, 7d, 1h30m" : undefined}
                  placeholder="24h"
                  disabled={props.busyKey !== null}
                  style={{ flex: 1 }}
                />
                <Button
                  variant="default"
                  disabled={saveDurationDisabled}
                  onClick={() =>
                    props.onSetEndpointSessionDuration?.(endpoint.id, durationDraft.trim())
                  }
                  style={{
                    height: 40,
                    paddingLeft: 20,
                    paddingRight: 20,
                    alignSelf: "flex-start"
                  }}
                >
                  Save
                </Button>
              </Group>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

function useEndpointSessionDurationDrafts(sortedEndpoints: EndpointConfig[]) {
  const [drafts, setDrafts] = useState<Record<string, EndpointSessionDuration>>({});

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, EndpointSessionDuration> = {};
      for (const endpoint of sortedEndpoints) {
        next[endpoint.id] = current[endpoint.id] ?? endpoint.sessionDuration;
      }
      return next;
    });
  }, [sortedEndpoints]);

  const handleDraftChange = useCallback((endpointId: string, nextValue: EndpointSessionDuration) => {
    setDrafts((current) => ({
      ...current,
      [endpointId]: nextValue
    }));
  }, []);

  return { drafts, handleDraftChange };
}

function useEndpointHealthState(
  connectedEndpointIds: string[],
  connectedEndpointKey: string,
  healthStatsEnabled: boolean
): Record<string, EndpointHealthState> {
  const [endpointHealth, setEndpointHealth] = useState<Record<string, EndpointHealthState>>({});

  useEffect(() => {
    if (!healthStatsEnabled || connectedEndpointIds.length === 0) {
      return;
    }

    const controller = new AbortController();
    setEndpointHealth((current) => {
      const next = { ...current };
      for (const endpointId of connectedEndpointIds) {
        next[endpointId] = { status: "loading" };
      }
      return next;
    });

    for (const endpointId of connectedEndpointIds) {
      void fetchEndpointHealthMetrics(endpointId, controller.signal)
        .then((metrics) => {
          setEndpointHealth((current) => ({
            ...current,
            [endpointId]: { status: "ready", metrics }
          }));
        })
        .catch((loadError) => {
          if (controller.signal.aborted) {
            return;
          }
          setEndpointHealth((current) => ({
            ...current,
            [endpointId]: {
              status: "error",
              message: loadError instanceof Error ? loadError.message : "Failed to load endpoint health stats"
            }
          }));
        });
    }

    return () => controller.abort();
  }, [connectedEndpointIds, connectedEndpointKey, healthStatsEnabled]);

  return endpointHealth;
}

function useRequestedEndpointActionDialog(input: {
  onRequestedActionHandled?: () => void;
  requestedAction?: EndpointUiAction | null;
  setError: (message: string | null) => void;
  setReconnectEndpointId: (endpointId: string | null) => void;
  setReconnectPassword: (password: string) => void;
  setReconnectUsername: (username: string) => void;
  setRemoveEndpointId: (endpointId: string | null) => void;
  sortedEndpoints: EndpointConfig[];
}): void {
  useEffect(() => {
    const {
      onRequestedActionHandled,
      requestedAction,
      setError,
      setReconnectEndpointId,
      setReconnectPassword,
      setReconnectUsername,
      setRemoveEndpointId,
      sortedEndpoints
    } = input;
    if (!requestedAction || requestedAction.action === "add") {
      return;
    }

    const endpoint = sortedEndpoints.find((entry) => entry.id === requestedAction.endpointId) ?? null;
    if (!endpoint) {
      onRequestedActionHandled?.();
      return;
    }

    setError(null);
    if (requestedAction.action === "reconnect") {
      setReconnectEndpointId(endpoint.id);
      setReconnectUsername(endpoint.username);
      setReconnectPassword("");
    } else {
      setRemoveEndpointId(endpoint.id);
    }
    onRequestedActionHandled?.();
  }, [
    input.onRequestedActionHandled,
    input.requestedAction,
    input.setError,
    input.setReconnectEndpointId,
    input.setReconnectPassword,
    input.setReconnectUsername,
    input.setRemoveEndpointId,
    input.sortedEndpoints
  ]);
}

function useAddEndpointForm(
  defaultApiUrl: string,
  busyKey: string | null,
  onAddEndpoint: EndpointManagerProps["onAddEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void
) {
  const [url, setUrl] = useState(defaultApiUrl);
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionDuration, setSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );

  useEffect(() => {
    if (!url.trim() && defaultApiUrl.trim()) {
      setUrl(defaultApiUrl);
    }
  }, [defaultApiUrl, url]);

  const sessionDurationValid = isValidEndpointSessionDuration(sessionDuration);
  const submitDisabled =
    busyKey !== null || !url.trim() || !username.trim() || !password.trim() || !sessionDurationValid;

  const submit = useCallback(async () => {
    if (submitDisabled) {
      return;
    }

    setBusyKey("add");
    setError(null);
    try {
      await onAddEndpoint({
        url: url.trim(),
        label: label.trim() || undefined,
        username: username.trim(),
        password,
        sessionDuration
      });
      setLabel("");
      setPassword("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    } finally {
      setBusyKey(null);
    }
  }, [label, onAddEndpoint, password, sessionDuration, setBusyKey, setError, submitDisabled, url, username]);

  return {
    label,
    password,
    sessionDuration,
    sessionDurationValid,
    setLabel,
    setPassword,
    setSessionDuration,
    setUrl,
    setUsername,
    submit,
    submitDisabled,
    url,
    username
  };
}

function useReconnectEndpointDialog(
  busyKey: string | null,
  onReconnectEndpoint: EndpointManagerProps["onReconnectEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void,
  sortedEndpoints: EndpointConfig[]
) {
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const endpoint = useMemo(
    () => sortedEndpoints.find((entry) => entry.id === endpointId) ?? null,
    [endpointId, sortedEndpoints]
  );
  const submitDisabled = busyKey !== null || !username.trim() || !password.trim();

  const open = useCallback((nextEndpoint: EndpointConfig) => {
    setEndpointId(nextEndpoint.id);
    setUsername(nextEndpoint.username);
    setPassword("");
    setError(null);
  }, [setError]);

  const submit = useCallback(async () => {
    if (!endpoint || submitDisabled) {
      return;
    }

    setBusyKey(`reconnect:${endpoint.id}`);
    setError(null);
    try {
      await onReconnectEndpoint({
        endpointId: endpoint.id,
        username: username.trim(),
        password
      });
      setEndpointId(null);
      setPassword("");
    } catch (reconnectError) {
      setError(reconnectError instanceof Error ? reconnectError.message : String(reconnectError));
    } finally {
      setBusyKey(null);
    }
  }, [endpoint, onReconnectEndpoint, password, setBusyKey, setError, submitDisabled, username]);

  return { endpoint, open, password, setEndpointId, setPassword, setUsername, submit, submitDisabled, username };
}

function useRemoveEndpointDialog(
  busyKey: string | null,
  onRemoveEndpoint: EndpointManagerProps["onRemoveEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void,
  sortedEndpoints: EndpointConfig[]
) {
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const endpoint = useMemo(
    () => sortedEndpoints.find((entry) => entry.id === endpointId) ?? null,
    [endpointId, sortedEndpoints]
  );

  const open = useCallback((nextEndpoint: EndpointConfig) => {
    setEndpointId(nextEndpoint.id);
    setError(null);
  }, [setError]);

  const submit = useCallback(async () => {
    if (!endpoint) {
      return;
    }

    setBusyKey(`remove:${endpoint.id}`);
    setError(null);
    try {
      await onRemoveEndpoint(endpoint.id);
      setEndpointId(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusyKey(null);
    }
  }, [endpoint, onRemoveEndpoint, setBusyKey, setError]);

  return { endpoint, open, setEndpointId, submitDisabled: busyKey !== null, submit };
}

function useEditEndpointDialog(
  busyKey: string | null,
  onUpdateEndpoint: EndpointManagerProps["onUpdateEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void,
  sortedEndpoints: EndpointConfig[]
) {
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [sessionDuration, setSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );
  const endpoint = useMemo(
    () => sortedEndpoints.find((entry) => entry.id === endpointId) ?? null,
    [endpointId, sortedEndpoints]
  );
  const sessionDurationValid = isValidEndpointSessionDuration(sessionDuration);
  const hasChanges = endpoint
    ? url.trim() !== endpoint.url ||
      label.trim() !== endpoint.label ||
      username.trim() !== endpoint.username ||
      sessionDuration.trim() !== endpoint.sessionDuration
    : false;
  const submitDisabled =
    busyKey !== null ||
    !url.trim() ||
    !label.trim() ||
    !username.trim() ||
    !sessionDurationValid ||
    !hasChanges;

  const open = useCallback((nextEndpoint: EndpointConfig) => {
    setEndpointId(nextEndpoint.id);
    setUrl(nextEndpoint.url);
    setLabel(nextEndpoint.label);
    setUsername(nextEndpoint.username);
    setSessionDuration(nextEndpoint.sessionDuration);
    setError(null);
  }, [setError]);

  const submit = useCallback(async () => {
    if (!endpoint || submitDisabled) {
      return;
    }

    setBusyKey(`edit:${endpoint.id}`);
    setError(null);
    try {
      await onUpdateEndpoint({
        endpointId: endpoint.id,
        label: label.trim(),
        sessionDuration: sessionDuration.trim(),
        url: url.trim(),
        username: username.trim()
      });
      setEndpointId(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusyKey(null);
    }
  }, [endpoint, label, onUpdateEndpoint, sessionDuration, setBusyKey, setError, submitDisabled, url, username]);

  return {
    endpoint,
    label,
    open,
    sessionDuration,
    sessionDurationValid,
    setEndpointId,
    setLabel,
    setSessionDuration,
    setUrl,
    setUsername,
    submit,
    submitDisabled,
    url,
    username
  };
}

export function EndpointManager({
  defaultApiUrl,
  endpoints,
  externalError,
  healthStatsEnabled = false,
  mode = "manage",
  onAddEndpoint,
  onExportEndpoints,
  onImportEndpoints,
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint,
  onRequestedActionHandled,
  requestedAction,
  onSetEndpointSessionDuration
}: EndpointManagerProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sortedEndpoints = useMemo(
    () => [...endpoints].sort((left, right) => left.label.localeCompare(right.label)),
    [endpoints]
  );
  const connectedEndpointIds = useMemo(
    () => sortedEndpoints.filter((endpoint) => endpoint.status === "connected").map((endpoint) => endpoint.id),
    [sortedEndpoints]
  );
  const connectedEndpointKey = connectedEndpointIds.join("|");
  const endpointHealth = useEndpointHealthState(
    connectedEndpointIds,
    connectedEndpointKey,
    healthStatsEnabled
  );
  const {
    drafts: endpointSessionDurationDrafts,
    handleDraftChange: handleEndpointDurationDraftChange
  } = useEndpointSessionDurationDrafts(sortedEndpoints);
  const visibleError = error ?? externalError ?? null;
  const addForm = useAddEndpointForm(defaultApiUrl, busyKey, onAddEndpoint, setBusyKey, setError);
  const reconnectDialog = useReconnectEndpointDialog(
    busyKey,
    onReconnectEndpoint,
    setBusyKey,
    setError,
    sortedEndpoints
  );
  const removeDialog = useRemoveEndpointDialog(
    busyKey,
    onRemoveEndpoint,
    setBusyKey,
    setError,
    sortedEndpoints
  );
  const editDialog = useEditEndpointDialog(
    busyKey,
    onUpdateEndpoint,
    setBusyKey,
    setError,
    sortedEndpoints
  );

  useRequestedEndpointActionDialog({
    onRequestedActionHandled,
    requestedAction,
    setError,
    setReconnectEndpointId: reconnectDialog.setEndpointId,
    setReconnectPassword: reconnectDialog.setPassword,
    setReconnectUsername: reconnectDialog.setUsername,
    setRemoveEndpointId: removeDialog.setEndpointId,
    sortedEndpoints
  });

  const handleExportEndpoints = useCallback(() => {
    if (!onExportEndpoints) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      downloadEndpointExport(onExportEndpoints());
      setNotice(`Exported ${sortedEndpoints.length} endpoint ${sortedEndpoints.length === 1 ? "profile" : "profiles"}.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }, [onExportEndpoints, sortedEndpoints.length]);

  const handleImportEndpoints = useCallback(async () => {
    if (!onImportEndpoints || busyKey !== null) {
      return;
    }

    setBusyKey("import");
    setError(null);
    setNotice(null);
    try {
      const file = await readEndpointImportFile();
      if (!file) {
        return;
      }
      const result = await onImportEndpoints(await file.text());
      setNotice(formatEndpointImportResult(result));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, onImportEndpoints]);

  return (
    <Stack gap={20}>
      {onImportEndpoints || onExportEndpoints ? (
        <Group gap={8} justify="flex-end" wrap="wrap">
          {onImportEndpoints ? (
            <Button
              variant="default"
              leftSection={<IconUpload size={20} />}
              onClick={() => {
                void handleImportEndpoints();
              }}
              disabled={busyKey !== null}
              data-testid="standalone-endpoints-import"
            >
              {busyKey === "import" ? "Importing..." : "Import"}
            </Button>
          ) : null}
          {onExportEndpoints ? (
            <Button
              variant="default"
              leftSection={<IconDownload size={20} />}
              onClick={handleExportEndpoints}
              disabled={busyKey !== null || sortedEndpoints.length === 0}
              data-testid="standalone-endpoints-export"
            >
              Export
            </Button>
          ) : null}
        </Group>
      ) : null}

      {showManagedEndpoints(mode, sortedEndpoints.length) ? (
        <ManagedEndpointList
          busyKey={busyKey}
          endpointHealth={endpointHealth}
          endpoints={sortedEndpoints}
          healthStatsEnabled={healthStatsEnabled}
          onDraftChange={handleEndpointDurationDraftChange}
          onEdit={editDialog.open}
          onReconnect={reconnectDialog.open}
          onRemove={removeDialog.open}
          onSetEndpointSessionDuration={onSetEndpointSessionDuration}
          sessionDurationDrafts={endpointSessionDurationDrafts}
        />
      ) : null}

      <Paper
        withBorder
        style={{
          padding: 24,
          background: "var(--mantine-color-body)"
        }}
      >
        <Stack gap="md">
          <Box>
            <Text size="md" fw={600}>
              Add Endpoint
            </Text>
            <Text size="sm" c="dimmed">
              {endpointAddDescription(mode)}
            </Text>
          </Box>

          {visibleError ? (
            <Alert color="red" variant="outline">
              {visibleError}
            </Alert>
          ) : null}
          {notice ? (
            <Alert color="green" variant="outline">
              {notice}
            </Alert>
          ) : null}

          <Stack gap={12}>
            <TextInput
              label="API Endpoint"
              value={addForm.url}
              onChange={(event) => addForm.setUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              placeholder="https://localhost:8090"
              leftSection={<IconArrowsLeftRight size={18} />}
            />
            <TextInput
              label="Label"
              value={addForm.label}
              onChange={(event) => addForm.setLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              placeholder="Optional friendly name"
              leftSection={<IconTag size={18} />}
            />
            <TextInput
              label="Username"
              value={addForm.username}
              onChange={(event) => addForm.setUsername(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              leftSection={<IconUser size={18} />}
            />
            <TextInput
              label="Password"
              type="password"
              value={addForm.password}
              onChange={(event) => addForm.setPassword(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              leftSection={<IconLock size={18} />}
            />
            <TextInput
              label="Keep me signed in"
              value={addForm.sessionDuration}
              onChange={(event) => addForm.setSessionDuration(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              placeholder="24h"
              error={
                Boolean(addForm.sessionDuration.trim()) && !addForm.sessionDurationValid
                  ? "Use values like 24h, 36h, 7d, or 1h30m"
                  : undefined
              }
              description={
                addForm.sessionDurationValid ? "Examples: 24h, 36h, 7d, 1h30m" : undefined
              }
            />
          </Stack>

          <Button
            variant="filled"
            onClick={addForm.submit}
            disabled={addForm.submitDisabled}
            style={{
              alignSelf: "flex-start"
            }}
          >
            {addEndpointButtonLabel(busyKey, mode)}
          </Button>
        </Stack>
      </Paper>

      <Modal
        opened={Boolean(editDialog.endpoint)}
        onClose={() => editDialog.setEndpointId(null)}
        size="md"
        title="Edit Endpoint"
      >
        <Stack gap="md">
          <TextInput
            label="Label"
            value={editDialog.label}
            onChange={(event) => editDialog.setLabel(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || editDialog.submitDisabled) {
                return;
              }
              event.preventDefault();
              void editDialog.submit();
            }}
          />
          <TextInput
            label="API Endpoint"
            value={editDialog.url}
            onChange={(event) => editDialog.setUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || editDialog.submitDisabled) {
                return;
              }
              event.preventDefault();
              void editDialog.submit();
            }}
          />
          <TextInput
            label="Username"
            value={editDialog.username}
            onChange={(event) => editDialog.setUsername(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || editDialog.submitDisabled) {
                return;
              }
              event.preventDefault();
              void editDialog.submit();
            }}
          />
          <TextInput
            label="Keep signed in"
            value={editDialog.sessionDuration}
            onChange={(event) => editDialog.setSessionDuration(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || editDialog.submitDisabled) {
                return;
              }
              event.preventDefault();
              void editDialog.submit();
            }}
            placeholder="24h"
            error={
              Boolean(editDialog.sessionDuration.trim()) && !editDialog.sessionDurationValid
                ? "Use values like 24h, 36h, 7d, or 1h30m"
                : undefined
            }
            description={
              editDialog.sessionDurationValid ? "Examples: 24h, 36h, 7d, 1h30m" : undefined
            }
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => editDialog.setEndpointId(null)}>Cancel</Button>
            <Button
              onClick={editDialog.submit}
              variant="filled"
              disabled={editDialog.submitDisabled}
            >
              {endpointActionButtonLabel(editDialog.endpoint, busyKey, "edit")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(reconnectDialog.endpoint)}
        onClose={() => reconnectDialog.setEndpointId(null)}
        size="md"
        title="Reconnect Endpoint"
      >
        <Stack gap="md">
          {reconnectDialog.endpoint ? (
            <>
              <Text size="sm" c="dimmed">
                {`Reconnect "${reconnectDialog.endpoint.label}" to restore access for this endpoint.`}
              </Text>
              <Alert
                color={severityColor(endpointStatusSeverity(reconnectDialog.endpoint.status))}
                variant="outline"
              >
                {endpointStatusHint(reconnectDialog.endpoint.status)}
              </Alert>
              <Text size="sm" c="dimmed">
                Keep signed in: {endpointSessionDurationLabel(reconnectDialog.endpoint.sessionDuration)}
              </Text>
            </>
          ) : null}
          <TextInput
            label="Username"
            value={reconnectDialog.username}
            onChange={(event) => reconnectDialog.setUsername(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || reconnectDialog.submitDisabled) {
                return;
              }
              event.preventDefault();
              void reconnectDialog.submit();
            }}
          />
          <TextInput
            label="Password"
            type="password"
            value={reconnectDialog.password}
            onChange={(event) => reconnectDialog.setPassword(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || reconnectDialog.submitDisabled) {
                return;
              }
              event.preventDefault();
              void reconnectDialog.submit();
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => reconnectDialog.setEndpointId(null)}>Cancel</Button>
            <Button
              onClick={reconnectDialog.submit}
              variant="filled"
              disabled={reconnectDialog.submitDisabled}
            >
              {endpointActionButtonLabel(reconnectDialog.endpoint, busyKey, "reconnect")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(removeDialog.endpoint)}
        onClose={() => removeDialog.setEndpointId(null)}
        size="sm"
        title="Remove Endpoint"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {`Remove "${removeDialog.endpoint?.label ?? "endpoint"}" from this standalone session?`}
          </Text>
          <Divider />
          <Text size="sm">
            Labs, topology sessions, and event streams for this endpoint will be closed.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => removeDialog.setEndpointId(null)}>Cancel</Button>
            <Button
              onClick={removeDialog.submit}
              color="red"
              variant="filled"
              disabled={removeDialog.submitDisabled}
            >
              {endpointActionButtonLabel(removeDialog.endpoint, busyKey, "remove")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
