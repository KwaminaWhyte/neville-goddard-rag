import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("goal/:id", "routes/goal.tsx"),
  // Auth (web, cookie sessions)
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("profile", "routes/profile.tsx"),
  route("api/coach", "routes/api/coach.tsx"),
  // JSON API for the Expo mobile app
  route("api/goals", "routes/api/goals.tsx"),
  route("api/goals/:id", "routes/api/goals.$id.tsx"),
  route("api/goals/:id/entries", "routes/api/goals.$id.entries.tsx"),
  route("api/goals/:id/entries/:entryId", "routes/api/goals.$id.entries.$entryId.tsx"),
  // Auth + profile API (Bearer, for the mobile app)
  route("api/auth/signup", "routes/api/auth.signup.tsx"),
  route("api/auth/login", "routes/api/auth.login.tsx"),
  route("api/auth/logout", "routes/api/auth.logout.tsx"),
  route("api/auth/me", "routes/api/auth.me.tsx"),
  route("api/profile", "routes/api/profile.tsx"),
  route("api/profile/password", "routes/api/profile.password.tsx"),
] satisfies RouteConfig;
