import { describe, it, expect } from "vitest";
import {
  frontmatterName,
  isModelInvocationDisabled,
  isUserInvocationDisabled,
  setModelInvocationDisabled,
  setUserInvocationDisabled,
} from "./skill-frontmatter";

const SEED = '---\nname: build\ndescription: "Builds"\n---\n\n# Build\n';

describe("skill-frontmatter", () => {
  it("reads false when the key is absent or there is no frontmatter", () => {
    expect(isModelInvocationDisabled(SEED)).toBe(false);
    expect(isModelInvocationDisabled("# Just a body\n")).toBe(false);
  });

  it("reads the key from frontmatter only", () => {
    expect(isModelInvocationDisabled("---\ndisable-model-invocation: true\n---\n")).toBe(true);
    expect(isModelInvocationDisabled("---\ndisable-model-invocation: false\n---\n")).toBe(false);
    expect(isModelInvocationDisabled("---\nname: x\n---\ndisable-model-invocation: true\n")).toBe(false);
  });

  it("adds the key, leaving other lines and the body untouched", () => {
    const out = setModelInvocationDisabled(SEED, true);
    expect(out).toBe(
      '---\nname: build\ndescription: "Builds"\ndisable-model-invocation: true\n---\n\n# Build\n',
    );
    expect(isModelInvocationDisabled(out)).toBe(true);
  });

  it("removes the key and round-trips to the original", () => {
    expect(setModelInvocationDisabled(setModelInvocationDisabled(SEED, true), false)).toBe(SEED);
  });

  it("replaces an existing false value instead of duplicating", () => {
    const src = "---\nname: x\ndisable-model-invocation: false\n---\nbody";
    expect(setModelInvocationDisabled(src, true)).toBe(
      "---\nname: x\ndisable-model-invocation: true\n---\nbody",
    );
  });

  it("creates frontmatter when missing, and is a no-op when clearing without any", () => {
    expect(setModelInvocationDisabled("# Body\n", true)).toBe(
      "---\ndisable-model-invocation: true\n---\n# Body\n",
    );
    expect(setModelInvocationDisabled("# Body\n", false)).toBe("# Body\n");
  });

  it("preserves CRLF line endings", () => {
    const src = "---\r\nname: x\r\n---\r\nbody\r\n";
    expect(setModelInvocationDisabled(src, true)).toBe(
      "---\r\nname: x\r\ndisable-model-invocation: true\r\n---\r\nbody\r\n",
    );
  });

  it("agent-only writes user-invocable: false and round-trips", () => {
    const out = setUserInvocationDisabled(SEED, true);
    expect(out).toBe('---\nname: build\ndescription: "Builds"\nuser-invocable: false\n---\n\n# Build\n');
    expect(isUserInvocationDisabled(out)).toBe(true);
    expect(isUserInvocationDisabled("---\nuser-invocable: true\n---\n")).toBe(false);
    expect(setUserInvocationDisabled(out, false)).toBe(SEED);
  });

  it("the two modes are mutually exclusive — turning one on clears the other", () => {
    const userOnly = setModelInvocationDisabled(SEED, true);
    const agentOnly = setUserInvocationDisabled(userOnly, true);
    expect(isModelInvocationDisabled(agentOnly)).toBe(false);
    expect(isUserInvocationDisabled(agentOnly)).toBe(true);
    const back = setModelInvocationDisabled(agentOnly, true);
    expect(isModelInvocationDisabled(back)).toBe(true);
    expect(isUserInvocationDisabled(back)).toBe(false);
    expect(back).toBe(userOnly);
  });

  it("ignores a trailing # comment when reading, and clears a commented key", () => {
    const src = "---\nname: x\nuser-invocable: false   # helper only\n---\nbody";
    expect(isUserInvocationDisabled(src)).toBe(true);
    expect(setModelInvocationDisabled(src, true)).toBe(
      "---\nname: x\ndisable-model-invocation: true\n---\nbody",
    );
  });
});

describe("frontmatterName", () => {
  it("reads plain, quoted and commented names; null when absent", async () => {
    expect(frontmatterName("---\nname: build\n---\n")).toBe("build");
    expect(frontmatterName("---\nname: \"build\" \n---\n")).toBe("build");
    expect(frontmatterName("---\nname: build # x\n---\n")).toBe("build");
    expect(frontmatterName("---\ndescription: x\n---\nname: body\n")).toBeNull();
    expect(frontmatterName("# no frontmatter\n")).toBeNull();
  });

  it("finds the block past a byte-order mark, spaced fences and a mixed-ending body", () => {
    const bom = "\uFEFF---\nname: x\n---\nbody\n";
    expect(setUserInvocationDisabled(bom, true)).toBe("\uFEFF---\nname: x\nuser-invocable: false\n---\nbody\n");
    expect(frontmatterName(bom)).toBe("x");
    expect(setUserInvocationDisabled("---\nname: x\n---\nline\r\nmore\n", true)).toBe(
      "---\nname: x\nuser-invocable: false\n---\nline\r\nmore\n",
    );
    expect(setUserInvocationDisabled("--- \nname: x\n---  \nb\n---\nrule\n", true)).toBe(
      "---\nname: x\nuser-invocable: false\n---\nb\n---\nrule\n",
    );
  });
});
