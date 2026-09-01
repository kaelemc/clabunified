import assert from "node:assert/strict";
import test from "node:test";

import { type TopologyRef } from "@srl-labs/clab-ui/session";

import { resolveFileTab, resolveLabTab, useLabTabsStore } from "./labTabsStore";

function makeTopologyRef(path: string, labName: string, endpointId: string): TopologyRef {
  return {
    topologyId: `standalone:${endpointId}::${path}`,
    labName,
    yamlPath: path,
    annotationsPath: `${path}.annotations.json`,
    source: "standalone"
  };
}

test.beforeEach(() => {
  useLabTabsStore.getState().clear();
});

test("openOrFocusTab adds once and focuses existing tabs without duplicates", () => {
  const store = useLabTabsStore.getState();
  const tab = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/demo.clab.yml", "demo", "ep-1")
  });

  const first = store.openOrFocusTab(tab);
  assert.equal(first.alreadyOpen, false);
  assert.equal(useLabTabsStore.getState().tabs.length, 1);
  assert.equal(useLabTabsStore.getState().activeTabId, tab.id);

  const second = useLabTabsStore.getState().openOrFocusTab(tab);
  assert.equal(second.alreadyOpen, true);
  assert.equal(useLabTabsStore.getState().tabs.length, 1);
  assert.equal(useLabTabsStore.getState().activeTabId, tab.id);
});

test("openOrFocusTab replaces the open item so only one is open at a time", () => {
  const store = useLabTabsStore.getState();
  const first = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/a.clab.yml", "a", "ep-1")
  });
  const second = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/b.clab.yml", "b", "ep-2")
  });

  store.openOrFocusTab(first);
  const result = useLabTabsStore.getState().openOrFocusTab(second);

  assert.equal(result.alreadyOpen, false);
  assert.equal(useLabTabsStore.getState().tabs.length, 1);
  assert.deepEqual(
    useLabTabsStore.getState().tabs.map((tab) => tab.id),
    [second.id]
  );
  assert.equal(useLabTabsStore.getState().activeTabId, second.id);
});

test("openOrFocusTab opens workspace files as editable tabs", () => {
  const store = useLabTabsStore.getState();
  const tab = resolveFileTab({
    endpointId: "ep-1",
    path: "new-lab/new-lab.clab.yml.annotations.json",
    content: "{}"
  });

  const first = store.openOrFocusTab(tab);
  assert.equal(first.alreadyOpen, false);
  assert.equal(first.tab.kind, "file");
  assert.equal(first.tab.title, "new-lab.clab.yml.annotations.json");
  assert.equal(useLabTabsStore.getState().activeTabId, tab.id);

  useLabTabsStore.getState().setFileTabContent(tab.id, "{\"dirty\":true}");
  const second = useLabTabsStore.getState().openOrFocusTab(
    resolveFileTab({
      endpointId: "ep-1",
      path: "new-lab/new-lab.clab.yml.annotations.json",
      content: "{}"
    })
  );
  assert.equal(second.alreadyOpen, true);
  assert.equal(second.tab.kind, "file");
  if (second.tab.kind !== "file") {
    throw new Error("Expected a file tab.");
  }
  assert.equal(second.tab.content, "{\"dirty\":true}");
  assert.equal(second.tab.originalContent, "{}");
});

test("closeTab clears active tab when closing the last tab", () => {
  const store = useLabTabsStore.getState();
  const tab = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/only.clab.yml", "only", "ep-1")
  });

  store.openOrFocusTab(tab);
  const result = useLabTabsStore.getState().closeTab(tab.id);

  assert.equal(result.removed, true);
  assert.equal(result.wasActive, true);
  assert.equal(result.nextActiveTabId, null);
  assert.equal(useLabTabsStore.getState().tabs.length, 0);
  assert.equal(useLabTabsStore.getState().activeTabId, null);
});

test("closeTabsByEndpoint removes the open tab when it matches the endpoint", () => {
  const store = useLabTabsStore.getState();
  const tab = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/a.clab.yml", "a", "ep-1")
  });

  store.openOrFocusTab(tab);

  const noMatch = useLabTabsStore.getState().closeTabsByEndpoint("ep-2");
  assert.equal(noMatch.removedCount, 0);
  assert.equal(useLabTabsStore.getState().tabs.length, 1);

  const result = useLabTabsStore.getState().closeTabsByEndpoint("ep-1");
  assert.equal(result.removedCount, 1);
  assert.equal(result.removedWasActive, true);
  assert.equal(result.nextActiveTabId, null);
  assert.equal(useLabTabsStore.getState().tabs.length, 0);
  assert.equal(useLabTabsStore.getState().activeTabId, null);
});

test("resolveLabTab applies endpoint fallback and normalizes standalone refs", () => {
  const topologyRef: TopologyRef = {
    topologyId: "standalone:demo.clab.yml",
    labName: " demo-lab ",
    yamlPath: "./demo.clab.yml",
    annotationsPath: "",
    source: "standalone"
  };
  const tab = resolveLabTab(
    {
      topologyRef
    },
    "ep-fallback"
  );

  assert.equal(tab.endpointId, "ep-fallback");
  assert.equal(tab.topologyRef.topologyId, "standalone:ep-fallback::demo.clab.yml");
  assert.equal(tab.topologyRef.yamlPath, "demo.clab.yml");
  assert.equal(tab.topologyRef.labName, "demo-lab");
});
