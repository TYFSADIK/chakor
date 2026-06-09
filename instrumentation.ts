/**
 * Next.js runs register() once when the server process starts. We use it to
 * bring up the local llama.cpp model under the same process as the app, so the
 * whole stack is a single service. Node runtime only — never on the edge.
 */
export async function register() {
  // The positive runtime check lets the bundler drop this whole block (and its
  // node-only imports) from the edge build. Don't refactor to an early return.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { llamaSupervisor } = await import('./lib/llama-supervisor');
    await llamaSupervisor.start();
  }
}
