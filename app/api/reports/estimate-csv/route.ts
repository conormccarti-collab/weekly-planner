import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadEstimateReport, type Period } from "@/lib/estimate-report-data";
import { estimateReportToCsv } from "@/lib/estimate-report";
import { env } from "@/lib/env";
import { utcInstantToLocal } from "@/lib/time";

/** Brief section 9: "Export as CSV." */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const period = (new URL(request.url).searchParams.get("period") as Period | null) ?? "month";
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const report = await loadEstimateReport(supabase, user, period, todayStr);
  const csv = estimateReportToCsv(report);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="estimate-report-${period}-${todayStr}.csv"`,
    },
  });
}
