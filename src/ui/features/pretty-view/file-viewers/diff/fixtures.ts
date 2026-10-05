/** Test fixtures for the diff viewer. */

export const GIT_PATCH = `From 1234 Mon Sep 17 00:00:00 2001
From: Dev <dev@example.com>
Subject: [PATCH] Tidy auth

---
 src/auth.ts  | 3 ++-
 docs/new.md  | 2 ++
 2 files changed, 4 insertions(+), 1 deletion(-)

diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,5 @@
 import { a } from "a";
--- a leading-dashes line that was removed
+const b = 2;
+const c = 3;
 export {};
 
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,2 @@
+# New
+text
\\ No newline at end of file
diff --git a/old.txt b/renamed.txt
similarity index 100%
rename from old.txt
rename to renamed.txt
diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
--
2.40.0
`;

export const PLAIN_UNIFIED = `--- a.txt\t2026-01-01 00:00:00
+++ b.txt\t2026-01-02 00:00:00
@@ -1,2 +1,2 @@
-one
+uno
 two
--- c.txt
+++ c.txt
@@ -3 +3 @@
-x
+y
`;
