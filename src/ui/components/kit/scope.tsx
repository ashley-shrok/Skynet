import * as React from "react";

// Kit scope: set by the Modal shell so shared surfaces that portal out of the
// modal's DOM (three-dot menus) still know they belong to a modal — they take
// the kit look and the modal's hue. The sidebar and the pane bars set one too
// (hue 220); elsewhere the scope is null and those surfaces keep their own
// look.

export interface KitScopeValue {
  hue: number;
}

export const KitScopeContext = React.createContext<KitScopeValue | null>(null);

export function useKitScope(): KitScopeValue | null {
  return React.useContext(KitScopeContext);
}
