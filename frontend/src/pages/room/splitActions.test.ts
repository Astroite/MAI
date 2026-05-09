import { describe, expect, it } from "vitest";
import { splitActions } from "./splitActions";

describe("splitActions", () => {
  it("returns pure speech as a single segment", () => {
    expect(splitActions("这个方案有几个隐患")).toEqual([
      { kind: "speech", text: "这个方案有几个隐患" }
    ]);
  });

  it("pulls an asterisk-wrapped run into its own action segment", () => {
    expect(splitActions("*推了推眼镜* 这个方案有几个隐患")).toEqual([
      { kind: "action", text: "推了推眼镜" },
      { kind: "speech", text: " 这个方案有几个隐患" }
    ]);
  });

  it("keeps multiple actions separate and interleaves speech", () => {
    expect(splitActions("*sigh* 这事儿... *挠头*")).toEqual([
      { kind: "action", text: "sigh" },
      { kind: "speech", text: " 这事儿... " },
      { kind: "action", text: "挠头" }
    ]);
  });

  it("does NOT treat bold (**foo**) as an action", () => {
    // The inner `**` is `*` + `*`; the class `[^*\n]` refuses to match
    // an asterisk inside. Bold stays in the speech segment for MarkdownBlock.
    expect(splitActions("**really important** happened")).toEqual([
      { kind: "speech", text: "**really important** happened" }
    ]);
  });

  it("drops empty segments so there's nothing to render for just spaces", () => {
    expect(splitActions("*action*")).toEqual([
      { kind: "action", text: "action" }
    ]);
  });
});
