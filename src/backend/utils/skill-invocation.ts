/**
 * The two "who can invoke" settings in a SKILL.md's frontmatter, in the
 * skills list's wire shape: `user-invocable: false` → userInvocable: false
 * (not offered to the user), `disable-model-invocation: true` →
 * modelInvocable: false (agents won't use it on their own). Accepts real
 * booleans and their quoted string forms.
 */
export type InvocationFlags = { userInvocable?: false; modelInvocable?: false };

function isBool(v: unknown, want: boolean): boolean {
  return v === want || (typeof v === "string" && v.trim().toLowerCase() === String(want));
}

export function invocationFlagsOf(frontmatter: Record<string, unknown>): InvocationFlags {
  return {
    ...(isBool(frontmatter["user-invocable"], false) ? { userInvocable: false as const } : {}),
    ...(isBool(frontmatter["disable-model-invocation"], true) ? { modelInvocable: false as const } : {}),
  };
}
