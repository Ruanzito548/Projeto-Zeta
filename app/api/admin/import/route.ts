import { NextResponse } from "next/server";

import { ImportBusyError, resumeImport, runSlice, startImport } from "@/lib/import/engine";
import type { ImportMode, ImportTargets } from "@/lib/import/types";
import { AuthError, requireAdmin } from "@/lib/server/admin-auth";
import { createImportDeps, foreverDbConfigured } from "@/lib/server/import-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODES: ImportMode[] = ["initial", "incremental", "sync"];
const SLICE_BUDGET_MS = 40_000;

function fail(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ImportBusyError) return NextResponse.json({ error: error.message }, { status: 409 });
  const message = error instanceof Error ? error.message : "Erro inesperado.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { store } = createImportDeps();
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    return NextResponse.json({
      foreverDbConfigured: foreverDbConfigured(),
      jobs: await store.listJobs(20),
      logs: jobId ? await store.listLogs(jobId, 100) : [],
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      jobId?: string;
      mode?: string;
      targets?: Partial<ImportTargets>;
      enrichWithForeverDb?: boolean;
    } | null;
    const deps = createImportDeps();

    switch (body?.action) {
      case "start": {
        const mode = MODES.find((m) => m === body.mode);
        if (!mode) return NextResponse.json({ error: "Modo inválido." }, { status: 400 });
        const job = await startImport(deps, {
          mode,
          targets: body.targets,
          enrichWithForeverDb: body.enrichWithForeverDb,
        });
        return NextResponse.json({ job });
      }
      case "resume": {
        if (!body.jobId) return NextResponse.json({ error: "jobId obrigatório." }, { status: 400 });
        return NextResponse.json({ job: await resumeImport(deps, body.jobId) });
      }
      case "step": {
        if (!body.jobId) return NextResponse.json({ error: "jobId obrigatório." }, { status: 400 });
        return NextResponse.json(await runSlice(deps, body.jobId, SLICE_BUDGET_MS));
      }
      default:
        return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
  } catch (error) {
    return fail(error);
  }
}
