<script lang="ts">
    import type { PageData, ActionData } from './$types';
    // PANE_BASE — every internal URL your app emits into HTML needs this
    // prefix (hrefs, fetch, <img src>, <video src>). See src/lib/pane.ts
    // for the mechanism + SKILL.md § How the pane mounts your app.
    import { PANE_BASE } from '$lib/pane';

    let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
    <title>Todos</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
    <h1 class="mb-6 text-2xl font-semibold">Todos</h1>

    <form method="post" action="?/add" class="mb-6 flex gap-2">
        <input
            name="text"
            required
            placeholder="What needs doing?"
            class="flex-1 rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
            type="submit"
            class="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
        >
            Add
        </button>
    </form>

    {#if form && 'error' in form && form.error}
        <p class="mb-4 text-sm text-red-600">{form.error}</p>
    {/if}

    <ul class="space-y-2">
        {#each data.items as item (item.id)}
            <li class="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2">
                <form method="post" action="?/toggle" class="flex items-center">
                    <input type="hidden" name="id" value={item.id} />
                    <button
                        type="submit"
                        class="flex h-5 w-5 items-center justify-center rounded border border-gray-400 hover:bg-gray-100"
                        aria-label={item.done ? 'Mark undone' : 'Mark done'}
                    >
                        {#if item.done}<span class="text-green-600">✓</span>{/if}
                    </button>
                </form>

                <span class="flex-1" class:line-through={item.done} class:text-gray-400={item.done}>
                    {item.text}
                </span>

                <form method="post" action="?/delete">
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" class="text-sm text-gray-400 hover:text-red-600">
                        Remove
                    </button>
                </form>
            </li>
        {/each}

        {#if data.items.length === 0}
            <li class="py-8 text-center text-sm text-gray-500">
                No todos yet. Add one above.
            </li>
        {/if}
    </ul>

    <!--
      Demo of the PANE_BASE pattern for internal navigation. Every internal
      <a href>, <img src>, <video src>, and fetch() URL must be prefixed
      this way (see src/lib/pane.ts). Root-absolute hrefs like "/about"
      would navigate the iframe to Skynet's root, not into this app.
      Delete this section (and the /about route) when you customize.
    -->
    <p class="mt-8 text-center text-xs text-gray-400">
        <a href="{PANE_BASE}/about" class="hover:underline">About this app</a>
    </p>
</div>
