import { describe, expect, it } from "vitest";
import { getPanelSectionScrollTop } from "./RightPanel";

describe("getPanelSectionScrollTop", () => {
  it("keeps the right rail in place when the section is already visible", () => {
    expect(
      getPanelSectionScrollTop({
        currentScrollTop: 120,
        maxScrollTop: 500,
        panelTop: 0,
        panelBottom: 600,
        sectionTop: 100,
        sectionBottom: 240
      })
    ).toBe(120);
  });

  it("scrolls only enough to reveal a section below the right rail viewport", () => {
    expect(
      getPanelSectionScrollTop({
        currentScrollTop: 120,
        maxScrollTop: 500,
        panelTop: 0,
        panelBottom: 600,
        sectionTop: 520,
        sectionBottom: 700
      })
    ).toBe(232);
  });

  it("aligns oversized sections to the top padding and clamps to the right rail range", () => {
    expect(
      getPanelSectionScrollTop({
        currentScrollTop: 20,
        maxScrollTop: 60,
        panelTop: 0,
        panelBottom: 300,
        sectionTop: 240,
        sectionBottom: 620
      })
    ).toBe(60);
  });
});
