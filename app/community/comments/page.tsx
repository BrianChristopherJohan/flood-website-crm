/**
 * Comments moderation has been merged into the main Community Management page
 * as a third tab. This route is kept as a permanent redirect so existing
 * bookmarks / sidebar shortcuts / external links don't 404.
 */
import { redirect } from "next/navigation";

export default function CommentsRedirect() {
  redirect("/community?tab=comments");
}
