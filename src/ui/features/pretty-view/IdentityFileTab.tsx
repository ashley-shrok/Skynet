// The loading / error / ready shape every tab and view loads its data into.
// (The agent file itself now renders inside the agent window, IdentityModal.)

export type TabState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };
