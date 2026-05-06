import { defineMiddleware } from "astro:middleware";
import { getUserFromCookie } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, redirect, locals } = context;
  
  // Public paths and static assets
  const publicPaths = ["/login", "/api/login", "/favicon.ico", "/favicon.svg"];
  const isPublicPath = publicPaths.some(path => url.pathname === path);
  const isStaticAsset = url.pathname.includes('.') || url.pathname.startsWith('/_astro');

  const user = getUserFromCookie(cookies);
  (locals as any).user = user;

  // If static asset or public path, let it through
  if (isStaticAsset || isPublicPath) {
    return next();
  }

  // Protected paths by role
  const adminPaths = ["/admin"];
  const isAdminPath = adminPaths.some(path => url.pathname.startsWith(path));

  // If trying to access protected page without user
  if (!user) {
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    return redirect("/login");
  }

  // If trying to access admin page without admin role
  if (isAdminPath && user?.role !== 'ADMIN') {
    return redirect("/");
  }

  // If trying to access login page while already logged in
  if (url.pathname === "/login" && user) {
    return redirect("/");
  }

  return next();
});
