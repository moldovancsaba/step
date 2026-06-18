/**
 * Footer with links to the public content pages (About/company, Privacy, Terms,
 * Support) served as static HTML at the same origin (step.regiominer.com/about
 * etc.). Builds trust by surfacing the developer/owner (Moldovan Csaba Kft) and
 * the legal documents from anywhere in the app.
 */
import { Anchor, Group, Text } from "@mantine/core";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
];

export function Footer() {
  return (
    <Group justify="center" gap="md" wrap="wrap" py="md">
      {LINKS.map((l) => (
        <Anchor key={l.href} href={l.href} target="_blank" rel="noopener" size="xs" c="dimmed">
          {l.label}
        </Anchor>
      ))}
      <Text size="xs" c="dimmed">
        © 2026 Moldovan Csaba Kft
      </Text>
    </Group>
  );
}
