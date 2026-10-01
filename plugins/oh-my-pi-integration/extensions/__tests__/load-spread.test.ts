import { describe, expect, test } from "bun:test";
import type { ToolCallEvent } from "@oh-my-pi/pi-coding-agent";
import {
  buildClassificationPrompt,
  type ClassifiableSpawn,
  parseVerdict,
  shouldRouteSpawn,
  stashTaskInput,
  takePendingText,
} from "../plugin/load-spread";

describe("load-spread", () => {
  test("shouldRouteSpawn routes role-derived, pattern-less, and model-less agents", () => {
    const roleDerived: ClassifiableSpawn = {
      agent: "reviewer",
      modelRole: "task",
      patterns: ["zai/glm-5.3"],
      assignment: "fix typo",
    };
    const modelLess: ClassifiableSpawn = {
      agent: "task",
      patterns: ["zai/glm-5.3"],
      assignment: "fix typo",
    };
    const patternless: ClassifiableSpawn = { agent: "task", patterns: [], assignment: "fix typo" };
    const explicit: ClassifiableSpawn = {
      agent: "scout",
      patterns: ["zai/glm-5.3"],
      assignment: "fix typo",
    };
    expect(shouldRouteSpawn(roleDerived)).toBe(true);
    expect(shouldRouteSpawn(modelLess)).toBe(true);
    expect(shouldRouteSpawn(patternless)).toBe(true);
    expect(shouldRouteSpawn(explicit)).toBe(false);
  });

  test("stashTaskInput queues per-agent FIFO text for the next spawn", () => {
    const call = (input: Record<string, unknown>): ToolCallEvent => ({
      type: "tool_call",
      toolCallId: "t1",
      toolName: "task",
      input,
    });
    stashTaskInput(call({ tasks: [{ task: "first", agent: "scout" }] }));
    stashTaskInput(call({ tasks: [{ task: "second", agent: "scout", solutionSpace: "open" }] }));
    stashTaskInput(call({ tasks: [{ task: "default-agent job" }, { task: "   " }] }));
    stashTaskInput(call({}));
    stashTaskInput({ type: "tool_call", toolCallId: "t2", toolName: "bash", input: {} });
    expect(takePendingText("scout")).toEqual({ assignment: "first" });
    expect(takePendingText("scout")).toEqual({ assignment: "second", solutionSpace: "open" });
    expect(takePendingText("scout")).toBeUndefined();
    expect(takePendingText("task")).toEqual({ assignment: "default-agent job" });
    expect(takePendingText("task")).toBeUndefined();
  });

  test("parseVerdict accepts only an affirmative light first token", () => {
    expect(parseVerdict("LIGHT")).toBe("light");
    expect(parseVerdict("  light because single file ")).toBe("light");
    expect(parseVerdict("HEAVY")).toBeUndefined();
    expect(parseVerdict("")).toBeUndefined();
  });

  test("buildClassificationPrompt truncates long assignments and includes the hint", () => {
    const prompt = buildClassificationPrompt({
      assignment: "x".repeat(5000),
      solutionSpace: "one fix: rename",
    });
    expect(prompt).toContain("Open-endedness hint: one fix: rename");
    expect(prompt.length).toBeLessThan(3000);
    expect(prompt.endsWith("…")).toBe(true);
  });
});
