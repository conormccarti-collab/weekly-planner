import { redirect } from "next/navigation";

// v3 (plan-first) stage 6: the Planning session screen is retired — its
// steps live on the Week screen now. Redirect rather than 404 for anyone
// with the old URL bookmarked.
export default function PlanningRedirect() {
  redirect("/");
}
