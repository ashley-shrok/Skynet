import { lazy, Suspense, type ComponentType } from "react";
import type { FileModeViewProps } from "../registry";

const views = {
  email: lazy(() => import("./EmailViewer")),
  calendar: lazy(() => import("./CalendarViewer")),
  contacts: lazy(() => import("./ContactsViewer")),
};

function wrap(name: keyof typeof views) {
  const View: ComponentType<FileModeViewProps> = views[name];
  return function PimMode(props: FileModeViewProps): JSX.Element {
    return (
      <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading…</div>}>
        <View {...props} />
      </Suspense>
    );
  };
}

export const EmailMode = wrap("email");
export const CalendarMode = wrap("calendar");
export const ContactsMode = wrap("contacts");
