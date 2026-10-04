import type { Page } from "@playwright/test";
import { ACCOUNTS, DEPOTS } from "../support/accounts";
import { ApiSession } from "../support/api";
import { STORY } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { signInOn } from "../support/signIn";

// Check rendered text, not just document width: overflow:hidden can hide a label without creating a scrollbar.
async function textLayoutProblems(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const problems = new Set<string>();
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.add("Document overflows horizontally");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const element = text.parentElement;
      if (!element || !text.textContent?.trim() || element.closest("script, style, [hidden], .sr-only")) continue;
      if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
      const label = text.textContent.trim();
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        if (rect.left < -1 || rect.right > innerWidth + 1) problems.add(`Outside phone width: ${label}`);
        for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const bounds = ancestor.getBoundingClientRect();
          const left = bounds.left + ancestor.clientLeft;
          const top = bounds.top + ancestor.clientTop;
          if (
            /hidden|clip/.test(style.overflowX) &&
            (rect.left < left - 1 || rect.right > left + ancestor.clientWidth + 1)
          )
            problems.add(`Horizontally clipped: ${label}`);
          if (
            /hidden|clip/.test(style.overflowY) &&
            (rect.top < top - 1 || rect.bottom > top + ancestor.clientHeight + 1)
          )
            problems.add(`Vertically clipped: ${label}`);
          if (style.textOverflow === "ellipsis" && ancestor.scrollWidth > ancestor.clientWidth + 1)
            problems.add(`Ellipsized: ${label}`);
        }
      }
    }
    return [...problems];
  });
}

test("Tamil Loader dock screens keep every label visible at 360px", async ({ demo, page, baseURL }) => {
  await demo.reset("before-cutoff");
  await demo.setClock(STORY.orderDay, "16:05");
  const api = await ApiSession.dispatcher(baseURL!, DEPOTS.kandy);
  try {
    const day = `/api/dispatch/days/${STORY.deliveryDay}`;
    const { draft } = await api.post<{ draft: { revision: number } }>(`${day}/propose?depot=${DEPOTS.kandy}`, {
      revision: 0,
    });
    await api.post(`${day}/publish?depot=${DEPOTS.kandy}`, { revision: draft.revision });
  } finally {
    await api.dispose();
  }
  await demo.setClock(STORY.deliveryDay, "02:45");
  await page.setViewportSize({ width: 360, height: 800 });
  await signInOn(page, ACCOUNTS.kandyLoader);
  await page.getByRole("button", { name: "தமிழ்", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ஏற்றுமுனை பயணங்கள்", exact: true })).toBeVisible();
  const open = page.locator(".loader-trip .loader-back").first();
  await expect(open).toBeVisible();
  expect(await textLayoutProblems(page), "Tamil dock trip list").toEqual([]);
  await open.click();
  await expect(page.locator(".loader-line").first()).toBeVisible();
  expect(await textLayoutProblems(page), "Tamil loading checklist").toEqual([]);
  for (const label of ["பற்றாக்குறை", "சேதமடைந்தது"]) {
    await page.getByRole("button", { name: label, exact: true }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    expect(await textLayoutProblems(page), `Tamil ${label} report sheet`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
  }
  await page.locator(".loader-footer .loader-back").click();
  await expect(page.locator(".nd-hold")).toBeVisible();
  expect(await textLayoutProblems(page), "Tamil ready review and hold button").toEqual([]);
  await page.locator(".loader-user").click();
  await expect(page.getByRole("heading", { name: "இணைப்பு மற்றும் ஏற்றுநர் கணக்கு", exact: true })).toBeVisible();
  expect(await textLayoutProblems(page), "Tamil connection settings").toEqual([]);

  // Negative control: a hidden-overflow label must fail even when the page itself still fits.
  await page.evaluate(() => {
    const sample = document.createElement("div");
    sample.id = "clipping-control";
    sample.textContent = "தமிழ் சோதனை";
    sample.style.cssText = "width:4px;white-space:nowrap;overflow:hidden";
    document.body.append(sample);
  });
  expect(await textLayoutProblems(page)).toContain("Horizontally clipped: தமிழ் சோதனை");
  await page.locator("#clipping-control").evaluate((element) => element.remove());
});
