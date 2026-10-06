// foliate-js is vendored as plain JavaScript (scripts/vendor-foliate-js.mjs).
declare module "@/vendor/foliate-js/view.js" {
  export function makeBook(file: File): Promise<{
    metadata?: { title?: unknown; author?: unknown };
    getCover?(): Promise<Blob | null>;
    sections?: unknown[];
    toc?: unknown[];
  }>;
}
