import type { ReactNode } from "react";

import {
  Alert,
  Avatar,
  Box,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
  UnstyledButton
} from "@mantine/core";
import {
  IconBook,
  IconExternalLink,
  IconHeartFilled,
  IconPuzzle,
  IconUsersGroup
} from "@tabler/icons-react";

import { publicAssetUrl } from "../publicAssetUrl";

interface AboutSettingsContentProps {
  versionCheck: string;
  versionError: string | null;
  versionInfo: string;
  versionLoading: boolean;
}

interface AboutLink {
  description: string;
  icon: ReactNode;
  label: string;
  url: string;
}

interface AboutAuthor {
  color: string;
  initials: string;
  linkedIn: string;
  name: string;
  title: string;
}

const documentationLinks: AboutLink[] = [
  {
    label: "Containerlab Docs",
    description: "Full documentation",
    url: "https://containerlab.dev/",
    icon: <IconBook size={18} />
  },
  {
    label: "Extension Docs",
    description: "VS Code extension guide",
    url: "https://containerlab.dev/manual/vsc-extension/",
    icon: <IconPuzzle size={18} />
  }
];

const authors: AboutAuthor[] = [
  {
    name: "Florian Schwarz",
    title: "Maintainer",
    linkedIn: "https://linkedin.com/in/florian-schwarz-812a34145",
    initials: "FS",
    color: "#2196F3"
  },
  {
    name: "Kaelem Chandra",
    title: "Maintainer",
    linkedIn: "https://linkedin.com/in/kaelem-chandra",
    initials: "KC",
    color: "#9C27B0"
  },
  {
    name: "Asad Arafat",
    title: "Maintainer",
    linkedIn: "https://www.linkedin.com/in/asadarafat/",
    initials: "AA",
    color: "#4CAF50"
  }
];

function AboutSection(props: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Paper
      withBorder
      style={{
        overflow: "hidden",
        backgroundColor: "light-dark(rgba(0,0,0,0.015), rgba(255,255,255,0.03))"
      }}
    >
      <Box style={{ paddingInline: 16, paddingBlock: 10 }}>
        <Group gap="xs">
          {props.icon}
          <Text size="sm" fw={600}>
            {props.title}
          </Text>
        </Group>
      </Box>
      <Divider />
      {props.children}
    </Paper>
  );
}

function LinkRow(props: { href: string; icon: ReactNode; label: string; description: string }) {
  return (
    <UnstyledButton
      component="a"
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: "block", paddingInline: 16, paddingBlock: 12 }}
    >
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <Box style={{ color: "var(--mantine-color-dimmed)", marginTop: 2 }}>{props.icon}</Box>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600}>
            {props.label}
          </Text>
          <Text size="xs" c="dimmed">
            {props.description}
          </Text>
        </div>
        <IconExternalLink size={18} style={{ color: "var(--mantine-color-dimmed)", marginTop: 2 }} />
      </Group>
    </UnstyledButton>
  );
}

function LinkList(props: { links: AboutLink[] }) {
  return (
    <Stack gap={0}>
      {props.links.map((link, index) => (
        <Box key={link.url}>
          {index > 0 ? <Divider /> : null}
          <LinkRow
            href={link.url}
            icon={link.icon}
            label={link.label}
            description={link.description}
          />
        </Box>
      ))}
    </Stack>
  );
}

function AuthorList() {
  return (
    <Stack gap={0}>
      {authors.map((author, index) => (
        <Box key={author.linkedIn}>
          {index > 0 ? <Divider /> : null}
          <UnstyledButton
            component="a"
            href={author.linkedIn}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", paddingInline: 16, paddingBlock: 12 }}
          >
            <Group align="flex-start" wrap="nowrap" gap="sm">
              <Avatar
                radius="xl"
                style={{ backgroundColor: author.color, width: 32, height: 32, fontSize: "0.875rem", color: "#fff" }}
              >
                {author.initials}
              </Avatar>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {author.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {author.title}
                </Text>
              </div>
              <IconExternalLink
                size={18}
                style={{ color: "var(--mantine-color-dimmed)", marginTop: 2 }}
              />
            </Group>
          </UnstyledButton>
        </Box>
      ))}
    </Stack>
  );
}

export function AboutSettingsContent({
  versionCheck,
  versionError,
  versionInfo,
  versionLoading
}: AboutSettingsContentProps) {
  const versionValue = versionLoading ? "Loading..." : versionInfo;
  const updateValue = versionLoading ? "Loading..." : versionCheck;

  return (
    <Stack gap="lg">
      <Box>
        <Title order={4}>About</Title>
        <Text size="sm" c="dimmed">
          TopoViewer details, project links, maintainers, and runtime diagnostics.
        </Text>
      </Box>

      <Group wrap="wrap" gap="md" align="center">
        <Box
          component="img"
          src={publicAssetUrl("containerlab.svg")}
          alt=""
          style={{ width: 56, height: 56, flexShrink: 0 }}
        />
        <Box>
          <Title order={3} fw={600}>
            TopoViewer
          </Title>
          <Text size="sm" c="dimmed">
            Interactive topology visualization and editing for Containerlab network labs in the
            standalone browser UI.
          </Text>
        </Box>
      </Group>

      <Group align="stretch" gap="md" grow wrap="wrap">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <AboutSection title="Documentation" icon={<IconBook size={18} />}>
            <LinkList links={documentationLinks} />
          </AboutSection>
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <AboutSection title="Team" icon={<IconUsersGroup size={18} />}>
            <AuthorList />
          </AboutSection>
        </Box>
      </Group>

      <AboutSection title="Runtime Version" icon={<IconPuzzle size={18} />}>
        <Stack gap="md" style={{ padding: 16 }}>
          {versionError ? (
            <Alert color="red" variant="outline">
              {versionError}
            </Alert>
          ) : null}
          <Textarea
            label="Containerlab Version"
            value={versionValue}
            autosize
            minRows={3}
            readOnly
            data-testid="standalone-settings-version-info"
          />
          <Textarea
            label="Update Check"
            value={updateValue}
            autosize
            minRows={3}
            readOnly
            data-testid="standalone-settings-version-check"
          />
        </Stack>
      </AboutSection>

      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          color: "var(--mantine-color-dimmed)"
        }}
      >
        <Text size="xs">Made with</Text>
        <IconHeartFilled size={14} style={{ color: "var(--mantine-color-red-6)" }} />
        <Text size="xs">for the network community</Text>
      </Box>
    </Stack>
  );
}
