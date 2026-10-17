// The kit — the shared parts every modal is built from (apple-ux look A).
// Import from "@/components/kit". Never hand-roll a button, field, row,
// chip, state or confirm inside a modal; if the kit lacks a part, add it here.
import "./kit.css";

export * from "./buttons";
export * from "./fields";
export * from "./choices";
export * from "./rows";
export * from "./states";
export * from "./host-picker";
export { kitConfirm, kitPrompt, kitAlert, autoAnswerKitDialogs, __resetKitDialogsForTests } from "./dialogs";
export type { KitConfirmOptions, KitPromptOptions, KitAlertOptions } from "./dialogs";
export { useKitScope } from "./scope";
