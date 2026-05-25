import { redirect, type ActionFunctionArgs } from "react-router";
import { tokenFromRequest, deleteSession, clearCookie } from "../lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const token = tokenFromRequest(request);
  if (token) await deleteSession(token);
  throw redirect("/", { headers: { "Set-Cookie": clearCookie() } });
}

export async function loader() {
  throw redirect("/");
}
