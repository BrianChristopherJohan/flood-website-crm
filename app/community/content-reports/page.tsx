import { redirect } from "next/navigation";

/**
 * The Content Reports queue is now the "Reports" tab on /community.
 * This route stays around so any bookmarked link or external doc still
 * lands the user on the right place.
 */
export default function ContentReportsRedirect() {
  redirect("/community?tab=reports");
}
