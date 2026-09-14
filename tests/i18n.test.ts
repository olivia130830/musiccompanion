import { describe, expect, it } from "vitest";

import {
  getAiReplyLanguageInstruction,
  localizeRuntimeMessage,
  tr,
} from "@/lib/i18n";

describe("language selection", () => {
  it("selects the requested interface copy", () => {
    expect(tr("zh", "中文", "English")).toBe("中文");
    expect(tr("en", "中文", "English")).toBe("English");
  });

  it("gives Qwen an explicit response-language instruction", () => {
    expect(getAiReplyLanguageInstruction("zh")).toContain("中文");
    expect(getAiReplyLanguageInstruction("en")).toContain(
      "entirely in natural English",
    );
  });

  it("localizes known runtime messages without hiding unknown details", () => {
    expect(
      localizeRuntimeMessage("正在识别…", "en"),
    ).toBe("Transcribing…");
    expect(localizeRuntimeMessage("具体服务端错误", "en")).toBe(
      "具体服务端错误",
    );
  });
});
