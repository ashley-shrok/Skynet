<script lang="ts">
    // See src/routes/+page.svelte for the PANE_BASE pattern this page demos.
    // Delete this route + the link from /+page.svelte when you customize the app.
    import { PANE_BASE } from '$lib/pane';
</script>

<svelte:head>
    <title>About</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
    <h1 class="mb-4 text-2xl font-semibold">About</h1>
    <p class="mb-4 text-gray-700">
        This route exists to demo the PANE_BASE pattern from a second page.
        The link back to the todo list uses the prefix; a naive
        <code class="rounded bg-gray-100 px-1">/</code> href would navigate
        out of the app entirely.
    </p>
    <p>
        <a href={PANE_BASE} class="text-blue-600 hover:underline">← Back to todos</a>
    </p>
</div>
