import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("goal/:id", "routes/goal.tsx"),
  route("api/coach", "routes/api/coach.tsx"),
  // JSON API for the Expo mobile app
  route("api/goals", "routes/api/goals.tsx"),
  route("api/goals/:id", "routes/api/goals.$id.tsx"),
  route("api/goals/:id/entries", "routes/api/goals.$id.entries.tsx"),
  route("api/goals/:id/entries/:entryId", "routes/api/goals.$id.entries.$entryId.tsx"),
] satisfies RouteConfig;
