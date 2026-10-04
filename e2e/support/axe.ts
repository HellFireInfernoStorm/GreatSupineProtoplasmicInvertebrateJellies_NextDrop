import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * The accessibility smoke check: no serious or critical WCAG 2.1 A/AA violation on the screen as it stands.
 * A smoke check, not an audit: it catches a missing label or an unreadable contrast, not everything.
 */
export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id}: ${node.target.join(" ")}\n${node.failureSummary ?? violation.help}`,
    ),
  );
  expect(summary, `Accessibility violations on ${page.url()}`).toEqual([]);
}
