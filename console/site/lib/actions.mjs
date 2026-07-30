// GitHub Actions API layer: list runs, dispatch a workflow, follow a run.
// Dispatch returns 204 with no run id, so the spawned run is found by polling
// for the newest workflow_dispatch run created after our timestamp.
import { ghJSON, tokenForRepo, AuthError } from "./gh.mjs";
import { isDemo, demoDispatch } from "./demo.mjs";

export async function listRuns(org, repo, workflowFile, perPage = 5) {
  const j = await ghJSON(`/repos/${org}/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${perPage}`);
  return j && j.workflow_runs ? j.workflow_runs : null;   // null = 404/no scope
}

export async function dispatch(org, repo, workflowFile, inputs) {
  // Demo mode: the run is simulated in memory (queued -> in_progress ->
  // success), so the ops feed, the poller and the wizards behave for real
  // without dispatching anything.
  if (isDemo()) return demoDispatch(org, repo, workflowFile, inputs);
  const r = await fetch(`https://api.github.com/repos/${org}/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tokenForRepo(org, repo),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: inputs || {} }),
  });
  if (r.status === 401) throw new AuthError("GitHub rejected the token (401). Check it in Settings.");
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`GitHub ${r.status}: ${j.message || "dispatch failed"}${r.status === 403 ? " (does this repo's PAT have Actions: Read and write?)" : ""}`);
  }
  return { dispatchedAt: Date.now() };
}

// Find the run our dispatch spawned (newest dispatch-event run created at/after
// our timestamp, with a little clock slack). Retries briefly - the run can take
// a few seconds to materialize.
export async function findDispatchedRun(org, repo, workflowFile, dispatchedAt, tries = 6) {
  for (let i = 0; i < tries; i++) {
    await new Promise(res => setTimeout(res, 2500));
    const runs = await listRuns(org, repo, workflowFile, 5);
    const hit = (runs || []).find(r => r.event === "workflow_dispatch" && new Date(r.created_at).getTime() >= dispatchedAt - 60_000);
    if (hit) return hit;
  }
  return null;
}

// Poll a run until it completes; onTick(run) on every update. Returns the final run.
export async function pollRun(org, repo, runId, onTick, intervalMs = 10_000) {
  for (;;) {
    const run = await ghJSON(`/repos/${org}/${repo}/actions/runs/${runId}`);
    if (!run) return null;
    if (onTick) onTick(run);
    if (run.status === "completed") return run;
    await new Promise(res => setTimeout(res, intervalMs));
  }
}
