// App-wide request to open the Scheduled Tasks modal, optionally already
// filtered to one role on one host. The modal is mounted by
// PrettyConversationsPanel; the role modal is mounted both there and in
// PrettyView, so it asks through a window event instead of a prop chain.

export const OPEN_SCHEDULED_TASKS_EVENT = "skynet:open-scheduled-tasks";

export interface ScheduledTasksFilter {
  role: string;
  hostId: number;
}

export function requestOpenScheduledTasks(filter: ScheduledTasksFilter | null): void {
  console.info("[scheduled-tasks] open requested", {
    role: filter?.role ?? null,
    hostId: filter?.hostId ?? null,
  });
  window.dispatchEvent(
    new CustomEvent<ScheduledTasksFilter | null>(OPEN_SCHEDULED_TASKS_EVENT, {
      detail: filter,
    }),
  );
}
