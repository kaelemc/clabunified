import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput
} from "@mantine/core";

import {
  fetchNodeLogs,
  fetchVersionCheck,
  fetchVersionInfo,
  inspectAllLabs,
  inspectLab,
  normalizeNetemFields,
  resetNetem,
  setNetem,
  type InspectContainerInfo,
  type InspectLabResponse,
  type InspectAllLabsResponse,
  type NetemFields,
  type RuntimeTargetRequest
} from "../runtimeApi";
import { findLabStateForTopology } from "../standaloneHostShared";
import type { ContainerState, InterfaceNetemPatch, LabState } from "../stores/labStore";
import { useLabStore } from "../stores/labStore";
import { runtimeUiActions, useRuntimeUiStore } from "../stores/runtimeUiStore";
import {
  DEFAULT_TOPOLOGY_FILE_NAME,
  normalizeTopologyFileNameForCreate,
  setCloneRepoDialogRequester,
  setCreateTopologyDialogRequester,
  setEndpointSelectionDialogRequester,
  setRuntimeConfirmDialogRequester,
  setRuntimeOptionSelectionDialogRequester,
  setRuntimeTextInputDialogRequester,
  setTopologyFileNameDialogRequester,
  type ActiveCloneRepoDialogRequest,
  type ActiveCreateTopologyDialogRequest,
  type ActiveEndpointSelectionDialogRequest,
  type ActiveRuntimeConfirmDialogRequest,
  type ActiveRuntimeOptionSelectionDialogRequest,
  type ActiveRuntimeTextInputDialogRequest,
  type ActiveTopologyFileNameDialogRequest,
  type CloneRepoDialogResult,
  type CloneRepoDialogTarget,
  type CreateTopologyDialogResult,
  type EndpointSelectionOption
} from "../runtimeActionFlows";
import { FileEditorDialog } from "./FileEditorDialog";

interface InspectGroup {
  labName: string;
  containers: InspectContainerInfo[];
}

interface NetemInterfaceRow {
  name: string;
  label: string;
}

interface TopologyFileNameDialogState {
  request: ActiveTopologyFileNameDialogRequest;
  resolve: (value: string | undefined) => void;
}

interface EndpointSelectionDialogState {
  request: ActiveEndpointSelectionDialogRequest;
  resolve: (value: string | undefined) => void;
}

interface CreateTopologyDialogState {
  request: ActiveCreateTopologyDialogRequest;
  resolve: (value: CreateTopologyDialogResult | undefined) => void;
}

interface CloneRepoDialogState {
  request: ActiveCloneRepoDialogRequest;
  resolve: (value: CloneRepoDialogResult | undefined) => void;
}

interface RuntimeConfirmDialogState {
  request: ActiveRuntimeConfirmDialogRequest;
  resolve: (value: boolean) => void;
}

interface RuntimeTextInputDialogState {
  request: ActiveRuntimeTextInputDialogRequest;
  resolve: (value: string | undefined) => void;
}

interface RuntimeOptionSelectionDialogState {
  request: ActiveRuntimeOptionSelectionDialogRequest;
  resolve: (value: string | undefined) => void;
}

const DEFAULT_NETEM_FIELDS: NetemFields = {
  delay: "0ms",
  jitter: "0ms",
  loss: "0%",
  rate: "0",
  corruption: "0"
};

function normalizeInspectGroups(
  requestTitle: string,
  requestMode: "all" | "lab",
  payload: InspectAllLabsResponse | InspectLabResponse
): InspectGroup[] {
  if (requestMode === "all") {
    return Object.entries(payload as InspectAllLabsResponse)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([labName, containers]) => ({ labName, containers }));
  }

  const containers = payload as InspectLabResponse;
  const resolvedLabName = containers[0]?.labName || requestTitle;
  return [{ labName: resolvedLabName, containers }];
}

