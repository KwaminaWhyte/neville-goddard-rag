import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("goal/:id", "routes/goal.tsx"),
  route("api/coach", "routes/api.coach.tsx"),
] satisfies RouteConfig;
