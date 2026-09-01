import React, { useCallback, useState } from "react";
import { Alert, Box, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { IconArrowsLeftRight, IconLock } from "@tabler/icons-react";
import {
  endpointStatusHint,
  endpointStatusLabel,
  endpointStatusSeverity,
  endpointNeedsReconnect
} from "../endpointStatus";
import { publicAssetUrl } from "../publicAssetUrl";

import {
  endpointSessionDurationLabel,
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration
} from "../stores/endpointStore";
import { EndpointManager } from "./EndpointManager";

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

interface LoginPageProps {
  defaultApiUrl: string;
  endpoints: EndpointConfig[];
  error: string | null;
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints: () => string;
  onImportEndpoints: (content: string) => EndpointImportResult | Promise<EndpointImportResult>;
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
}

function ReconnectCard({
  endpoint,
  onReconnect
}: {
  endpoint: EndpointConfig;
  onReconnect: (input: { endpointId: string; password: string; username: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState(endpoint.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReconnect = useCallback(async () => {
    if (!password.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onReconnect({
        endpointId: endpoint.id,
        password,
        username: username.trim()
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [endpoint.id, onReconnect, password, username]);

  const endpointUrl = endpoint.url.replace(/^https?:\/\//i, "");

  return (
    <Paper
      withBorder
      style={{
        padding: 16,
        borderColor: "#3c3c3c",
        background: "rgba(255,255,255,0.02)"
      }}
    >
      <Stack gap={12}>
        <Group gap={8} align="center" wrap="nowrap">
          <IconArrowsLeftRight size={18} style={{ color: "#858585" }} />
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {endpoint.label}
            </Text>
            <Text
              size="xs"
              truncate
              style={{ color: "#858585", fontFamily: "monospace", fontSize: "0.75rem" }}
            >
              {endpointUrl} &middot; {endpoint.username}
            </Text>
            <Text size="xs" style={{ color: "#858585", display: "block" }}>
              Keep signed in: {endpointSessionDurationLabel(endpoint.sessionDuration)}
            </Text>
          </Box>
        </Group>

        {error && (
          <Alert color="red" variant="outline" style={{ paddingTop: 2, paddingBottom: 2 }}>
            {error}
          </Alert>
        )}

        <Alert
          color={severityColor(endpointStatusSeverity(endpoint.status))}
          variant="outline"
          style={{ paddingTop: 2, paddingBottom: 2 }}
        >
          {endpointStatusLabel(endpoint.status)}. {endpointStatusHint(endpoint.status)}
        </Alert>

        <Stack gap={8}>
          <TextInput
            size="sm"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
        </Stack>

        <Group gap={8} align="flex-start" wrap="nowrap">
          <TextInput
            size="sm"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleReconnect();
              }
            }}
            style={{ flex: 1 }}
            leftSection={<IconLock size={16} />}
          />
          <Button
            variant="filled"
            onClick={handleReconnect}
            disabled={busy || !username.trim() || !password.trim() || !endpointNeedsReconnect(endpoint.status)}
            style={{ flexShrink: 0 }}
          >
            {busy ? "Connecting..." : "Connect"}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function LoginPage({
  defaultApiUrl,
  endpoints,
  error,
  onAddEndpoint,
  onExportEndpoints,
  onImportEndpoints,
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint
}: LoginPageProps) {
  const disconnectedEndpoints = endpoints.filter((ep) => ep.status !== "connected");
  const hasPersistedEndpoints = disconnectedEndpoints.length > 0;
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Box
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        paddingLeft: 16,
        paddingRight: 16,
        color: "#cccccc",
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(60, 190, 239, 0.08) 0%, transparent 60%), #1e1e1e"
      }}
    >
      <Paper
        shadow="xl"
        style={{
          padding: 32,
          width: "min(520px, 100%)",
          background: "#252526",
          color: "#cccccc",
          border: "1px solid #3c3c3c",
          borderRadius: 12
        }}
      >
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 24
          }}
        >
          <Box
            component="object"
            type="image/svg+xml"
            data={publicAssetUrl("containerlab-animated.svg")}
            aria-label="Containerlab Logo"
            style={{
              width: 200,
              height: 154,
              pointerEvents: "none"
            }}
          />
          <Text size="sm" style={{ color: "#9d9d9d", marginTop: 8, textAlign: "center" }}>
            {hasPersistedEndpoints
              ? "Enter your password to reconnect to your endpoints."
              : "Connect one or more `clab-api-server` endpoints to manage labs in the browser."}
          </Text>
        </Box>

        {hasPersistedEndpoints && !showAddForm ? (
          <Stack gap="md">
            {error ? <Alert color="red" variant="outline">{error}</Alert> : null}
            {disconnectedEndpoints.map((endpoint) => (
              <ReconnectCard
                key={endpoint.id}
                endpoint={endpoint}
                onReconnect={onReconnectEndpoint}
              />
            ))}
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setShowAddForm(true)}
              style={{ alignSelf: "center", color: "#858585" }}
            >
              Manage saved endpoints
            </Button>
          </Stack>
        ) : (
          <Stack gap="md">
            <EndpointManager
              defaultApiUrl={defaultApiUrl}
              endpoints={endpoints}
              externalError={error}
              mode={hasPersistedEndpoints ? "manage" : "initial"}
              onAddEndpoint={onAddEndpoint}
              onExportEndpoints={onExportEndpoints}
              onImportEndpoints={onImportEndpoints}
              onReconnectEndpoint={onReconnectEndpoint}
              onRemoveEndpoint={onRemoveEndpoint}
              onUpdateEndpoint={onUpdateEndpoint}
            />
            {hasPersistedEndpoints && (
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setShowAddForm(false)}
                style={{ alignSelf: "center", color: "#858585" }}
              >
                Back to reconnect
              </Button>
            )}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