function filterInspectGroups(groups: InspectGroup[], query: string): InspectGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return groups;
  }

  return groups
    .map((group) => ({
      labName: group.labName,
      containers: group.containers.filter((container) => {
        const haystack = [
          container.name,
          container.kind,
          container.image,
          container.state,
          container.status,
          container.owner,
          container.ipv4Address,
          container.ipv6Address
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    }))
    .filter((group) => group.containers.length > 0);
}

function inspectStateColor(state: string): "default" | "error" | "success" | "warning" {
  const normalized = state.trim().toLowerCase();
  if (!normalized) {
    return "default";
  }
  if (
    normalized.includes("exit") ||
    normalized.includes("stop") ||
    normalized.includes("dead") ||
    normalized.includes("fail") ||
    normalized.includes("down")
  ) {
    return "error";
  }
  if (normalized.includes("pause") || normalized.includes("restart")) {
    return "warning";
  }
  if (normalized.includes("run") || normalized.includes("up") || normalized.includes("healthy")) {
    return "success";
  }
  return "default";
}

function scoreNodeMatch(labName: string, container: ContainerState, requestedNodeName: string): number {
  const normalizedRequested = requestedNodeName.trim().toLowerCase();
  if (!normalizedRequested) {
    return 0;
  }
  const normalizedContainerName = container.name.trim().toLowerCase();
  if (normalizedContainerName === normalizedRequested) {
    return 100;
  }

  const normalizedNodeName = container.nodeName.trim().toLowerCase();
  if (normalizedNodeName === normalizedRequested) {
    return 90;
  }
  if (normalizedNodeName.startsWith(`${normalizedRequested}-`)) {
    return 80;
  }

  const shortName = normalizedContainerName.startsWith(`clab-${labName.toLowerCase()}-`)
    ? normalizedContainerName.slice(`clab-${labName.toLowerCase()}-`.length)
    : normalizedContainerName;
  if (shortName === normalizedRequested) {
    return 70;
  }
  if (shortName.startsWith(`${normalizedRequested}-`)) {
    return 60;
  }

  return 0;
}

function findRuntimeContainer(
  labs: Map<string, LabState>,
  input: {
    endpointId?: string;
    nodeName: string;
    topologyRef?: RuntimeTargetRequest["topologyRef"];
  }
): ContainerState | undefined {
  const topologyHint = input.topologyRef?.yamlPath
    ? {
        topologyId: input.topologyRef.topologyId,
        yamlPath: input.topologyRef.yamlPath,
        labName: input.topologyRef.labName,
        endpointId: input.endpointId
      }
    : undefined;
  const lab = findLabStateForTopology(topologyHint, labs);
  const candidateLabs = lab ? [lab] : [...labs.values()];

  let bestContainer: ContainerState | undefined;
  let bestScore = 0;
  for (const candidateLab of candidateLabs) {
    for (const container of candidateLab.containers.values()) {
      const score = scoreNodeMatch(candidateLab.name, container, input.nodeName);
      if (score > bestScore) {
        bestContainer = container;
        bestScore = score;
      }
    }
  }

  return bestScore > 0 ? bestContainer : undefined;
}

function sortedInterfaceRows(container: ContainerState | undefined): NetemInterfaceRow[] {
  if (!container) {
    return [];
  }
  return [...container.interfaces.values()]
    .filter((iface) => iface.name !== "lo")
    .map((iface) => ({
      name: iface.name,
      label: iface.alias && iface.alias !== iface.name ? `${iface.alias} (${iface.name})` : iface.name
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function netemFieldsFromRuntimeContainer(
  container: ContainerState | undefined
): Record<string, NetemFields> {
  const result: Record<string, NetemFields> = {};
  if (!container) {
    return result;
  }
  for (const iface of container.interfaces.values()) {
    if (iface.name === "lo") {
      continue;
    }
    result[iface.name] = {
      delay: iface.netemDelay ?? "",
      jitter: iface.netemJitter ?? "",
      loss: iface.netemLoss ?? "",
      rate: iface.netemRate ?? "",
      corruption: iface.netemCorruption ?? ""
    };
  }
  return result;
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim().replace(/%$/, "").trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function netemPatchFromFields(fields: NetemFields): InterfaceNetemPatch {
  return {
    netemDelay: fields.delay.trim() || DEFAULT_NETEM_FIELDS.delay,
    netemJitter: fields.jitter.trim() || DEFAULT_NETEM_FIELDS.jitter,
    netemLoss: fields.loss.trim() || DEFAULT_NETEM_FIELDS.loss,
    netemRate: fields.rate.trim() || DEFAULT_NETEM_FIELDS.rate,
    netemCorruption: fields.corruption.trim() || DEFAULT_NETEM_FIELDS.corruption
  };
}

function mergeInterfaceFields(
  interfaceNames: string[],
  current: Record<string, NetemFields>
): Record<string, NetemFields> {
  const next: Record<string, NetemFields> = {};
  for (const interfaceName of interfaceNames) {
    next[interfaceName] = normalizeNetemFields(current[interfaceName]);
  }
  return next;
}

function countLogLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function modalSize(muiMaxWidth: "xs" | "sm" | "md" | "lg"): string {
  switch (muiMaxWidth) {
    case "xs":
      return "420px";
    case "sm":
      return "560px";
    case "md":
      return "760px";
    case "lg":
      return "1100px";
  }
}

function alertColor(severity: "error" | "warning" | "info" | "success"): string {
  switch (severity) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    case "success":
      return "green";
    case "info":
      return "blue";
  }
}

function badgeColorFromInspectState(state: "default" | "error" | "success" | "warning"): string {
  switch (state) {
    case "error":
      return "red";
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "default":
      return "gray";
  }
}

function InspectDialogView(props: {
  closeInspect: () => void;
  filteredInspectGroups: InspectGroup[];
  inspectError: string | null;
  inspectFilter: string;
  inspectLoading: boolean;
  inspectRequest: ReturnType<typeof useRuntimeUiStore.getState>["inspectRequest"];
  setInspectFilter: (value: string) => void;
}) {
  return (
    <Modal
      opened={props.inspectRequest !== null}
      onClose={props.closeInspect}
      title={props.inspectRequest?.title ?? "Inspect"}
      size={modalSize("lg")}
      centered
    >
      <Stack gap="md">
        <TextInput
          label="Filter"
          value={props.inspectFilter}
          onChange={(event) => props.setInspectFilter(event.currentTarget.value)}
          size="sm"
        />
        {props.inspectLoading ? <Text>Loading inspect data...</Text> : null}
        {props.inspectError ? <Alert color="red">{props.inspectError}</Alert> : null}
        {!props.inspectLoading && !props.inspectError && props.filteredInspectGroups.length === 0 ? (
          <Alert color="blue">No matching running lab data.</Alert>
        ) : null}
        {props.filteredInspectGroups.map((group) => (
          <Box key={group.labName}>
            <Text fw={700} mb="xs">
              {group.labName}
            </Text>
            <Paper withBorder>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Kind</Table.Th>
                    <Table.Th>State</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>IPv4</Table.Th>
                    <Table.Th>IPv6</Table.Th>
                    <Table.Th>Owner</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {group.containers.map((container) => (
                    <Table.Tr key={`${group.labName}:${container.name}`}>
                      <Table.Td>{container.name}</Table.Td>
                      <Table.Td>{container.kind}</Table.Td>
                      <Table.Td>
                        <Badge
                          size="sm"
                          color={badgeColorFromInspectState(inspectStateColor(container.state))}
                          variant={container.state ? "filled" : "outline"}
                        >
                          {container.state || "unknown"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{container.status}</Table.Td>
                      <Table.Td>{container.ipv4Address || "-"}</Table.Td>
                      <Table.Td>{container.ipv6Address || "-"}</Table.Td>
                      <Table.Td>{container.owner || "-"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          </Box>
        ))}
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={props.closeInspect}>
          Close
        </Button>
      </Group>
    </Modal>
  );
}

function LogsDialogView(props: {
  closeLogs: () => void;
  exportLogs: () => void;
  fetchLogs: (tailValue: string, showLoading: boolean) => Promise<void>;
  filteredLogsContent: string;
  logsError: string | null;
  logsFilter: string;
  logsFollow: boolean;
  logsLoading: boolean;
  logsPaperRef: React.RefObject<HTMLDivElement | null>;
  logsRequest: ReturnType<typeof useRuntimeUiStore.getState>["logsRequest"];
  logsTail: string;
  setLogsFilter: (value: string) => void;
  setLogsFollow: (value: boolean) => void;
  setLogsTail: (value: string) => void;
  totalLogLines: number;
  visibleLogLines: number;
}) {
  const logLineSummary = props.logsFilter.trim()
    ? `Showing ${props.visibleLogLines}/${props.totalLogLines} lines`
    : `${props.totalLogLines} lines`;

  return (
    <Modal
      opened={props.logsRequest !== null}
      onClose={props.closeLogs}
      title={props.logsRequest?.title ?? "Node Logs"}
      size={modalSize("lg")}
      centered
    >
      <Stack gap="md">
        <Group gap="xs" wrap="wrap" align="flex-end">
          <TextInput
            label="Tail"
            value={props.logsTail}
            onChange={(event) => props.setLogsTail(event.currentTarget.value)}
            size="sm"
            style={{ maxWidth: 200 }}
          />
          <TextInput
            label="Find"
            value={props.logsFilter}
            onChange={(event) => props.setLogsFilter(event.currentTarget.value)}
            size="sm"
            style={{ minWidth: 240 }}
          />
          <Button
            variant="default"
            onClick={() => void props.fetchLogs(props.logsTail, true)}
            disabled={props.logsLoading}
          >
            Refresh
          </Button>
          <Button variant="default" onClick={props.exportLogs} disabled={!props.filteredLogsContent}>
            Export
          </Button>
          <Switch
            checked={props.logsFollow}
            onChange={(event) => props.setLogsFollow(event.currentTarget.checked)}
            label="Follow"
          />
        </Group>
        {props.logsLoading ? <Text>Loading logs...</Text> : null}
        {props.logsError ? <Alert color="red">{props.logsError}</Alert> : null}
        <Text size="sm" c="dimmed">
          {logLineSummary}
        </Text>
        <Paper
          ref={props.logsPaperRef}
          withBorder
          style={{
            backgroundColor: "var(--mantine-color-body)",
            maxHeight: 480,
            overflow: "auto",
            padding: 16
          }}
        >
          <Text
            component="pre"
            style={{
              fontFamily: "monospace",
              fontSize: "0.8rem",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {props.filteredLogsContent || (props.logsFilter.trim() ? "No matching log lines." : "No logs returned.")}
          </Text>
        </Paper>
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={props.closeLogs}>
          Close
        </Button>
      </Group>
    </Modal>
  );
}

function VersionDialogView(props: {
  versionCheck: string;
  versionError: string | null;
  versionInfo: string;
  versionLoading: boolean;
  versionOpen: boolean;
}) {
  return (
    <Modal
      opened={props.versionOpen}
      onClose={runtimeUiActions.closeVersion}
      title="Version Information"
      size={modalSize("md")}
      centered
    >
      <Stack gap="md">
        {props.versionLoading ? <Text>Loading version details...</Text> : null}
        {props.versionError ? <Alert color="red">{props.versionError}</Alert> : null}
        {props.versionInfo ? (
          <Textarea
            label="Containerlab Version"
            value={props.versionInfo}
            autosize
            minRows={6}
            readOnly
          />
        ) : null}
        {props.versionCheck ? (
          <Textarea
            label="Update Check"
            value={props.versionCheck}
            autosize
            minRows={3}
            readOnly
          />
        ) : null}
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={runtimeUiActions.closeVersion}>
          Close
        </Button>
      </Group>
    </Modal>
  );
}

function NetemDialogView(props: {
  applyNetem: (interfaceName: string) => Promise<void>;
  clearNetem: (interfaceName: string) => Promise<void>;
  closeNetem: () => void;
  netemContainerName: string;
  netemError: string | null;
  netemFieldsByInterface: Record<string, NetemFields>;
  netemInterfaceRows: NetemInterfaceRow[];
  netemLoading: boolean;
  netemPendingInterface: string | null;
  netemRequest: ReturnType<typeof useRuntimeUiStore.getState>["netemRequest"];
  setNetemFieldsByInterface: React.Dispatch<React.SetStateAction<Record<string, NetemFields>>>;
}) {
  const interfaceRows = props.netemInterfaceRows;

  return (
    <Modal
      opened={props.netemRequest !== null}
      onClose={props.closeNetem}
      title={props.netemRequest?.title ?? "Manage Impairments"}
      size={modalSize("lg")}
      centered
    >
      <Stack gap="md">
        {props.netemLoading ? <Text>Loading impairment state...</Text> : null}
        {props.netemError ? <Alert color="red">{props.netemError}</Alert> : null}
        {props.netemContainerName ? (
          <Text size="sm" c="dimmed">
            Container: {props.netemContainerName}
          </Text>
        ) : null}
        <Paper withBorder>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Interface</Table.Th>
                <Table.Th>Delay</Table.Th>
                <Table.Th>Jitter</Table.Th>
                <Table.Th>Loss</Table.Th>
                <Table.Th>Rate</Table.Th>
                <Table.Th>Corruption</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {interfaceRows.map((row) => {
                const fields = normalizeNetemFields(props.netemFieldsByInterface[row.name]);
                return (
                  <Table.Tr key={row.name}>
                    <Table.Td>{row.label}</Table.Td>
                    {(["delay", "jitter", "loss", "rate", "corruption"] as Array<keyof NetemFields>).map((fieldKey) => (
                      <Table.Td key={`${row.name}:${fieldKey}`}>
                        <TextInput
                          size="xs"
                          value={fields[fieldKey]}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            props.setNetemFieldsByInterface((current) => ({
                              ...current,
                              [row.name]: {
                                ...normalizeNetemFields(current[row.name]),
                                [fieldKey]: value
                              }
                            }));
                          }}
                        />
                      </Table.Td>
                    ))}
                    <Table.Td style={{ textAlign: "right" }}>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => void props.applyNetem(row.name)}
                          disabled={props.netemPendingInterface === row.name}
                        >
                          Apply
                        </Button>
                        <Button
                          size="xs"
                          color="yellow"
                          variant="outline"
                          onClick={() => void props.clearNetem(row.name)}
                          disabled={props.netemPendingInterface === row.name}
                        >
                          Reset
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
        {!props.netemLoading && interfaceRows.length === 0 ? (
          <Alert color="blue">No runtime interface data is available for this node.</Alert>
        ) : null}
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={props.closeNetem}>
          Close
        </Button>
      </Group>
    </Modal>
  );
}

function EndpointOptionSelect(props: {
  labelId?: string;
  label: string;
  onChange: (value: string) => void;
  options: EndpointSelectionOption[];
  value: string;
}) {
  const descriptions = new Map(props.options.map((option) => [option.value, option.description]));
  return (
    <Select
      label={props.label}
      value={props.value}
      onChange={(value) => props.onChange(value ?? "")}
      data={props.options.map((option) => ({ value: option.value, label: option.label }))}
      size="sm"
      comboboxProps={{ withinPortal: true, zIndex: 3100 }}
      renderOption={({ option }) => {
        const description = descriptions.get(option.value);
        return (
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="sm">{option.label}</Text>
            {description ? (
              <Text size="xs" c="dimmed">
                {description}
              </Text>
            ) : null}
          </Stack>
        );
      }}
    />
  );
}

function CloneRepoEndpointField(props: {
  endpointOptions: EndpointSelectionOption[];
  setValue: (value: string) => void;
  value: string;
}) {
  if (props.endpointOptions.length <= 1) {
    return (
      <Text size="sm">
        Endpoint: {props.endpointOptions[0]?.label ?? ""}
      </Text>
    );
  }
  return (
    <EndpointOptionSelect
      labelId="clone-repo-endpoint-label"
      label="Endpoint"
      options={props.endpointOptions}
      value={props.value}
      onChange={props.setValue}
    />
  );
}

function CloneRepoSourceField(props: {
  mode: "url" | "popular";
  popularOptions: EndpointSelectionOption[];
  popularValue: string;
  setPopularValue: (value: string) => void;
  setSourceUrlInput: (value: string) => void;
  sourceUrlInput: string;
  submitCloneRepoDialog: () => void;
}) {
  if (props.mode === "popular") {
    return (
      <EndpointOptionSelect
        labelId="clone-repo-popular-label"
        label="Popular Lab"
        options={props.popularOptions}
        value={props.popularValue}
        onChange={props.setPopularValue}
      />
    );
  }
  return (
    <TextInput
      data-autofocus
      label="Repository or topology URL"
      value={props.sourceUrlInput}
      onChange={(event) => props.setSourceUrlInput(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          props.submitCloneRepoDialog();
        }
      }}
    />
  );
}

function CloneRepoDialogView(props: {
  cloneRepoCanSubmit: boolean;
  cloneRepoDialog: CloneRepoDialogState | null;
  cloneRepoEndpointValue: string;
  cloneRepoLabNameOverrideInput: string;
  cloneRepoMode: "url" | "popular";
  cloneRepoPopularValue: string;
  cloneRepoSourceUrlInput: string;
  cloneRepoTarget: CloneRepoDialogTarget;
  closeCloneRepoDialog: (value: CloneRepoDialogResult | undefined) => void;
  setCloneRepoEndpointValue: (value: string) => void;
  setCloneRepoLabNameOverrideInput: (value: string) => void;
  setCloneRepoMode: (value: "url" | "popular") => void;
  setCloneRepoPopularValue: (value: string) => void;
  setCloneRepoSourceUrlInput: (value: string) => void;
  setCloneRepoTarget: (value: CloneRepoDialogTarget) => void;
  submitCloneRepoDialog: () => void;
}) {
  const request = props.cloneRepoDialog?.request;
  return (
    <Modal
      opened={props.cloneRepoDialog !== null}
      onClose={() => props.closeCloneRepoDialog(undefined)}
      title={request?.title ?? "Clone Repository"}
      size={modalSize("sm")}
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {request?.message}
        </Text>
        <CloneRepoEndpointField
          endpointOptions={request?.endpointOptions ?? []}
          value={props.cloneRepoEndpointValue}
          setValue={props.setCloneRepoEndpointValue}
        />
        <Select
          label="Source"
          size="sm"
          value={props.cloneRepoMode}
          onChange={(value) => props.setCloneRepoMode((value ?? "url") as "url" | "popular")}
          comboboxProps={{ withinPortal: true, zIndex: 3100 }}
          data={[
            { value: "url", label: "Repository URL" },
            {
              value: "popular",
              label: "Popular Lab",
              disabled: (request?.popularOptions.length ?? 0) === 0
            }
          ]}
        />
        <Select
          label="Action"
          size="sm"
          value={props.cloneRepoTarget}
          onChange={(value) => props.setCloneRepoTarget((value ?? "deploy") as CloneRepoDialogTarget)}
          comboboxProps={{ withinPortal: true, zIndex: 3100 }}
          data={[
            { value: "deploy", label: "Deploy now" },
            { value: "undeployed", label: "Clone to undeployed labs" }
          ]}
        />
        <CloneRepoSourceField
          mode={props.cloneRepoMode}
          popularOptions={request?.popularOptions ?? []}
          popularValue={props.cloneRepoPopularValue}
          setPopularValue={props.setCloneRepoPopularValue}
          setSourceUrlInput={props.setCloneRepoSourceUrlInput}
          sourceUrlInput={props.cloneRepoSourceUrlInput}
          submitCloneRepoDialog={props.submitCloneRepoDialog}
        />
        <TextInput
          label="Lab name override (optional)"
          value={props.cloneRepoLabNameOverrideInput}
          onChange={(event) => props.setCloneRepoLabNameOverrideInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.submitCloneRepoDialog();
            }
          }}
        />
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeCloneRepoDialog(undefined)}>
          Cancel
        </Button>
        <Button onClick={props.submitCloneRepoDialog} disabled={!props.cloneRepoCanSubmit}>
          {request?.confirmLabel ?? "Deploy"}
        </Button>
      </Group>
    </Modal>
  );
}

function CreateTopologyDialogView(props: {
  closeCreateTopologyDialog: (value: CreateTopologyDialogResult | undefined) => void;
  createTopologyDialog: CreateTopologyDialogState | null;
  createTopologyEndpointIsValid: boolean;
  createTopologyEndpointValue: string;
  createTopologyFileNameInput: string;
  setCreateTopologyEndpointValue: (value: string) => void;
  setCreateTopologyFileNameInput: (value: string) => void;
  submitCreateTopologyDialog: () => void;
  trimmedCreateTopologyFileNameInput: string;
}) {
  const request = props.createTopologyDialog?.request;
  return (
    <Modal
      opened={props.createTopologyDialog !== null}
      onClose={() => props.closeCreateTopologyDialog(undefined)}
      title={request?.title ?? "Create Topology File"}
      size={modalSize("sm")}
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {request?.message}
        </Text>
        <CloneRepoEndpointField
          endpointOptions={request?.endpointOptions ?? []}
          value={props.createTopologyEndpointValue}
          setValue={props.setCreateTopologyEndpointValue}
        />
        <TextInput
          data-autofocus
          label="Topology file name"
          value={props.createTopologyFileNameInput}
          onChange={(event) => props.setCreateTopologyFileNameInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.submitCreateTopologyDialog();
            }
          }}
          description={`Example: ${DEFAULT_TOPOLOGY_FILE_NAME}`}
        />
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeCreateTopologyDialog(undefined)}>
          Cancel
        </Button>
        <Button
          onClick={props.submitCreateTopologyDialog}
          disabled={!props.createTopologyEndpointIsValid || !props.trimmedCreateTopologyFileNameInput}
        >
          {request?.confirmLabel ?? "Create"}
        </Button>
      </Group>
    </Modal>
  );
}

function TopologyFileNameDialogView(props: {
  closeTopologyFileNameDialog: (value: string | undefined) => void;
  setTopologyFileNameInput: (value: string) => void;
  submitTopologyFileNameDialog: () => void;
  topologyFileNameDialog: TopologyFileNameDialogState | null;
  topologyFileNameInput: string;
  trimmedTopologyFileNameInput: string;
}) {
  const request = props.topologyFileNameDialog?.request;
  return (
    <Modal
      opened={props.topologyFileNameDialog !== null}
      onClose={() => props.closeTopologyFileNameDialog(undefined)}
      title={request?.title ?? "Create Topology File"}
      size={modalSize("sm")}
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {request?.message}
        </Text>
        <TextInput
          data-autofocus
          label="Topology file name"
          value={props.topologyFileNameInput}
          onChange={(event) => props.setTopologyFileNameInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.submitTopologyFileNameDialog();
            }
          }}
          description={`Example: ${DEFAULT_TOPOLOGY_FILE_NAME}`}
        />
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeTopologyFileNameDialog(undefined)}>
          Cancel
        </Button>
        <Button
          onClick={props.submitTopologyFileNameDialog}
          disabled={!props.trimmedTopologyFileNameInput}
        >
          Create
        </Button>
      </Group>
    </Modal>
  );
}

function EndpointSelectionDialogView(props: {
  closeEndpointSelectionDialog: (value: string | undefined) => void;
  endpointSelectionDialog: EndpointSelectionDialogState | null;
  endpointSelectionIsValid: boolean;
  endpointSelectionValue: string;
  setEndpointSelectionValue: (value: string) => void;
  submitEndpointSelectionDialog: () => void;
}) {
  const request = props.endpointSelectionDialog?.request;
  return (
    <Modal
      opened={props.endpointSelectionDialog !== null}
      onClose={() => props.closeEndpointSelectionDialog(undefined)}
      title={request?.title ?? "Select Endpoint"}
      size={modalSize("sm")}
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {request?.message}
        </Text>
        <EndpointOptionSelect
          labelId="endpoint-selection-label"
          label="Endpoint"
          options={request?.options ?? []}
          value={props.endpointSelectionValue}
          onChange={props.setEndpointSelectionValue}
        />
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeEndpointSelectionDialog(undefined)}>
          Cancel
        </Button>
        <Button onClick={props.submitEndpointSelectionDialog} disabled={!props.endpointSelectionIsValid}>
          {request?.confirmLabel ?? "Continue"}
        </Button>
      </Group>
    </Modal>
  );
}

function runtimeConfirmButtonColor(
  severity: ActiveRuntimeConfirmDialogRequest["severity"] | undefined
): string {
  if (severity === "error") {
    return "red";
  }
  if (severity === "warning") {
    return "yellow";
  }
  return "blue";
}

function RuntimeConfirmDialogView(props: {
  closeRuntimeConfirmDialog: (value: boolean) => void;
  runtimeConfirmDialog: RuntimeConfirmDialogState | null;
}) {
  if (!props.runtimeConfirmDialog) {
    return null;
  }
  const request = props.runtimeConfirmDialog.request;
  const buttonColor = runtimeConfirmButtonColor(request.severity);

  return (
    <Modal
      opened
      onClose={() => props.closeRuntimeConfirmDialog(false)}
      title={request.title}
      size={modalSize("xs")}
      centered
    >
      <Text size="sm" style={{ whiteSpace: "pre-line" }}>
        {request.message}
      </Text>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeRuntimeConfirmDialog(false)}>
          {request.cancelLabel}
        </Button>
        <Button color={buttonColor} onClick={() => props.closeRuntimeConfirmDialog(true)}>
          {request.confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}

function RuntimeTextInputDialogView(props: {
  closeRuntimeTextInputDialog: (value: string | undefined) => void;
  runtimeTextInputDialog: RuntimeTextInputDialogState | null;
  runtimeTextInputValue: string;
  runtimeTextInputValueCanSubmit: boolean;
  setRuntimeTextInputValue: (value: string) => void;
  submitRuntimeTextInputDialog: () => void;
}) {
  if (!props.runtimeTextInputDialog) {
    return null;
  }
  const request = props.runtimeTextInputDialog.request;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!request.multiline && event.key === "Enter") {
      event.preventDefault();
      props.submitRuntimeTextInputDialog();
    }
  };

  return (
    <Modal
      opened
      onClose={() => props.closeRuntimeTextInputDialog(undefined)}
      title={request.title}
      size={modalSize("sm")}
      centered
    >
      <Stack gap="md">
        {request.message ? (
          <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-line" }}>
            {request.message}
          </Text>
        ) : null}
        {request.multiline ? (
          <Textarea
            data-autofocus
            label={request.label}
            value={props.runtimeTextInputValue}
            onChange={(event) => props.setRuntimeTextInputValue(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            description={request.helperText || undefined}
            autosize
            minRows={3}
          />
        ) : (
          <TextInput
            data-autofocus
            label={request.label}
            value={props.runtimeTextInputValue}
            onChange={(event) => props.setRuntimeTextInputValue(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            description={request.helperText || undefined}
          />
        )}
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeRuntimeTextInputDialog(undefined)}>
          {request.cancelLabel}
        </Button>
        <Button
          onClick={props.submitRuntimeTextInputDialog}
          disabled={!props.runtimeTextInputValueCanSubmit}
        >
          {request.confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}

function RuntimeOptionSelectionDialogView(props: {
  closeRuntimeOptionSelectionDialog: (value: string | undefined) => void;
  runtimeOptionSelectionDialog: RuntimeOptionSelectionDialogState | null;
  runtimeOptionSelectionIsValid: boolean;
  runtimeOptionSelectionValue: string;
  setRuntimeOptionSelectionValue: (value: string) => void;
  submitRuntimeOptionSelectionDialog: () => void;
}) {
  if (!props.runtimeOptionSelectionDialog) {
    return null;
  }
  const request = props.runtimeOptionSelectionDialog.request;

  return (
    <Modal
      opened
      onClose={() => props.closeRuntimeOptionSelectionDialog(undefined)}
      title={request.title}
      size={modalSize("sm")}
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-line" }}>
          {request.message}
        </Text>
        <EndpointOptionSelect
          labelId="runtime-option-selection-label"
          label={request.label}
          options={request.options}
          value={props.runtimeOptionSelectionValue}
          onChange={props.setRuntimeOptionSelectionValue}
        />
      </Stack>
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={() => props.closeRuntimeOptionSelectionDialog(undefined)}>
          {request.cancelLabel}
        </Button>
        <Button
          onClick={props.submitRuntimeOptionSelectionDialog}
          disabled={!props.runtimeOptionSelectionIsValid}
        >
          {request.confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}

function RuntimeSnackbarView(props: {
  closeSnackbar: () => void;
  snackbar: ReturnType<typeof useRuntimeUiStore.getState>["snackbar"];
}) {
  const { snackbar, closeSnackbar } = props;

  useEffect(() => {
    if (!snackbar.open) {
      return;
    }
    const timer = window.setTimeout(closeSnackbar, 5000);
    return () => window.clearTimeout(timer);
  }, [snackbar.open, snackbar.message, closeSnackbar]);

  if (!snackbar.open) {
    return null;
  }

  return (
    <Box
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 3200,
        width: "calc(100vw - 32px)",
        maxWidth: 560
      }}
    >
      <Alert
        color={alertColor(snackbar.severity)}
        variant="outline"
        withCloseButton
        onClose={closeSnackbar}
        styles={{
          root: { backgroundColor: "var(--mantine-color-body)", boxShadow: "var(--mantine-shadow-md)" },
          message: { whiteSpace: "pre-wrap", wordBreak: "break-word" }
        }}
      >
        {snackbar.message}
      </Alert>
    </Box>
  );
}

export function RuntimeActionDialogs() {
  const labs = useLabStore((state) => state.labs);
  const inspectRequest = useRuntimeUiStore((state) => state.inspectRequest);
  const logsRequest = useRuntimeUiStore((state) => state.logsRequest);
  const netemRequest = useRuntimeUiStore((state) => state.netemRequest);
  const snackbar = useRuntimeUiStore((state) => state.snackbar);
  const versionOpen = useRuntimeUiStore((state) => state.versionOpen);
  const closeInspect = useRuntimeUiStore((state) => state.closeInspect);
  const closeLogs = useRuntimeUiStore((state) => state.closeLogs);
  const closeNetem = useRuntimeUiStore((state) => state.closeNetem);
  const closeSnackbar = useRuntimeUiStore((state) => state.closeSnackbar);

  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectGroups, setInspectGroups] = useState<InspectGroup[]>([]);
  const [inspectFilter, setInspectFilter] = useState("");

  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsTail, setLogsTail] = useState("200");
  const [logsFollow, setLogsFollow] = useState(true);
  const [logsFilter, setLogsFilter] = useState("");
  const [logsContent, setLogsContent] = useState("");
  const logsFetchRequestIdRef = useRef(0);
  const logsPaperRef = useRef<HTMLDivElement | null>(null);

  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState("");
  const [versionCheck, setVersionCheck] = useState("");

  const [netemLoading, setNetemLoading] = useState(false);
  const [netemError, setNetemError] = useState<string | null>(null);
  const [netemContainerName, setNetemContainerName] = useState("");
  const [netemFieldsByInterface, setNetemFieldsByInterface] = useState<Record<string, NetemFields>>({});
  const [netemPendingInterface, setNetemPendingInterface] = useState<string | null>(null);
  const [topologyFileNameDialog, setTopologyFileNameDialog] = useState<TopologyFileNameDialogState | null>(null);
  const [topologyFileNameInput, setTopologyFileNameInput] = useState(DEFAULT_TOPOLOGY_FILE_NAME);
  const [endpointSelectionDialog, setEndpointSelectionDialog] = useState<EndpointSelectionDialogState | null>(null);
  const [endpointSelectionValue, setEndpointSelectionValue] = useState("");
  const [createTopologyDialog, setCreateTopologyDialog] = useState<CreateTopologyDialogState | null>(null);
  const [createTopologyEndpointValue, setCreateTopologyEndpointValue] = useState("");
  const [createTopologyFileNameInput, setCreateTopologyFileNameInput] = useState(DEFAULT_TOPOLOGY_FILE_NAME);
  const [cloneRepoDialog, setCloneRepoDialog] = useState<CloneRepoDialogState | null>(null);
  const [cloneRepoEndpointValue, setCloneRepoEndpointValue] = useState("");
  const [cloneRepoMode, setCloneRepoMode] = useState<"url" | "popular">("url");
  const [cloneRepoTarget, setCloneRepoTarget] = useState<CloneRepoDialogTarget>("deploy");
  const [cloneRepoSourceUrlInput, setCloneRepoSourceUrlInput] = useState(
    "https://github.com/srl-labs/srl-telemetry-lab"
  );
  const [cloneRepoPopularValue, setCloneRepoPopularValue] = useState("");
  const [cloneRepoLabNameOverrideInput, setCloneRepoLabNameOverrideInput] = useState("");
  const [runtimeConfirmDialog, setRuntimeConfirmDialog] = useState<RuntimeConfirmDialogState | null>(null);
  const [runtimeTextInputDialog, setRuntimeTextInputDialog] = useState<RuntimeTextInputDialogState | null>(null);
  const [runtimeTextInputValue, setRuntimeTextInputValue] = useState("");
  const [runtimeOptionSelectionDialog, setRuntimeOptionSelectionDialog] =
    useState<RuntimeOptionSelectionDialogState | null>(null);
  const [runtimeOptionSelectionValue, setRuntimeOptionSelectionValue] = useState("");
  const topologyFileNameDialogRef = useRef<TopologyFileNameDialogState | null>(null);
  const endpointSelectionDialogRef = useRef<EndpointSelectionDialogState | null>(null);
  const createTopologyDialogRef = useRef<CreateTopologyDialogState | null>(null);
  const cloneRepoDialogRef = useRef<CloneRepoDialogState | null>(null);
  const runtimeConfirmDialogRef = useRef<RuntimeConfirmDialogState | null>(null);
  const runtimeTextInputDialogRef = useRef<RuntimeTextInputDialogState | null>(null);
  const runtimeOptionSelectionDialogRef = useRef<RuntimeOptionSelectionDialogState | null>(null);

  const filteredInspectGroups = useMemo(
    () => filterInspectGroups(inspectGroups, inspectFilter),
    [inspectGroups, inspectFilter]
  );

  const filteredLogsContent = useMemo(() => {
    const normalizedFilter = logsFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return logsContent;
    }
    return logsContent
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes(normalizedFilter))
      .join("\n");
  }, [logsContent, logsFilter]);

  const totalLogLines = useMemo(() => countLogLines(logsContent), [logsContent]);
  const visibleLogLines = useMemo(() => countLogLines(filteredLogsContent), [filteredLogsContent]);

  const runtimeContainer = useMemo(() => {
    if (!netemRequest) {
      return undefined;
    }
    return findRuntimeContainer(labs, {
      endpointId: netemRequest.endpointId,
      topologyRef: netemRequest.topologyRef,
      nodeName: netemRequest.nodeName
    });
  }, [labs, netemRequest]);

  const netemInterfaceRows = useMemo(
    () => sortedInterfaceRows(runtimeContainer),
    [runtimeContainer]
  );
  const runtimeNetemFields = useMemo(
    () => netemFieldsFromRuntimeContainer(runtimeContainer),
    [runtimeContainer]
  );
  const trimmedTopologyFileNameInput = topologyFileNameInput.trim();
  const trimmedCreateTopologyFileNameInput = createTopologyFileNameInput.trim();
  const trimmedCloneRepoSourceUrlInput = cloneRepoSourceUrlInput.trim();
  const trimmedCloneRepoLabNameOverrideInput = cloneRepoLabNameOverrideInput.trim();
  const trimmedRuntimeTextInputValue = runtimeTextInputValue.trim();
  const runtimeTextInputValueCanSubmit = runtimeTextInputDialog
    ? runtimeTextInputDialog.request.allowEmpty || trimmedRuntimeTextInputValue.length > 0
    : false;
  const endpointSelectionIsValid = useMemo(
    () =>
      endpointSelectionDialog
        ? endpointSelectionDialog.request.options.some((option) => option.value === endpointSelectionValue)
        : false,
    [endpointSelectionDialog, endpointSelectionValue]
  );
  const createTopologyEndpointIsValid = useMemo(
    () =>
      createTopologyDialog
        ? createTopologyDialog.request.endpointOptions.some(
            (option) => option.value === createTopologyEndpointValue
          )
        : false,
    [createTopologyDialog, createTopologyEndpointValue]
  );
  const cloneRepoEndpointIsValid = useMemo(
    () =>
      cloneRepoDialog
        ? cloneRepoDialog.request.endpointOptions.some((option) => option.value === cloneRepoEndpointValue)
        : false,
    [cloneRepoDialog, cloneRepoEndpointValue]
  );
  const cloneRepoPopularIsValid = useMemo(
    () =>
      cloneRepoDialog
        ? cloneRepoDialog.request.popularOptions.some((option) => option.value === cloneRepoPopularValue)
        : false,
    [cloneRepoDialog, cloneRepoPopularValue]
  );
  const runtimeOptionSelectionIsValid = useMemo(
    () =>
      runtimeOptionSelectionDialog
        ? runtimeOptionSelectionDialog.request.options.some(
            (option) => option.value === runtimeOptionSelectionValue
          )
        : false,
    [runtimeOptionSelectionDialog, runtimeOptionSelectionValue]
  );
  let cloneRepoResolvedSourceUrl = trimmedCloneRepoSourceUrlInput;
  if (cloneRepoMode === "popular") {
    cloneRepoResolvedSourceUrl = cloneRepoPopularIsValid ? cloneRepoPopularValue : "";
  }
  const cloneRepoCanSubmit = cloneRepoEndpointIsValid && cloneRepoResolvedSourceUrl.length > 0;

  useEffect(() => {
    topologyFileNameDialogRef.current = topologyFileNameDialog;
  }, [topologyFileNameDialog]);

  useEffect(() => {
    endpointSelectionDialogRef.current = endpointSelectionDialog;
  }, [endpointSelectionDialog]);

  useEffect(() => {
    createTopologyDialogRef.current = createTopologyDialog;
  }, [createTopologyDialog]);

  useEffect(() => {
    cloneRepoDialogRef.current = cloneRepoDialog;
  }, [cloneRepoDialog]);

  useEffect(() => {
    runtimeConfirmDialogRef.current = runtimeConfirmDialog;
  }, [runtimeConfirmDialog]);

  useEffect(() => {
    runtimeTextInputDialogRef.current = runtimeTextInputDialog;
  }, [runtimeTextInputDialog]);

  useEffect(() => {
    runtimeOptionSelectionDialogRef.current = runtimeOptionSelectionDialog;
  }, [runtimeOptionSelectionDialog]);

  useEffect(() => {
    const cleanup = setTopologyFileNameDialogRequester((request) =>
      new Promise((resolve) => {
        setTopologyFileNameDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      topologyFileNameDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    const cleanup = setEndpointSelectionDialogRequester((request) =>
      new Promise((resolve) => {
        setEndpointSelectionDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      endpointSelectionDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    const cleanup = setCreateTopologyDialogRequester((request) =>
      new Promise((resolve) => {
        setCreateTopologyDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      createTopologyDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    const cleanup = setCloneRepoDialogRequester((request) =>
      new Promise((resolve) => {
        setCloneRepoDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      cloneRepoDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    const cleanup = setRuntimeConfirmDialogRequester((request) =>
      new Promise((resolve) => {
        setRuntimeConfirmDialog((current) => {
          current?.resolve(false);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      runtimeConfirmDialogRef.current?.resolve(false);
    };
  }, []);

  useEffect(() => {
    const cleanup = setRuntimeTextInputDialogRequester((request) =>
      new Promise((resolve) => {
        setRuntimeTextInputDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      runtimeTextInputDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    const cleanup = setRuntimeOptionSelectionDialogRequester((request) =>
      new Promise((resolve) => {
        setRuntimeOptionSelectionDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      })
    );
    return () => {
      cleanup();
      runtimeOptionSelectionDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    if (!topologyFileNameDialog) {
      return;
    }
    setTopologyFileNameInput(topologyFileNameDialog.request.defaultValue);
  }, [topologyFileNameDialog]);

  useEffect(() => {
    if (!endpointSelectionDialog) {
      return;
    }
    setEndpointSelectionValue(endpointSelectionDialog.request.preferredValue);
  }, [endpointSelectionDialog]);

  useEffect(() => {
    if (!createTopologyDialog) {
      return;
    }
    setCreateTopologyEndpointValue(createTopologyDialog.request.defaultEndpointId);
    setCreateTopologyFileNameInput(createTopologyDialog.request.defaultFileName);
  }, [createTopologyDialog]);

  useEffect(() => {
    if (!cloneRepoDialog) {
      return;
    }
    const matchingPopular = cloneRepoDialog.request.popularOptions.find(
      (option) => option.value === cloneRepoDialog.request.defaultSourceUrl
    );
    setCloneRepoEndpointValue(cloneRepoDialog.request.defaultEndpointId);
    setCloneRepoMode(cloneRepoDialog.request.defaultMode);
    setCloneRepoTarget(cloneRepoDialog.request.defaultTarget);
    setCloneRepoSourceUrlInput(cloneRepoDialog.request.defaultSourceUrl);
    setCloneRepoPopularValue(
      matchingPopular?.value ?? cloneRepoDialog.request.popularOptions[0]?.value ?? ""
    );
    setCloneRepoLabNameOverrideInput(cloneRepoDialog.request.defaultLabNameOverride);
  }, [cloneRepoDialog]);

  useEffect(() => {
    if (!runtimeTextInputDialog) {
      return;
    }
    setRuntimeTextInputValue(runtimeTextInputDialog.request.defaultValue);
  }, [runtimeTextInputDialog]);

  useEffect(() => {
    if (!runtimeOptionSelectionDialog) {
      return;
    }
    setRuntimeOptionSelectionValue(runtimeOptionSelectionDialog.request.preferredValue);
  }, [runtimeOptionSelectionDialog]);

  useEffect(() => {
    if (!inspectRequest) {
      setInspectGroups([]);
      setInspectError(null);
      setInspectFilter("");
      return;
    }

    let cancelled = false;
    setInspectLoading(true);
    setInspectError(null);

    const load = async () => {
      try {
        const payload =
          inspectRequest.mode === "all"
            ? await inspectAllLabs()
            : await inspectLab(inspectRequest.target ?? {});
        if (cancelled) {
          return;
        }
        setInspectGroups(
          normalizeInspectGroups(inspectRequest.title, inspectRequest.mode, payload)
        );
      } catch (error) {
        if (!cancelled) {
          setInspectError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setInspectLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [inspectRequest]);

  const fetchLogs = useCallback(async (tailValue: string, showLoading: boolean): Promise<void> => {
    if (!logsRequest) {
      return;
    }
    const requestId = ++logsFetchRequestIdRef.current;
    if (showLoading) {
      setLogsLoading(true);
    }
    setLogsError(null);
    try {
      const response = await fetchNodeLogs({
        sessionId: logsRequest.sessionId,
        topologyRef: logsRequest.topologyRef,
        nodeName: logsRequest.nodeName,
        tail: tailValue
      });
      if (requestId !== logsFetchRequestIdRef.current) {
        return;
      }
      setLogsContent(response.logs);
    } catch (error) {
      if (requestId !== logsFetchRequestIdRef.current) {
        return;
      }
      setLogsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (showLoading && requestId === logsFetchRequestIdRef.current) {
        setLogsLoading(false);
      }
    }
  }, [logsRequest]);

  useEffect(() => {
    if (!logsRequest) {
      logsFetchRequestIdRef.current += 1;
      setLogsContent("");
      setLogsError(null);
      setLogsTail("200");
      setLogsFollow(true);
      setLogsFilter("");
      setLogsLoading(false);
      return;
    }

    const initialTail = "200";
    setLogsTail(initialTail);
    setLogsFollow(true);
    setLogsFilter("");
    void fetchLogs(initialTail, true);
    return () => {
      logsFetchRequestIdRef.current += 1;
    };
  }, [fetchLogs, logsRequest]);

  useEffect(() => {
    if (!logsRequest || !logsFollow) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void fetchLogs(logsTail, false);
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchLogs, logsFollow, logsRequest, logsTail]);

  useEffect(() => {
    if (!logsFollow) {
      return;
    }
    const paperNode = logsPaperRef.current;
    if (!paperNode) {
      return;
    }
    paperNode.scrollTop = paperNode.scrollHeight;
  }, [filteredLogsContent, logsFollow]);

  const exportLogs = useCallback((): void => {
    if (!logsRequest || !filteredLogsContent) {
      return;
    }
    const safeNodeName = logsRequest.nodeName.trim().replace(/[^A-Za-z0-9._-]/g, "-") || "node";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([filteredLogsContent], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeNodeName}-logs-${stamp}.log`;
    link.click();
    window.URL.revokeObjectURL(url);
  }, [filteredLogsContent, logsRequest]);

  useEffect(() => {
    if (!versionOpen) {
      setVersionError(null);
      setVersionInfo("");
      setVersionCheck("");
      return;
    }

    let cancelled = false;
    setVersionLoading(true);
    setVersionError(null);

    const load = async () => {
      try {
        const [version, check] = await Promise.all([
          fetchVersionInfo(),
          fetchVersionCheck()
        ]);
        if (cancelled) {
          return;
        }
        setVersionInfo(version.versionInfo);
        setVersionCheck(check.checkResult);
      } catch (error) {
        if (!cancelled) {
          setVersionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setVersionLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [versionOpen]);

  useEffect(() => {
    if (!netemRequest) {
      setNetemFieldsByInterface({});
      setNetemContainerName("");
      setNetemError(null);
      setNetemLoading(false);
      return;
    }

    const interfaceNames = netemInterfaceRows.map((row) => row.name);
    setNetemLoading(false);
    setNetemError(null);
    setNetemContainerName(runtimeContainer?.name ?? "");
    setNetemFieldsByInterface(mergeInterfaceFields(interfaceNames, runtimeNetemFields));
  }, [netemInterfaceRows, netemRequest, runtimeContainer?.name, runtimeNetemFields]);

  const applyNetem = async (interfaceName: string): Promise<void> => {
    if (!netemRequest) {
      return;
    }
    const fields = normalizeNetemFields(netemFieldsByInterface[interfaceName]);
    setNetemPendingInterface(interfaceName);
    setNetemError(null);

    try {
      await setNetem({
        sessionId: netemRequest.sessionId,
        topologyRef: netemRequest.topologyRef,
        nodeName: netemRequest.nodeName,
        interfaceName,
        delay: fields.delay.trim() || undefined,
        jitter: fields.jitter.trim() || undefined,
        loss: parseOptionalNumber(fields.loss),
        rate: parseOptionalNumber(fields.rate),
        corruption: parseOptionalNumber(fields.corruption)
      });
      useLabStore.getState().updateInterfaceNetemState({
        endpointId: netemRequest.endpointId,
        topologyPath: netemRequest.topologyRef?.yamlPath,
        labName: netemRequest.topologyRef?.labName,
        nodeName: netemRequest.nodeName,
        interfaceName,
        netem: netemPatchFromFields(fields)
      });
      runtimeUiActions.notify(`Updated impairments for ${interfaceName}.`, "success");
    } catch (error) {
      setNetemError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetemPendingInterface(null);
    }
  };

  const clearNetem = async (interfaceName: string): Promise<void> => {
    if (!netemRequest) {
      return;
    }
    setNetemPendingInterface(interfaceName);
    setNetemError(null);

    try {
      await resetNetem({
        sessionId: netemRequest.sessionId,
        topologyRef: netemRequest.topologyRef,
        nodeName: netemRequest.nodeName,
        interfaceName
      });
      useLabStore.getState().updateInterfaceNetemState({
        endpointId: netemRequest.endpointId,
        topologyPath: netemRequest.topologyRef?.yamlPath,
        labName: netemRequest.topologyRef?.labName,
        nodeName: netemRequest.nodeName,
        interfaceName,
        netem: netemPatchFromFields(DEFAULT_NETEM_FIELDS)
      });
      setNetemFieldsByInterface((current) => ({
        ...current,
        [interfaceName]: DEFAULT_NETEM_FIELDS
      }));
      runtimeUiActions.notify(`Cleared impairments for ${interfaceName}.`, "success");
    } catch (error) {
      setNetemError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetemPendingInterface(null);
    }
  };

  const closeTopologyFileNameDialog = useCallback((value: string | undefined): void => {
    setTopologyFileNameDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitTopologyFileNameDialog = useCallback((): void => {
    const value = trimmedTopologyFileNameInput;
    if (!value) {
      return;
    }
    closeTopologyFileNameDialog(value);
  }, [closeTopologyFileNameDialog, trimmedTopologyFileNameInput]);

  const closeEndpointSelectionDialog = useCallback((value: string | undefined): void => {
    setEndpointSelectionDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitEndpointSelectionDialog = useCallback((): void => {
    if (!endpointSelectionIsValid) {
      return;
    }
    closeEndpointSelectionDialog(endpointSelectionValue);
  }, [closeEndpointSelectionDialog, endpointSelectionIsValid, endpointSelectionValue]);

  const closeCreateTopologyDialog = useCallback((value: CreateTopologyDialogResult | undefined): void => {
    setCreateTopologyDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitCreateTopologyDialog = useCallback((): void => {
    if (!createTopologyEndpointIsValid || !trimmedCreateTopologyFileNameInput) {
      return;
    }
    closeCreateTopologyDialog({
      endpointId: createTopologyEndpointValue,
      fileName: normalizeTopologyFileNameForCreate(trimmedCreateTopologyFileNameInput)
    });
  }, [
    closeCreateTopologyDialog,
    createTopologyEndpointIsValid,
    createTopologyEndpointValue,
    trimmedCreateTopologyFileNameInput
  ]);

  const closeCloneRepoDialog = useCallback((value: CloneRepoDialogResult | undefined): void => {
    setCloneRepoDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitCloneRepoDialog = useCallback((): void => {
    if (!cloneRepoCanSubmit) {
      return;
    }
    closeCloneRepoDialog({
      endpointId: cloneRepoEndpointValue,
      sourceUrl: cloneRepoResolvedSourceUrl,
      labNameOverride: trimmedCloneRepoLabNameOverrideInput || undefined,
      target: cloneRepoTarget
    });
  }, [
    cloneRepoCanSubmit,
    cloneRepoEndpointValue,
    cloneRepoResolvedSourceUrl,
    closeCloneRepoDialog,
    cloneRepoTarget,
    trimmedCloneRepoLabNameOverrideInput
  ]);

  const closeRuntimeConfirmDialog = useCallback((value: boolean): void => {
    setRuntimeConfirmDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const closeRuntimeTextInputDialog = useCallback((value: string | undefined): void => {
    setRuntimeTextInputDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitRuntimeTextInputDialog = useCallback((): void => {
    if (!runtimeTextInputValueCanSubmit) {
      return;
    }
    closeRuntimeTextInputDialog(trimmedRuntimeTextInputValue);
  }, [
    closeRuntimeTextInputDialog,
    runtimeTextInputValueCanSubmit,
    trimmedRuntimeTextInputValue
  ]);

  const closeRuntimeOptionSelectionDialog = useCallback((value: string | undefined): void => {
    setRuntimeOptionSelectionDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitRuntimeOptionSelectionDialog = useCallback((): void => {
    if (!runtimeOptionSelectionIsValid) {
      return;
    }
    closeRuntimeOptionSelectionDialog(runtimeOptionSelectionValue);
  }, [
    closeRuntimeOptionSelectionDialog,
    runtimeOptionSelectionIsValid,
    runtimeOptionSelectionValue
  ]);

  return (
    <>
      {inspectRequest ? (
        <InspectDialogView
          closeInspect={closeInspect}
          filteredInspectGroups={filteredInspectGroups}
          inspectError={inspectError}
          inspectFilter={inspectFilter}
          inspectLoading={inspectLoading}
          inspectRequest={inspectRequest}
          setInspectFilter={setInspectFilter}
        />
      ) : null}

      {logsRequest ? (
        <LogsDialogView
          closeLogs={closeLogs}
          exportLogs={exportLogs}
          fetchLogs={fetchLogs}
          filteredLogsContent={filteredLogsContent}
          logsError={logsError}
          logsFilter={logsFilter}
          logsFollow={logsFollow}
          logsLoading={logsLoading}
          logsPaperRef={logsPaperRef}
          logsRequest={logsRequest}
          logsTail={logsTail}
          setLogsFilter={setLogsFilter}
          setLogsFollow={setLogsFollow}
          setLogsTail={setLogsTail}
          totalLogLines={totalLogLines}
          visibleLogLines={visibleLogLines}
        />
      ) : null}

      {netemRequest ? (
        <NetemDialogView
          applyNetem={applyNetem}
          clearNetem={clearNetem}
          closeNetem={closeNetem}
          netemContainerName={netemContainerName}
          netemError={netemError}
          netemFieldsByInterface={netemFieldsByInterface}
          netemInterfaceRows={netemInterfaceRows}
          netemLoading={netemLoading}
          netemPendingInterface={netemPendingInterface}
          netemRequest={netemRequest}
          setNetemFieldsByInterface={setNetemFieldsByInterface}
        />
      ) : null}

      {versionOpen ? (
        <VersionDialogView
          versionCheck={versionCheck}
          versionError={versionError}
          versionInfo={versionInfo}
          versionLoading={versionLoading}
          versionOpen={versionOpen}
        />
      ) : null}

      {cloneRepoDialog ? (
        <CloneRepoDialogView
          cloneRepoCanSubmit={cloneRepoCanSubmit}
          cloneRepoDialog={cloneRepoDialog}
          cloneRepoEndpointValue={cloneRepoEndpointValue}
          cloneRepoLabNameOverrideInput={cloneRepoLabNameOverrideInput}
          cloneRepoMode={cloneRepoMode}
          cloneRepoPopularValue={cloneRepoPopularValue}
          cloneRepoSourceUrlInput={cloneRepoSourceUrlInput}
          cloneRepoTarget={cloneRepoTarget}
          closeCloneRepoDialog={closeCloneRepoDialog}
          setCloneRepoEndpointValue={setCloneRepoEndpointValue}
          setCloneRepoLabNameOverrideInput={setCloneRepoLabNameOverrideInput}
          setCloneRepoMode={setCloneRepoMode}
          setCloneRepoPopularValue={setCloneRepoPopularValue}
          setCloneRepoSourceUrlInput={setCloneRepoSourceUrlInput}
          setCloneRepoTarget={setCloneRepoTarget}
          submitCloneRepoDialog={submitCloneRepoDialog}
        />
      ) : null}

      {createTopologyDialog ? (
        <CreateTopologyDialogView
          closeCreateTopologyDialog={closeCreateTopologyDialog}
          createTopologyDialog={createTopologyDialog}
          createTopologyEndpointIsValid={createTopologyEndpointIsValid}
          createTopologyEndpointValue={createTopologyEndpointValue}
          createTopologyFileNameInput={createTopologyFileNameInput}
          setCreateTopologyEndpointValue={setCreateTopologyEndpointValue}
          setCreateTopologyFileNameInput={setCreateTopologyFileNameInput}
          submitCreateTopologyDialog={submitCreateTopologyDialog}
          trimmedCreateTopologyFileNameInput={trimmedCreateTopologyFileNameInput}
        />
      ) : null}

      {topologyFileNameDialog ? (
        <TopologyFileNameDialogView
          closeTopologyFileNameDialog={closeTopologyFileNameDialog}
          setTopologyFileNameInput={setTopologyFileNameInput}
          submitTopologyFileNameDialog={submitTopologyFileNameDialog}
          topologyFileNameDialog={topologyFileNameDialog}
          topologyFileNameInput={topologyFileNameInput}
          trimmedTopologyFileNameInput={trimmedTopologyFileNameInput}
        />
      ) : null}

      {endpointSelectionDialog ? (
        <EndpointSelectionDialogView
          closeEndpointSelectionDialog={closeEndpointSelectionDialog}
          endpointSelectionDialog={endpointSelectionDialog}
          endpointSelectionIsValid={endpointSelectionIsValid}
          endpointSelectionValue={endpointSelectionValue}
          setEndpointSelectionValue={setEndpointSelectionValue}
          submitEndpointSelectionDialog={submitEndpointSelectionDialog}
        />
      ) : null}

      <FileEditorDialog />
      <RuntimeConfirmDialogView
        closeRuntimeConfirmDialog={closeRuntimeConfirmDialog}
        runtimeConfirmDialog={runtimeConfirmDialog}
      />
      <RuntimeTextInputDialogView
        closeRuntimeTextInputDialog={closeRuntimeTextInputDialog}
        runtimeTextInputDialog={runtimeTextInputDialog}
        runtimeTextInputValue={runtimeTextInputValue}
        runtimeTextInputValueCanSubmit={runtimeTextInputValueCanSubmit}
        setRuntimeTextInputValue={setRuntimeTextInputValue}
        submitRuntimeTextInputDialog={submitRuntimeTextInputDialog}
      />
      <RuntimeOptionSelectionDialogView
        closeRuntimeOptionSelectionDialog={closeRuntimeOptionSelectionDialog}
        runtimeOptionSelectionDialog={runtimeOptionSelectionDialog}
        runtimeOptionSelectionIsValid={runtimeOptionSelectionIsValid}
        runtimeOptionSelectionValue={runtimeOptionSelectionValue}
        setRuntimeOptionSelectionValue={setRuntimeOptionSelectionValue}
        submitRuntimeOptionSelectionDialog={submitRuntimeOptionSelectionDialog}
      />
      {snackbar ? <RuntimeSnackbarView closeSnackbar={closeSnackbar} snackbar={snackbar} /> : null}
    </>
  );
}
