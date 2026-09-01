import * as monaco from "@srl-labs/clab-ui/monaco/core";
import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { useCallback, useEffect, useRef } from "react";

import { writeFileExplorerFile } from "../runtimeApi";
import { confirmRuntimeAction } from "../runtimeActionFlows";
import { runtimeUiActions, useRuntimeUiStore } from "../stores/runtimeUiStore";
import {
  attachContainerlabYamlSupport,
  createContainerlabYamlModel,
  isContainerlabTopologyFile,
} from "./containerlabYamlFileEditorSupport";

function languageForPath(pathValue: string): string {
  if (/\.(ya?ml)$/i.test(pathValue)) {
    return "yaml";
  }
  if (/\.json$/i.test(pathValue)) {
    return "json";
  }
  if (/\.(sh|bash|zsh)$/i.test(pathValue)) {
    return "shell";
  }
  if (/\.(ts|tsx)$/i.test(pathValue)) {
    return "typescript";
  }
  if (/\.(js|jsx|mjs|cjs)$/i.test(pathValue)) {
    return "javascript";
  }
  return "plaintext";
}

export function FileEditorDialog() {
  const fileEditor = useRuntimeUiStore((state) => state.fileEditor);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const currentModelPathRef = useRef<string | null>(null);

  const dirty = Boolean(
    fileEditor && fileEditor.content !== fileEditor.originalContent,
  );

  useEffect(() => {
    if (!fileEditor || !containerRef.current) {
      return undefined;
    }

    currentModelPathRef.current = fileEditor.path;
    const schemaModel = isContainerlabTopologyFile(fileEditor.path)
      ? createContainerlabYamlModel(
          monaco,
          fileEditor.endpointId,
          fileEditor.path,
          fileEditor.content,
        )
      : null;
    const schemaSupport = schemaModel
      ? attachContainerlabYamlSupport(monaco, schemaModel)
      : null;
    const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      tabSize: 2,
      wordWrap: "on",
      hover: { enabled: true, delay: 300 },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      suggest: {
        showProperties: true,
        showWords: false,
        snippetsPreventQuickSuggestions: false,
      },
      wordBasedSuggestions: "off",
    };
    if (schemaModel) {
      editorOptions.model = schemaModel;
    } else {
      editorOptions.value = fileEditor.content;
      editorOptions.language = languageForPath(fileEditor.path);
    }

    const editor = monaco.editor.create(containerRef.current, editorOptions);
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => {
      runtimeUiActions.setFileEditorContent(editor.getValue());
    });

    return () => {
      schemaSupport?.dispose();
      subscription.dispose();
      editor.dispose();
      schemaModel?.dispose();
      editorRef.current = null;
      currentModelPathRef.current = null;
    };
  }, [fileEditor?.endpointId, fileEditor?.path]);

  useEffect(() => {
    if (
      !fileEditor ||
      !editorRef.current ||
      currentModelPathRef.current !== fileEditor.path
    ) {
      return;
    }
    if (editorRef.current.getValue() !== fileEditor.content) {
      editorRef.current.setValue(fileEditor.content);
    }
  }, [fileEditor]);

  const handleClose = useCallback(async () => {
    const state = useRuntimeUiStore.getState().fileEditor;
    if (state && state.content !== state.originalContent) {
      const shouldClose = await confirmRuntimeAction({
        title: "Discard Unsaved Changes",
        message: `Discard unsaved changes to "${state.title}"?`,
        confirmLabel: "Discard",
        severity: "warning",
      });
      if (!shouldClose) {
        return;
      }
    }
    runtimeUiActions.closeFileEditor();
  }, []);

  const handleSave = useCallback(async () => {
    const state = useRuntimeUiStore.getState().fileEditor;
    if (!state || state.saving) {
      return;
    }

    runtimeUiActions.setFileEditorSaving(true);
    try {
      await writeFileExplorerFile({
        endpointId: state.endpointId,
        path: state.path,
        content: state.content,
      });
      runtimeUiActions.markFileEditorSaved(state.content);
      runtimeUiActions.notify(`Saved ${state.path}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeUiActions.setFileEditorError(message);
      runtimeUiActions.notify(
        `Failed to save ${state.path}: ${message}`,
        "error",
      );
    }
  }, []);

  if (!fileEditor) {
    return null;
  }

  return (
    <Modal
      opened
      size="xl"
      onClose={() => {
        void handleClose();
      }}
      title={
        <Stack gap={2}>
          <Text fw={600} size="lg" component="span">
            {fileEditor.title}
            {dirty ? " *" : ""}
          </Text>
          <Text size="xs" c="dimmed">
            Lab workspace/{fileEditor.path}
          </Text>
        </Stack>
      }
      styles={{
        content: { height: "82vh", display: "flex", flexDirection: "column" },
        body: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
      }}
    >
      <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
        {fileEditor.error ? (
          <Alert color="red" style={{ borderRadius: 0 }}>
            {fileEditor.error}
          </Alert>
        ) : null}
        <Box ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={() => {
              void handleClose();
            }}
          >
            Close
          </Button>
          <Button
            variant="filled"
            onClick={handleSave}
            disabled={!dirty || fileEditor.saving}
          >
            {fileEditor.saving ? "Saving..." : "Save"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
